import { describe, it, expect, vi } from 'vitest';
import { tickGBM, createGBMState } from '../mid-price.js';

// Simple mulberry32 seeded PRNG for deterministic test sequences
function mulberry32(seed: number): () => number {
  let s = seed;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

describe('tickGBM', () => {
  it('deterministic: same seed rng → same output every call', () => {
    const state = createGBMState(1000);

    const rng1 = mulberry32(42);
    const result1 = tickGBM(state, rng1);

    const rng2 = mulberry32(42);
    const result2 = tickGBM(state, rng2);

    expect(result1.newPrice).toBe(result2.newPrice);
    expect(result1.state.price).toBe(result2.state.price);
  });

  it('price stays >= 1 over 1000 ticks with a fixed seed rng', () => {
    const rng = mulberry32(12345);
    let state = createGBMState(1000);

    for (let i = 0; i < 1000; i++) {
      const result = tickGBM(state, rng);
      expect(result.newPrice).toBeGreaterThanOrEqual(1);
      state = result.state;
    }
  });

  it('GBM output is a finite number (not NaN, not Infinity)', () => {
    const rng = mulberry32(99);
    const state = createGBMState(1000);
    const result = tickGBM(state, rng);

    expect(typeof result.newPrice).toBe('number');
    expect(Number.isNaN(result.newPrice)).toBe(false);
    expect(Number.isFinite(result.newPrice)).toBe(true);
  });
});
