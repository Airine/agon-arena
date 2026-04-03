/**
 * LOB orchestrator integration tests (Track 1c).
 *
 * These tests operate on the pure LOB game engine functions (createLOBEngineState,
 * processTick) which are the core of the orchestrator. No mocking of Redis, DB,
 * or Socket.IO is required because the integration being tested is the tick-level
 * state transitions: orders cross and fill, all-pass leaves the book unchanged,
 * and a null submission (agent timeout) is treated as a pass action.
 */

import { describe, expect, it } from 'vitest';
import {
  createLOBEngineState,
  processTick,
} from '../../game/lob/index.js';
import type { LOBAction } from '../../game/lob/index.js';

const ARENA_ID = 'test-arena';
const AGENT_A = 'agent-alpha';
const AGENT_B = 'agent-beta';
const STARTING_CASH = 10_000;
const START_PRICE = 1_000;

describe('LOB orchestrator — processTick', () => {
  it('executes a trade when a bid and ask cross', () => {
    // GIVEN: fresh engine, agent-A posts a bid at 1001, agent-B posts an ask at 999
    const initial = createLOBEngineState(
      ARENA_ID,
      [AGENT_A, AGENT_B],
      STARTING_CASH,
      START_PRICE,
      /* seed */ 42,
    );

    const actions: Record<string, LOBAction> = {
      [AGENT_A]: { type: 'post_bid', price: 1001, qty: 1 },
      [AGENT_B]: { type: 'post_ask', price: 999,  qty: 1 },
    };

    const next = processTick(initial, actions);

    // A trade must have occurred (bid ≥ ask, so orders cross immediately)
    expect(next.lobState.recentTrades.length).toBeGreaterThan(0);

    const trade = next.lobState.recentTrades[0]!;
    expect(trade.qty).toBe(1);

    // Buyer's inventory increases, seller's decreases
    const buyerStats  = next.lobState.agentStats[AGENT_A]!;
    const sellerStats = next.lobState.agentStats[AGENT_B]!;
    expect(buyerStats.inventory).toBe(1);
    expect(sellerStats.inventory).toBe(-1);

    // Cash balances change in opposite directions
    expect(buyerStats.cash).toBeLessThan(STARTING_CASH);
    expect(sellerStats.cash).toBeGreaterThan(STARTING_CASH);
  });

  it('leaves the order book and cash balances unchanged when all agents pass', () => {
    const initial = createLOBEngineState(
      ARENA_ID,
      [AGENT_A, AGENT_B],
      STARTING_CASH,
      START_PRICE,
      /* seed */ 7,
    );

    const actions: Record<string, LOBAction> = {
      [AGENT_A]: { type: 'pass' },
      [AGENT_B]: { type: 'pass' },
    };

    const next = processTick(initial, actions);

    // No trades
    expect(next.lobState.recentTrades).toHaveLength(0);

    // Order book stays empty
    expect(next.lobState.bids).toHaveLength(0);
    expect(next.lobState.asks).toHaveLength(0);

    // Tick counter advances
    expect(next.lobState.tickNumber).toBe(1);

    // Cash unchanged (mark-to-market may shift pnl but cash stays flat)
    expect(next.lobState.agentStats[AGENT_A]!.cash).toBe(STARTING_CASH);
    expect(next.lobState.agentStats[AGENT_B]!.cash).toBe(STARTING_CASH);
    expect(next.lobState.agentStats[AGENT_A]!.inventory).toBe(0);
    expect(next.lobState.agentStats[AGENT_B]!.inventory).toBe(0);
  });

  it('treats a null submission (agent timeout) as a pass — no trade, no order posted', () => {
    // This mirrors the orchestrator's: actions[agentId] = submission ?? { type: 'pass' }
    const initial = createLOBEngineState(
      ARENA_ID,
      [AGENT_A, AGENT_B],
      STARTING_CASH,
      START_PRICE,
      /* seed */ 99,
    );

    // Simulate timeout: null submission falls back to pass
    const nullSubmission: LOBAction | null = null;
    const timedOutAction: LOBAction = nullSubmission ?? { type: 'pass' };

    const actions: Record<string, LOBAction> = {
      [AGENT_A]: timedOutAction,
      [AGENT_B]: timedOutAction,
    };

    const next = processTick(initial, actions);

    // Timeout treated as pass — no orders placed, no trades
    expect(next.lobState.recentTrades).toHaveLength(0);
    expect(next.lobState.bids).toHaveLength(0);
    expect(next.lobState.asks).toHaveLength(0);
    expect(next.lobState.agentStats[AGENT_A]!.inventory).toBe(0);
    expect(next.lobState.agentStats[AGENT_B]!.inventory).toBe(0);

    // Tick still advances — the game loop continues past a timeout
    expect(next.lobState.tickNumber).toBe(1);
  });
});
