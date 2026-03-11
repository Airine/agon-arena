import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockTxSelectFromWhereLimitFn,
  mockTxSelectFromWhere,
  mockTxSelectFrom,
  mockTxSelect,
  mockTxUpdateSetWhere,
  mockTxUpdateSet,
  mockTxUpdate,
  mockTxInsertReturning,
  mockTxInsertValues,
  mockTxInsert,
  mockTransaction,
  mockSelectFromWhereLimitFn,
  mockSelectFromWhere,
  mockSelectFrom,
  mockSelect,
} = vi.hoisted(() => {
  const mockTxInsertReturning = vi.fn();
  const mockTxInsertValues = vi.fn(() => ({ returning: mockTxInsertReturning }));
  const mockTxInsert = vi.fn(() => ({ values: mockTxInsertValues }));

  const mockTxUpdateSetWhere = vi.fn();
  const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateSetWhere }));
  const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));

  const mockTxSelectFromWhereLimitFn = vi.fn();
  const mockTxSelectFromWhere = vi.fn(() => ({ limit: mockTxSelectFromWhereLimitFn }));
  const mockTxSelectFrom = vi.fn(() => ({ where: mockTxSelectFromWhere }));
  const mockTxSelect = vi.fn(() => ({ from: mockTxSelectFrom }));

  const mockTransaction = vi.fn();

  const mockSelectFromWhereLimitFn = vi.fn();
  const mockSelectFromWhere = vi.fn(() => ({ limit: mockSelectFromWhereLimitFn }));
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectFromWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  return {
    mockTxInsertReturning,
    mockTxInsertValues,
    mockTxInsert,
    mockTxUpdateSetWhere,
    mockTxUpdateSet,
    mockTxUpdate,
    mockTxSelectFromWhereLimitFn,
    mockTxSelectFromWhere,
    mockTxSelectFrom,
    mockTxSelect,
    mockTransaction,
    mockSelectFromWhereLimitFn,
    mockSelectFromWhere,
    mockSelectFrom,
    mockSelect,
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    transaction: mockTransaction,
    select: mockSelect,
  },
  schema: {
    users: {
      id: 'users.id',
      chipBalance: 'users.chip_balance',
      frozenAmount: 'users.frozen_amount',
      updatedAt: 'users.updated_at',
    },
    agents: {
      id: 'agents.id',
      ownerId: 'agents.owner_id',
      ownerAgentId: 'agents.owner_agent_id',
      ownerShareRate: 'agents.owner_share_rate',
      name: 'agents.name',
    },
    chipTransactions: {
      id: 'chip_transactions.id',
      userId: 'chip_transactions.user_id',
      referenceType: 'chip_transactions.reference_type',
    },
    socialBindings: {
      userId: 'social_bindings.user_id',
      provider: 'social_bindings.provider',
      providerUserId: 'social_bindings.provider_user_id',
      chipRewarded: 'social_bindings.chip_rewarded',
    },
    inviteCodes: {
      id: 'invite_codes.id',
      createdByUserId: 'invite_codes.created_by_user_id',
      referrerRewarded: 'invite_codes.referrer_rewarded',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  sql: new Proxy(() => 'sql-expr', { get: () => () => 'sql-expr' }),
}));

import { ChipService } from '../chip.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TX_ID = 'tx-uuid-001';

/** Agent fixture factory */
function makeAgent(
  id: string,
  ownerId: string,
  ownerAgentId: string | null,
  ownerShareRate: number = 90,
  name: string = `Agent-${id}`,
) {
  return { id, ownerId, ownerAgentId, ownerShareRate, name };
}

/**
 * Queue a db.select() response (top-level, not inside a transaction).
 * These are the agent look-ups inside distributePrizeCascade().
 */
function queueAgentLookup(agent: ReturnType<typeof makeAgent> | null) {
  mockSelectFromWhereLimitFn.mockResolvedValueOnce(agent ? [agent] : []);
}

