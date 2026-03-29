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
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    transaction: mockTransaction,
  },
  schema: {
    users: {
      id: 'users.id',
      chipBalance: 'users.chip_balance',
      frozenAmount: 'users.frozen_amount',
      updatedAt: 'users.updated_at',
    },
    chipTransactions: {
      id: 'chip_transactions.id',
      userId: 'chip_transactions.user_id',
      referenceType: 'chip_transactions.reference_type',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  sql: new Proxy(() => 'sql-expr', { get: () => () => 'sql-expr' }),
}));

import { ChipService, UserNotFoundError } from '../chip.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-001';
const TX_ID = 'tx-uuid-001';

/** Build a fake external transaction object (as the caller would pass in). */
function makeFakeTx() {
  return {
    select: mockTxSelect,
    update: mockTxUpdate,
    insert: mockTxInsert,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChipService.creditInTx()', () => {
  let svc: ChipService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ChipService();
  });

  it('credits the user when called with an external transaction', async () => {
    // Provide the user row that lockUser will read
    mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 500, frozenAmount: 100 }]);
    mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
    mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]);

    const tx = makeFakeTx();
    const result = await svc.creditInTx(tx as never, USER_ID, 200, 'bet_win', {
      referenceType: 'bet_win',
      referenceId: 'bet-123',
    });

    expect(result.type).toBe('credit');
    expect(result.amount).toBe(200);
    expect(result.balanceBefore).toBe(500);
    expect(result.balanceAfter).toBe(700);
    expect(result.frozenBefore).toBe(100);
    expect(result.frozenAfter).toBe(100);
    expect(result.txId).toBe(TX_ID);
  });

  it('does NOT open a nested db.transaction — uses the supplied tx directly', async () => {
    mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 300, frozenAmount: 0 }]);
    mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
    mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]);

    const tx = makeFakeTx();
    await svc.creditInTx(tx as never, USER_ID, 50, 'bet_win');

    // db.transaction must never be called — creditInTx reuses the external tx
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('commits when the outer transaction commits (uses tx.insert and tx.update)', async () => {
    mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 1000, frozenAmount: 0 }]);
    mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
    mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]);

    const tx = makeFakeTx();
    await svc.creditInTx(tx as never, USER_ID, 100, 'bet_win');

    // Both tx.update and tx.insert must be called (not standalone db calls)
    expect(mockTxUpdate).toHaveBeenCalled();
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it('rolls back when the outer transaction rolls back (no independent commit)', async () => {
    // Simulate: the external transaction calls creditInTx then throws — the
    // function itself should not call db.transaction, so rollback is the
    // caller's responsibility. We verify creditInTx doesn't escape the tx.
    mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 500, frozenAmount: 0 }]);
    mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
    mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]);

    const tx = makeFakeTx();
    // creditInTx completes normally — outer tx decides commit/rollback
    const result = await svc.creditInTx(tx as never, USER_ID, 75, 'bet_win');
    expect(result.amount).toBe(75);

    // db.transaction was never called — outer caller owns the transaction boundary
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('passes referenceType and referenceId from meta to the chipTransactions row', async () => {
    mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 200, frozenAmount: 0 }]);
    mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
    mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]);

    const tx = makeFakeTx();
    await svc.creditInTx(tx as never, USER_ID, 50, 'prize note', {
      referenceType: 'bet_win',
      referenceId: 'bet-abc',
    });

    expect(mockTxInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceType: 'bet_win',
        referenceId: 'bet-abc',
        note: 'prize note',
      }),
    );
  });

  it('throws UserNotFoundError when user does not exist', async () => {
    mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([]);

    const tx = makeFakeTx();
    await expect(svc.creditInTx(tx as never, USER_ID, 100, 'bet_win')).rejects.toThrow(
      UserNotFoundError,
    );
  });

  it('throws on non-positive amount', async () => {
    const tx = makeFakeTx();
    await expect(svc.creditInTx(tx as never, USER_ID, 0, 'bet_win')).rejects.toThrow(
      'must be positive',
    );
    await expect(svc.creditInTx(tx as never, USER_ID, -5, 'bet_win')).rejects.toThrow(
      'must be positive',
    );
  });
});
