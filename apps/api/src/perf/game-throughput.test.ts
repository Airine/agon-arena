/**
 * AGO-47: Game engine throughput tests.
 *
 * Measures hands-per-second throughput for the pure game engine
 * (no DB, no network, no Socket.io). This isolates the computational
 * cost of game state management, action processing, hand evaluation,
 * and winner determination.
 *
 * Run with: pnpm --filter @agon/api perf:test
 */
import { describe, it, expect } from 'vitest';
import { createGame, processAction, getValidActions, getWinners, isHandOver } from '../game/engine.js';
import { evaluateHand } from '../game/evaluator.js';
import { createDeck, shuffleDeck } from '../game/deck.js';
import type { GameConfig } from '../game/engine.js';
import type { PlayerAction } from '@agon/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(playerCount: number): GameConfig {
  return {
    arenaId: 'throughput-arena',
    players: Array.from({ length: playerCount }, (_, i) => ({
      agentId: `p${i + 1}`,
      agentName: `Player ${i + 1}`,
      stack: 1000,
    })),
    smallBlind: 10,
    bigBlind: 20,
    dealerIndex: 0,
  };
}

/** Simulate a complete hand with a simple call/check strategy. Returns action count. */
function simulateHand(playerCount: number): { actions: number; stage: string } {
  const { state, deck } = createGame(makeConfig(playerCount));
  let s = state;
  let actions = 0;

  while (!isHandOver(s) && s.currentActorIndex !== null) {
    const validActions = getValidActions(s);
    if (validActions.length === 0) break;

    const action: PlayerAction = validActions.includes('check')
      ? { type: 'check' }
      : validActions.includes('call')
        ? { type: 'call' }
        : { type: 'fold' };

    s = processAction(s, action, deck);
    actions++;
  }

  if (s.stage === 'showdown' || s.stage === 'finished') {
    getWinners(s);
  }

  return { actions, stage: s.stage };
}

/** Simulate a hand with mixed actions (raises to make it more expensive). */
function simulateAggressiveHand(playerCount: number): { actions: number; stage: string } {
  const { state, deck } = createGame(makeConfig(playerCount));
  let s = state;
  let actions = 0;

  while (!isHandOver(s) && s.currentActorIndex !== null) {
    const validActions = getValidActions(s);
    if (validActions.length === 0) break;

    // Alternate: raise every 3rd action, check/call otherwise
    let action: PlayerAction;
    if (actions % 3 === 0 && validActions.includes('raise')) {
      action = { type: 'raise', amount: s.minRaise };
    } else if (validActions.includes('check')) {
      action = { type: 'check' };
    } else if (validActions.includes('call')) {
      action = { type: 'call' };
    } else {
      action = { type: 'fold' };
    }

    s = processAction(s, action, deck);
    actions++;
  }

  if (s.stage === 'showdown' || s.stage === 'finished') {
    getWinners(s);
  }

  return { actions, stage: s.stage };
}

interface ThroughputResult {
  handsPlayed: number;
  totalActions: number;
  elapsedMs: number;
  handsPerSecond: number;
  actionsPerSecond: number;
  avgActionsPerHand: number;
}

