/**
 * Shared domain types for UNO.
 *
 * Imported by both the Durable Object and the React client so the two can
 * never drift. Dependency-free, Web-standard only — no Node built-ins.
 */

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

export const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type Color = (typeof COLORS)[number];

/** `number` covers 0-9; the rest are action/wild cards. */
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  /** Unique per physical card in the deck — stable across a whole match. */
  readonly id: string;
  readonly kind: CardKind;
  /** `null` for wild and wild draw four. */
  readonly color: Color | null;
  /** 0-9 for `number` cards, `null` otherwise. */
  readonly digit: number | null;
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

export type BotLevel = 'easy' | 'normal' | 'hard';
export type MatchMode = 'single' | 'match';
/** Seconds. 0 = no turn timer. */
export type TurnTimer = 0 | 15 | 30 | 60;

export interface RuleSet {
  /** Wild Draw Four may be challenged by its target. Default ON. */
  challenge: boolean;
  /** Draw Two on Draw Two, Wild Draw Four on Wild Draw Four. */
  stacking: boolean;
  /** Exact match (same colour *and* value) may be played out of turn. */
  jumpIn: boolean;
  /** 7 swaps hands with a chosen player, 0 rotates all hands. */
  sevenZero: boolean;
  /** Keep drawing until you draw something playable. */
  drawToMatch: boolean;
  turnTimer: TurnTimer;
  /** `single` ends after one round, `match` plays to `targetScore`. */
  matchMode: MatchMode;
  targetScore: number;
}

export const DEFAULT_RULES: RuleSet = {
  challenge: true,
  stacking: false,
  jumpIn: false,
  sevenZero: false,
  drawToMatch: false,
  turnTimer: 0,
  matchMode: 'match',
  targetScore: 500,
};

/* ------------------------------------------------------------------ *
 * Players & room state
 * ------------------------------------------------------------------ */

export interface Player {
  id: string;
  name: string;
  /** Index into the 12 code-generated avatars. */
  avatar: number;
  isBot: boolean;
  botLevel: BotLevel;
  connected: boolean;
  ready: boolean;
  hand: Card[];
  /** Running match total. */
  score: number;
  /** Points won in the most recent round (0 if none). */
  roundPoints: number;
  /**
   * A human seat currently played by a bot because the player dropped and
   * did not return inside the grace window. Cleared when they rejoin.
   */
  botControlled: boolean;
}

export type Phase = 'lobby' | 'playing' | 'roundOver' | 'matchOver';

/** An unresolved Draw Two / Wild Draw Four aimed at the current player. */
export interface DrawStack {
  count: number;
  kind: 'draw2' | 'wild4';
  /** Who played the most recent card in the stack. */
  playedBy: string;
  /** Only ever true for a wild4 when the challenge rule is on. */
  challengeable: boolean;
  /** Server-only: did `playedBy` hold the active colour when they played it? */
  hadColorMatch: boolean;
  /** Server-only: the colour that was active before the wild4 landed. */
  colorBefore: Color | null;
}

/** Something the engine is waiting on before the turn can advance. */
export type Pending =
  | {
      kind: 'color';
      playerId: string;
      /** `initial` = the flipped starting card was a wild. */
      source: 'wild' | 'wild4' | 'initial';
      /** Server-only, carried into the resulting draw stack. */
      hadColorMatch: boolean;
      /** Server-only. */
      colorBefore: Color | null;
      /** Server-only: they hit UNO as part of the play that created this. */
      declaredUno: boolean;
    }
  | { kind: 'swap'; playerId: string; declaredUno: boolean }
  | { kind: 'drawn'; playerId: string; cardId: string };

export interface UnoWindow {
  /** The player who is down to one card. */
  playerId: string;
  /** Epoch ms — the window closes here. */
  deadline: number;
  /** Set once they hit the UNO button. */
  called: boolean;
  /** Players who already spent their catch attempt on this window. */
  accusers: string[];
}

export interface RoundResult {
  winnerId: string;
  /** Points the winner scored this round. */
  points: number;
  /** Every remaining hand, revealed — the round is over. */
  hands: Record<string, Card[]>;
  handPoints: Record<string, number>;
  /** Match totals after this round. */
  totals: Record<string, number>;
}

/** A recorded "player declined the active colour", used by the hard bot. */
export interface PassRecord {
  playerId: string;
  color: Color;
}

/**
 * The full authoritative state. Lives in Durable Object memory, persisted to
 * DO storage after every mutation. Never leaves the DO unfiltered — see
 * `serializeFor` in `engine.ts`.
 */
export interface RoomState {
  code: string;
  phase: Phase;
  rules: RuleSet;
  hostId: string | null;
  /** Seat order. */
  players: Player[];
  /** Index into `players`. */
  turn: number;
  direction: 1 | -1;
  drawPile: Card[];
  /** Last element is the top of the pile. */
  discard: Card[];
  activeColor: Color | null;
  pending: Pending | null;
  drawStack: DrawStack | null;
  uno: UnoWindow | null;
  /** Who played the top discard — used to block jumping in on yourself. */
  lastPlayerId: string | null;
  round: number;
  /** Epoch ms the current turn expires, or `null` when the timer is off. */
  turnDeadline: number | null;
  result: RoundResult | null;
  matchWinnerId: string | null;
  /** Rolling, round-scoped record of declined colours (public information). */
  passRecord: PassRecord[];
}

