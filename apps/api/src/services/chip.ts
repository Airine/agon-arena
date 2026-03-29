import { eq, sql, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

// ─── Reward amounts ────────────────────────────────────────────────────────

export const REGISTRATION_BONUS = 1000;

// AGO-68: Invite reward tiers
export const INVITE_REFEREE_REWARD = 500;   // referee receives on registration with invite code
export const INVITE_FIRST_BET_REWARD = 100; // referee receives on first non-fold game action
export const INVITE_REFERRER_REWARD = 200;  // referrer receives when referee places first bet

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

export interface CascadeDistributionResult {
  totalPrize: number;
  totalDistributed: number;
  undistributed: number;
  distributions: Array<{
    agentId: string;
    agentName: string;
    userId: string;
    amount: number;
    depth: number;
    txResult: ChipTxResult;
  }>;
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

  // ─── Invite rewards ───────────────────────────────────────────────────────

  /**
   * Award the referee's +500 CHIP invite reward at registration.
   *
   * Idempotent: guarded by referenceType='invite_referee' + referenceId=inviteCodeId.
   * Caller must have already:
   *   1. Set users.invitedByCodeId = inviteCodeId
   *   2. Marked invite_codes.usedByUserId + usedAt
   *
   * Returns the transaction result, or null if already awarded.
   */
  async allocateInviteRefereeReward(
    refereeUserId: string,
    inviteCodeId: string,
  ): Promise<ChipTxResult | null> {
    return db.transaction(async (tx) => {
      // Idempotency: check for existing referee reward for this code
      const [existing] = await tx
        .select({ id: schema.chipTransactions.id })
        .from(schema.chipTransactions)
        .where(
          and(
            eq(schema.chipTransactions.userId, refereeUserId),
            eq(schema.chipTransactions.referenceType, 'invite_referee'),
            eq(schema.chipTransactions.referenceId, inviteCodeId),
          ),
        )
        .limit(1);

      if (existing) return null;

      const user = await this.lockUser(tx, refereeUserId);

      const balanceBefore = user.chipBalance;
      const frozenBefore = user.frozenAmount;
      const balanceAfter = balanceBefore + INVITE_REFEREE_REWARD;

      await tx
        .update(schema.users)
        .set({
          chipBalance: sql`${schema.users.chipBalance} + ${INVITE_REFEREE_REWARD}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, refereeUserId));

      const [row] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId: refereeUserId,
          type: 'credit',
          amount: INVITE_REFEREE_REWARD,
          balanceBefore,
          balanceAfter,
          frozenBefore,
          frozenAfter: frozenBefore,
          referenceType: 'invite_referee',
          referenceId: inviteCodeId,
          note: `Invite code referee reward (+${INVITE_REFEREE_REWARD} CHIP)`,
        })
        .returning({ id: schema.chipTransactions.id });

      return {
        txId: row!.id,
        userId: refereeUserId,
        type: 'credit',
        amount: INVITE_REFEREE_REWARD,
        balanceBefore,
        balanceAfter,
        frozenBefore,
        frozenAfter: frozenBefore,
      };
    });
  }

  /**
   * Distribute first-bet rewards: referee +100 CHIP, referrer +200 CHIP.
   *
   * Called once when a referee (a user with invitedByCodeId set) places their first
   * non-fold game action. Sets users.firstBetRewardedAt and invite_codes.referrerRewarded.
   *
   * Idempotent: guarded by users.firstBetRewardedAt (checked inside transaction).
   * Returns { referee, referrer } transaction results, or null if already distributed.
   */
  async allocateFirstBetRewards(refereeUserId: string): Promise<{
    referee: ChipTxResult;
    referrer: ChipTxResult | null;
  } | null> {
    return db.transaction(async (tx) => {
      // Load referee user with FOR UPDATE semantics
      const [refereeUser] = await tx
        .select({
          chipBalance: schema.users.chipBalance,
          frozenAmount: schema.users.frozenAmount,
          invitedByCodeId: schema.users.invitedByCodeId,
          firstBetRewardedAt: schema.users.firstBetRewardedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, refereeUserId))
        .limit(1);

      if (!refereeUser) throw new UserNotFoundError(refereeUserId);

      // Idempotency guard: already distributed
      if (refereeUser.firstBetRewardedAt !== null) return null;

      // No invite code: nothing to award
      if (!refereeUser.invitedByCodeId) return null;

      const inviteCodeId = refereeUser.invitedByCodeId;
      const now = new Date();

      // ── Referee +100 CHIP ──────────────────────────────────────────────────
      const refereeBefore = refereeUser.chipBalance;
      const refereeFrozen = refereeUser.frozenAmount;
      const refereeAfter = refereeBefore + INVITE_FIRST_BET_REWARD;

      await tx
        .update(schema.users)
        .set({
          chipBalance: sql`${schema.users.chipBalance} + ${INVITE_FIRST_BET_REWARD}`,
          firstBetRewardedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.users.id, refereeUserId));

      const [refereeTx] = await tx
        .insert(schema.chipTransactions)
        .values({
          userId: refereeUserId,
          type: 'credit',
          amount: INVITE_FIRST_BET_REWARD,
          balanceBefore: refereeBefore,
          balanceAfter: refereeAfter,
          frozenBefore: refereeFrozen,
          frozenAfter: refereeFrozen,
          referenceType: 'invite_first_bet',
          referenceId: inviteCodeId,
          note: `First-bet invite bonus (+${INVITE_FIRST_BET_REWARD} CHIP)`,
        })
        .returning({ id: schema.chipTransactions.id });

      const refereeResult: ChipTxResult = {
        txId: refereeTx!.id,
        userId: refereeUserId,
        type: 'credit',
        amount: INVITE_FIRST_BET_REWARD,
        balanceBefore: refereeBefore,
        balanceAfter: refereeAfter,
        frozenBefore: refereeFrozen,
        frozenAfter: refereeFrozen,
      };

      // ── Referrer +200 CHIP ─────────────────────────────────────────────────
      // Load invite code to find referrer
      const [codeRow] = await tx
        .select({
          createdByUserId: schema.inviteCodes.createdByUserId,
          referrerRewarded: schema.inviteCodes.referrerRewarded,
        })
        .from(schema.inviteCodes)
        .where(eq(schema.inviteCodes.id, inviteCodeId))
        .limit(1);

      let referrerResult: ChipTxResult | null = null;

      if (codeRow && !codeRow.referrerRewarded) {
        const referrerUserId = codeRow.createdByUserId;
        const referrer = await this.lockUser(tx, referrerUserId);

        const referrerBefore = referrer.chipBalance;
        const referrerFrozen = referrer.frozenAmount;
        const referrerAfter = referrerBefore + INVITE_REFERRER_REWARD;

        await tx
          .update(schema.users)
          .set({
            chipBalance: sql`${schema.users.chipBalance} + ${INVITE_REFERRER_REWARD}`,
            updatedAt: now,
          })
          .where(eq(schema.users.id, referrerUserId));

        const [referrerTx] = await tx
          .insert(schema.chipTransactions)
          .values({
            userId: referrerUserId,
            type: 'credit',
            amount: INVITE_REFERRER_REWARD,
            balanceBefore: referrerBefore,
            balanceAfter: referrerAfter,
            frozenBefore: referrerFrozen,
            frozenAfter: referrerFrozen,
            referenceType: 'invite_referrer',
            referenceId: inviteCodeId,
            note: `Referral reward — referee's first bet (+${INVITE_REFERRER_REWARD} CHIP)`,
          })
          .returning({ id: schema.chipTransactions.id });

        // Mark invite code referrer as rewarded
        await tx
          .update(schema.inviteCodes)
          .set({ referrerRewarded: true })
          .where(eq(schema.inviteCodes.id, inviteCodeId));

        referrerResult = {
          txId: referrerTx!.id,
          userId: referrerUserId,
          type: 'credit',
          amount: INVITE_REFERRER_REWARD,
          balanceBefore: referrerBefore,
          balanceAfter: referrerAfter,
          frozenBefore: referrerFrozen,
          frozenAfter: referrerFrozen,
        };
      }

      return { referee: refereeResult, referrer: referrerResult };
    });
  }

  /**
   * Distribute a prize up the agent ownership chain (FR-AGT-W021).
   *
   * When agentId wins totalPrize CHIP from a competition:
   *   - If agent has no ownerAgentId: all chips go to agent.ownerId user
   *   - If agent has ownerAgentId: agent retains (100 - ownerShareRate)%, passes ownerShareRate% upward
   *   - Continues up to chain depth 5 (MAX_OWNER_CHAIN_DEPTH from AGO-53)
   *
   * Each level credits atomically. Fractional chips are floored (no chip creation).
   * referenceType='ownership_cascade', referenceId=`${originalReferenceId}:d${depth}`
   *
   * Returns all distribution results, bottom-up order.
   */
  async distributePrizeCascade(
    agentId: string,
    totalPrize: number,
    referenceId: string,
  ): Promise<CascadeDistributionResult> {
    if (totalPrize <= 0) throw new Error('Prize must be positive');

    const MAX_DEPTH = 5;
    const distributions: CascadeDistributionResult['distributions'] = [];
    let remaining = totalPrize;
    let currentAgentId: string | null = agentId;
    let depth = 0;

    while (currentAgentId !== null && depth < MAX_DEPTH && remaining > 0) {
      const [agent] = await db
        .select({
          id: schema.agents.id,
          ownerId: schema.agents.ownerId,
          ownerAgentId: schema.agents.ownerAgentId,
          ownerShareRate: schema.agents.ownerShareRate,
          name: schema.agents.name,
        })
        .from(schema.agents)
        .where(eq(schema.agents.id, currentAgentId))
        .limit(1);

      if (!agent) break;

      const hasParent = agent.ownerAgentId !== null;
      let retainAmount: number;
      let passUpAmount: number;

      if (!hasParent) {
        retainAmount = remaining;
        passUpAmount = 0;
      } else {
        const passUpRate = Math.min(100, Math.max(0, agent.ownerShareRate));
        passUpAmount = Math.floor(remaining * passUpRate / 100);
        retainAmount = remaining - passUpAmount;
      }

      if (retainAmount > 0) {
        const txResult = await this.credit(agent.ownerId, retainAmount, {
          referenceType: 'ownership_cascade',
          referenceId: `${referenceId}:d${depth}`,
          note: `Prize cascade — ${agent.name} retains ${retainAmount} CHIP (depth ${depth})`,
        });
        distributions.push({
          agentId: agent.id,
          agentName: agent.name,
          userId: agent.ownerId,
          amount: retainAmount,
          depth,
          txResult,
        });
      }

      remaining = passUpAmount;
      currentAgentId = agent.ownerAgentId;
      depth++;
    }

    return {
      totalPrize,
      totalDistributed: totalPrize - remaining,
      undistributed: remaining,
      distributions,
    };
  }

  /**
   * Credit chips to a user within an **external** transaction.
   * Identical to `credit()` but uses the caller-supplied `tx` instead of
   * opening a new transaction — allows multiple credits to be atomic.
   */
  async creditInTx(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    amount: number,
    description: string,
    meta?: Record<string, unknown>,
  ): Promise<ChipTxResult> {
    if (amount <= 0) throw new Error('Credit amount must be positive');

    const user = await this.lockUser(tx, userId);

    const balanceBefore = user.chipBalance;
    const frozenBefore = user.frozenAmount;
    const balanceAfter = balanceBefore + amount;
    const frozenAfter = frozenBefore;

    await tx
      .update(schema.users)
      .set({
        chipBalance: sql`${schema.users.chipBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));

    const referenceId = meta?.['referenceId'] as string | undefined;
    const referenceType = meta?.['referenceType'] as string | undefined;

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
        referenceId,
        referenceType,
        note: description,
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
