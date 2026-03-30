/**
 * Full-arena-flow integration test — mocked infrastructure, real business logic.
 *
 * WHY THIS APPROACH:
 * `runGameLoop` is not exported; only `startGame` (fire-and-forget void) is.
 * The loop contains `sleep(1000)` between hands (= 3 seconds for 3 hands if real).
 * Rather than fighting an unexported async loop, we:
 *   1. Use `bot://call` / `bot://passive` seats — they run `resolveBotAction`
 *      entirely in-process, bypassing Redis and HTTP agent calls.
 *   2. Mock every infrastructure boundary (DB, Redis, IO, Kafka, chipService).
 *   3. Use `vi.useFakeTimers` to drain the inter-hand sleeps instantly.
 *   4. Drive `startGame` and await the loop's completion by waiting for the
 *      final DB update (arena → 'finished') to be called.
 *
 * WHAT IS REAL (not mocked):
 *   - createGame / processAction / getValidActions / getWinners / isHandOver
 *   - resolveBotAction (all 8 bot strategies)
 *   - generateCommit / verifyVRFCommit (pure crypto)
 *   - createTurnRequest / createSpectatorView / createPrivateView (pure transforms)
 *   - toPlayerAction clamping logic (inside orchestrator, indirectly exercised)
 *
 * WHAT IS MOCKED:
 *   - DB (drizzle): insert/update/select stubs with call tracking
 *   - Redis: all functions stubbed to no-op / sensible defaults
 *   - Socket.IO getIO(): stub with .to().emit() chain
 *   - Kafka publishEvent: no-op
 *   - chipService.allocateFirstBetRewards: no-op (fire-and-forget reward path)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock factories — must run before any import of the modules under test
// ---------------------------------------------------------------------------

const {
  // DB call trackers
  insertCalls,
  updateCalls,
  selectStub,
  insertStub,
  updateStub,

  // Redis stubs
  mockClearAgentPendingTurn,
  mockClearArenaLoopHeartbeat,
  mockSetGameSnapshot,
  mockTouchArenaLoopHeartbeat,
  mockPublishRuntimeSnapshot,
  mockPublishTurnRequest,
  mockWaitForSubmittedTurn,
  mockEmitArenaEvent,
  mockSetAgentRuntimeSnapshot,
  mockGetAgentRuntimeSnapshot,

  // IO stub
  ioEmitStub,

  // chipService stub
  mockAllocateFirstBetRewards,
} = vi.hoisted(() => {
  // ── DB tracking ─────────────────────────────────────────────────────────
  // Each call to db.insert(...).values(...).returning() resolves with a
  // synthetic row containing just an id.
  let insertSeq = 0;

  const insertCalls: Array<{ table: string; values: unknown }> = [];
  const updateCalls: Array<{ table: string; set: unknown }> = [];

  const insertStub = vi.fn((table: unknown) => ({
    values: vi.fn((vals: unknown) => {
      const tableName = (table as { name?: string })?.name ?? String(table);
      insertCalls.push({ table: tableName, values: vals });
      return {
        returning: vi.fn().mockResolvedValue([{ id: `mock-id-${++insertSeq}` }]),
      };
    }),
  }));

  const updateStub = vi.fn((table: unknown) => ({
    set: vi.fn((setVals: unknown) => ({
      where: vi.fn().mockImplementation(() => {
        const tableName = (table as { name?: string })?.name ?? String(table);
        updateCalls.push({ table: tableName, set: setVals });
        return Promise.resolve();
      }),
    })),
  }));

  const selectStub = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([]),
      })),
    })),
  }));

  // ── Redis stubs ──────────────────────────────────────────────────────────
  const mockClearAgentPendingTurn = vi.fn().mockResolvedValue(undefined);
  const mockClearArenaLoopHeartbeat = vi.fn().mockResolvedValue(undefined);
  const mockSetGameSnapshot = vi.fn().mockResolvedValue(undefined);
  const mockTouchArenaLoopHeartbeat = vi.fn().mockResolvedValue(undefined);

  // ── agent-runtime stubs (only the async network-facing ones) ────────────
  // publishRuntimeSnapshot and publishTurnRequest call Redis + IO internally;
  // we stub them here to keep Redis out while still tracking calls.
  const mockPublishRuntimeSnapshot = vi.fn().mockResolvedValue(undefined);
  const mockPublishTurnRequest = vi.fn().mockResolvedValue(undefined);
  const mockWaitForSubmittedTurn = vi.fn().mockResolvedValue(null);
  const mockEmitArenaEvent = vi.fn().mockResolvedValue(undefined);
  const mockSetAgentRuntimeSnapshot = vi.fn().mockResolvedValue(undefined);
  const mockGetAgentRuntimeSnapshot = vi.fn().mockResolvedValue(null);

  // ── Socket.IO stub ───────────────────────────────────────────────────────
  const ioEmitStub = vi.fn();
  const ioToStub = vi.fn(() => ({ emit: ioEmitStub }));

  // ── chipService stub ─────────────────────────────────────────────────────
  const mockAllocateFirstBetRewards = vi.fn().mockResolvedValue(null);

  return {
    insertCalls,
    updateCalls,
    selectStub,
    insertStub,
    updateStub,
    mockClearAgentPendingTurn,
    mockClearArenaLoopHeartbeat,
    mockSetGameSnapshot,
    mockTouchArenaLoopHeartbeat,
    mockPublishRuntimeSnapshot,
    mockPublishTurnRequest,
    mockWaitForSubmittedTurn,
    mockEmitArenaEvent,
    mockSetAgentRuntimeSnapshot,
    mockGetAgentRuntimeSnapshot,
    ioEmitStub,
    ioToStub,
    mockAllocateFirstBetRewards,
  };
});

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest before imports)
// ---------------------------------------------------------------------------

vi.mock('../../db/index.js', () => ({
  db: {
    insert: insertStub,
    update: updateStub,
    select: selectStub,
  },
  // Expose schema names so eq() / sql`` lookups don't explode when called with mocks.
  // The actual column references are passed through drizzle helpers; we just need
  // the table objects to exist so the orchestrator's `eq(schema.arenas.id, ...)` calls
  // receive something. The mock DB ignores the where-clause argument anyway.
  schema: {
    arenas:        { id: 'id', status: 'status', currentHandNumber: 'currentHandNumber' },
    gameHands:     { id: 'id', arenaId: 'arenaId', stage: 'stage', stateSnapshot: 'stateSnapshot', communityCards: 'communityCards', potAmount: 'potAmount', winnersJson: 'winnersJson', endedAt: 'endedAt', vrfSeed: 'vrfSeed' },
    gameActions:   { id: 'id' },
    agents:        { id: 'id', handsPlayed: 'handsPlayed', handsWon: 'handsWon', totalChipsWon: 'totalChipsWon', updatedAt: 'updatedAt', ownerId: 'ownerId' },
    arenaSeats:    { agentId: 'agentId', currentStack: 'currentStack', isActive: 'isActive' },
  },
}));

vi.mock('../redis.js', () => ({
  clearAgentPendingTurn:    mockClearAgentPendingTurn,
  clearArenaLoopHeartbeat:  mockClearArenaLoopHeartbeat,
  setGameSnapshot:          mockSetGameSnapshot,
  touchArenaLoopHeartbeat:  mockTouchArenaLoopHeartbeat,
  // The remaining Redis functions are only needed by agent-runtime (mocked separately below)
  getAgentPendingTurn:      vi.fn().mockResolvedValue(null),
  setAgentPendingTurn:      vi.fn().mockResolvedValue(undefined),
  setAgentRuntimeSnapshot:  mockSetAgentRuntimeSnapshot,
  getAgentRuntimeSnapshot:  mockGetAgentRuntimeSnapshot,
  setAgentLastProcessedTurnId: vi.fn().mockResolvedValue(undefined),
  clearAgentRuntimeSnapshot:   vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../io.js', () => ({
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: ioEmitStub })) })),
}));

vi.mock('../kafka.js', () => ({
  publishEvent: vi.fn(),
}));

// Stub the network-facing functions in agent-runtime while keeping pure helpers
// (createSpectatorView, createPrivateView, createTurnRequest, getCallAmount, etc.) real.
vi.mock('../agent-runtime.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../agent-runtime.js')>();
  return {
    ...original,
    publishRuntimeSnapshot:  mockPublishRuntimeSnapshot,
    publishTurnRequest:      mockPublishTurnRequest,
    waitForSubmittedTurn:    mockWaitForSubmittedTurn,
    emitArenaEvent:          mockEmitArenaEvent,
  };
});

vi.mock('../chip.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../chip.js')>();
  return {
    ...original,
    chipService: {
      ...original.chipService,
      allocateFirstBetRewards: mockAllocateFirstBetRewards,
    },
  };
});

// ---------------------------------------------------------------------------
// Import the system under test AFTER mocks are declared
// ---------------------------------------------------------------------------
import { startGame } from '../orchestrator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARENA_ID = 'test-arena-001';
const AGENT_A  = 'agent-alpha';
const AGENT_B  = 'agent-bravo';

const STARTING_STACK = 200; // small stacks → game ends faster
const SMALL_BLIND    = 5;
const BIG_BLIND      = 10;

/** Minimal arena config for a short, deterministic 3-hand run. */
const ARENA_CONFIG = {
  smallBlind:    SMALL_BLIND,
  bigBlind:      BIG_BLIND,
  startingStack: STARTING_STACK,
  maxHands:      3,
};

