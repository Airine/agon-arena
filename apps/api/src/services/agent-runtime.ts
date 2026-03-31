import { randomUUID } from 'crypto';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type {
  AgentActionSubmission,
  AgentArenaEvent,
  AgentRuntimeSnapshot,
  AgentTurnRequest,
  GameState,
  LOBAction,
  LOBTurnRequest,
  PlayerAction,
} from '@agon/types';
import {
  clearAgentPendingTurn,
  clearAgentRuntimeSnapshot,
  getAgentPendingTurn,
  getAgentRuntimeSnapshot,
  setAgentLastProcessedTurnId,
  setAgentPendingTurn,
  setAgentRuntimeSnapshot,
  submitAgentPendingTurn,
} from './redis.js';
import { db, schema } from '../db/index.js';
import { getIO } from './io.js';

const TURN_POLL_INTERVAL_MS = 100;

export function getAgentRuntimeRoom(agentId: string, arenaId: string): string {
  return `agent:${agentId}:arena:${arenaId}`;
}

export function createPrivateView(state: GameState, agentId: string): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      cards: player.agentId === agentId ? player.cards : [],
    })),
  };
}

export function createSpectatorView(state: GameState): GameState {
  const isShowdown = state.stage === 'showdown' || state.stage === 'finished';
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      cards: isShowdown && !player.isFolded ? player.cards : [],
    })),
  };
}

export function getCallAmount(state: GameState): number {
  if (state.currentActorIndex === null) return 0;
  const actor = state.players[state.currentActorIndex];
  if (!actor) return 0;
  const maxBet = Math.max(...state.players.map((player) => player.bet));
  return Math.max(0, maxBet - actor.bet);
}

export function getMaxRaise(state: GameState): number {
  if (state.currentActorIndex === null) return 0;
  const actor = state.players[state.currentActorIndex];
  if (!actor) return 0;
  return Math.max(0, actor.stack - getCallAmount(state));
}

export async function publishRuntimeSnapshot(
  arenaId: string,
  state: GameState,
): Promise<void> {
  const publicState = createSpectatorView(state);
  await Promise.all(
    state.players.map(async (player) => {
      const snapshot: AgentRuntimeSnapshot = {
        arenaId,
        agentId: player.agentId,
        handId: state.handId,
        handNumber: state.handNumber,
        publicState,
        privateState: createPrivateView(state, player.agentId),
        pendingTurn: await getPendingTurnView(arenaId, player.agentId),
        updatedAt: Date.now(),
      };
      await setAgentRuntimeSnapshot(snapshot);
      getIO().to(getAgentRuntimeRoom(player.agentId, arenaId)).emit('agent:runtime_snapshot', snapshot);
    }),
  );
}

export async function emitArenaEvent(
  arenaId: string,
  agentIds: string[],
  event: Omit<AgentArenaEvent, 'updatedAt' | 'arenaId'>,
): Promise<void> {
  const payload: AgentArenaEvent = {
    ...event,
    arenaId,
    updatedAt: Date.now(),
  };

  for (const agentId of agentIds) {
    getIO().to(getAgentRuntimeRoom(agentId, arenaId)).emit('agent:arena_event', payload);
  }
}

export async function createTurnRequest(input: {
  arenaId: string;
  handId: string;
  handNumber: number;
  agentId: string;
  validActions: PlayerAction['type'][];
  deadlineMs: number | null;
  state: GameState;
}): Promise<AgentTurnRequest> {
  return {
    turnId: randomUUID(),
    arenaId: input.arenaId,
    handId: input.handId,
    handNumber: input.handNumber,
    agentId: input.agentId,
    validActions: input.validActions,
    deadlineMs: input.deadlineMs,
    callAmount: getCallAmount(input.state),
    minRaise: input.state.minRaise,
    maxRaise: getMaxRaise(input.state),
    state: createPrivateView(input.state, input.agentId),
    submitPath: `/arenas/${input.arenaId}/actions`,
  };
}

