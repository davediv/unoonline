/**
 * The UNO rules engine.
 *
 * Pure and dependency-free: every function takes state in and returns new
 * state out. No timers, no I/O, no `Math.random`, no Node built-ins. The
 * Durable Object owns the clock and the randomness and passes them in via
 * `EngineCtx`; the test suite passes in a seeded RNG and a fake clock.
 *
 * Nothing here ever mutates its arguments — `applyIntent` clones first and
 * mutates the clone, so a rejected intent leaves the caller's state untouched.
 */

import type {
  Card,
  Color,
  GameEvent,
  Intent,
  LegalMoves,
  Player,
  PublicDrawStack,
  PublicPending,
  PublicPlayer,
  PublicRoom,
  RoomState,
  RoundResult,
} from './types';
import { COLORS, NO_MOVES } from './types';
import { DECK_SIZE, createDeck, handPoints, isWild, matches, sameFace, shuffle } from './deck';
import type { Rng } from './rng';

/** Cards dealt to each player at the start of a round. */
export const HAND_SIZE = 7;

/** How long a player has to call UNO before the window closes. */
export const UNO_WINDOW_MS = 3000;

/** Minimum / maximum seats at a table. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export interface EngineCtx {
  rng: Rng;
  /** Epoch milliseconds. */
  now: number;
}

export interface EngineOk {
  ok: true;
  state: RoomState;
  events: GameEvent[];
}

export interface EngineFail {
  ok: false;
  code: string;
  message: string;
}

export type EngineResult = EngineOk | EngineFail;

function fail(code: string, message: string): EngineFail {
  return { ok: false, code, message };
}

function clone(state: RoomState): RoomState {
  return structuredClone(state);
}

/* ------------------------------------------------------------------ *
 * Small state helpers (operate on a mutable draft)
 * ------------------------------------------------------------------ */

export function topCard(s: RoomState): Card | null {
  return s.discard.length > 0 ? s.discard[s.discard.length - 1] : null;
}

export function playerIndex(s: RoomState, playerId: string): number {
  return s.players.findIndex((p) => p.id === playerId);
}

export function findPlayer(s: RoomState, playerId: string): Player | undefined {
  return s.players.find((p) => p.id === playerId);
}

/** The seat `n` places from `from` in the current direction of play. */
function seat(s: RoomState, from: number, n = 1): number {
  const len = s.players.length;
  return (((from + n * s.direction) % len) + len) % len;
}

/**
 * Whoever the clock is currently on: the player who owes a choice, else the
 * player whose turn it is.
 */
export function actorId(s: RoomState): string | null {
  if (s.phase !== 'playing') return null;
  if (s.pending) return s.pending.playerId;
  return s.players[s.turn]?.id ?? null;
}

function startClock(s: RoomState, ctx: EngineCtx): number | null {
  s.turnDeadline = s.rules.turnTimer > 0 ? ctx.now + s.rules.turnTimer * 1000 : null;
  return s.turnDeadline;
}

/**
 * Move play on by `seats` places. `seats === 2` means the player in between
 * loses their turn, which is announced.
 */
function advance(s: RoomState, seats: number, ctx: EngineCtx, ev: GameEvent[]): void {
  if (seats === 2 && s.players.length >= 2) {
    ev.push({ t: 'skipped', playerId: s.players[seat(s, s.turn, 1)].id });
  }
  s.turn = seat(s, s.turn, seats);
  startClock(s, ctx);
  ev.push({ t: 'turnStart', playerId: s.players[s.turn].id, deadline: s.turnDeadline });
}

/**
 * Deck exhaustion: keep the top discard, shuffle everything under it back
 * into the draw pile. If there is nothing to recycle the pile stays empty and
 * players simply draw nothing.
 */
function reshuffleDiscard(s: RoomState, ctx: EngineCtx, ev: GameEvent[]): void {
  if (s.discard.length <= 1) return;
  const top = s.discard[s.discard.length - 1];
  const recycled = s.discard.slice(0, -1);
  s.drawPile = shuffle(recycled, ctx.rng);
  s.discard = [top];
  ev.push({ t: 'reshuffled', count: s.drawPile.length });
}

function drawOne(s: RoomState, ctx: EngineCtx, ev: GameEvent[]): Card | null {
  if (s.drawPile.length === 0) reshuffleDiscard(s, ctx, ev);
  return s.drawPile.pop() ?? null;
}

/** Deals up to `count` cards. Returns how many were actually available. */
function dealTo(s: RoomState, index: number, count: number, ctx: EngineCtx, ev: GameEvent[]): number {
  let dealt = 0;
  for (let i = 0; i < count; i++) {
    const card = drawOne(s, ctx, ev);
    if (!card) break;
    s.players[index].hand.push(card);
    dealt++;
  }
  return dealt;
}

