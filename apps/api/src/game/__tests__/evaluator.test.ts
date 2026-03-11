import { describe, it, expect } from 'vitest';
import type { Card } from '@agon/types';
import { evaluateHand, compareHands } from '../evaluator.js';

function c(rank: string, suit: string): Card {
  return { rank: rank as Card['rank'], suit: suit as Card['suit'] };
}

describe('evaluateHand', () => {
  it('detects royal flush', () => {
    const cards: Card[] = [
      c('A', 'spades'), c('K', 'spades'), c('Q', 'spades'),
      c('J', 'spades'), c('10', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('royal_flush');
  });

  it('detects straight flush', () => {
    const cards: Card[] = [
      c('9', 'hearts'), c('8', 'hearts'), c('7', 'hearts'),
      c('6', 'hearts'), c('5', 'hearts'), c('2', 'clubs'), c('K', 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('straight_flush');
  });

  it('detects ace-low straight flush (wheel flush)', () => {
    const cards: Card[] = [
      c('A', 'clubs'), c('2', 'clubs'), c('3', 'clubs'),
      c('4', 'clubs'), c('5', 'clubs'), c('K', 'hearts'), c('Q', 'diamonds'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('straight_flush');
    expect(result.score).toBe(5);
  });

  it('detects four of a kind', () => {
    const cards: Card[] = [
      c('K', 'spades'), c('K', 'hearts'), c('K', 'diamonds'),
      c('K', 'clubs'), c('A', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('four_of_a_kind');
  });

  it('detects full house', () => {
    const cards: Card[] = [
      c('J', 'spades'), c('J', 'hearts'), c('J', 'diamonds'),
      c('9', 'clubs'), c('9', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('full_house');
  });

  it('detects flush', () => {
    const cards: Card[] = [
      c('A', 'diamonds'), c('J', 'diamonds'), c('8', 'diamonds'),
      c('4', 'diamonds'), c('2', 'diamonds'), c('K', 'hearts'), c('Q', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('flush');
  });

  it('detects straight', () => {
    const cards: Card[] = [
      c('10', 'spades'), c('9', 'hearts'), c('8', 'diamonds'),
      c('7', 'clubs'), c('6', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('straight');
  });

  it('detects ace-low straight (wheel)', () => {
    const cards: Card[] = [
      c('A', 'spades'), c('2', 'hearts'), c('3', 'diamonds'),
      c('4', 'clubs'), c('5', 'spades'), c('K', 'hearts'), c('Q', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('straight');
    expect(result.score).toBe(5);
  });

  it('detects three of a kind', () => {
    const cards: Card[] = [
      c('7', 'spades'), c('7', 'hearts'), c('7', 'diamonds'),
      c('K', 'clubs'), c('J', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('three_of_a_kind');
  });

  it('detects two pair', () => {
    const cards: Card[] = [
      c('A', 'spades'), c('A', 'hearts'), c('K', 'diamonds'),
      c('K', 'clubs'), c('5', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('two_pair');
  });

  it('detects pair', () => {
    const cards: Card[] = [
      c('Q', 'spades'), c('Q', 'hearts'), c('9', 'diamonds'),
      c('7', 'clubs'), c('5', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('pair');
  });

  it('detects high card', () => {
    const cards: Card[] = [
      c('A', 'spades'), c('J', 'hearts'), c('9', 'diamonds'),
      c('7', 'clubs'), c('4', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ];
    const result = evaluateHand(cards);
    expect(result.rank).toBe('high_card');
  });
});

describe('compareHands', () => {
  it('flush beats straight', () => {
    const flush = evaluateHand([
      c('A', 'diamonds'), c('J', 'diamonds'), c('8', 'diamonds'),
      c('4', 'diamonds'), c('2', 'diamonds'), c('3', 'hearts'), c('5', 'clubs'),
    ]);
    const straight = evaluateHand([
      c('10', 'spades'), c('9', 'hearts'), c('8', 'diamonds'),
      c('7', 'clubs'), c('6', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ]);
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });

  it('higher pair beats lower pair', () => {
    const pairAces = evaluateHand([
      c('A', 'spades'), c('A', 'hearts'), c('9', 'diamonds'),
      c('7', 'clubs'), c('5', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ]);
    const pairKings = evaluateHand([
      c('K', 'spades'), c('K', 'hearts'), c('9', 'diamonds'),
      c('7', 'clubs'), c('5', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ]);
    expect(compareHands(pairAces, pairKings)).toBeGreaterThan(0);
  });

  it('same hand ties', () => {
    const hand1 = evaluateHand([
      c('A', 'spades'), c('K', 'hearts'), c('Q', 'diamonds'),
      c('J', 'clubs'), c('9', 'spades'), c('2', 'hearts'), c('3', 'clubs'),
    ]);
    const hand2 = evaluateHand([
      c('A', 'hearts'), c('K', 'diamonds'), c('Q', 'clubs'),
      c('J', 'spades'), c('9', 'hearts'), c('2', 'clubs'), c('3', 'diamonds'),
    ]);
    expect(compareHands(hand1, hand2)).toBe(0);
  });
});