export async function publishTurnRequest(turn: AgentTurnRequest): Promise<void> {
  await setAgentPendingTurn(turn);

  const snapshot = await getAgentRuntimeSnapshot(turn.arenaId, turn.agentId);
  if (snapshot) {
    const nextSnapshot: AgentRuntimeSnapshot = {
      ...snapshot,
      pendingTurn: turn,
      updatedAt: Date.now(),
    };
    await setAgentRuntimeSnapshot(nextSnapshot);
    getIO().to(getAgentRuntimeRoom(turn.agentId, turn.arenaId)).emit('agent:runtime_snapshot', nextSnapshot);
  }

  getIO().to(getAgentRuntimeRoom(turn.agentId, turn.arenaId)).emit('agent:turn_request', turn);

  // Fire-and-forget: insert turn log row (action=null until agent responds)
  db.insert(schema.arenaTurnLog).values({
    arenaId: turn.arenaId,
    agentId: turn.agentId,
    turnId: turn.turnId,
    turnNumber: turn.handNumber,
    state: turn.state as unknown as Record<string, unknown>,
    action: null,
    latencyMs: null,
  }).catch(err => console.error('[TurnLog] insert failed', err));

  // Fire-and-forget: enforce max 200 rows per arena
  db.delete(schema.arenaTurnLog)
    .where(and(
      eq(schema.arenaTurnLog.arenaId, turn.arenaId),
      notInArray(
        schema.arenaTurnLog.id,
        db.select({ id: schema.arenaTurnLog.id })
          .from(schema.arenaTurnLog)
          .where(eq(schema.arenaTurnLog.arenaId, turn.arenaId))
          .orderBy(desc(schema.arenaTurnLog.createdAt))
          .limit(200)
      )
    ))
    .catch(() => {});
}

export async function waitForSubmittedTurn(
  arenaId: string,
  agentId: string,
  turnId: string,
  options?: {
    onHeartbeat?: () => Promise<void> | void;
  },
): Promise<AgentActionSubmission | null> {
  let lastHeartbeatAt = 0;
  const startedAt = Date.now();

  while (true) {
    if (options?.onHeartbeat && Date.now() - lastHeartbeatAt >= 1_000) {
      await options.onHeartbeat();
      lastHeartbeatAt = Date.now();
    }

    const turn = await getAgentPendingTurn(arenaId, agentId);
    if (!turn) {
      // Timeout: no pending turn found — log error
      db.insert(schema.agentErrorLog).values({
        arenaId,
        agentId,
        turnId,
        errorType: 'timeout',
        details: null,
      }).catch(err => console.error('[TurnLog] agentErrorLog insert failed', err));
      return null;
    }
    if (turn.turnId !== turnId) {
      // Stale turn — treat as timeout
      db.insert(schema.agentErrorLog).values({
        arenaId,
        agentId,
        turnId,
        errorType: 'timeout',
        details: { reason: 'turnId_mismatch' } as unknown as Record<string, unknown>,
      }).catch(err => console.error('[TurnLog] agentErrorLog insert failed', err));
      return null;
    }
    if (turn.status === 'submitted' && turn.submittedAction) {
      const latencyMs = Date.now() - startedAt;
      // Fire-and-forget: update turn log with action + latency
      db.update(schema.arenaTurnLog)
        .set({
          action: turn.submittedAction as unknown as Record<string, unknown>,
          latencyMs,
        })
        .where(and(
          eq(schema.arenaTurnLog.arenaId, arenaId),
          eq(schema.arenaTurnLog.agentId, agentId),
          eq(schema.arenaTurnLog.turnId, turnId),
        ))
        .catch(err => console.error('[TurnLog] update failed', err));
      return turn.submittedAction;
    }
    await sleep(TURN_POLL_INTERVAL_MS);
  }
}

