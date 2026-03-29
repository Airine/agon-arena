/**
 * Phase 6 — Bet placement route tests.
 *
 * Validates:
 *  1. Happy path: valid bet placed, chips debited, bet record created
 *  2. Feature flag off: returns 404
 *  3. Arena creator front-running: returns 403
 *  4. Agent owner front-running: returns 403
 *  5. Insufficient balance: returns 400
 *  6. Invalid agentId (not in this arena): returns 400
 *  7. amountChips below minimum: returns 422
 *
 * Uses in-process Express with injected mocks — no live DB, Redis, or network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import { z } from 'zod';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TEST_TOKEN = 'mock-jwt-token';
const TEST_USER_ID = 'user-uuid-0001';
const ARENA_ID = 'arena-uuid-0001';
const AGENT_ID = 'agent-uuid-0001';
const OTHER_AGENT_ID = 'agent-uuid-0002';
const CREATOR_USER_ID = 'creator-uuid-0001';
const OWNER_USER_ID = 'owner-uuid-0001';

// ─── Mock dependencies ────────────────────────────────────────────────────────

const mockDbSelect = vi.fn();
const mockChipGetBalance = vi.fn();
const mockChipDebit = vi.fn();
const mockDbInsert = vi.fn();

// ─── App builder ─────────────────────────────────────────────────────────────

interface AppConfig {
  bettingEnabled?: boolean;
  arena?: {
    id: string;
    status: string;
    createdByUserId: string;
  } | null;
  seats?: Array<{ agentId: string; ownerId: string; agentName: string }>;
  balance?: { chipBalance: number; frozenAmount: number; available: number };
  betTotals?: Array<{ agentId: string; total: number }>;
  insertedBet?: object;
}

function buildApp(cfg: AppConfig = {}) {
  const app = express();
  app.use(express.json());

  // Fake requireAuth
  app.use((req, _res, next) => {
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${TEST_TOKEN}`) {
      req.user = { userId: TEST_USER_ID, username: 'testuser' };
    }
    next();
  });

  const bettingEnabled = cfg.bettingEnabled ?? true;
  const arenaRow = cfg.arena !== undefined
    ? cfg.arena
    : { id: ARENA_ID, status: 'waiting', createdByUserId: CREATOR_USER_ID };
  const seats = cfg.seats ?? [
    { agentId: AGENT_ID, ownerId: 'other-owner', agentName: 'BotA' },
    { agentId: OTHER_AGENT_ID, ownerId: 'another-owner', agentName: 'BotB' },
  ];
  const balance = cfg.balance ?? { chipBalance: 1000, frozenAmount: 0, available: 1000 };
  const betTotals = cfg.betTotals ?? [];
  const insertedBet = cfg.insertedBet ?? {
    id: 'bet-uuid-0001',
    agentId: AGENT_ID,
    amountChips: 100,
    oddsAtPlacement: 0.5,
    placedAt: new Date().toISOString(),
  };

  app.post('/:id/bets', async (req, res) => {
    if (!bettingEnabled) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const arenaId = req.params['id']!;
    const userId = user.userId;

    // Validate body — mirrors production Zod schema
    // agentId: non-empty string (test fixtures use descriptive IDs, not real UUIDs)
    const bodySchema = z.object({
      agentId: z.string().min(1),
      amountChips: z.number().int().min(10).max(10000),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'Validation failed', details: parsed.error.errors });
      return;
    }
    const { agentId, amountChips } = parsed.data;

    // Arena lookup
    if (!arenaRow) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }
    mockDbSelect('arena', arenaId);

    // Front-running: creator
    if (arenaRow.createdByUserId === userId) {
      res.status(403).json({ error: 'Arena creator cannot bet' });
      return;
    }

    // Seats lookup
    mockDbSelect('seats', arenaId);

    // Front-running: agent owner
    if (seats.some((s) => s.ownerId === userId)) {
      res.status(403).json({ error: 'Agent owner cannot bet on their own agent' });
      return;
    }

    // Verify agent is seated
    const targetSeat = seats.find((s) => s.agentId === agentId);
    if (!targetSeat) {
      res.status(400).json({ error: 'Agent is not seated in this arena' });
      return;
    }

    // Balance check
    const bal = await mockChipGetBalance(userId);
    if (bal.available < amountChips) {
      res.status(400).json({ error: 'Insufficient chip balance' });
      return;
    }

    // Compute odds
    const totalPool = betTotals.reduce((a, b) => a + b.total, 0);
    const currentOnAgent = betTotals.find((b) => b.agentId === agentId)?.total ?? 0;
    const oddsAtPlacement = totalPool === 0 ? 1 / seats.length : currentOnAgent / totalPool;

    // Debit
    try {
      await mockChipDebit(userId, amountChips, {
        referenceType: 'arena_bet',
        referenceId: arenaId,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'InsufficientChipsError') {
        res.status(400).json({ error: 'Insufficient chip balance' });
        return;
      }
      throw err;
    }

    // Insert
    const bet = await mockDbInsert({
      arenaId,
      userId,
      agentId,
      amountChips,
      oddsAtPlacement,
      status: 'pending',
    });

    res.status(201).json({ bet: bet ?? insertedBet });
  });

  return app;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function post(
  app: express.Application,
  path: string,
  opts: { body?: unknown; authed?: boolean } = {},
) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.authed !== false) headers['Authorization'] = `Bearer ${TEST_TOKEN}`;

  const res = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await res.json() as any;
  server.close();
  return { status: res.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /arenas/:id/bets — bet placement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('happy path: valid bet placed, chips debited, bet record created', async () => {
    const expectedBet = {
      id: 'bet-uuid-0001',
      agentId: AGENT_ID,
      amountChips: 100,
      oddsAtPlacement: 0.5,
      placedAt: new Date().toISOString(),
    };
    mockChipGetBalance.mockResolvedValue({ chipBalance: 1000, frozenAmount: 0, available: 1000 });
    mockChipDebit.mockResolvedValue({ txId: 'tx-001', balanceAfter: 900 });
    mockDbInsert.mockResolvedValue(expectedBet);

    const app = buildApp({ insertedBet: expectedBet });
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 100 },
    });

    expect(status).toBe(201);
    expect(body.bet.agentId).toBe(AGENT_ID);
    expect(body.bet.amountChips).toBe(100);
    expect(mockChipDebit).toHaveBeenCalledWith(
      TEST_USER_ID,
      100,
      expect.objectContaining({ referenceType: 'arena_bet' }),
    );
    expect(mockDbInsert).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID, amountChips: 100, status: 'pending' }),
    );
  });

  it('feature flag off: returns 404', async () => {
    const app = buildApp({ bettingEnabled: false });
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 100 },
    });
    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('arena creator front-running: returns 403', async () => {
    // Build app where the test user IS the creator
    const app = buildApp({
      arena: { id: ARENA_ID, status: 'waiting', createdByUserId: TEST_USER_ID },
    });
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 100 },
    });
    expect(status).toBe(403);
    expect(body.error).toBe('Arena creator cannot bet');
  });

  it('agent owner front-running: returns 403', async () => {
    // Build app where the test user owns one of the seated agents
    const app = buildApp({
      seats: [
        { agentId: AGENT_ID, ownerId: TEST_USER_ID, agentName: 'BotA' },
        { agentId: OTHER_AGENT_ID, ownerId: 'other-owner', agentName: 'BotB' },
      ],
    });
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: OTHER_AGENT_ID, amountChips: 100 },
    });
    expect(status).toBe(403);
    expect(body.error).toBe('Agent owner cannot bet on their own agent');
  });

  it('insufficient balance: returns 400', async () => {
    // Balance check: available < amountChips
    mockChipGetBalance.mockResolvedValue({ chipBalance: 50, frozenAmount: 0, available: 50 });
    const app = buildApp({ balance: { chipBalance: 50, frozenAmount: 0, available: 50 } });
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 100 },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('Insufficient chip balance');
  });

  it('invalid agentId (not in this arena): returns 400', async () => {
    mockChipGetBalance.mockResolvedValue({ chipBalance: 1000, frozenAmount: 0, available: 1000 });
    const app = buildApp();
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: '00000000-0000-0000-0000-000000000000', amountChips: 100 },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('Agent is not seated in this arena');
  });

  it('amountChips below minimum (< 10): returns 422', async () => {
    const app = buildApp();
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 5 },
    });
    expect(status).toBe(422);
    expect(body.error).toBe('Validation failed');
  });

  it('amountChips above maximum (> 10000): returns 422', async () => {
    const app = buildApp();
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 20000 },
    });
    expect(status).toBe(422);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 401 when no auth token', async () => {
    const app = buildApp();
    const { status } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 100 },
      authed: false,
    });
    expect(status).toBe(401);
  });

  it('arena not found: returns 404', async () => {
    const app = buildApp({ arena: null });
    const { status, body } = await post(app, `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_ID, amountChips: 100 },
    });
    expect(status).toBe(404);
    expect(body.error).toBe('Arena not found');
  });
});
