import { and, desc, eq } from 'drizzle-orm';
import type { GameState } from '@agon/types';
import { db, schema } from '../db/index.js';
import {
  clearGameSnapshot,
  getArenaLoopHeartbeat,
  getAgentPendingTurn,
  getGameSnapshot,
  setGameSnapshot,
  type ArenaSnapshot,
} from './redis.js';

const ORPHANED_RUNNING_ARENA_TIMEOUT_MS = 15_000;

interface ArenaRowLike {
  id: string;
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  currentHandNumber: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

function asGameState(value: unknown): GameState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<GameState>;
  if (
    typeof candidate.arenaId !== 'string' ||
    typeof candidate.handId !== 'string' ||
    typeof candidate.handNumber !== 'number' ||
    typeof candidate.stage !== 'string' ||
    !Array.isArray(candidate.players) ||
    !Array.isArray(candidate.communityCards) ||
    !Array.isArray(candidate.pots)
  ) {
    return null;
  }

  return candidate as GameState;
}

export async function maybeFinalizeOrphanedRunningArena<T extends ArenaRowLike>(arena: T): Promise<T> {
  if (arena.status !== 'running') {
    return arena;
  }

  const liveSnapshot = await getGameSnapshot(arena.id);

  const [latestHand] = await db
    .select({
      handNumber: schema.gameHands.handNumber,
      stage: schema.gameHands.stage,
      stateSnapshot: schema.gameHands.stateSnapshot,
      startedAt: schema.gameHands.startedAt,
      endedAt: schema.gameHands.endedAt,
    })
    .from(schema.gameHands)
    .where(eq(schema.gameHands.arenaId, arena.id))
    .orderBy(desc(schema.gameHands.handNumber))
    .limit(1);

  const seats = await db
    .select({ agentId: schema.arenaSeats.agentId })
    .from(schema.arenaSeats)
    .where(and(
      eq(schema.arenaSeats.arenaId, arena.id),
      eq(schema.arenaSeats.isActive, true),
    ));

  const pendingTurns = await Promise.all(
    seats.map((seat) => getAgentPendingTurn(arena.id, seat.agentId)),
  );

  const hasPendingTurn = pendingTurns.some(Boolean);
  const loopHeartbeatAt = await getArenaLoopHeartbeat(arena.id);
  const lastActivityCandidates = [
    latestHand?.endedAt?.getTime() ?? null,
    latestHand?.startedAt?.getTime() ?? null,
    loopHeartbeatAt,
    liveSnapshot?.updatedAt ?? null,
    arena.startedAt?.getTime() ?? null,
  ].filter((value): value is number => value !== null);
  const lastActivityAt = lastActivityCandidates.length > 0
    ? new Date(Math.max(...lastActivityCandidates))
    : null;
  if (!lastActivityAt) {
    return arena;
  }
  const isStale = Date.now() - lastActivityAt.getTime() > ORPHANED_RUNNING_ARENA_TIMEOUT_MS;

  if (!hasPendingTurn && isStale) {
    if (liveSnapshot) {
      await clearGameSnapshot(arena.id);
    }

    const finishedAt = new Date();
    await db
      .update(schema.arenas)
      .set({ status: 'finished', finishedAt })
      .where(eq(schema.arenas.id, arena.id));

    return {
      ...arena,
      status: 'finished',
      finishedAt,
    } as T;
  }

  if (liveSnapshot) {
    return arena;
  }

  return arena;
}

export async function buildFallbackArenaSnapshot(arenaId: string): Promise<ArenaSnapshot | null> {
  const [hand] = await db
    .select({
      handNumber: schema.gameHands.handNumber,
      stage: schema.gameHands.stage,
      stateSnapshot: schema.gameHands.stateSnapshot,
      startedAt: schema.gameHands.startedAt,
      endedAt: schema.gameHands.endedAt,
    })
    .from(schema.gameHands)
    .where(and(
      eq(schema.gameHands.arenaId, arenaId),
      eq(schema.gameHands.stage, 'finished'),
    ))
    .orderBy(desc(schema.gameHands.handNumber))
    .limit(1);

  const gameState = asGameState(hand?.stateSnapshot);
  if (!hand || !gameState) {
    return null;
  }

  const snapshot: ArenaSnapshot = {
    arenaId,
    gameState,
    handNumber: hand.handNumber,
    updatedAt: (hand.endedAt ?? hand.startedAt).getTime(),
  };

  await setGameSnapshot(arenaId, snapshot);
  return snapshot;
}

export async function getResolvedArenaSnapshot<T extends ArenaRowLike>(arena: T): Promise<{
  arena: T;
  snapshot: ArenaSnapshot | null;
}> {
  const reconciledArena = await maybeFinalizeOrphanedRunningArena(arena);
  const liveSnapshot = await getGameSnapshot(reconciledArena.id);
  if (liveSnapshot) {
    return { arena: reconciledArena, snapshot: liveSnapshot };
  }

  if (reconciledArena.status !== 'finished') {
    return { arena: reconciledArena, snapshot: null };
  }

  const fallback = await buildFallbackArenaSnapshot(reconciledArena.id);
  return { arena: reconciledArena, snapshot: fallback };
}

export async function reconcileRunningArenasOnStartup(): Promise<void> {
  const runningArenas = await db
    .select({
      id: schema.arenas.id,
      status: schema.arenas.status,
      currentHandNumber: schema.arenas.currentHandNumber,
      startedAt: schema.arenas.startedAt,
      finishedAt: schema.arenas.finishedAt,
    })
    .from(schema.arenas)
    .where(eq(schema.arenas.status, 'running'));

  for (const arena of runningArenas) {
    await maybeFinalizeOrphanedRunningArena(arena);
  }
}
