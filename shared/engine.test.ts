import { describe, expect, it } from 'vitest';
import type { CardKind, RoomState, RuleSet } from './types';
import {
  UNO_WINDOW_MS,
  applyIntent,
  expireUnoWindow,
  legalMoves,
  serializeFor,
  startMatch,
  startNextRound,
  startRound,
  timeoutTurn,
  topCard,
} from './engine';
import { seededRng } from './rng';
import { allCardIds, ctx, errorCode, handSize, lobby, ok, table, turnId } from './__tests__/helpers';

/** Finds a deal whose flipped starting card is of the given kind. */
function roundWithTop(kind: CardKind, count = 4, rules?: Partial<RuleSet>) {
  for (let seed = 1; seed < 2000; seed++) {
    const result = ok(startRound(lobby(count, rules), 0, { rng: seededRng(seed), now: 1000 }));
    if (topCard(result.state)?.kind === kind) return result;
  }
  throw new Error(`no seed produced a ${kind} starting card`);
}

/** Every card is somewhere, exactly once. */
function expectDeckIntact(state: RoomState) {
  const ids = allCardIds(state);
  expect(ids).toHaveLength(108);
  expect(new Set(ids).size).toBe(108);
}

/* ================================================================== *
 * Setup
 * ================================================================== */

describe('round setup', () => {
  it('deals seven cards each and flips one', () => {
    const result = roundWithTop('number', 4);
    for (const player of result.state.players) expect(player.hand).toHaveLength(7);
    expect(result.state.discard).toHaveLength(1);
    expect(result.state.drawPile).toHaveLength(108 - 28 - 1);
    expectDeckIntact(result.state);
  });

  it('never starts on a Wild Draw Four — it goes back and the deck is reshuffled', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const result = ok(startRound(lobby(4), 0, { rng: seededRng(seed), now: 0 }));
      expect(topCard(result.state)?.kind).not.toBe('wild4');
      expectDeckIntact(result.state);
    }
  });

  it('lets the first player choose the colour when the flip is a Wild', () => {
    const result = roundWithTop('wild');
    expect(result.state.pending).toMatchObject({ kind: 'color', playerId: 'p0', source: 'initial' });
    expect(result.state.activeColor).toBeNull();
    expect(turnId(result.state)).toBe('p0');

    const chosen = ok(applyIntent(result.state, 'p0', { type: 'CHOOSE_COLOR', color: 'green' }, ctx()));
    expect(chosen.state.activeColor).toBe('green');
    expect(chosen.state.pending).toBeNull();
    // They named the colour and now take their turn — play has not moved on.
    expect(turnId(chosen.state)).toBe('p0');
  });

  it('skips the first player when the flip is a Skip', () => {
    const result = roundWithTop('skip');
    expect(turnId(result.state)).toBe('p1');
    expect(result.events).toContainEqual({ t: 'skipped', playerId: 'p0' });
  });

  it('flips direction and starts the other way round when the flip is a Reverse', () => {
    const result = roundWithTop('reverse');
    expect(result.state.direction).toBe(-1);
    expect(turnId(result.state)).toBe('p3');
  });

  it('with two players a starting Reverse hands play to the other seat', () => {
    const result = roundWithTop('reverse', 2);
    expect(turnId(result.state)).toBe('p1');
  });

  it('makes the first player draw two and lose their turn when the flip is a Draw Two', () => {
    const result = roundWithTop('draw2');
    expect(result.state.players[0].hand).toHaveLength(9);
    expect(turnId(result.state)).toBe('p1');
    expectDeckIntact(result.state);
  });

  it('refuses to start without two players', () => {
    expect(errorCode(startMatch(lobby(1), ctx()))).toBe('not_enough_players');
  });
});

/* ================================================================== *
 * Turn flow and action cards
 * ================================================================== */

