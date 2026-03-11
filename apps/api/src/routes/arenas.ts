import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq, and, count, sql, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getGameSnapshot } from '../services/redis.js';

export const arenasRouter: RouterType = Router();

// Mode-specific defaults and constraints
const MODE_DEFAULTS = {
  practice:   { maxHands: 100, buyInAmount: 0, startingStack: 1000, minPlayers: 2 },
  cash:       { maxHands: 0,   buyInAmount: 0, startingStack: 1000, minPlayers: 2 },
  tournament: { maxHands: 0,   buyInAmount: 1000, startingStack: 5000, minPlayers: 3 },
} as const;

const createArenaSchema = z.object({
  name: z.string().min(3).max(100),
  mode: z.enum(['practice', 'cash', 'tournament']).default('practice'),
  maxPlayers: z.number().int().min(2).max(10).optional(),
  smallBlind: z.number().int().min(1).optional(),
  bigBlind: z.number().int().min(2).optional(),
  startingStack: z.number().int().min(100).optional(),
  // maxHands: 0 = unlimited, >0 = fixed hand count
  maxHands: z.number().int().min(0).max(10000).optional(),
  // buyInAmount: CHIP cost to join; must be 0 for practice
  buyInAmount: z.number().int().min(0).optional(),
});

/**
 * POST /arenas - Create a new arena. Requires auth.
 *
 * Modes:
 *   practice   - Free virtual chips (no CHIP buy-in), limited to maxHands (default 100)
 *   cash       - Standard cash game; buyInAmount CHIP to join, unlimited hands
 *   tournament - Fixed buy-in elimination format; minPlayers=3, prize pool at end
 */
arenasRouter.post('/', requireAuth, async (req, res) => {
  try {
    const body = createArenaSchema.parse(req.body);
    const defaults = MODE_DEFAULTS[body.mode];

    const maxPlayers = body.maxPlayers ?? 6;
    const smallBlind = body.smallBlind ?? 10;
    const bigBlind = body.bigBlind ?? 20;
    const startingStack = body.startingStack ?? defaults.startingStack;
    const maxHands = body.maxHands ?? defaults.maxHands;
    const buyInAmount = body.buyInAmount ?? defaults.buyInAmount;

    if (bigBlind <= smallBlind) {
      res.status(400).json({ error: 'Big blind must be greater than small blind' });
      return;
    }
    if (body.mode === 'practice' && buyInAmount > 0) {
      res.status(400).json({ error: 'Practice arenas cannot have a buy-in amount' });
      return;
    }
    if (body.mode === 'tournament' && maxPlayers < 3) {
      res.status(400).json({ error: 'Tournament arenas require at least 3 players' });
      return;
    }
    if (body.mode === 'tournament' && buyInAmount < 100) {
      res.status(400).json({ error: 'Tournament buy-in must be at least 100 CHIP' });
      return;
    }

    const [arena] = await db
      .insert(schema.arenas)
      .values({
        name: body.name,
        mode: body.mode,
        maxPlayers,
        smallBlind,
        bigBlind,
        startingStack,
        maxHands,
        buyInAmount,
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
 * GET /arenas - List arenas. Optional ?status= and ?mode= filters.
 */
arenasRouter.get('/', async (req, res) => {
  try {
    const status = req.query['status'] as string | undefined;
    const mode = req.query['mode'] as string | undefined;

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
        mode: schema.arenas.mode,
        status: schema.arenas.status,
        maxPlayers: schema.arenas.maxPlayers,
        smallBlind: schema.arenas.smallBlind,
        bigBlind: schema.arenas.bigBlind,
        startingStack: schema.arenas.startingStack,
        maxHands: schema.arenas.maxHands,
        buyInAmount: schema.arenas.buyInAmount,
        spectatorCount: schema.arenas.spectatorCount,
        playerCount: sql<number>`COALESCE(${playerCountSq.playerCount}, 0)`.as('player_count'),
        createdAt: schema.arenas.createdAt,
      })
      .from(schema.arenas)
      .leftJoin(playerCountSq, eq(schema.arenas.id, playerCountSq.arenaId))
      .$dynamic();

    const conditions = [];
    if (status && ['waiting', 'running', 'finished', 'cancelled'].includes(status)) {
      conditions.push(eq(schema.arenas.status, status as 'waiting' | 'running' | 'finished' | 'cancelled'));
    }
    if (mode && ['practice', 'cash', 'tournament'].includes(mode)) {
      conditions.push(eq(schema.arenas.mode, mode as 'practice' | 'cash' | 'tournament'));
    }
    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0]! : and(...conditions));
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

/**
 * GET /arenas/:id/hands - List hands played in an arena with VRF commit-reveal data.
 * Returns up to 100 most recent hands. vrfSeed is revealed after each hand completes.
 */
arenasRouter.get('/:id/hands', async (req, res) => {
  try {
    const arenaId = String(req.params['id']);

    const [arena] = await db
      .select({ id: schema.arenas.id })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    const hands = await db
      .select({
        id: schema.gameHands.id,
        handNumber: schema.gameHands.handNumber,
        stage: schema.gameHands.stage,
        potAmount: schema.gameHands.potAmount,
        winnersJson: schema.gameHands.winnersJson,
        vrfCommit: schema.gameHands.vrfCommit,
        vrfSeed: schema.gameHands.vrfSeed,
        vrfSignature: schema.gameHands.vrfSignature,
        startedAt: schema.gameHands.startedAt,
        endedAt: schema.gameHands.endedAt,
      })
      .from(schema.gameHands)
      .where(eq(schema.gameHands.arenaId, arenaId))
      .orderBy(desc(schema.gameHands.handNumber))
      .limit(100);

    res.json({ arenaId, hands, count: hands.length });
  } catch {
    res.status(500).json({ error: 'Failed to fetch hands' });
  }
});

/**
 * DELETE /arenas/:id - Cancel a waiting arena. Creator only.
 * Running arenas cannot be cancelled (must finish naturally).
 */
arenasRouter.delete('/:id', requireAuth, async (req, res) => {
  try {
    const arenaId = String(req.params['id']);

    const [arena] = await db
      .select({ id: schema.arenas.id, status: schema.arenas.status, createdByUserId: schema.arenas.createdByUserId })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }
    if (arena.createdByUserId !== req.user!.userId) {
      res.status(403).json({ error: 'Only the arena creator can cancel it' });
      return;
    }
    if (arena.status === 'running') {
      res.status(400).json({ error: 'Cannot cancel a running arena' });
      return;
    }
    if (arena.status === 'finished' || arena.status === 'cancelled') {
      res.status(400).json({ error: `Arena is already ${arena.status}` });
      return;
    }

    await db
      .update(schema.arenas)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(schema.arenas.id, arenaId));

    res.json({ message: 'Arena cancelled', arenaId });
  } catch {
    res.status(500).json({ error: 'Failed to cancel arena' });
  }
});
