import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
// The stats service makes two db.select() calls:
//   1. Agent query: .select().from().where().limit()
//   2. Action aggregation query: .select().from().where()  (no .limit())
//
// We model this with two independent mock chains and a queue-based dispatcher
// so each test is isolated regardless of call ordering.

const {
  mockSelectImpl,
  mockAgentSelectFromWhereLimitFn,
  mockActionSelectFromWhereFn,
} = vi.hoisted(() => {
  // ── Agent chain ──────────────────────────────────────────────────────────
  const mockAgentSelectFromWhereLimitFn = vi.fn();
  const mockAgentSelectFromWhere = vi.fn(() => ({ limit: mockAgentSelectFromWhereLimitFn }));
  const mockAgentSelectFrom = vi.fn(() => ({ where: mockAgentSelectFromWhere }));
  const mockAgentSelectFn = vi.fn(() => ({ from: mockAgentSelectFrom }));

  // ── Action chain ─────────────────────────────────────────────────────────
  const mockActionSelectFromWhereFn = vi.fn();
  const mockActionSelectFromWhere = vi.fn(() => mockActionSelectFromWhereFn);
  const mockActionSelectFrom = vi.fn(() => ({ where: mockActionSelectFromWhere }));
  const mockActionSelectFn = vi.fn(() => ({ from: mockActionSelectFrom }));

  // ── Dispatcher — returns agent chain on 1st call, action chain on 2nd ───
  const selectQueue: Array<typeof mockAgentSelectFn | typeof mockActionSelectFn> = [];
  const mockSelectImpl = vi.fn((...args: unknown[]) => {
    const next = selectQueue.shift();
    if (!next) throw new Error('Unexpected extra db.select() call');
    return (next as (...a: unknown[]) => unknown)(...args);
  });

  // Expose the queue so tests can push chains before each call
  (mockSelectImpl as unknown as { queue: typeof selectQueue }).queue = selectQueue;

  return {
    mockSelectImpl,
    mockAgentSelectFromWhereLimitFn,
    mockAgentSelectFn,
    mockActionSelectFromWhereFn,
    mockActionSelectFn,
    mockAgentSelectFrom,
    mockAgentSelectFromWhere,
    mockActionSelectFrom,
    mockActionSelectFromWhere,
  };
});

