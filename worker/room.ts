/**
 * The Room Durable Object — one instance per room code, and the single
 * authority on the game.
 *
 * It owns the deck, the shuffle, every hand and the turn order. Clients send
 * intents; nothing they send is trusted for legality, turn order or
 * randomness. Every outbound frame is built by `serializeFor`, so a player is
 * only ever sent their own hand.
 *
 * Sockets use the WebSocket Hibernation API, so a room full of people
 * thinking about their next move costs nothing. Because hibernation discards
 * in-memory state and JavaScript timers, identity rides along on each socket
 * as a serialized attachment, and every deadline in the game is a single
 * Durable Object alarm set to the nearest one.
 */

import { DurableObject } from 'cloudflare:workers';
import type { BotLevel, GameEvent, Intent, RoomState, RuleSet } from '../shared/types';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  actorId,
  applyIntent,
  expireUnoWindow,
  findPlayer,
  serializeFor,
  startMatch,
  startNextRound,
  timeoutTurn,
} from '../shared/engine';
import {
  AVATAR_COUNT,
  applyRuleChange,
  canStart,
  cleanName,
  createRoomState,
  makeBot,
  randomNickname,
  seatPlayer,
  unseatPlayer,
} from '../shared/room';
import { botDelay, botView, decideBotCatch, decideBotIntent } from '../shared/bots';
import { describeEvent } from '../shared/narrate';
import { cryptoRng, randomBetween } from '../shared/rng';
import type { ChatMessage, ClientMessage, ServerMessage } from '../shared/protocol';
import {
  CHAT_HISTORY,
  CLOSE_BAD_ROOM,
  CLOSE_REPLACED,
  EMOTES,
  MAX_CHAT_LENGTH,
  RECONNECT_GRACE_MS,
  ROOM_TTL_MS,
} from '../shared/protocol';

/** What each socket remembers about itself across a hibernation. */
interface SessionMeta {
  /** `null` for spectators. */
  playerId: string | null;
  token: string;
  spectator: boolean;
  /** Wire format supported by this browser; absent attachments are v1. */
  protocol?: 1 | 2;
}

type TimerKind = 'turn' | 'uno' | 'bot' | 'botCatch' | 'grace' | 'cleanup';

interface Timer {
  kind: TimerKind;
  /** Epoch ms. */
  at: number;
  /** Only used by `grace`. */
  playerId?: string;
}

interface StoredRoom {
  room: RoomState | null;
  chat: ChatMessage[];
  tokens: Record<string, string>;
  timers: Timer[];
}

/** Bots pounce a beat after a window opens, so a human always gets first go. */
const BOT_CATCH_MIN_MS = 900;
const BOT_CATCH_MAX_MS = 2000;

/** Flood guard, per player, per window. */
const RATE_WINDOW_MS = 3000;
const RATE_LIMIT = 40;

