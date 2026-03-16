import { randomUUID } from 'crypto';
import type {
  AgentActionSubmission,
  AgentArenaEvent,
  AgentRuntimeSnapshot,
  AgentTurnRequest,
  GameState,
  PlayerAction,
} from '@agon/types';
import {
  clearAgentPendingTurn,
  clearAgentRuntimeSnapshot,
  getAgentPendingTurn,
  getAgentRuntimeSnapshot,
  setAgentPendingTurn,
  setAgentRuntimeSnapshot,
  submitAgentPendingTurn,
} from './redis.js';
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
  deadlineMs: number;
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
}

export async function waitForSubmittedTurn(
  arenaId: string,
  agentId: string,
  turnId: string,
  timeoutMs: number,
): Promise<AgentActionSubmission | null> {
  const deadlineMs = Date.now() + timeoutMs;

  while (Date.now() < deadlineMs) {
    const turn = await getAgentPendingTurn(arenaId, agentId);
    if (!turn) return null;
    if (turn.turnId !== turnId) return null;
    if (turn.status === 'submitted' && turn.submittedAction) {
      return turn.submittedAction;
    }
    await sleep(TURN_POLL_INTERVAL_MS);
  }

  return null;
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

  if (Date.now() > pending.deadlineMs) {
    return { ok: false, status: 410, error: 'This turn has already expired' };
  }

  if (!pending.validActions.includes(submission.action)) {
    return { ok: false, status: 400, error: 'Action is not valid for the current turn' };
  }

  if (submission.action === 'raise') {
    if (!Number.isInteger(submission.amount)) {
      return { ok: false, status: 400, error: 'Raise actions require an integer amount' };
    }
    if ((submission.amount ?? 0) < pending.minRaise || (submission.amount ?? 0) > pending.maxRaise) {
      return { ok: false, status: 400, error: 'Raise amount is outside the allowed range' };
    }
  }

  await submitAgentPendingTurn(arenaId, submission.agentId, submission);
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
