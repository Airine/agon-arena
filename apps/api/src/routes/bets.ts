import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { chipService, InsufficientChipsError } from '../services/chip.js';

export const betsRouter: RouterType = Router();

/**
 * Cross-arena bets router — mounted at /bets (top-level).
 * Provides portfolio-page endpoints that span all arenas.
 */
export const myBetsRouter: RouterType = Router();

const placeBetSchema = z.object({
  agentId: z.string().uuid(),
  amountChips: z.number().int().min(10).max(10000),
});

/**
 * GET /arenas/:id/odds — public odds endpoint.
 * Returns pari-mutuel odds for each seated agent in the arena.
 * If no bets yet, returns equal odds for all agents.
 */
betsRouter.get('/:id/odds', async (req, res) => {
  try {
    const arenaId = String(req.params['id']);

    // Verify arena exists
    const [arena] = await db
      .select({ id: schema.arenas.id })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    // Get seated agents
    const seats = await db
      .select({
        agentId: schema.agents.id,
        agentName: schema.agents.name,
      })
      .from(schema.arenaSeats)
      .innerJoin(schema.agents, eq(schema.arenaSeats.agentId, schema.agents.id))
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.isActive, true),
      ));

    if (seats.length === 0) {
      res.json({ odds: [], totalPool: 0, arenaId });
      return;
    }

    // Aggregate bets by agent
    const betTotals = await db
      .select({
        agentId: schema.arenaBets.agentId,
        total: sql<number>`COALESCE(SUM(${schema.arenaBets.amountChips}), 0)`.as('total'),
      })
      .from(schema.arenaBets)
      .where(and(
        eq(schema.arenaBets.arenaId, arenaId),
        eq(schema.arenaBets.status, 'pending'),
      ))
      .groupBy(schema.arenaBets.agentId);

    const betMap = new Map<string, number>();
    for (const row of betTotals) {
      betMap.set(row.agentId, row.total);
    }

    const totalPool = Array.from(betMap.values()).reduce((a, b) => a + b, 0);

    const odds = seats.map((seat) => {
      const totalBetOnAgent = betMap.get(seat.agentId) ?? 0;

      let oddsValue: number;
      if (totalPool === 0) {
        // Equal odds when no bets placed
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

    res.json({ odds, totalPool, arenaId });
  } catch {
    res.status(500).json({ error: 'Failed to fetch odds' });
  }
});

/**
 * POST /arenas/:id/bets — place a bet on an agent.
 * Requires auth. Feature-flagged behind BETTING_ENABLED env var.
 * Enforces front-running guards (arena creator, agent owner).
 */