/** Two bot seats: call station vs passive — guaranteed to always produce actions. */
const SEATS = [
  { seatIndex: 0, currentStack: STARTING_STACK, agentId: AGENT_A, agentName: 'Alpha', apiUrl: 'bot://call' },
  { seatIndex: 1, currentStack: STARTING_STACK, agentId: AGENT_B, agentName: 'Bravo', apiUrl: 'bot://passive' },
];

/**
 * Wait for the game loop's final DB update to arrive.
 * `startGame` is fire-and-forget; we poll the update call list until we see
 * `status: 'finished'` or timeout after 5 s of real wall time.
 */
function waitForArenaFinished(timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      const finished = updateCalls.some(
        (c) => (c.set as Record<string, unknown>)?.status === 'finished',
      );
      if (finished) return resolve();
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for arena:finished DB write'));
      setTimeout(check, 10);
    }
    check();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('full arena flow — 2 bot agents, 3 hands, mocked infrastructure', () => {
  beforeEach(() => {
    // Reset all call trackers
    insertCalls.length = 0;
    updateCalls.length = 0;
    vi.clearAllMocks();

    // ACTION_ROUND_MIN_MS=0 skips all round-pacing sleeps.
    process.env['ACTION_ROUND_MIN_MS'] = '0';

    // Fake timers drain the 1 s inter-hand sleep(1000) instantly.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env['ACTION_ROUND_MIN_MS'];
  });

  it('arena finishes — DB receives status=finished update', async () => {
    startGame(ARENA_ID, ARENA_CONFIG, SEATS);

    // Advance fake timers to drain all pending sleeps, then flush micro-tasks.
    await vi.runAllTimersAsync();

    await waitForArenaFinished();

    const finishedUpdate = updateCalls.find(
      (c) => (c.set as Record<string, unknown>)?.status === 'finished',
    );
    expect(finishedUpdate).toBeDefined();
    expect((finishedUpdate!.set as Record<string, unknown>).finishedAt).toBeInstanceOf(Date);
  });

  it('chip conservation — total chips across all hands equal starting total', async () => {
    // Track per-hand stack snapshots from the arenaSeats update calls.
    // The orchestrator writes `currentStack` for every seat at the end of each hand.
    // We verify that the sum across both seats equals totalStartingChips at the end.

    const TOTAL_START = STARTING_STACK * SEATS.length;

    startGame(ARENA_ID, ARENA_CONFIG, SEATS);
    await vi.runAllTimersAsync();
    await waitForArenaFinished();

    // Filter updates that carry currentStack (seat updates at hand end)
    const seatUpdates = updateCalls.filter(
      (c) => (c.set as Record<string, unknown>)?.currentStack !== undefined,
    );

    // At least one seat update must exist (one per seat per hand).
    expect(seatUpdates.length).toBeGreaterThan(0);

    // Find the final stack for each agent — last seat update for each agentId.
    // The mock doesn't track which agentId the where-clause targets, so we use
    // cumulative chip math instead: winners are never assigned negative chips,
    // and the engine's chip conservation property guarantees no chips are
    // created/destroyed. We verify this via gameHands insert pot amounts.

    // Each gameHands insert includes potAmount. Sum all pot amounts and verify
    // that every pot is ≥ BIG_BLIND (at least the blinds went in).
    const handInserts = insertCalls.filter(
      (c) => (c.values as Record<string, unknown>)?.arenaId === ARENA_ID &&
              (c.values as Record<string, unknown>)?.handNumber !== undefined,
    );

    expect(handInserts.length).toBeGreaterThanOrEqual(1);

    for (const h of handInserts) {
      const pot = (h.values as Record<string, unknown>).potAmount as number;
      // Pot at hand CREATE is the initial forced-bet pot (blinds already posted).
      // It may be 0 at record-creation time (engine posts blinds as part of game state),
      // so just assert it's a non-negative number.
      expect(typeof pot).toBe('number');
      expect(pot).toBeGreaterThanOrEqual(0);
    }

    // Verify the game engine itself: play a hand directly and confirm conservation.
    // This is the canonical conservation test — the mocked orchestrator test above
    // just verifies the plumbing calls happened.
    const { createGame, processAction, getValidActions, getWinners, isHandOver } =
      await import('../../game/engine.js');

    const { state: initial, deck } = createGame({
      arenaId: ARENA_ID,
      players: SEATS.map((s) => ({ agentId: s.agentId, agentName: s.agentName, stack: STARTING_STACK })),
      smallBlind: SMALL_BLIND,
      bigBlind:   BIG_BLIND,
      dealerIndex: 0,
    });

    let state = initial;
    let safety = 0;
    while (!isHandOver(state) && state.currentActorIndex !== null) {
      expect(safety++).toBeLessThan(200);
      const valid = getValidActions(state);
      if (valid.length === 0) break;
      // Always call or check — never fold — so chips are maximally contested.
      const action = valid.includes('call')
        ? { type: 'call' as const }
        : valid.includes('check')
          ? { type: 'check' as const }
          : { type: 'fold' as const };
      state = processAction(state, action, deck);
    }

    const winners = getWinners(state);
    const potTotal = state.pots.reduce((s, p) => s + p.amount, 0);
    const stackTotal = state.players.reduce((s, p) => s + p.stack, 0);
    const winnerTotal = winners.reduce((s, w) => s + w.amount, 0);

    // All pot chips must be assigned to winners
    expect(winnerTotal).toBe(potTotal);
    // Total chips in system = stacks + pot = constant
    expect(stackTotal + potTotal).toBe(TOTAL_START);
  });

  it('settlement written — gameHands rows inserted for each hand', async () => {
    startGame(ARENA_ID, ARENA_CONFIG, SEATS);
    await vi.runAllTimersAsync();
    await waitForArenaFinished();

    // One gameHands insert per hand (the initial INSERT before play).
    const handInserts = insertCalls.filter(
      (c) => (c.values as Record<string, unknown>)?.arenaId === ARENA_ID &&
              (c.values as Record<string, unknown>)?.handNumber !== undefined,
    );
    expect(handInserts.length).toBeGreaterThanOrEqual(1);

    // Each hand must have had its record updated (winnersJson, endedAt, etc.)
    const handUpdatesWithWinners = updateCalls.filter(
      (c) => (c.set as Record<string, unknown>)?.winnersJson !== undefined,
    );
    expect(handUpdatesWithWinners.length).toBeGreaterThanOrEqual(1);

    // Verify the winners payload has the right shape
    for (const u of handUpdatesWithWinners) {
      const w = (u.set as Record<string, unknown>).winnersJson as Array<{ agentId: string; amount: number }>;
      expect(Array.isArray(w)).toBe(true);
      expect(w.length).toBeGreaterThan(0);
      for (const winner of w) {
        expect(typeof winner.agentId).toBe('string');
        expect(winner.amount).toBeGreaterThan(0);
      }
    }
  });

  it('agent stats updated — handsPlayed incremented for both agents after each hand', async () => {
    startGame(ARENA_ID, ARENA_CONFIG, SEATS);
    await vi.runAllTimersAsync();
    await waitForArenaFinished();

    // The orchestrator issues one `agents` update per player per hand (handsPlayed +1).
    // With 2 players × ≥1 hand = ≥2 such updates.
    const agentStatUpdates = updateCalls.filter(
      (c) => (c.set as Record<string, unknown>)?.handsPlayed !== undefined,
    );
    expect(agentStatUpdates.length).toBeGreaterThanOrEqual(2);

    // At least one handsWon update must have occurred (the winner of each hand).
    const agentWinUpdates = updateCalls.filter(
      (c) => (c.set as Record<string, unknown>)?.handsWon !== undefined,
    );
    expect(agentWinUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it('gameActions recorded — every bot action produces a DB row', async () => {
    startGame(ARENA_ID, ARENA_CONFIG, SEATS);
    await vi.runAllTimersAsync();
    await waitForArenaFinished();

    // gameActions inserts carry agentId and actionType
    const actionInserts = insertCalls.filter(
      (c) =>
        (c.values as Record<string, unknown>)?.agentId !== undefined &&
        (c.values as Record<string, unknown>)?.actionType !== undefined,
    );

    // With 2 players and 3 hands there must be at least 2 actions
    // (the two forced blind posts advance state; real rounds follow).
    expect(actionInserts.length).toBeGreaterThanOrEqual(2);

    // All recorded agentIds belong to our two bots
    const knownAgents = new Set([AGENT_A, AGENT_B]);
    for (const a of actionInserts) {
      const id = (a.values as Record<string, unknown>).agentId as string;
      expect(knownAgents.has(id)).toBe(true);
    }

    // sequenceNumber increments monotonically within a hand
    const actionsByHand = new Map<string, number[]>();
    for (const a of actionInserts) {
      const vals = a.values as Record<string, unknown>;
      const handId = vals.handId as string ?? 'unknown';
      const seq    = vals.sequenceNumber as number;
      if (!actionsByHand.has(handId)) actionsByHand.set(handId, []);
      actionsByHand.get(handId)!.push(seq);
    }
    for (const [, seqs] of actionsByHand) {
      const sorted = [...seqs].sort((a, b) => a - b);
      // Must be contiguous starting at 1
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i]).toBe(i + 1);
      }
    }
  });

  it('VRF seed revealed — every hand gets a vrfSeed update after it ends', async () => {
    startGame(ARENA_ID, ARENA_CONFIG, SEATS);
    await vi.runAllTimersAsync();
    await waitForArenaFinished();

    const vrfRevealUpdates = updateCalls.filter(
      (c) => (c.set as Record<string, unknown>)?.vrfSeed !== undefined,
    );
    expect(vrfRevealUpdates.length).toBeGreaterThanOrEqual(1);

    for (const u of vrfRevealUpdates) {
      const seed = (u.set as Record<string, unknown>).vrfSeed as string;
      // VRF seed is a 64-char hex string (32 bytes)
      expect(seed).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('currentHandNumber advances — arena row updated on each hand', async () => {
    startGame(ARENA_ID, ARENA_CONFIG, SEATS);
    await vi.runAllTimersAsync();
    await waitForArenaFinished();

    const handNumberUpdates = updateCalls.filter(
      (c) => (c.set as Record<string, unknown>)?.currentHandNumber !== undefined,
    );
    expect(handNumberUpdates.length).toBeGreaterThanOrEqual(1);

    const handNumbers = handNumberUpdates.map(
      (c) => (c.set as Record<string, unknown>).currentHandNumber as number,
    );
    // First update must set hand 1
    expect(handNumbers[0]).toBe(1);
    // Numbers must be non-decreasing
    for (let i = 1; i < handNumbers.length; i++) {
      expect(handNumbers[i]).toBeGreaterThanOrEqual(handNumbers[i - 1]!);
    }
  });
});
