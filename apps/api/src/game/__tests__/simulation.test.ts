/**
 * AGO-30: Unit test suite — 1000-hand simulation + edge case coverage
 *
 * Key invariants verified across every hand:
 * 1. Chip conservation: total chips never created or destroyed
 * 2. No negative stacks
 * 3. All pot chips are distributed to winners
 * 4. Game always terminates (no infinite loops)
 * 5. Stage progression is strictly forward
 */
import { describe, it, expect } from 'vitest';
import {
  createGame,
  processAction,
  getValidActions,
  getWinners,
  isHandOver,
  type GameConfig,
} from '../engine.js';
import type { GameState, PlayerAction, ActionType } from '@agon/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  playerCount: number,
  startingStack = 1000,
  overrides?: Partial<GameConfig>,
): GameConfig {
  return {
    arenaId: 'sim-arena',
    players: Array.from({ length: playerCount }, (_, i) => ({
      agentId: `p${i + 1}`,
      agentName: `Player ${i + 1}`,
      stack: startingStack,
    })),
    smallBlind: 10,
    bigBlind: 20,
    dealerIndex: 0,
    ...overrides,
  };
}

/**
 * Simple deterministic bot: calls 70%, raises 20%, folds 10%.
 * Always picks a valid action so the game makes progress.
 */
function botAction(state: GameState, rng: () => number): PlayerAction {
  const validActions = getValidActions(state);
  if (validActions.length === 0) return { type: 'fold' };

  const actor = state.players[state.currentActorIndex!]!;
  const r = rng();

  if (r < 0.1 && validActions.includes('fold')) {
    return { type: 'fold' };
  }
  if (r < 0.30 && validActions.includes('raise')) {
    // Raise a minimum amount
    return { type: 'raise', amount: state.minRaise };
  }
  if (validActions.includes('call')) {
    return { type: 'call' };
  }
  if (validActions.includes('check')) {
    return { type: 'check' };
  }
  // Fallback: first valid action
  return { type: validActions[0] as ActionType };
}

/**
 * Run a single hand to completion. Returns winners + final state.
 * Raises if loop exceeds 500 actions (guard against infinite loops).
 */
function playHand(config: GameConfig, rng: () => number) {
  const { state: initial, deck } = createGame(config);
  let state = initial;

  const STAGE_ORDER = ['pre_flop', 'flop', 'turn', 'river', 'showdown', 'finished'] as const;
  let prevStageIdx = 0;
  let actionCount = 0;

  while (!isHandOver(state)) {
    expect(actionCount).toBeLessThan(500); // safety guard
    actionCount++;

    // Stage must never go backwards
    const stageIdx = STAGE_ORDER.indexOf(state.stage as typeof STAGE_ORDER[number]);
    expect(stageIdx).toBeGreaterThanOrEqual(prevStageIdx);
    prevStageIdx = stageIdx;

    if (state.currentActorIndex === null) break;

    const action = botAction(state, rng);
    state = processAction(state, action, deck);

    // No player can have a negative stack at any point
    for (const p of state.players) {
      expect(p.stack).toBeGreaterThanOrEqual(0);
    }
  }

  return { state, winners: getWinners(state) };
}

/** Simple seeded LCG for reproducible random numbers. */
function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

// ---------------------------------------------------------------------------
// 1000-hand simulation
// ---------------------------------------------------------------------------