describe('playing cards', () => {
  it('accepts a colour match, a number match and a wild, and rejects the rest', () => {
    const state = table({ hands: { A: ['r3', 'b1', 'g8', 'w'], B: ['b5'] }, top: 'r1' });
    const moves = legalMoves(state, 'A');
    // r3 matches the colour, b1 matches the number, w is a wild. g8 matches nothing.
    expect(moves.playable.sort()).toEqual(['b1-0', 'r3-0', 'w-0']);
    expect(errorCode(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'g8-0' }, ctx()))).toBe('illegal_card');
  });

  it('refuses a card the player does not hold, and out-of-turn plays', () => {
    const state = table({ hands: { A: ['r3'], B: ['b5', 'r4'] }, top: 'r1' });
    expect(errorCode(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r9-0' }, ctx()))).toBe('no_such_card');
    expect(errorCode(applyIntent(state, 'B', { type: 'PLAY_CARD', cardId: 'r4-0' }, ctx()))).toBe('not_your_turn');
  });

  it('Skip makes the next player lose their turn', () => {
    const state = table({ hands: { A: ['rs', 'r9'], B: ['b5'], C: ['g5'] }, top: 'r1' });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rs-0' }, ctx()));
    expect(turnId(result.state)).toBe('C');
    expect(result.events).toContainEqual({ t: 'skipped', playerId: 'B' });
  });

  it('Reverse flips direction and hands play backwards', () => {
    const state = table({ hands: { A: ['rv', 'r9'], B: ['b5'], C: ['g5'] }, top: 'r1' });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rv-0' }, ctx()));
    expect(result.state.direction).toBe(-1);
    expect(turnId(result.state)).toBe('C');
  });

  it('Reverse acts as a Skip with exactly two players — the player goes again', () => {
    const state = table({ hands: { A: ['rv', 'r9', 'r8'], B: ['b5', 'b6'] }, top: 'r1' });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rv-0' }, ctx()));
    expect(turnId(result.state)).toBe('A');
    expect(result.state.direction).toBe(-1);
    expect(result.events).toContainEqual({ t: 'skipped', playerId: 'B' });

    // And again, to prove it is repeatable rather than an off-by-one.
    const again = ok(applyIntent(result.state, 'A', { type: 'PLAY_CARD', cardId: 'r9-0' }, ctx()));
    expect(turnId(again.state)).toBe('B');
  });

  it('Draw Two makes the next player draw two and forfeit their turn', () => {
    const state = table({
      hands: { A: ['rd', 'r9'], B: ['b5'], C: ['g5'] },
      top: 'r1',
      drawPile: ['y7', 'y8'],
    });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rd-0' }, ctx()));
    expect(handSize(result.state, 'B')).toBe(3);
    expect(turnId(result.state)).toBe('C');
  });

  it('Wild holds the turn until a colour is named', () => {
    const state = table({ hands: { A: ['w', 'r9'], B: ['b5'] }, top: 'r1' });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'w-0' }, ctx()));
    expect(played.state.pending).toMatchObject({ kind: 'color', playerId: 'A', source: 'wild' });
    expect(turnId(played.state)).toBe('A');
    expect(errorCode(applyIntent(played.state, 'B', { type: 'PLAY_CARD', cardId: 'b5-0' }, ctx()))).toBe('resolve_first');

    const chosen = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_COLOR', color: 'blue' }, ctx()));
    expect(chosen.state.activeColor).toBe('blue');
    expect(turnId(chosen.state)).toBe('B');
  });

  it('lets a player draw, then either play the drawn card or keep it', () => {
    const state = table({ hands: { A: ['g8'], B: ['b5'] }, top: 'r1', drawPile: ['r4'] });
    const drawn = ok(applyIntent(state, 'A', { type: 'DRAW' }, ctx()));
    expect(drawn.state.pending).toEqual({ kind: 'drawn', playerId: 'A', cardId: 'r4-0' });
    expect(turnId(drawn.state)).toBe('A');
    // Only the card just drawn may be played.
    expect(errorCode(applyIntent(drawn.state, 'A', { type: 'PLAY_CARD', cardId: 'g8-0' }, ctx()))).toBe('must_play_drawn');

    const played = ok(applyIntent(drawn.state, 'A', { type: 'PLAY_CARD', cardId: 'r4-0' }, ctx()));
    expect(turnId(played.state)).toBe('B');

    const kept = ok(applyIntent(drawn.state, 'A', { type: 'PASS' }, ctx()));
    expect(handSize(kept.state, 'A')).toBe(2);
    expect(turnId(kept.state)).toBe('B');
  });

  it('ends the turn straight away when the drawn card is unplayable', () => {
    const state = table({ hands: { A: ['g8'], B: ['b5'] }, top: 'r1', drawPile: ['b4'] });
    const drawn = ok(applyIntent(state, 'A', { type: 'DRAW' }, ctx()));
    expect(drawn.state.pending).toBeNull();
    expect(turnId(drawn.state)).toBe('B');
  });

  it('draw-to-match keeps drawing until something is playable', () => {
    const state = table({
      hands: { A: ['g8'], B: ['b5'] },
      top: 'r1',
      rules: { drawToMatch: true },
      drawPile: ['b4', 'g6', 'y2', 'r5', 'b7'],
    });
    const drawn = ok(applyIntent(state, 'A', { type: 'DRAW' }, ctx()));
    expect(handSize(drawn.state, 'A')).toBe(5); // g8 + b4, g6, y2, r5
    expect(drawn.state.pending).toEqual({ kind: 'drawn', playerId: 'A', cardId: 'r5-0' });
  });
});

/* ================================================================== *
 * Wild Draw Four and the challenge
 * ================================================================== */

