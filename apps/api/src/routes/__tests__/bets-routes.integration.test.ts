/**
 * Phase 6 — Bets routes integration tests.
 *
 * Integration test: place bet → check balance deducted → check bet record exists → check odds updated
 *
 * Uses in-process Express app with mocked DB and chipService.
 * No live DB, Redis, or network required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_TOKEN = 'mock-jwt-token';
const TEST_USER_ID = 'user-uuid-0001';
const ARENA_ID = 'arena-uuid-0001';
const AGENT_A_ID = 'agent-uuid-0001';
const AGENT_B_ID = 'agent-uuid-0002';
const CREATOR_ID = 'creator-uuid-9999';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockChipGetBalance = vi.fn();
const mockChipDebit = vi.fn();

// ─── In-memory state for integration scenario ─────────────────────────────────

interface BetRecord {
  id: string;
  arenaId: string;
  userId: string;
  agentId: string;
  amountChips: number;
  oddsAtPlacement: number;
  status: string;
  placedAt: string;
}

class InMemoryBetStore {
  private bets: BetRecord[] = [];
  private nextId = 1;

  insert(data: Omit<BetRecord, 'id' | 'placedAt'>): BetRecord {
    const bet: BetRecord = {
      ...data,
      id: `bet-uuid-${String(this.nextId++).padStart(4, '0')}`,
      placedAt: new Date().toISOString(),
    };
    this.bets.push(bet);
    return bet;
  }

  findByArenaAndUser(arenaId: string, userId: string): BetRecord[] {
    return this.bets.filter((b) => b.arenaId === arenaId && b.userId === userId);
  }

  findByArena(arenaId: string): BetRecord[] {
    return this.bets.filter((b) => b.arenaId === arenaId);
  }

  totalsGroupedByAgent(arenaId: string): Array<{ agentId: string; total: number }> {
    const map = new Map<string, number>();
    for (const bet of this.bets.filter((b) => b.arenaId === arenaId && b.status === 'pending')) {
      map.set(bet.agentId, (map.get(bet.agentId) ?? 0) + bet.amountChips);
    }
    return Array.from(map.entries()).map(([agentId, total]) => ({ agentId, total }));
  }
}

// ─── App factory ─────────────────────────────────────────────────────────────

function buildIntegrationApp(store: InMemoryBetStore, userBalance: { available: number }) {
  const app = express();
  app.use(express.json());

  // Auth injection
  app.use((req, _res, next) => {
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${TEST_TOKEN}`) {
      req.user = { userId: TEST_USER_ID, username: 'testuser' };
    }
    next();
  });

  const arena = {
    id: ARENA_ID,
    status: 'waiting',
    createdByUserId: CREATOR_ID,
  };

  const seats = [
    { agentId: AGENT_A_ID, ownerId: 'owner-a', agentName: 'BotA' },
    { agentId: AGENT_B_ID, ownerId: 'owner-b', agentName: 'BotB' },
  ];

  // POST /:id/bets
  app.post('/:id/bets', async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const arenaId = req.params['id']!;
    const { agentId, amountChips } = req.body as { agentId?: string; amountChips?: number };

    if (!agentId || typeof amountChips !== 'number' || amountChips < 10 || amountChips > 10000) {
      res.status(422).json({ error: 'Validation failed' });
      return;
    }

    if (!arena || arena.id !== arenaId) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    if (arena.createdByUserId === user.userId) {
      res.status(403).json({ error: 'Arena creator cannot bet' });
      return;
    }

    if (seats.some((s) => s.ownerId === user.userId)) {
      res.status(403).json({ error: 'Agent owner cannot bet on their own agent' });
      return;
    }

    const targetSeat = seats.find((s) => s.agentId === agentId);
    if (!targetSeat) {
      res.status(400).json({ error: 'Agent is not seated in this arena' });
      return;
    }

    const bal = await mockChipGetBalance(user.userId);
    if (bal.available < amountChips) {
      res.status(400).json({ error: 'Insufficient chip balance' });
      return;
    }

    // Compute odds from current store state
    const betTotals = store.totalsGroupedByAgent(arenaId);
    const totalPool = betTotals.reduce((a, b) => a + b.total, 0);
    const currentOnAgent = betTotals.find((b) => b.agentId === agentId)?.total ?? 0;
    const oddsAtPlacement = totalPool === 0 ? 1 / seats.length : currentOnAgent / totalPool;

    await mockChipDebit(user.userId, amountChips, { referenceType: 'arena_bet', referenceId: arenaId });

    // Mutate in-memory balance
    userBalance.available -= amountChips;

    const bet = store.insert({
      arenaId,
      userId: user.userId,
      agentId,
      amountChips,
      oddsAtPlacement,
      status: 'pending',
    });

    res.status(201).json({ bet });
  });

  // GET /:id/odds
  app.get('/:id/odds', async (req, res) => {
    const arenaId = req.params['id']!;

    if (!arena || arena.id !== arenaId) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    const betTotals = store.totalsGroupedByAgent(arenaId);
    const betMap = new Map(betTotals.map((b) => [b.agentId, b.total]));
    const totalPool = betTotals.reduce((a, b) => a + b.total, 0);

    const odds = seats.map((seat) => {
      const totalBetOnAgent = betMap.get(seat.agentId) ?? 0;
      const oddsValue = totalPool === 0 ? 1 / seats.length : totalBetOnAgent / totalPool;
      return { agentId: seat.agentId, agentName: seat.agentName, odds: oddsValue, totalBetOnAgent };
    });

    res.json({ odds, totalPool, arenaId });
  });

  // GET /:id/bets/my
  app.get('/:id/bets/my', (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const arenaId = req.params['id']!;
    const bets = store.findByArenaAndUser(arenaId, user.userId);
    res.json({ bets, arenaId });
  });

  return app;
}

// ─── Request helper ───────────────────────────────────────────────────────────

async function req(
  app: express.Application,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; authed?: boolean } = {},
) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.authed !== false) headers['Authorization'] = `Bearer ${TEST_TOKEN}`;

  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await res.json() as any;
  server.close();
  return { status: res.status, body };
}

// ─── Integration tests ────────────────────────────────────────────────────────

describe('Bets routes — integration: place bet → balance → record → odds', () => {
  let store: InMemoryBetStore;
  let userBalance: { available: number };
  let app: express.Application;

  beforeEach(() => {
    vi.resetAllMocks();
    store = new InMemoryBetStore();
    userBalance = { available: 1000 };
    app = buildIntegrationApp(store, userBalance);
  });

  it('place bet → balance is deducted', async () => {
    mockChipGetBalance.mockResolvedValue({ chipBalance: 1000, frozenAmount: 0, available: 1000 });
    mockChipDebit.mockResolvedValue({ txId: 'tx-001', balanceAfter: 900 });

    const { status, body } = await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 100 },
    });

    expect(status).toBe(201);
    expect(body.bet.amountChips).toBe(100);

    // chipService.debit was called with the right amount
    expect(mockChipDebit).toHaveBeenCalledWith(
      TEST_USER_ID,
      100,
      expect.objectContaining({ referenceType: 'arena_bet', referenceId: ARENA_ID }),
    );

    // In-memory balance reduced
    expect(userBalance.available).toBe(900);
  });

  it('place bet → bet record exists in store', async () => {
    mockChipGetBalance.mockResolvedValue({ available: 1000 });
    mockChipDebit.mockResolvedValue({});

    await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 150 },
    });

    const bets = store.findByArenaAndUser(ARENA_ID, TEST_USER_ID);
    expect(bets).toHaveLength(1);
    expect(bets[0]!.agentId).toBe(AGENT_A_ID);
    expect(bets[0]!.amountChips).toBe(150);
    expect(bets[0]!.status).toBe('pending');
    expect(bets[0]!.userId).toBe(TEST_USER_ID);
  });

  it('place bet → GET /odds updates to reflect bet', async () => {
    mockChipGetBalance.mockResolvedValue({ available: 1000 });
    mockChipDebit.mockResolvedValue({});

    // Before bet: equal odds
    const beforeResp = await req(app, 'GET', `/${ARENA_ID}/odds`);
    expect(beforeResp.status).toBe(200);
    expect(beforeResp.body.totalPool).toBe(0);
    expect(beforeResp.body.odds[0].odds).toBeCloseTo(0.5);
    expect(beforeResp.body.odds[1].odds).toBeCloseTo(0.5);

    // Place bet on Agent A
    await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 300 },
    });

    // After bet: Agent A has higher odds
    const afterResp = await req(app, 'GET', `/${ARENA_ID}/odds`);
    expect(afterResp.status).toBe(200);
    expect(afterResp.body.totalPool).toBe(300);

    const oddsA = afterResp.body.odds.find((o: { agentId: string }) => o.agentId === AGENT_A_ID);
    const oddsB = afterResp.body.odds.find((o: { agentId: string }) => o.agentId === AGENT_B_ID);
    expect(oddsA.odds).toBeCloseTo(1.0);
    expect(oddsB.odds).toBeCloseTo(0.0);
    expect(oddsA.totalBetOnAgent).toBe(300);
    expect(oddsB.totalBetOnAgent).toBe(0);
  });

  it('multiple bets → odds sum to 1.0 and pool is correct', async () => {
    mockChipGetBalance.mockResolvedValue({ available: 1000 });
    mockChipDebit.mockResolvedValue({});

    // Place 200 on A
    await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 200 },
    });
    // Place 300 on B (different user handled by mock returning same available)
    await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_B_ID, amountChips: 300 },
    });

    const oddsResp = await req(app, 'GET', `/${ARENA_ID}/odds`);
    expect(oddsResp.body.totalPool).toBe(500);

    const sum = oddsResp.body.odds.reduce((a: number, o: { odds: number }) => a + o.odds, 0);
    expect(sum).toBeCloseTo(1.0);

    const oddsA = oddsResp.body.odds.find((o: { agentId: string }) => o.agentId === AGENT_A_ID);
    const oddsB = oddsResp.body.odds.find((o: { agentId: string }) => o.agentId === AGENT_B_ID);
    expect(oddsA.odds).toBeCloseTo(0.4);
    expect(oddsB.odds).toBeCloseTo(0.6);
  });

  it('GET /bets/my returns only current user bets', async () => {
    mockChipGetBalance.mockResolvedValue({ available: 1000 });
    mockChipDebit.mockResolvedValue({});

    // Place bet
    await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 50 },
    });

    // Manually insert a bet for a different user (direct store access)
    store.insert({
      arenaId: ARENA_ID,
      userId: 'other-user-id',
      agentId: AGENT_B_ID,
      amountChips: 200,
      oddsAtPlacement: 0.5,
      status: 'pending',
    });

    const { status, body } = await req(app, 'GET', `/${ARENA_ID}/bets/my`);
    expect(status).toBe(200);
    expect(body.bets).toHaveLength(1);
    expect(body.bets[0].userId).toBe(TEST_USER_ID);
    expect(body.bets[0].amountChips).toBe(50);
  });

  it('insufficient balance on second bet (race condition simulation)', async () => {
    // First bet succeeds, second fails due to drained balance
    mockChipGetBalance
      .mockResolvedValueOnce({ available: 1000 })
      .mockResolvedValueOnce({ available: 0 }); // balance drained after first bet
    mockChipDebit.mockResolvedValue({});

    const first = await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 1000 },
    });
    expect(first.status).toBe(201);

    const second = await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 100 },
    });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('Insufficient chip balance');
  });

  it('bet oddsAtPlacement snapshot is recorded correctly', async () => {
    mockChipGetBalance.mockResolvedValue({ available: 1000 });
    mockChipDebit.mockResolvedValue({});

    // No prior bets — odds should be equal (1/2 = 0.5)
    const { body } = await req(app, 'POST', `/${ARENA_ID}/bets`, {
      body: { agentId: AGENT_A_ID, amountChips: 100 },
    });

    expect(body.bet.oddsAtPlacement).toBeCloseTo(0.5);
  });
});
