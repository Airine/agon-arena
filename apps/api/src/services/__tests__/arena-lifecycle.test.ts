import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { GameState } from '@agon/types';
import { gameHands } from '../../db/schema.js';

const {
  mockLimit,
  mockOrderBy,
  mockWhere,
  mockFrom,
  mockSelect,
  mockSetGameSnapshot,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockSetGameSnapshot = vi.fn();

  return {
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockFrom,
    mockSelect,
    mockSetGameSnapshot,
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    select: mockSelect,
  },
  schema: {
    gameHands: {
      arenaId: 'arenaId',
      handNumber: 'handNumber',
      stage: 'stage',
      stateSnapshot: 'stateSnapshot',
      startedAt: 'startedAt',
      endedAt: 'endedAt',
    },
  },
}));

vi.mock('../redis.js', () => ({
  getAgentPendingTurn: vi.fn(),
  getGameSnapshot: vi.fn(),
  setGameSnapshot: mockSetGameSnapshot,
}));

import { buildFallbackArenaSnapshot } from '../arena-lifecycle.js';

function makeState(): GameState {
  return {
    arenaId: 'arena-123',
    handId: 'hand-123',
    handNumber: 12,
    stage: 'finished',
    players: [
      {
        agentId: 'agent-a',
        agentName: 'Alpha',
        position: 0,
        stack: 1200,
        bet: 0,
        totalBet: 200,
        cards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'A', suit: 'hearts' },
        ],
        isActive: true,
        isFolded: false,
        isAllIn: false,
        hasActed: true,
      },
    ],
    communityCards: [
      { rank: 'K', suit: 'clubs' },
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'J', suit: 'spades' },
      { rank: '10', suit: 'hearts' },
      { rank: '9', suit: 'clubs' },
    ],
    pots: [{ amount: 200, eligiblePlayers: ['agent-a'] }],
    currentActorIndex: null,
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 0,
    smallBlindAmount: 10,
    bigBlindAmount: 20,
    minRaise: 40,
  };
}

describe('arena lifecycle types', () => {
  it('types persisted hand snapshots as GameState', () => {
    type GameHandRow = typeof gameHands.$inferSelect;
    expectTypeOf<GameHandRow['stateSnapshot']>().toEqualTypeOf<GameState | null>();
  });
});

describe('buildFallbackArenaSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the latest finished hand snapshot and caches it in Redis', async () => {
    const state = makeState();
    const endedAt = new Date('2026-03-16T04:05:06.000Z');

    mockLimit.mockResolvedValueOnce([
      {
        handNumber: 12,
        stage: 'finished',
        stateSnapshot: state,
        startedAt: new Date('2026-03-16T04:00:00.000Z'),
        endedAt,
      },
    ]);

    const snapshot = await buildFallbackArenaSnapshot('arena-123');

    expect(snapshot).toEqual({
      arenaId: 'arena-123',
      gameState: state,
      handNumber: 12,
      updatedAt: endedAt.getTime(),
    });
    expect(mockSetGameSnapshot).toHaveBeenCalledWith('arena-123', snapshot);
  });

  it('returns null when there is no finished hand snapshot to reuse', async () => {
    mockLimit.mockResolvedValueOnce([{ handNumber: 12, stage: 'finished', stateSnapshot: null }]);

    await expect(buildFallbackArenaSnapshot('arena-123')).resolves.toBeNull();
    expect(mockSetGameSnapshot).not.toHaveBeenCalled();
  });
});
