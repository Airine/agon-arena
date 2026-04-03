import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSelectImpl,
  mockInsertImpl,
  mockUpdateImpl,
  mockEventInsertReturning,
  mockRollupInsertOnConflictDoUpdate,
  mockUpdateSetWhere,
} = vi.hoisted(() => {
  const selectQueue: Array<() => unknown> = [];
  const mockSelectImpl = vi.fn(() => {
    const next = selectQueue.shift();
    if (!next) throw new Error('Unexpected db.select() call');
    return next();
  });
  (mockSelectImpl as unknown as { queue: typeof selectQueue }).queue = selectQueue;

  const mockEventInsertReturning = vi.fn();
  const mockEventInsertOnConflictDoNothing = vi.fn(() => ({ returning: mockEventInsertReturning }));
  const mockEventInsertValues = vi.fn(() => ({ onConflictDoNothing: mockEventInsertOnConflictDoNothing }));

  const mockRollupInsertOnConflictDoUpdate = vi.fn();
  const mockRollupInsertValues = vi.fn(() => ({ onConflictDoUpdate: mockRollupInsertOnConflictDoUpdate }));

  const insertQueue: Array<() => unknown> = [
    () => ({ values: mockEventInsertValues }),
    () => ({ values: mockRollupInsertValues }),
  ];
  const mockInsertImpl = vi.fn(() => {
    const next = insertQueue.shift();
    if (!next) throw new Error('Unexpected db.insert() call');
    return next();
  });
  (mockInsertImpl as unknown as { reset: () => void }).reset = () => {
    insertQueue.length = 0;
    insertQueue.push(
      () => ({ values: mockEventInsertValues }),
      () => ({ values: mockRollupInsertValues }),
    );
  };

  const mockUpdateSetWhere = vi.fn();
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateSetWhere }));
  const mockUpdateImpl = vi.fn(() => ({ set: mockUpdateSet }));

  return {
    mockSelectImpl,
    mockInsertImpl,
    mockUpdateImpl,
    mockEventInsertReturning,
    mockRollupInsertOnConflictDoUpdate,
    mockUpdateSetWhere,
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    select: mockSelectImpl,
    insert: mockInsertImpl,
    update: mockUpdateImpl,
  },
  schema: {
    agents: {
      id: 'agents.id',
      metadata: 'agents.metadata',
    },
    arenas: {
      id: 'arenas.id',
      gameType: 'arenas.game_type',
    },
    internalFunnelEvents: {
      stage: 'internal_funnel_events.stage',
      agentId: 'internal_funnel_events.agent_id',
      occurredAt: 'internal_funnel_events.occurred_at',
    },
    internalFunnelStageRollups: {
      bucketStart: 'internal_funnel_stage_rollups.bucket_start',
      bucketGranularity: 'internal_funnel_stage_rollups.bucket_granularity',
      stage: 'internal_funnel_stage_rollups.stage',
      source: 'internal_funnel_stage_rollups.source',
      framework: 'internal_funnel_stage_rollups.framework',
      arenaType: 'internal_funnel_stage_rollups.arena_type',
      uniqueAgents: 'internal_funnel_stage_rollups.unique_agents',
      eventCount: 'internal_funnel_stage_rollups.event_count',
      updatedAt: 'internal_funnel_stage_rollups.updated_at',
    },
    internalAlphaContacts: {
      lastActivityAt: 'internal_alpha_contacts.last_activity_at',
      userId: 'internal_alpha_contacts.user_id',
      agentId: 'internal_alpha_contacts.agent_id',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  or: vi.fn((...conditions: unknown[]) => ({ or: conditions })),
  sql: new Proxy(() => 'sql-expr', { get: () => () => 'sql-expr' }),
}));

import { materializeInternalFunnelEvent } from '../internal-funnel.js';

function queueSelectResult(result: unknown[]) {
  const queue = (mockSelectImpl as unknown as { queue: Array<() => unknown> }).queue;
  queue.push(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(result),
      })),
    })),
  }));
}

describe('materializeInternalFunnelEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockSelectImpl as unknown as { queue: unknown[] }).queue.length = 0;
    (mockInsertImpl as unknown as { reset: () => void }).reset();
  });

  it('persists a new funnel event, rolls it up, and refreshes linked alpha activity timestamps', async () => {
    queueSelectResult([{ metadata: { framework: 'python-sdk' } }]);
    queueSelectResult([{ gameType: 'texas_holdem' }]);
    mockEventInsertReturning.mockResolvedValueOnce([{ id: 'evt-1' }]);
    mockRollupInsertOnConflictDoUpdate.mockResolvedValueOnce(undefined);
    mockUpdateSetWhere.mockResolvedValueOnce(undefined);

    const inserted = await materializeInternalFunnelEvent({
      eventType: 'agent_funnel',
      stage: 'first_action_submitted',
      agentId: 'agent-1',
      userId: 'user-1',
      arenaId: 'arena-1',
      ts: '2026-04-03T08:15:00.000Z',
    });

    expect(inserted).toBe(true);
    expect(mockEventInsertReturning).toHaveBeenCalledOnce();
    expect(mockRollupInsertOnConflictDoUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateSetWhere).toHaveBeenCalledOnce();
    expect(mockEventInsertReturning.mock.calls[0]).toBeDefined();
  });

  it('skips rollup work when the funnel event has already been materialized', async () => {
    queueSelectResult([{ metadata: { framework: 'python-sdk' } }]);
    queueSelectResult([{ gameType: 'texas_holdem' }]);
    mockEventInsertReturning.mockResolvedValueOnce([]);

    const inserted = await materializeInternalFunnelEvent({
      eventType: 'agent_funnel',
      stage: 'session_created',
      agentId: 'agent-1',
      userId: 'user-1',
      ts: '2026-04-03T08:15:00.000Z',
    });

    expect(inserted).toBe(false);
    expect(mockRollupInsertOnConflictDoUpdate).not.toHaveBeenCalled();
    expect(mockUpdateSetWhere).not.toHaveBeenCalled();
  });
});