/** Does this hand hold a card of `color`, ignoring one card id? */
function holdsColor(hand: readonly Card[], color: Color | null, exceptId?: string): boolean {
  if (color === null) return false;
  return hand.some((c) => c.color === color && c.id !== exceptId);
}

/* ------------------------------------------------------------------ *
 * Playability
 * ------------------------------------------------------------------ */

/**
 * May `card` be played by `player` right now, ignoring turn order?
 *
 * Wild Draw Four is the interesting one. The official restriction is that you
 * may only play it holding no card of the active colour — but the challenge
 * rule exists precisely so that players *can* break that restriction and risk
 * being caught. So:
 *
 *   challenge ON  -> the play is allowed; a challenge adjudicates the bluff.
 *   challenge OFF -> nothing would ever adjudicate it, so it is enforced here.
 */
export function canPlay(s: RoomState, player: Player, card: Card): boolean {
  const top = topCard(s);
  if (!top) return false;
  if (card.kind === 'wild4' && !s.rules.challenge) {
    return !holdsColor(player.hand, s.activeColor, card.id);
  }
  return matches(card, top, s.activeColor);
}

/* ------------------------------------------------------------------ *
 * Round setup
 * ------------------------------------------------------------------ */

/**
 * Deals a fresh round and applies the effect of the flipped starting card.
 *
 * `startIndex` is the seat that would play first; the starting card may skip
 * them, reverse past them or hand them a colour choice.
 */
export function startRound(state: RoomState, startIndex: number, ctx: EngineCtx): EngineOk {
  const s = clone(state);
  const ev: GameEvent[] = [];

  s.phase = 'playing';
  s.result = null;
  s.matchWinnerId = null;
  s.pending = null;
  s.drawStack = null;
  s.uno = null;
  s.lastPlayerId = null;
  s.direction = 1;
  s.passRecord = [];
  s.turn = ((startIndex % s.players.length) + s.players.length) % s.players.length;

  for (const p of s.players) {
    p.hand = [];
    p.roundPoints = 0;
    p.ready = false;
  }

  let deck = shuffle(createDeck(), ctx.rng);

  // Deal one card at a time around the table, the way you actually deal.
  for (let round = 0; round < HAND_SIZE; round++) {
    for (let i = 0; i < s.players.length; i++) {
      const index = (s.turn + i) % s.players.length;
      s.players[index].hand.push(deck.pop() as Card);
    }
  }

  // Flip the starting card. A Wild Draw Four goes back in and we reshuffle.
  let top = deck.pop() as Card;
  while (top.kind === 'wild4') {
    deck.push(top);
    deck = shuffle(deck, ctx.rng);
    top = deck.pop() as Card;
  }

  s.drawPile = deck;
  s.discard = [top];
  s.activeColor = top.color;
  s.round = state.phase === 'lobby' ? 1 : state.round;

  ev.push({ t: 'roundStart', round: s.round, startingId: s.players[s.turn].id, topCard: top });

  switch (top.kind) {
    case 'wild':
      // The first player picks the colour, then plays normally.
      s.pending = {
        kind: 'color',
        playerId: s.players[s.turn].id,
        source: 'initial',
        hadColorMatch: false,
        colorBefore: null,
        declaredUno: false,
      };
      startClock(s, ctx);
      ev.push({ t: 'turnStart', playerId: s.players[s.turn].id, deadline: s.turnDeadline });
      break;

    case 'skip':
      // The player who would have gone first is the one who loses their turn.
      ev.push({ t: 'skipped', playerId: s.players[s.turn].id });
      advance(s, 1, ctx, ev);
      break;

    case 'reverse':
      // Direction flips and play starts the other way around. With two
      // players that lands on the other seat, which is the same thing as the
      // Skip behaviour Reverse has in a two-player game.
      s.direction = -1;
      ev.push({ t: 'reversed', direction: s.direction });
      advance(s, 1, ctx, ev);
      break;

    case 'draw2': {
      // The first player takes the two and forfeits their turn.
      const victim = s.players[s.turn];
      const dealt = dealTo(s, s.turn, 2, ctx, ev);
      ev.push({ t: 'penalty', playerId: victim.id, count: dealt, reason: 'drawStack' });
      ev.push({ t: 'skipped', playerId: victim.id });
      advance(s, 1, ctx, ev);
      break;
    }

    default:
      startClock(s, ctx);
      ev.push({ t: 'turnStart', playerId: s.players[s.turn].id, deadline: s.turnDeadline });
      break;
  }

  return { ok: true, state: s, events: ev };
}

