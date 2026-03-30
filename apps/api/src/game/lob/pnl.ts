import type { LOBAgentStats } from './types.js';

export function createAgentStats(startingCash: number): LOBAgentStats {
  return { inventory: 0, cash: startingCash, pnl: startingCash };
}

export function updateStatsAfterTrade(
  stats: LOBAgentStats,
  side: 'buy' | 'sell',
  price: number,
  qty: number,
): LOBAgentStats {
  if (side === 'buy') {
    return {
      ...stats,
      inventory: stats.inventory + qty,
      cash: stats.cash - price * qty,
      pnl: stats.pnl, // updated by markToMarket
    };
  } else {
    return {
      ...stats,
      inventory: stats.inventory - qty,
      cash: stats.cash + price * qty,
      pnl: stats.pnl,
    };
  }
}

export function markToMarket(stats: LOBAgentStats, midPrice: number): LOBAgentStats {
  const pnl = stats.cash + stats.inventory * midPrice;
  return { ...stats, pnl };
}

export function settleAgent(stats: LOBAgentStats, lastMidPrice: number): LOBAgentStats {
  // Convert all inventory to cash at lastMidPrice
  const finalCash = stats.cash + stats.inventory * lastMidPrice;
  return { inventory: 0, cash: finalCash, pnl: finalCash };
}
