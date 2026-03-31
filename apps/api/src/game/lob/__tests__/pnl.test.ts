import { describe, it, expect } from 'vitest';
import { markToMarket, updateStatsAfterTrade, settleAgent } from '../pnl.js';

describe('markToMarket', () => {
  it('zero inventory → pnl equals cash (which is startingCash)', () => {
    const stats = { inventory: 0, cash: 10_000, pnl: 10_000 };
    const result = markToMarket(stats, 1000);
    expect(result.pnl).toBe(10_000);
  });

  it('long inventory + higher mid-price → pnl > startingCash', () => {
    const startingCash = 9_000; // spent 1000 buying 1 unit at 1000
    const stats = { inventory: 1, cash: startingCash, pnl: startingCash };
    // mid-price is now 1100 (above purchase price)
    const result = markToMarket(stats, 1100);
    expect(result.pnl).toBe(9_000 + 1 * 1100); // 10100 > 10000 starting
    expect(result.pnl).toBeGreaterThan(10_000);
  });
});

describe('settleAgent', () => {
  it('zero inventory → cash unchanged', () => {
    const stats = { inventory: 0, cash: 10_000, pnl: 10_000 };
    const result = settleAgent(stats, 1000);
    expect(result.cash).toBe(10_000);
    expect(result.inventory).toBe(0);
  });

  it('long position (inventory > 0) → cash increases by inventory × midPrice', () => {
    const stats = { inventory: 3, cash: 7_000, pnl: 7_000 };
    const midPrice = 1000;
    const result = settleAgent(stats, midPrice);
    expect(result.cash).toBe(7_000 + 3 * 1000); // 10000
    expect(result.inventory).toBe(0);
  });
});

describe('updateStatsAfterTrade', () => {
  it('buyer cash decreases by price×qty and inventory increases by qty', () => {
    const stats = { inventory: 0, cash: 10_000, pnl: 10_000 };
    const result = updateStatsAfterTrade(stats, 'buy', 200, 3);
    expect(result.cash).toBe(10_000 - 200 * 3); // 9400
    expect(result.inventory).toBe(3);
  });

  it('seller cash increases by price×qty and inventory decreases by qty', () => {
    const stats = { inventory: 5, cash: 10_000, pnl: 10_000 };
    const result = updateStatsAfterTrade(stats, 'sell', 200, 3);
    expect(result.cash).toBe(10_000 + 200 * 3); // 10600
    expect(result.inventory).toBe(2);
  });
});
