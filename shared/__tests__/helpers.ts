/**
 * Test-only scaffolding: build an exact table in one literal.
 *
 * Cards are written as short codes so a test reads like a hand of cards:
 *   r7  red 7          bs  blue skip      gv  green reverse
 *   yd  yellow draw 2  w   wild           f   wild draw four
 */

import type { BotLevel, Card, CardKind, Color, RoomState, RuleSet } from '../types';
import { DEFAULT_RULES } from '../types';
import { createRoomState, newPlayer } from '../room';
import { createDeck } from '../deck';
import type { EngineCtx, EngineOk, EngineResult } from '../engine';
import { seededRng } from '../rng';

const COLOR_BY_CODE: Record<string, Color> = { r: 'red', y: 'yellow', g: 'green', b: 'blue' };
const KIND_BY_CODE: Record<string, CardKind> = { s: 'skip', v: 'reverse', d: 'draw2' };

/** Parses a card code into the exact card the real deck would contain. */
export function C(code: string, copy = 0): Card {
  if (code === 'w' || code === 'f') {
    return { id: `${code}-${copy}`, kind: code === 'w' ? 'wild' : 'wild4', color: null, digit: null };
  }
  const color = COLOR_BY_CODE[code[0]];
  if (!color) throw new Error(`bad card code: ${code}`);
  const rest = code.slice(1);
  if (rest.length === 1 && rest >= '0' && rest <= '9') {
    return { id: `${code}-${copy}`, kind: 'number', color, digit: Number(rest) };
  }
  const kind = KIND_BY_CODE[rest];
  if (!kind) throw new Error(`bad card code: ${code}`);
  return { id: `${code}-${copy}`, kind, color, digit: null };
}

export function ctx(now = 10_000, seed = 7): EngineCtx {
  return { rng: seededRng(seed), now };
}

/** A lobby with `count` seated humans, ready to start. */
export function lobby(count: number, rules?: Partial<RuleSet>): RoomState {
  const state = createRoomState('LOBBY1', rules);
  for (let i = 0; i < count; i++) {
    const player = newPlayer({ id: `p${i}`, name: `P${i}`, avatar: i });
    player.ready = true;
    state.players.push(player);
  }
  state.hostId = 'p0';
  return state;
}

/** A lobby of nothing but bots, one per level given. */
export function botLobby(levels: BotLevel[], rules?: Partial<RuleSet>): RoomState {
  const state = createRoomState('BOTSRM', rules);
  levels.forEach((level, i) => {
    state.players.push(
      newPlayer({ id: `b${i}`, name: `Bot${i}`, avatar: i, isBot: true, botLevel: level }),
    );
  });
  state.hostId = 'b0';
  return state;
}

export interface TableSpec {
  /** Player id -> their hand, as card codes. Seat order follows key order. */
  hands: Record<string, string[]>;
  /** The card face-up on the discard pile. */
  top: string;
  /** Active colour. Defaults to the top card's colour. */
  color?: Color;
  rules?: Partial<RuleSet>;
  /** Seat index whose turn it is. Defaults to 0. */
  turn?: number;
  direction?: 1 | -1;
  /** Cards waiting to be drawn, **first element drawn first**. */
  drawPile?: string[];
  /** Extra cards buried under the top of the discard pile, oldest first. */
  buried?: string[];
  scores?: Record<string, number>;
  /** Seats to mark as bots, and at what difficulty. */
  bots?: Record<string, BotLevel>;
}

/**
 * Builds a mid-game `RoomState`. Repeated codes automatically take the next
 * copy of that card, so `['r7', 'r7']` is the two real red sevens.
 */
export function table(spec: TableSpec): RoomState {
  const used = new Map<string, number>();
  const take = (code: string): Card => {
    const copy = used.get(code) ?? 0;
    used.set(code, copy + 1);
    return C(code, copy);
  };

  const state = createRoomState('TESTRM', spec.rules);
  state.phase = 'playing';
  state.round = 1;
  state.turn = spec.turn ?? 0;
  state.direction = spec.direction ?? 1;

  for (const [id, codes] of Object.entries(spec.hands)) {
    const level = spec.bots?.[id];
    const player = newPlayer({ id, name: id, avatar: 0, isBot: level !== undefined, botLevel: level });
    player.score = spec.scores?.[id] ?? 0;
    player.hand = codes.map(take);
    state.players.push(player);
  }
  state.hostId = state.players[0]?.id ?? null;

  const buried = (spec.buried ?? []).map(take);
  const top = take(spec.top);
  state.discard = [...buried, top];
  state.activeColor = spec.color ?? top.color;

  if (spec.drawPile) {
    // `pop()` takes from the end, so reverse to make the first listed card
    // the first one drawn.
    state.drawPile = spec.drawPile.map(take).reverse();
  } else {
    const taken = new Set([
      ...state.players.flatMap((p) => p.hand.map((c) => c.id)),
      ...state.discard.map((c) => c.id),
    ]);
    state.drawPile = createDeck()
      .filter((c) => !taken.has(c.id))
      .reverse();
  }

  return state;
}

/** Unwraps an engine result, failing the test with the engine's own message. */
export function ok(result: EngineResult): EngineOk {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

/** Asserts the result failed, and returns the code. */
export function errorCode(result: EngineResult): string {
  if (result.ok) throw new Error('expected failure, but the intent was accepted');
  return result.code;
}

export function handOf(s: RoomState, playerId: string): string[] {
  return (s.players.find((p) => p.id === playerId)?.hand ?? []).map((c) => c.id);
}

export function handSize(s: RoomState, playerId: string): number {
  return s.players.find((p) => p.id === playerId)?.hand.length ?? 0;
}

export function turnId(s: RoomState): string {
  return s.players[s.turn].id;
}

/** Every card in play, for conservation checks. */
export function allCardIds(s: RoomState): string[] {
  return [
    ...s.drawPile.map((c) => c.id),
    ...s.discard.map((c) => c.id),
    ...s.players.flatMap((p) => p.hand.map((c) => c.id)),
  ];
}

export const RULES: Record<string, Partial<RuleSet>> = {
  plain: { ...DEFAULT_RULES, challenge: false },
  challenge: { ...DEFAULT_RULES, challenge: true },
};