describe('Wild Draw Four', () => {
  const bluffTable = (rules: Partial<RuleSet>) =>
    table({
      // A is holding a red card while red is live: playing the Wild Draw Four
      // here is a bluff.
      hands: { A: ['f', 'r9'], B: ['b5', 'b6'], C: ['g5', 'g6'] },
      top: 'r1',
      rules,
      drawPile: ['y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8', 'y9'],
    });

  const honestTable = (rules: Partial<RuleSet>) =>
    table({
      // A holds nothing red — an honest Wild Draw Four.
      hands: { A: ['f', 'b9'], B: ['b5', 'b6'], C: ['g5', 'g6'] },
      top: 'r1',
      rules,
      drawPile: ['y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8', 'y9'],
    });

  it('is refused with a matching colour in hand when there is no challenge rule to punish it', () => {
    const state = bluffTable({ challenge: false });
    expect(errorCode(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx()))).toBe('illegal_card');
  });

  it('is allowed without a matching colour, and the next player draws four and is skipped', () => {
    const state = honestTable({ challenge: false });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx()));
    const chosen = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx()));
    expect(chosen.state.activeColor).toBe('yellow');
    expect(handSize(chosen.state, 'B')).toBe(6);
    expect(turnId(chosen.state)).toBe('C');
  });

  it('with the challenge rule on, the bluff is allowed and the target decides', () => {
    const state = bluffTable({ challenge: true });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx()));
    const chosen = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx()));
    expect(chosen.state.drawStack).toMatchObject({ count: 4, kind: 'wild4', playedBy: 'A', challengeable: true });
    expect(turnId(chosen.state)).toBe('B');
    // B has not drawn yet — the cards are owed, not taken.
    expect(handSize(chosen.state, 'B')).toBe(2);
  });

  it('challenging a bluff makes the bluffer draw, and the challenger keeps their turn', () => {
    const state = bluffTable({ challenge: true });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx()));
    const chosen = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx()));
    const challenged = ok(applyIntent(chosen.state, 'B', { type: 'CHALLENGE' }, ctx()));

    expect(handSize(challenged.state, 'A')).toBe(5); // 1 left + 4 drawn
    expect(handSize(challenged.state, 'B')).toBe(2); // untouched
    expect(challenged.state.drawStack).toBeNull();
    expect(turnId(challenged.state)).toBe('B');
    expect(challenged.events).toContainEqual(
      expect.objectContaining({ t: 'challenged', success: true, challengerId: 'B', targetId: 'A' }),
    );
  });

  it('challenging an honest play costs the challenger six and their turn', () => {
    const state = honestTable({ challenge: true });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx()));
    const chosen = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx()));
    const challenged = ok(applyIntent(chosen.state, 'B', { type: 'CHALLENGE' }, ctx()));

    expect(handSize(challenged.state, 'B')).toBe(8); // 2 + 4 + 2
    expect(handSize(challenged.state, 'A')).toBe(1); // untouched
    expect(turnId(challenged.state)).toBe('C');
    expect(challenged.events).toContainEqual(
      expect.objectContaining({ t: 'challenged', success: false, challengerId: 'B', targetId: 'A' }),
    );
  });

  it('reveals the challenged hand to the challenger and to nobody else', () => {
    const state = bluffTable({ challenge: true });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx()));
    const chosen = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx()));
    const challenged = ok(applyIntent(chosen.state, 'B', { type: 'CHALLENGE' }, ctx()));

    const reveals = challenged.events.filter((e) => e.t === 'handRevealed');
    expect(reveals).toHaveLength(1);
    expect(reveals[0]).toMatchObject({ playerId: 'A', to: 'B' });
  });

  it('only the player facing it may challenge, and only while it is unresolved', () => {
    const state = bluffTable({ challenge: true });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx()));
    const chosen = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx()));
    expect(errorCode(applyIntent(chosen.state, 'C', { type: 'CHALLENGE' }, ctx()))).toBe('not_your_turn');

    const accepted = ok(applyIntent(chosen.state, 'B', { type: 'DRAW' }, ctx()));
    expect(handSize(accepted.state, 'B')).toBe(6);
    expect(turnId(accepted.state)).toBe('C');
    expect(errorCode(applyIntent(accepted.state, 'C', { type: 'CHALLENGE' }, ctx()))).toBe('nothing_to_challenge');
  });
});

/* ================================================================== *
 * Stacking
 * ================================================================== */

