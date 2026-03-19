import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { GameState } from '@agon/types';
import { gameHands } from '../../db/schema.js';

const {
  mockGetArenaLoopHeartbeat,
  mockGetAgentPendingTurn,
  mockClearGameSnapshot,
  mockGetGameSnapshot,
  mockSelect,
  mockSetGameSnapshot,
  mockUpdate,
  mockUpdateSetWhere,
  queueSelectResult,
  resetSelectResults,
} = vi.hoisted(() => {
  const selectResults: unknown[] = [];

  function queueSelectResult(result: unknown): void {
    selectResults.push(result);
  }

  function resetSelectResults(): void {
    selectResults.length = 0;
  }

  function makeQuery(result: unknown) {
    const promise = Promise.resolve(result);
    return {
      orderBy: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(result),
      })),
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
  }

  const mockSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
    })),
  }));

  const mockUpdateSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: mockUpdateSetWhere,
    })),
  }));

  return {
    mockGetArenaLoopHeartbeat: vi.fn(),
    mockGetAgentPendingTurn: vi.fn(),
    mockClearGameSnapshot: vi.fn(),
    mockGetGameSnapshot: vi.fn(),
    mockSelect,
    mockSetGameSnapshot: vi.fn(),
    mockUpdate,
    mockUpdateSetWhere,
    queueSelectResult,
    resetSelectResults,
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
  schema: {
    arenas: {
      id: 'arenaId',
      status: 'status',
    },
    arenaSeats: {
      arenaId: 'arenaId',
      agentId: 'agentId',
      isActive: 'isActive',
    },
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
  getArenaLoopHeartbeat: mockGetArenaLoopHeartbeat,
  getAgentPendingTurn: mockGetAgentPendingTurn,
  clearGameSnapshot: mockClearGameSnapshot,
  getGameSnapshot: mockGetGameSnapshot,
  setGameSnapshot: mockSetGameSnapshot,
}));

import {
  buildFallbackArenaSnapshot,
  getResolvedArenaSnapshot,
  maybeFinalizeOrphanedRunningArena,
} from '../arena-lifecycle.js';

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

function makeRunningArena() {
  return {
    id: 'arena-123',
    status: 'running' as const,
    currentHandNumber: 8,
    startedAt: new Date('2026-03-16T04:00:00.000Z'),
    finishedAt: null,
  };
}

describe('arena lifecycle types', () => {
  it('types persisted hand snapshots as GameState', () => {
    type GameHandRow = typeof gameHands.$inferSelect;
    expectTypeOf<GameHandRow['stateSnapshot']>().toEqualTypeOf<GameState | null>();
  });
});

