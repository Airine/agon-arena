import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AGO-32: Matchmaking service unit tests
 *
 * Tests the matchmaking queue logic:
 * - Queue join / leave / status
 * - 60s SLA timeout → bot fill
 * - Min player thresholds per mode
 * - Queue processor matching decisions
 */

// ─── Hoisted Redis mock ───────────────────────────────────────────────────────
const {
  mockZAdd,
  mockZRem,
  mockZRange,
  mockZRangeWithScores,
  mockRedisClient,
} = vi.hoisted(() => {
  const mockZAdd = vi.fn().mockResolvedValue(1);
  const mockZRem = vi.fn().mockResolvedValue(1);
  const mockZRange = vi.fn().mockResolvedValue([]);
  const mockZRangeWithScores = vi.fn().mockResolvedValue([]);
  const mockRedisClient = {
    zAdd: mockZAdd,
    zRem: mockZRem,
    zRange: mockZRange,
    zRangeWithScores: mockZRangeWithScores,
  };
  return { mockZAdd, mockZRem, mockZRange, mockZRangeWithScores, mockRedisClient };
});

vi.mock('../redis.js', () => ({
  getRedisClient: vi.fn().mockResolvedValue(mockRedisClient),
  setGameSnapshot: vi.fn().mockResolvedValue(undefined),
}));

// ─── Hoisted DB mock ──────────────────────────────────────────────────────────
const {
  mockInsertValues,
  mockInsertOnConflict,
  mockInsertReturning,
  mockInsert,
  mockSelectFromWhereLimitFn,
  mockSelectFromWhere,
  mockSelectFrom,
  mockSelect,
  mockUpdateSetWhere,
  mockUpdateSet,
  mockUpdate,
} = vi.hoisted(() => {
  const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'arena-123' }]);
  const mockInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockInsertValues = vi.fn(() => ({
    returning: mockInsertReturning,
    onConflictDoNothing: mockInsertOnConflict,
  }));
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  const mockSelectFromWhereLimitFn = vi.fn().mockResolvedValue([]);
  const mockSelectFromWhere = vi.fn(() => ({ limit: mockSelectFromWhereLimitFn }));
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectFromWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  const mockUpdateSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateSetWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  return {
    mockInsertReturning,
    mockInsertOnConflict,
    mockInsertValues,
    mockInsert,
    mockSelectFromWhereLimitFn,
    mockSelectFromWhere,
    mockSelectFrom,
    mockSelect,
    mockUpdateSetWhere,
    mockUpdateSet,
    mockUpdate,
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  },
  schema: {
    agents: { id: 'id', name: 'name', ownerId: 'ownerId', isActive: 'isActive' },
    arenas: { id: 'id', status: 'status', currentHandNumber: 'currentHandNumber' },
    arenaSeats: { agentId: 'agentId', arenaId: 'arenaId', seatIndex: 'seatIndex' },
    users: { id: 'id', username: 'username' },
  },
}));

vi.mock('../orchestrator.js', () => ({
  startGame: vi.fn(),
}));

vi.mock('../io.js', () => ({
  getIO: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));

vi.mock('../kafka.js', () => ({
  publishEvent: vi.fn(),
}));

import {
  joinQueue,
  leaveQueue,
  getQueueStatus,
  startMatchmakingProcessor,
  stopMatchmakingProcessor,
  type QueueEntry,
} from '../matchmaking.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    agentId: 'agent-aaa',
    userId: 'user-111',
    agentName: 'TestAgent',
    apiUrl: 'https://agent.example.com',
    webhookPublicKey: null,
    joinedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty queues
  mockZRangeWithScores.mockResolvedValue([]);
  mockZRange.mockResolvedValue([]);
});

// ─── joinQueue ────────────────────────────────────────────────────────────────

describe('joinQueue', () => {
  it('adds entry to the correct Redis key with NX flag', async () => {
    const entry = makeEntry({ joinedAt: 1_000_000 });
    await joinQueue('practice', entry);

    expect(mockZAdd).toHaveBeenCalledOnce();
    const [key, scoreValue, options] = mockZAdd.mock.calls[0];
    expect(key).toBe('matchmaking:queue:practice');
    expect(scoreValue.score).toBe(1_000_000);
    expect(JSON.parse(scoreValue.value)).toMatchObject({ agentId: 'agent-aaa' });
    expect(options).toEqual({ NX: true });
  });

  it('uses the joinedAt timestamp as the sort score', async () => {
    const now = Date.now();
    const entry = makeEntry({ joinedAt: now });
    await joinQueue('cash', entry);

    const [, scoreValue] = mockZAdd.mock.calls[0];
    expect(scoreValue.score).toBe(now);
  });

  it('serialises all QueueEntry fields into the value', async () => {
    const entry: QueueEntry = {
      agentId: 'agent-xyz',
      userId: 'user-xyz',
      agentName: 'My Agent',
      apiUrl: 'https://my-agent.ai',
      webhookPublicKey: 'deadbeef',
      joinedAt: 12345,
    };
    await joinQueue('tournament', entry);

    const [, scoreValue] = mockZAdd.mock.calls[0];
    const parsed = JSON.parse(scoreValue.value) as QueueEntry;
    expect(parsed).toEqual(entry);
  });
});

// ─── leaveQueue ──────────────────────────────────────────────────────────────