/** Lobby -> first round. Resets match scores. */
export function startMatch(state: RoomState, ctx: EngineCtx): EngineResult {
  if (state.phase !== 'lobby') return fail('already_started', 'The game has already started.');
  if (state.players.length < MIN_PLAYERS) return fail('not_enough_players', 'You need at least 2 players.');
  const base = clone(state);
  base.round = 1;
  for (const p of base.players) {
    p.score = 0;
    p.roundPoints = 0;
  }
  return startRound(base, 0, ctx);
}

/** Round over -> next round. The seat after the previous winner starts. */
export function startNextRound(state: RoomState, ctx: EngineCtx): EngineResult {
  if (state.phase !== 'roundOver') return fail('not_between_rounds', 'There is no round to advance from.');
  const base = clone(state);
  base.round = state.round + 1;
  const winner = state.result ? playerIndex(state, state.result.winnerId) : -1;
  const startIndex = winner >= 0 ? (winner + 1) % base.players.length : 0;
  return startRound(base, startIndex, ctx);
}

/* ------------------------------------------------------------------ *
 * Round end & scoring
 * ------------------------------------------------------------------ */

function endRound(s: RoomState, winnerIndex: number, ev: GameEvent[]): void {
  const winner = s.players[winnerIndex];
  const hands: Record<string, Card[]> = {};
  const points: Record<string, number> = {};
  const totals: Record<string, number> = {};
  let scored = 0;

  for (const p of s.players) {
    hands[p.id] = p.hand.slice();
    points[p.id] = handPoints(p.hand);
    p.roundPoints = 0;
    if (p.id !== winner.id) scored += points[p.id];
  }

  winner.score += scored;
  winner.roundPoints = scored;
  for (const p of s.players) totals[p.id] = p.score;

  const result: RoundResult = { winnerId: winner.id, points: scored, hands, handPoints: points, totals };
  s.result = result;
  s.pending = null;
  s.drawStack = null;
  s.uno = null;
  s.turnDeadline = null;
  for (const p of s.players) p.ready = false;
  ev.push({ t: 'roundOver', result });

  if (s.rules.matchMode === 'single' || winner.score >= s.rules.targetScore) {
    s.phase = 'matchOver';
    s.matchWinnerId = winner.id;
    ev.push({ t: 'matchOver', winnerId: winner.id });
  } else {
    s.phase = 'roundOver';
  }
}

/* ------------------------------------------------------------------ *
 * Intents
 * ------------------------------------------------------------------ */

export function applyIntent(state: RoomState, playerId: string, intent: Intent, ctx: EngineCtx): EngineResult {
  if (state.phase !== 'playing') return fail('not_playing', 'The game is not running right now.');
  if (playerIndex(state, playerId) < 0) return fail('not_seated', 'You are watching, not playing.');

  const s = clone(state);
  const ev: GameEvent[] = [];
  const problem = dispatch(s, playerId, intent, ctx, ev);
  if (problem) return problem;
  return { ok: true, state: s, events: ev };
}

function dispatch(
  s: RoomState,
  playerId: string,
  intent: Intent,
  ctx: EngineCtx,
  ev: GameEvent[],
): EngineFail | null {
  switch (intent.type) {
    case 'PLAY_CARD':
      return handlePlay(s, playerId, intent.cardId, intent.declareUno === true, ctx, ev);
    case 'DRAW':
      return handleDraw(s, playerId, ctx, ev);
    case 'PASS':
      return handlePass(s, playerId, ctx, ev);
    case 'CHOOSE_COLOR':
      return handleChooseColor(s, playerId, intent.color, ctx, ev);
    case 'CHOOSE_PLAYER':
      return handleChoosePlayer(s, playerId, intent.playerId, ctx, ev);
    case 'CALL_UNO':
      return handleCallUno(s, playerId, ctx, ev);
    case 'CATCH_UNO':
      return handleCatchUno(s, playerId, intent.targetId, ctx, ev);
    case 'CHALLENGE':
      return handleChallenge(s, playerId, ctx, ev);
  }
}

