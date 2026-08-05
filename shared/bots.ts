/**
 * Bot brains.
 *
 * Deliberately built on top of `PublicRoom` — the exact same projection a
 * human client receives — plus the two things every player at the table can
 * genuinely see: the cards already discarded this round, and who has drawn
 * rather than follow a colour. A bot therefore *cannot* cheat: hidden hands,
 * the draw pile order and the "was that Wild Draw Four a bluff" flag are not
 * reachable from here even by accident.
 *
 * Pure: the caller supplies the RNG. The Durable Object runs these on an
 * alarm with a 1-2.5s delay so bots feel like they are thinking.
 */

import type { BotLevel, Card, Color, Intent, PassRecord, PublicPlayer, PublicRoom, RoomState } from './types';
import { COLORS } from './types';
import { cardPoints, isWild } from './deck';
import { serializeFor } from './engine';
import type { Rng } from './rng';
import { BOT_MAX_DELAY_MS, BOT_MIN_DELAY_MS } from './protocol';
import { randomBetween } from './rng';

/** Everything a bot is allowed to know. */
export interface BotView {
  room: PublicRoom;
  /** Every card played this round, oldest first — public knowledge. */
  discard: readonly Card[];
  /** Who has drawn rather than follow a colour — also public knowledge. */
  passRecord: readonly PassRecord[];
}

/** Builds the (deliberately limited) view a bot plays from. */
export function botView(state: RoomState, botId: string, now: number): BotView {
  return {
    room: serializeFor(state, botId, now),
    discard: state.discard.slice(),
    passRecord: state.passRecord.slice(),
  };
}

/** How long the bot should appear to think about it. */
export function botDelay(rng: Rng): number {
  return randomBetween(BOT_MIN_DELAY_MS, BOT_MAX_DELAY_MS, rng);
}

interface Context {
  view: BotView;
  level: BotLevel;
  me: PublicPlayer;
  hand: Card[];
  opponents: PublicPlayer[];
  next: PublicPlayer | null;
  previous: PublicPlayer | null;
  nextThreat: boolean;
  previousThreat: boolean;
  anyThreat: boolean;
  colorCounts: Record<Color, number>;
  bestColor: Color;
}

function seatAt(room: PublicRoom, from: number, step: number): number {
  const len = room.players.length;
  return (((from + step * room.direction) % len) + len) % len;
}

function buildContext(view: BotView): Context | null {
  const room = view.room;
  const index = room.players.findIndex((p) => p.id === room.youId);
  if (index < 0) return null;
  const me = room.players[index];
  const hand = me.hand ?? [];
  const opponents = room.players.filter((p) => p.id !== me.id);
  const next = room.players.length > 1 ? room.players[seatAt(room, index, 1)] : null;
  const previous = room.players.length > 1 ? room.players[seatAt(room, index, -1)] : null;

  const colorCounts = { red: 0, yellow: 0, green: 0, blue: 0 } as Record<Color, number>;
  for (const card of hand) if (card.color) colorCounts[card.color]++;

  let bestColor: Color = COLORS[0];
  for (const color of COLORS) if (colorCounts[color] > colorCounts[bestColor]) bestColor = color;

  return {
    view,
    level: me.botLevel,
    me,
    hand,
    opponents,
    next,
    previous,
    nextThreat: next !== null && next.handCount <= 2,
    previousThreat: previous !== null && previous.handCount <= 2,
    anyThreat: opponents.some((p) => p.handCount <= 2),
    colorCounts,
    bestColor,
  };
}

/**
 * The bot's move for the current state, or `null` if it has nothing to do
 * (not its turn, or the game is not running).
 */
export function decideBotIntent(view: BotView, rng: Rng): Intent | null {
  const ctx = buildContext(view);
  if (!ctx) return null;
  const { room } = view;
  const moves = room.moves;
  if (room.phase !== 'playing') return null;

  if (moves.mustChooseColor) {
    return { type: 'CHOOSE_COLOR', color: chooseColor(ctx, rng) };
  }

  if (moves.mustChooseSwapTarget) {
    // Swap with whoever is closest to going out.
    const target = ctx.opponents.reduce<PublicPlayer | null>(
      (best, p) => (best === null || p.handCount < best.handCount ? p : best),
      null,
    );
    if (target) return { type: 'CHOOSE_PLAYER', playerId: target.id };
  }

  if (moves.canChallenge && shouldChallenge(ctx, rng)) {
    return { type: 'CHALLENGE' };
  }

  if (moves.playable.length > 0) {
    const playable = ctx.hand.filter((c) => moves.playable.includes(c.id));
    if (playable.length > 0) {
      const choice = bestCard(ctx, playable, rng);
      return {
        type: 'PLAY_CARD',
        cardId: choice.id,
        // Bots never forget. They are not the ones you catch.
        declareUno: ctx.hand.length === 2,
      };
    }
  }

  if (moves.canPass) return { type: 'PASS' };
  if (moves.canDraw) return { type: 'DRAW' };
  return null;
}

/**
 * Should this bot pounce on an open UNO window? Easy bots never notice.
 * The DO calls this on a short alarm so a human always has a fair shot first.
 */
export function decideBotCatch(view: BotView): Intent | null {
  const ctx = buildContext(view);
  if (!ctx) return null;
  if (ctx.level === 'easy') return null;
  const uno = view.room.uno;
  const target = view.room.moves.catchTargetId;
  if (!uno || !target) return null;
  // Only a genuine miss — bots do not throw away 2 cards on a false call.
  if (uno.called) return null;
  return { type: 'CATCH_UNO', targetId: target };
}

