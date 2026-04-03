import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';

const {
  arenaRow,
  seatsRow,
  mockMaybeFinalizeOrphanedRunningArena,
  mockAdvanceHostedPracticeArena,
  mockPublishFunnelEvent,
  mockAcceptSubmittedTurn,
  mockGetCallAmount,
  mockGetMaxRaise,
  mockGetAgentRuntimeRoom,
  mockGetAgentPendingTurn,
  mockGetAgentRuntimeSnapshot,
  mockGetAgentLastProcessedTurnId,
  mockGetRedisClient,
  mockFindSparringReplacementSeat,
  mockGetResolvedArenaSnapshot,
  mockSelect,
  resetSelectState,
} = vi.hoisted(() => {
  const arenaRow = {
    id: 'arena-123',
    name: 'Projection Arena',
    gameType: 'texas_holdem',
    mode: 'practice',
    status: 'waiting',
    allowSparringReplacement: false,
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    maxHands: 100,
    buyInAmount: 0,
    isSmoke: false,
    spectatorCount: 3,
    currentHandNumber: 0,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-03T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    seed: null,
  };

  const seatsRow = [
    {
      seatIndex: 0,
      currentStack: 1000,
      isActive: true,
      agentId: 'agent-1',
      agentName: 'Alpha',
      eloRating: 1320,
    },
  ];

  let selectCall = 0;

  const mockSelect = vi.fn((fields?: unknown) => {
    if (fields === undefined) {
      throw new Error('Detail route must project explicit arena fields');
    }

    selectCall += 1;

    if (selectCall === 1) {
      return {
        from: () => ({
          where: () => ({
            limit: async () => [arenaRow],
          }),
        }),
      };
    }

    return {
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: async () => seatsRow,
          }),
        }),
      }),
    };
  });

  return {
    arenaRow,
    seatsRow,
    mockMaybeFinalizeOrphanedRunningArena: vi.fn(async <T>(arena: T) => arena),
    mockAdvanceHostedPracticeArena: vi.fn(),
    mockPublishFunnelEvent: vi.fn(),
    mockAcceptSubmittedTurn: vi.fn(),
    mockGetCallAmount: vi.fn(),
    mockGetMaxRaise: vi.fn(),
    mockGetAgentRuntimeRoom: vi.fn(),
    mockGetAgentPendingTurn: vi.fn(),
    mockGetAgentRuntimeSnapshot: vi.fn(),
    mockGetAgentLastProcessedTurnId: vi.fn(),
    mockGetRedisClient: vi.fn(),
    mockFindSparringReplacementSeat: vi.fn(),
    mockGetResolvedArenaSnapshot: vi.fn(),
    mockSelect,
    resetSelectState: () => {
      selectCall = 0;
      mockSelect.mockClear();
    },
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    select: mockSelect,
  },
  schema: {
    arenas: {
      id: 'arenas.id',
      name: 'arenas.name',
      gameType: 'arenas.game_type',
      mode: 'arenas.mode',
      status: 'arenas.status',
      allowSparringReplacement: 'arenas.allow_sparring_replacement',
      maxPlayers: 'arenas.max_players',
      smallBlind: 'arenas.small_blind',
      bigBlind: 'arenas.big_blind',
      startingStack: 'arenas.starting_stack',
      maxHands: 'arenas.max_hands',
      buyInAmount: 'arenas.buy_in_amount',
      isSmoke: 'arenas.is_smoke',
      spectatorCount: 'arenas.spectator_count',
      currentHandNumber: 'arenas.current_hand_number',
      createdByUserId: 'arenas.created_by_user_id',
      createdAt: 'arenas.created_at',
      startedAt: 'arenas.started_at',
      finishedAt: 'arenas.finished_at',
      seed: 'arenas.seed',
    },
    arenaSeats: {
      arenaId: 'arena_seats.arena_id',
      seatIndex: 'arena_seats.seat_index',
      currentStack: 'arena_seats.current_stack',
      isActive: 'arena_seats.is_active',
      agentId: 'arena_seats.agent_id',
    },
    agents: {
      id: 'agents.id',
      name: 'agents.name',
      eloRating: 'agents.elo_rating',
    },
  },
}));

vi.mock('../agent-runtime.js', () => ({
  acceptSubmittedTurn: mockAcceptSubmittedTurn,
  getCallAmount: mockGetCallAmount,
  getMaxRaise: mockGetMaxRaise,
  getAgentRuntimeRoom: mockGetAgentRuntimeRoom,
}));

vi.mock('../../services/redis.js', () => ({
  getAgentPendingTurn: mockGetAgentPendingTurn,
  getAgentRuntimeSnapshot: mockGetAgentRuntimeSnapshot,
  getAgentLastProcessedTurnId: mockGetAgentLastProcessedTurnId,
  getRedisClient: mockGetRedisClient,
}));

vi.mock('../../services/arena-admission.js', () => ({
  findSparringReplacementSeat: mockFindSparringReplacementSeat,
}));

vi.mock('../../services/arena-lifecycle.js', () => ({
  getResolvedArenaSnapshot: mockGetResolvedArenaSnapshot,
  maybeFinalizeOrphanedRunningArena: mockMaybeFinalizeOrphanedRunningArena,
}));

vi.mock('../../services/hosted-practice.js', () => ({
  advanceHostedPracticeArena: mockAdvanceHostedPracticeArena,
}));

vi.mock('../../middleware/rate-limit.js', () => ({
  ipRateLimit: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../../services/kafka.js', () => ({
  publishFunnelEvent: mockPublishFunnelEvent,
}));

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../middleware/error-response.js', () => ({
  apiError: vi.fn(),
  ErrorCode: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq-condition'),
  and: vi.fn(() => 'and-condition'),
  count: vi.fn(() => 'count-expression'),
  sql: vi.fn(() => 'sql-expression'),
  desc: vi.fn(() => 'desc-order'),
  asc: vi.fn(() => 'asc-order'),
}));

import { arenasRouter } from '../arenas.js';

async function request(path: string) {
  const app = express();
  app.use('/arenas', arenasRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const response = await fetch(`http://localhost:${port}${path}`);
  const body = await response.json();
  server.close();
  return { status: response.status, body };
}

describe('GET /arenas/:id', () => {
  beforeEach(() => {
    resetSelectState();
    mockMaybeFinalizeOrphanedRunningArena.mockClear();
  });

  it('returns arena detail when the route uses an explicit arena projection', async () => {
    const result = await request('/arenas/arena-123');

    expect(result.status).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        id: 'arena-123',
        name: 'Projection Arena',
        tier: 'practice',
        seats: seatsRow,
      }),
    );
    expect(mockMaybeFinalizeOrphanedRunningArena).toHaveBeenCalledWith(arenaRow);
  });
});
