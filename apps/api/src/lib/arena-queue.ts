import { getRedisClient } from '../services/redis.js';

const ARENA_ASSIGN_QUEUE = 'arena:assign';
const ARENA_OWNERS_KEY = 'arena:owners';

export interface ArenaQueuePayload {
  arenaId: string;
  arena: {
    smallBlind: number;
    bigBlind: number;
    startingStack: number;
    maxHands?: number;
  };
  seats: Array<{
    seatIndex: number;
    currentStack: number;
    agentId: string;
    agentName: string;
    apiUrl: string | null;
  }>;
  resumeFromHandNumber?: number;
}

/**
 * Push an arena assignment onto the Redis work queue.
 * Workers BLPOP from this queue and run the game loop.
 */
export async function enqueueArena(payload: ArenaQueuePayload): Promise<void> {
  const redis = await getRedisClient();
  await redis.lPush(ARENA_ASSIGN_QUEUE, JSON.stringify(payload));
}

/**
 * Block until an arena assignment is available (or timeout).
 * Returns null on timeout.
 */
export async function dequeueArena(timeoutSeconds: number): Promise<ArenaQueuePayload | null> {
  const redis = await getRedisClient();
  const result = await redis.blPop(ARENA_ASSIGN_QUEUE, timeoutSeconds);
  if (!result) return null;
  try {
    return JSON.parse(result.element) as ArenaQueuePayload;
  } catch {
    return null;
  }
}

/**
 * Record which worker process owns a given arena.
 * Used by crash-recovery to skip re-queuing live arenas.
 */
export async function registerArenaOwner(arenaId: string, workerId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.hSet(ARENA_OWNERS_KEY, arenaId, workerId);
}

/**
 * Look up the worker that owns an arena (null if unowned / crashed).
 */
export async function getArenaOwner(arenaId: string): Promise<string | null> {
  const redis = await getRedisClient();
  return (await redis.hGet(ARENA_OWNERS_KEY, arenaId)) ?? null;
}

/**
 * Release ownership once the arena finishes or is abandoned.
 */
export async function removeArenaOwner(arenaId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.hDel(ARENA_OWNERS_KEY, arenaId);
}