describe('stacking', () => {
  const four = (rules: Partial<RuleSet>) =>
    table({
      hands: { A: ['rd', 'r9'], B: ['bd', 'b9'], C: ['gd', 'g9'], D: ['y5'] },
      top: 'r1',
      rules,
      drawPile: ['y2', 'y3', 'y4', 'y6', 'y7', 'y8', 'b2', 'b3'],
    });

  it('accumulates Draw Twos down the line until somebody takes them', () => {
    let state = four({ stacking: true });
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rd-0' }, ctx())).state;
    expect(state.drawStack).toMatchObject({ count: 2, kind: 'draw2' });

    state = ok(applyIntent(state, 'B', { type: 'PLAY_CARD', cardId: 'bd-0' }, ctx())).state;
    expect(state.drawStack).toMatchObject({ count: 4 });

    state = ok(applyIntent(state, 'C', { type: 'PLAY_CARD', cardId: 'gd-0' }, ctx())).state;
    expect(state.drawStack).toMatchObject({ count: 6 });
    expect(turnId(state)).toBe('D');

    // D cannot answer with an ordinary card.
    expect(errorCode(applyIntent(state, 'D', { type: 'PLAY_CARD', cardId: 'y5-0' }, ctx()))).toBe('cannot_stack');

    const taken = ok(applyIntent(state, 'D', { type: 'DRAW' }, ctx()));
    expect(handSize(taken.state, 'D')).toBe(7); // 1 + 6
    expect(taken.state.drawStack).toBeNull();
    expect(turnId(taken.state)).toBe('A');
  });

  it('resolves immediately when stacking is off', () => {
    const state = four({ stacking: false });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rd-0' }, ctx()));
    expect(played.state.drawStack).toBeNull();
    expect(handSize(played.state, 'B')).toBe(4);
    expect(turnId(played.state)).toBe('C');
  });

  it('stacks Wild Draw Fours on each other, four at a time', () => {
    let state = table({
      hands: { A: ['f', 'b9'], B: ['f', 'b8'], C: ['g5'] },
      top: 'r1',
      rules: { stacking: true, challenge: false },
      drawPile: ['y2', 'y3', 'y4', 'y6', 'y7', 'y8', 'b2', 'b3', 'b4'],
    });
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx())).state;
    state = ok(applyIntent(state, 'A', { type: 'CHOOSE_COLOR', color: 'blue' }, ctx())).state;
    expect(state.drawStack).toMatchObject({ count: 4, kind: 'wild4' });

    state = ok(applyIntent(state, 'B', { type: 'PLAY_CARD', cardId: 'f-1' }, ctx())).state;
    state = ok(applyIntent(state, 'B', { type: 'CHOOSE_COLOR', color: 'green' }, ctx())).state;
    expect(state.drawStack).toMatchObject({ count: 8, kind: 'wild4' });

    const taken = ok(applyIntent(state, 'C', { type: 'DRAW' }, ctx()));
    expect(handSize(taken.state, 'C')).toBe(9); // 1 + 8
  });

  it('does not let a Draw Two answer a Wild Draw Four, or the other way round', () => {
    let state = table({
      hands: { A: ['f', 'b9'], B: ['bd', 'b8'], C: ['g5'] },
      top: 'r1',
      rules: { stacking: true, challenge: false },
    });
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx())).state;
    state = ok(applyIntent(state, 'A', { type: 'CHOOSE_COLOR', color: 'blue' }, ctx())).state;
    expect(errorCode(applyIntent(state, 'B', { type: 'PLAY_CARD', cardId: 'bd-0' }, ctx()))).toBe('cannot_stack');
  });

  it('refuses to stack at all when the rule is off', () => {
    let state = table({
      hands: { A: ['rd', 'r9'], B: ['bd', 'b9'], C: ['g5'] },
      top: 'r1',
      rules: { stacking: false },
    });
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rd-0' }, ctx())).state;
    // B already drew and was skipped, so it is C's turn and there is no stack.
    expect(turnId(state)).toBe('C');
    expect(state.drawStack).toBeNull();
  });
});

/* ================================================================== *
 * Jump-in
 * ================================================================== */

describe('jump-in', () => {
  const jumpTable = (rules: Partial<RuleSet>) =>
    table({
      hands: { A: ['r7', 'b2'], B: ['b5', 'b6'], C: ['r7', 'g3'], D: ['y4', 'y5'] },
      top: 'r1',
      rules,
    });

  it('lets an exact match play out of turn, and play resumes from the jumper', () => {
    const state = jumpTable({ jumpIn: true });
    const first = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(turnId(first.state)).toBe('B');

    const jumped = ok(applyIntent(first.state, 'C', { type: 'PLAY_CARD', cardId: 'r7-1' }, ctx()));
    expect(jumped.events).toContainEqual(expect.objectContaining({ t: 'played', playerId: 'C', jumpIn: true }));
    // Play continues from C, so B and everyone between simply lost their turn.
    expect(turnId(jumped.state)).toBe('D');
    expect(topCard(jumped.state)?.id).toBe('r7-1');
    expect(handSize(jumped.state, 'C')).toBe(1);
  });

  it('requires colour *and* value to match', () => {
    const state = table({
      hands: { A: ['r7', 'b2'], B: ['b5'], C: ['b7', 'g3'] },
      top: 'r1',
      rules: { jumpIn: true },
    });
    const first = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(errorCode(applyIntent(first.state, 'C', { type: 'PLAY_CARD', cardId: 'b7-0' }, ctx()))).toBe('not_exact_match');
  });

  it('does not let you jump in on your own card', () => {
    const state = table({
      hands: { A: ['r7', 'r7'], B: ['b5'], C: ['g3'] },
      top: 'r1',
      rules: { jumpIn: true },
    });
    const first = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(errorCode(applyIntent(first.state, 'A', { type: 'PLAY_CARD', cardId: 'r7-1' }, ctx()))).toBe('no_self_jump');
  });

  it('is refused entirely when the rule is off', () => {
    const state = jumpTable({ jumpIn: false });
    const first = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(errorCode(applyIntent(first.state, 'C', { type: 'PLAY_CARD', cardId: 'r7-1' }, ctx()))).toBe('not_your_turn');
    expect(legalMoves(first.state, 'C').jumpIn).toEqual([]);
  });

  it('applies the jumped-in card’s effect from the jumper’s seat', () => {
    const state = table({
      hands: { A: ['rs', 'b2'], B: ['b5', 'b6'], C: ['rs', 'g3'], D: ['y4'] },
      top: 'r1',
      rules: { jumpIn: true },
    });
    const first = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rs-0' }, ctx()));
    expect(turnId(first.state)).toBe('C'); // B skipped

    const jumped = ok(applyIntent(first.state, 'C', { type: 'PLAY_CARD', cardId: 'rs-1' }, ctx()));
    // C jumped in with a Skip, so D loses their turn and it comes back to A.
    expect(turnId(jumped.state)).toBe('A');
    expect(jumped.events).toContainEqual({ t: 'skipped', playerId: 'D' });
  });

  it('advertises jump-in candidates only to players who are not on turn', () => {
    const state = jumpTable({ jumpIn: true });
    const first = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(legalMoves(first.state, 'C').jumpIn).toEqual(['r7-1']);
    expect(legalMoves(first.state, 'A').jumpIn).toEqual([]); // played it themselves
    expect(legalMoves(first.state, 'B').jumpIn).toEqual([]); // on turn anyway
  });
});