describe('maybeFinalizeOrphanedRunningArena', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectResults();
    mockGetArenaLoopHeartbeat.mockResolvedValue(null);
  });

  it('marks a stale running arena as finished when no live snapshot or pending turn exists', async () => {
    mockGetGameSnapshot.mockResolvedValueOnce(null);
    mockGetAgentPendingTurn.mockResolvedValue(null);

    queueSelectResult([
      {
        handNumber: 8,
        stage: 'pre_flop',
        stateSnapshot: null,
        startedAt: new Date('2026-03-16T03:59:00.000Z'),
        endedAt: null,
      },
    ]);
    queueSelectResult([
      { agentId: 'agent-a' },
      { agentId: 'agent-b' },
    ]);

    const result = await maybeFinalizeOrphanedRunningArena(makeRunningArena());

    expect(result.status).toBe('finished');
    expect(result.finishedAt).toBeInstanceOf(Date);
    expect(mockUpdateSetWhere).toHaveBeenCalledOnce();
  });

  it('keeps a running arena live when a Redis snapshot still exists', async () => {
    mockGetGameSnapshot.mockResolvedValueOnce({
      arenaId: 'arena-123',
      gameState: makeState(),
      handNumber: 12,
      updatedAt: Date.now(),
    });

    const result = await maybeFinalizeOrphanedRunningArena(makeRunningArena());

    expect(result.status).toBe('running');
    expect(mockUpdateSetWhere).not.toHaveBeenCalled();
  });

  it('keeps a running arena live while a pending turn still has a fresh loop heartbeat', async () => {
    mockGetGameSnapshot.mockResolvedValueOnce(null);
    mockGetAgentPendingTurn.mockResolvedValue({ turnId: 'turn-123' });
    mockGetArenaLoopHeartbeat.mockResolvedValueOnce(Date.now());

    queueSelectResult([
      {
        handNumber: 8,
        stage: 'pre_flop',
        stateSnapshot: null,
        startedAt: new Date('2026-03-16T03:59:00.000Z'),
        endedAt: null,
      },
    ]);
    queueSelectResult([{ agentId: 'agent-a' }]);

    const result = await maybeFinalizeOrphanedRunningArena(makeRunningArena());

    expect(result.status).toBe('running');
    expect(mockUpdateSetWhere).not.toHaveBeenCalled();
  });

  it('marks a running arena as finished when the Redis snapshot itself is stale and no turn is pending', async () => {
    mockGetGameSnapshot.mockResolvedValueOnce({
      arenaId: 'arena-123',
      gameState: makeState(),
      handNumber: 12,
      updatedAt: new Date('2026-03-16T03:59:00.000Z').getTime(),
    });
    mockGetAgentPendingTurn.mockResolvedValue(null);

    queueSelectResult([
      {
        handNumber: 12,
        stage: 'pre_flop',
        stateSnapshot: null,
        startedAt: new Date('2026-03-16T03:59:00.000Z'),
        endedAt: null,
      },
    ]);
    queueSelectResult([
      { agentId: 'agent-a' },
      { agentId: 'agent-b' },
    ]);

    const result = await maybeFinalizeOrphanedRunningArena(makeRunningArena());

    expect(result.status).toBe('finished');
    expect(mockClearGameSnapshot).toHaveBeenCalledWith('arena-123');
    expect(mockUpdateSetWhere).toHaveBeenCalledOnce();
  });

  it('keeps a running arena live when an agent still has a pending turn', async () => {
    mockGetGameSnapshot.mockResolvedValueOnce(null);
    mockGetAgentPendingTurn
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce(null);

    queueSelectResult([
      {
        handNumber: 8,
        stage: 'pre_flop',
        stateSnapshot: null,
        startedAt: new Date('2026-03-16T03:59:00.000Z'),
        endedAt: null,
      },
    ]);
    queueSelectResult([
      { agentId: 'agent-a' },
      { agentId: 'agent-b' },
    ]);

    const result = await maybeFinalizeOrphanedRunningArena(makeRunningArena());

    expect(result.status).toBe('running');
    expect(mockUpdateSetWhere).not.toHaveBeenCalled();
  });
});

describe('snapshot recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectResults();
  });

  it('rebuilds a fallback snapshot from the latest completed hand after stale arena reconciliation', async () => {
    const state = makeState();
    const endedAt = new Date('2026-03-16T04:05:06.000Z');

    mockGetGameSnapshot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockGetAgentPendingTurn.mockResolvedValue(null);

    queueSelectResult([
      {
        handNumber: 8,
        stage: 'pre_flop',
        stateSnapshot: null,
        startedAt: new Date('2026-03-16T03:59:00.000Z'),
        endedAt: null,
      },
    ]);
    queueSelectResult([
      { agentId: 'agent-a' },
      { agentId: 'agent-b' },
    ]);
    queueSelectResult([
      {
        handNumber: 7,
        stage: 'finished',
        stateSnapshot: state,
        startedAt: new Date('2026-03-16T04:00:00.000Z'),
        endedAt,
      },
    ]);

    const result = await getResolvedArenaSnapshot(makeRunningArena());

    expect(result.arena.status).toBe('finished');
    expect(result.snapshot).toEqual({
      arenaId: 'arena-123',
      gameState: state,
      handNumber: 7,
      updatedAt: endedAt.getTime(),
    });
    expect(mockSetGameSnapshot).toHaveBeenCalledWith('arena-123', result.snapshot);
  });

  it('returns null when there is no completed hand snapshot to reuse', async () => {
    queueSelectResult([
      {
        handNumber: 12,
        stage: 'finished',
        stateSnapshot: null,
        startedAt: new Date('2026-03-16T04:00:00.000Z'),
        endedAt: new Date('2026-03-16T04:05:06.000Z'),
      },
    ]);

    await expect(buildFallbackArenaSnapshot('arena-123')).resolves.toBeNull();
    expect(mockSetGameSnapshot).not.toHaveBeenCalled();
  });
});
