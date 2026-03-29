import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTurnRequest, GameState } from '@agon/types';

const {
  mockClearAgentPendingTurn,
  mockClearAgentRuntimeSnapshot,
  mockGetAgentPendingTurn,
  mockGetAgentRuntimeSnapshot,
  mockSetAgentLastProcessedTurnId,
  mockSetAgentPendingTurn,
  mockSetAgentRuntimeSnapshot,
  mockSubmitAgentPendingTurn,
  mockEmit,
  mockTo,
} = vi.hoisted(() => {
  const mockClearAgentPendingTurn = vi.fn();
  const mockClearAgentRuntimeSnapshot = vi.fn();
  const mockGetAgentPendingTurn = vi.fn();
  const mockGetAgentRuntimeSnapshot = vi.fn();
  const mockSetAgentLastProcessedTurnId = vi.fn().mockResolvedValue(undefined);
  const mockSetAgentPendingTurn = vi.fn();
  const mockSetAgentRuntimeSnapshot = vi.fn();
  const mockSubmitAgentPendingTurn = vi.fn();
  const mockEmit = vi.fn();
  const mockTo = vi.fn(() => ({ emit: mockEmit }));

  return {
    mockClearAgentPendingTurn,
    mockClearAgentRuntimeSnapshot,
    mockGetAgentPendingTurn,
    mockGetAgentRuntimeSnapshot,
    mockSetAgentLastProcessedTurnId,
    mockSetAgentPendingTurn,
    mockSetAgentRuntimeSnapshot,
    mockSubmitAgentPendingTurn,
    mockEmit,
    mockTo,
  };
});

vi.mock('../redis.js', () => ({
  clearAgentPendingTurn: mockClearAgentPendingTurn,
  clearAgentRuntimeSnapshot: mockClearAgentRuntimeSnapshot,
  getAgentPendingTurn: mockGetAgentPendingTurn,
  getAgentRuntimeSnapshot: mockGetAgentRuntimeSnapshot,
  setAgentLastProcessedTurnId: mockSetAgentLastProcessedTurnId,
  setAgentPendingTurn: mockSetAgentPendingTurn,
  setAgentRuntimeSnapshot: mockSetAgentRuntimeSnapshot,
  submitAgentPendingTurn: mockSubmitAgentPendingTurn,
}));

vi.mock('../io.js', () => ({
  getIO: () => ({
    to: mockTo,
  }),
}));

import {
  acceptSubmittedTurn,
  createPrivateView,
  createSpectatorView,
  createTurnRequest,
  publishTurnRequest,
} from '../agent-runtime.js';

function makeState(stage: GameState['stage'] = 'pre_flop'): GameState {
  return {
    arenaId: 'arena-123',
    handId: 'hand-123',
    handNumber: 7,
    stage,
    players: [
      {
        agentId: 'agent-a',
        agentName: 'Alpha',
        position: 0,
        stack: 980,
        bet: 20,
        totalBet: 20,
        cards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'spades' },
        ],
        isActive: true,
        isFolded: false,
        isAllIn: false,
        hasActed: true,
      },
      {
        agentId: 'agent-b',
        agentName: 'Bravo',
        position: 1,
        stack: 990,
        bet: 10,
        totalBet: 10,
        cards: [
          { rank: 'Q', suit: 'hearts' },
          { rank: 'Q', suit: 'clubs' },
        ],
        isActive: true,
        isFolded: false,
        isAllIn: false,
        hasActed: false,
      },
    ],
    communityCards: [],
    pots: [{ amount: 30, eligiblePlayers: ['agent-a', 'agent-b'] }],
    currentActorIndex: 1,
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 1,
    smallBlindAmount: 10,
    bigBlindAmount: 20,
    minRaise: 40,
  };
}

describe('agent-runtime helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a private view that only reveals the acting agent cards', () => {
    const state = makeState();
    const privateView = createPrivateView(state, 'agent-b');

    expect(privateView.players[0]?.cards).toEqual([]);
    expect(privateView.players[1]?.cards).toEqual(state.players[1]?.cards);
  });

  it('creates a spectator view that hides hole cards before showdown', () => {
    const preflop = createSpectatorView(makeState('pre_flop'));
    const showdown = createSpectatorView(makeState('showdown'));

    expect(preflop.players.every((player) => player.cards.length === 0)).toBe(true);
    expect(showdown.players[0]?.cards).toHaveLength(2);
    expect(showdown.players[1]?.cards).toHaveLength(2);
  });

  it('creates turn requests with private state, call amount, and submit path', async () => {
    const turn = await createTurnRequest({
      arenaId: 'arena-123',
      handId: 'hand-123',
      handNumber: 7,
      agentId: 'agent-b',
      validActions: ['fold', 'call', 'raise'],
      deadlineMs: null,
      state: makeState(),
    });

    expect(turn.agentId).toBe('agent-b');
    expect(turn.callAmount).toBe(10);
    expect(turn.minRaise).toBe(40);
    expect(turn.maxRaise).toBe(980);
    expect(turn.submitPath).toBe('/arenas/arena-123/actions');
    expect(turn.state.players[0]?.cards).toEqual([]);
    expect(turn.state.players[1]?.cards).toHaveLength(2);
  });
});