/* ================================================================== *
 * UNO
 * ================================================================== */

describe('calling UNO', () => {
  const unoTable = () =>
    table({
      hands: { A: ['r3', 'r4'], B: ['b5', 'b6'], C: ['g5', 'g6'] },
      top: 'r1',
      drawPile: ['y7', 'y8', 'y9', 'b2'],
    });

  it('opens a three second window when a player drops to one card', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000)));
    expect(played.state.uno).toEqual({
      playerId: 'A',
      deadline: 1000 + UNO_WINDOW_MS,
      called: false,
      accusers: [],
    });
  });

  it('lets an opponent catch a silent player for two cards', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000)));
    const caught = ok(applyIntent(played.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1500)));
    expect(handSize(caught.state, 'A')).toBe(3);
    expect(caught.state.uno).toBeNull();
    expect(caught.events).toContainEqual({ t: 'unoCaught', byId: 'B', targetId: 'A', penalty: 2 });
  });

  it('punishes a late accusation by two cards instead', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0', declareUno: true }, ctx(1000)));
    expect(played.state.uno?.called).toBe(true);
    const accused = ok(applyIntent(played.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1500)));
    expect(handSize(accused.state, 'A')).toBe(1);
    expect(handSize(accused.state, 'B')).toBe(4);
    expect(accused.events).toContainEqual({ t: 'falseAccusation', byId: 'B', targetId: 'A', penalty: 2 });
  });

  it('resolves the race by arrival order — call first and the accuser pays', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000)));

    const calledFirst = ok(applyIntent(played.state, 'A', { type: 'CALL_UNO' }, ctx(1200)));
    const thenCaught = ok(applyIntent(calledFirst.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1201)));
    expect(handSize(thenCaught.state, 'A')).toBe(1);
    expect(handSize(thenCaught.state, 'B')).toBe(4);

    // The same two messages the other way round land the penalty on A.
    const caughtFirst = ok(applyIntent(played.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1200)));
    expect(handSize(caughtFirst.state, 'A')).toBe(3);
    expect(errorCode(applyIntent(caughtFirst.state, 'A', { type: 'CALL_UNO' }, ctx(1201)))).toBe('no_uno_window');
  });

  it('gives each opponent one attempt', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0', declareUno: true }, ctx(1000)));
    const once = ok(applyIntent(played.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1100)));
    expect(errorCode(applyIntent(once.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1200)))).toBe('already_accused');
    // C still has theirs.
    expect(ok(applyIntent(once.state, 'C', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1200))).ok).toBe(true);
  });

  it('closes the window after three seconds, after which nobody can be caught', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000)));
    expect(errorCode(expireUnoWindow(played.state, ctx(2000)))).toBe('too_early');

    const closed = ok(expireUnoWindow(played.state, ctx(1000 + UNO_WINDOW_MS)));
    expect(closed.state.uno).toBeNull();
    expect(closed.events).toContainEqual({ t: 'unoMissed', playerId: 'A' });
    expect(errorCode(applyIntent(closed.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(5000)))).toBe('nothing_to_catch');
  });

  it('refuses a catch that arrives after the deadline even if the window is still on the state', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000)));
    expect(errorCode(applyIntent(played.state, 'B', { type: 'CATCH_UNO', targetId: 'A' }, ctx(9999)))).toBe('window_closed');
  });

  it('does not let a player catch themselves or catch nobody', () => {
    const played = ok(applyIntent(unoTable(), 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000)));
    expect(errorCode(applyIntent(played.state, 'A', { type: 'CATCH_UNO', targetId: 'A' }, ctx(1100)))).toBe('nothing_to_catch');
    expect(errorCode(applyIntent(played.state, 'B', { type: 'CATCH_UNO', targetId: 'C' }, ctx(1100)))).toBe('nothing_to_catch');
  });
});

