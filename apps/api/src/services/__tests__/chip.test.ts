import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (vi.mock factory is hoisted — variables must be too) ───────
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
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  sql: new Proxy(() => 'sql-expr', { get: () => () => 'sql-expr' }),
}));

import { ChipService, InsufficientChipsError, UserNotFoundError } from '../chip.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-001';
const TX_ID = 'tx-uuid-001';

function setupTxMock(userFixture: { chipBalance: number; frozenAmount: number }) {
  mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([userFixture]);
  mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
  mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]);

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

describe('ChipService', () => {
  let svc: ChipService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ChipService();
  });

  // ── credit ─────────────────────────────────────────────────────────────────

  describe('credit()', () => {
    it('increases chipBalance and records a transaction', async () => {
      setupTxMock({ chipBalance: 500, frozenAmount: 100 });

      const result = await svc.credit(USER_ID, 200);

      expect(result.type).toBe('credit');
      expect(result.amount).toBe(200);
      expect(result.balanceBefore).toBe(500);
      expect(result.balanceAfter).toBe(700);
      expect(result.frozenBefore).toBe(100);
      expect(result.frozenAfter).toBe(100); // frozen unchanged
      expect(result.txId).toBe(TX_ID);
    });

    it('passes referenceId and referenceType to the transaction row', async () => {
      setupTxMock({ chipBalance: 200, frozenAmount: 0 });

      await svc.credit(USER_ID, 50, { referenceId: 'arena-1', referenceType: 'arena', note: 'prize' });

      expect(mockTxInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ referenceId: 'arena-1', referenceType: 'arena', note: 'prize' }),
      );
    });

    it('throws on non-positive amount', async () => {
      await expect(svc.credit(USER_ID, 0)).rejects.toThrow('must be positive');
      await expect(svc.credit(USER_ID, -1)).rejects.toThrow('must be positive');
    });

    it('throws UserNotFoundError when user does not exist', async () => {
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([]);
      mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockTxSelect, update: mockTxUpdate, insert: mockTxInsert }),
      );
      await expect(svc.credit(USER_ID, 100)).rejects.toThrow(UserNotFoundError);
    });
  });

  // ── debit ──────────────────────────────────────────────────────────────────

  describe('debit()', () => {
    it('decreases chipBalance when sufficient available chips exist', async () => {
      setupTxMock({ chipBalance: 500, frozenAmount: 100 });
      // available = 400

      const result = await svc.debit(USER_ID, 150);

      expect(result.type).toBe('debit');
      expect(result.balanceBefore).toBe(500);
      expect(result.balanceAfter).toBe(350);
      expect(result.frozenBefore).toBe(100);
      expect(result.frozenAfter).toBe(100); // frozen unchanged
    });

    it('throws InsufficientChipsError when available < amount', async () => {
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 300, frozenAmount: 200 }]);
      // available = 100
      mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockTxSelect, update: mockTxUpdate, insert: mockTxInsert }),
      );

      await expect(svc.debit(USER_ID, 150)).rejects.toThrow(InsufficientChipsError);
    });

    it('allows debiting exactly the available amount', async () => {
      setupTxMock({ chipBalance: 300, frozenAmount: 100 });
      // available = 200 — debit exactly 200 should succeed

      const result = await svc.debit(USER_ID, 200);
      expect(result.balanceAfter).toBe(100);
    });

    it('throws on non-positive amount', async () => {
      await expect(svc.debit(USER_ID, 0)).rejects.toThrow('must be positive');
    });
  });

  // ── freeze ─────────────────────────────────────────────────────────────────

  describe('freeze()', () => {
    it('increases frozenAmount without changing chipBalance', async () => {
      setupTxMock({ chipBalance: 500, frozenAmount: 100 });
      // available = 400

      const result = await svc.freeze(USER_ID, 200);

      expect(result.type).toBe('freeze');
      expect(result.balanceBefore).toBe(500);
      expect(result.balanceAfter).toBe(500); // balance unchanged
      expect(result.frozenBefore).toBe(100);
      expect(result.frozenAfter).toBe(300);
    });

    it('throws InsufficientChipsError when available < freeze amount', async () => {
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 200, frozenAmount: 150 }]);
      // available = 50
      mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockTxSelect, update: mockTxUpdate, insert: mockTxInsert }),
      );

      await expect(svc.freeze(USER_ID, 100)).rejects.toThrow(InsufficientChipsError);
    });

    it('throws on non-positive amount', async () => {
      await expect(svc.freeze(USER_ID, 0)).rejects.toThrow('must be positive');
    });
  });

  // ── unfreeze ───────────────────────────────────────────────────────────────

  describe('unfreeze()', () => {
    it('decreases frozenAmount without changing chipBalance', async () => {
      setupTxMock({ chipBalance: 500, frozenAmount: 300 });

      const result = await svc.unfreeze(USER_ID, 100);

      expect(result.type).toBe('unfreeze');
      expect(result.balanceBefore).toBe(500);
      expect(result.balanceAfter).toBe(500); // balance unchanged
      expect(result.frozenBefore).toBe(300);
      expect(result.frozenAfter).toBe(200);
    });

    it('throws when frozenAmount < unfreeze amount', async () => {
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 500, frozenAmount: 50 }]);
      mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockTxSelect, update: mockTxUpdate, insert: mockTxInsert }),
      );

      await expect(svc.unfreeze(USER_ID, 100)).rejects.toThrow('Cannot unfreeze');
    });

    it('allows unfreezing exactly all frozen chips', async () => {
      setupTxMock({ chipBalance: 500, frozenAmount: 200 });

      const result = await svc.unfreeze(USER_ID, 200);
      expect(result.frozenAfter).toBe(0);
    });

    it('throws on non-positive amount', async () => {
      await expect(svc.unfreeze(USER_ID, 0)).rejects.toThrow('must be positive');
    });
  });

  // ── getBalance ─────────────────────────────────────────────────────────────

  describe('getBalance()', () => {
    it('returns balance with computed available field', async () => {
      mockSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 1000, frozenAmount: 200 }]);

      const bal = await svc.getBalance(USER_ID);

      expect(bal.chipBalance).toBe(1000);
      expect(bal.frozenAmount).toBe(200);
      expect(bal.available).toBe(800);
    });

    it('available is 0 when all chips are frozen', async () => {
      mockSelectFromWhereLimitFn.mockResolvedValueOnce([{ chipBalance: 500, frozenAmount: 500 }]);

      const bal = await svc.getBalance(USER_ID);
      expect(bal.available).toBe(0);
    });

    it('throws UserNotFoundError when user does not exist', async () => {
      mockSelectFromWhereLimitFn.mockResolvedValueOnce([]);
      await expect(svc.getBalance(USER_ID)).rejects.toThrow(UserNotFoundError);
    });
  });

  // ── InsufficientChipsError ─────────────────────────────────────────────────

  describe('InsufficientChipsError', () => {
    it('has correct name and message', () => {
      const err = new InsufficientChipsError(500, 300);
      expect(err.name).toBe('InsufficientChipsError');
      expect(err.message).toContain('500');
      expect(err.message).toContain('300');
      expect(err instanceof Error).toBe(true);
    });
  });

  // ── allocateRegistrationBonus ───────────────────────────────────────────────

  describe('allocateRegistrationBonus()', () => {
    function setupRegistrationTxMock(
      existingTx: object | null,
      userFixture: { chipBalance: number; frozenAmount: number },
    ) {
      // First select: idempotency check on chipTransactions
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce(existingTx ? [existingTx] : []);
      if (!existingTx) {
        // Second select: lockUser
        mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([userFixture]);
        mockTxUpdateSetWhere.mockResolvedValueOnce(undefined);
        mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]);
      }
      mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockTxSelect, update: mockTxUpdate, insert: mockTxInsert }),
      );
    }

    it('credits 1000 CHIP to a brand-new user', async () => {
      setupRegistrationTxMock(null, { chipBalance: 0, frozenAmount: 0 });

      const result = await svc.allocateRegistrationBonus(USER_ID);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('credit');
      expect(result!.amount).toBe(1000);
      expect(result!.balanceBefore).toBe(0);
      expect(result!.balanceAfter).toBe(1000);
      expect(result!.txId).toBe(TX_ID);
    });

    it('records correct referenceType=registration in the insert', async () => {
      setupRegistrationTxMock(null, { chipBalance: 0, frozenAmount: 0 });

      await svc.allocateRegistrationBonus(USER_ID);

      expect(mockTxInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: 'registration',
          referenceId: USER_ID,
          amount: 1000,
        }),
      );
    });

    it('returns null when bonus was already awarded (idempotent)', async () => {
      setupRegistrationTxMock({ id: 'existing-tx' }, { chipBalance: 1000, frozenAmount: 0 });

      const result = await svc.allocateRegistrationBonus(USER_ID);

      expect(result).toBeNull();
      // No update or insert should have been called
      expect(mockTxUpdateSetWhere).not.toHaveBeenCalled();
      expect(mockTxInsertValues).not.toHaveBeenCalled();
    });

    it('preserves frozenAmount in the transaction record', async () => {
      setupRegistrationTxMock(null, { chipBalance: 0, frozenAmount: 0 });

      const result = await svc.allocateRegistrationBonus(USER_ID);

      expect(result!.frozenBefore).toBe(0);
      expect(result!.frozenAfter).toBe(0);
    });

    it('throws UserNotFoundError if user does not exist', async () => {
      // idempotency check returns empty
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([]);
      // lockUser returns empty
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([]);
      mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockTxSelect, update: mockTxUpdate, insert: mockTxInsert }),
      );

      await expect(svc.allocateRegistrationBonus(USER_ID)).rejects.toThrow(UserNotFoundError);
    });
  });

  // ── allocateSocialBindingReward ─────────────────────────────────────────────

  describe('allocateSocialBindingReward()', () => {
    const PROVIDER_USER_ID = 'gh-12345';

    function setupSocialTxMock(
      binding: { chipRewarded: boolean } | null,
      userFixture: { chipBalance: number; frozenAmount: number },
    ) {
      // First select: socialBindings (chipRewarded check)
      mockTxSelectFromWhereLimitFn.mockResolvedValueOnce(binding ? [binding] : []);
      if (binding && !binding.chipRewarded) {
        // Second select: lockUser
        mockTxSelectFromWhereLimitFn.mockResolvedValueOnce([userFixture]);
        mockTxUpdateSetWhere.mockResolvedValueOnce(undefined); // users update
        mockTxInsertReturning.mockResolvedValueOnce([{ id: TX_ID }]); // chipTransactions insert
        mockTxUpdateSetWhere.mockResolvedValueOnce(undefined); // socialBindings update
      }
      mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select: mockTxSelect, update: mockTxUpdate, insert: mockTxInsert }),
      );
    }

    it('credits correct amount for github (+500)', async () => {
      setupSocialTxMock({ chipRewarded: false }, { chipBalance: 1000, frozenAmount: 0 });

      const result = await svc.allocateSocialBindingReward(USER_ID, 'github', PROVIDER_USER_ID);

      expect(result).not.toBeNull();
      expect(result!.amount).toBe(500);
      expect(result!.balanceBefore).toBe(1000);
      expect(result!.balanceAfter).toBe(1500);
    });

    it('credits correct amount for google (+200)', async () => {
      setupSocialTxMock({ chipRewarded: false }, { chipBalance: 1000, frozenAmount: 0 });

      const result = await svc.allocateSocialBindingReward(USER_ID, 'google', PROVIDER_USER_ID);

      expect(result!.amount).toBe(200);
    });

    it('credits correct amount for twitter (+300)', async () => {
      setupSocialTxMock({ chipRewarded: false }, { chipBalance: 1000, frozenAmount: 0 });

      const result = await svc.allocateSocialBindingReward(USER_ID, 'twitter', PROVIDER_USER_ID);

      expect(result!.amount).toBe(300);
    });

    it('credits correct amount for ens (+500)', async () => {
      setupSocialTxMock({ chipRewarded: false }, { chipBalance: 1000, frozenAmount: 0 });

      const result = await svc.allocateSocialBindingReward(USER_ID, 'ens', PROVIDER_USER_ID);

      expect(result!.amount).toBe(500);
    });

    it('returns null when already rewarded (idempotent)', async () => {
      setupSocialTxMock({ chipRewarded: true }, { chipBalance: 1500, frozenAmount: 0 });

      const result = await svc.allocateSocialBindingReward(USER_ID, 'github', PROVIDER_USER_ID);

      expect(result).toBeNull();
      expect(mockTxInsertValues).not.toHaveBeenCalled();
    });

    it('returns null when binding does not exist', async () => {
      setupSocialTxMock(null, { chipBalance: 1000, frozenAmount: 0 });

      const result = await svc.allocateSocialBindingReward(USER_ID, 'github', PROVIDER_USER_ID);

      expect(result).toBeNull();
    });

    it('returns null for unknown provider', async () => {
      const result = await svc.allocateSocialBindingReward(USER_ID, 'discord', PROVIDER_USER_ID);
      expect(result).toBeNull();
    });

    it('records correct referenceId in the insert', async () => {
      setupSocialTxMock({ chipRewarded: false }, { chipBalance: 1000, frozenAmount: 0 });

      await svc.allocateSocialBindingReward(USER_ID, 'github', PROVIDER_USER_ID);

      expect(mockTxInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: 'social_bind',
          referenceId: `github:${PROVIDER_USER_ID}`,
        }),
      );
    });

    it('marks socialBindings.chipRewarded = true after award', async () => {
      setupSocialTxMock({ chipRewarded: false }, { chipBalance: 1000, frozenAmount: 0 });

      await svc.allocateSocialBindingReward(USER_ID, 'github', PROVIDER_USER_ID);

      // The second update call (index 1) should set chipRewarded: true
      expect(mockTxUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ chipRewarded: true }),
      );
    });
  });
});