/* ------------------------------------------------------------------ *
 * Client-visible projections (anti-cheat boundary)
 * ------------------------------------------------------------------ */

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: number;
  isBot: boolean;
  botLevel: BotLevel;
  connected: boolean;
  ready: boolean;
  handCount: number;
  score: number;
  roundPoints: number;
  botControlled: boolean;
  /** Present only on the viewer's own seat. Never populated for anyone else. */
  hand?: Card[];
}

export type PublicPending =
  | { kind: 'color'; playerId: string; source: 'wild' | 'wild4' | 'initial' }
  | { kind: 'swap'; playerId: string }
  | { kind: 'drawn'; playerId: string; cardId?: string };

export interface PublicDrawStack {
  count: number;
  kind: 'draw2' | 'wild4';
  playedBy: string;
  challengeable: boolean;
}

export interface LegalMoves {
  /** Card ids the viewer may play right now, in turn. */
  playable: string[];
  /** Card ids the viewer may jump in with, out of turn. */
  jumpIn: string[];
  canDraw: boolean;
  canPass: boolean;
  canChallenge: boolean;
  canCallUno: boolean;
  /** The player the viewer may catch, or `null`. */
  catchTargetId: string | null;
  mustChooseColor: boolean;
  mustChooseSwapTarget: boolean;
}

export const NO_MOVES: LegalMoves = {
  playable: [],
  jumpIn: [],
  canDraw: false,
  canPass: false,
  canChallenge: false,
  canCallUno: false,
  catchTargetId: null,
  mustChooseColor: false,
  mustChooseSwapTarget: false,
};

export interface PublicRoom {
  code: string;
  phase: Phase;
  rules: RuleSet;
  hostId: string | null;
  players: PublicPlayer[];
  turn: number;
  direction: 1 | -1;
  drawCount: number;
  discardTop: Card | null;
  discardCount: number;
  activeColor: Color | null;
  pending: PublicPending | null;
  drawStack: PublicDrawStack | null;
  uno: UnoWindow | null;
  round: number;
  turnDeadline: number | null;
  result: RoundResult | null;
  matchWinnerId: string | null;
  /** The viewer's seat id, or `null` for spectators. */
  youId: string | null;
  /** What the viewer may legally do right now. */
  moves: LegalMoves;
  /** Server clock at serialization time, so clients can align countdowns. */
  now: number;
}

/* ------------------------------------------------------------------ *
 * Intents (client → server) — the only things a client may ask for
 * ------------------------------------------------------------------ */

export type Intent =
  | { type: 'PLAY_CARD'; cardId: string; declareUno?: boolean }
  | { type: 'DRAW' }
  | { type: 'PASS' }
  | { type: 'CHOOSE_COLOR'; color: Color }
  | { type: 'CHOOSE_PLAYER'; playerId: string }
  | { type: 'CALL_UNO' }
  | { type: 'CATCH_UNO'; targetId: string }
  | { type: 'CHALLENGE' };

export type IntentType = Intent['type'];

/* ------------------------------------------------------------------ *
 * Events (server → client) — narration + animation triggers
 * ------------------------------------------------------------------ */

export type PenaltyReason = 'unoCaught' | 'falseAccusation' | 'drawStack' | 'challengeLost' | 'challengeWon';

export type GameEvent =
  | { t: 'roundStart'; round: number; startingId: string; topCard: Card }
  | { t: 'turnStart'; playerId: string; deadline: number | null }
  | { t: 'played'; playerId: string; card: Card; jumpIn: boolean }
  | { t: 'drew'; playerId: string; count: number }
  | { t: 'colorChosen'; playerId: string; color: Color }
  | { t: 'skipped'; playerId: string }
  | { t: 'reversed'; direction: 1 | -1 }
  | { t: 'reshuffled'; count: number }
  | { t: 'unoCalled'; playerId: string }
  | { t: 'unoCaught'; byId: string; targetId: string; penalty: number }
  | { t: 'unoMissed'; playerId: string }
  | { t: 'falseAccusation'; byId: string; targetId: string; penalty: number }
  | { t: 'unoWindowClosed'; playerId: string }
  | { t: 'challenged'; challengerId: string; targetId: string; success: boolean; penalty: number }
  | { t: 'handRevealed'; playerId: string; hand: Card[]; to: string }
  | { t: 'handsSwapped'; aId: string; bId: string }
  | { t: 'handsRotated'; direction: 1 | -1 }
  | { t: 'penalty'; playerId: string; count: number; reason: PenaltyReason }
  | { t: 'timedOut'; playerId: string }
  | { t: 'roundOver'; result: RoundResult }
  | { t: 'matchOver'; winnerId: string }
  | { t: 'playerJoined'; playerId: string; name: string }
  | { t: 'playerLeft'; playerId: string; name: string }
  | { t: 'playerReconnected'; playerId: string; name: string }
  | { t: 'botTookOver'; playerId: string; name: string };

/** Events carrying `to` are delivered to that player only. */
export function eventRecipient(event: GameEvent): string | null {
  return 'to' in event ? event.to : null;
}