describe('acceptSubmittedTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makePendingTurn(overrides: Partial<AgentTurnRequest & { deadlineMs: number | null }> = {}): AgentTurnRequest {
    return {
      turnId: 'turn-123',
      arenaId: 'arena-123',
      handId: 'hand-123',
      handNumber: 7,
      agentId: 'agent-b',
      validActions: ['fold', 'call', 'raise'],
      deadlineMs: null,
      callAmount: 10,
      minRaise: 40,
      maxRaise: 980,
      state: makeState(),
      submitPath: '/arenas/arena-123/actions',
      ...overrides,
    };
  }

  it('rejects when there is no pending turn', async () => {
    mockGetAgentPendingTurn.mockResolvedValueOnce(null);

    const result = await acceptSubmittedTurn(
      { agentId: 'agent-b', turnId: 'turn-123', action: 'call' },
      'arena-123',
    );

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'No pending turn found for this agent',
    });
  });

  it('rejects mismatched turn ids', async () => {
    mockGetAgentPendingTurn.mockResolvedValueOnce({
      ...makePendingTurn(),
      status: 'pending',
      createdAt: Date.now(),
    });

    const result = await acceptSubmittedTurn(
      { agentId: 'agent-b', turnId: 'turn-other', action: 'call' },
      'arena-123',
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'turnId does not match the current pending turn',
    });
  });

  it('rejects expired turns', async () => {
    mockGetAgentPendingTurn.mockResolvedValueOnce({
      ...makePendingTurn({ deadlineMs: Date.now() - 1 }),
      status: 'pending',
      createdAt: Date.now(),
    });

    const result = await acceptSubmittedTurn(
      { agentId: 'agent-b', turnId: 'turn-123', action: 'call' },
      'arena-123',
    );

    expect(result).toEqual({
      ok: false,
      status: 410,
      error: 'This turn has already expired',
    });
  });

  it('rejects invalid actions and raise amounts outside the allowed range', async () => {
    mockGetAgentPendingTurn.mockResolvedValueOnce({
      ...makePendingTurn(),
      status: 'pending',
      createdAt: Date.now(),
    });

    const invalidAction = await acceptSubmittedTurn(
      { agentId: 'agent-b', turnId: 'turn-123', action: 'check' },
      'arena-123',
    );

    expect(invalidAction).toEqual({
      ok: false,
      status: 400,
      error: 'Action is not valid for the current turn',
    });

    mockGetAgentPendingTurn.mockResolvedValueOnce({
      ...makePendingTurn(),
      status: 'pending',
      createdAt: Date.now(),
    });

    const invalidRaise = await acceptSubmittedTurn(
      { agentId: 'agent-b', turnId: 'turn-123', action: 'raise', amount: 10 },
      'arena-123',
    );

    expect(invalidRaise).toEqual({
      ok: false,
      status: 400,
      error: 'Raise amount is outside the allowed range',
    });
  });

  it('accepts a valid action submission', async () => {
    const pendingTurn = {
      ...makePendingTurn(),
      status: 'pending' as const,
      createdAt: Date.now(),
    };
    mockGetAgentPendingTurn.mockResolvedValueOnce(pendingTurn);
    mockSubmitAgentPendingTurn.mockResolvedValueOnce({
      ...pendingTurn,
      status: 'submitted',
      submittedAction: { agentId: 'agent-b', turnId: 'turn-123', action: 'call' },
      submittedAt: Date.now(),
    });

    const result = await acceptSubmittedTurn(
      { agentId: 'agent-b', turnId: 'turn-123', action: 'call' },
      'arena-123',
    );

    expect(mockSubmitAgentPendingTurn).toHaveBeenCalledWith(
      'arena-123',
      'agent-b',
      { agentId: 'agent-b', turnId: 'turn-123', action: 'call' },
    );
    expect(result).toEqual({
      ok: true,
      turn: pendingTurn,
    });
  });
});

describe('publishTurnRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the turn and emits both snapshot and turn events', async () => {
    const turn: AgentTurnRequest = {
      turnId: 'turn-123',
      arenaId: 'arena-123',
      handId: 'hand-123',
      handNumber: 7,
      agentId: 'agent-b',
      validActions: ['fold', 'call', 'raise'],
      deadlineMs: null,
      callAmount: 10,
      minRaise: 40,
      maxRaise: 980,
      state: makeState(),
      submitPath: '/arenas/arena-123/actions',
    };

    mockGetAgentRuntimeSnapshot.mockResolvedValueOnce({
      arenaId: 'arena-123',
      agentId: 'agent-b',
      handId: 'hand-123',
      handNumber: 7,
      publicState: createSpectatorView(makeState()),
      privateState: createPrivateView(makeState(), 'agent-b'),
      pendingTurn: null,
      updatedAt: Date.now(),
    });

    await publishTurnRequest(turn);

    expect(mockSetAgentPendingTurn).toHaveBeenCalledWith(turn);
    expect(mockSetAgentRuntimeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith('agent:agent-b:arena:arena-123');
    expect(mockEmit).toHaveBeenCalledWith('agent:turn_request', turn);
  });
});
