import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE_PATH } from '../shared/base';
import type { PublicRoom } from '../shared/types';
import type { ClientMessage, ServerMessage } from '../shared/protocol';

/** The app is mounted at a sub-path, so the tests knock on the real door. */
const HOST = 'https://uno.test';
const ORIGIN = `${HOST}${BASE_PATH}`;

async function createRoom(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/rooms`, { method: 'POST' });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { code: string };
  expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  return body.code;
}

/** A connected player, with the message plumbing tests need. */
class Client {
  readonly messages: ServerMessage[] = [];
  private socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.messages.push(JSON.parse(event.data as string) as ServerMessage);
    });
    socket.accept();
  }

  static async open(code: string, query: Record<string, string> = {}): Promise<Client> {
    const params = new URLSearchParams({ room: code, v: '2', ...query });
    const response = await SELF.fetch(`${ORIGIN}/ws?${params}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) throw new Error('no websocket on the upgrade response');
    return new Client(socket);
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close(1000, 'test over');
  }

  async waitFor<T extends ServerMessage>(
    match: (message: ServerMessage) => boolean,
    label: string,
    timeoutMs = 8000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.find(match);
      if (found) return found as T;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  /** The most recent room snapshot this client was sent. */
  room(): PublicRoom {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message.t === 'sync' || message.t === 'welcome') return message.room;
    }
    throw new Error('this client has never been sent a room');
  }

  async welcome() {
    return this.waitFor<Extract<ServerMessage, { t: 'welcome' }>>(
      (m) => m.t === 'welcome',
      'welcome',
    );
  }

  async settled(predicate: (room: PublicRoom) => boolean, label: string, timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (predicate(this.room())) return this.room();
      } catch {
        // No snapshot yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for room to be ${label}`);
  }
}

/** Seats two players and starts a game. */
async function startedGame() {
  const code = await createRoom();
  const host = await Client.open(code, { name: 'Maya', avatar: '2' });
  const guest = await Client.open(code, { name: 'Sam', avatar: '5' });
  const hostWelcome = await host.welcome();
  const guestWelcome = await guest.welcome();

  host.send({ t: 'ready', ready: true });
  guest.send({ t: 'ready', ready: true });
  await host.settled((room) => room.players.every((p) => p.ready), 'both ready');

  host.send({ t: 'start' });
  await host.settled((room) => room.phase === 'playing', 'playing');
  await guest.settled((room) => room.phase === 'playing', 'playing');

  return { code, host, guest, hostWelcome, guestWelcome };
}