function handlePlay(
  s: RoomState,
  playerId: string,
  cardId: string,
  declareUno: boolean,
  ctx: EngineCtx,
  ev: GameEvent[],
): EngineFail | null {
  const index = playerIndex(s, playerId);
  const player = s.players[index];
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return fail('no_such_card', 'That card is not in your hand.');
  const top = topCard(s);
  if (!top) return fail('no_discard', 'There is nothing to play on.');

  if (s.pending) {
    if (s.pending.kind !== 'drawn') {
      return fail('resolve_first', 'Finish the current choice first.');
    }
    if (s.pending.playerId !== playerId) return fail('not_your_turn', "It is not your turn.");
    if (s.pending.cardId !== cardId) {
      return fail('must_play_drawn', 'You may only play the card you just drew.');
    }
  }

  // Out-of-turn play is only ever a jump-in.
  let jumpIn = false;
  if (index !== s.turn) {
    if (!s.rules.jumpIn) return fail('not_your_turn', 'It is not your turn.');
    if (s.pending || s.drawStack) return fail('not_your_turn', 'It is not your turn.');
    if (s.lastPlayerId === playerId) return fail('no_self_jump', 'You cannot jump in on your own card.');
    if (isWild(top)) return fail('no_wild_jump', 'You cannot jump in on a wild.');
    if (!sameFace(card, top)) return fail('not_exact_match', 'Jumping in needs an exact match.');
    jumpIn = true;
  }

  if (s.drawStack) {
    if (!s.rules.stacking) return fail('must_draw', `You must draw ${s.drawStack.count}.`);
    if (card.kind !== s.drawStack.kind) {
      return fail('cannot_stack', s.drawStack.kind === 'draw2' ? 'Only a Draw Two stacks here.' : 'Only a Wild Draw Four stacks here.');
    }
  } else if (!canPlay(s, player, card)) {
    return fail('illegal_card', 'That card cannot be played right now.');
  }

  if (jumpIn) s.turn = index;
  player.hand = player.hand.filter((c) => c.id !== cardId);
  s.discard.push(card);
  s.lastPlayerId = playerId;
  s.pending = null;
  ev.push({ t: 'played', playerId, card, jumpIn });

  return resolvePlay(s, index, card, declareUno, ctx, ev);
}

/**
 * Applies the effect of a card that has just landed on the discard pile.
 * Returns `null` on success — plays never fail this late.
 */
function resolvePlay(
  s: RoomState,
  index: number,
  card: Card,
  declaredUno: boolean,
  ctx: EngineCtx,
  ev: GameEvent[],
): EngineFail | null {
  const player = s.players[index];
  const colorBefore = s.activeColor;
  if (card.color !== null) s.activeColor = card.color;

  // Going out ends the round immediately — no colour choice, no swap.
  if (player.hand.length === 0) {
    // Official rule: a Draw Two or Wild Draw Four played as the very last
    // card still makes the next player draw, and those cards are scored.
    if (card.kind === 'draw2' || card.kind === 'wild4') {
      const victim = seat(s, index, 1);
      const owed = card.kind === 'draw2' ? 2 : 4;
      const dealt = dealTo(s, victim, owed, ctx, ev);
      ev.push({ t: 'penalty', playerId: s.players[victim].id, count: dealt, reason: 'drawStack' });
    }
    endRound(s, index, ev);
    return null;
  }

  switch (card.kind) {
    case 'number': {
      if (s.rules.sevenZero && card.digit === 7) {
        if (s.players.length === 2) {
          swapHands(s, index, seat(s, index, 1), ev);
        } else {
          // They pick who to swap with; the turn waits for that choice.
          s.pending = { kind: 'swap', playerId: player.id, declaredUno };
          return null;
        }
      } else if (s.rules.sevenZero && card.digit === 0) {
        rotateHands(s, ev);
      }
      concludeTurn(s, index, 1, declaredUno, ctx, ev);
      break;
    }

    case 'skip':
      concludeTurn(s, index, 2, declaredUno, ctx, ev);
      break;

    case 'reverse': {
      s.direction = s.direction === 1 ? -1 : 1;
      ev.push({ t: 'reversed', direction: s.direction });
      // With exactly two players Reverse acts as a Skip: play comes straight
      // back round to the player who used it.
      concludeTurn(s, index, s.players.length === 2 ? 2 : 1, declaredUno, ctx, ev);
      break;
    }

    case 'draw2': {
      if (s.rules.stacking) {
        s.drawStack = {
          count: (s.drawStack?.count ?? 0) + 2,
          kind: 'draw2',
          playedBy: player.id,
          challengeable: false,
          hadColorMatch: false,
          colorBefore: null,
        };
        concludeTurn(s, index, 1, declaredUno, ctx, ev);
      } else {
        const victim = seat(s, index, 1);
        const dealt = dealTo(s, victim, 2, ctx, ev);
        ev.push({ t: 'penalty', playerId: s.players[victim].id, count: dealt, reason: 'drawStack' });
        concludeTurn(s, index, 2, declaredUno, ctx, ev);
      }
      break;
    }

    case 'wild':
    case 'wild4':
      // The turn does not move until a colour is named.
      s.pending = {
        kind: 'color',
        playerId: player.id,
        source: card.kind,
        hadColorMatch: card.kind === 'wild4' ? holdsColor(player.hand, colorBefore) : false,
        colorBefore,
        declaredUno,
      };
      return null;
  }

  return null;
}

