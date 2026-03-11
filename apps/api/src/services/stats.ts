/**
 * AGO-34: Agent stats aggregation service.
 *
 * Stats are computed from the game_actions table via SQL aggregation.
 * Results are not cached — queries are fast enough for per-request use.
 * Cache can be added later if needed.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface AgentStats {
  agentId: string;
  handsPlayed: number;
  handsWon: number;
  winRate: number;       // [0, 1]
  totalChipsWon: number;
  evPerHand: number;     // chips won per hand (can be negative)
  vpip: number;          // [0, 1]
  pfr: number;           // [0, 1]
  af: number;            // aggression factor (≥ 0)
  avgResponseMs: number; // average action latency in ms
  computedAt: number;    // unix ms
}

export async function getAgentStats(agentId: string): Promise<AgentStats> {
  // 1. Fetch base stats from agents table (handsPlayed, handsWon, totalChipsWon)
  const [agent] = await db
    .select({
      handsPlayed: schema.agents.handsPlayed,
      handsWon: schema.agents.handsWon,
      totalChipsWon: schema.agents.totalChipsWon,
    })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  const handsPlayed = agent?.handsPlayed ?? 0;
  const handsWon = agent?.handsWon ?? 0;
  const totalChipsWon = agent?.totalChipsWon ?? 0;

  if (handsPlayed === 0) {
    return {
      agentId, handsPlayed: 0, handsWon: 0, winRate: 0,
      totalChipsWon: 0, evPerHand: 0, vpip: 0, pfr: 0, af: 0,
      avgResponseMs: 0, computedAt: Date.now(),
    };
  }

  // 2. Aggregate action counts from game_actions
  const actionAgg = await db
    .select({
      preFlopVPIP: sql<number>`COUNT(DISTINCT CASE WHEN ${schema.gameActions.stage} = 'pre_flop' AND ${schema.gameActions.actionType} IN ('call', 'raise', 'all_in') THEN ${schema.gameActions.handId} END)`,
      preFlopRaises: sql<number>`COUNT(DISTINCT CASE WHEN ${schema.gameActions.stage} = 'pre_flop' AND ${schema.gameActions.actionType} IN ('raise', 'all_in') THEN ${schema.gameActions.handId} END)`,
      aggressiveActions: sql<number>`SUM(CASE WHEN ${schema.gameActions.actionType} IN ('raise', 'all_in') THEN 1 ELSE 0 END)`,
      callActions: sql<number>`SUM(CASE WHEN ${schema.gameActions.actionType} = 'call' THEN 1 ELSE 0 END)`,
      avgResponseMs: sql<number>`AVG(${schema.gameActions.responseTimeMs})`,
    })
    .from(schema.gameActions)
    .where(eq(schema.gameActions.agentId, agentId));

  const agg = actionAgg[0];
  const preFlopVPIP = Number(agg?.preFlopVPIP ?? 0);
  const preFlopRaises = Number(agg?.preFlopRaises ?? 0);
  const aggressiveActions = Number(agg?.aggressiveActions ?? 0);
  const callActions = Number(agg?.callActions ?? 0);
  const avgResponseMs = Number(agg?.avgResponseMs ?? 0);

  const winRate = handsPlayed > 0 ? handsWon / handsPlayed : 0;
  const evPerHand = handsPlayed > 0 ? totalChipsWon / handsPlayed : 0;
  const vpip = handsPlayed > 0 ? preFlopVPIP / handsPlayed : 0;
  const pfr = handsPlayed > 0 ? preFlopRaises / handsPlayed : 0;
  const af = callActions > 0 ? aggressiveActions / callActions : aggressiveActions > 0 ? Infinity : 0;

  return {
    agentId,
    handsPlayed,
    handsWon,
    winRate: Math.min(1, Math.max(0, winRate)),
    totalChipsWon,
    evPerHand,
    vpip: Math.min(1, Math.max(0, vpip)),
    pfr: Math.min(1, Math.max(0, pfr)),
    af: isFinite(af) ? Math.round(af * 100) / 100 : 999,
    avgResponseMs: Math.round(avgResponseMs),
    computedAt: Date.now(),
  };
}
