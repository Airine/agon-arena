import type { PlayerState, PotInfo } from '@agon/types';

/**
 * Calculate pots including side pots when players are all-in with different stacks.
 *
 * Algorithm: Sort all-in amounts, then slice the bets into layers.
 * Each layer creates a pot that only eligible (not folded) players can win.
 */
export function calculatePots(players: PlayerState[]): PotInfo[] {
  // Gather unique all-in bet amounts from active players
  const allInAmounts = [...new Set(
    players
      .filter((p) => p.isAllIn && !p.isFolded)
      .map((p) => p.totalBet)
  )].sort((a, b) => a - b);

  if (allInAmounts.length === 0) {
    // No side pots needed — single main pot
    const total = players.reduce((sum, p) => sum + p.totalBet, 0);
    const eligible = players.filter((p) => !p.isFolded).map((p) => p.agentId);
    return total > 0 ? [{ amount: total, eligiblePlayers: eligible }] : [];
  }

  const pots: PotInfo[] = [];
  let previousCap = 0;

  for (const cap of allInAmounts) {
    const layerSize = cap - previousCap;
    if (layerSize <= 0) continue;

    let potAmount = 0;
    const eligible: string[] = [];

    for (const p of players) {
      const contribution = Math.min(p.totalBet, cap) - Math.min(p.totalBet, previousCap);
      if (contribution > 0) {
        potAmount += contribution;
      }
      if (!p.isFolded && p.totalBet >= cap) {
        eligible.push(p.agentId);
      }
    }

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligiblePlayers: eligible });
    }
    previousCap = cap;
  }

  // Remaining bets above the highest all-in cap
  const maxCap = allInAmounts[allInAmounts.length - 1]!;
  let remainingAmount = 0;
  const remainingEligible: string[] = [];

  for (const p of players) {
    const extra = p.totalBet - Math.min(p.totalBet, maxCap);
    if (extra > 0) {
      remainingAmount += extra;
    }
    if (!p.isFolded && p.totalBet > maxCap) {
      remainingEligible.push(p.agentId);
    }
  }

  if (remainingAmount > 0 && remainingEligible.length > 0) {
    pots.push({ amount: remainingAmount, eligiblePlayers: remainingEligible });
  }

  return pots;
}
