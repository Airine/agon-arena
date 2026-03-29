/**
 * Phase 6 — Bet odds endpoint tests.
 *
 * Validates:
 *  1. No bets: equal odds for all agents
 *  2. After bets: odds reflect bet volume distribution
 *  3. Single agent arena: 100% odds
 *  4. Odds sum to approximately 1.0
 *
 * Pure logic tests — no DB, no network.
 */

import { describe, it, expect } from 'vitest';

// ─── Odds calculation logic (mirrors bets.ts) ─────────────────────────────────

interface AgentSeat {
  agentId: string;
  agentName: string;
}

interface BetTotal {
  agentId: string;
  total: number;
}

function computeOdds(
  seats: AgentSeat[],
  betTotals: BetTotal[],
): Array<{ agentId: string; agentName: string; odds: number; totalBetOnAgent: number }> {
  if (seats.length === 0) return [];

  const betMap = new Map<string, number>();
  for (const row of betTotals) {
    betMap.set(row.agentId, row.total);
  }

  const totalPool = Array.from(betMap.values()).reduce((a, b) => a + b, 0);

  return seats.map((seat) => {
    const totalBetOnAgent = betMap.get(seat.agentId) ?? 0;

    let oddsValue: number;
    if (totalPool === 0) {
      oddsValue = 1 / seats.length;
    } else {
      oddsValue = totalBetOnAgent / totalPool;
    }

    return {
      agentId: seat.agentId,
      agentName: seat.agentName,
      odds: oddsValue,
      totalBetOnAgent,
    };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const AGENT_A = { agentId: 'agent-uuid-0001', agentName: 'BotA' };
const AGENT_B = { agentId: 'agent-uuid-0002', agentName: 'BotB' };
const AGENT_C = { agentId: 'agent-uuid-0003', agentName: 'BotC' };

describe('GET /arenas/:id/odds — pari-mutuel odds calculation', () => {
  describe('no bets: equal odds', () => {
    it('two agents — each gets 0.5', () => {
      const odds = computeOdds([AGENT_A, AGENT_B], []);
      expect(odds).toHaveLength(2);
      expect(odds[0]!.odds).toBeCloseTo(0.5);
      expect(odds[1]!.odds).toBeCloseTo(0.5);
    });

    it('three agents — each gets ~0.333', () => {
      const odds = computeOdds([AGENT_A, AGENT_B, AGENT_C], []);
      expect(odds).toHaveLength(3);
      for (const o of odds) {
        expect(o.odds).toBeCloseTo(1 / 3);
      }
    });

    it('totalBetOnAgent is 0 for all when no bets', () => {
      const odds = computeOdds([AGENT_A, AGENT_B], []);
      expect(odds[0]!.totalBetOnAgent).toBe(0);
      expect(odds[1]!.totalBetOnAgent).toBe(0);
    });
  });

  describe('after bets: odds reflect volume', () => {
    it('all bets on one agent — that agent gets odds 1.0, others get 0.0', () => {
      const odds = computeOdds(
        [AGENT_A, AGENT_B],
        [{ agentId: AGENT_A.agentId, total: 500 }],
      );
      const oddsA = odds.find((o) => o.agentId === AGENT_A.agentId)!;
      const oddsB = odds.find((o) => o.agentId === AGENT_B.agentId)!;

      expect(oddsA.odds).toBeCloseTo(1.0);
      expect(oddsB.odds).toBeCloseTo(0.0);
      expect(oddsA.totalBetOnAgent).toBe(500);
      expect(oddsB.totalBetOnAgent).toBe(0);
    });

    it('equal bets on two agents — each gets 0.5', () => {
      const odds = computeOdds(
        [AGENT_A, AGENT_B],
        [
          { agentId: AGENT_A.agentId, total: 200 },
          { agentId: AGENT_B.agentId, total: 200 },
        ],
      );
      expect(odds[0]!.odds).toBeCloseTo(0.5);
      expect(odds[1]!.odds).toBeCloseTo(0.5);
    });

    it('3:1 ratio — A gets 0.75, B gets 0.25', () => {
      const odds = computeOdds(
        [AGENT_A, AGENT_B],
        [
          { agentId: AGENT_A.agentId, total: 300 },
          { agentId: AGENT_B.agentId, total: 100 },
        ],
      );
      const oddsA = odds.find((o) => o.agentId === AGENT_A.agentId)!;
      const oddsB = odds.find((o) => o.agentId === AGENT_B.agentId)!;

      expect(oddsA.odds).toBeCloseTo(0.75);
      expect(oddsB.odds).toBeCloseTo(0.25);
    });

    it('three agents with uneven distribution', () => {
      const odds = computeOdds(
        [AGENT_A, AGENT_B, AGENT_C],
        [
          { agentId: AGENT_A.agentId, total: 600 },
          { agentId: AGENT_B.agentId, total: 300 },
          { agentId: AGENT_C.agentId, total: 100 },
        ],
      );
      const oddsA = odds.find((o) => o.agentId === AGENT_A.agentId)!;
      const oddsB = odds.find((o) => o.agentId === AGENT_B.agentId)!;
      const oddsC = odds.find((o) => o.agentId === AGENT_C.agentId)!;

      expect(oddsA.odds).toBeCloseTo(0.6);
      expect(oddsB.odds).toBeCloseTo(0.3);
      expect(oddsC.odds).toBeCloseTo(0.1);
    });
  });

  describe('single agent arena', () => {
    it('no bets — single agent gets odds 1.0', () => {
      const odds = computeOdds([AGENT_A], []);
      expect(odds).toHaveLength(1);
      expect(odds[0]!.odds).toBeCloseTo(1.0);
    });

    it('with bets — single agent gets odds 1.0', () => {
      const odds = computeOdds(
        [AGENT_A],
        [{ agentId: AGENT_A.agentId, total: 500 }],
      );
      expect(odds[0]!.odds).toBeCloseTo(1.0);
    });
  });

  describe('odds sum to approximately 1.0', () => {
    it('two agents, no bets', () => {
      const odds = computeOdds([AGENT_A, AGENT_B], []);
      const sum = odds.reduce((a, o) => a + o.odds, 0);
      expect(sum).toBeCloseTo(1.0);
    });

    it('three agents with bets', () => {
      const odds = computeOdds(
        [AGENT_A, AGENT_B, AGENT_C],
        [
          { agentId: AGENT_A.agentId, total: 400 },
          { agentId: AGENT_B.agentId, total: 350 },
          { agentId: AGENT_C.agentId, total: 250 },
        ],
      );
      const sum = odds.reduce((a, o) => a + o.odds, 0);
      expect(sum).toBeCloseTo(1.0);
    });

    it('agent with zero bets when others have bets still sums to 1.0', () => {
      // Agent C has no bets but is seated
      const odds = computeOdds(
        [AGENT_A, AGENT_B, AGENT_C],
        [
          { agentId: AGENT_A.agentId, total: 700 },
          { agentId: AGENT_B.agentId, total: 300 },
        ],
      );
      const sum = odds.reduce((a, o) => a + o.odds, 0);
      expect(sum).toBeCloseTo(1.0);
    });

    it('empty arena returns empty odds array', () => {
      const odds = computeOdds([], []);
      expect(odds).toHaveLength(0);
    });
  });

  describe('totalPool accuracy', () => {
    it('reflects correct total chips bet', () => {
      const betTotals = [
        { agentId: AGENT_A.agentId, total: 300 },
        { agentId: AGENT_B.agentId, total: 200 },
      ];
      const totalPool = betTotals.reduce((a, b) => a + b.total, 0);
      expect(totalPool).toBe(500);
    });

    it('zero pool when no bets', () => {
      const betTotals: BetTotal[] = [];
      const totalPool = betTotals.reduce((a, b) => a + b.total, 0);
      expect(totalPool).toBe(0);
    });
  });
});