/* ================================================================== *
 * Deck exhaustion
 * ================================================================== */

describe('running out of cards', () => {
  it('reshuffles the discard pile back into the deck, keeping the top card', () => {
    const state = table({
      hands: { A: ['g8'], B: ['b5'] },
      top: 'g1',
      buried: ['r2', 'y4', 'y5', 'b6'],
      drawPile: [],
    });
    const drawn = ok(applyIntent(state, 'A', { type: 'DRAW' }, ctx()));

    expect(drawn.events).toContainEqual({ t: 'reshuffled', count: 4 });
    expect(drawn.state.discard).toHaveLength(1);
    expect(topCard(drawn.state)?.id).toBe('g1-0');
    expect(handSize(drawn.state, 'A')).toBe(2);
    expect(drawn.state.drawPile).toHaveLength(3);
    expect(turnId(drawn.state)).toBe('B');
  });

  it('draws nothing at all when both piles are empty, and play carries on', () => {
    const state = table({ hands: { A: ['g8'], B: ['b5'] }, top: 'g1', drawPile: [] });
    const drawn = ok(applyIntent(state, 'A', { type: 'DRAW' }, ctx()));
    expect(handSize(drawn.state, 'A')).toBe(1);
    expect(drawn.state.drawPile).toHaveLength(0);
    expect(drawn.events.some((e) => e.t === 'drew')).toBe(false);
    expect(turnId(drawn.state)).toBe('B');
  });

  it('hands out as much of a penalty as it can and no more', () => {
    const state = table({
      hands: { A: ['rd', 'r9'], B: ['b5'], C: ['g5'] },
      top: 'r1',
      drawPile: [],
    });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rd-0' }, ctx()));
    // The only card left anywhere was the one under the discard, so a
    // two-card penalty could only find one.
    expect(handSize(played.state, 'B')).toBe(2);
    expect(played.events).toContainEqual({ t: 'penalty', playerId: 'B', count: 1, reason: 'drawStack' });
  });
});

/* ================================================================== *
 * 7-0
 * ================================================================== */

describe('7-0', () => {
  it('swaps hands with a chosen player on a 7', () => {
    const state = table({
      hands: { A: ['r7', 'b2'], B: ['b5', 'b6', 'b7'], C: ['g3'] },
      top: 'r1',
      rules: { sevenZero: true },
    });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(played.state.pending).toMatchObject({ kind: 'swap', playerId: 'A' });
    expect(turnId(played.state)).toBe('A');

    const swapped = ok(applyIntent(played.state, 'A', { type: 'CHOOSE_PLAYER', playerId: 'B' }, ctx()));
    expect(handSize(swapped.state, 'A')).toBe(3);
    expect(handSize(swapped.state, 'B')).toBe(1);
    expect(turnId(swapped.state)).toBe('B');
  });

  it('swaps with the only opponent automatically in a two-player game', () => {
    const state = table({
      hands: { A: ['r7', 'b2'], B: ['b5', 'b6', 'b7'] },
      top: 'r1',
      rules: { sevenZero: true },
    });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(played.state.pending).toBeNull();
    expect(handSize(played.state, 'A')).toBe(3);
    expect(handSize(played.state, 'B')).toBe(1);
  });

  it('rotates every hand in the direction of play on a 0', () => {
    const state = table({
      hands: { A: ['r0', 'b2'], B: ['b5', 'b6'], C: ['g3', 'g4', 'g5'] },
      top: 'r1',
      rules: { sevenZero: true },
    });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r0-0' }, ctx()));
    // A had 1 left, B had 2, C had 3 — everything moves one seat forward.
    expect(handSize(played.state, 'B')).toBe(1);
    expect(handSize(played.state, 'C')).toBe(2);
    expect(handSize(played.state, 'A')).toBe(3);
    expect(played.events).toContainEqual({ t: 'handsRotated', direction: 1 });
  });

  it('leaves 7 and 0 as ordinary numbers when the rule is off', () => {
    const state = table({
      hands: { A: ['r7', 'b2'], B: ['b5', 'b6', 'b7'] },
      top: 'r1',
    });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r7-0' }, ctx()));
    expect(played.state.pending).toBeNull();
    expect(handSize(played.state, 'A')).toBe(1);
    expect(handSize(played.state, 'B')).toBe(3);
  });
});

/* ================================================================== *
 * Scoring, rounds and match end
 * ================================================================== */

