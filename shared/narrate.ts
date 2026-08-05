/**
 * Turns game events into the one-line system messages that scroll in chat.
 *
 * Shared so the server can write them into the chat log (late joiners get the
 * history) and the client can render exactly the same wording live.
 */

import type { GameEvent } from './types';
import { cardLabel, colorLabel } from './deck';

export type NameLookup = (playerId: string) => string;

/** Returns `null` for events that do not deserve a line in the log. */
export function describeEvent(event: GameEvent, nameOf: NameLookup): string | null {
  switch (event.t) {
    case 'roundStart':
      return `Round ${event.round} — ${nameOf(event.startingId)} starts on ${cardLabel(event.topCard)}.`;
    case 'played':
      return event.jumpIn
        ? `${nameOf(event.playerId)} jumped in with ${cardLabel(event.card)}.`
        : `${nameOf(event.playerId)} played ${cardLabel(event.card)}.`;
    case 'drew':
      return event.count === 1
        ? `${nameOf(event.playerId)} drew a card.`
        : `${nameOf(event.playerId)} drew ${event.count} cards.`;
    case 'colorChosen':
      return `${nameOf(event.playerId)} chose ${colorLabel(event.color)}.`;
    case 'skipped':
      return `${nameOf(event.playerId)} was skipped.`;
    case 'reversed':
      return 'Direction reversed.';
    case 'reshuffled':
      return `Deck ran out — ${event.count} cards reshuffled.`;
    case 'unoCalled':
      return `${nameOf(event.playerId)} called UNO!`;
    case 'unoCaught':
      return `${nameOf(event.byId)} caught ${nameOf(event.targetId)} — ${event.penalty} cards.`;
    case 'unoMissed':
      return `${nameOf(event.playerId)} never called UNO, and got away with it.`;
    case 'falseAccusation':
      return `${nameOf(event.byId)} was too slow to catch ${nameOf(event.targetId)} — ${event.penalty} cards.`;
    case 'challenged':
      return event.success
        ? `${nameOf(event.challengerId)} challenged ${nameOf(event.targetId)} and won — ${event.penalty} cards to ${nameOf(event.targetId)}.`
        : `${nameOf(event.challengerId)} challenged ${nameOf(event.targetId)} and lost — ${event.penalty} cards.`;
    case 'handsSwapped':
      return `${nameOf(event.aId)} swapped hands with ${nameOf(event.bId)}.`;
    case 'handsRotated':
      return 'Everyone passed their hand along.';
    case 'penalty':
      return event.reason === 'drawStack' && event.count > 0
        ? `${nameOf(event.playerId)} drew ${event.count}.`
        : null;
    case 'timedOut':
      return `${nameOf(event.playerId)} ran out of time.`;
    case 'roundOver':
      return `${nameOf(event.result.winnerId)} went out and scored ${event.result.points}.`;
    case 'matchOver':
      return `${nameOf(event.winnerId)} wins the match!`;
    case 'playerJoined':
      return `${event.name} joined.`;
    case 'playerLeft':
      return `${event.name} left.`;
    case 'playerReconnected':
      return `${event.name} reconnected.`;
    case 'botTookOver':
      return `A bot is playing ${event.name}'s seat.`;
    case 'turnStart':
    case 'unoWindowClosed':
    case 'handRevealed':
      return null;
  }
}
