import { describe, it, expect } from 'vitest';
import type { PlayerState } from '@agon/types';
import { calculatePots } from '../pot.js';

function makePlayer(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    agentId: id,
    agentName: id,
    position: 0,
    stack: 0,
    bet: 0,
    totalBet: 0,
    cards: [],
    isActive: true,
    isFolded: false,
    isAllIn: false,
    hasActed: true,
    ...overrides,
  };
}

describe('calculatePots', () => {
  it('single pot when no all-ins', () => {
    const players = [
      makePlayer('p1', { totalBet: 100 }),
      makePlayer('p2', { totalBet: 100 }),
      makePlayer('p3', { totalBet: 100 }),
    ];
    const pots = calculatePots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligiblePlayers).toHaveLength(3);
  });

  it('creates side pot with one all-in', () => {
    const players = [
      makePlayer('p1', { totalBet: 50, isAllIn: true, stack: 0 }),
      makePlayer('p2', { totalBet: 100 }),
      makePlayer('p3', { totalBet: 100 }),
    ];
    const pots = calculatePots(players);
    expect(pots).toHaveLength(2);
    // Main pot: 50 * 3 = 150
    expect(pots[0]!.amount).toBe(150);
    expect(pots[0]!.eligiblePlayers).toHaveLength(3);
    // Side pot: 50 * 2 = 100
    expect(pots[1]!.amount).toBe(100);
    expect(pots[1]!.eligiblePlayers).toHaveLength(2);
    expect(pots[1]!.eligiblePlayers).not.toContain('p1');
  });

  it('creates multiple side pots with different all-in amounts', () => {
    const players = [
      makePlayer('p1', { totalBet: 30, isAllIn: true, stack: 0 }),
      makePlayer('p2', { totalBet: 70, isAllIn: true, stack: 0 }),
      makePlayer('p3', { totalBet: 100 }),
    ];
    const pots = calculatePots(players);
    expect(pots).toHaveLength(3);
    // Main pot: 30 * 3 = 90
    expect(pots[0]!.amount).toBe(90);
    expect(pots[0]!.eligiblePlayers).toHaveLength(3);
    // Side pot 1: 40 * 2 = 80
    expect(pots[1]!.amount).toBe(80);
    expect(pots[1]!.eligiblePlayers).toHaveLength(2);
    // Side pot 2: 30 * 1 = 30
    expect(pots[2]!.amount).toBe(30);
    expect(pots[2]!.eligiblePlayers).toHaveLength(1);
  });

  it('excludes folded players from eligible', () => {
    const players = [
      makePlayer('p1', { totalBet: 50, isFolded: true }),
      makePlayer('p2', { totalBet: 100 }),
      makePlayer('p3', { totalBet: 100 }),
    ];
    const pots = calculatePots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(250);
    expect(pots[0]!.eligiblePlayers).toHaveLength(2);
    expect(pots[0]!.eligiblePlayers).not.toContain('p1');
  });
});
