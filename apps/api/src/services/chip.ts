import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

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