/** Opens the UNO window if needed, then moves play on. */
function concludeTurn(
  s: RoomState,
  index: number,
  seats: number,
  declaredUno: boolean,
  ctx: EngineCtx,
  ev: GameEvent[],
): void {
  const player = s.players[index];
  if (player.hand.length === 1) {
    s.uno = {
      playerId: player.id,
      deadline: ctx.now + UNO_WINDOW_MS,
      called: declaredUno,
      accusers: [],
    };
    if (declaredUno) ev.push({ t: 'unoCalled', playerId: player.id });
  }
  advance(s, seats, ctx, ev);
}

function swapHands(s: RoomState, a: number, b: number, ev: GameEvent[]): void {
  const tmp = s.players[a].hand;
  s.players[a].hand = s.players[b].hand;
  s.players[b].hand = tmp;
  ev.push({ t: 'handsSwapped', aId: s.players[a].id, bId: s.players[b].id });
}

/** Every hand moves one seat in the current direction of play. */
function rotateHands(s: RoomState, ev: GameEvent[]): void {
  const hands = s.players.map((p) => p.hand);
  const len = s.players.length;
  for (let i = 0; i < len; i++) {
    const target = (((i + s.direction) % len) + len) % len;
    s.players[target].hand = hands[i];
  }
  ev.push({ t: 'handsRotated', direction: s.direction });
}

function handleChooseColor(
  s: RoomState,
  playerId: string,
  color: Color,
  ctx: EngineCtx,
  ev: GameEvent[],
): EngineFail | null {
  const pending = s.pending;
  if (!pending || pending.kind !== 'color') return fail('nothing_to_choose', 'No colour is waiting to be chosen.');
  if (pending.playerId !== playerId) return fail('not_your_choice', 'That is not your choice to make.');
  if (!COLORS.includes(color)) return fail('bad_color', 'That is not a colour.');

  const { source, hadColorMatch, colorBefore, declaredUno } = pending;
  const index = playerIndex(s, playerId);
  s.activeColor = color;
  s.pending = null;
  ev.push({ t: 'colorChosen', playerId, color });

  if (source === 'initial') {
    // The first player named the colour and now takes their turn, with a
    // fresh clock — choosing should not eat into it.
    startClock(s, ctx);
    ev.push({ t: 'turnStart', playerId, deadline: s.turnDeadline });
    return null;
  }

  if (source === 'wild') {
    concludeTurn(s, index, 1, declaredUno, ctx, ev);
    return null;
  }

  // Wild Draw Four.
  if (s.rules.challenge || s.rules.stacking) {
    const existing = s.drawStack;
    // Hand the target a decision: take the cards, stack, or challenge.
    // A Wild Draw Four played *into* a stack is never challengeable — the
    // stacking rule let them play it, so there is no bluff to punish.
    s.drawStack = {
      count: (existing?.count ?? 0) + 4,
      kind: 'wild4',
      playedBy: playerId,
      challengeable: s.rules.challenge && existing === null,
      hadColorMatch,
      colorBefore,
    };
    concludeTurn(s, index, 1, declaredUno, ctx, ev);
  } else {
    const victim = seat(s, index, 1);
    const dealt = dealTo(s, victim, 4, ctx, ev);
    ev.push({ t: 'penalty', playerId: s.players[victim].id, count: dealt, reason: 'drawStack' });
    concludeTurn(s, index, 2, declaredUno, ctx, ev);
  }
  return null;
}

function handleChoosePlayer(
  s: RoomState,
  playerId: string,
  targetId: string,
  ctx: EngineCtx,
  ev: GameEvent[],
): EngineFail | null {
  const pending = s.pending;
  if (!pending || pending.kind !== 'swap') return fail('nothing_to_choose', 'No swap is waiting.');
  if (pending.playerId !== playerId) return fail('not_your_choice', 'That is not your choice to make.');
  if (targetId === playerId) return fail('bad_target', 'Pick somebody else.');
  const target = playerIndex(s, targetId);
  if (target < 0) return fail('bad_target', 'That player is not at the table.');

  const index = playerIndex(s, playerId);
  s.pending = null;
  swapHands(s, index, target, ev);
  concludeTurn(s, index, 1, pending.declaredUno, ctx, ev);
  return null;
}

