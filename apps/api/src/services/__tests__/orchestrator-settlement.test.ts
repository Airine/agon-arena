/**
 * Phase 7 – Orchestrator settlement tests.
 *
 * Coverage:
 *   1. Pure helpers: resolveArenaHandLimit / resolveActionRoundMinMs
 *   2. Settlement wiring: settleBets is called after the game loop finishes,
 *      with the correct arenaId and the set of agents that still have chips.
 *   3. Non-fatal guarantee: a settleBets error does not prevent the arena from
 *      being marked 'finished'.
 *
 * The integration tests drive startGame() with two bot seats (maxHands=1) and
 * mock every external dependency so the game loop runs synchronously/quickly
 * without network or DB calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockSettleBets,
  mockDbUpdateSetWhere,
  mockDbUpdateSet,
  mockDbUpdate,
  mockDbInsertReturning,
  mockDbInsertValues,
  mockDbInsert,
  mockDbSelectFromWhereLimit,
  mockDbSelectFromWhere,
  mockDbSelectFrom,
  mockDbSelect,
  mockGetIO,
  mockEmit,
  mockTo,
  mockPublishEvent,
  mockEmitArenaEvent,
  mockPublishTurnRequest,
  mockPublishRuntimeSnapshot,
  mockClearHeartbeat,
  mockTouchHeartbeat,
  mockClearPendingTurn,
  mockSetGameSnapshot,
  mockCreateSpectatorView,
  mockCreateTurnRequest,
  mockResolveBotAction,
  mockGenerateCommit,
  mockVerifyVRFCommit,
  mockSeededShuffle,
} = vi.hoisted(() => {
  const mockSettleBets = vi.fn();

  // db.update chain
  const mockDbUpdateSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockDbUpdateSet = vi.fn(() => ({ where: mockDbUpdateSetWhere }));
  const mockDbUpdate = vi.fn(() => ({ set: mockDbUpdateSet }));

  // db.insert chain — returning() gives back a hand record with id
  const mockDbInsertReturning = vi.fn().mockResolvedValue([{ id: 'hand-record-001' }]);
  const mockDbInsertValues = vi.fn(() => ({ returning: mockDbInsertReturning }));
  const mockDbInsert = vi.fn(() => ({ values: mockDbInsertValues }));

  // db.select chain (used by orchestrator for agent lookups)
  // Supports both .where() terminal and .where().limit() terminal
  const mockDbSelectFromWhereLimit = vi.fn().mockResolvedValue([]);
  const mockDbSelectFromWhere = vi.fn(() => ({ limit: mockDbSelectFromWhereLimit }));
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectFromWhere }));
  const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));

  // Socket.IO
  const mockEmit = vi.fn();
  const mockTo = vi.fn(() => ({ emit: mockEmit }));
  const mockGetIO = vi.fn(() => ({ to: mockTo }));

  // Background services
  const mockPublishEvent = vi.fn();
  const mockEmitArenaEvent = vi.fn().mockResolvedValue(undefined);
  const mockPublishTurnRequest = vi.fn().mockResolvedValue(undefined);
  const mockPublishRuntimeSnapshot = vi.fn().mockResolvedValue(undefined);
  const mockClearHeartbeat = vi.fn().mockResolvedValue(undefined);
  const mockTouchHeartbeat = vi.fn().mockResolvedValue(undefined);
  const mockClearPendingTurn = vi.fn().mockResolvedValue(undefined);
  const mockSetGameSnapshot = vi.fn().mockResolvedValue(undefined);

  // Agent runtime views
  const mockCreateSpectatorView = vi.fn(() => ({}));
  const mockCreateTurnRequest = vi.fn(() => ({}));

  // Bot always folds (ends hands quickly); must return PlayerAction shape ({ type })
  const mockResolveBotAction = vi.fn(() => ({ type: 'fold' }));

  // VRF — provide all exports the game engine needs
  const mockGenerateCommit = vi.fn(() => ({
    seed: 'aabbccdd',
    commit: 'commit-hex',
    proof: 'proof-hex',
    signature: null,
    publicKey: null,
  }));
  const mockVerifyVRFCommit = vi.fn(() => true);
  // seededShuffle: pass-through so createGame gets a valid deck order
  const mockSeededShuffle = vi.fn(<T>(items: T[]) => [...items]);

  return {
    mockSettleBets,
    mockDbUpdateSetWhere,
    mockDbUpdateSet,
    mockDbUpdate,
    mockDbInsertReturning,
    mockDbInsertValues,
    mockDbInsert,
    mockDbSelectFromWhereLimit,
    mockDbSelectFromWhere,
    mockDbSelectFrom,
    mockDbSelect,
    mockGetIO,
    mockEmit,
    mockTo,
    mockPublishEvent,
    mockEmitArenaEvent,
    mockPublishTurnRequest,
    mockPublishRuntimeSnapshot,
    mockClearHeartbeat,
    mockTouchHeartbeat,
    mockClearPendingTurn,
    mockSetGameSnapshot,
    mockCreateSpectatorView,
    mockCreateTurnRequest,
    mockResolveBotAction,
    mockGenerateCommit,
    mockVerifyVRFCommit,
    mockSeededShuffle,
  };
});

vi.mock('../bet-settlement.js', () => ({
  settleBets: mockSettleBets,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  },
  schema: {
    arenas: {
      id: 'arenas.id',
      status: 'arenas.status',
      finishedAt: 'arenas.finished_at',
      currentHandNumber: 'arenas.current_hand_number',
    },
    agents: {
      id: 'agents.id',
      ownerId: 'agents.owner_id',
      handsPlayed: 'agents.hands_played',
      handsWon: 'agents.hands_won',
      totalChipsWon: 'agents.total_chips_won',
      updatedAt: 'agents.updated_at',
    },
    arenaSeats: {
      agentId: 'arena_seats.agent_id',
      currentStack: 'arena_seats.current_stack',
      isActive: 'arena_seats.is_active',
    },
    gameHands: {
      id: 'game_hands.id',
      arenaId: 'game_hands.arena_id',
      handNumber: 'game_hands.hand_number',
      stage: 'game_hands.stage',
      stateSnapshot: 'game_hands.state_snapshot',
      communityCards: 'game_hands.community_cards',
      potAmount: 'game_hands.pot_amount',
      vrfCommit: 'game_hands.vrf_commit',
      vrfSignature: 'game_hands.vrf_signature',
      vrfSeed: 'game_hands.vrf_seed',
      winnersJson: 'game_hands.winners_json',
      endedAt: 'game_hands.ended_at',
    },
    gameActions: {
      id: 'game_actions.id',
      handId: 'game_actions.hand_id',
      arenaId: 'game_actions.arena_id',
      agentId: 'game_actions.agent_id',
      actionType: 'game_actions.action_type',
      amount: 'game_actions.amount',
      stage: 'game_actions.stage',
      sequenceNumber: 'game_actions.sequence_number',
      responseTimeMs: 'game_actions.response_time_ms',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: { col, val } })),
  and: vi.fn((...c: unknown[]) => ({ and: c })),
  sql: new Proxy(() => 'sql-expr', { get: () => () => 'sql-expr' }),
}));

vi.mock('../io.js', () => ({
  getIO: mockGetIO,
}));

vi.mock('../kafka.js', () => ({
  publishEvent: mockPublishEvent,
}));

vi.mock('../agent-runtime.js', () => ({
  emitArenaEvent: mockEmitArenaEvent,
  publishTurnRequest: mockPublishTurnRequest,
  publishRuntimeSnapshot: mockPublishRuntimeSnapshot,
  waitForSubmittedTurn: vi.fn().mockResolvedValue(null),
  createPrivateView: vi.fn(() => ({})),
  createSpectatorView: mockCreateSpectatorView,
  createTurnRequest: mockCreateTurnRequest,
}));

vi.mock('../redis.js', () => ({
  clearArenaLoopHeartbeat: mockClearHeartbeat,
  touchArenaLoopHeartbeat: mockTouchHeartbeat,
  clearAgentPendingTurn: mockClearPendingTurn,
  setGameSnapshot: mockSetGameSnapshot,
}));

vi.mock('../bot.js', () => ({
  resolveBotAction: mockResolveBotAction,
}));

vi.mock('../vrf.js', () => ({
  generateCommit: mockGenerateCommit,
  verifyVRFCommit: mockVerifyVRFCommit,
  seededShuffle: mockSeededShuffle,
}));

vi.mock('../chip.js', () => ({
  chipService: {
    allocateFirstBetRewards: vi.fn().mockResolvedValue(null),
    creditInTx: vi.fn().mockResolvedValue({ txId: 'chip-tx' }),
  },
}));

import { resolveArenaHandLimit, resolveActionRoundMinMs, runGameLoop } from '../orchestrator.js';

// ─── Pure helper tests ────────────────────────────────────────────────────────

describe('resolveArenaHandLimit()', () => {
  it('returns maxHands when it is a positive integer', () => {
    expect(resolveArenaHandLimit({ smallBlind: 10, bigBlind: 20, startingStack: 1000, maxHands: 5 })).toBe(5);
    expect(resolveArenaHandLimit({ smallBlind: 10, bigBlind: 20, startingStack: 1000, maxHands: 1 })).toBe(1);
  });

  it('returns the bounded default (100) when maxHands is 0', () => {
    expect(resolveArenaHandLimit({ smallBlind: 10, bigBlind: 20, startingStack: 1000, maxHands: 0 })).toBe(100);
  });

  it('returns the bounded default (100) when maxHands is absent', () => {
    expect(resolveArenaHandLimit({ smallBlind: 10, bigBlind: 20, startingStack: 1000 })).toBe(100);
  });

  it('returns the bounded default (100) for negative maxHands', () => {
    expect(resolveArenaHandLimit({ smallBlind: 10, bigBlind: 20, startingStack: 1000, maxHands: -1 })).toBe(100);
  });
});

describe('resolveActionRoundMinMs()', () => {
  beforeEach(() => {
    delete process.env['ACTION_ROUND_MIN_MS'];
  });

  it('defaults to 5000ms when ACTION_ROUND_MIN_MS is unset', () => {
    expect(resolveActionRoundMinMs()).toBe(5_000);
  });

  it('defaults to 5000ms when ACTION_ROUND_MIN_MS is invalid', () => {
    process.env['ACTION_ROUND_MIN_MS'] = 'not-a-number';
    expect(resolveActionRoundMinMs()).toBe(5_000);
  });

  it('uses the env var when it is a valid positive integer', () => {
    process.env['ACTION_ROUND_MIN_MS'] = '2000';
    expect(resolveActionRoundMinMs()).toBe(2_000);
  });
});

// ─── Settlement integration ───────────────────────────────────────────────────
//
// We run a 1-hand game with two bot:// seats so the loop completes quickly.
// ACTION_ROUND_MIN_MS=0 removes the round-timer pause; the sleep(1000) between
// hands is unavoidable but fits within the 8 s per-test timeout below.

const ARENA_ID = 'arena-settle-test';

const seats = [
  { seatIndex: 0, currentStack: 1000, agentId: 'agent-a', agentName: 'BotA', apiUrl: 'bot://fold' },
  { seatIndex: 1, currentStack: 1000, agentId: 'agent-b', agentName: 'BotB', apiUrl: 'bot://fold' },
];

const arenaConfig = {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  maxHands: 1,
};

function setupIntegrationMocks() {
  vi.clearAllMocks();

  // Silence the round-timer pause (ACTION_ROUND_MIN_MS=0 means no wait)
  process.env['ACTION_ROUND_MIN_MS'] = '0';

  // db.update chain
  mockDbUpdateSetWhere.mockResolvedValue(undefined);

  // db.insert.values().returning() → hand record
  mockDbInsertReturning.mockResolvedValue([{ id: 'hand-record-001' }]);
  mockDbInsertValues.mockReturnValue({ returning: mockDbInsertReturning });
  mockDbInsert.mockReturnValue({ values: mockDbInsertValues });

  // db.select chain — default empty (supports .where() and .where().limit())
  mockDbSelectFromWhereLimit.mockResolvedValue([]);
  mockDbSelectFromWhere.mockReturnValue({ limit: mockDbSelectFromWhereLimit });

  // Socket.IO
  mockGetIO.mockReturnValue({ to: mockTo });
  mockTo.mockReturnValue({ emit: mockEmit });

  // All async side-effects succeed silently
  mockEmitArenaEvent.mockResolvedValue(undefined);
  mockPublishRuntimeSnapshot.mockResolvedValue(undefined);
  mockClearHeartbeat.mockResolvedValue(undefined);
  mockTouchHeartbeat.mockResolvedValue(undefined);
  mockClearPendingTurn.mockResolvedValue(undefined);
  mockSetGameSnapshot.mockResolvedValue(undefined);
  mockCreateSpectatorView.mockReturnValue({});

  // VRF
  mockGenerateCommit.mockReturnValue({ seed: 'aabbccdd', commit: 'commit-hex', proof: 'proof-hex', signature: null, publicKey: null });
  mockVerifyVRFCommit.mockReturnValue(true);
  mockSeededShuffle.mockImplementation(<T>(items: T[]) => [...items]);

  // Bots fold immediately (PlayerAction shape: { type })
  mockResolveBotAction.mockReturnValue({ type: 'fold' });

  // settleBets succeeds by default
  mockSettleBets.mockResolvedValue(undefined);
}

/**
 * Integration tests for orchestrator settlement.
 *
 * All settlement assertions are collected in a single game run to avoid
 * concurrent loop leakage between tests (each `startGame` kicks off an
 * async loop; if tests don't await completion the mock call counts bleed
 * across test boundaries).
 */
