import { describe, expect, it } from 'vitest';
import {
  AVATAR_COUNT,
  CODE_ALPHABET,
  CODE_LENGTH,
  applyRuleChange,
  canStart,
  cleanName,
  createRoomState,
  makeBot,
  makeRoomCode,
  newPlayer,
  normalizeRoomCode,
  randomNickname,
  seatPlayer,
  uniqueName,
  unseatPlayer,
} from './room';
import { DEFAULT_RULES } from './types';
import { seededRng } from './rng';
import { lobby } from './__tests__/helpers';

describe('room codes', () => {
  it('are six characters with nothing ambiguous in them', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const code = makeRoomCode(seededRng(seed));
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it('accepts sloppy input and rejects nonsense', () => {
    expect(normalizeRoomCode(' abc234 ')).toBe('ABC234');
    expect(normalizeRoomCode('ABC23')).toBeNull(); // too short
    expect(normalizeRoomCode('ABC2340')).toBeNull(); // too long
    expect(normalizeRoomCode('ABC23O')).toBeNull(); // ambiguous letter
    expect(normalizeRoomCode('ABC23!')).toBeNull();
  });

  it('does not always produce the same code', () => {
    const codes = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) codes.add(makeRoomCode(seededRng(seed)));
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe('names', () => {
  it('trims, caps the length and strips control characters', () => {
    expect(cleanName('  Maya  ', 'x')).toBe('Maya');
    expect(cleanName('a'.repeat(40), 'x')).toHaveLength(16);
    expect(cleanName('bad\u0000name', 'x')).toBe('badname');
    expect(cleanName('   ', 'Fallback')).toBe('Fallback');
  });

  it('makes duplicates unique at the table', () => {
    const state = createRoomState('AAAAAA');
    seatPlayer(state, { id: '1', name: 'Maya', avatar: 0 });
    expect(uniqueName(state, 'Maya')).toBe('Maya 2');
    seatPlayer(state, { id: '2', name: 'Maya', avatar: 1 });
    expect(state.players[1].name).toBe('Maya 2');
    // Collisions are case-insensitive, but a player keeps their own spelling.
    expect(uniqueName(state, 'maya')).toBe('maya 3');
  });

  it('generates a funny default that is two words', () => {
    const name = randomNickname(seededRng(4));
    expect(name.split(' ')).toHaveLength(2);
    expect(name.length).toBeLessThanOrEqual(16);
  });
});

describe('seats', () => {
  it('makes the first player the host', () => {
    const state = createRoomState('AAAAAA');
    seatPlayer(state, { id: '1', name: 'Maya', avatar: 0 });
    seatPlayer(state, { id: '2', name: 'Sam', avatar: 1 });
    expect(state.hostId).toBe('1');
  });

  it('passes the host on when they leave, preferring a human', () => {
    const state = createRoomState('AAAAAA');
    seatPlayer(state, { id: '1', name: 'Maya', avatar: 0 });
    seatPlayer(state, { id: 'bot', name: 'Rex', avatar: 1, isBot: true });
    seatPlayer(state, { id: '2', name: 'Sam', avatar: 2 });
    unseatPlayer(state, '1');
    expect(state.hostId).toBe('2');
  });

  it('keeps the turn pointing at the same player when an earlier seat leaves', () => {
    const state = lobby(4);
    state.turn = 2; // p2
    unseatPlayer(state, 'p0');
    expect(state.players[state.turn].id).toBe('p2');
  });

  it('empties out cleanly', () => {
    const state = createRoomState('AAAAAA');
    seatPlayer(state, { id: '1', name: 'Maya', avatar: 0 });
    unseatPlayer(state, '1');
    expect(state.players).toHaveLength(0);
    expect(state.hostId).toBeNull();
    expect(unseatPlayer(state, 'nobody')).toBe(false);
  });

  it('wraps avatar choices into range', () => {
    expect(newPlayer({ id: '1', name: 'a', avatar: 30 }).avatar).toBe(30 % AVATAR_COUNT);
    expect(newPlayer({ id: '1', name: 'a', avatar: -1 }).avatar).toBe(AVATAR_COUNT - 1);
  });

  it('gives bots names and avatars nobody is using', () => {
    const state = createRoomState('AAAAAA');
    seatPlayer(state, { id: '1', name: 'Maya', avatar: 3 });
    for (let i = 0; i < 5; i++) {
      const bot = makeBot(state, 'normal', seededRng(i + 1));
      seatPlayer(state, bot);
    }
    const names = state.players.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(state.players.filter((p) => p.isBot)).toHaveLength(5);
  });
});

describe('rule changes', () => {
  it('applies the toggles the host actually sent', () => {
    const rules = applyRuleChange(DEFAULT_RULES, { stacking: true, jumpIn: true });
    expect(rules.stacking).toBe(true);
    expect(rules.jumpIn).toBe(true);
    expect(rules.challenge).toBe(true); // untouched default
    expect(rules.sevenZero).toBe(false);
  });

  it('ignores junk instead of corrupting the rule set', () => {
    const rules = applyRuleChange(DEFAULT_RULES, {
      stacking: 'yes' as unknown as boolean,
      turnTimer: 7 as never,
      matchMode: 'forever' as never,
    });
    expect(rules).toEqual(DEFAULT_RULES);
  });

  it('accepts the four allowed turn timers', () => {
    for (const timer of [0, 15, 30, 60] as const) {
      expect(applyRuleChange(DEFAULT_RULES, { turnTimer: timer }).turnTimer).toBe(timer);
    }
  });

  it('clamps the target score to something playable', () => {
    expect(applyRuleChange(DEFAULT_RULES, { targetScore: 5 }).targetScore).toBe(100);
    expect(applyRuleChange(DEFAULT_RULES, { targetScore: 999_999 }).targetScore).toBe(2000);
    expect(applyRuleChange(DEFAULT_RULES, { targetScore: 300 }).targetScore).toBe(300);
  });
});

describe('starting', () => {
  it('needs two players, all of whom are ready', () => {
    const state = createRoomState('AAAAAA');
    seatPlayer(state, { id: '1', name: 'Maya', avatar: 0 });
    expect(canStart(state)).toBe(false);

    seatPlayer(state, { id: '2', name: 'Sam', avatar: 1 });
    expect(canStart(state)).toBe(false); // nobody ready yet

    state.players.forEach((p) => (p.ready = true));
    expect(canStart(state)).toBe(true);
  });

  it('does not wait on bots to be ready', () => {
    const state = createRoomState('AAAAAA');
    seatPlayer(state, { id: '1', name: 'Maya', avatar: 0 });
    seatPlayer(state, { id: 'bot', name: 'Rex', avatar: 1, isBot: true });
    state.players[0].ready = true;
    expect(canStart(state)).toBe(true);
  });
});