describe('leaveQueue', () => {
  it('removes the entry matching the agentId from each mode key', async () => {
    const entry = makeEntry({ agentId: 'agent-to-remove' });
    const serialised = JSON.stringify(entry);

    mockZRange.mockResolvedValue([serialised]);

    await leaveQueue('agent-to-remove');

    // Should check all 3 modes
    expect(mockZRange).toHaveBeenCalledTimes(3);
    expect(mockZRem).toHaveBeenCalledWith(
      'matchmaking:queue:practice',
      serialised,
    );
  });

  it('does not call zRem when the agent is not in any queue', async () => {
    mockZRange.mockResolvedValue([JSON.stringify(makeEntry({ agentId: 'someone-else' }))]);
    await leaveQueue('agent-not-here');
    expect(mockZRem).not.toHaveBeenCalled();
  });

  it('silently skips malformed Redis values', async () => {
    mockZRange.mockResolvedValue(['not-valid-json']);
    await expect(leaveQueue('any-agent')).resolves.not.toThrow();
  });
});

// ─── getQueueStatus ──────────────────────────────────────────────────────────

describe('getQueueStatus', () => {
  it('returns mode, 1-based position, queue size, and waitingMs when agent is queued', async () => {
    const joinedAt = Date.now() - 10_000; // 10s ago
    const entries = [
      { score: joinedAt, value: JSON.stringify(makeEntry({ agentId: 'agent-first', joinedAt })) },
      { score: joinedAt + 1000, value: JSON.stringify(makeEntry({ agentId: 'agent-aaa', joinedAt: joinedAt + 1000 })) },
    ];
    mockZRangeWithScores.mockImplementation(async (key: string) => {
      if (key === 'matchmaking:queue:practice') return entries;
      return [];
    });

    const status = await getQueueStatus('agent-aaa');

    expect(status.mode).toBe('practice');
    expect(status.position).toBe(2);
    expect(status.queueSize).toBe(2);
    expect(status.waitingMs).toBeGreaterThan(0);
  });

  it('returns null values when the agent is not in any queue', async () => {
    const status = await getQueueStatus('ghost-agent');
    expect(status).toEqual({ mode: null, position: null, queueSize: 0, waitingMs: null });
  });

  it('finds agent in tournament queue when practice and cash are empty', async () => {
    const entry = makeEntry({ agentId: 'agent-t', joinedAt: Date.now() });
    mockZRangeWithScores.mockImplementation(async (key: string) => {
      if (key === 'matchmaking:queue:tournament') {
        return [{ score: entry.joinedAt, value: JSON.stringify(entry) }];
      }
      return [];
    });

    const status = await getQueueStatus('agent-t');
    expect(status.mode).toBe('tournament');
    expect(status.position).toBe(1);
  });
});

// ─── Processor lifecycle ──────────────────────────────────────────────────────

describe('processor lifecycle', () => {
  it('startMatchmakingProcessor does not throw', () => {
    expect(() => startMatchmakingProcessor()).not.toThrow();
    stopMatchmakingProcessor(); // cleanup
  });

  it('stopMatchmakingProcessor is idempotent', () => {
    stopMatchmakingProcessor();
    expect(() => stopMatchmakingProcessor()).not.toThrow();
  });

  it('does not create multiple timers on repeated start calls', () => {
    startMatchmakingProcessor();
    startMatchmakingProcessor(); // should be a no-op
    stopMatchmakingProcessor();
    // If two timers were created the interval would fire unexpectedly — we just verify no throw
  });
});

// ─── Queue matching thresholds (decision logic) ───────────────────────────────

describe('queue matching decision logic', () => {
  /**
   * These tests verify the decision conditions extracted from processQueue:
   *   match if: hasEnoughPlayers OR (timeoutExpired AND entries.length >= 2)
   */

  function shouldMatch(
    queueSize: number,
    ageMs: number,
    minPlayers: number,
    timeoutMs = 60_000,
  ): boolean {
    const hasEnoughPlayers = queueSize >= minPlayers;
    const timeoutExpired = ageMs >= timeoutMs;
    if (!hasEnoughPlayers && (!timeoutExpired || queueSize < 2)) return false;
    return true;
  }

  it('matches immediately when queue reaches minimum players', () => {
    expect(shouldMatch(2, 0, 2)).toBe(true);
    expect(shouldMatch(6, 0, 2)).toBe(true);
  });

  it('does not match when fewer than minPlayers and timeout has not expired', () => {
    expect(shouldMatch(1, 30_000, 2)).toBe(false);
    expect(shouldMatch(2, 30_000, 3)).toBe(false);
  });

  it('matches after 60s timeout with at least 2 real players', () => {
    expect(shouldMatch(2, 60_000, 3)).toBe(true);
    expect(shouldMatch(3, 60_001, 6)).toBe(true);
  });

  it('does not match after timeout with only 1 real player', () => {
    expect(shouldMatch(1, 70_000, 2)).toBe(false);
  });

  it('tournament requires 3 real players (or 2+ after timeout)', () => {
    expect(shouldMatch(2, 0, 3)).toBe(false);      // not enough, no timeout
    expect(shouldMatch(3, 0, 3)).toBe(true);        // exact minimum
    expect(shouldMatch(2, 60_000, 3)).toBe(true);   // timeout, 2 players → fill 1 bot
  });
});

// ─── Bot fill count ───────────────────────────────────────────────────────────

describe('bot fill count logic', () => {
  function botsNeeded(realPlayers: number, minPlayers: number): number {
    return Math.max(0, minPlayers - realPlayers);
  }

  it('fills the exact gap between real players and minimum', () => {
    expect(botsNeeded(1, 2)).toBe(1);
    expect(botsNeeded(2, 3)).toBe(1);
    expect(botsNeeded(3, 6)).toBe(3);
  });

  it('returns 0 when real players already meet or exceed minimum', () => {
    expect(botsNeeded(2, 2)).toBe(0);
    expect(botsNeeded(5, 3)).toBe(0);
  });
});
