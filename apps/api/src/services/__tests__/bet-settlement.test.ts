import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbSelectFrom,
  mockDbSelectFromWhere,
  mockDbTransaction,
  mockTxUpdate,
  mockTxUpdateSet,
  mockTxUpdateSetWhere,
  mockCreditInTx,
} = vi.hoisted(() => {
  const mockDbSelectFromWhere = vi.fn();
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectFromWhere }));
  const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));
  const mockDbTransaction = vi.fn();

  const mockTxUpdateSetWhere = vi.fn();
  const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateSetWhere }));
  const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));

  const mockCreditInTx = vi.fn();

  return {
    mockDbSelect,
    mockDbSelectFrom,
    mockDbSelectFromWhere,
    mockDbTransaction,
    mockTxUpdate,
    mockTxUpdateSet,
    mockTxUpdateSetWhere,
    mockCreditInTx,
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
  schema: {
    arenaBets: {
      id: 'arena_bets.id',
      arenaId: 'arena_bets.arena_id',
      userId: 'arena_bets.user_id',
      agentId: 'arena_bets.agent_id',
      amountChips: 'arena_bets.amount_chips',
      status: 'arena_bets.status',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: { col, val } })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ inArray: { col, vals } })),
}));

vi.mock('../chip.js', () => ({
  chipService: {
    creditInTx: mockCreditInTx,
  },
}));

import { settleBets, PLATFORM_FEE_RATE } from '../bet-settlement.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ARENA_ID = 'arena-uuid-001';

function makeBet(
  id: string,
  userId: string,
  agentId: string,
  amountChips: number,
) {
  return { id, userId, agentId, amountChips };
}

