/**
 * The WebSocket wire protocol.
 *
 * Clients only ever send intents and lobby requests; the Durable Object
 * validates every one and answers with a fresh, per-player-filtered snapshot.
 * There is no client-side prediction of game state, so a hacked client can
 * only ever ask for something illegal and be told no.
 */

import type { BotLevel, GameEvent, Intent, PublicRoom, RuleSet } from './types';

export interface ChatMessage {
  id: string;
  kind: 'chat' | 'emote' | 'system';
  /** `null` for system lines. */
  playerId: string | null;
  name: string;
  avatar: number | null;
  text: string;
  at: number;
}

/** The six-emote quick bar. */
export const EMOTES = [
  { glyph: '👋', label: 'Hello' },
  { glyph: '😂', label: 'Laughing' },
  { glyph: '😱', label: 'Shocked' },
  { glyph: '🔥', label: 'Nice one' },
  { glyph: '🤔', label: 'Thinking' },
  { glyph: '🎉', label: 'Celebrate' },
] as const;

export const MAX_CHAT_LENGTH = 160;
export const CHAT_HISTORY = 60;

export type ClientMessage =
  | { t: 'intent'; intent: Intent }
  | { t: 'chat'; text: string }
  | { t: 'emote'; index: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'rules'; patch: Partial<RuleSet> }
  | { t: 'start' }
  | { t: 'addBot'; level: BotLevel }
  | { t: 'removePlayer'; playerId: string }
  | { t: 'nextRound' }
  | { t: 'newMatch' }
  | { t: 'ping' };

export type ServerMessage =
  | {
      t: 'welcome';
      youId: string | null;
      /** Stashed in `sessionStorage` and replayed to reclaim the same seat. */
      token: string;
      spectator: boolean;
      room: PublicRoom;
      chat: ChatMessage[];
    }
  /**
   * Every state change: the new snapshot, what just happened, and any system
   * lines those events produced. Events carrying a `to` field are filtered
   * out before this reaches anyone else.
   */
  | { t: 'sync'; room: PublicRoom; events: GameEvent[]; chat?: ChatMessage[] }
  | { t: 'error'; code: string; message: string; fatal?: boolean }
  | { t: 'pong'; now: number };

/** WebSocket close codes used for fatal join failures. */
export const CLOSE_ROOM_FULL = 4001;
export const CLOSE_BAD_ROOM = 4002;
export const CLOSE_REPLACED = 4003;

/** How long a dropped player keeps their seat before a bot takes over. */
export const RECONNECT_GRACE_MS = 60_000;

/** How long an empty room lives before it deletes itself. */
export const ROOM_TTL_MS = 10 * 60_000;

/** Bot "thinking" delay bounds. */
export const BOT_MIN_DELAY_MS = 1000;
export const BOT_MAX_DELAY_MS = 2500;