betsRouter.post('/:id/bets', requireAuth, async (req, res) => {
  // Feature flag gate
  if (!process.env['BETTING_ENABLED']) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const arenaId = String(req.params['id']);
    const userId = req.user!.userId;

    // Validate body
    let body: z.infer<typeof placeBetSchema>;
    try {
      body = placeBetSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(422).json({ error: 'Validation failed', details: err.errors });
        return;
      }
      throw err;
    }

    const { agentId, amountChips } = body;

    // Load arena
    const [arena] = await db
      .select({
        id: schema.arenas.id,
        status: schema.arenas.status,
        createdByUserId: schema.arenas.createdByUserId,
      })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    // Front-running guard: arena creator cannot bet
    if (arena.createdByUserId === userId) {
      res.status(403).json({ error: 'Arena creator cannot bet' });
      return;
    }

    // Get all seated agents (with their owners) for this arena
    const seats = await db
      .select({
        agentId: schema.arenaSeats.agentId,
        ownerId: schema.agents.ownerId,
        agentName: schema.agents.name,
      })
      .from(schema.arenaSeats)
      .innerJoin(schema.agents, eq(schema.arenaSeats.agentId, schema.agents.id))
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.isActive, true),
      ));

    // Front-running guard: agent owner cannot bet on any seated agent they own
    const userOwnsSeatedAgent = seats.some((s) => s.ownerId === userId);
    if (userOwnsSeatedAgent) {
      res.status(403).json({ error: 'Agent owner cannot bet on their own agent' });
      return;
    }

    // Verify the target agentId is actually seated in this arena
    const targetSeat = seats.find((s) => s.agentId === agentId);
    if (!targetSeat) {
      res.status(400).json({ error: 'Agent is not seated in this arena' });
      return;
    }

    // Check balance before attempting debit (for a cleaner error)
    const balance = await chipService.getBalance(userId);
    if (balance.available < amountChips) {
      res.status(400).json({ error: 'Insufficient chip balance' });
      return;
    }

    // Compute current odds snapshot (pari-mutuel, including this bet conceptually)
    // Use current pool state for the snapshot
    const betTotals = await db
      .select({
        agentId: schema.arenaBets.agentId,
        total: sql<number>`COALESCE(SUM(${schema.arenaBets.amountChips}), 0)`.as('total'),
      })
      .from(schema.arenaBets)
      .where(and(
        eq(schema.arenaBets.arenaId, arenaId),
        eq(schema.arenaBets.status, 'pending'),
      ))
      .groupBy(schema.arenaBets.agentId);

    const betMap = new Map<string, number>();
    for (const row of betTotals) {
      betMap.set(row.agentId, row.total);
    }

    const totalPool = Array.from(betMap.values()).reduce((a, b) => a + b, 0);
    const currentOnAgent = betMap.get(agentId) ?? 0;

    let oddsAtPlacement: number;
    if (totalPool === 0) {
      oddsAtPlacement = 1 / seats.length;
    } else {
      oddsAtPlacement = currentOnAgent / totalPool;
    }

    // Debit chips (throws InsufficientChipsError if race condition)
    try {
      await chipService.debit(userId, amountChips, {
        referenceType: 'arena_bet',
        referenceId: arenaId,
        note: `Bet on agent ${agentId} in arena ${arenaId}`,
      });
    } catch (err) {
      if (err instanceof InsufficientChipsError) {
        res.status(400).json({ error: 'Insufficient chip balance' });
        return;
      }
      throw err;
    }

    // Insert bet record
    const [bet] = await db
      .insert(schema.arenaBets)
      .values({
        arenaId,
        userId,
        agentId,
        amountChips,
        oddsAtPlacement,
        status: 'pending',
      })
      .returning({
        id: schema.arenaBets.id,
        agentId: schema.arenaBets.agentId,
        amountChips: schema.arenaBets.amountChips,
        oddsAtPlacement: schema.arenaBets.oddsAtPlacement,
        placedAt: schema.arenaBets.placedAt,
      });

    res.status(201).json({ bet });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(422).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

/**
 * GET /arenas/:id/bets — list current user's bets on this arena.
 * Auth required. Returns only the caller's own bets.
 */
betsRouter.get('/:id/bets/my', requireAuth, async (req, res) => {
  try {
    const arenaId = String(req.params['id']);
    const userId = req.user!.userId;

    const [arena] = await db
      .select({ id: schema.arenas.id })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    const bets = await db
      .select({
        id: schema.arenaBets.id,
        agentId: schema.arenaBets.agentId,
        amountChips: schema.arenaBets.amountChips,
        oddsAtPlacement: schema.arenaBets.oddsAtPlacement,
        placedAt: schema.arenaBets.placedAt,
        settledAt: schema.arenaBets.settledAt,
        payout: schema.arenaBets.payout,
        status: schema.arenaBets.status,
      })
      .from(schema.arenaBets)
      .where(and(
        eq(schema.arenaBets.arenaId, arenaId),
        eq(schema.arenaBets.userId, userId),
      ));

    res.json({ bets, arenaId });
  } catch {
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

/**
 * GET /bets/my — cross-arena portfolio view.
 * Returns all bets placed by the authenticated user across all arenas,
 * joined with arena name and agent name, sorted by placedAt DESC.
 */
myBetsRouter.get('/my', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const bets = await db
      .select({
        id: schema.arenaBets.id,
        arenaId: schema.arenaBets.arenaId,
        arenaName: schema.arenas.name,
        agentId: schema.arenaBets.agentId,
        agentName: schema.agents.name,
        amountChips: schema.arenaBets.amountChips,
        oddsAtPlacement: schema.arenaBets.oddsAtPlacement,
        status: schema.arenaBets.status,
        payout: schema.arenaBets.payout,
        placedAt: schema.arenaBets.placedAt,
        settledAt: schema.arenaBets.settledAt,
      })
      .from(schema.arenaBets)
      .innerJoin(schema.arenas, eq(schema.arenaBets.arenaId, schema.arenas.id))
      .innerJoin(schema.agents, eq(schema.arenaBets.agentId, schema.agents.id))
      .where(eq(schema.arenaBets.userId, userId))
      .orderBy(desc(schema.arenaBets.placedAt));

    res.json({ bets });
  } catch {
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});
