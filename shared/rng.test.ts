import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('crypto randomness', () => {
  it('refills bounded batches only after consuming each word', async () => {
    const fill = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint32Array).fill(7);
      return array;
    });
    const { cryptoRng } = await import('./rng');
    expect(cryptoRng.int(1)).toBe(0);
    expect(fill).not.toHaveBeenCalled();
    for (let i = 0; i < 256; i++) expect(cryptoRng.int(10)).toBe(7);
    expect(fill).toHaveBeenCalledTimes(1);
    expect((fill.mock.calls[0][0] as Uint32Array).length).toBe(256);
    expect(cryptoRng.int(10)).toBe(7);
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('rejects biased words even when rejection crosses a refill boundary', async () => {
    const fill = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const words = array as Uint32Array;
      words.fill(0xffff_ffff);
      if (fill.mock.calls.length > 1) words[0] = 8;
      return array;
    });
    const { cryptoRng } = await import('./rng');
    expect(cryptoRng.int(10)).toBe(8);
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('keeps real cryptographic draws within the requested range', async () => {
    const { cryptoRng } = await import('./rng');
    for (const max of [2, 4, 10, 108, 0x8000_0001, 0x1_0000_0000]) {
      for (let i = 0; i < 300; i++) {
        const value = cryptoRng.int(max);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(max);
      }
    }
  });
});