/** Control characters, which have no business in a nickname or a chat line. */
// eslint-disable-next-line no-control-regex -- stripping them is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export class Room extends DurableObject<Env> {
  /** `null` until somebody creates this room, and again once it is cleaned up. */
  private room: RoomState | null = null;
  private chat: ChatMessage[] = [];
  /** Reconnection tokens. Never serialized to a client other than its owner. */
  private tokens: Record<string, string> = {};
  private timers: Timer[] = [];
  /** In-memory only: resets on hibernation, which is fine for a flood guard. */
  private rates = new Map<string, { count: number; until: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Keepalives are answered by the runtime itself, so a room full of people
    // staring at their cards stays hibernated instead of waking every 25s.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pong', now: 0 })),
    );

    // Restore once, on wake — not on every request.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<StoredRoom>('room');
      if (!stored) return;
      this.room = stored.room;
      this.chat = stored.chat ?? [];
      this.tokens = stored.tokens ?? {};
      this.timers = stored.timers ?? [];
    });
  }

  /* ---------------------------------------------------------------- *
   * RPC — used by the Worker's /api routes
   * ---------------------------------------------------------------- */

  /** Reserves this room code. Returns false if it is already taken. */
  async createIfAbsent(code: string, rules?: Partial<RuleSet>): Promise<boolean> {
    if (this.room) return false;
    this.room = createRoomState(code, rules);
    await this.persist();
    return true;
  }

  /** Enough for the client to say something friendly before connecting. */
  async info(): Promise<{
    exists: boolean;
    phase: RoomState['phase'] | null;
    players: number;
    seatsFree: number;
    started: boolean;
  }> {
    if (!this.room) {
      return { exists: false, phase: null, players: 0, seatsFree: 0, started: false };
    }
    return {
      exists: true,
      phase: this.room.phase,
      players: this.room.players.length,
      seatsFree: Math.max(0, MAX_PLAYERS - this.room.players.length),
      started: this.room.phase !== 'lobby',
    };
  }

  /* ---------------------------------------------------------------- *
   * Connections
   * ---------------------------------------------------------------- */

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }

    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (!this.room) {
      // A code nobody ever created, or a room that has since been cleaned up.
      server.accept();
      this.fail(server, 'no_such_room', 'That room code does not exist.', CLOSE_BAD_ROOM);
      return new Response(null, { status: 101, webSocket: client });
    }

    const now = Date.now();
    const { meta, reclaimed } = this.resolveSeat(this.room, url);

    // Tagged by player id so a seat's sockets can be found without a scan.
    this.ctx.acceptWebSocket(server, [meta.playerId ?? 'spectator']);
    server.serializeAttachment(meta);

    // One live socket per seat: a second tab takes over from the first.
    if (meta.playerId) {
      for (const other of this.ctx.getWebSockets(meta.playerId)) {
        if (other === server) continue;
        this.fail(other, 'replaced', 'You opened this room in another tab.', CLOSE_REPLACED);
      }
    }

    const events: GameEvent[] = [];
    const player = meta.playerId ? findPlayer(this.room, meta.playerId) : undefined;
    if (player) {
      if (reclaimed && (!player.connected || player.botControlled)) {
        events.push({ t: 'playerReconnected', playerId: player.id, name: player.name });
      } else if (!reclaimed) {
        events.push({ t: 'playerJoined', playerId: player.id, name: player.name });
      }
      player.connected = true;
      player.botControlled = false;
      this.clearTimer('grace', player.id);
    }

    this.send(server, {
      t: 'welcome',
      youId: meta.playerId,
      token: meta.token,
      spectator: meta.spectator,
      room: serializeFor(this.room, meta.playerId, now),
      chat: this.chat.slice(-CHAT_HISTORY),
    });

    await this.commit(events, now);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Works out who this connection is: a returning player reclaiming their
   * seat, somebody new taking one, or a spectator.
   */
  private resolveSeat(state: RoomState, url: URL): { meta: SessionMeta; reclaimed: boolean } {
    const protocol = url.searchParams.get('v') === '2' ? 2 : 1;
    // A returning player replays the token they stashed in sessionStorage.
    const token = url.searchParams.get('token');
    if (token) {
      const playerId = this.tokens[token];
      if (playerId && findPlayer(state, playerId)) {
        return { meta: { playerId, token, spectator: false, protocol }, reclaimed: true };
      }
    }

    const wantsToWatch = url.searchParams.get('spectate') === '1';
    const canSeat = state.phase === 'lobby' && state.players.length < MAX_PLAYERS;
    if (wantsToWatch || !canSeat) {
      // Anyone arriving mid-game watches, with every hand hidden.
      return {
        meta: { playerId: null, token: crypto.randomUUID(), spectator: true, protocol },
        reclaimed: false,
      };
    }

    const name = cleanName(
      (url.searchParams.get('name') ?? '').replace(CONTROL_CHARS, ''),
      randomNickname(cryptoRng),
    );
    const requestedAvatar = Number(url.searchParams.get('avatar'));
    const avatar = Number.isFinite(requestedAvatar)
      ? Math.abs(Math.trunc(requestedAvatar))
      : cryptoRng.int(AVATAR_COUNT);

    const id = crypto.randomUUID();
    const fresh = crypto.randomUUID();
    seatPlayer(state, { id, name, avatar });
    this.tokens[fresh] = id;
    return { meta: { playerId: id, token: fresh, spectator: false, protocol }, reclaimed: false };
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    const meta = this.metaOf(ws);
    if (!meta) return;

    if (!this.room) {
      this.fail(ws, 'no_such_room', 'This room has closed.', CLOSE_BAD_ROOM);
      return;
    }

    if (!this.allow(meta)) {
      this.send(ws, { t: 'error', code: 'slow_down', message: 'Slow down a moment.' });
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { t: 'error', code: 'bad_message', message: 'That message made no sense.' });
      return;
    }
    if (!message || typeof message.t !== 'string') return;

    const now = Date.now();

    if (message.t === 'ping') {
      this.send(ws, { t: 'pong', now });
      return;
    }

    if (message.t === 'chat' || message.t === 'emote') {
      const entry = this.buildChat(meta, message, now);
      if (entry) await this.commitChat(entry, now);
      return;
    }

    if (!meta.playerId) {
      this.send(ws, { t: 'error', code: 'spectating', message: 'You are watching this one.' });
      return;
    }

    const events = this.handlePlayerMessage(ws, meta.playerId, message, now);
    if (events) await this.commit(events, now);
  }

  /** Returns the events to broadcast, or `null` if nothing changed. */
  private handlePlayerMessage(
    ws: WebSocket,
    playerId: string,
    message: ClientMessage,
    now: number,
  ): GameEvent[] | null {
    const state = this.room as RoomState;
    const player = findPlayer(state, playerId);
    if (!player) return null;
    const isHost = state.hostId === playerId;

    switch (message.t) {
      case 'intent':
        return this.handleIntent(ws, playerId, message.intent, now);

      case 'ready': {
        if (state.phase !== 'lobby') return null;
        player.ready = message.ready === true;
        return [];
      }

      case 'rules': {
        if (!this.requireHost(ws, isHost)) return null;
        if (state.phase !== 'lobby') {
          this.send(ws, {
            t: 'error',
            code: 'in_progress',
            message: 'Rules are locked once the game starts.',
          });
          return null;
        }
        state.rules = applyRuleChange(state.rules, message.patch ?? {});
        return [];
      }

      case 'addBot': {
        if (!this.requireHost(ws, isHost)) return null;
        if (state.phase !== 'lobby') return null;
        if (state.players.length >= MAX_PLAYERS) {
          this.send(ws, { t: 'error', code: 'room_full', message: 'The table is full.' });
          return null;
        }
        const level: BotLevel =
          message.level === 'easy' || message.level === 'hard' ? message.level : 'normal';
        const bot = seatPlayer(state, makeBot(state, level, cryptoRng));
        bot.ready = true;
        return [{ t: 'playerJoined', playerId: bot.id, name: bot.name }];
      }

      case 'removePlayer': {
        if (!this.requireHost(ws, isHost)) return null;
        if (state.phase !== 'lobby') return null;
        const target = findPlayer(state, message.playerId);
        if (!target || target.id === playerId) return null;
        const name = target.name;
        for (const socket of this.ctx.getWebSockets(target.id)) {
          this.fail(socket, 'removed', 'The host removed you from the room.', CLOSE_REPLACED);
        }
        for (const [token, owner] of Object.entries(this.tokens)) {
          if (owner === target.id) delete this.tokens[token];
        }
        unseatPlayer(state, target.id);
        return [{ t: 'playerLeft', playerId: target.id, name }];
      }

      case 'start': {
        if (!this.requireHost(ws, isHost)) return null;
        if (state.players.length < MIN_PLAYERS) {
          this.send(ws, {
            t: 'error',
            code: 'not_enough_players',
            message: 'You need at least 2 players.',
          });
          return null;
        }
        if (!canStart(state)) {
          this.send(ws, { t: 'error', code: 'not_ready', message: 'Everybody has to be ready first.' });
          return null;
        }
        const result = startMatch(state, { rng: cryptoRng, now });
        if (!result.ok) {
          this.send(ws, { t: 'error', code: result.code, message: result.message });
          return null;
        }
        this.room = result.state;
        return result.events;
      }

      case 'nextRound': {
        if (state.phase !== 'roundOver') return null;
        player.ready = true;
        const waiting = state.players.filter((p) => !p.isBot && p.connected && !p.ready);
        if (waiting.length > 0) return [];
        const result = startNextRound(state, { rng: cryptoRng, now });
        if (!result.ok) return [];
        this.room = result.state;
        return result.events;
      }

      case 'newMatch': {
        if (!this.requireHost(ws, isHost)) return null;
        if (state.phase !== 'matchOver') return null;
        this.resetToLobby(state);
        return [];
      }

      default:
        return null;
    }
  }

  /** Same people, same room code, scores wiped. */
  private resetToLobby(state: RoomState): void {
    state.phase = 'lobby';
    state.result = null;
    state.matchWinnerId = null;
    state.round = 0;
    state.drawPile = [];
    state.discard = [];
    state.activeColor = null;
    state.pending = null;
    state.drawStack = null;
    state.uno = null;
    state.lastPlayerId = null;
    state.turnDeadline = null;
    state.passRecord = [];
    for (const player of state.players) {
      player.hand = [];
      player.score = 0;
      player.roundPoints = 0;
      player.ready = player.isBot;
    }
  }

  private handleIntent(
    ws: WebSocket,
    playerId: string,
    intent: Intent,
    now: number,
  ): GameEvent[] | null {
    const state = this.room as RoomState;
    if (!intent || typeof intent.type !== 'string') return null;

    const result = applyIntent(state, playerId, intent, { rng: cryptoRng, now });
    if (!result.ok) {
      // Rejections are private: only the player who tried is told.
      this.send(ws, { t: 'error', code: result.code, message: result.message });
      return null;
    }
    this.room = result.state;
    return result.events;
  }

  private requireHost(ws: WebSocket, isHost: boolean): boolean {
    if (isHost) return true;
    this.send(ws, { t: 'error', code: 'not_host', message: 'Only the host can do that.' });
    return false;
  }

  private buildChat(meta: SessionMeta, message: ClientMessage, now: number): ChatMessage | null {
    const state = this.room as RoomState;
    const player = meta.playerId ? findPlayer(state, meta.playerId) : undefined;

    let text: string;
    let kind: ChatMessage['kind'];

    if (message.t === 'emote') {
      const emote = EMOTES[message.index];
      if (!emote) return null;
      text = emote.glyph;
      kind = 'emote';
    } else if (message.t === 'chat') {
      text = String(message.text ?? '')
        .replace(CONTROL_CHARS, ' ')
        .trim()
        .slice(0, MAX_CHAT_LENGTH);
      if (!text) return null;
      kind = 'chat';
    } else {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      kind,
      playerId: player?.id ?? null,
      name: player?.name ?? 'Spectator',
      avatar: player?.avatar ?? null,
      text,
      at: now,
    };
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket): Promise<void> {
    const meta = this.metaOf(ws);
    if (!meta || !this.room || !meta.playerId) return;

    // A replacement socket for the same seat may already be live.
    const others = this.ctx.getWebSockets(meta.playerId).filter((other) => other !== ws);
    if (others.length > 0) return;

    const player = findPlayer(this.room, meta.playerId);
    if (!player) return;

    const now = Date.now();
    const events: GameEvent[] = [];
    player.connected = false;

    if (this.room.phase === 'lobby') {
      // No round in flight, so the seat just goes.
      const name = player.name;
      delete this.tokens[meta.token];
      unseatPlayer(this.room, player.id);
      events.push({ t: 'playerLeft', playerId: player.id, name });
    } else {
      // They keep their seat, and their hand, for a minute.
      this.setTimer('grace', now + RECONNECT_GRACE_MS, player.id);
    }

    await this.commit(events, now);
  }

  /* ---------------------------------------------------------------- *
   * Alarms — every deadline in the game
   * ---------------------------------------------------------------- */

  override async alarm(): Promise<void> {
    const now = Date.now();
    if (!this.room) {
      await this.armAlarm();
      return;
    }

    const due = this.timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
    this.timers = this.timers.filter((t) => t.at > now);
    const events: GameEvent[] = [];

    for (const timer of due) {
      switch (timer.kind) {
        case 'uno':
          this.fireUnoWindow(events, now);
          break;
        case 'turn':
          this.fireTurnClock(events, now);
          break;
        case 'bot':
          this.fireBotMove(events, now);
          break;
        case 'botCatch':
          this.fireBotCatch(events, now);
          break;
        case 'grace':
          this.fireGrace(events, timer.playerId);
          break;
        case 'cleanup':
          if (await this.fireCleanup()) return;
          break;
      }
    }

    await this.commit(events, now);
  }

  private fireUnoWindow(events: GameEvent[], now: number): void {
    const state = this.room as RoomState;
    if (!state.uno || now < state.uno.deadline) return;
    const result = expireUnoWindow(state, { rng: cryptoRng, now });
    if (!result.ok) return;
    this.room = result.state;
    events.push(...result.events);
  }

  private fireTurnClock(events: GameEvent[], now: number): void {
    const state = this.room as RoomState;
    // Re-check: the turn may well have moved on since the alarm was set.
    if (state.phase !== 'playing' || state.turnDeadline === null || now < state.turnDeadline) return;
    const result = timeoutTurn(state, { rng: cryptoRng, now });
    if (!result.ok) return;
    this.room = result.state;
    events.push(...result.events);
  }

  private fireBotMove(events: GameEvent[], now: number): void {
    const state = this.room as RoomState;
    const actor = actorId(state);
    if (!actor) return;
    const player = findPlayer(state, actor);
    if (!player || (!player.isBot && !player.botControlled)) return;

    const intent = decideBotIntent(botView(state, player.id, now), cryptoRng);
    if (!intent) return;
    const result = applyIntent(state, player.id, intent, { rng: cryptoRng, now });
    if (!result.ok) return;
    this.room = result.state;
    events.push(...result.events);
  }

  private fireBotCatch(events: GameEvent[], now: number): void {
    const window = this.room?.uno;
    if (!window || window.called || now >= window.deadline) return;

    for (const player of (this.room as RoomState).players) {
      if (!player.isBot && !player.botControlled) continue;
      if (player.id === window.playerId) continue;
      const current = this.room as RoomState;
      const intent = decideBotCatch(botView(current, player.id, now));
      if (!intent) continue;
      const result = applyIntent(current, player.id, intent, { rng: cryptoRng, now });
      if (!result.ok) continue;
      this.room = result.state;
      events.push(...result.events);
      return; // one catch settles it
    }
  }

  private fireGrace(events: GameEvent[], playerId: string | undefined): void {
    const state = this.room as RoomState;
    if (!playerId) return;
    const player = findPlayer(state, playerId);
    if (!player || player.connected || player.botControlled) return;

    if (state.phase === 'lobby') {
      unseatPlayer(state, player.id);
      events.push({ t: 'playerLeft', playerId: player.id, name: player.name });
      return;
    }
    // A bot finishes the round in their seat so nobody is left waiting.
    player.botControlled = true;
    events.push({ t: 'botTookOver', playerId: player.id, name: player.name });
  }

  /** Returns true when the room deleted itself. */
  private async fireCleanup(): Promise<boolean> {
    const state = this.room as RoomState;
    if (state.players.some((p) => !p.isBot && p.connected)) return false;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(1001, 'Room closed.');
      } catch {
        // Already gone.
      }
    }
    this.room = null;
    this.chat = [];
    this.tokens = {};
    this.timers = [];
    this.rates.clear();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Timers
   * ---------------------------------------------------------------- */

  private setTimer(kind: TimerKind, at: number, playerId?: string): void {
    this.clearTimer(kind, playerId);
    this.timers.push({ kind, at, playerId });
  }

  private clearTimer(kind: TimerKind, playerId?: string): void {
    this.timers = this.timers.filter(
      (t) => !(t.kind === kind && (playerId === undefined || t.playerId === playerId)),
    );
  }

  /** One alarm, always set to the nearest deadline. */
  private async armAlarm(): Promise<void> {
    if (this.timers.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const next = this.timers.reduce((min, t) => Math.min(min, t.at), Infinity);
    await this.ctx.storage.setAlarm(next);
  }

  /**
   * Works out which deadlines the current state needs. Called after every
   * change, so the alarm always reflects the game as it stands.
   */
  private schedule(now: number): void {
    const state = this.room;
    if (!state) return;

    if (state.phase === 'playing' && state.turnDeadline !== null) {
      this.setTimer('turn', state.turnDeadline);
    } else {
      this.clearTimer('turn');
    }

    if (state.uno) this.setTimer('uno', state.uno.deadline);
    else this.clearTimer('uno');

    // Whose move is it, and is that somebody a bot?
    const actor = state.phase === 'playing' ? actorId(state) : null;
    const player = actor ? findPlayer(state, actor) : undefined;
    if (player && (player.isBot || player.botControlled)) {
      if (!this.timers.some((t) => t.kind === 'bot')) {
        this.setTimer('bot', now + botDelay(cryptoRng));
      }
    } else {
      this.clearTimer('bot');
    }

    const window = state.uno;
    const botCanCatch =
      window !== null &&
      !window.called &&
      state.players.some(
        (p) => (p.isBot || p.botControlled) && p.botLevel !== 'easy' && p.id !== window.playerId,
      );
    if (window && botCanCatch) {
      if (!this.timers.some((t) => t.kind === 'botCatch')) {
        const delay = randomBetween(BOT_CATCH_MIN_MS, BOT_CATCH_MAX_MS, cryptoRng);
        this.setTimer('botCatch', Math.min(now + delay, window.deadline - 1));
      }
    } else {
      this.clearTimer('botCatch');
    }

    // Nobody human left: give them ten minutes to come back, then bin it.
    if (!state.players.some((p) => !p.isBot && p.connected)) {
      if (!this.timers.some((t) => t.kind === 'cleanup')) {
        this.setTimer('cleanup', now + ROOM_TTL_MS);
      }
    } else {
      this.clearTimer('cleanup');
    }
  }

  /* ---------------------------------------------------------------- *
   * Persistence and broadcasting
   * ---------------------------------------------------------------- */

  /** Storage first, then everyone hears about it. */
  private async commit(events: GameEvent[], now: number): Promise<void> {
    const lines = this.narrate(events, now);
    for (const line of lines) this.pushChat(line);
    this.schedule(now);
    await this.persist();
    await this.armAlarm();
    this.sendSync(events, lines, now);
  }

  /** Chat changes no game state or deadline, so it needs neither a room
   * projection nor another alarm write for clients on the compact protocol. */
  private async commitChat(entry: ChatMessage, now: number): Promise<void> {
    this.pushChat(entry);
    await this.persist();

    const state = this.room;
    if (!state) return;
    for (const socket of this.ctx.getWebSockets()) {
      const meta = this.metaOf(socket);
      if (!meta) continue;
      if (meta.protocol === 2) {
        this.send(socket, { t: 'chat', messages: [entry] });
      } else {
        // Browsers that were already open during a deployment still receive
        // the v1 frame shape they understand.
        this.send(socket, {
          t: 'sync',
          room: serializeFor(state, meta.playerId, now),
          events: [],
          chat: [entry],
        });
      }
    }
  }

  private async persist(): Promise<void> {
    const stored: StoredRoom = {
      room: this.room,
      chat: this.chat,
      tokens: this.tokens,
      timers: this.timers,
    };
    await this.ctx.storage.put('room', stored);
  }

  /**
   * The one place game state leaves the Durable Object. Every socket gets a
   * snapshot built for its own player, and events addressed to somebody else
   * are stripped out on the way.
   */
  private sendSync(events: GameEvent[], chat: ChatMessage[], now: number): void {
    const state = this.room;
    if (!state) return;

    for (const socket of this.ctx.getWebSockets()) {
      const meta = this.metaOf(socket);
      if (!meta) continue;
      const visible = events.filter((event) => !('to' in event) || event.to === meta.playerId);
      this.send(socket, {
        t: 'sync',
        room: serializeFor(state, meta.playerId, now),
        events: visible,
        chat: chat.length > 0 ? chat : undefined,
      });
    }
  }

  private narrate(events: GameEvent[], now: number): ChatMessage[] {
    const state = this.room;
    if (!state) return [];
    const nameOf = (id: string): string => findPlayer(state, id)?.name ?? 'Someone';
    const lines: ChatMessage[] = [];
    for (const event of events) {
      // Private reveals never make it into the shared log.
      if ('to' in event) continue;
      const text = describeEvent(event, nameOf);
      if (!text) continue;
      lines.push({
        id: crypto.randomUUID(),
        kind: 'system',
        playerId: null,
        name: 'system',
        avatar: null,
        text,
        at: now,
      });
    }
    return lines;
  }

  private pushChat(entry: ChatMessage): void {
    this.chat.push(entry);
    if (this.chat.length > CHAT_HISTORY) this.chat.splice(0, this.chat.length - CHAT_HISTORY);
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket went away mid-send; the close handler will tidy up.
    }
  }

  private fail(ws: WebSocket, code: string, message: string, closeCode: number): void {
    this.send(ws, { t: 'error', code, message, fatal: true });
    try {
      ws.close(closeCode, code);
    } catch {
      // Already closing.
    }
  }

  private metaOf(ws: WebSocket): SessionMeta | null {
    return (ws.deserializeAttachment() as SessionMeta | null) ?? null;
  }

  private allow(meta: SessionMeta): boolean {
    const key = meta.playerId ?? meta.token;
    const now = Date.now();
    const entry = this.rates.get(key);
    if (!entry || now > entry.until) {
      this.rates.set(key, { count: 1, until: now + RATE_WINDOW_MS });
      return true;
    }
    entry.count++;
    return entry.count <= RATE_LIMIT;
  }

  /* ---------------------------------------------------------------- *
   * Test helpers
   * ---------------------------------------------------------------- */

  /** Lets the integration tests look at the room without a socket. */
  async snapshot(playerId: string | null = null) {
    if (!this.room) return null;
    return serializeFor(this.room, playerId, Date.now());
  }

  /** Lets the integration tests drive an alarm deterministically. */
  async pendingTimers(): Promise<TimerKind[]> {
    return this.timers.map((t) => t.kind);
  }
}