export async function acceptSubmittedTurn(
  submission: AgentActionSubmission,
  arenaId: string,
): Promise<{
  ok: true;
  turn: AgentTurnRequest;
} | {
  ok: false;
  status: number;
  error: string;
}> {
  const pending = await getAgentPendingTurn(arenaId, submission.agentId);
  if (!pending) {
    return { ok: false, status: 404, error: 'No pending turn found for this agent' };
  }

  if (pending.turnId !== submission.turnId) {
    return { ok: false, status: 409, error: 'turnId does not match the current pending turn' };
  }

  if (pending.status !== 'pending') {
    return { ok: false, status: 409, error: 'This turn has already been submitted' };
  }

  if (pending.deadlineMs !== null && Date.now() > pending.deadlineMs) {
    return { ok: false, status: 410, error: 'This turn has already expired' };
  }

  if (!pending.validActions.includes(submission.action)) {
    db.insert(schema.agentErrorLog).values({
      arenaId,
      agentId: submission.agentId,
      turnId: submission.turnId,
      errorType: 'invalid_action',
      details: { error: 'Action is not valid for the current turn', action: submission.action } as unknown as Record<string, unknown>,
    }).catch(err => console.error('[TurnLog] agentErrorLog insert failed', err));
    return { ok: false, status: 400, error: 'Action is not valid for the current turn' };
  }

  if (submission.action === 'raise') {
    if (!Number.isInteger(submission.amount)) {
      db.insert(schema.agentErrorLog).values({
        arenaId,
        agentId: submission.agentId,
        turnId: submission.turnId,
        errorType: 'invalid_action',
        details: { error: 'Raise actions require an integer amount', amount: submission.amount } as unknown as Record<string, unknown>,
      }).catch(err => console.error('[TurnLog] agentErrorLog insert failed', err));
      return { ok: false, status: 400, error: 'Raise actions require an integer amount' };
    }
    if ((submission.amount ?? 0) < pending.minRaise || (submission.amount ?? 0) > pending.maxRaise) {
      db.insert(schema.agentErrorLog).values({
        arenaId,
        agentId: submission.agentId,
        turnId: submission.turnId,
        errorType: 'invalid_action',
        details: { error: 'Raise amount is outside the allowed range', amount: submission.amount, minRaise: pending.minRaise, maxRaise: pending.maxRaise } as unknown as Record<string, unknown>,
      }).catch(err => console.error('[TurnLog] agentErrorLog insert failed', err));
      return { ok: false, status: 400, error: 'Raise amount is outside the allowed range' };
    }
  }

  await submitAgentPendingTurn(arenaId, submission.agentId, submission);
  // Write to Redis (fast path) and DB (durable fallback for crash recovery)
  await setAgentLastProcessedTurnId(arenaId, submission.agentId, submission.turnId);
  await db
    .update(schema.arenaSeats)
    .set({ lastProcessedTurnId: submission.turnId })
    .where(and(
      eq(schema.arenaSeats.arenaId, arenaId),
      eq(schema.arenaSeats.agentId, submission.agentId),
      eq(schema.arenaSeats.isActive, true),
    ));
  return { ok: true, turn: pending };
}

export async function clearAgentRuntime(arenaId: string, agentId: string): Promise<void> {
  await Promise.all([
    clearAgentPendingTurn(arenaId, agentId),
    clearAgentRuntimeSnapshot(arenaId, agentId),
  ]);
}

async function getPendingTurnView(arenaId: string, agentId: string): Promise<AgentTurnRequest | null> {
  const pending = await getAgentPendingTurn(arenaId, agentId);
  if (!pending || pending.status !== 'pending') {
    return null;
  }
  const { status: _status, createdAt: _createdAt, submittedAction: _submittedAction, submittedAt: _submittedAt, ...turn } = pending;
  return turn;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// LOB turn protocol
// ---------------------------------------------------------------------------

const LOB_TURN_REQUEST_PREFIX = 'lob:turn-request:';
const LOB_TURN_REQUEST_TTL_SECONDS = 30;
const LOB_PENDING_PREFIX = 'lob:pending:';

/**
 * Publish a LOB turn request for an agent.
 * Stores the request in Redis at lob:turn-request:<arenaId>:<agentId> (30s TTL)
 * and emits agent:lob_turn_request to the arena room.
 */
export async function publishLOBTurnRequest(
  arenaId: string,
  agentId: string,
  turnRequest: LOBTurnRequest,
): Promise<void> {
  const { getRedisClient } = await import('./redis.js');
  const redis = await getRedisClient();
  await redis.set(
    `${LOB_TURN_REQUEST_PREFIX}${arenaId}:${agentId}`,
    JSON.stringify(turnRequest),
    { EX: LOB_TURN_REQUEST_TTL_SECONDS },
  );

  getIO().to(`arena:${arenaId}`).emit('agent:lob_turn_request', turnRequest);
  getIO().to(getAgentRuntimeRoom(agentId, arenaId)).emit('agent:lob_turn_request', turnRequest);
}

/**
 * Poll for a LOB action submission from an agent.
 * Polls Redis key lob:pending:<arenaId>:<agentId> every 100ms until deadlineMs.
 * Returns the LOBAction if the turnId matches, or null on timeout.
 */
export async function waitForLOBSubmission(
  arenaId: string,
  agentId: string,
  turnId: string,
  deadlineMs: number,
): Promise<LOBAction | null> {
  const { getRedisClient } = await import('./redis.js');
  const key = `${LOB_PENDING_PREFIX}${arenaId}:${agentId}`;
  const redis = await getRedisClient();

  while (Date.now() < deadlineMs) {
    const val = await redis.get(key);
    if (val) {
      try {
        const stored = JSON.parse(val) as { turnId: string; action: LOBAction };
        if (stored.turnId === turnId) {
          // Consume the pending action
          await redis.del(key);
          return stored.action;
        }
      } catch { /* skip malformed */ }
    }
    await sleep(TURN_POLL_INTERVAL_MS);
  }

  return null;
}
