import { describe, expect, it } from 'vitest';
import { COLORS } from './types';
import { DECK_SIZE, cardLabel, cardPoints, createDeck, handPoints, matches, sameFace, shuffle, sortHand } from './deck';
import { seededRng } from './rng';
import { C } from './__tests__/helpers';

describe('deck composition', () => {
  const deck = createDeck();

  it('is exactly 108 cards', () => {
    expect(deck).toHaveLength(108);
    expect(deck).toHaveLength(DECK_SIZE);
  });

  it('gives every colour 25 cards: one 0, two each 1-9, two each of the three actions', () => {
    for (const color of COLORS) {
      const inColor = deck.filter((c) => c.color === color);
      expect(inColor, color).toHaveLength(25);

      const zeros = inColor.filter((c) => c.kind === 'number' && c.digit === 0);
      expect(zeros, `${color} zeros`).toHaveLength(1);

      for (let digit = 1; digit <= 9; digit++) {
        const cards = inColor.filter((c) => c.kind === 'number' && c.digit === digit);
        expect(cards, `${color} ${digit}s`).toHaveLength(2);
      }

      for (const kind of ['skip', 'reverse', 'draw2'] as const) {
        expect(inColor.filter((c) => c.kind === kind), `${color} ${kind}`).toHaveLength(2);
      }
    }
  });

  it('has four Wild and four Wild Draw Four, and no others without a colour', () => {
    expect(deck.filter((c) => c.kind === 'wild')).toHaveLength(4);
    expect(deck.filter((c) => c.kind === 'wild4')).toHaveLength(4);
    expect(deck.filter((c) => c.color === null)).toHaveLength(8);
  });

  it('adds up: 100 coloured + 8 wilds', () => {
    const colored = deck.filter((c) => c.color !== null);
    expect(colored).toHaveLength(100);
    expect(colored.length + 8).toBe(108);
  });

  it('gives every card a unique id', () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });

  it('totals 1240 points', () => {
    // 4 colours x (90 in numbers + 60 in actions) + 8 wilds x 50.
    expect(handPoints(deck)).toBe(1240);
  });
});

describe('shuffle', () => {
  it('is a permutation — no card gained, lost or duplicated', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, seededRng(1));
    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(deck.map((c) => c.id)));
  });

  it('does not mutate the input', () => {
    const deck = createDeck();
    const before = deck.map((c) => c.id).join(',');
    shuffle(deck, seededRng(2));
    expect(deck.map((c) => c.id).join(',')).toBe(before);
  });

  it('actually reorders, and differently for different seeds', () => {
    const deck = createDeck();
    const a = shuffle(deck, seededRng(1)).map((c) => c.id).join(',');
    const b = shuffle(deck, seededRng(2)).map((c) => c.id).join(',');
    expect(a).not.toBe(deck.map((c) => c.id).join(','));
    expect(a).not.toBe(b);
  });

  it('is reproducible for a given seed', () => {
    const deck = createDeck();
    expect(shuffle(deck, seededRng(9)).map((c) => c.id)).toEqual(shuffle(deck, seededRng(9)).map((c) => c.id));
  });

  it('spreads cards across positions rather than favouring one', () => {
    // A weak shuffle (or a biased modulo) shows up as a card that keeps
    // landing in the same place. Track one card over many shuffles.
    const deck = createDeck();
    const positions = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      positions.add(shuffle(deck, seededRng(seed)).findIndex((c) => c.id === 'r5-0'));
    }
    expect(positions.size).toBeGreaterThan(40);
  });
});

describe('card values', () => {
  it('scores numbers at face value, actions at 20, wilds at 50', () => {
    expect(cardPoints(C('r0'))).toBe(0);
    expect(cardPoints(C('r9'))).toBe(9);
    expect(cardPoints(C('bs'))).toBe(20);
    expect(cardPoints(C('gv'))).toBe(20);
    expect(cardPoints(C('yd'))).toBe(20);
    expect(cardPoints(C('w'))).toBe(50);
    expect(cardPoints(C('f'))).toBe(50);
  });

  it('labels cards with colour and symbol as words', () => {
    expect(cardLabel(C('r7'))).toBe('Red 7');
    expect(cardLabel(C('bs'))).toBe('Blue Skip');
    expect(cardLabel(C('gv'))).toBe('Green Reverse');
    expect(cardLabel(C('yd'))).toBe('Yellow Draw Two');
    expect(cardLabel(C('w'))).toBe('Wild');
    expect(cardLabel(C('f'))).toBe('Wild Draw Four');
  });
});

describe('matching', () => {
  it('matches on the active colour', () => {
    expect(matches(C('r3'), C('b7'), 'red')).toBe(true);
    expect(matches(C('r3'), C('b7'), 'blue')).toBe(false);
  });

  it('matches on the number regardless of colour', () => {
    expect(matches(C('r7'), C('b7'), 'blue')).toBe(true);
  });

  it('matches on the symbol regardless of colour', () => {
    expect(matches(C('rs'), C('bs'), 'blue')).toBe(true);
    expect(matches(C('rv'), C('bs'), 'blue')).toBe(false);
  });

  it('lets wilds go on anything', () => {
    expect(matches(C('w'), C('b7'), 'blue')).toBe(true);
    expect(matches(C('f'), C('b7'), 'blue')).toBe(true);
  });

  it('never symbol-matches a wild on top', () => {
    // The active colour is what matters once a wild has been played.
    expect(matches(C('r3'), C('w'), 'red')).toBe(true);
    expect(matches(C('b3'), C('w'), 'red')).toBe(false);
  });

  it('treats jump-in matching as colour *and* value', () => {
    expect(sameFace(C('r7'), C('r7', 1))).toBe(true);
    expect(sameFace(C('r7'), C('b7'))).toBe(false);
    expect(sameFace(C('rs'), C('rv'))).toBe(false);
  });
});

describe('sortHand', () => {
  it('groups by colour then kind, wilds last, and leaves the input alone', () => {
    const hand = [C('w'), C('b3'), C('r9'), C('rs'), C('r2')];
    const sorted = sortHand(hand);
    expect(sorted.map((c) => c.id)).toEqual(['r2-0', 'r9-0', 'rs-0', 'b3-0', 'w-0']);
    expect(hand.map((c) => c.id)).toEqual(['w-0', 'b3-0', 'r9-0', 'rs-0', 'r2-0']);
  });
});
