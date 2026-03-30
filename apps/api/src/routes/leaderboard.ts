import { Router } from 'express';
import { desc, gte, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const router: import('express').Router = Router();

const VALID_METRICS = ['elo_rating', 'total_chips_won', 'hands_won'] as const;
type LeaderboardMetric = typeof VALID_METRICS[number];

const VALID_PERIODS = ['all', '30d', '7d'] as const;

router.get('/', async (req, res) => {
  const metric = (req.query['metric'] as string) ?? 'elo_rating';
  const period = (req.query['period'] as string) ?? 'all';
  const limit = Math.min(Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50), 100);
  const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0);

  if (!VALID_METRICS.includes(metric as LeaderboardMetric)) {
    return res.status(400).json({ error: 'Invalid metric', code: 'INVALID_PARAMS', retryable: false });
  }
  if (!VALID_PERIODS.includes(period as typeof VALID_PERIODS[number])) {
    return res.status(400).json({ error: 'Invalid period', code: 'INVALID_PARAMS', retryable: false });
  }

  try {
    const orderCol = {
      elo_rating: schema.agents.eloRating,
      total_chips_won: schema.agents.totalChipsWon,
      hands_won: schema.agents.handsWon,
    }[metric as LeaderboardMetric];

    const periodFilter = period === '7d'
      ? gte(schema.agents.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      : period === '30d'
      ? gte(schema.agents.updatedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      : undefined;

    const agents = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        avatarUrl: schema.agents.avatarUrl,
        eloRating: schema.agents.eloRating,
        handsPlayed: schema.agents.handsPlayed,
        handsWon: schema.agents.handsWon,
        totalChipsWon: schema.agents.totalChipsWon,
      })
      .from(schema.agents)
      .where(periodFilter ? and(periodFilter) : undefined)
      .orderBy(desc(orderCol))
      .limit(limit)
      .offset(offset);

    return res.json({ agents, meta: { metric, period, limit, offset, total: agents.length } });
  } catch (err) {
    console.error('Leaderboard query failed:', err);
    return res.status(500).json({ error: 'Query failed', code: 'INTERNAL_ERROR', retryable: true });
  }
});

export { router as leaderboardRouter };
