import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { chipService } from './chip.js';

export const PLATFORM_FEE_RATE = 0.05; // 5%

/**
 * Settle all pending bets for a finished arena.
 *
 * Logic:
 * - Load all pending bets for the arena.
 * - Separate into winning bets (agentId in winnerAgentIds) and losing bets.
 * - Calculate total pool, platform fee (5%), and prize pool.
 * - For each winning bet: payout = floor((bet.amountChips / totalWinningBets) * prizePool)
 * - Distribute chip remainder to the largest winning bet (rounding).
 * - Wrap all DB mutations in a single transaction (atomic rollback on failure).
 *
 * @param arenaId       - The finished arena's ID.
 * @param winnerAgentIds - Agent IDs that won the arena (have chips remaining).
 */
export async function settleBets(arenaId: string, winnerAgentIds: string[]): Promise<void> {
  // Load all pending bets for this arena
  const pendingBets = await db
    .select({
      id: schema.arenaBets.id,
      userId: schema.arenaBets.userId,
      agentId: schema.arenaBets.agentId,
      amountChips: schema.arenaBets.amountChips,
    })
    .from(schema.arenaBets)
    .where(
      and(
        eq(schema.arenaBets.arenaId, arenaId),
        eq(schema.arenaBets.status, 'pending'),
      ),
    );

  // No-op if no bets exist for this arena
  if (pendingBets.length === 0) return;

  const winnerSet = new Set(winnerAgentIds);
  const winningBets = pendingBets.filter((b) => winnerSet.has(b.agentId));
  const losingBets = pendingBets.filter((b) => !winnerSet.has(b.agentId));

  const totalPool = pendingBets.reduce((sum, b) => sum + b.amountChips, 0);
  const platformFee = Math.floor(totalPool * PLATFORM_FEE_RATE);
  const prizePool = totalPool - platformFee;

  // Calculate payouts for winning bets
  const totalWinningAmount = winningBets.reduce((sum, b) => sum + b.amountChips, 0);

  // Base payouts (floored)
  const payouts = winningBets.map((bet) => {
    const payout =
      totalWinningAmount === 0
        ? 0
        : Math.floor((bet.amountChips / totalWinningAmount) * prizePool);
    return { bet, payout };
  });

  // Distribute rounding remainder to the largest winning bet
  const totalPaidOut = payouts.reduce((sum, p) => sum + p.payout, 0);
  const remainder = prizePool - totalPaidOut;

  if (remainder > 0 && payouts.length > 0) {
    // Find the entry with the largest bet amount
    let maxIdx = 0;
    for (let i = 1; i < payouts.length; i++) {
      if (payouts[i]!.bet.amountChips > payouts[maxIdx]!.bet.amountChips) {
        maxIdx = i;
      }
    }
    payouts[maxIdx]!.payout += remainder;
  }

  const now = new Date();

  // Atomic transaction: credit winners, update all bet rows
  await db.transaction(async (tx) => {
    // Credit winning bettors
    for (const { bet, payout } of payouts) {
      if (payout > 0) {
        await chipService.creditInTx(tx, bet.userId, payout, 'bet_win', {
          referenceType: 'bet_win',
          referenceId: bet.id,
          arenaId,
          betId: bet.id,
        });
      }
    }

    // Update winning bet rows
    for (const { bet, payout } of payouts) {
      await tx
        .update(schema.arenaBets)
        .set({
          status: 'won',
          payout,
          settledAt: now,
          platformFeeAmount: platformFee,
        })
        .where(eq(schema.arenaBets.id, bet.id));
    }

    // Update losing bet rows
    if (losingBets.length > 0) {
      const losingIds = losingBets.map((b) => b.id);
      await tx
        .update(schema.arenaBets)
        .set({
          status: 'lost',
          payout: 0,
          settledAt: now,
          platformFeeAmount: 0,
        })
        .where(inArray(schema.arenaBets.id, losingIds));
    }
  });
}
