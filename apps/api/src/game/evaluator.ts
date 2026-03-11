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

// ─── Card encoding ────────────────────────────────────────────────────────────
// Rank index: 0=2, 1=3, ..., 8=T, 9=J, 10=Q, 11=K, 12=A
const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

// One unique prime per rank — product of any 5 uniquely identifies the rank multiset.
const RANK_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41] as const;

// Numeric values matching rankValue() in deck.ts
const RANK_VALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

// O(1) rank index lookup — avoids linear scan on every card evaluation
const RANK_IDX: Record<string, number> = Object.fromEntries(
  RANK_NAMES.map((r, i) => [r, i]),
);

function rankIdx(r: string): number {
  const idx = RANK_IDX[r];
  if (idx === undefined) throw new Error(`Unknown rank: ${r}`);
  return idx;
}

function displayName(val: number): string {
  switch (val) {
    case 14: return 'Ace';
    case 13: return 'King';
    case 12: return 'Queen';
    case 11: return 'Jack';
    default: return String(val);
  }
}

// ─── Lookup table types ───────────────────────────────────────────────────────

interface HandEntry {
  rank: HandRank;
  score: number;
  description: string;
  /** True for wheel straights (A-2-3-4-5): ace moves to end for display. */
  isWheelStraight: boolean;
}

/**
 * O(1) lookup for non-flush 5-card hands.
 * Key = product of rank primes (uniquely identifies the rank multiset).
 *
 * Total entries: 7462 − 1287 = 6175
 *   4-of-a-kind: 156, full house: 156, straights: 10,
 *   3-of-a-kind: 858, two pair: 858, pair: 2860, high card: 1277
 */
const rankTable = new Map<number, HandEntry>();

/**
 * O(1) lookup for flush 5-card hands (incl. straight flushes / royal flush).
 * Key = bitmask of rank indices (bit i set ↔ rank i present).
 * Only used when all 5 cards share the same suit.
 *
 * Total entries: C(13,5) = 1287
 *   royal flush: 1, straight flush: 9, regular flush: 1277
 */
const flushTable = new Map<number, HandEntry>();

// ─── Table-building helpers ───────────────────────────────────────────────────

/** C(arr, k) — preserves input order. */
function combinationsK<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinationsK(rest, k - 1).map(c => [first!, ...c]),
    ...combinationsK(rest, k),
  ];
}

function isWheelPattern(sortedDesc: number[]): boolean {
  // A-5-4-3-2 as rank indices: [12, 3, 2, 1, 0]
  return (
    sortedDesc.length === 5 &&
    sortedDesc[0] === 12 &&
    sortedDesc[1] === 3 &&
    sortedDesc[2] === 2 &&
    sortedDesc[3] === 1 &&
    sortedDesc[4] === 0
  );
}

function isConsecutive(sortedDesc: number[]): boolean {
  for (let i = 0; i < sortedDesc.length - 1; i++) {
    if (sortedDesc[i]! - sortedDesc[i + 1]! !== 1) return false;
  }
  return true;
}

function isStraightPattern(sortedDesc: number[]): boolean {
  return isConsecutive(sortedDesc) || isWheelPattern(sortedDesc);
}

/** Effective top-card value for straight scoring (5 for wheel). */
function straightTopVal(sortedDesc: number[]): number {
  return isWheelPattern(sortedDesc) ? 5 : RANK_VALS[sortedDesc[0]!]!;
}

/** All C(13,5) = 1287 rank-index combos, each sorted descending (A first). */
function allRankCombos5(): number[][] {
  return combinationsK([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0], 5);
}

// ─── Build lookup tables once at module load ──────────────────────────────────