describe('the room API', () => {
  it('creates a room and reports it back', async () => {
    const code = await createRoom();
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${code}`);
    const info = (await response.json()) as { exists: boolean; players: number; started: boolean };
    expect(info.exists).toBe(true);
    expect(info.players).toBe(0);
    expect(info.started).toBe(false);
  });

  it('does not invent rooms that were never created', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/ZZZZZZ`);
    const info = (await response.json()) as { exists: boolean };
    expect(info.exists).toBe(false);
  });

  it('rejects a malformed code without touching a Durable Object', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/nope`);
    const info = (await response.json()) as { exists: boolean; reason: string };
    expect(info.exists).toBe(false);
    expect(info.reason).toBe('bad_code');
  });

  it('404s unknown API routes and refuses a non-upgrade on /ws', async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/nonsense`)).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/ws?room=ABCDEF`)).status).toBe(426);
  });

  it('sends anything outside the mount point back to it', async () => {
    // parebaik.com/* is a different Worker; only /uno is ours. A request that
    // arrives without the prefix — the workers.dev preview, an old bookmark —
    // is pointed at the same path under /uno rather than answered.
    const response = await SELF.fetch(`${HOST}/api/rooms`, {
      method: 'POST',
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`${HOST}${BASE_PATH}/api/rooms`);
  });
});

describe('joining', () => {
  it('seats players, names the first one host, and tells everyone', async () => {
    const code = await createRoom();
    const host = await Client.open(code, { name: 'Maya', avatar: '1' });
    const hostWelcome = await host.welcome();
    expect(hostWelcome.spectator).toBe(false);
    expect(hostWelcome.token).toBeTruthy();

    const guest = await Client.open(code, { name: 'Sam', avatar: '4' });
    await guest.welcome();

    const room = await host.settled((r) => r.players.length === 2, 'two players');
    expect(room.hostId).toBe(hostWelcome.youId);
    expect(room.players.map((p) => p.name)).toEqual(['Maya', 'Sam']);
  });

  it('turns a duplicate name into something unique', async () => {
    const code = await createRoom();
    const first = await Client.open(code, { name: 'Maya' });
    await first.welcome();
    const second = await Client.open(code, { name: 'Maya' });
    await second.welcome();
    const room = await first.settled((r) => r.players.length === 2, 'two players');
    expect(room.players.map((p) => p.name)).toEqual(['Maya', 'Maya 2']);
  });

  it('creates a new room on the way in when asked, and seats its creator as host', async () => {
    const host = await Client.open('CRTEAB', { name: 'Maya', create: '1' });
    const welcome = await host.welcome();
    expect(welcome.spectator).toBe(false);
    expect(welcome.room.code).toBe('CRTEAB');
    expect(welcome.room.hostId).toBe(welcome.youId);

    const info = await SELF.fetch(`${ORIGIN}/api/rooms/CRTEAB`);
    expect(((await info.json()) as { exists: boolean }).exists).toBe(true);
  });

  it('joins an existing room as usual when asked to create it', async () => {
    const code = await createRoom();
    const host = await Client.open(code, { name: 'Maya' });
    const hostWelcome = await host.welcome();
    const guest = await Client.open(code, { name: 'Sam', create: '1' });
    await guest.welcome();
    const room = await host.settled((r) => r.players.length === 2, 'two players');
    expect(room.hostId).toBe(hostWelcome.youId);
  });

  it('refuses a room code that does not exist, with a message rather than a silent drop', async () => {
    const client = await Client.open('QQQQQQ');
    const error = await client.waitFor<Extract<ServerMessage, { t: 'error' }>>(
      (m) => m.t === 'error',
      'error',
    );
    expect(error.code).toBe('no_such_room');
    expect(error.fatal).toBe(true);
  });
});

describe('playing over the wire', () => {
  it('deals a round and puts the turn on somebody', async () => {
    const { host, guest, hostWelcome } = await startedGame();
    const room = host.room();
    expect(room.round).toBe(1);
    expect(room.discardTop).not.toBeNull();
    expect(room.drawCount).toBe(108 - 14 - 1 - (room.players[0].handCount - 7) - (room.players[1].handCount - 7));
    expect(room.players.every((p) => p.handCount >= 7)).toBe(true);

    const you = room.players.find((p) => p.id === hostWelcome.youId);
    expect(you?.hand?.length).toBe(you?.handCount);
    void guest;
  });

  it('never sends one player another player’s hand', async () => {
    const { host, guest, hostWelcome, guestWelcome } = await startedGame();

    const hostView = host.room();
    const guestView = guest.room();

    const hostHand = hostView.players.find((p) => p.id === hostWelcome.youId)?.hand ?? [];
    const guestHand = guestView.players.find((p) => p.id === guestWelcome.youId)?.hand ?? [];
    expect(hostHand.length).toBeGreaterThan(0);
    expect(guestHand.length).toBeGreaterThan(0);

    // Neither hand appears anywhere in the other player's traffic.
    const hostTraffic = JSON.stringify(host.messages);
    const guestTraffic = JSON.stringify(guest.messages);
    for (const card of guestHand) {
      expect(hostTraffic, `host saw ${card.id}`).not.toContain(card.id);
    }
    for (const card of hostHand) {
      expect(guestTraffic, `guest saw ${card.id}`).not.toContain(card.id);
    }
    // And the draw pile is a count, never a list.
    expect(hostTraffic).not.toContain('drawPile');
  });

  it('rejects an illegal move, privately, and leaves the game alone', async () => {
    const { host, guest } = await startedGame();
    const before = host.room();
    const onTurn = before.players[before.turn];

    // Whoever is *not* on turn tries to play something.
    const offTurn = onTurn.id === host.room().youId ? guest : host;
    offTurn.send({ t: 'intent', intent: { type: 'PLAY_CARD', cardId: 'r5-0' } });

    const error = await offTurn.waitFor<Extract<ServerMessage, { t: 'error' }>>(
      (m) => m.t === 'error',
      'rejection',
    );
    expect(['not_your_turn', 'no_such_card']).toContain(error.code);
    // The other player was never told about it.
    const other = offTurn === host ? guest : host;
    expect(other.messages.some((m) => m.t === 'error')).toBe(false);
    expect(host.room().discardCount).toBe(before.discardCount);
  });

  it('accepts a legal move and tells both players about it', async () => {
    const { host, guest } = await startedGame();
    const room = host.room();
    const onTurnId = room.players[room.turn].id;
    const actor = onTurnId === room.youId ? host : guest;
    const view = actor.room();
    const playable = view.moves.playable;

    if (playable.length === 0) {
      actor.send({ t: 'intent', intent: { type: 'DRAW' } });
      await actor.settled((r) => r.drawCount < view.drawCount, 'a card drawn');
      return;
    }

    actor.send({ t: 'intent', intent: { type: 'PLAY_CARD', cardId: playable[0] } });
    await host.settled((r) => r.discardCount === room.discardCount + 1, 'card on the pile');
    await guest.settled((r) => r.discardCount === room.discardCount + 1, 'card on the pile');
    expect(host.room().discardTop?.id).toBe(playable[0]);
  });

  it('only lets the host change the rules or start', async () => {
    const code = await createRoom();
    const host = await Client.open(code, { name: 'Maya' });
    const guest = await Client.open(code, { name: 'Sam' });
    await host.welcome();
    await guest.welcome();
    await host.settled((r) => r.players.length === 2, 'two players');

    guest.send({ t: 'rules', patch: { stacking: true } });
    const error = await guest.waitFor<Extract<ServerMessage, { t: 'error' }>>(
      (m) => m.t === 'error',
      'not_host',
    );
    expect(error.code).toBe('not_host');
    expect(host.room().rules.stacking).toBe(false);

    host.send({ t: 'rules', patch: { stacking: true, jumpIn: true } });
    const room = await host.settled((r) => r.rules.stacking, 'stacking on');
    expect(room.rules.jumpIn).toBe(true);
  });
});

describe('bots', () => {
  it('are added by the host and take their turn on an alarm', async () => {
    const code = await createRoom();
    const host = await Client.open(code, { name: 'Maya' });
    await host.welcome();

    host.send({ t: 'addBot', level: 'hard' });
    await host.settled((r) => r.players.length === 2, 'bot seated');
    expect(host.room().players[1].isBot).toBe(true);

    host.send({ t: 'ready', ready: true });
    host.send({ t: 'start' });
    await host.settled((r) => r.phase === 'playing', 'playing');
    const botId = host.room().players.find((p) => p.isBot)?.id as string;

    // Keep taking our own turns; the bot's turns are nobody's job but the
    // alarm's. Waiting on an event from the bot's seat proves it moved itself.
    const botMoved = host.waitFor(
      (m) =>
        m.t === 'sync' &&
        m.events.some((e) => (e.t === 'played' || e.t === 'drew') && e.playerId === botId),
      'the bot to take its turn',
      15_000,
    );

    for (let i = 0; i < 25; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const room = host.room();
      if (room.phase !== 'playing') break;
      const moves = room.moves;
      if (moves.mustChooseColor) {
        host.send({ t: 'intent', intent: { type: 'CHOOSE_COLOR', color: 'red' } });
      } else if (moves.mustChooseSwapTarget) {
        host.send({ t: 'intent', intent: { type: 'CHOOSE_PLAYER', playerId: botId } });
      } else if (moves.playable.length > 0) {
        host.send({ t: 'intent', intent: { type: 'PLAY_CARD', cardId: moves.playable[0] } });
      } else if (moves.canPass) {
        host.send({ t: 'intent', intent: { type: 'PASS' } });
      } else if (moves.canDraw) {
        host.send({ t: 'intent', intent: { type: 'DRAW' } });
      }
    }

    await botMoved;
    expect(host.messages.some((m) => m.t === 'error' && m.fatal)).toBe(false);
  }, 30_000);
});

describe('reconnecting and watching', () => {
  it('gives a returning player their seat and their hand back', async () => {
    const { code, host, guest, hostWelcome } = await startedGame();
    const before = host.room().players.find((p) => p.id === hostWelcome.youId);
    const handBefore = (before?.hand ?? []).map((c) => c.id);
    expect(handBefore.length).toBeGreaterThan(0);

    host.close();
    const returning = await Client.open(code, { token: hostWelcome.token });
    const welcome = await returning.welcome();

    expect(welcome.youId).toBe(hostWelcome.youId);
    expect(welcome.spectator).toBe(false);
    const seat = welcome.room.players.find((p) => p.id === hostWelcome.youId);
    expect(seat?.hand?.map((c) => c.id)).toEqual(handBefore);
    expect(seat?.connected).toBe(true);
    void guest;
  });

  it('lets a latecomer watch, with every hand hidden', async () => {
    const { code, hostWelcome } = await startedGame();
    const watcher = await Client.open(code, { name: 'Nosy' });
    const welcome = await watcher.welcome();

    expect(welcome.spectator).toBe(true);
    expect(welcome.youId).toBeNull();
    expect(welcome.room.players.every((p) => p.hand === undefined)).toBe(true);
    expect(welcome.room.moves.playable).toEqual([]);
    void hostWelcome;
  });

  it('will not take an intent from a spectator', async () => {
    const { code } = await startedGame();
    const watcher = await Client.open(code, { name: 'Nosy' });
    await watcher.welcome();

    watcher.send({ t: 'intent', intent: { type: 'DRAW' } });
    const error = await watcher.waitFor<Extract<ServerMessage, { t: 'error' }>>(
      (m) => m.t === 'error',
      'spectating',
    );
    expect(error.code).toBe('spectating');
  });
});

describe('chat', () => {
  it('carries a message to everyone and keeps it in the history', async () => {
    const code = await createRoom();
    const host = await Client.open(code, { name: 'Maya' });
    const guest = await Client.open(code, { name: 'Sam' });
    await host.welcome();
    await guest.welcome();

    host.send({ t: 'chat', text: 'anyone got a blue?' });
    const update = await guest.waitFor<Extract<ServerMessage, { t: 'chat' }>>(
      (m) => m.t === 'chat' && m.messages.some((c) => c.text === 'anyone got a blue?'),
      'the chat line',
    );
    expect(update).not.toHaveProperty('room');

    const latecomer = await Client.open(code, { name: 'Ann' });
    const welcome = await latecomer.welcome();
    expect(welcome.chat.some((c) => c.text === 'anyone got a blue?')).toBe(true);
  });

  it('narrates the game into the log', async () => {
    const { host } = await startedGame();
    const welcome = await host.welcome();
    void welcome;
    const gotNarration = await host.waitFor(
      (m) => m.t === 'sync' && (m.chat ?? []).some((c) => c.kind === 'system' && c.text.includes('Round 1')),
      'the round announcement',
    );
    expect(gotNarration.t).toBe('sync');
  });

  it('drops empty chat and clamps a very long one', async () => {
    const code = await createRoom();
    const host = await Client.open(code, { name: 'Maya' });
    await host.welcome();

    host.send({ t: 'chat', text: '   ' });
    host.send({ t: 'chat', text: 'x'.repeat(400) });
    const update = await host.waitFor<Extract<ServerMessage, { t: 'chat' }>>(
      (m) => m.t === 'chat' && m.messages.some((c) => c.kind === 'chat'),
      'the long message',
    );
    const line = update.messages.find((c) => c.kind === 'chat');
    expect(line?.text).toHaveLength(160);
    expect(host.messages.filter((m) => m.t === 'chat' && m.messages.some((c) => c.kind === 'chat'))).toHaveLength(1);
  });

  it('keeps the full sync shape for browsers already open during a deploy', async () => {
    const code = await createRoom();
    const legacy = await Client.open(code, { name: 'Maya', v: '1' });
    await legacy.welcome();

    legacy.send({ t: 'chat', text: 'still here' });
    const update = await legacy.waitFor<Extract<ServerMessage, { t: 'sync' }>>(
      (m) => m.t === 'sync' && (m.chat ?? []).some((c) => c.text === 'still here'),
      'the legacy chat frame',
    );
    expect(update.room.code).toBe(code);
  });
});

describe('storage', () => {
  /** Records every storage write the room makes from here on. */
  async function recordWrites(code: string): Promise<string[]> {
    const writes: string[] = [];
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    await runInDurableObject(stub, (_room, state) => {
      const storage = state.storage as unknown as Record<string, (...args: unknown[]) => unknown>;
      for (const method of ['put', 'delete', 'deleteAll', 'setAlarm', 'deleteAlarm']) {
        const original = storage[method].bind(storage);
        storage[method] = (...args: unknown[]) => {
          writes.push(method);
          return original(...args);
        };
      }
    });
    return writes;
  }

  it('writes a move once, without rewriting an alarm that did not change', async () => {
    const { code, host, guest } = await startedGame();
    const writes = await recordWrites(code);
    const room = host.room();
    const actor = room.players[room.turn].id === room.youId ? host : guest;
    const view = actor.room();

    if (view.moves.playable.length > 0) {
      actor.send({ t: 'intent', intent: { type: 'PLAY_CARD', cardId: view.moves.playable[0] } });
      await host.settled((r) => r.discardCount === room.discardCount + 1, 'card on the pile');
    } else {
      actor.send({ t: 'intent', intent: { type: 'DRAW' } });
      await host.settled((r) => r.drawCount < room.drawCount, 'a card drawn');
    }

    expect(writes).toEqual(['put']);
  });
});
