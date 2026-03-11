import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq, and, count, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getGameSnapshot } from '../services/redis.js';

export const arenasRouter: RouterType = Router();

const createArenaSchema = z.object({
  name: z.string().min(3).max(100),
  maxPlayers: z.number().int().min(2).max(10).default(6),
  smallBlind: z.number().int().min(1).default(10),
  bigBlind: z.number().int().min(2).default(20),
  startingStack: z.number().int().min(100).default(1000),
});

/**
 * POST /arenas - Create a new arena. Requires auth.
 */
arenasRouter.post('/', requireAuth, async (req, res) => {
  try {
    const body = createArenaSchema.parse(req.body);

    if (body.bigBlind <= body.smallBlind) {
      res.status(400).json({ error: 'Big blind must be greater than small blind' });
      return;
    }

    const [arena] = await db
      .insert(schema.arenas)
      .values({
        name: body.name,
        maxPlayers: body.maxPlayers,
        smallBlind: body.smallBlind,
        bigBlind: body.bigBlind,
        startingStack: body.startingStack,
        createdByUserId: req.user!.userId,
      })
      .returning();

    res.status(201).json(arena);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to create arena' });
  }
});

/**
 * GET /arenas - List arenas. Optional ?status= filter.
 */
arenasRouter.get('/', async (req, res) => {
  try {
    const status = req.query['status'] as string | undefined;

    // Subquery for player count
    const playerCountSq = db
      .select({
        arenaId: schema.arenaSeats.arenaId,
        playerCount: count(schema.arenaSeats.id).as('player_count'),
      })
      .from(schema.arenaSeats)
      .where(eq(schema.arenaSeats.isActive, true))
      .groupBy(schema.arenaSeats.arenaId)
      .as('seat_counts');

    let query = db
      .select({
        id: schema.arenas.id,
        name: schema.arenas.name,
        gameType: schema.arenas.gameType,
        status: schema.arenas.status,
        maxPlayers: schema.arenas.maxPlayers,
        smallBlind: schema.arenas.smallBlind,
        bigBlind: schema.arenas.bigBlind,
        startingStack: schema.arenas.startingStack,
        spectatorCount: schema.arenas.spectatorCount,
        playerCount: sql<number>`COALESCE(${playerCountSq.playerCount}, 0)`.as('player_count'),
        createdAt: schema.arenas.createdAt,
      })
      .from(schema.arenas)
      .leftJoin(playerCountSq, eq(schema.arenas.id, playerCountSq.arenaId))
      .$dynamic();

    if (status && ['waiting', 'running', 'finished', 'cancelled'].includes(status)) {
      query = query.where(eq(schema.arenas.status, status as 'waiting' | 'running' | 'finished' | 'cancelled'));
    }

    const arenas = await query.limit(50);
    res.json({ arenas });
  } catch {
    res.status(500).json({ error: 'Failed to list arenas' });
  }
});

/**
 * GET /arenas/:id - Get arena details with seated agents.
 */
arenasRouter.get('/:id', async (req, res) => {
  try {
    const arenaId = String(req.params['id']);

    const [arena] = await db
      .select()
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    const seats = await db
      .select({
        seatIndex: schema.arenaSeats.seatIndex,
        currentStack: schema.arenaSeats.currentStack,
        isActive: schema.arenaSeats.isActive,
        agentId: schema.agents.id,
        agentName: schema.agents.name,
        eloRating: schema.agents.eloRating,
      })
      .from(schema.arenaSeats)
      .innerJoin(schema.agents, eq(schema.arenaSeats.agentId, schema.agents.id))
      .where(eq(schema.arenaSeats.arenaId, arenaId))
      .orderBy(schema.arenaSeats.seatIndex);

    res.json({ ...arena, seats });
  } catch {
    res.status(500).json({ error: 'Failed to fetch arena' });
  }
});

/**
 * POST /arenas/:id/join - Seat an agent in the arena.
 * Body: { agentId: string }
 */