function measureThroughput(
  playerCount: number,
  durationMs: number,
  simulate: (count: number) => { actions: number; stage: string },
): ThroughputResult {
  let handsPlayed = 0;
  let totalActions = 0;

  const start = performance.now();
  const deadline = start + durationMs;

  while (performance.now() < deadline) {
    const result = simulate(playerCount);
    totalActions += result.actions;
    handsPlayed++;
  }

  const elapsed = performance.now() - start;

  return {
    handsPlayed,
    totalActions,
    elapsedMs: elapsed,
    handsPerSecond: (handsPlayed / elapsed) * 1000,
    actionsPerSecond: (totalActions / elapsed) * 1000,
    avgActionsPerHand: totalActions / handsPlayed,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('game engine throughput (passive play — call/check)', () => {
  const DURATION_MS = 2000;

  it('2 players — heads-up throughput', () => {
    const r = measureThroughput(2, DURATION_MS, simulateHand);
    console.log(`  2p passive:  ${r.handsPerSecond.toFixed(0)} hands/s  ${r.actionsPerSecond.toFixed(0)} actions/s  avg ${r.avgActionsPerHand.toFixed(1)} actions/hand  (${r.handsPlayed} hands in ${r.elapsedMs.toFixed(0)}ms)`);

    // Expect > 1000 hands/s for pure compute on modern hardware
    expect(r.handsPerSecond).toBeGreaterThan(1000);
  });

  it('4 players — standard table', () => {
    const r = measureThroughput(4, DURATION_MS, simulateHand);
    console.log(`  4p passive:  ${r.handsPerSecond.toFixed(0)} hands/s  ${r.actionsPerSecond.toFixed(0)} actions/s  avg ${r.avgActionsPerHand.toFixed(1)} actions/hand  (${r.handsPlayed} hands in ${r.elapsedMs.toFixed(0)}ms)`);

    expect(r.handsPerSecond).toBeGreaterThan(500);
  });

  it('6 players — 6-max table', () => {
    const r = measureThroughput(6, DURATION_MS, simulateHand);
    console.log(`  6p passive:  ${r.handsPerSecond.toFixed(0)} hands/s  ${r.actionsPerSecond.toFixed(0)} actions/s  avg ${r.avgActionsPerHand.toFixed(1)} actions/hand  (${r.handsPlayed} hands in ${r.elapsedMs.toFixed(0)}ms)`);

    expect(r.handsPerSecond).toBeGreaterThan(200);
  });

  it('10 players — full ring', () => {
    const r = measureThroughput(10, DURATION_MS, simulateHand);
    console.log(`  10p passive: ${r.handsPerSecond.toFixed(0)} hands/s  ${r.actionsPerSecond.toFixed(0)} actions/s  avg ${r.avgActionsPerHand.toFixed(1)} actions/hand  (${r.handsPlayed} hands in ${r.elapsedMs.toFixed(0)}ms)`);

    expect(r.handsPerSecond).toBeGreaterThan(100);
  });
});

describe('game engine throughput (aggressive play — raises)', () => {
  const DURATION_MS = 2000;

  it('2 players — aggressive heads-up', () => {
    const r = measureThroughput(2, DURATION_MS, simulateAggressiveHand);
    console.log(`  2p aggressive:  ${r.handsPerSecond.toFixed(0)} hands/s  ${r.actionsPerSecond.toFixed(0)} actions/s  avg ${r.avgActionsPerHand.toFixed(1)} actions/hand  (${r.handsPlayed} hands in ${r.elapsedMs.toFixed(0)}ms)`);

    expect(r.handsPerSecond).toBeGreaterThan(500);
  });

  it('6 players — aggressive 6-max', () => {
    const r = measureThroughput(6, DURATION_MS, simulateAggressiveHand);
    console.log(`  6p aggressive:  ${r.handsPerSecond.toFixed(0)} hands/s  ${r.actionsPerSecond.toFixed(0)} actions/s  avg ${r.avgActionsPerHand.toFixed(1)} actions/hand  (${r.handsPlayed} hands in ${r.elapsedMs.toFixed(0)}ms)`);

    expect(r.handsPerSecond).toBeGreaterThan(100);
  });
});

describe('hand evaluation throughput', () => {
  it('evaluateHand throughput (7-card)', () => {
    const ITERATIONS = 10_000;
    const deck = shuffleDeck(createDeck());

    // Pre-build 7-card hands
    const hands = Array.from({ length: ITERATIONS }, () => {
      const d = shuffleDeck(createDeck());
      return d.slice(0, 7);
    });

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      evaluateHand(hands[i]!);
    }
    const elapsed = performance.now() - start;
    const evalPerSec = (ITERATIONS / elapsed) * 1000;

    console.log(`  evaluateHand: ${evalPerSec.toFixed(0)} evals/s  (${ITERATIONS} evals in ${elapsed.toFixed(0)}ms)`);

    // C(7,5) = 21 combos per eval, expect > 10k evals/s
    expect(evalPerSec).toBeGreaterThan(10_000);
  });
});

describe('concurrent arena simulation', () => {
  it('simulates 10 concurrent arenas (sequential, shared thread)', () => {
    const ARENAS = 10;
    const HANDS_PER_ARENA = 20;

    const start = performance.now();
    let totalActions = 0;

    for (let a = 0; a < ARENAS; a++) {
      for (let h = 0; h < HANDS_PER_ARENA; h++) {
        const result = simulateHand(6);
        totalActions += result.actions;
      }
    }

    const elapsed = performance.now() - start;
    const totalHands = ARENAS * HANDS_PER_ARENA;
    const handsPerSec = (totalHands / elapsed) * 1000;

    console.log(`  10 arenas × 20 hands (6p): ${handsPerSec.toFixed(0)} hands/s  ${totalActions} total actions in ${elapsed.toFixed(0)}ms`);

    // Should handle multi-arena workload
    expect(handsPerSec).toBeGreaterThan(100);
  });
});
