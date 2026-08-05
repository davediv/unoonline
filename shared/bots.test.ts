import { describe, expect, it } from 'vitest';
import type { BotLevel, RoomState, RuleSet } from './types';
import { applyIntent, expireUnoWindow, startMatch } from './engine';
import { botView, decideBotCatch, decideBotIntent } from './bots';
import { seededRng } from './rng';
import { allCardIds, botLobby, ctx, handSize, ok, table } from './__tests__/helpers';

function intentFor(state: RoomState, id: string, seed = 11) {
  return decideBotIntent(botView(state, id, 1000), seededRng(seed));
}

/**
 * Plays a whole match out with nothing but bots, exactly the way the Durable
 * Object drives them: whoever is on the clock decides, everyone else gets a
 * chance to pounce on an open UNO window.
 */
function playOut(levels: BotLevel[], seed: number, rules?: Partial<RuleSet>) {
  let state = ok(startMatch(botLobby(levels, rules), ctx(0, seed))).state;
  let now = 0;
  let steps = 0;
  const intents: string[] = [];

  while (state.phase === 'playing' && steps < 4000) {
    now += 400;
    const clock = ctx(now, seed + steps);

    if (state.uno && state.uno.deadline <= now) {
      const closed = expireUnoWindow(state, clock);
      if (closed.ok) state = closed.state;
    }

    // Opponents react to an open window first, as the DO's catch alarm does.
    if (state.uno) {
      for (const player of state.players) {
        if (player.id === state.uno?.playerId) continue;
        const catchIntent = decideBotCatch(botView(state, player.id, now));
        if (catchIntent) {
          const result = applyIntent(state, player.id, catchIntent, clock);
          if (result.ok) state = result.state;
        }
      }
    }

    const actor = state.pending ? state.pending.playerId : state.players[state.turn].id;
    const intent = decideBotIntent(botView(state, actor, now), seededRng(seed + steps));
    expect(intent, `bot ${actor} had no move at step ${steps}`).not.toBeNull();
    intents.push(intent!.type);

    const result = applyIntent(state, actor, intent!, clock);
    if (!result.ok) {
      throw new Error(`bot ${actor} produced an illegal ${intent!.type}: ${result.code} ${result.message}`);
    }
    state = result.state;

    const ids = allCardIds(state);
    expect(new Set(ids).size, `deck corrupted at step ${steps}`).toBe(108);
    steps++;
  }

  return { state, steps, intents };
}

describe('bots cannot cheat', () => {
  it('sees only its own hand, never another hand or the draw pile', () => {
    const state = table({
      hands: { A: ['r3', 'r4'], B: ['b5', 'b6'], C: ['g5'] },
      top: 'r1',
      bots: { A: 'hard' },
      drawPile: ['y7', 'y8'],
    });
    const json = JSON.stringify(botView(state, 'A', 0));
    const secrets = [
      ...state.players.filter((p) => p.id !== 'A').flatMap((p) => p.hand.map((c) => c.id)),
      ...state.drawPile.map((c) => c.id),
    ];
    for (const id of secrets) expect(json, `bot could see ${id}`).not.toContain(id);
  });

  it('cannot see whether a Wild Draw Four was a bluff', () => {
    let state = table({
      hands: { A: ['f', 'r9'], B: ['b5', 'b6'], C: ['g5'] },
      top: 'r1',
      rules: { challenge: true },
      bots: { B: 'hard' },
    });
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx())).state;
    state = ok(applyIntent(state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx())).state;
    expect(state.drawStack?.hadColorMatch).toBe(true);
    expect(JSON.stringify(botView(state, 'B', 0))).not.toContain('hadColorMatch');
  });
});

describe('easy bots', () => {
  it('play a legal card, and not always the same one', () => {
    const state = table({
      hands: { A: ['r3', 'r4', 'r5'], B: ['b5'] },
      top: 'r1',
      bots: { A: 'easy' },
    });
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const intent = intentFor(state, 'A', seed);
      expect(intent?.type).toBe('PLAY_CARD');
      if (intent?.type === 'PLAY_CARD') chosen.add(intent.cardId);
    }
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('never notices a missed UNO', () => {
    const state = table({ hands: { A: ['r3'], B: ['b5', 'b6'] }, top: 'r1', bots: { B: 'easy' } });
    state.uno = { playerId: 'A', deadline: 9_999, called: false, accusers: [] };
    expect(decideBotCatch(botView(state, 'B', 0))).toBeNull();
  });
});

describe('normal bots', () => {
  it('hoards wilds while an ordinary card will do', () => {
    const state = table({
      hands: { A: ['r3', 'w', 'f'], B: ['b5', 'b6'] },
      top: 'r1',
      bots: { A: 'normal' },
    });
    expect(intentFor(state, 'A')).toMatchObject({ type: 'PLAY_CARD', cardId: 'r3-0' });
  });

  it('throws an action card at a player who is nearly out', () => {
    const state = table({
      hands: { A: ['r3', 'rd'], B: ['b5'], C: ['g1', 'g2', 'g3'] },
      top: 'r1',
      bots: { A: 'normal' },
    });
    expect(intentFor(state, 'A')).toMatchObject({ type: 'PLAY_CARD', cardId: 'rd-0' });
  });

  it('names the colour it holds most of', () => {
    let state = table({
      hands: { A: ['w', 'b2', 'b3', 'b4', 'r5'], B: ['g5'] },
      top: 'r1',
      bots: { A: 'normal' },
    });
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'w-0' }, ctx())).state;
    expect(intentFor(state, 'A')).toEqual({ type: 'CHOOSE_COLOR', color: 'blue' });
  });

  it('calls UNO on the way down to one card', () => {
    const state = table({
      hands: { A: ['r3', 'r4'], B: ['b5', 'b6'] },
      top: 'r1',
      bots: { A: 'normal' },
    });
    expect(intentFor(state, 'A')).toMatchObject({ declareUno: true });
  });

  it('pounces on a silent UNO but not on one that was called', () => {
    const state = table({ hands: { A: ['r3'], B: ['b5', 'b6'] }, top: 'r1', bots: { B: 'normal' } });

    state.uno = { playerId: 'A', deadline: 9_999, called: false, accusers: [] };
    expect(decideBotCatch(botView(state, 'B', 0))).toEqual({ type: 'CATCH_UNO', targetId: 'A' });

    state.uno = { playerId: 'A', deadline: 9_999, called: true, accusers: [] };
    expect(decideBotCatch(botView(state, 'B', 0))).toBeNull();
  });

  it('draws when nothing is playable', () => {
    const state = table({
      hands: { A: ['g8', 'b2'], B: ['b5'] },
      top: 'r1',
      bots: { A: 'normal' },
      drawPile: ['y9'],
    });
    expect(intentFor(state, 'A')).toEqual({ type: 'DRAW' });
  });
});

