/**
 * The 108-card deck, plus card-level helpers (matching, scoring, labels).
 *
 * Composition, per colour:
 *   one 0, two each of 1-9              -> 19
 *   two Skip, two Reverse, two Draw Two ->  6
 *                                          25 x 4 colours = 100
 *   four Wild + four Wild Draw Four     ->   8
 *                                          ------------------- 108
 */

import type { Card, CardKind, Color } from './types';
import { COLORS } from './types';
import type { Rng } from './rng';

export const DECK_SIZE = 108;

/** Short colour code used in card ids: r/y/g/b. */
const COLOR_CODE: Record<Color, string> = {
  red: 'r',
  yellow: 'y',
  green: 'g',
  blue: 'b',
};

const KIND_CODE: Record<Exclude<CardKind, 'number'>, string> = {
  skip: 's',
  reverse: 'v',
  draw2: 'd',
  wild: 'w',
  wild4: 'f',
};

/**
 * Builds a fresh, ordered deck. Ids are stable and unique so the client can
 * key animations off them and the server can verify card ownership.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of COLORS) {
    const c = COLOR_CODE[color];

    // One 0, two each of 1-9.
    deck.push({ id: `${c}0-0`, kind: 'number', color, digit: 0 });
    for (let digit = 1; digit <= 9; digit++) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: `${c}${digit}-${copy}`, kind: 'number', color, digit });
      }
    }

    // Two each of Skip, Reverse, Draw Two.
    for (const kind of ['skip', 'reverse', 'draw2'] as const) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: `${c}${KIND_CODE[kind]}-${copy}`, kind, color, digit: null });
      }
    }
  }

  // Four Wild, four Wild Draw Four.
  for (const kind of ['wild', 'wild4'] as const) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push({ id: `${KIND_CODE[kind]}-${copy}`, kind, color: null, digit: null });
    }
  }

  return deck;
}

/**
 * Fisher-Yates, drawing from the injected `Rng` (crypto-backed in production).
 * Returns a new array; the input is untouched.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function isWild(card: Card): boolean {
  return card.kind === 'wild' || card.kind === 'wild4';
}

export function isAction(card: Card): boolean {
  return card.kind === 'skip' || card.kind === 'reverse' || card.kind === 'draw2';
}

/** End-of-round scoring value. */
export function cardPoints(card: Card): number {
  switch (card.kind) {
    case 'number':
      return card.digit ?? 0;
    case 'skip':
    case 'reverse':
    case 'draw2':
      return 20;
    case 'wild':
    case 'wild4':
      return 50;
  }
}

export function handPoints(hand: readonly Card[]): number {
  let total = 0;
  for (const card of hand) total += cardPoints(card);
  return total;
}

/**
 * Do two cards have the same face? Used by jump-in, which requires an exact
 * match — same colour *and* same value.
 */
export function sameFace(a: Card, b: Card): boolean {
  return a.kind === b.kind && a.color === b.color && a.digit === b.digit;
}

/**
 * Base playability: matches the active colour, matches the top card's
 * number/symbol, or is a wild.
 *
 * Wild Draw Four's extra "no matching colour in hand" restriction is a
 * separate concern — see `canPlay` in `engine.ts`, since it depends on the
 * whole hand and on whether the challenge rule is enabled.
 */
export function matches(card: Card, top: Card, activeColor: Color | null): boolean {
  if (isWild(card)) return true;
  if (activeColor !== null && card.color === activeColor) return true;
  if (card.kind === 'number' && top.kind === 'number') return card.digit === top.digit;
  // Symbol match: Skip on Skip, Reverse on Reverse, Draw Two on Draw Two.
  return card.kind === top.kind && !isWild(top);
}

const KIND_LABEL: Record<CardKind, string> = {
  number: '',
  skip: 'Skip',
  reverse: 'Reverse',
  draw2: 'Draw Two',
  wild: 'Wild',
  wild4: 'Wild Draw Four',
};

const COLOR_LABEL: Record<Color, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
};

export function colorLabel(color: Color): string {
  return COLOR_LABEL[color];
}

/** Human-readable name, e.g. "Red 7", "Blue Skip", "Wild Draw Four". */
export function cardLabel(card: Card): string {
  if (card.kind === 'number') {
    return `${COLOR_LABEL[card.color as Color]} ${card.digit}`;
  }
  if (isWild(card)) return KIND_LABEL[card.kind];
  return `${COLOR_LABEL[card.color as Color]} ${KIND_LABEL[card.kind]}`;
}

/** Compact symbol for the card face: the digit, or a glyph for actions. */
export function cardSymbol(card: Card): string {
  switch (card.kind) {
    case 'number':
      return String(card.digit);
    case 'skip':
      return '⊘'; // circle with slash
    case 'reverse':
      return '⇄'; // paired arrows
    case 'draw2':
      return '+2';
    case 'wild':
      return '✦'; // four-pointed star
    case 'wild4':
      return '+4';
  }
}

/** Deterministic sort for a tidy hand: by colour, then kind, then digit. */
const KIND_ORDER: Record<CardKind, number> = {
  number: 0,
  skip: 1,
  reverse: 2,
  draw2: 3,
  wild: 4,
  wild4: 5,
};

export function sortHand(hand: readonly Card[]): Card[] {
  const colorIndex = (c: Color | null): number => (c === null ? COLORS.length : COLORS.indexOf(c));
  return hand.slice().sort((a, b) => {
    const ca = colorIndex(a.color);
    const cb = colorIndex(b.color);
    if (ca !== cb) return ca - cb;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return (a.digit ?? 0) - (b.digit ?? 0);
  });
}
