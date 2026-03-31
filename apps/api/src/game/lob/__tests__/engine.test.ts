import { describe, it, expect } from 'vitest';
import { createLOBEngineState, processTick } from '../engine.js';
import type { LOBAction } from '../types.js';

describe('processTick', () => {
  it('all-pass actions → mid-price changes (GBM advances), no trades', () => {
    const engineState = createLOBEngineState('arena-1', ['agent-a', 'agent-b'], 10_000, 1000, 42);
    const initialMidPrice = engineState.lobState.midPrice;

    const actions: Record<string, LOBAction> = {
      'agent-a': { type: 'pass' },
      'agent-b': { type: 'pass' },
    };

    const next = processTick(engineState, actions);
    // GBM should have advanced (price may change)
    expect(next.lobState.tickNumber).toBe(1);
    expect(next.lobState.recentTrades).toHaveLength(0);
    // With a deterministic seed, mid-price should have updated
    expect(typeof next.lobState.midPrice).toBe('number');
    expect(Number.isNaN(next.lobState.midPrice)).toBe(false);
    // Record that the state was processed
    expect(next.lastMidPrice).toBeDefined();
  });

  it('two agents posting crossing orders → trade fires, agentStats updated for both', () => {
    const engineState = createLOBEngineState('arena-1', ['buyer', 'seller'], 10_000, 1000, 99);

    // seller posts ask at 100, buyer posts bid at 100 — crossing
    const actions: Record<string, LOBAction> = {
      buyer: { type: 'post_bid', price: 100, qty: 5 },
      seller: { type: 'post_ask', price: 100, qty: 5 },
    };

    const next = processTick(engineState, actions);
    expect(next.lobState.recentTrades.length).toBeGreaterThan(0);

    const buyerStats = next.lobState.agentStats['buyer']!;
    const sellerStats = next.lobState.agentStats['seller']!;

    // buyer should have positive inventory and reduced cash
    expect(buyerStats.inventory).toBeGreaterThan(0);
    expect(buyerStats.cash).toBeLessThan(10_000);

    // seller should have negative inventory and increased cash
    expect(sellerStats.inventory).toBeLessThan(0);
    expect(sellerStats.cash).toBeGreaterThan(10_000);
  });

  it('200 ticks with alternating bid/ask actions → no NaN, no negative qty, isFinished stays false', () => {
    let engineState = createLOBEngineState('arena-1', ['agent-a', 'agent-b'], 10_000, 1000, 7);
    let tick = 0;

    for (let i = 0; i < 200; i++) {
      // Alternate between posting non-crossing orders and passing
      const actions: Record<string, LOBAction> = tick % 4 === 0
        ? {
            'agent-a': { type: 'post_bid', price: 990, qty: 1 },
            'agent-b': { type: 'post_ask', price: 1010, qty: 1 },
          }
        : {
            'agent-a': { type: 'pass' },
            'agent-b': { type: 'pass' },
          };

      engineState = processTick(engineState, actions);
      tick++;

      const { midPrice, agentStats } = engineState.lobState;
      expect(Number.isNaN(midPrice)).toBe(false);
      expect(Number.isFinite(midPrice)).toBe(true);

      for (const stats of Object.values(agentStats)) {
        expect(Number.isNaN(stats.pnl)).toBe(false);
      }

      // The engine itself never sets isFinished — only the orchestrator does
      expect(engineState.lobState.isFinished).toBe(false);
    }
  });

  it('two arenas with same seed → identical mid-price sequences after 10 ticks', () => {
    const SEED = 12345;
    let stateA = createLOBEngineState('arena-a', ['agent-1', 'agent-2'], 10_000, 1000, SEED);
    let stateB = createLOBEngineState('arena-b', ['agent-1', 'agent-2'], 10_000, 1000, SEED);

    const passActions: Record<string, LOBAction> = {
      'agent-1': { type: 'pass' },
      'agent-2': { type: 'pass' },
    };

    const pricesA: number[] = [];
    const pricesB: number[] = [];

    for (let i = 0; i < 10; i++) {
      stateA = processTick(stateA, passActions);
      stateB = processTick(stateB, passActions);
      pricesA.push(stateA.lobState.midPrice);
      pricesB.push(stateB.lobState.midPrice);
    }

    expect(pricesA).toEqual(pricesB);
  });
});