function buildTables(): void {
  const allIndices = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  const combos5 = allRankCombos5();

  // ── Four of a Kind (13 × 12 = 156 entries) ──────────────────────────────
  for (let q = 12; q >= 0; q--) {
    for (let k = 12; k >= 0; k--) {
      if (k === q) continue;
      const product = RANK_PRIMES[q]! ** 4 * RANK_PRIMES[k]!;
      rankTable.set(product, {
        rank: 'four_of_a_kind',
        score: RANK_VALS[q]! * 100 + RANK_VALS[k]!,
        description: `Four of a Kind, ${displayName(RANK_VALS[q]!)}s`,
        isWheelStraight: false,
      });
    }
  }

  // ── Full House (13 × 12 = 156 entries) ──────────────────────────────────
  for (let t = 12; t >= 0; t--) {
    for (let p = 12; p >= 0; p--) {
      if (p === t) continue;
      const product = RANK_PRIMES[t]! ** 3 * RANK_PRIMES[p]! ** 2;
      rankTable.set(product, {
        rank: 'full_house',
        score: RANK_VALS[t]! * 100 + RANK_VALS[p]!,
        description: `Full House, ${displayName(RANK_VALS[t]!)}s full of ${displayName(RANK_VALS[p]!)}s`,
        isWheelStraight: false,
      });
    }
  }

  // ── Flush table: 1287 distinct 5-rank bitmasks ───────────────────────────
  // Covers straight flushes, royal flush, and regular flushes.
  for (const ranks of combos5) {
    const bits = ranks.reduce((b, r) => b | (1 << r), 0);
    if (isStraightPattern(ranks)) {
      const topVal = straightTopVal(ranks);
      const isRoyal = topVal === 14;
      const wheel = isWheelPattern(ranks);
      flushTable.set(bits, {
        rank: isRoyal ? 'royal_flush' : 'straight_flush',
        score: topVal,
        description: isRoyal
          ? 'Royal Flush'
          : wheel
            ? 'Straight Flush, 5 high'
            : `Straight Flush, ${RANK_NAMES[ranks[0]!]} high`,
        isWheelStraight: wheel,
      });
    } else {
      const vals = ranks.map(r => RANK_VALS[r]!);
      flushTable.set(bits, {
        rank: 'flush',
        score: vals[0]! * 10000 + vals[1]! * 1000 + vals[2]! * 100 + vals[3]! * 10 + vals[4]!,
        description: `Flush, ${RANK_NAMES[ranks[0]!]} high`,
        isWheelStraight: false,
      });
    }
  }

  // ── Straight / non-flush (10 entries) ───────────────────────────────────
  for (const ranks of combos5) {
    if (!isStraightPattern(ranks)) continue;
    const product = ranks.reduce((p, r) => p * RANK_PRIMES[r]!, 1);
    const topVal = straightTopVal(ranks);
    const wheel = isWheelPattern(ranks);
    rankTable.set(product, {
      rank: 'straight',
      score: topVal,
      description: wheel ? 'Straight, 5 high' : `Straight, ${RANK_NAMES[ranks[0]!]} high`,
      isWheelStraight: wheel,
    });
  }

  // ── Three of a Kind (13 × C(12,2) = 858 entries) ────────────────────────
  for (let t = 12; t >= 0; t--) {
    const kickerPool = allIndices.filter(i => i !== t);
    for (const [k1, k2] of combinationsK(kickerPool, 2)) {
      rankTable.set(RANK_PRIMES[t]! ** 3 * RANK_PRIMES[k1!]! * RANK_PRIMES[k2!]!, {
        rank: 'three_of_a_kind',
        score: RANK_VALS[t]! * 10000 + RANK_VALS[k1!]! * 100 + RANK_VALS[k2!]!,
        description: `Three of a Kind, ${displayName(RANK_VALS[t]!)}s`,
        isWheelStraight: false,
      });
    }
  }

  // ── Two Pair (C(13,2) × 11 = 858 entries) ───────────────────────────────
  for (const [hp, lp] of combinationsK(allIndices, 2)) {
    for (const k of allIndices.filter(i => i !== hp && i !== lp)) {
      rankTable.set(RANK_PRIMES[hp!]! ** 2 * RANK_PRIMES[lp!]! ** 2 * RANK_PRIMES[k]!, {
        rank: 'two_pair',
        score: RANK_VALS[hp!]! * 10000 + RANK_VALS[lp!]! * 100 + RANK_VALS[k]!,
        description: `Two Pair, ${displayName(RANK_VALS[hp!]!)}s and ${displayName(RANK_VALS[lp!]!)}s`,
        isWheelStraight: false,
      });
    }
  }

  // ── Pair (13 × C(12,3) = 2860 entries) ──────────────────────────────────
  for (let p = 12; p >= 0; p--) {
    const kickerPool = allIndices.filter(i => i !== p);
    for (const [k1, k2, k3] of combinationsK(kickerPool, 3)) {
      rankTable.set(
        RANK_PRIMES[p]! ** 2 * RANK_PRIMES[k1!]! * RANK_PRIMES[k2!]! * RANK_PRIMES[k3!]!,
        {
          rank: 'pair',
          score:
            RANK_VALS[p]! * 1000000 +
            RANK_VALS[k1!]! * 10000 +
            RANK_VALS[k2!]! * 100 +
            RANK_VALS[k3!]!,
          description: `Pair of ${displayName(RANK_VALS[p]!)}s`,
          isWheelStraight: false,
        },
      );
    }
  }

  // ── High Card (1277 entries = C(13,5) − 10 straights) ───────────────────
  for (const ranks of combos5) {
    if (isStraightPattern(ranks)) continue;
    const product = ranks.reduce((p, r) => p * RANK_PRIMES[r]!, 1);
    const vals = ranks.map(r => RANK_VALS[r]!);
    rankTable.set(product, {
      rank: 'high_card',
      score:
        vals[0]! * 100000000 +
        vals[1]! * 1000000 +
        vals[2]! * 10000 +
        vals[3]! * 100 +
        vals[4]!,
      description: `High Card, ${RANK_NAMES[ranks[0]!]}`,
      isWheelStraight: false,
    });
  }
}

