/**
 * Randomness.
 *
 * The shuffle must not be predictable, so the production source is
 * `crypto.getRandomValues` (available on Workers, Node and the browser).
 * Nothing the game depends on — the shuffle, the deal, bot choices — ever
 * touches `Math.random`; it appears only in cosmetics like confetti jitter
 * and the noise buffer behind the sound effects.
 *
 * Tests inject `seededRng` so shuffles are reproducible.
 */

export interface Rng {
  /** Uniformly distributed integer in `[0, max)`. `max` must be >= 1. */
  int(max: number): number;
}

/** Request-independent crypto words, refilled lazily in bounded batches. */
const randomWords = new Uint32Array(256);
let randomOffset = randomWords.length;

/**
 * Rejection sampling on top of `crypto.getRandomValues` — taking a plain
 * modulo would bias the low values.
 */
export const cryptoRng: Rng = {
  int(max: number): number {
    if (max <= 1) return 0;
    // Largest multiple of `max` that fits in a uint32; anything at or above
    // it would skew the distribution, so we draw again.
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    let value: number;
    do {
      if (randomOffset === randomWords.length) {
        crypto.getRandomValues(randomWords);
        randomOffset = 0;
      }
      value = randomWords[randomOffset++];
    } while (value >= limit);
    return value % max;
  },
};

/**
 * Deterministic mulberry32 — test-only. Never wire this into the DO.
 */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  return {
    int(max: number): number {
      if (max <= 1) return 0;
      return Math.floor(next() * max) % max;
    },
  };
}

/** Uniform pick. Returns `undefined` only for an empty list. */
export function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  return items[rng.int(items.length)];
}

/** Random integer in `[min, max]`, inclusive. */
export function randomBetween(min: number, max: number, rng: Rng): number {
  return min + rng.int(max - min + 1);
}