vi.mock('../../db/index.js', () => ({
  db: { select: mockSelectImpl },
  schema: {
    agents: {
      id: 'agents.id',
      handsPlayed: 'agents.hands_played',
      handsWon: 'agents.hands_won',
      totalChipsWon: 'agents.total_chips_won',
    },
    gameActions: {
      agentId: 'game_actions.agent_id',
      stage: 'game_actions.stage',
      actionType: 'game_actions.action_type',
      handId: 'game_actions.hand_id',
      responseTimeMs: 'game_actions.response_time_ms',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  sql: new Proxy(() => 'sql-expr', { get: () => () => 'sql-expr' }),
}));

import { getAgentStats } from '../stats.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentFixture {
  handsPlayed: number;
  handsWon: number;
  totalChipsWon: number;
}

interface ActionFixture {
  preFlopVPIP: number;
  preFlopRaises: number;
  aggressiveActions: number;
  callActions: number;
  avgResponseMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AGENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * Queue mock return values for the two db.select() calls made by getAgentStats.
 * When actionFixture is omitted, only the agent query is queued (zero-hands path).
 */
function setupMocks(agentFixture: AgentFixture | null, actionFixture?: ActionFixture) {
  const queue = (mockSelectImpl as unknown as { queue: unknown[] }).queue;
  // Clear any leftover queue entries from previous tests
  queue.length = 0;

  // Build agent chain mock
  mockAgentSelectFromWhereLimitFn.mockResolvedValueOnce(
    agentFixture ? [agentFixture] : [],
  );
  // Push a function that returns the agent select chain
  queue.push(vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: mockAgentSelectFromWhereLimitFn,
      })),
    })),
  })));

  if (actionFixture !== undefined) {
    mockActionSelectFromWhereFn.mockResolvedValueOnce([actionFixture]);
    // Push a function that returns the action select chain
    queue.push(vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockActionSelectFromWhereFn,
      })),
    })));
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getAgentStats()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the queue on each test reset
    const queue = (mockSelectImpl as unknown as { queue: unknown[] }).queue;
    queue.length = 0;
  });

  // ── Zero-hands fast path ──────────────────────────────────────────────────

  it('returns zero-stats when agent has 0 hands played', async () => {
    setupMocks({ handsPlayed: 0, handsWon: 0, totalChipsWon: 0 });

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.agentId).toBe(AGENT_ID);
    expect(stats.handsPlayed).toBe(0);
    expect(stats.handsWon).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.totalChipsWon).toBe(0);
    expect(stats.evPerHand).toBe(0);
    expect(stats.vpip).toBe(0);
    expect(stats.pfr).toBe(0);
    expect(stats.af).toBe(0);
    expect(stats.avgResponseMs).toBe(0);
    expect(stats.computedAt).toBeGreaterThan(0);
  });

  it('returns zero-stats when agent is not found (handsPlayed defaults to 0)', async () => {
    setupMocks(null);

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.agentId).toBe(AGENT_ID);
    expect(stats.handsPlayed).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.vpip).toBe(0);
    expect(stats.pfr).toBe(0);
    expect(stats.af).toBe(0);
  });

  // ── winRate ───────────────────────────────────────────────────────────────

  it('computes winRate = handsWon / handsPlayed (10/40 = 0.25)', async () => {
    setupMocks(
      { handsPlayed: 40, handsWon: 10, totalChipsWon: 500 },
      { preFlopVPIP: 20, preFlopRaises: 10, aggressiveActions: 15, callActions: 10, avgResponseMs: 100 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.winRate).toBeCloseTo(0.25);
  });

  // ── evPerHand ─────────────────────────────────────────────────────────────

  it('computes evPerHand = totalChipsWon / handsPlayed (500/40 = 12.5)', async () => {
    setupMocks(
      { handsPlayed: 40, handsWon: 10, totalChipsWon: 500 },
      { preFlopVPIP: 20, preFlopRaises: 10, aggressiveActions: 15, callActions: 10, avgResponseMs: 100 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.evPerHand).toBeCloseTo(12.5);
  });

  it('evPerHand can be negative when agent lost chips overall', async () => {
    setupMocks(
      { handsPlayed: 20, handsWon: 2, totalChipsWon: -400 },
      { preFlopVPIP: 10, preFlopRaises: 5, aggressiveActions: 5, callActions: 8, avgResponseMs: 80 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.evPerHand).toBeCloseTo(-20);
  });

  // ── vpip ──────────────────────────────────────────────────────────────────

  it('computes vpip = preFlopVPIP / handsPlayed (28/100 = 0.28)', async () => {
    setupMocks(
      { handsPlayed: 100, handsWon: 30, totalChipsWon: 800 },
      { preFlopVPIP: 28, preFlopRaises: 15, aggressiveActions: 20, callActions: 13, avgResponseMs: 150 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.vpip).toBeCloseTo(0.28);
  });

  // ── pfr ───────────────────────────────────────────────────────────────────

  it('computes pfr = preFlopRaises / handsPlayed (15/100 = 0.15)', async () => {
    setupMocks(
      { handsPlayed: 100, handsWon: 30, totalChipsWon: 800 },
      { preFlopVPIP: 28, preFlopRaises: 15, aggressiveActions: 20, callActions: 13, avgResponseMs: 150 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.pfr).toBeCloseTo(0.15);
  });

  // ── af ────────────────────────────────────────────────────────────────────

  it('computes af = aggressiveActions / callActions (30/10 = 3.0)', async () => {
    setupMocks(
      { handsPlayed: 50, handsWon: 15, totalChipsWon: 300 },
      { preFlopVPIP: 25, preFlopRaises: 12, aggressiveActions: 30, callActions: 10, avgResponseMs: 120 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.af).toBeCloseTo(3.0);
  });

  it('af = 0 when there are no aggressive or call actions', async () => {
    setupMocks(
      { handsPlayed: 20, handsWon: 5, totalChipsWon: 100 },
      { preFlopVPIP: 0, preFlopRaises: 0, aggressiveActions: 0, callActions: 0, avgResponseMs: 90 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.af).toBe(0);
  });

  it('af is capped at 999 when callActions = 0 but aggressiveActions > 0', async () => {
    setupMocks(
      { handsPlayed: 30, handsWon: 10, totalChipsWon: 200 },
      { preFlopVPIP: 15, preFlopRaises: 10, aggressiveActions: 5, callActions: 0, avgResponseMs: 100 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.af).toBe(999);
  });

  // ── avgResponseMs ─────────────────────────────────────────────────────────

  it('avgResponseMs is rounded to an integer (123.7 → 124)', async () => {
    setupMocks(
      { handsPlayed: 10, handsWon: 3, totalChipsWon: 50 },
      { preFlopVPIP: 5, preFlopRaises: 2, aggressiveActions: 3, callActions: 2, avgResponseMs: 123.7 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.avgResponseMs).toBe(124);
    expect(Number.isInteger(stats.avgResponseMs)).toBe(true);
  });

  // ── ratio clamping ────────────────────────────────────────────────────────

  it('winRate is clamped to [0, 1] when handsWon > handsPlayed', async () => {
    setupMocks(
      { handsPlayed: 10, handsWon: 15, totalChipsWon: 300 },
      { preFlopVPIP: 5, preFlopRaises: 3, aggressiveActions: 4, callActions: 2, avgResponseMs: 100 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.winRate).toBeLessThanOrEqual(1);
    expect(stats.winRate).toBeGreaterThanOrEqual(0);
    expect(stats.winRate).toBe(1);
  });

  it('vpip is clamped to [0, 1] when preFlopVPIP > handsPlayed', async () => {
    setupMocks(
      { handsPlayed: 10, handsWon: 5, totalChipsWon: 100 },
      { preFlopVPIP: 20, preFlopRaises: 5, aggressiveActions: 5, callActions: 5, avgResponseMs: 100 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.vpip).toBeLessThanOrEqual(1);
    expect(stats.vpip).toBeGreaterThanOrEqual(0);
    expect(stats.vpip).toBe(1);
  });

  it('pfr is clamped to [0, 1] when preFlopRaises > handsPlayed', async () => {
    setupMocks(
      { handsPlayed: 10, handsWon: 5, totalChipsWon: 100 },
      { preFlopVPIP: 10, preFlopRaises: 15, aggressiveActions: 15, callActions: 5, avgResponseMs: 100 },
    );

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.pfr).toBeLessThanOrEqual(1);
    expect(stats.pfr).toBeGreaterThanOrEqual(0);
    expect(stats.pfr).toBe(1);
  });

  // ── computedAt ────────────────────────────────────────────────────────────

  it('computedAt is a unix millisecond timestamp close to now', async () => {
    const before = Date.now();
    setupMocks({ handsPlayed: 0, handsWon: 0, totalChipsWon: 0 });

    const stats = await getAgentStats(AGENT_ID);
    const after = Date.now();

    expect(stats.computedAt).toBeGreaterThanOrEqual(before);
    expect(stats.computedAt).toBeLessThanOrEqual(after);
  });
});
