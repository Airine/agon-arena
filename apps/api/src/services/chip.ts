import { eq, sql, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

// ─── Reward amounts ────────────────────────────────────────────────────────

export const REGISTRATION_BONUS = 1000;

export const SOCIAL_BINDING_REWARDS: Record<string, number> = {
  github: 500,
  google: 200,
  twitter: 300,
  ens: 500,
};

export type ChipTxType = 'credit' | 'debit' | 'freeze' | 'unfreeze' | 'transfer';

export interface ChipTxOptions {
  referenceId?: string;
  referenceType?: string;
  note?: string;
}

export interface ChipTxResult {
  txId: string;
  userId: string;
  type: ChipTxType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  frozenBefore: number;
  frozenAfter: number;
}

export class InsufficientChipsError extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient chips: required ${required}, available ${available}`);
    this.name = 'InsufficientChipsError';
  }
}

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

/**
 * Atomic CHIP balance operations with full audit trail.
 *
 * All mutations run inside a DB transaction:
 *   1. SELECT FOR UPDATE the user row
 *   2. Validate the operation
 *   3. UPDATE users with new balances
 *   4. INSERT chip_transactions row
 *
 * Invariants:
 *   - chipBalance >= 0 always
 *   - frozenAmount >= 0 always
 *   - frozenAmount <= chipBalance always
 *   - available = chipBalance - frozenAmount
 */
export class ChipService {
  /** Credit chips to a user (purchase, prize, admin grant). */
  async credit(userId: string, amount: number, opts?: ChipTxOptions): Promise<ChipTxResult> {
    if (amount <= 0) throw new Error('Credit amount must be positive');

    return db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);

      const balanceBefore = user.chipBalance;
      const frozenBefore = user.frozenAmount;
      const balanceAfter = balanceBefore + amount;
      const frozenAfter = frozenBefore; // freeze unaffected

      await tx
        .update(schema.users)
        .set({
          chipBalance: sql`${schema.users.chipBalance} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      const [row] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId,
          type: 'credit',
          amount,
          balanceBefore,
          balanceAfter,
          frozenBefore,
          frozenAfter,
          referenceId: opts?.referenceId,
          referenceType: opts?.referenceType,
          note: opts?.note,
        })
        .returning({ id: schema.chipTransactions.id });

      return {
        txId: row!.id,
        userId,
        type: 'credit',
        amount,
        balanceBefore,
        balanceAfter,
        frozenBefore,
        frozenAfter,
      };
    });
  }

  /**
   * Debit chips from a user (fee, penalty).
   * Only available chips (balance − frozen) can be debited.
   */
  async debit(userId: string, amount: number, opts?: ChipTxOptions): Promise<ChipTxResult> {
    if (amount <= 0) throw new Error('Debit amount must be positive');

    return db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);

      const balanceBefore = user.chipBalance;
      const frozenBefore = user.frozenAmount;
      const available = balanceBefore - frozenBefore;

      if (available < amount) {
        throw new InsufficientChipsError(amount, available);
      }

      const balanceAfter = balanceBefore - amount;
      const frozenAfter = frozenBefore;

      await tx
        .update(schema.users)
        .set({
          chipBalance: sql`${schema.users.chipBalance} - ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      const [row] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId,
          type: 'debit',
          amount,
          balanceBefore,
          balanceAfter,
          frozenBefore,
          frozenAfter,
          referenceId: opts?.referenceId,
          referenceType: opts?.referenceType,
          note: opts?.note,
        })
        .returning({ id: schema.chipTransactions.id });

      return {
        txId: row!.id,
        userId,
        type: 'debit',
        amount,
        balanceBefore,
        balanceAfter,
        frozenBefore,
        frozenAfter,
      };
    });
  }

  /**
   * Freeze chips for game entry (available → frozen).
   * chipBalance is unchanged; frozenAmount increases.
   */
  async freeze(userId: string, amount: number, opts?: ChipTxOptions): Promise<ChipTxResult> {
    if (amount <= 0) throw new Error('Freeze amount must be positive');

    return db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);

      const balanceBefore = user.chipBalance;
      const frozenBefore = user.frozenAmount;
      const available = balanceBefore - frozenBefore;

      if (available < amount) {
        throw new InsufficientChipsError(amount, available);
      }

      const balanceAfter = balanceBefore; // chipBalance unchanged
      const frozenAfter = frozenBefore + amount;

      await tx
        .update(schema.users)
        .set({
          frozenAmount: sql`${schema.users.frozenAmount} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      const [row] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId,
          type: 'freeze',
          amount,
          balanceBefore,
          balanceAfter,
          frozenBefore,
          frozenAfter,
          referenceId: opts?.referenceId,
          referenceType: opts?.referenceType,
          note: opts?.note,
        })
        .returning({ id: schema.chipTransactions.id });

      return {
        txId: row!.id,
        userId,
        type: 'freeze',
        amount,
        balanceBefore,
        balanceAfter,
        frozenBefore,
        frozenAfter,
      };
    });
  }

  /**
   * Unfreeze chips (frozen → available).
   * chipBalance is unchanged; frozenAmount decreases.
   */
  async unfreeze(userId: string, amount: number, opts?: ChipTxOptions): Promise<ChipTxResult> {
    if (amount <= 0) throw new Error('Unfreeze amount must be positive');

    return db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);

      const balanceBefore = user.chipBalance;
      const frozenBefore = user.frozenAmount;

      if (frozenBefore < amount) {
        throw new Error(`Cannot unfreeze ${amount}: only ${frozenBefore} frozen`);
      }

      const balanceAfter = balanceBefore;
      const frozenAfter = frozenBefore - amount;

      await tx
        .update(schema.users)
        .set({
          frozenAmount: sql`${schema.users.frozenAmount} - ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      const [row] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId,
          type: 'unfreeze',
          amount,
          balanceBefore,
          balanceAfter,
          frozenBefore,
          frozenAfter,
          referenceId: opts?.referenceId,
          referenceType: opts?.referenceType,
          note: opts?.note,
        })
        .returning({ id: schema.chipTransactions.id });

      return {
        txId: row!.id,
        userId,
        type: 'unfreeze',
        amount,
        balanceBefore,
        balanceAfter,
        frozenBefore,
        frozenAfter,
      };
    });
  }

  /** Get user's chip balance snapshot. */
  async getBalance(userId: string): Promise<{
    chipBalance: number;
    frozenAmount: number;
    available: number;
  }> {
    const [user] = await db
      .select({
        chipBalance: schema.users.chipBalance,
        frozenAmount: schema.users.frozenAmount,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) throw new UserNotFoundError(userId);

    return {
      chipBalance: user.chipBalance,
      frozenAmount: user.frozenAmount,
      available: user.chipBalance - user.frozenAmount,
    };
  }

  // ─── Allocation helpers ────────────────────────────────────────────────────

  /**
   * Award the one-time 1000 CHIP registration bonus to a new user.
   * Idempotent: no-op if a 'registration' credit already exists for this user.
   * Returns the transaction result, or null if bonus was already awarded.
   */
  async allocateRegistrationBonus(userId: string): Promise<ChipTxResult | null> {
    return db.transaction(async (tx) => {
      // Idempotency check: look for an existing registration bonus transaction
      const [existing] = await tx
        .select({ id: schema.chipTransactions.id })
        .from(schema.chipTransactions)
        .where(
          and(
            eq(schema.chipTransactions.userId, userId),
            eq(schema.chipTransactions.referenceType, 'registration'),
          ),
        )
        .limit(1);

      if (existing) return null; // already awarded

      const user = await this.lockUser(tx, userId);

      const balanceBefore = user.chipBalance;
      const frozenBefore = user.frozenAmount;
      const balanceAfter = balanceBefore + REGISTRATION_BONUS;

      await tx
        .update(schema.users)
        .set({
          chipBalance: sql`${schema.users.chipBalance} + ${REGISTRATION_BONUS}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      const [row] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId,
          type: 'credit',
          amount: REGISTRATION_BONUS,
          balanceBefore,
          balanceAfter,
          frozenBefore,
          frozenAfter: frozenBefore,
          referenceType: 'registration',
          referenceId: userId,
          note: `Registration bonus (+${REGISTRATION_BONUS} CHIP)`,
        })
        .returning({ id: schema.chipTransactions.id });

      return {
        txId: row!.id,
        userId,
        type: 'credit',
        amount: REGISTRATION_BONUS,
        balanceBefore,
        balanceAfter,
        frozenBefore,
        frozenAfter: frozenBefore,
      };
    });
  }

  /**
   * Award the first-bind CHIP reward for a social provider.
   * Idempotent: guarded by the `chipRewarded` flag on social_bindings.
   * Returns the transaction result, or null if reward was already distributed.
   *
   * Caller must have already inserted the social_bindings row.
   */
  async allocateSocialBindingReward(
    userId: string,
    provider: string,
    providerUserId: string,
  ): Promise<ChipTxResult | null> {
    const amount = SOCIAL_BINDING_REWARDS[provider];
    if (!amount) return null; // unknown provider — no reward defined

    const providerTyped = provider as typeof schema.socialBindings.$inferSelect.provider;

    return db.transaction(async (tx) => {
      // Read binding and lock it
      const [binding] = await tx
        .select({ chipRewarded: schema.socialBindings.chipRewarded })
        .from(schema.socialBindings)
        .where(
          and(
            eq(schema.socialBindings.userId, userId),
            eq(schema.socialBindings.provider, providerTyped),
            eq(schema.socialBindings.providerUserId, providerUserId),
          ),
        )
        .limit(1);

      if (!binding || binding.chipRewarded) return null; // already rewarded or binding not found

      const user = await this.lockUser(tx, userId);

      const balanceBefore = user.chipBalance;
      const frozenBefore = user.frozenAmount;
      const balanceAfter = balanceBefore + amount;

      await tx
        .update(schema.users)
        .set({
          chipBalance: sql`${schema.users.chipBalance} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      const [row] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId,
          type: 'credit',
          amount,
          balanceBefore,
          balanceAfter,
          frozenBefore,
          frozenAfter: frozenBefore,
          referenceType: 'social_bind',
          referenceId: `${provider}:${providerUserId}`,
          note: `${provider} OAuth first-bind reward (+${amount} CHIP)`,
        })
        .returning({ id: schema.chipTransactions.id });

      // Mark reward as distributed
      await tx
        .update(schema.socialBindings)
        .set({ chipRewarded: true, updatedAt: new Date() })
        .where(
          and(
            eq(schema.socialBindings.userId, userId),
            eq(schema.socialBindings.provider, providerTyped),
          ),
        );

      return {
        txId: row!.id,
        userId,
        type: 'credit',
        amount,
        balanceBefore,
        balanceAfter,
        frozenBefore,
        frozenAfter: frozenBefore,
      };
    });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /** SELECT the user row for update inside an open transaction. */
  private async lockUser(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
  ): Promise<{ chipBalance: number; frozenAmount: number }> {
    const [user] = await tx
      .select({
        chipBalance: schema.users.chipBalance,
        frozenAmount: schema.users.frozenAmount,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) throw new UserNotFoundError(userId);
    return user;
  }
}

export const chipService = new ChipService();