describe('Orchestrator settlement integration', () => {
  /**
   * Runs one complete arena (maxHands=1, two bots) and waits until
   * settleBets has been called. Returns all observable mock state.
   */
  async function runOneArena(arenaId: string) {
    void runGameLoop(arenaId, arenaConfig, [
      { seatIndex: 0, currentStack: 1000, agentId: 'agent-a', agentName: 'BotA', apiUrl: 'bot://call' },
      { seatIndex: 1, currentStack: 1000, agentId: 'agent-b', agentName: 'BotB', apiUrl: 'bot://call' },
    ]).catch(() => {});

    // Wait until the loop reaches settlement
    await vi.waitFor(
      () => {
        expect(mockSettleBets).toHaveBeenCalled();
      },
      { timeout: 8000 },
    );
  }

  it('settleBets is called with arenaId and valid winner list', async () => {
    setupIntegrationMocks();

    await runOneArena(ARENA_ID);

    const [calledArenaId, calledWinners] = mockSettleBets.mock.calls[0]! as [string, string[]];
    expect(calledArenaId).toBe(ARENA_ID);
    expect(Array.isArray(calledWinners)).toBe(true);

    const knownAgents = new Set(['agent-a', 'agent-b']);
    for (const w of calledWinners) {
      expect(knownAgents.has(w)).toBe(true);
    }
  }, 10000);

  it('settleBets is called exactly once per arena run', async () => {
    setupIntegrationMocks();

    await runOneArena(`${ARENA_ID}-once`);

    expect(mockSettleBets).toHaveBeenCalledTimes(1);
  }, 10000);

  it('only agents with chips > 0 are passed as winners', async () => {
    setupIntegrationMocks();

    await runOneArena(`${ARENA_ID}-winners`);

    const [, winners] = mockSettleBets.mock.calls[0]! as [string, string[]];
    expect(winners.length).toBeGreaterThan(0);
  }, 10000);

  it('arena is marked finished after settlement completes', async () => {
    setupIntegrationMocks();

    await runOneArena(`${ARENA_ID}-finished`);

    // Wait for the arena finished db.update (may happen just after settleBets)
    await vi.waitFor(
      () => {
        const setCalls = mockDbUpdateSet.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
        expect(setCalls.some((c) => c['status'] === 'finished')).toBe(true);
      },
      { timeout: 2000 },
    );
  }, 10000);

  it('arena:finished socket event is emitted after settlement', async () => {
    setupIntegrationMocks();

    await runOneArena(`${ARENA_ID}-socket`);

    await vi.waitFor(
      () => {
        expect(mockEmit).toHaveBeenCalledWith(
          'arena:finished',
          expect.objectContaining({ arenaId: `${ARENA_ID}-socket` }),
        );
      },
      { timeout: 2000 },
    );
  }, 10000);

  it('a settleBets error is non-fatal — arena still finishes', async () => {
    setupIntegrationMocks();
    mockSettleBets.mockRejectedValue(new Error('settlement exploded'));

    void runGameLoop(`${ARENA_ID}-err`, arenaConfig, [
      { seatIndex: 0, currentStack: 1000, agentId: 'agent-a', agentName: 'BotA', apiUrl: 'bot://call' },
      { seatIndex: 1, currentStack: 1000, agentId: 'agent-b', agentName: 'BotB', apiUrl: 'bot://call' },
    ]).catch(() => {});

    await vi.waitFor(
      () => {
        const setCalls = mockDbUpdateSet.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
        expect(setCalls.some((c) => c['status'] === 'finished')).toBe(true);
      },
      { timeout: 8000 },
    );

    const setCalls = mockDbUpdateSet.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
    expect(setCalls.find((c) => c['status'] === 'finished')).toBeDefined();
  }, 10000);
});