function handleDraw(s: RoomState, playerId: string, ctx: EngineCtx, ev: GameEvent[]): EngineFail | null {
  const index = playerIndex(s, playerId);
  if (s.pending) {
    if (s.pending.kind === 'drawn' && s.pending.playerId === playerId) {
      return fail('already_drew', 'Play the card you drew, or pass.');
    }
    return fail('resolve_first', 'Finish the current choice first.');
  }
  if (index !== s.turn) return fail('not_your_turn', 'It is not your turn.');

  // Taking an unresolved Draw Two / Wild Draw Four stack on the chin.
  if (s.drawStack) {
    const owed = s.drawStack.count;
    const dealt = dealTo(s, index, owed, ctx, ev);
    s.drawStack = null;
    ev.push({ t: 'penalty', playerId, count: dealt, reason: 'drawStack' });
    advance(s, 1, ctx, ev);
    return null;
  }

  // Drawing means you had nothing in the active colour — public information,
  // and the hard bot pays attention to it.
  if (s.activeColor && !s.passRecord.some((record) => record.playerId === playerId && record.color === s.activeColor)) {
    s.passRecord.push({ playerId, color: s.activeColor });
  }

  const player = s.players[index];
  const limit = s.rules.drawToMatch ? DECK_SIZE : 1;
  let drawn = 0;
  let last: Card | null = null;
  while (drawn < limit) {
    const card = drawOne(s, ctx, ev);
    if (!card) break;
    player.hand.push(card);
    last = card;
    drawn++;
    if (canPlay(s, player, card)) break;
  }
  if (drawn > 0) ev.push({ t: 'drew', playerId, count: drawn });

  if (last && canPlay(s, player, last)) {
    // They may play it straight away or keep it and end the turn.
    s.pending = { kind: 'drawn', playerId, cardId: last.id };
    return null;
  }

  advance(s, 1, ctx, ev);
  return null;
}

function handlePass(s: RoomState, playerId: string, ctx: EngineCtx, ev: GameEvent[]): EngineFail | null {
  if (!s.pending || s.pending.kind !== 'drawn' || s.pending.playerId !== playerId) {
    return fail('nothing_to_pass', 'You have nothing to pass on.');
  }
  s.pending = null;
  advance(s, 1, ctx, ev);
  return null;
}

function handleCallUno(s: RoomState, playerId: string, ctx: EngineCtx, ev: GameEvent[]): EngineFail | null {
  if (!s.uno || s.uno.playerId !== playerId) return fail('no_uno_window', 'You are not on one card.');
  if (ctx.now > s.uno.deadline) return fail('window_closed', 'Too late.');
  if (s.uno.called) return fail('already_called', 'You already called it.');
  s.uno.called = true;
  ev.push({ t: 'unoCalled', playerId });
  return null;
}

/**
 * The catch race. The Durable Object is single-threaded, so whichever message
 * lands first is simply the one that runs first — no locking needed.
 */
function handleCatchUno(
  s: RoomState,
  playerId: string,
  targetId: string,
  ctx: EngineCtx,
  ev: GameEvent[],
): EngineFail | null {
  if (!s.uno) return fail('nothing_to_catch', 'Nobody is on one card.');
  if (s.uno.playerId !== targetId) return fail('nothing_to_catch', 'They are not the one on one card.');
  if (playerId === targetId) return fail('nothing_to_catch', 'You cannot catch yourself.');
  if (ctx.now > s.uno.deadline) return fail('window_closed', 'The moment has passed.');
  if (s.uno.accusers.includes(playerId)) return fail('already_accused', 'You already called them out.');

  s.uno.accusers.push(playerId);
  const accuser = playerIndex(s, playerId);

  if (s.uno.called) {
    // They got their call in first — that is a false accusation.
    const dealt = dealTo(s, accuser, 2, ctx, ev);
    ev.push({ t: 'falseAccusation', byId: playerId, targetId, penalty: dealt });
    ev.push({ t: 'penalty', playerId, count: dealt, reason: 'falseAccusation' });
    return null;
  }

  const dealt = dealTo(s, playerIndex(s, targetId), 2, ctx, ev);
  ev.push({ t: 'unoCaught', byId: playerId, targetId, penalty: dealt });
  ev.push({ t: 'penalty', playerId: targetId, count: dealt, reason: 'unoCaught' });
  s.uno = null;
  return null;
}

