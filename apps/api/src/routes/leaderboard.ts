import { Router } from 'express';
import { desc, gte, and, count, not, or, isNull, like } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const router: import('express').Router = Router();

const VALID_METRICS = ['elo_rating', 'total_chips_won', 'hands_won'] as const;
type LeaderboardMetric = typeof VALID_METRICS[number];

const VALID_PERIODS = ['all', '30d', '7d'] as const;

router.get('/', async (req, res) => {
  const metric = (req.query['metric'] as string) ?? 'elo_rating';
  const period = (req.query['period'] as string) ?? 'all';
  const limit = Math.min(Math.max(1, parseInt(String(req.query['limit'] ?? '25'), 10) || 25), 100);
  const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0);
  // excludeBots=1 (default): hide bot:// agents and agents with no apiUrl (never connected)
  const excludeBots = (req.query['excludeBots'] as string) !== '0';
  // minHandsPlayed=1 (default): hide agents that have never played a hand
  const minHandsPlayed = Math.max(0, parseInt(String(req.query['minHandsPlayed'] ?? '1'), 10) || 1);

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

    const conditions = [];

    // Period filter
    if (period === '7d') {
      conditions.push(gte(schema.agents.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    } else if (period === '30d') {
      conditions.push(gte(schema.agents.updatedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
    }

    // Exclude bot agents: only filter out bot:// api_url; NULL means a real user agent.
    if (excludeBots) {
      conditions.push(not(like(schema.agents.apiUrl, 'bot://%'))!);
    }

    // Minimum hands played — excludes zero-game placeholders
    if (minHandsPlayed > 0) {
      conditions.push(gte(schema.agents.handsPlayed, minHandsPlayed));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ total: count() })
      .from(schema.agents)
      .where(whereClause);
    const totalCount = countResult?.total ?? 0;

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
      .where(whereClause)
      .orderBy(desc(orderCol))
      .limit(limit)
      .offset(offset);

    return res.json({
      agents,
      meta: { metric, period, limit, offset, total: Number(totalCount), excludeBots, minHandsPlayed },
    });
  } catch (err) {
    console.error('Leaderboard query failed:', err);
    return res.status(500).json({ error: 'Query failed', code: 'INTERNAL_ERROR', retryable: true });
  }
});

export { router as leaderboardRouter };
