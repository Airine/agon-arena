import { createBook, addOrder, cancelOrder, getSpread, getTopLevels } from './book.js';
import { tickGBM, createGBMState } from './mid-price.js';
import { markToMarket, updateStatsAfterTrade } from './pnl.js';
import type { LOBState, LOBAction, LOBAgentStats, LOBOrder, LOBTrade } from './types.js';
import type { BookState } from './book.js';
import type { GBMState } from './mid-price.js';

export interface LOBEngineState {
  lobState: LOBState;
  book: BookState;
  gbm: GBMState;
  lastMidPrice: number;
}

export function createLOBEngineState(
  arenaId: string,
  agentIds: string[],
  startingCash: number,
  startPrice = 1000,
): LOBEngineState {
  const agentStats: Record<string, LOBAgentStats> = {};
  for (const id of agentIds) {
    agentStats[id] = { inventory: 0, cash: startingCash, pnl: startingCash };
  }
  const lobState: LOBState = {
    arenaId,
    roundNumber: 1,
    tickNumber: 0,
    midPrice: startPrice,
    spread: 0,
    bids: [],
    asks: [],
    recentTrades: [],
    agentStats,
    isFinished: false,
  };
  return {
    lobState,
    book: createBook(),
    gbm: createGBMState(startPrice),
    lastMidPrice: startPrice,
  };
}

export function processTick(
  engineState: LOBEngineState,
  actions: Record<string, LOBAction>, // agentId -> action
): LOBEngineState {
  let { lobState, book, gbm, lastMidPrice } = engineState;

  // Advance GBM price
  const { state: newGbm, newPrice } = tickGBM(gbm);
  gbm = newGbm;
  lastMidPrice = newPrice;

  const allTrades: LOBTrade[] = [];

  // Process each agent's action
  for (const [agentId, action] of Object.entries(actions)) {
    if (action.type === 'pass') continue;

    if (action.type === 'cancel' && action.orderId) {
      book = cancelOrder(book, action.orderId);
      continue;
    }

    if (
      (action.type === 'post_bid' || action.type === 'post_ask') &&
      action.price != null &&
      action.qty != null
    ) {
      const order: LOBOrder = {
        id: crypto.randomUUID(),
        agentId,
        side: action.type === 'post_bid' ? 'bid' : 'ask',
        price: action.price,
        qty: action.qty,
        ts: Date.now(),
      };
      const result = addOrder(book, order);
      book = result.book;

      // Update agent stats for each trade
      for (const trade of result.trades) {
        allTrades.push(trade);
        const buyerStats = lobState.agentStats[trade.buyerId];
        const sellerStats = lobState.agentStats[trade.sellerId];
        if (buyerStats) {
          lobState = {
            ...lobState,
            agentStats: {
              ...lobState.agentStats,
              [trade.buyerId]: updateStatsAfterTrade(buyerStats, 'buy', trade.price, trade.qty),
            },
          };
        }
        if (sellerStats) {
          lobState = {
            ...lobState,
            agentStats: {
              ...lobState.agentStats,
              [trade.sellerId]: updateStatsAfterTrade(sellerStats, 'sell', trade.price, trade.qty),
            },
          };
        }
      }
    }
  }

  // Mark to market all agents
  const updatedStats: Record<string, LOBAgentStats> = {};
  for (const [id, stats] of Object.entries(lobState.agentStats)) {
    updatedStats[id] = markToMarket(stats, lastMidPrice);
  }

  const newTickNumber = lobState.tickNumber + 1;

  const newLobState: LOBState = {
    ...lobState,
    tickNumber: newTickNumber,
    midPrice: lastMidPrice,
    spread: getSpread(book),
    bids: getTopLevels(book.bids),
    asks: getTopLevels(book.asks),
    recentTrades: allTrades.slice(-20), // keep last 20 trades
    agentStats: updatedStats,
  };

  return { lobState: newLobState, book, gbm, lastMidPrice };
}