describe('scoring', () => {
  it('scores every opponent hand: numbers at face value, actions 20, wilds 50', () => {
    const state = table({
      hands: { A: ['r3'], B: ['r9', 'bs', 'w'], C: ['g0', 'g5', 'yd'] },
      top: 'r1',
    });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx()));
    const round = result.state.result;

    expect(round?.winnerId).toBe('A');
    expect(round?.handPoints).toEqual({ A: 0, B: 9 + 20 + 50, C: 0 + 5 + 20 });
    expect(round?.points).toBe(79 + 25);
    expect(result.state.players[0].score).toBe(104);
    expect(result.state.phase).toBe('roundOver');
    expect(round?.hands.B.map((c) => c.id)).toEqual(['r9-0', 'bs-0', 'w-0']);
  });

  it('makes the next player take a final Draw Two, which counts against them', () => {
    const state = table({
      hands: { A: ['rd'], B: ['r9'], C: ['g5'] },
      top: 'r1',
      drawPile: ['y7', 'y8'],
    });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rd-0' }, ctx()));
    expect(handSize(result.state, 'B')).toBe(3);
    expect(result.state.result?.handPoints.B).toBe(9 + 7 + 8);
  });

  it('ends the match at the target score', () => {
    const state = table({
      hands: { A: ['r3'], B: ['r9', 'bs', 'w'], C: ['g0'] },
      top: 'r1',
      scores: { A: 450, B: 120, C: 90 },
    });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx()));
    expect(result.state.players[0].score).toBe(450 + 79);
    expect(result.state.phase).toBe('matchOver');
    expect(result.state.matchWinnerId).toBe('A');
    expect(result.events).toContainEqual({ t: 'matchOver', winnerId: 'A' });
  });

  it('keeps playing below the target score, and deals the next round from the seat after the winner', () => {
    const state = table({
      hands: { A: ['r3'], B: ['r9'], C: ['g0'] },
      top: 'r1',
      scores: { A: 10, B: 0, C: 0 },
    });
    const finished = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx()));
    expect(finished.state.phase).toBe('roundOver');

    const next = ok(startNextRound(finished.state, ctx()));
    expect(next.state.phase).toBe('playing');
    expect(next.state.round).toBe(2);
    expect(next.state.players.every((p) => p.hand.length >= 7)).toBe(true);
    expect(next.state.players[0].score).toBe(19); // carried over
    expectDeckIntact(next.state);
  });

  it('stops after one round in single-round mode', () => {
    const state = table({
      hands: { A: ['r3'], B: ['r9'], C: ['g0'] },
      top: 'r1',
      rules: { matchMode: 'single' },
    });
    const result = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx()));
    expect(result.state.phase).toBe('matchOver');
    expect(result.state.matchWinnerId).toBe('A');
  });

  it('refuses every intent once the round is over', () => {
    const state = table({ hands: { A: ['r3'], B: ['r9'] }, top: 'r1' });
    const finished = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx()));
    expect(errorCode(applyIntent(finished.state, 'B', { type: 'PLAY_CARD', cardId: 'r9-0' }, ctx()))).toBe('not_playing');
  });
});

/* ================================================================== *
 * The turn clock
 * ================================================================== */

describe('turn timer', () => {
  it('sets a deadline only when the rule is on', () => {
    const off = table({ hands: { A: ['r3', 'r4'], B: ['b5'] }, top: 'r1' });
    expect(ok(applyIntent(off, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000))).state.turnDeadline).toBeNull();

    const on = table({ hands: { A: ['r3', 'r4'], B: ['b5'] }, top: 'r1', rules: { turnTimer: 30 } });
    expect(ok(applyIntent(on, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx(1000))).state.turnDeadline).toBe(31_000);
  });

  it('draws and passes for a player who runs out of time', () => {
    const state = table({
      hands: { A: ['g8'], B: ['b5'] },
      top: 'r1',
      rules: { turnTimer: 15 },
      drawPile: ['r4'],
    });
    const timedOut = ok(timeoutTurn(state, ctx(50_000)));
    // Even though the drawn card was playable, the turn passes on.
    expect(handSize(timedOut.state, 'A')).toBe(2);
    expect(timedOut.state.pending).toBeNull();
    expect(turnId(timedOut.state)).toBe('B');
    expect(timedOut.events[0]).toEqual({ t: 'timedOut', playerId: 'A' });
  });

  it('picks a colour for a player who stalls on the choice', () => {
    const state = table({ hands: { A: ['w', 'b2', 'b3'], B: ['b5'] }, top: 'r1', rules: { turnTimer: 15 } });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'w-0' }, ctx(1000)));
    const timedOut = ok(timeoutTurn(played.state, ctx(50_000)));
    expect(timedOut.state.activeColor).toBe('blue'); // the colour they hold most of
    expect(turnId(timedOut.state)).toBe('B');
  });

  it('takes the draw stack for a player who stalls in front of one', () => {
    const state = table({
      hands: { A: ['rd', 'r9'], B: ['b5'], C: ['g5'] },
      top: 'r1',
      rules: { turnTimer: 15, stacking: true },
      drawPile: ['y2', 'y3', 'y4'],
    });
    const played = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'rd-0' }, ctx(1000)));
    const timedOut = ok(timeoutTurn(played.state, ctx(50_000)));
    expect(handSize(timedOut.state, 'B')).toBe(3);
    expect(timedOut.state.drawStack).toBeNull();
    expect(turnId(timedOut.state)).toBe('C');
  });
});

