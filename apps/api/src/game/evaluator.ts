import type { Card, HandRank } from '@agon/types';
import { rankValue } from './deck.js';

export interface EvaluatedHand {
  rank: HandRank;
  /** Primary score for comparing hands of same rank. Higher = better. */
  score: number;
  /** The best 5 cards. */
  cards: Card[];
  description: string;
}

/**
 * Hand rank to numeric tier (higher = better hand).
 */
const HAND_RANK_TIER: Record<HandRank, number> = {
  royal_flush: 9,
  straight_flush: 8,
  four_of_a_kind: 7,
  full_house: 6,
  flush: 5,
  straight: 4,
  three_of_a_kind: 3,
  two_pair: 2,
  pair: 1,
  high_card: 0,
};

/**
 * Evaluate the best 5-card hand from any number of cards (typically 7).
 * Returns the best hand with rank, score, and description.
 */
export function evaluateHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }

  const combos = combinations(cards, 5);
  let best: EvaluatedHand | null = null;

  for (const combo of combos) {
    const evaluated = evaluate5(combo);
    if (!best || compareHands(evaluated, best) > 0) {
      best = evaluated;
    }
  }

  return best!;
}

/**
 * Compare two evaluated hands. Returns >0 if a is better, <0 if b is better, 0 if tie.
 */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  const tierDiff = HAND_RANK_TIER[a.rank] - HAND_RANK_TIER[b.rank];
  if (tierDiff !== 0) return tierDiff;
  return a.score - b.score;
}

/**
 * Evaluate exactly 5 cards.
 */
function evaluate5(cards: Card[]): EvaluatedHand {
  const sorted = [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
  const values = sorted.map((c) => rankValue(c.rank));

  const isFlush = sorted.every((c) => c.suit === sorted[0]!.suit);
  const isStraight = checkStraight(values);

  // Ace-low straight (A-2-3-4-5)
  const isLowStraight = !isStraight && checkLowStraight(values);

  if (isFlush && isStraight) {
    if (values[0] === 14) {
      return { rank: 'royal_flush', score: 14, cards: sorted, description: 'Royal Flush' };
    }
    return {
      rank: 'straight_flush',
      score: values[0]!,
      cards: sorted,
      description: `Straight Flush, ${sorted[0]!.rank} high`,
    };
  }

  if (isFlush && isLowStraight) {
    return {
      rank: 'straight_flush',
      score: 5,
      cards: reorderLowStraight(sorted),
      description: 'Straight Flush, 5 high',
    };
  }

  // Count rank occurrences
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // By count descending
    return b[0] - a[0]; // By value descending
  });

  const pattern = groups.map((g) => g[1]).join(',');

  if (pattern === '4,1') {
    const quadVal = groups[0]![0];
    const kicker = groups[1]![0];
    return {
      rank: 'four_of_a_kind',
      score: quadVal * 100 + kicker,
      cards: sorted,
      description: `Four of a Kind, ${rankName(quadVal)}s`,
    };
  }

  if (pattern === '3,2') {
    const tripVal = groups[0]![0];
    const pairVal = groups[1]![0];
    return {
      rank: 'full_house',
      score: tripVal * 100 + pairVal,
      cards: sorted,
      description: `Full House, ${rankName(tripVal)}s full of ${rankName(pairVal)}s`,
    };
  }

  if (isFlush) {
    const score = values[0]! * 10000 + values[1]! * 1000 + values[2]! * 100 + values[3]! * 10 + values[4]!;
    return { rank: 'flush', score, cards: sorted, description: `Flush, ${sorted[0]!.rank} high` };
  }

  if (isStraight) {
    return {
      rank: 'straight',
      score: values[0]!,
      cards: sorted,
      description: `Straight, ${sorted[0]!.rank} high`,
    };
  }

  if (isLowStraight) {
    return {
      rank: 'straight',
      score: 5,
      cards: reorderLowStraight(sorted),
      description: 'Straight, 5 high',
    };
  }

  if (pattern === '3,1,1') {
    const tripVal = groups[0]![0];
    const k1 = groups[1]![0];
    const k2 = groups[2]![0];
    return {
      rank: 'three_of_a_kind',
      score: tripVal * 10000 + k1 * 100 + k2,
      cards: sorted,
      description: `Three of a Kind, ${rankName(tripVal)}s`,
    };
  }

  if (pattern === '2,2,1') {
    const highPair = groups[0]![0];
    const lowPair = groups[1]![0];
    const kicker = groups[2]![0];
    return {
      rank: 'two_pair',
      score: highPair * 10000 + lowPair * 100 + kicker,
      cards: sorted,
      description: `Two Pair, ${rankName(highPair)}s and ${rankName(lowPair)}s`,
    };
  }

  if (pattern === '2,1,1,1') {
    const pairVal = groups[0]![0];
    const k1 = groups[1]![0];
    const k2 = groups[2]![0];
    const k3 = groups[3]![0];
    return {
      rank: 'pair',
      score: pairVal * 1000000 + k1 * 10000 + k2 * 100 + k3,
      cards: sorted,
      description: `Pair of ${rankName(pairVal)}s`,
    };
  }

  // High card
  const score = values[0]! * 100000000 + values[1]! * 1000000 + values[2]! * 10000 + values[3]! * 100 + values[4]!;
  return {
    rank: 'high_card',
    score,
    cards: sorted,
    description: `High Card, ${sorted[0]!.rank}`,
  };
}

function checkStraight(values: number[]): boolean {
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i]! - values[i + 1]! !== 1) return false;
  }
  return true;
}

function checkLowStraight(values: number[]): boolean {
  // A-2-3-4-5 → sorted as [14, 5, 4, 3, 2]
  return (
    values[0] === 14 &&
    values[1] === 5 &&
    values[2] === 4 &&
    values[3] === 3 &&
    values[4] === 2
  );
}

function reorderLowStraight(sorted: Card[]): Card[] {
  // Move ace to end for A-low straight
  const ace = sorted[0]!;
  return [...sorted.slice(1), ace];
}

function rankName(value: number): string {
  switch (value) {
    case 14: return 'Ace';
    case 13: return 'King';
    case 12: return 'Queen';
    case 11: return 'Jack';
    default: return String(value);
  }
}

/**
 * Generate all C(n,k) combinations.
 */
function combinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = [];

  function backtrack(start: number, current: T[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]!);
      backtrack(i + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return result;
}
