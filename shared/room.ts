/**
 * Lobby-level operations: seats, hosts, bots, rule toggles, room codes.
 *
 * Kept beside the rules engine and just as pure, so the Durable Object never
 * has to hand-roll an invariant (like "the host always exists") twice.
 */

import type { BotLevel, Player, RoomState, RuleSet, TurnTimer } from './types';
import { DEFAULT_RULES } from './types';
import { MAX_PLAYERS } from './engine';
import type { Rng } from './rng';

/** No 0/O or 1/I — room codes get read out loud. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function makeRoomCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[rng.int(CODE_ALPHABET.length)];
  return code;
}

/** Accepts lower case and trims, then validates against the alphabet. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

const NAME_ADJECTIVES = [
  'Sneaky', 'Reckless', 'Polite', 'Feral', 'Smug', 'Doomed', 'Lucky', 'Grumpy',
  'Velvet', 'Turbo', 'Midnight', 'Cosmic', 'Silent', 'Nuclear', 'Wobbly', 'Regal',
];

const NAME_NOUNS = [
  'Pigeon', 'Wizard', 'Goblin', 'Otter', 'Bandit', 'Muffin', 'Comet', 'Raccoon',
  'Noodle', 'Tornado', 'Walrus', 'Phantom', 'Cactus', 'Badger', 'Gremlin', 'Marmot',
];

export function randomNickname(rng: Rng): string {
  const adjective = NAME_ADJECTIVES[rng.int(NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[rng.int(NAME_NOUNS.length)];
  return `${adjective} ${noun}`;
}

const BOT_NAMES = ['Rex', 'Nova', 'Pixel', 'Cinder', 'Juno', 'Vega', 'Milo', 'Echo'];

export const AVATAR_COUNT = 12;

export function createRoomState(code: string, rules: Partial<RuleSet> = {}): RoomState {
  return {
    code,
    phase: 'lobby',
    rules: { ...DEFAULT_RULES, ...rules },
    hostId: null,
    players: [],
    turn: 0,
    direction: 1,
    drawPile: [],
    discard: [],
    activeColor: null,
    pending: null,
    drawStack: null,
    uno: null,
    lastPlayerId: null,
    round: 0,
    turnDeadline: null,
    result: null,
    matchWinnerId: null,
    passRecord: [],
  };
}

export interface SeatRequest {
  id: string;
  name: string;
  avatar: number;
  isBot?: boolean;
  botLevel?: BotLevel;
}

/** Trims, caps length, strips control characters, falls back to a default. */
export function cleanName(input: string, fallback: string): string {
  const cleaned = Array.from(input.trim())
    .filter((ch) => ch >= ' ' && ch !== '')
    .join('')
    .slice(0, 16)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Makes `name` unique at the table by appending a number if it collides. */
export function uniqueName(state: RoomState, name: string): string {
  const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n < 100; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

export function newPlayer(seat: SeatRequest): Player {
  return {
    id: seat.id,
    name: seat.name,
    avatar: ((seat.avatar % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT,
    isBot: seat.isBot === true,
    botLevel: seat.botLevel ?? 'normal',
    connected: true,
    ready: false,
    hand: [],
    score: 0,
    roundPoints: 0,
    botControlled: false,
  };
}

export function isRoomFull(state: RoomState): boolean {
  return state.players.length >= MAX_PLAYERS;
}

/** Seats a player. Mutates — callers own a draft. */
export function seatPlayer(state: RoomState, seat: SeatRequest): Player {
  const player = newPlayer({ ...seat, name: uniqueName(state, seat.name) });
  state.players.push(player);
  if (!state.hostId) state.hostId = player.id;
  return player;
}

/** Picks an unused bot name and avatar. */
export function makeBot(state: RoomState, level: BotLevel, rng: Rng): SeatRequest {
  const used = new Set(state.players.map((p) => p.name));
  const available = BOT_NAMES.filter((n) => !used.has(n));
  const pool = available.length > 0 ? available : BOT_NAMES;
  const name = pool[rng.int(pool.length)];
  const takenAvatars = new Set(state.players.map((p) => p.avatar));
  let avatar = rng.int(AVATAR_COUNT);
  for (let i = 0; i < AVATAR_COUNT && takenAvatars.has(avatar); i++) {
    avatar = (avatar + 1) % AVATAR_COUNT;
  }
  return { id: `bot-${name.toLowerCase()}-${state.players.length}`, name, avatar, isBot: true, botLevel: level };
}

/**
 * Removes a seat and keeps the table coherent: the host moves on, and the
 * turn index stays pointed at the same player it was pointed at before.
 */
export function unseatPlayer(state: RoomState, playerId: string): boolean {
  const index = state.players.findIndex((p) => p.id === playerId);
  if (index < 0) return false;
  const wasTurn = state.turn;
  state.players.splice(index, 1);

  if (state.players.length === 0) {
    state.hostId = null;
    state.turn = 0;
    return true;
  }
  if (state.hostId === playerId) {
    const nextHost = state.players.find((p) => !p.isBot) ?? state.players[0];
    state.hostId = nextHost.id;
  }
  if (index < wasTurn) state.turn = wasTurn - 1;
  state.turn = state.turn % state.players.length;
  return true;
}

const TURN_TIMERS: readonly TurnTimer[] = [0, 15, 30, 60];

/** Validates and applies a host's rule change. Unknown keys are ignored. */
export function applyRuleChange(rules: RuleSet, patch: Partial<RuleSet>): RuleSet {
  const next: RuleSet = { ...rules };
  if (typeof patch.challenge === 'boolean') next.challenge = patch.challenge;
  if (typeof patch.stacking === 'boolean') next.stacking = patch.stacking;
  if (typeof patch.jumpIn === 'boolean') next.jumpIn = patch.jumpIn;
  if (typeof patch.sevenZero === 'boolean') next.sevenZero = patch.sevenZero;
  if (typeof patch.drawToMatch === 'boolean') next.drawToMatch = patch.drawToMatch;
  if (patch.turnTimer !== undefined && TURN_TIMERS.includes(patch.turnTimer)) {
    next.turnTimer = patch.turnTimer;
  }
  if (patch.matchMode === 'single' || patch.matchMode === 'match') next.matchMode = patch.matchMode;
  if (typeof patch.targetScore === 'number' && Number.isFinite(patch.targetScore)) {
    next.targetScore = Math.min(2000, Math.max(100, Math.round(patch.targetScore)));
  }
  return next;
}

/** Everyone seated is ready and there are enough of them. */
export function canStart(state: RoomState): boolean {
  return (
    state.phase === 'lobby' &&
    state.players.length >= 2 &&
    state.players.every((p) => p.isBot || p.ready)
  );
}