/* ------------------------------------------------------------------ *
 * Card choice
 * ------------------------------------------------------------------ */

function bestCard(ctx: Context, playable: Card[], rng: Rng): Card {
  if (ctx.level === 'easy') {
    return playable[rng.int(playable.length)];
  }
  let best = playable[0];
  let bestScore = -Infinity;
  for (const card of playable) {
    // A whisker of noise so two identical options are not always resolved the
    // same way — bots should not be perfectly predictable.
    const score = scoreCard(ctx, card) + rng.int(3);
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

function scoreCard(ctx: Context, card: Card): number {
  const twoPlayer = ctx.view.room.players.length === 2;
  let score: number;

  switch (card.kind) {
    case 'draw2':
      score = ctx.nextThreat ? 80 : 28;
      break;
    case 'skip':
      score = ctx.nextThreat ? 74 : 24;
      break;
    case 'reverse':
      // With two players Reverse *is* a Skip. With more, it hands the turn
      // backwards — which is a gift if the player behind is nearly out.
      score = twoPlayer ? (ctx.nextThreat ? 70 : 22) : ctx.previousThreat ? -6 : 14;
      break;
    case 'number':
      score = 10 + (card.digit ?? 0) * 0.6;
      break;
    case 'wild':
      score = -40; // hoarded: keep the escape hatch for when nothing matches
      break;
    case 'wild4':
      // Already weighs timing, threat and the risk of a challenge, so it is
      // returned as-is rather than run through the adjustments below — the
      // "dump expensive cards" bonus would otherwise talk it into bluffing.
      return scoreWildFour(ctx);
  }

  // Playing your own colour keeps the table on the colour you can answer.
  if (card.color !== null && card.color === ctx.bestColor) score += 6;

  if (ctx.level === 'hard') {
    // Somebody is about to go out — shed the expensive cards now.
    if (ctx.anyThreat) score += cardPoints(card) * 0.8;
    // Steer onto a colour the next player has already refused.
    if (card.color !== null && hasPassedOn(ctx, ctx.next?.id, card.color)) score += 15;
  }

  return score;
}

/** Hard bots time the Wild Draw Four; everyone else just sits on it. */
function scoreWildFour(ctx: Context): number {
  if (ctx.level !== 'hard') return -60;

  const activeColor = ctx.view.room.activeColor;
  const clean = activeColor === null || !ctx.hand.some((c) => c.color === activeColor);

  if (clean) {
    // Nothing to lose to a challenge. Best spent on someone nearly out.
    return ctx.nextThreat ? 85 : -8;
  }
  // Playing it here is a bluff. Only worth the risk when the round is nearly
  // lost anyway, or when there is no challenge rule to punish it.
  if (!ctx.view.room.rules.challenge) return ctx.nextThreat ? 60 : -20;
  return ctx.hand.length <= 2 ? 5 : -85;
}

function hasPassedOn(ctx: Context, playerId: string | undefined, color: Color): boolean {
  if (!playerId) return false;
  return ctx.view.passRecord.some((r) => r.playerId === playerId && r.color === color);
}

/* ------------------------------------------------------------------ *
 * Colour choice
 * ------------------------------------------------------------------ */

function chooseColor(ctx: Context, rng: Rng): Color {
  if (ctx.level === 'easy') {
    const colored = ctx.hand.filter((c) => c.color !== null);
    if (colored.length === 0) return COLORS[rng.int(COLORS.length)];
    return colored[rng.int(colored.length)].color as Color;
  }

  let best: Color = ctx.bestColor;
  let bestScore = -Infinity;
  for (const color of COLORS) {
    let score = ctx.colorCounts[color] * 10;
    if (ctx.level === 'hard') {
      // A colour the next player has refused is a colour they cannot answer.
      if (hasPassedOn(ctx, ctx.next?.id, color)) score += 14;
      // Prefer colours that are still thick in the deck: more of that colour
      // already discarded means fewer left to draw into.
      score -= countDiscarded(ctx, color) * 0.4;
    }
    score += rng.int(2);
    if (score > bestScore) {
      best = color;
      bestScore = score;
    }
  }
  return best;
}

function countDiscarded(ctx: Context, color: Color): number {
  let count = 0;
  for (const card of ctx.view.discard) if (card.color === color) count++;
  return count;
}

/* ------------------------------------------------------------------ *
 * Challenges
 * ------------------------------------------------------------------ */

/**
 * Bots challenge on public evidence only. They cannot see whether the play
 * was a bluff — nobody at the table can.
 */
function shouldChallenge(ctx: Context, rng: Rng): boolean {
  const stack = ctx.view.room.drawStack;
  if (!stack) return false;
  if (ctx.level === 'easy') return false;
  if (ctx.level === 'normal') return rng.int(100) < 20;

  const target = ctx.opponents.find((p) => p.id === stack.playedBy);
  if (!target) return false;

  // The colour that was live before the Wild Draw Four landed: read it off
  // the card underneath, exactly as a human would.
  const beneath = ctx.view.discard[ctx.view.discard.length - 2];
  const previousColor = beneath && !isWild(beneath) ? beneath.color : null;

  // They already drew rather than play that colour this round — the play was
  // almost certainly honest.
  if (previousColor && hasPassedOn(ctx, target.id, previousColor)) return false;

  // Taking six would be worse than taking four if the bot is drowning.
  if (ctx.hand.length >= 12) return false;

  // A big hand is far more likely to be hiding a match.
  return rng.int(100) < (target.handCount >= 5 ? 45 : 15);
}
