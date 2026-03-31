import { eq, and } from 'drizzle-orm';
import type { LOBAction, LOBTrade, LOBTurnRequest } from '@agon/types';
import {
  createLOBEngineState,
  processTick,
  settleAgent,
  type LOBEngineState,
} from '../game/lob/index.js';
import { db, schema } from '../db/index.js';
import { getIO } from './io.js';
import { getRedisClient } from './redis.js';
import { publishLOBTurnRequest, waitForLOBSubmission } from './agent-runtime.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface LOBAgentSeat {
  agentId: string;
  userId: string;
  seatIndex: number;
}

export interface LOBGameOptions {
  tickIntervalMs?: number;
  numTicks?: number;
  startingCash?: number;
  startPrice?: number;
}

/**
 * Start the LOB game loop for an arena. Runs asynchronously (fire-and-forget).
 */
export function startLOBGame(
  arenaId: string,
  agentSeats: LOBAgentSeat[],
  options: LOBGameOptions = {},
): void {
  runLOBGameLoop(arenaId, agentSeats, options).catch((err) => {
    console.error(`[LOBOrchestrator] Arena ${arenaId} game loop crashed:`, err);
    db.update(schema.arenas)
      .set({ status: 'finished', finishedAt: new Date() })
      .where(eq(schema.arenas.id, arenaId))
      .catch(() => {});
  });
}