/* ================================================================== *
 * The anti-cheat boundary
 * ================================================================== */

describe('serializeFor', () => {
  const state = table({
    hands: { A: ['r3', 'r4'], B: ['b5', 'b6'], C: ['g5'] },
    top: 'r1',
    drawPile: ['r7', 'y8'],
  });

  it('gives a player their own hand and everyone else a count', () => {
    const view = serializeFor(state, 'A', 5000);
    expect(view.players.find((p) => p.id === 'A')?.hand?.map((c) => c.id)).toEqual(['r3-0', 'r4-0']);
    expect(view.players.find((p) => p.id === 'B')?.hand).toBeUndefined();
    expect(view.players.find((p) => p.id === 'B')?.handCount).toBe(2);
  });

  it('never leaks another hand or the draw pile, anywhere in the payload', () => {
    const view = serializeFor(state, 'A', 5000);
    const json = JSON.stringify(view);
    const secrets = [
      ...state.players.filter((p) => p.id !== 'A').flatMap((p) => p.hand.map((c) => c.id)),
      ...state.drawPile.map((c) => c.id),
    ];
    expect(secrets.length).toBeGreaterThan(0);
    for (const id of secrets) expect(json, `leaked ${id}`).not.toContain(id);
    expect(json).not.toContain('drawPile');
  });

  it('gives spectators no hands at all', () => {
    const view = serializeFor(state, null, 5000);
    expect(view.players.every((p) => p.hand === undefined)).toBe(true);
    expect(view.youId).toBeNull();
    expect(view.moves.playable).toEqual([]);
  });

  it('hides which card another player just drew', () => {
    const drawn = ok(applyIntent(state, 'A', { type: 'DRAW' }, ctx())).state;
    expect(serializeFor(drawn, 'A', 0).pending).toEqual({ kind: 'drawn', playerId: 'A', cardId: 'r7-0' });
    expect(serializeFor(drawn, 'B', 0).pending).toEqual({ kind: 'drawn', playerId: 'A', cardId: undefined });
  });

  it('never reveals whether a Wild Draw Four was a bluff', () => {
    const bluff = table({
      hands: { A: ['f', 'r9'], B: ['b5', 'b6'], C: ['g5'] },
      top: 'r1',
      rules: { challenge: true },
    });
    let next = ok(applyIntent(bluff, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx())).state;
    next = ok(applyIntent(next, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx())).state;
    expect(next.drawStack?.hadColorMatch).toBe(true);
    for (const viewer of ['A', 'B', 'C', null]) {
      const json = JSON.stringify(serializeFor(next, viewer, 0));
      expect(json).not.toContain('hadColorMatch');
      expect(json).not.toContain('colorBefore');
    }
  });

  it('reveals every hand once the round is over — that is the scoreboard', () => {
    const finished = ok(
      applyIntent(table({ hands: { A: ['r3'], B: ['b5', 'b6'] }, top: 'r1' }), 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx()),
    ).state;
    const view = serializeFor(finished, 'A', 0);
    expect(view.result?.hands.B.map((c) => c.id)).toEqual(['b5-0', 'b6-0']);
  });
});

/* ================================================================== *
 * Invariants
 * ================================================================== */

describe('invariants', () => {
  it('leaves the caller’s state untouched, whether the intent is accepted or refused', () => {
    const state = table({ hands: { A: ['r3', 'r4'], B: ['b5'] }, top: 'r1' });
    const before = JSON.stringify(state);
    ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'r3-0' }, ctx()));
    applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'g9-0' }, ctx());
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps all 108 cards accounted for through a long round', () => {
    let state = ok(startMatch(lobby(4), ctx(0))).state;
    for (let turn = 0; turn < 400 && state.phase === 'playing'; turn++) {
      const now = 1000 + turn * 100;
      const actorIndex = state.pending ? state.players.findIndex((p) => p.id === state.pending?.playerId) : state.turn;
      const actor = state.players[actorIndex];
      const moves = legalMoves(state, actor.id);
      const clock = ctx(now, turn + 1);

      let result;
      if (moves.mustChooseColor) {
        result = applyIntent(state, actor.id, { type: 'CHOOSE_COLOR', color: 'red' }, clock);
      } else if (moves.mustChooseSwapTarget) {
        const other = state.players.find((p) => p.id !== actor.id);
        result = applyIntent(state, actor.id, { type: 'CHOOSE_PLAYER', playerId: other!.id }, clock);
      } else if (moves.playable.length > 0) {
        result = applyIntent(state, actor.id, { type: 'PLAY_CARD', cardId: moves.playable[0] }, clock);
      } else if (moves.canPass) {
        result = applyIntent(state, actor.id, { type: 'PASS' }, clock);
      } else {
        result = applyIntent(state, actor.id, { type: 'DRAW' }, clock);
      }

      state = ok(result).state;
      expectDeckIntact(state);
    }
    expect(state.phase).toBe('roundOver');
  });
});