describe('hard bots', () => {
  it('spends a clean Wild Draw Four on a player who is nearly out', () => {
    // No red in hand, so the Wild Draw Four is honest — and B is on two cards.
    const state = table({
      hands: { A: ['f', 'b3'], B: ['b5', 'b6'], C: ['g1', 'g2', 'g3'] },
      top: 'r3',
      rules: { challenge: true },
      bots: { A: 'hard' },
    });
    expect(intentFor(state, 'A')).toMatchObject({ type: 'PLAY_CARD', cardId: 'f-0' });
  });

  it('a normal bot in the same spot sits on it', () => {
    const state = table({
      hands: { A: ['f', 'b3'], B: ['b5', 'b6'], C: ['g1', 'g2', 'g3'] },
      top: 'r3',
      rules: { challenge: true },
      bots: { A: 'normal' },
    });
    expect(intentFor(state, 'A')).toMatchObject({ type: 'PLAY_CARD', cardId: 'b3-0' });
  });

  it('will not bluff a Wild Draw Four while it is holding the active colour', () => {
    const state = table({
      hands: { A: ['f', 'r3'], B: ['b5'], C: ['g1', 'g2'] },
      top: 'r1',
      rules: { challenge: true },
      bots: { A: 'hard' },
    });
    expect(intentFor(state, 'A')).toMatchObject({ type: 'PLAY_CARD', cardId: 'r3-0' });
  });

  it('sheds its most expensive playable card when somebody is about to go out', () => {
    const state = table({
      hands: { A: ['r2', 'rd'], B: ['b5'], C: ['g1', 'g2', 'g3'] },
      top: 'r1',
      bots: { A: 'hard' },
    });
    expect(intentFor(state, 'A')).toMatchObject({ type: 'PLAY_CARD', cardId: 'rd-0' });
  });

  it('steers onto a colour the next player has already refused', () => {
    let state = table({
      hands: { A: ['w', 'r2', 'g2'], B: ['b5', 'b6'] },
      top: 'r1',
      bots: { A: 'hard' },
    });
    // B drew rather than follow green earlier in the round.
    state.passRecord = [{ playerId: 'B', color: 'green' }];
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'w-0' }, ctx())).state;
    expect(intentFor(state, 'A')).toEqual({ type: 'CHOOSE_COLOR', color: 'green' });
  });

  it('does not challenge a player who already drew rather than follow that colour', () => {
    let state = table({
      hands: { A: ['f', 'r9'], B: ['b5', 'b6'], C: ['g5'] },
      top: 'r1',
      rules: { challenge: true },
      bots: { B: 'hard' },
    });
    state.passRecord = [{ playerId: 'A', color: 'red' }];
    state = ok(applyIntent(state, 'A', { type: 'PLAY_CARD', cardId: 'f-0' }, ctx())).state;
    state = ok(applyIntent(state, 'A', { type: 'CHOOSE_COLOR', color: 'yellow' }, ctx())).state;

    for (let seed = 1; seed <= 30; seed++) {
      expect(intentFor(state, 'B', seed)?.type).not.toBe('CHALLENGE');
    }
  });
});

describe('a full match of bots', () => {
  it('finishes cleanly with the default rules', () => {
    const { state, steps } = playOut(['easy', 'normal', 'hard'], 3);
    expect(state.phase).not.toBe('playing');
    expect(steps).toBeLessThan(4000);
    expect(state.result).not.toBeNull();
    // Somebody emptied their hand.
    expect(state.players.some((p) => p.hand.length === 0)).toBe(true);
  });

  it('finishes cleanly with every house rule switched on', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state } = playOut(['normal', 'hard', 'hard', 'easy'], seed, {
        stacking: true,
        jumpIn: true,
        sevenZero: true,
        drawToMatch: true,
        challenge: true,
        turnTimer: 30,
      });
      expect(state.phase, `seed ${seed}`).not.toBe('playing');
    }
  });

  it('never has a bot produce an illegal move over many deals', () => {
    // playOut throws on the first rejected intent, so reaching the end is the
    // assertion. Twenty different deals is a decent sweep of the rules.
    for (let seed = 1; seed <= 20; seed++) {
      const { state } = playOut(['easy', 'normal', 'hard', 'normal'], seed * 17);
      expect(state.phase, `seed ${seed}`).not.toBe('playing');
    }
  });

  it('bots that go down to one card end up calling UNO', () => {
    const { state } = playOut(['hard', 'hard'], 5);
    // The winner necessarily passed through one card, and bots always call.
    expect(state.result).not.toBeNull();
    expect(handSize(state, state.result!.winnerId)).toBe(0);
  });
});