// Execute once at module load — populates 7462 entries in ~1ms
buildTables();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate the best 5-card hand from any number of cards (typically 7).
 *
 * For the common 7-card case, iterates C(7,2)=21 pairs of excluded indices
 * to avoid 21 array allocations. Each 5-card lookup is O(1) via pre-built
 * hash tables covering all C(52,5)=2,598,960 possible hands across 7,462
 * distinct rank categories — efficiently handling the full C(52,7)=133,784,560
 * 7-card combination space.
 */
export function evaluateHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }

  // Fast path for the most common case (2 hole + 5 community = 7 cards)
  if (cards.length === 7) {
    return evaluateBest7(cards);
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
 * Optimised 7-card evaluation: iterate over C(7,2)=21 pairs of excluded
 * indices so no combination arrays are allocated per iteration.
 */
function evaluateBest7(cards: Card[]): EvaluatedHand {
  let best: EvaluatedHand | null = null;
  const buf: Card[] = new Array(5) as Card[];

  for (let s1 = 0; s1 < 7; s1++) {
    for (let s2 = s1 + 1; s2 < 7; s2++) {
      let bi = 0;
      for (let i = 0; i < 7; i++) {
        if (i !== s1 && i !== s2) buf[bi++] = cards[i]!;
      }
      const ev = evaluate5(buf);
      if (!best || compareHands(ev, best) > 0) best = ev;
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
 * Evaluate exactly 5 cards in O(1) using pre-built lookup tables.
 *
 * Algorithm:
 *   1. Sort cards by rank descending.
 *   2. If all same suit → bitmask of rank indices → flushTable lookup.
 *   3. Otherwise → product of rank primes → rankTable lookup.
 *
 * The prime-product key uniquely identifies any rank multiset (by the
 * fundamental theorem of arithmetic), covering all possible hand patterns
 * without sorting or pattern-matching at evaluation time.
 */
function evaluate5(cards: Card[]): EvaluatedHand {
  const sorted = [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
  const indices = sorted.map(c => rankIdx(c.rank as string));
  const isFlush = sorted.every(c => c.suit === sorted[0]!.suit);

  let entry: HandEntry;

  if (isFlush) {
    const bits = indices.reduce((b, r) => b | (1 << r), 0);
    entry = flushTable.get(bits)!;
  } else {
    const product = indices.reduce((p, r) => p * RANK_PRIMES[r]!, 1);
    entry = rankTable.get(product)!;
  }

  if (!entry) {
    throw new Error(
      `Hand not found in lookup table (flush=${isFlush}, cards=${sorted.map(c => `${c.rank}${c.suit[0]}`).join(',')})`,
    );
  }

  // Wheel straight (A-2-3-4-5): display with ace at the end
  const displayCards =
    entry.isWheelStraight ? [...sorted.slice(1), sorted[0]!] : sorted;

  return {
    rank: entry.rank,
    score: entry.score,
    cards: displayCards,
    description: entry.description,
  };
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
