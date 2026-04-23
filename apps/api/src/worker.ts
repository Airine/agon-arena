/**
 * Arena game-loop worker.
 *
 * Run as a separate process alongside the main API:
 *   node dist/worker.js
 *
 * Each worker pulls arena assignments from Redis (BLPOP arena:assign),
 * registers ownership, and runs runGameLoop() in-process.
 * Game events are delivered to spectators via the Socket.IO Redis adapter,
 * so no HTTP affinity between workers and the main API is needed.
 */
import 'dotenv/config';
import './env.js';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { setIO } from './services/io.js';
import { getRedisClient } from './services/redis.js';
import { runGameLoop } from './services/orchestrator.js';
import { dequeueArena, registerArenaOwner, removeArenaOwner } from './lib/arena-queue.js';
import { childLogger } from './lib/logger.js';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { clearArenaLoopHeartbeat } from './services/redis.js';

const WORKER_MAX_ARENAS = Number(process.env['WORKER_MAX_ARENAS'] ?? 25);
const workerId = `worker:${process.pid}`;
const log = childLogger({ workerId });

async function main(): Promise<void> {
  log.info(`[Worker] Starting — max ${WORKER_MAX_ARENAS} concurrent arenas`);

  // Headless Socket.IO instance — no HTTP binding, only the Redis adapter.
  // emit() calls from runGameLoop reach the main API's Socket.IO via pub/sub,
  // which then forwards events to connected WebSocket clients.
  const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const pubClient = createClient({ url: REDIS_URL });
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => log.error({ err }, '[Worker] Redis pub error'));
  subClient.on('error', (err) => log.error({ err }, '[Worker] Redis sub error'));

  await Promise.all([pubClient.connect(), subClient.connect()]);

  const io = new SocketIOServer();
  io.adapter(createAdapter(pubClient, subClient));
  setIO(io);

  log.info('[Worker] Socket.IO Redis adapter attached');

  let activeArenas = 0;

  // BLPOP loop — blocks up to 1s waiting for a new arena assignment.
  while (true) {
    if (activeArenas >= WORKER_MAX_ARENAS) {
      await sleep(500);
      continue;
    }

    const payload = await dequeueArena(1);
    if (!payload) continue;

    const { arenaId, arena, seats, resumeFromHandNumber } = payload;
    activeArenas++;

    await registerArenaOwner(arenaId, workerId);
    log.info({ arenaId, resumeFromHandNumber }, '[Worker] Dequeued arena — starting game loop');

    runGameLoop(arenaId, arena, seats, { resumeFromHandNumber })
      .catch(async (err) => {
        log.error({ arenaId, err }, '[Worker] Game loop crashed — marking arena finished');
        await clearArenaLoopHeartbeat(arenaId).catch(() => {});
        await db
          .update(schema.arenas)
          .set({ status: 'finished', finishedAt: new Date() })
          .where(eq(schema.arenas.id, arenaId))
          .catch(() => {});
      })
      .finally(async () => {
        activeArenas--;
        await removeArenaOwner(arenaId).catch(() => {});
      });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[Worker] Fatal startup error:', err);
  process.exit(1);
});