async function runLOBGameLoop(
  arenaId: string,
  agentSeats: LOBAgentSeat[],
  options: LOBGameOptions,
): Promise<void> {
  const TICK_INTERVAL = options.tickIntervalMs ?? 1000;
  const NUM_TICKS = options.numTicks ?? 200;
  const startingCash = options.startingCash ?? 10_000;
  const startPrice = options.startPrice ?? 1000;

  const agentIds = agentSeats.map((s) => s.agentId);

  // 1. Initialize engine state
  let engineState: LOBEngineState = createLOBEngineState(arenaId, agentIds, startingCash, startPrice);

  // 2. Emit lob:started (arena status already set to 'running' by the /start route)
  getIO().to(`arena:${arenaId}`).emit('lob:started', {
    arenaId,
    lobState: engineState.lobState,
  });

  // 4. Tick loop
  for (let tick = 0; tick < NUM_TICKS; tick++) {
    const tickStart = Date.now();
    const deadline = tickStart + TICK_INTERVAL - 50; // 50ms processing buffer

    // Build turn requests for all agents
    const turnRequests = agentSeats.map((seat) => {
      const turnId = crypto.randomUUID();
      const req: LOBTurnRequest = {
        turnId,
        arenaId,
        roundNumber: 1,
        tickNumber: tick,
        agentId: seat.agentId,
        midPrice: engineState.lobState.midPrice,
        spread: engineState.lobState.spread,
        myOrders: engineState.lobState.bids
          .concat(engineState.lobState.asks)
          .filter((o) => o.agentId === seat.agentId),
        myStats: engineState.lobState.agentStats[seat.agentId] ?? {
          inventory: 0,
          cash: startingCash,
          pnl: startingCash,
        },
        bids: engineState.lobState.bids.slice(0, 10),
        asks: engineState.lobState.asks.slice(0, 10),
        recentTrades: engineState.lobState.recentTrades,
        validActions: ['post_bid', 'post_ask', 'cancel', 'pass'],
        deadlineMs: deadline,
        submitPath: `/arenas/${arenaId}/lob-actions`,
      };
      return { seat, turnId, req };
    });

    // Publish all turn requests in parallel
    await Promise.all(
      turnRequests.map(({ seat, req }) => publishLOBTurnRequest(arenaId, seat.agentId, req)),
    );

    // Wait for all submissions in parallel (shared deadline)
    const submissions = await Promise.all(
      turnRequests.map(({ seat, turnId }) =>
        waitForLOBSubmission(arenaId, seat.agentId, turnId, deadline),
      ),
    );

    // Build actions map (null → pass)
    const actions: Record<string, LOBAction> = {};
    for (let i = 0; i < agentSeats.length; i++) {
      actions[agentSeats[i]!.agentId] = submissions[i] ?? { type: 'pass' };
    }

    // Process tick
    engineState = processTick(engineState, actions);

    // Log submitted orders to lob_order_log (fire-and-forget)
    for (const { seat, req } of turnRequests) {
      const action = actions[seat.agentId];
      if (action && (action.type === 'post_bid' || action.type === 'post_ask') && action.price && action.qty) {
        db.insert(schema.lobOrderLog).values({
          arenaId,
          roundNumber: 1,
          tickNumber: tick,
          agentId: seat.agentId,
          side: action.type === 'post_bid' ? 'bid' : 'ask',
          price: action.price,
          qty: action.qty,
          orderId: crypto.randomUUID(),
        }).catch(() => {});
      }
    }

    // Persist lastMidPrice to Redis for crash recovery
    const redis = await getRedisClient();
    await redis.set(
      `lob:midprice:${arenaId}`,
      engineState.lastMidPrice.toString(),
      { EX: 86400 },
    );

    // Log trades to DB (fire-and-forget)
    if (engineState.lobState.recentTrades.length > 0) {
      logTrades(arenaId, tick, engineState.lobState.recentTrades).catch(console.error);
    }

    // Emit tick update to spectators
    getIO().to(`arena:${arenaId}`).emit('lob:tick', {
      arenaId,
      tickNumber: tick,
      lobState: engineState.lobState,
    });

    // Sleep until next tick
    const elapsed = Date.now() - tickStart;
    const remaining = TICK_INTERVAL - elapsed;
    if (remaining > 0) await sleep(remaining);
  }

  // 5. Settlement
  const redis = await getRedisClient();
  const storedMidPrice = await redis.get(`lob:midprice:${arenaId}`);
  const lastMidPrice = storedMidPrice
    ? (parseFloat(storedMidPrice) || engineState.lastMidPrice)
    : engineState.lastMidPrice;

  const standings: Array<{ agentId: string; userId: string; finalCash: number; chipDelta: number }> = [];

  for (const seat of agentSeats) {
    const stats = engineState.lobState.agentStats[seat.agentId];
    if (!stats) continue;

    const settled = settleAgent(stats, lastMidPrice);
    const chipDelta = Math.round(settled.cash - startingCash);

    standings.push({
      agentId: seat.agentId,
      userId: seat.userId,
      finalCash: settled.cash,
      chipDelta,
    });

    // Update arena seat current_stack (filter by both arenaId + agentId — agent may be in multiple arenas)
    await db
      .update(schema.arenaSeats)
      .set({ currentStack: Math.max(0, Math.round(settled.cash)) })
      .where(and(eq(schema.arenaSeats.arenaId, arenaId), eq(schema.arenaSeats.agentId, seat.agentId)));
  }

  // 6. Mark arena finished
  await db
    .update(schema.arenas)
    .set({ status: 'finished', finishedAt: new Date() })
    .where(eq(schema.arenas.id, arenaId));

  // 7. Emit lob:finished
  getIO().to(`arena:${arenaId}`).emit('lob:finished', {
    arenaId,
    standings,
    lastMidPrice,
  });

  console.log(`[LOBOrchestrator] Arena ${arenaId} finished. Standings:`, standings);
}

async function logTrades(arenaId: string, tickNumber: number, trades: LOBTrade[]): Promise<void> {
  if (trades.length === 0) return;
  await db.insert(schema.lobTradeLog).values(
    trades.map((t) => ({
      arenaId,
      roundNumber: 1,
      tickNumber,
      buyerId: t.buyerId,
      sellerId: t.sellerId,
      price: t.price,
      qty: t.qty,
      createdAt: new Date(t.ts),
    })),
  );
}