/**
 * Queue a credit() call — wraps db.transaction() which in turn uses lockUser (tx.select)
 * then tx.update and tx.insert.
 */
function queueCreditTx(
  userFixture: { chipBalance: number; frozenAmount: number },
  txId: string = TX_ID,
) {
  mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([userFixture]);
  mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
  mockTxInsertReturning.mockResolvedValueOnce([{ id: txId }]);

  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: mockTxSelect,
      update: mockTxUpdate,
      insert: mockTxInsert,
    };
    return fn(tx);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChipService.distributePrizeCascade()', () => {
  let svc: ChipService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ChipService();
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it('throws when prize is zero', async () => {
    await expect(svc.distributePrizeCascade('agent-1', 0, 'ref-1')).rejects.toThrow(
      'Prize must be positive',
    );
  });

  it('throws when prize is negative', async () => {
    await expect(svc.distributePrizeCascade('agent-1', -100, 'ref-1')).rejects.toThrow(
      'Prize must be positive',
    );
  });

  // ── Single agent (no parent) ────────────────────────────────────────────────

  it('credits 100% to the agent owner when there is no parent', async () => {
    const agent = makeAgent('agent-1', 'owner-1', null, 90, 'Apex');
    queueAgentLookup(agent);
    queueCreditTx({ chipBalance: 500, frozenAmount: 0 });

    const result = await svc.distributePrizeCascade('agent-1', 1000, 'hand-1');

    expect(result.totalPrize).toBe(1000);
    expect(result.totalDistributed).toBe(1000);
    expect(result.undistributed).toBe(0);
    expect(result.distributions).toHaveLength(1);
    expect(result.distributions[0]).toMatchObject({
      agentId: 'agent-1',
      agentName: 'Apex',
      userId: 'owner-1',
      amount: 1000,
      depth: 0,
    });
  });

  it('records referenceType=ownership_cascade and referenceId pattern :d0', async () => {
    const agent = makeAgent('agent-1', 'owner-1', null);
    queueAgentLookup(agent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 });

    await svc.distributePrizeCascade('agent-1', 500, 'hand-42');

    expect(mockTxInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceType: 'ownership_cascade',
        referenceId: 'hand-42:d0',
      }),
    );
  });

  // ── Two-level chain ─────────────────────────────────────────────────────────

  it('splits correctly in a 2-level chain with ownerShareRate=90', async () => {
    // agent-1 (ownerShareRate=90) → agent-2 (top, ownerShareRate=90, no parent)
    // prize=1000: agent-1 retains 10% = 100, passes 90% = 900 up
    // agent-2 retains 100% of 900 = 900
    const childAgent = makeAgent('agent-1', 'owner-1', 'agent-2', 90, 'Child');
    const parentAgent = makeAgent('agent-2', 'owner-2', null, 90, 'Parent');

    queueAgentLookup(childAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-child');

    queueAgentLookup(parentAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-parent');

    const result = await svc.distributePrizeCascade('agent-1', 1000, 'hand-2');

    expect(result.totalPrize).toBe(1000);
    expect(result.totalDistributed).toBe(1000);
    expect(result.undistributed).toBe(0);
    expect(result.distributions).toHaveLength(2);

    const child = result.distributions[0]!;
    expect(child.agentId).toBe('agent-1');
    expect(child.userId).toBe('owner-1');
    expect(child.amount).toBe(100); // 1000 * (100-90)% = 100
    expect(child.depth).toBe(0);

    const parent = result.distributions[1]!;
    expect(parent.agentId).toBe('agent-2');
    expect(parent.userId).toBe('owner-2');
    expect(parent.amount).toBe(900); // passes up 900, retains all at top
    expect(parent.depth).toBe(1);
  });

  it('uses :d0 and :d1 referenceId suffixes for each level', async () => {
    const childAgent = makeAgent('agent-1', 'owner-1', 'agent-2', 90, 'Child');
    const parentAgent = makeAgent('agent-2', 'owner-2', null, 90, 'Parent');

    queueAgentLookup(childAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-child');

    queueAgentLookup(parentAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-parent');

    await svc.distributePrizeCascade('agent-1', 1000, 'ref-abc');

    const calls = mockTxInsertValues.mock.calls as unknown[][];
    expect(calls[0]![0]).toMatchObject({ referenceId: 'ref-abc:d0' });
    expect(calls[1]![0]).toMatchObject({ referenceId: 'ref-abc:d1' });
  });

  // ── Three-level chain ───────────────────────────────────────────────────────

  it('cascades correctly through a 3-level chain', async () => {
    // prize=1000, all ownerShareRate=50
    // depth 0 (agent-1): retain 50% = 500, pass 500 up
    // depth 1 (agent-2): retain 50% of 500 = 250, pass 250 up
    // depth 2 (agent-3, no parent): retain 100% of 250 = 250
    const a1 = makeAgent('agent-1', 'owner-1', 'agent-2', 50, 'A1');
    const a2 = makeAgent('agent-2', 'owner-2', 'agent-3', 50, 'A2');
    const a3 = makeAgent('agent-3', 'owner-3', null, 50, 'A3');

    queueAgentLookup(a1);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-1');

    queueAgentLookup(a2);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-2');

    queueAgentLookup(a3);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-3');

    const result = await svc.distributePrizeCascade('agent-1', 1000, 'hand-3');

    expect(result.distributions).toHaveLength(3);
    expect(result.distributions[0]!.amount).toBe(500);
    expect(result.distributions[1]!.amount).toBe(250);
    expect(result.distributions[2]!.amount).toBe(250);
    expect(result.totalDistributed).toBe(1000);
    expect(result.undistributed).toBe(0);
  });

  // ── ownerShareRate edge cases ────────────────────────────────────────────────

  it('ownerShareRate=0 means child retains everything, nothing passes up', async () => {
    const childAgent = makeAgent('agent-1', 'owner-1', 'agent-2', 0, 'Greedy');
    queueAgentLookup(childAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 });

    const result = await svc.distributePrizeCascade('agent-1', 1000, 'hand-x');

    // passUpAmount = floor(1000 * 0 / 100) = 0, retainAmount = 1000
    expect(result.distributions).toHaveLength(1);
    expect(result.distributions[0]!.amount).toBe(1000);
    expect(result.totalDistributed).toBe(1000);
    expect(result.undistributed).toBe(0);
    // agent-2 should never be queried because remaining becomes 0
    expect(mockSelectFromWhereLimitFn).toHaveBeenCalledTimes(1);
  });

  it('ownerShareRate=100 passes all chips upward, child retains nothing', async () => {
    // retainAmount = 1000 - 1000 = 0, so no credit at depth 0
    // passUpAmount = 1000, moves to parent
    // parent has no parent → retains 1000
    const childAgent = makeAgent('agent-1', 'owner-1', 'agent-2', 100, 'Selfless');
    const parentAgent = makeAgent('agent-2', 'owner-2', null, 90, 'Parent');

    queueAgentLookup(childAgent);
    // No credit at depth 0 (retainAmount = 0), so no queueCreditTx here

    queueAgentLookup(parentAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-parent');

    const result = await svc.distributePrizeCascade('agent-1', 1000, 'hand-y');

    // Only parent gets credited
    expect(result.distributions).toHaveLength(1);
    expect(result.distributions[0]!.agentId).toBe('agent-2');
    expect(result.distributions[0]!.amount).toBe(1000);
    expect(result.totalDistributed).toBe(1000);
    expect(result.undistributed).toBe(0);
  });

  // ── Floor math ──────────────────────────────────────────────────────────────

  it('floors fractional chips at each level (no chip creation)', async () => {
    // prize=100, ownerShareRate=33 → passUp=floor(100*33/100)=33, retain=67
    // then at parent: 33 retained in full (no parent)
    const childAgent = makeAgent('agent-1', 'owner-1', 'agent-2', 33, 'Fractional');
    const parentAgent = makeAgent('agent-2', 'owner-2', null, 0, 'Parent');

    queueAgentLookup(childAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-child');

    queueAgentLookup(parentAgent);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-parent');

    const result = await svc.distributePrizeCascade('agent-1', 100, 'hand-floor');

    expect(result.distributions[0]!.amount).toBe(67); // retain = 100 - 33
    expect(result.distributions[1]!.amount).toBe(33); // pass-up gets the floored 33
    // Total should be 100 (67 + 33)
    expect(result.totalDistributed).toBe(100);
    expect(result.undistributed).toBe(0);
  });

  it('never creates chips — distributed + undistributed always equals totalPrize', async () => {
    // 3-level, rate=33 at each level; check invariant
    const a1 = makeAgent('agent-1', 'owner-1', 'agent-2', 33, 'A1');
    const a2 = makeAgent('agent-2', 'owner-2', 'agent-3', 33, 'A2');
    const a3 = makeAgent('agent-3', 'owner-3', null, 0, 'A3');

    queueAgentLookup(a1);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-1');

    queueAgentLookup(a2);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-2');

    queueAgentLookup(a3);
    queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, 'tx-3');

    const result = await svc.distributePrizeCascade('agent-1', 100, 'hand-invariant');

    const sumDistributed = result.distributions.reduce((sum, d) => sum + d.amount, 0);
    expect(sumDistributed + result.undistributed).toBe(result.totalPrize);
    expect(sumDistributed).toBe(result.totalDistributed);
  });

  // ── MAX_DEPTH limit ─────────────────────────────────────────────────────────

  it('stops traversal at MAX_DEPTH=5 and sets undistributed for leftover', async () => {
    // 6-level chain; depth 5 is the boundary — the loop processes depths 0-4, stops before 5
    // All ownerShareRate=50 so chips always remain
    const agents = [
      makeAgent('a1', 'o1', 'a2', 50, 'L1'),
      makeAgent('a2', 'o2', 'a3', 50, 'L2'),
      makeAgent('a3', 'o3', 'a4', 50, 'L3'),
      makeAgent('a4', 'o4', 'a5', 50, 'L4'),
      makeAgent('a5', 'o5', 'a6', 50, 'L5'), // depth=4 (last one processed)
      // a6 would be depth=5 — never reached
    ];

    for (const agent of agents) {
      queueAgentLookup(agent);
      queueCreditTx({ chipBalance: 0, frozenAmount: 0 }, `tx-${agent.id}`);
    }

    const result = await svc.distributePrizeCascade('a1', 1000, 'hand-depth');

    // 5 distributions (depths 0-4), a6 never processed
    expect(result.distributions).toHaveLength(5);

    // Verify depths
    for (let i = 0; i < 5; i++) {
      expect(result.distributions[i]!.depth).toBe(i);
    }

    // After 5 levels at 50%, remaining = 1000 * (0.5^5) = floor-cascaded
    // depth 0: retain=500, pass=500
    // depth 1: retain=250, pass=250
    // depth 2: retain=125, pass=125
    // depth 3: retain=62 (floor(125*50/100)=62, retain=63)... let's check invariant
    const sumDistributed = result.distributions.reduce((sum, d) => sum + d.amount, 0);
    expect(sumDistributed + result.undistributed).toBe(1000);
    expect(result.undistributed).toBeGreaterThan(0); // chips left over from depth limit
  });

  // ── Agent not found ─────────────────────────────────────────────────────────

  it('returns empty distributions when agentId does not exist', async () => {
    // db.select returns empty array for the agent lookup
    mockSelectFromWhereLimitFn.mockResolvedValueOnce([]);

    const result = await svc.distributePrizeCascade('nonexistent', 1000, 'hand-x');

    expect(result.distributions).toHaveLength(0);
    expect(result.totalDistributed).toBe(0);
    expect(result.undistributed).toBe(1000);
  });
});
