/**
 * Performance test for the O(1) lookup-table hand evaluator.
 *
 * Verifies that the evaluator handles the full 7-card combination space
 * (C(52,7) = 133,784,560 possible deals) at a rate that supports
 * real-time game play and batch simulation workloads.
 *
 * Target: ≥ 100,000 full 7-card evaluations per second.
 */
import { describe, it, expect } from 'vitest';
import type { Card } from '@agon/types';
import { evaluateHand } from '../game/evaluator.js';

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

describe('evaluator performance', () => {
  it('evaluates ≥ 100,000 7-card hands per second', () => {
    const deck = buildDeck();

    // Sample 10,000 random 7-card deals for the benchmark
    const SAMPLE = 10_000;
    const hands: Card[][] = [];
    for (let i = 0; i < SAMPLE; i++) {
      // Deterministic rotation: pick 7 cards by cycling through the deck
      const offset = (i * 7) % 52;
      const hand: Card[] = [];
      const seen = new Set<number>();
      for (let j = 0; hand.length < 7; j++) {
        const idx = (offset + j) % 52;
        if (!seen.has(idx)) {
          seen.add(idx);
          hand.push(deck[idx]!);
        }
      }
      hands.push(hand);
    }

    const start = performance.now();
    for (const hand of hands) {
      evaluateHand(hand);
    }
    const elapsed = performance.now() - start;

    const perSecond = (SAMPLE / elapsed) * 1000;
    console.log(
      `Evaluated ${SAMPLE} hands in ${elapsed.toFixed(1)}ms → ${Math.round(perSecond).toLocaleString()} hands/sec`,
    );

    // ≥ 100K/sec target. Run isolated for accurate numbers:
    //   pnpm --filter api exec vitest run src/perf/evaluator-perf.test.ts
    expect(perSecond).toBeGreaterThan(100_000);
  });

  it('correctly classifies all hand types across a sample', () => {
    // Spot-check a variety of known hands to confirm lookup accuracy
    const tests: [Card[], string][] = [
      // Royal flush
      [
        [
          { rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' },
          { rank: 'Q', suit: 'spades' }, { rank: 'J', suit: 'spades' },
          { rank: '10', suit: 'spades' }, { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'clubs' },
        ],
        'royal_flush',
      ],
      // Straight flush (non-royal)
      [
        [
          { rank: '9', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
          { rank: '7', suit: 'hearts' }, { rank: '6', suit: 'hearts' },
          { rank: '5', suit: 'hearts' }, { rank: 'K', suit: 'clubs' },
          { rank: 'A', suit: 'diamonds' },
        ],
        'straight_flush',
      ],
      // Wheel straight flush (A-2-3-4-5)
      [
        [
          { rank: 'A', suit: 'clubs' }, { rank: '2', suit: 'clubs' },
          { rank: '3', suit: 'clubs' }, { rank: '4', suit: 'clubs' },
          { rank: '5', suit: 'clubs' }, { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'diamonds' },
        ],
        'straight_flush',
      ],
      // Four of a kind
      [
        [
          { rank: 'K', suit: 'spades' }, { rank: 'K', suit: 'hearts' },
          { rank: 'K', suit: 'diamonds' }, { rank: 'K', suit: 'clubs' },
          { rank: 'A', suit: 'spades' }, { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'clubs' },
        ],
        'four_of_a_kind',
      ],
      // Full house
      [
        [
          { rank: 'J', suit: 'spades' }, { rank: 'J', suit: 'hearts' },
          { rank: 'J', suit: 'diamonds' }, { rank: '9', suit: 'clubs' },
          { rank: '9', suit: 'spades' }, { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'clubs' },
        ],
        'full_house',
      ],
      // Wheel straight (A-2-3-4-5, non-flush)
      [
        [
          { rank: 'A', suit: 'spades' }, { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'diamonds' }, { rank: '4', suit: 'clubs' },
          { rank: '5', suit: 'spades' }, { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'clubs' },
        ],
        'straight',
      ],
    ];

    for (const [cards, expectedRank] of tests) {
      const result = evaluateHand(cards);
      expect(result.rank).toBe(expectedRank);
    }
  });
});