function handleChallenge(s: RoomState, playerId: string, ctx: EngineCtx, ev: GameEvent[]): EngineFail | null {
  const stack = s.drawStack;
  if (!stack || !stack.challengeable) return fail('nothing_to_challenge', 'There is nothing to challenge.');
  if (s.pending) return fail('resolve_first', 'Finish the current choice first.');
  const index = playerIndex(s, playerId);
  if (index !== s.turn) return fail('not_your_turn', 'Only the player facing it may challenge.');

  const targetIndex = playerIndex(s, stack.playedBy);
  const target = s.players[targetIndex];

  // The challenger — and only the challenger — sees the hand.
  ev.push({ t: 'handRevealed', playerId: target.id, hand: target.hand.slice(), to: playerId });

  const owed = stack.count;
  s.drawStack = null;

  if (stack.hadColorMatch) {
    // Bluff caught: they draw the cards they tried to hand over.
    const dealt = dealTo(s, targetIndex, owed, ctx, ev);
    ev.push({ t: 'challenged', challengerId: playerId, targetId: target.id, success: true, penalty: dealt });
    ev.push({ t: 'penalty', playerId: target.id, count: dealt, reason: 'challengeWon' });
    // The challenger keeps their turn, with a fresh clock.
    startClock(s, ctx);
    ev.push({ t: 'turnStart', playerId, deadline: s.turnDeadline });
  } else {
    // It was a legal play: the challenger takes the cards plus two more.
    const dealt = dealTo(s, index, owed + 2, ctx, ev);
    ev.push({ t: 'challenged', challengerId: playerId, targetId: target.id, success: false, penalty: dealt });
    ev.push({ t: 'penalty', playerId, count: dealt, reason: 'challengeLost' });
    advance(s, 1, ctx, ev);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Clock-driven transitions (the DO drives these from alarms)
 * ------------------------------------------------------------------ */

/** Closes an expired UNO window. Safe to call speculatively. */
export function expireUnoWindow(state: RoomState, ctx: EngineCtx): EngineResult {
  if (!state.uno) return fail('no_uno_window', 'No window is open.');
  if (state.uno.deadline > ctx.now) return fail('too_early', 'The window is still open.');
  const s = clone(state);
  const ev: GameEvent[] = [];
  const window = s.uno as NonNullable<RoomState['uno']>;
  if (!window.called) ev.push({ t: 'unoMissed', playerId: window.playerId });
  ev.push({ t: 'unoWindowClosed', playerId: window.playerId });
  s.uno = null;
  return { ok: true, state: s, events: ev };
}

/**
 * The turn clock ran out: draw and pass on the player's behalf. Any choice
 * they owed is resolved with a sensible default first.
 */
export function timeoutTurn(state: RoomState, ctx: EngineCtx): EngineResult {
  if (state.phase !== 'playing') return fail('not_playing', 'The game is not running.');
  const actor = actorId(state);
  if (!actor) return fail('no_actor', 'Nobody is on the clock.');

  let s = state;
  const events: GameEvent[] = [{ t: 'timedOut', playerId: actor }];

  const run = (intent: Intent, from: string = actor): boolean => {
    const result = applyIntent(s, from, intent, ctx);
    if (!result.ok) return false;
    s = result.state;
    events.push(...result.events);
    return true;
  };

  const pending = s.pending;
  if (pending?.kind === 'color') {
    run({ type: 'CHOOSE_COLOR', color: bestColorFor(s, actor, ctx) });
  } else if (pending?.kind === 'swap') {
    const target = fewestCardsOpponent(s, actor);
    if (target) run({ type: 'CHOOSE_PLAYER', playerId: target });
  } else if (pending?.kind === 'drawn') {
    run({ type: 'PASS' });
    return { ok: true, state: s, events };
  }

  // If they still owe a move, draw and pass — never play for them.
  if (actorId(s) === actor && s.phase === 'playing') {
    if (run({ type: 'DRAW' }) && s.pending?.kind === 'drawn' && s.pending.playerId === actor) {
      run({ type: 'PASS' });
    }
  }

  return { ok: true, state: s, events };
}

/** The colour a player holds most of — used for auto-choices and by bots. */
export function bestColorFor(s: RoomState, playerId: string, ctx: EngineCtx): Color {
  const player = findPlayer(s, playerId);
  const counts = new Map<Color, number>();
  for (const color of COLORS) counts.set(color, 0);
  for (const card of player?.hand ?? []) {
    if (card.color) counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
  }
  let best: Color | null = null;
  let bestCount = -1;
  for (const color of COLORS) {
    const count = counts.get(color) ?? 0;
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  // An empty hand of colours is a coin toss rather than always red.
  if (bestCount === 0) return COLORS[ctx.rng.int(COLORS.length)];
  return best as Color;
}

function fewestCardsOpponent(s: RoomState, playerId: string): string | null {
  let best: Player | null = null;
  for (const p of s.players) {
    if (p.id === playerId) continue;
    if (!best || p.hand.length < best.hand.length) best = p;
  }
  return best?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * Projection — the anti-cheat boundary
 * ------------------------------------------------------------------ */

/**
 * What `viewerId` is allowed to know. Every broadcast goes through here:
 * a player gets their own hand in full and nothing but a count for everyone
 * else, and the draw pile is never sent at all.
 *
 * Pass `null` for spectators.
 */
export function serializeFor(s: RoomState, viewerId: string | null, now: number): PublicRoom {
  const players: PublicPlayer[] = s.players.map((p) => {
    const view: PublicPlayer = {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: p.isBot,
      botLevel: p.botLevel,
      connected: p.connected,
      ready: p.ready,
      handCount: p.hand.length,
      score: p.score,
      roundPoints: p.roundPoints,
      botControlled: p.botControlled,
    };
    if (p.id === viewerId) view.hand = p.hand.slice();
    return view;
  });

  let pending: PublicPending | null = null;
  if (s.pending) {
    if (s.pending.kind === 'color') {
      pending = { kind: 'color', playerId: s.pending.playerId, source: s.pending.source };
    } else if (s.pending.kind === 'swap') {
      pending = { kind: 'swap', playerId: s.pending.playerId };
    } else {
      pending = {
        kind: 'drawn',
        playerId: s.pending.playerId,
        // Only the owner learns which card it was.
        cardId: s.pending.playerId === viewerId ? s.pending.cardId : undefined,
      };
    }
  }

  const drawStack: PublicDrawStack | null = s.drawStack
    ? {
        count: s.drawStack.count,
        kind: s.drawStack.kind,
        playedBy: s.drawStack.playedBy,
        challengeable: s.drawStack.challengeable,
      }
    : null;

  return {
    code: s.code,
    phase: s.phase,
    rules: s.rules,
    hostId: s.hostId,
    players,
    turn: s.turn,
    direction: s.direction,
    drawCount: s.drawPile.length,
    discardTop: topCard(s),
    discardCount: s.discard.length,
    activeColor: s.activeColor,
    pending,
    drawStack,
    uno: s.uno ? { ...s.uno, accusers: s.uno.accusers.slice() } : null,
    round: s.round,
    turnDeadline: s.turnDeadline,
    result: s.result,
    matchWinnerId: s.matchWinnerId,
    youId: viewerId,
    moves: viewerId ? legalMoves(s, viewerId) : NO_MOVES,
    now,
  };
}

/**
 * Everything `playerId` may legally do at this instant. The client renders
 * straight off this, so playable/dimmed cards can never disagree with what
 * the server will accept.
 */
export function legalMoves(s: RoomState, playerId: string): LegalMoves {
  const index = playerIndex(s, playerId);
  if (index < 0 || s.phase !== 'playing') return { ...NO_MOVES };
  const player = s.players[index];
  const top = topCard(s);
  const moves: LegalMoves = { ...NO_MOVES, playable: [], jumpIn: [] };

  const owesChoice = s.pending !== null && s.pending.playerId === playerId;
  const isTurn = index === s.turn;

  if (s.pending?.kind === 'drawn' && s.pending.playerId === playerId) {
    const drawnId = s.pending.cardId;
    const drawn = player.hand.find((c) => c.id === drawnId);
    if (drawn && canPlay(s, player, drawn)) moves.playable = [drawn.id];
    moves.canPass = true;
  } else if (s.pending?.kind === 'color' && owesChoice) {
    moves.mustChooseColor = true;
  } else if (s.pending?.kind === 'swap' && owesChoice) {
    moves.mustChooseSwapTarget = true;
  } else if (!s.pending && isTurn) {
    if (s.drawStack) {
      const stackKind = s.drawStack.kind;
      if (s.rules.stacking) {
        moves.playable = player.hand.filter((c) => c.kind === stackKind).map((c) => c.id);
      }
      moves.canChallenge = s.drawStack.challengeable;
    } else {
      moves.playable = player.hand.filter((c) => canPlay(s, player, c)).map((c) => c.id);
    }
    moves.canDraw = true;
  }

  // Jumping in is the one thing you may do out of turn.
  if (
    s.rules.jumpIn &&
    !s.pending &&
    !s.drawStack &&
    top &&
    !isWild(top) &&
    !isTurn &&
    s.lastPlayerId !== playerId
  ) {
    moves.jumpIn = player.hand.filter((c) => sameFace(c, top)).map((c) => c.id);
  }

  if (s.uno) {
    if (s.uno.playerId === playerId) {
      moves.canCallUno = !s.uno.called;
    } else if (!s.uno.accusers.includes(playerId)) {
      moves.catchTargetId = s.uno.playerId;
    }
  }

  return moves;
}