arenasRouter.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const arenaId = String(req.params['id']);
    const { agentId } = z.object({ agentId: z.string().uuid() }).parse(req.body);

    // Verify agent ownership
    const [agent] = await db
      .select({ ownerId: schema.agents.ownerId, isActive: schema.agents.isActive })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (agent.ownerId !== req.user!.userId) {
      res.status(403).json({ error: 'Not your agent' });
      return;
    }
    if (!agent.isActive) {
      res.status(400).json({ error: 'Agent is deactivated' });
      return;
    }

    // Check arena status
    const [arena] = await db
      .select()
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }
    if (arena.status !== 'waiting') {
      res.status(400).json({ error: 'Arena is not accepting players' });
      return;
    }

    // Check if agent already seated
    const existingSeats = await db
      .select()
      .from(schema.arenaSeats)
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.isActive, true),
      ));

    if (existingSeats.some((s) => s.agentId === agentId)) {
      res.status(409).json({ error: 'Agent already seated in this arena' });
      return;
    }

    if (existingSeats.length >= arena.maxPlayers) {
      res.status(400).json({ error: 'Arena is full' });
      return;
    }

    // Find next available seat index
    const takenSeats = new Set(existingSeats.map((s) => s.seatIndex));
    let seatIndex = 0;
    while (takenSeats.has(seatIndex)) seatIndex++;

    const [seat] = await db
      .insert(schema.arenaSeats)
      .values({
        arenaId,
        agentId,
        seatIndex,
        currentStack: arena.startingStack,
      })
      .returning();

    res.status(201).json(seat);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to join arena' });
  }
});

/**
 * POST /arenas/:id/start - Start the game. Creator only, requires at least 2 players.
 */
arenasRouter.post('/:id/start', requireAuth, async (req, res) => {
  try {
    const arenaId = String(req.params['id']);

    const [arena] = await db
      .select()
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }
    if (arena.createdByUserId !== req.user!.userId) {
      res.status(403).json({ error: 'Only the arena creator can start the game' });
      return;
    }
    if (arena.status !== 'waiting') {
      res.status(400).json({ error: 'Arena is not in waiting status' });
      return;
    }

    // Get seated agents (include webhookPublicKey for Ed25519 verification)
    const seats = await db
      .select({
        seatIndex: schema.arenaSeats.seatIndex,
        currentStack: schema.arenaSeats.currentStack,
        agentId: schema.agents.id,
        agentName: schema.agents.name,
        apiUrl: schema.agents.apiUrl,
        webhookPublicKey: schema.agents.webhookPublicKey,
      })
      .from(schema.arenaSeats)
      .innerJoin(schema.agents, eq(schema.arenaSeats.agentId, schema.agents.id))
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.isActive, true),
      ))
      .orderBy(schema.arenaSeats.seatIndex);

    if (seats.length < 2) {
      res.status(400).json({ error: 'Need at least 2 agents to start' });
      return;
    }

    // Update arena status to running
    await db
      .update(schema.arenas)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(schema.arenas.id, arenaId));

    // Import orchestrator and start the game asynchronously
    const { startGame } = await import('../services/orchestrator.js');
    startGame(arenaId, arena, seats);

    res.json({ message: 'Game started', arenaId, playerCount: seats.length });
  } catch {
    res.status(500).json({ error: 'Failed to start game' });
  }
});

/**
 * GET /arenas/:id/snapshot - Get current game state snapshot for reconnecting spectators.
 * Reads from Redis cache for < 200ms response time.
 */
arenasRouter.get('/:id/snapshot', async (req, res) => {
  try {
    const arenaId = String(req.params['id']);

    const [arena] = await db
      .select({ id: schema.arenas.id, status: schema.arenas.status })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    if (arena.status === 'waiting') {
      res.json({ snapshot: null, arenaStatus: 'waiting' });
      return;
    }

    const snapshot = await getGameSnapshot(arenaId);
    res.json({ snapshot, arenaStatus: arena.status });
  } catch {
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});