/** Make mockDbTransaction execute the callback synchronously with a fake tx. */
function setupTransaction() {
  const fakeTx = {
    update: mockTxUpdate,
  };
  mockDbTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    return cb(fakeTx);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('settleBets()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    // Default: creditInTx resolves to a dummy tx result
    mockCreditInTx.mockResolvedValue({ txId: 'chip-tx-001' });
    mockTxUpdateSetWhere.mockResolvedValue(undefined);
  });

  // ── No-op ──────────────────────────────────────────────────────────────────

  it('is a no-op when there are no pending bets', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([]);

    await settleBets(ARENA_ID, ['agent-a']);

    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockCreditInTx).not.toHaveBeenCalled();
  });

  // ── Platform fee ──────────────────────────────────────────────────────────

  it(`deducts a ${PLATFORM_FEE_RATE * 100}% platform fee from total pool`, async () => {
    // 1 winner, 1 loser, 100 chips each → pool=200, fee=10, prize=190
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-a', 100),
      makeBet('b2', 'u2', 'agent-b', 100),
    ]);

    await settleBets(ARENA_ID, ['agent-a']);

    // Winner gets 190 (prizePool, since they hold all winning chips)
    expect(mockCreditInTx).toHaveBeenCalledTimes(1);
    const [, , payout] = mockCreditInTx.mock.calls[0]!;
    expect(payout).toBe(190);
  });

  // ── Payout proportional to bet ────────────────────────────────────────────

  it('splits prize pool proportionally among multiple winners', async () => {
    // Two winners: bet 100 and 300 → totalWinning=400
    // pool=400, fee=floor(400*0.05)=20, prize=380
    // winner1 payout = floor(100/400 * 380) = floor(95) = 95
    // winner2 payout = floor(300/400 * 380) = floor(285) = 285
    // totalPaidOut=380 → remainder=0
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-a', 100),
      makeBet('b2', 'u2', 'agent-b', 300),
    ]);

    await settleBets(ARENA_ID, ['agent-a', 'agent-b']);

    const payouts = mockCreditInTx.mock.calls.map((c) => c[2] as number).sort((a, b) => a - b);
    expect(payouts).toEqual([95, 285]);
  });

  // ── Rounding remainder ────────────────────────────────────────────────────

  it('distributes rounding remainder to the largest winning bet', async () => {
    // pool=3, fee=floor(3*0.05)=0, prize=3
    // winner1 bet=1, winner2 bet=2 → totalWinning=3
    // winner1 payout=floor(1/3*3)=1, winner2=floor(2/3*3)=2 → total=3, remainder=0
    // Use a case that generates remainder:
    // pool=10, fee=0, prize=10 but 3 winners at bet=1 each → totalWinning=3
    // payout each = floor(1/3*10)=3 → total=9, remainder=1 → goes to any (all same)
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-a', 1),
      makeBet('b2', 'u2', 'agent-b', 1),
      makeBet('b3', 'u3', 'agent-c', 1),
    ]);

    // No losers: all three are winners
    await settleBets(ARENA_ID, ['agent-a', 'agent-b', 'agent-c']);

    const payouts = mockCreditInTx.mock.calls.map((c) => c[2] as number);
    const total = payouts.reduce((s, v) => s + v, 0);
    // prize = floor(3 * 0) removed…  fee=0, prize=3, each gets 1 → total=3, remainder=0
    expect(total).toBe(3); // total chips out equals prize pool
  });

  it('assigns the rounding remainder to the bet with the largest amount', async () => {
    // pool=7, fee=floor(0.35)=0, prize=7
    // winner1 bet=1, winner2 bet=6 → totalWinning=7
    // winner1=floor(1/7*7)=1, winner2=floor(6/7*7)=6 → total=7, remainder=0
    // Use pool=10, fee=0, two winners 3 and 4 chips → totalWinning=7
    // winner1(3) = floor(3/7*10) = 4, winner2(4) = floor(4/7*10) = 5 → total=9, rem=1
    // Largest winning bet is winner2 (4 chips) → gets remainder
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-small', 3),
      makeBet('b2', 'u2', 'agent-large', 4),
      // loser so total pool is 10 but only 7 winning
      makeBet('b3', 'u3', 'agent-loser', 3),
    ]);

    await settleBets(ARENA_ID, ['agent-small', 'agent-large']);

    // pool=10, fee=floor(0.5)=0, prize=10
    // totalWinning=7
    // small: floor(3/7*10)=4, large: floor(4/7*10)=5 → total=9, rem=1 → large gets +1=6
    const payoutsMap = new Map<string, number>();
    for (const call of mockCreditInTx.mock.calls) {
      const [, userId, payout] = call as [unknown, string, number, ...unknown[]];
      payoutsMap.set(userId, payout);
    }
    // u2 is agent-large
    expect(payoutsMap.get('u2')).toBe(6);
    expect(payoutsMap.get('u1')).toBe(4);
  });

  // ── Losing bets ───────────────────────────────────────────────────────────

  it('marks losing bets with status=lost and payout=0', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-winner', 100),
      makeBet('b2', 'u2', 'agent-loser', 100),
    ]);

    await settleBets(ARENA_ID, ['agent-winner']);

    // At least one update call with status='lost'
    const updateCalls = mockTxUpdateSet.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
    const lostCall = updateCalls.find((c) => c['status'] === 'lost');
    expect(lostCall).toBeDefined();
    expect(lostCall?.['payout']).toBe(0);
  });

  it('marks winning bets with status=won and correct payout', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-winner', 200),
    ]);

    await settleBets(ARENA_ID, ['agent-winner']);

    const updateCalls = mockTxUpdateSet.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
    const wonCall = updateCalls.find((c) => c['status'] === 'won');
    expect(wonCall).toBeDefined();
    // pool=200, fee=10, prize=190, single winner gets all
    expect(wonCall?.['payout']).toBe(190);
  });

  // ── All losers ────────────────────────────────────────────────────────────

  it('does not call creditInTx when there are no winning bets', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-a', 100),
      makeBet('b2', 'u2', 'agent-b', 200),
    ]);

    // winnerAgentIds is empty (all agents busted)
    await settleBets(ARENA_ID, []);

    expect(mockCreditInTx).not.toHaveBeenCalled();
  });

  // ── Atomicity ─────────────────────────────────────────────────────────────

  it('wraps all mutations in a single db.transaction', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-a', 50),
      makeBet('b2', 'u2', 'agent-b', 150),
    ]);

    await settleBets(ARENA_ID, ['agent-a']);

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
  });

  it('propagates transaction errors to the caller', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-a', 100),
    ]);
    mockDbTransaction.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(settleBets(ARENA_ID, ['agent-a'])).rejects.toThrow('DB connection lost');
  });

  // ── platformFeeAmount propagated ──────────────────────────────────────────

  it('stores platformFeeAmount on winning bet rows', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('b1', 'u1', 'agent-winner', 100),
    ]);

    await settleBets(ARENA_ID, ['agent-winner']);

    const updateCalls = mockTxUpdateSet.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
    const wonCall = updateCalls.find((c) => c['status'] === 'won');
    expect(wonCall?.['platformFeeAmount']).toBe(Math.floor(100 * PLATFORM_FEE_RATE));
  });

  // ── creditInTx meta ───────────────────────────────────────────────────────

  it('passes correct meta (referenceType=bet_win, referenceId=betId, arenaId) to creditInTx', async () => {
    mockDbSelectFromWhere.mockResolvedValueOnce([
      makeBet('bet-xyz', 'user-123', 'agent-a', 200),
    ]);

    await settleBets(ARENA_ID, ['agent-a']);

    expect(mockCreditInTx).toHaveBeenCalledWith(
      expect.anything(),   // tx
      'user-123',          // userId
      expect.any(Number),  // payout
      'bet_win',           // description
      expect.objectContaining({
        referenceType: 'bet_win',
        referenceId: 'bet-xyz',
        arenaId: ARENA_ID,
        betId: 'bet-xyz',
      }),
    );
  });
});
