/**
 * AGO-47: Game engine microbenchmarks.
 *
 * Run with: pnpm --filter @agon/api perf:bench
 *
 * Measures throughput of pure game-engine functions:
 *   - createGame (deck shuffle + blind posting + card dealing)
 *   - processAction (structuredClone + state transition)
 *   - evaluateHand (C(7,5) combo enumeration + hand ranking)
 *   - getWinners (pot splitting + hand comparison)
 *   - Full hand simulation (deal → showdown with 2-6 players)
 */
import { bench, describe } from 'vitest';
import { createGame, processAction, getValidActions, getWinners } from '../game/engine.js';
import { evaluateHand } from '../game/evaluator.js';
import { createDeck, shuffleDeck } from '../game/deck.js';
import { calculatePots } from '../game/pot.js';
import type { GameConfig } from '../game/engine.js';
import type { Card, GameState, PlayerAction } from '@agon/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(playerCount: number): GameConfig {
  return {
    arenaId: 'bench-arena',
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

/** Play a full hand where every player checks/calls to showdown. */
function playFullHand(playerCount: number): void {
  const { state, deck } = createGame(makeConfig(playerCount));
  let s = state;

  while (s.stage !== 'showdown' && s.stage !== 'finished' && s.currentActorIndex !== null) {
    const actions = getValidActions(s);
    if (actions.length === 0) break;

    // Simple strategy: call or check
    const action: PlayerAction = actions.includes('check')
      ? { type: 'check' }
      : actions.includes('call')
        ? { type: 'call' }
        : { type: 'fold' };

    s = processAction(s, action, deck);
  }

  if (s.stage === 'showdown' || s.stage === 'finished') {
    getWinners(s);
  }
}

/** Build a 7-card hand (2 hole + 5 community) from a shuffled deck. */
function deal7Cards(): Card[] {
  const deck = shuffleDeck(createDeck());
  return [deck[0]!, deck[1]!, deck[2]!, deck[3]!, deck[4]!, deck[5]!, deck[6]!];
}

// Pre-build some test data so bench setup isn't measured.
const prebuilt2p = createGame(makeConfig(2));
const prebuilt6p = createGame(makeConfig(6));
const prebuilt10p = createGame(makeConfig(10));
const sevenCards = deal7Cards();

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('createGame', () => {
  bench('2 players', () => {
    createGame(makeConfig(2));
  });

  bench('6 players', () => {
    createGame(makeConfig(6));
  });

  bench('10 players', () => {
    createGame(makeConfig(10));
  });
});

describe('processAction (single action)', () => {
  bench('fold', () => {
    processAction(prebuilt2p.state, { type: 'fold' }, [...prebuilt2p.deck]);
  });

  bench('call', () => {
    processAction(prebuilt2p.state, { type: 'call' }, [...prebuilt2p.deck]);
  });

  bench('raise', () => {
    processAction(prebuilt2p.state, { type: 'raise', amount: 40 }, [...prebuilt2p.deck]);
  });

  bench('all_in', () => {
    processAction(prebuilt2p.state, { type: 'all_in' }, [...prebuilt2p.deck]);
  });
});

describe('getValidActions', () => {
  bench('pre-flop 2p', () => {
    getValidActions(prebuilt2p.state);
  });

  bench('pre-flop 6p', () => {
    getValidActions(prebuilt6p.state);
  });
});

describe('evaluateHand', () => {
  bench('7-card evaluation (C(7,5) = 21 combos)', () => {
    evaluateHand(sevenCards);
  });
});

describe('calculatePots', () => {
  bench('no side pots (2p)', () => {
    calculatePots(prebuilt2p.state.players);
  });

  bench('no side pots (6p)', () => {
    calculatePots(prebuilt6p.state.players);
  });
});

describe('shuffleDeck', () => {
  const deck = createDeck();
  bench('Fisher-Yates 52 cards', () => {
    shuffleDeck([...deck]);
  });
});

describe('full hand simulation', () => {
  bench('2 players → showdown', () => {
    playFullHand(2);
  });

  bench('4 players → showdown', () => {
    playFullHand(4);
  });

  bench('6 players → showdown', () => {
    playFullHand(6);
  });

  bench('10 players → showdown', () => {
    playFullHand(10);
  });
});