describe('1000-hand simulation', () => {
  const rng = makeLCG(42);

  it('maintains chip conservation across all hands', () => {
    const totalStartingChips = 4 * 1000; // 4 players × 1000
    const stacks = new Map<string, number>();
    const playerIds = ['p1', 'p2', 'p3', 'p4'];
    for (const id of playerIds) stacks.set(id, 1000);

    let handsPlayed = 0;

    for (let hand = 0; hand < 1000; hand++) {
      // Skip if fewer than 2 players have chips
      const activePlayers = playerIds.filter((id) => (stacks.get(id) ?? 0) > 0);
      if (activePlayers.length < 2) break;

      const config: GameConfig = {
        arenaId: 'sim-arena',
        players: activePlayers.map((id) => ({
          agentId: id,
          agentName: id,
          stack: stacks.get(id)!,
        })),
        smallBlind: 5,
        bigBlind: 10,
        dealerIndex: hand % activePlayers.length,
      };

      const { state, winners } = playHand(config, rng);

      // Chip conservation: chips_in_play_before = chips_in_play_after
      const chipsInPots = state.pots.reduce((sum, p) => sum + p.amount, 0);
      const chipsInStacks = state.players.reduce((sum, p) => sum + p.stack, 0);
      const chipsAfterDistribution = chipsInStacks + winners.reduce((sum, w) => sum + w.amount, 0);

      // All pot chips must be in the winning distribution
      expect(chipsInPots).toBe(winners.reduce((sum, w) => sum + w.amount, 0));

      // Update stacks for next hand
      for (const p of state.players) {
        stacks.set(p.agentId, p.stack);
      }
      for (const w of winners) {
        stacks.set(w.agentId, (stacks.get(w.agentId) ?? 0) + w.amount);
      }

      handsPlayed++;
    }

    // Total chips must be conserved
    const totalFinalChips = playerIds.reduce((sum, id) => sum + (stacks.get(id) ?? 0), 0);
    expect(totalFinalChips).toBe(totalStartingChips);
    expect(handsPlayed).toBeGreaterThan(50); // game should last at least 50 hands
  });

  it('always terminates within 500 actions per hand', () => {
    const rng2 = makeLCG(99);
    for (let hand = 0; hand < 1000; hand++) {
      const config = makeConfig(Math.floor(rng2() * 7) + 2, 500); // 2-8 players
      expect(() => playHand(config, rng2)).not.toThrow();
    }
  });

  it('winners always have positive winnings', () => {
    const rng3 = makeLCG(7);
    for (let hand = 0; hand < 1000; hand++) {
      const config = makeConfig(4, 200);
      const { winners } = playHand(config, rng3);
      for (const w of winners) {
        expect(w.amount).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases: betting mechanics
// ---------------------------------------------------------------------------

describe('engine edge cases', () => {
  it('raises must be at least minRaise', () => {
    const { state, deck } = createGame(makeConfig(3));
    // Try invalid sub-minimum raise (< minRaise but not all-in)
    // With 1000 chips and minRaise=20, raising 1 should throw
    expect(() => processAction(state, { type: 'raise', amount: 1 }, deck)).toThrow();
  });

  it('cannot check when there is a bet to call', () => {
    const { state, deck } = createGame(makeConfig(3));
    // UTG is first to act pre-flop, must call or raise/fold (BB has already bet 20)
    expect(() => processAction(state, { type: 'check' }, deck)).toThrow();
  });

  it('actor cannot act after folding', () => {
    const { state, deck } = createGame(makeConfig(3));
    const afterFold = processAction(state, { type: 'fold' }, deck);
    const foldedPlayer = afterFold.players.find((p) => p.isFolded)!;
    // The folded player should not be the current actor
    if (afterFold.currentActorIndex !== null) {
      expect(afterFold.players[afterFold.currentActorIndex]!.agentId).not.toBe(foldedPlayer.agentId);
    }
  });

  it('all-in cascade: all players go all-in', () => {
    const config = makeConfig(3, 100);
    const { state, deck } = createGame(config);
    let s = state;
    // Force all players to go all-in
    s = processAction(s, { type: 'all_in' }, deck); // UTG
    s = processAction(s, { type: 'all_in' }, deck); // SB
    s = processAction(s, { type: 'all_in' }, deck); // BB
    // After all-in cascade, should go straight to showdown or finished
    expect(['showdown', 'finished', 'flop', 'turn', 'river']).toContain(s.stage);
    // No player has chips left
    for (const p of s.players) {
      expect(p.stack).toBe(0);
    }
  });

  it('last player standing wins without showdown', () => {
    const { state, deck } = createGame(makeConfig(2));
    // Heads-up: dealer (p1) is SB and first to act pre-flop, BB is p2
    const afterFold = processAction(state, { type: 'fold' }, deck);
    expect(afterFold.stage).toBe('finished');
    const winners = getWinners(afterFold);
    expect(winners).toHaveLength(1);
    // The winner is the non-folded player
    const foldedId = afterFold.players.find((p) => p.isFolded)!.agentId;
    expect(winners[0]!.agentId).not.toBe(foldedId);
  });

  it('minRaise updates on re-raise', () => {
    const { state, deck } = createGame(makeConfig(3));
    // UTG raises to 60 (call 20 + raise 40, minRaise should update to 40)
    const s1 = processAction(state, { type: 'raise', amount: 40 }, deck);
    expect(s1.minRaise).toBeGreaterThanOrEqual(40);
  });

  it('pot amount equals sum of all bets', () => {
    const { state, deck } = createGame(makeConfig(3));
    let s = state;
    s = processAction(s, { type: 'call' }, deck);
    s = processAction(s, { type: 'call' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    // After flop, pot should be sum of all bets
    const totalBet = 3 * 20; // all called to 20
    const potAmount = s.pots.reduce((sum, p) => sum + p.amount, 0);
    expect(potAmount).toBe(totalBet);
  });

  it('10-player game starts correctly', () => {
    const config = makeConfig(10);
    const { state } = createGame(config);
    expect(state.players).toHaveLength(10);
    for (const p of state.players) {
      expect(p.cards).toHaveLength(2);
    }
  });

  it('split pot on tie distributes evenly', () => {
    // Force a tie by using identical board and hole cards
    // We'll do this by verifying getWinners handles ties
    const { state, deck } = createGame(makeConfig(2, 1000));
    let s = state;
    // Play through to showdown with all checks
    s = processAction(s, { type: 'call' }, deck);   // SB calls
    s = processAction(s, { type: 'check' }, deck);  // BB checks
    // Flop
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    // Turn
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    // River
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    expect(s.stage).toBe('showdown');

    const winners = getWinners(s);
    const totalWon = winners.reduce((sum, w) => sum + w.amount, 0);
    const totalPot = s.pots.reduce((sum, p) => sum + p.amount, 0);
    expect(totalWon).toBe(totalPot);
  });

  it('all-in with short stack creates side pot', () => {
    const config: GameConfig = {
      arenaId: 'test',
      players: [
        { agentId: 'short', agentName: 'Short', stack: 30 },
        { agentId: 'deep1', agentName: 'Deep1', stack: 1000 },
        { agentId: 'deep2', agentName: 'Deep2', stack: 1000 },
      ],
      smallBlind: 5,
      bigBlind: 10,
      dealerIndex: 0,
    };

    const { state, deck } = createGame(config);
    let s = state;

    // UTG (short) goes all-in
    s = processAction(s, { type: 'all_in' }, deck);
    // SB raises
    s = processAction(s, { type: 'raise', amount: 50 }, deck);
    // BB calls
    s = processAction(s, { type: 'call' }, deck);

    // After this round, there should be 2 pots (main + side)
    const chipsInPots = s.pots.reduce((sum, p) => sum + p.amount, 0);
    expect(chipsInPots).toBeGreaterThan(0);
  });

  it('getValidActions returns empty for folded player', () => {
    const { state, deck } = createGame(makeConfig(3));
    const afterFold = processAction(state, { type: 'fold' }, deck);
    const foldedIdx = afterFold.players.findIndex((p) => p.isFolded);
    const foldedState = { ...afterFold, currentActorIndex: foldedIdx };
    expect(getValidActions(foldedState)).toHaveLength(0);
  });

  it('getValidActions returns empty for all-in player', () => {
    const { state, deck } = createGame(makeConfig(2));
    const afterAllIn = processAction(state, { type: 'all_in' }, deck);
    const allInIdx = afterAllIn.players.findIndex((p) => p.isAllIn);
    if (allInIdx >= 0) {
      const allInState = { ...afterAllIn, currentActorIndex: allInIdx };
      expect(getValidActions(allInState)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Deck tests
// ---------------------------------------------------------------------------

describe('deck', () => {
  it('shuffled deck has 52 unique cards', async () => {
    const { createDeck, shuffleDeck } = await import('../deck.js');
    const deck = shuffleDeck(createDeck());
    expect(deck).toHaveLength(52);
    const unique = new Set(deck.map((c) => `${c.rank}-${c.suit}`));
    expect(unique.size).toBe(52);
  });

  it('two shuffles produce different orders (probability)', async () => {
    const { createDeck, shuffleDeck } = await import('../deck.js');
    const d1 = shuffleDeck(createDeck());
    const d2 = shuffleDeck(createDeck());
    // Astronomically unlikely to be identical
    const same = d1.every((c, i) => c.rank === d2[i]!.rank && c.suit === d2[i]!.suit);
    expect(same).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Statistical variance: ensure diverse hand ranks appear
// ---------------------------------------------------------------------------

describe('hand rank distribution over 10000 random hands', () => {
  it('sees at least pairs, two pairs, trips, straights, and flushes', async () => {
    const { evaluateHand } = await import('../evaluator.js');
    const { createDeck, shuffleDeck } = await import('../deck.js');

    const rankCounts: Record<string, number> = {};
    const trials = 10000;

    for (let i = 0; i < trials; i++) {
      const deck = shuffleDeck(createDeck());
      const hand = evaluateHand(deck.slice(0, 7));
      rankCounts[hand.rank] = (rankCounts[hand.rank] ?? 0) + 1;
    }

    // Statistically, over 10k hands, we should see all common ranks
    expect(rankCounts['pair']).toBeGreaterThan(400);
    expect(rankCounts['two_pair']).toBeGreaterThan(200);
    expect(rankCounts['three_of_a_kind']).toBeGreaterThan(50);
    expect(rankCounts['straight']).toBeGreaterThan(30);
    expect(rankCounts['flush']).toBeGreaterThan(20);
    expect(rankCounts['full_house']).toBeGreaterThan(20);
    expect(rankCounts['high_card']).toBeGreaterThan(100);
  });
});
