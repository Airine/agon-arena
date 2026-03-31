import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq, and, count, sql, desc, asc } from 'drizzle-orm';
import type { AgentActionSubmission, ActionType, HandReplayResponse } from '@agon/types';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { apiError, ErrorCode } from '../middleware/error-response.js';
import {
  acceptSubmittedTurn,
  getCallAmount,
  getMaxRaise,
  getAgentRuntimeRoom,
} from '../services/agent-runtime.js';
import { getAgentPendingTurn, getAgentRuntimeSnapshot, getAgentLastProcessedTurnId, getRedisClient } from '../services/redis.js';
import {
  findSparringReplacementSeat,
} from '../services/arena-admission.js';
import {
  getResolvedArenaSnapshot,
  maybeFinalizeOrphanedRunningArena,
} from '../services/arena-lifecycle.js';
import { advanceHostedPracticeArena } from '../services/hosted-practice.js';
import { ipRateLimit } from '../middleware/rate-limit.js';
import { publishFunnelEvent } from '../services/kafka.js';

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
  gameType: z.enum(['texas_holdem', 'lob_market_making']).optional(),
  allowSparringReplacement: z.boolean().optional(),
  maxPlayers: z.number().int().min(2).max(10).optional(),
  smallBlind: z.number().int().min(1).optional(),
  bigBlind: z.number().int().min(2).optional(),
  startingStack: z.number().int().min(100).optional(),
  // maxHands: 0 = unlimited, >0 = fixed hand count
  maxHands: z.number().int().min(0).max(10000).optional(),
  // buyInAmount: CHIP cost to join; must be 0 for practice
  buyInAmount: z.number().int().min(0).optional(),
  isSmoke: z.boolean().optional(),
  // seed: optional deterministic seed for LOB arenas (enables replay)
  seed: z.number().int().optional(),
});

const runtimeQuerySchema = z.object({
  agentId: z.string().uuid(),
});

const submitActionSchema = z.object({
  agentId: z.string().uuid(),
  turnId: z.string().uuid(),
  action: z.enum(['fold', 'check', 'call', 'raise', 'all_in']),
  amount: z.number().int().positive().optional(),
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
    const allowSparringReplacement = body.allowSparringReplacement ?? false;
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
    if (body.mode !== 'practice' && allowSparringReplacement) {
      res.status(400).json({ error: 'Sparring replacement is only supported for practice arenas' });
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
        ...(body.gameType !== undefined ? { gameType: body.gameType } : {}),
        allowSparringReplacement,
        maxPlayers,
        smallBlind,
        bigBlind,
        startingStack,
        maxHands,
        buyInAmount,
        isSmoke: body.isSmoke ?? false,
        createdByUserId: req.user!.userId,
        ...(body.seed !== undefined && body.gameType === 'lob_market_making' ? { seed: body.seed } : {}),
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
 * POST /arenas/sandbox/create - Create a personal practice sandbox arena.
 * Rate-limited to 3 arenas per IP per hour.
 *
 * Creates a practice arena pre-configured for LOB market making:
 *   - tier: 'practice', isSmoke: true
 *   - gameType: 'lob_market_making', maxPlayers: 2
 *   - allowSparringReplacement: true (bot fills second seat)
 */
arenasRouter.post(
  '/sandbox/create',
  requireAuth,
  ipRateLimit(3600, 3, 'sandbox:create'),
  async (req, res) => {
    try {
      const userId = req.user!.userId;

      let labelName = `user:${userId.slice(0, 8)}`;
      if (req.user!.agentId) {
        const [agent] = await db
          .select({ name: schema.agents.name })
          .from(schema.agents)
          .where(eq(schema.agents.id, req.user!.agentId))
          .limit(1);
        if (agent) labelName = agent.name;
      }

      const arenaName = `Sandbox — ${labelName}`;

      const [arena] = await db
        .insert(schema.arenas)
        .values({
          name: arenaName,
          gameType: 'lob_market_making',
          mode: 'practice',
          tier: 'practice',
          isSmoke: true,
          allowSparringReplacement: true,
          maxPlayers: 2,
          smallBlind: 10,
          bigBlind: 20,
          startingStack: 1000,
          maxHands: 100,
          buyInAmount: 0,
          status: 'waiting',
          createdByUserId: userId,
        })
        .returning({ id: schema.arenas.id });

      res.status(201).json({
        arenaId: arena!.id,
        arenaUrl: `/markets/${arena!.id}`,
      });
    } catch (err) {
      console.error('[Sandbox] Create error:', err);
      res.status(500).json({ error: 'Failed to create sandbox arena' });
    }
  },
);

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
        allowSparringReplacement: schema.arenas.allowSparringReplacement,
        maxPlayers: schema.arenas.maxPlayers,
        smallBlind: schema.arenas.smallBlind,
        bigBlind: schema.arenas.bigBlind,
        startingStack: schema.arenas.startingStack,
        maxHands: schema.arenas.maxHands,
        buyInAmount: schema.arenas.buyInAmount,
        isSmoke: schema.arenas.isSmoke,
        spectatorCount: schema.arenas.spectatorCount,
        playerCount: sql<number>`COALESCE(${playerCountSq.playerCount}, 0)`.as('player_count'),
        createdByUserId: schema.arenas.createdByUserId,
        createdAt: schema.arenas.createdAt,
      })
      .from(schema.arenas)
      .leftJoin(playerCountSq, eq(schema.arenas.id, playerCountSq.arenaId))
      .$dynamic();

    const conditions = [];
    conditions.push(eq(schema.arenas.isSmoke, false));
    if (status && ['waiting', 'running', 'finished', 'cancelled'].includes(status)) {
      conditions.push(eq(schema.arenas.status, status as 'waiting' | 'running' | 'finished' | 'cancelled'));
    }
    if (mode && ['practice', 'cash', 'tournament'].includes(mode)) {
      conditions.push(eq(schema.arenas.mode, mode as 'practice' | 'cash' | 'tournament'));
    }
    query = query.where(conditions.length === 1 ? conditions[0]! : and(...conditions));

    const arenas = await query.limit(50);
    const arenasWithTier = arenas.map((a) => ({
      ...a,
      tier: a.mode === 'practice'
        ? 'practice'
        : a.mode === 'cash' && (a.buyInAmount ?? 0) === 0
        ? 'micro'
        : 'serious',
    }));
    res.json({ arenas: arenasWithTier });
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

    const reconciledArena = await maybeFinalizeOrphanedRunningArena(arena);

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
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.isActive, true),
      ))
      .orderBy(schema.arenaSeats.seatIndex);

    const tier = reconciledArena.mode === 'practice'
      ? 'practice'
      : reconciledArena.mode === 'cash' && (reconciledArena.buyInAmount ?? 0) === 0
      ? 'micro'
      : 'serious';
    res.json({ ...reconciledArena, tier, seats });
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
      .select({
        ownerId: schema.agents.ownerId,
        isActive: schema.agents.isActive,
        metadata: schema.agents.metadata,
      })
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
      .select({
        id: schema.arenaSeats.id,
        agentId: schema.arenaSeats.agentId,
        seatIndex: schema.arenaSeats.seatIndex,
        currentStack: schema.arenaSeats.currentStack,
        agentMetadata: schema.agents.metadata,
      })
      .from(schema.arenaSeats)
      .innerJoin(schema.agents, eq(schema.arenaSeats.agentId, schema.agents.id))
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.isActive, true),
      ));

    if (existingSeats.some((s) => s.agentId === agentId)) {
      res.status(409).json({ error: 'Agent already seated in this arena' });
      return;
    }

    const sparringSeat = findSparringReplacementSeat({
      allowSparringReplacement: arena.allowSparringReplacement,
      joiningAgentMetadata: agent.metadata,
      existingSeats,
    });

    if (sparringSeat) {
      const [seat] = await db
        .update(schema.arenaSeats)
        .set({
          agentId,
          currentStack: sparringSeat.currentStack,
          joinedAt: new Date(),
        })
        .where(eq(schema.arenaSeats.id, sparringSeat.id))
        .returning();

      await advanceHostedPracticeArena(arenaId);

      res.status(201).json({
        ...seat,
        replacedAgentId: sparringSeat.agentId,
        replacement: 'sparring',
      });
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

    await advanceHostedPracticeArena(arenaId);

    // Funnel: agent joined an arena seat
    publishFunnelEvent({
      eventType: 'agent_funnel',
      stage: 'arena_joined',
      agentId,
      userId: req.user!.userId,
      arenaId,
      ts: new Date().toISOString(),
    });

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
 * GET /arenas/:id/runtime?agentId=<uuid> - Get the private runtime snapshot for a seated agent.
 */
arenasRouter.get('/:id/runtime', requireAuth, async (req, res) => {
  try {
    const arenaId = String(req.params['id']);
    const { agentId } = runtimeQuerySchema.parse(req.query);

    if (req.user?.agentId !== agentId) {
      res.status(403).json({ error: 'This runtime snapshot is only available to the authenticated agent' });
      return;
    }

    const [seat] = await db
      .select({ agentId: schema.arenaSeats.agentId })
      .from(schema.arenaSeats)
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.agentId, agentId),
        eq(schema.arenaSeats.isActive, true),
      ))
      .limit(1);

    if (!seat) {
      res.status(404).json({ error: 'Agent is not seated in this arena' });
      return;
    }

    const snapshot = await getAgentRuntimeSnapshot(arenaId, agentId);
    const pendingTurn = await getAgentPendingTurn(arenaId, agentId);
    // Redis is the fast path; fall back to DB for durability across Redis restarts
    const redisLastTurnId = await getAgentLastProcessedTurnId(arenaId, agentId);
    let lastProcessedTurnId: string | null = redisLastTurnId;
    if (!lastProcessedTurnId) {
      const [seatRow] = await db
        .select({ lastProcessedTurnId: schema.arenaSeats.lastProcessedTurnId })
        .from(schema.arenaSeats)
        .where(and(
          eq(schema.arenaSeats.arenaId, arenaId),
          eq(schema.arenaSeats.agentId, agentId),
          eq(schema.arenaSeats.isActive, true),
        ))
        .limit(1);
      lastProcessedTurnId = seatRow?.lastProcessedTurnId ?? null;
    }

    res.json({
      snapshot: snapshot ?? {
        arenaId,
        agentId,
        handId: null,
        handNumber: 0,
        publicState: null,
        privateState: null,
        pendingTurn: pendingTurn && pendingTurn.status === 'pending'
          ? {
              turnId: pendingTurn.turnId,
              arenaId: pendingTurn.arenaId,
              handId: pendingTurn.handId,
              handNumber: pendingTurn.handNumber,
              agentId: pendingTurn.agentId,
              validActions: pendingTurn.validActions,
              deadlineMs: pendingTurn.deadlineMs,
              callAmount: pendingTurn.callAmount,
              minRaise: pendingTurn.minRaise,
              maxRaise: pendingTurn.maxRaise,
              state: pendingTurn.state,
              submitPath: pendingTurn.submitPath,
            }
          : null,
        updatedAt: Date.now(),
      },
      lastProcessedTurnId: lastProcessedTurnId ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch runtime snapshot' });
  }
});

/**
 * POST /arenas/:id/actions - Submit an action for the current pending turn.
 */
arenasRouter.post('/:id/actions', requireAuth, async (req, res) => {
  try {
    const arenaId = String(req.params['id']);
    const body = submitActionSchema.parse(req.body);

    if (req.user?.agentId !== body.agentId) {
      res.status(403).json(apiError(ErrorCode.FORBIDDEN, 'This action may only be submitted by the authenticated agent runtime'));
      return;
    }

    const result = await acceptSubmittedTurn(body as AgentActionSubmission, arenaId);
    if (!result.ok) {
      const code = result.status === 403 ? ErrorCode.FORBIDDEN
        : result.status === 409 ? ErrorCode.TURN_ALREADY_PROCESSED
        : result.status === 404 ? ErrorCode.AGENT_NOT_IN_ARENA
        : ErrorCode.INVALID_ACTION;
      res.status(result.status).json(apiError(code, result.error));
      return;
    }

    res.status(202).json({ accepted: true, turnId: result.turn.turnId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json(apiError(ErrorCode.INVALID_BODY, 'Validation failed', false, err.errors));
      return;
    }
    res.status(500).json(apiError(ErrorCode.INTERNAL_ERROR, 'Failed to submit action', true));
  }
});

/**
 * POST /arenas/:id/lob-actions - Submit a LOB action for the current pending tick.
 */
arenasRouter.post('/:id/lob-actions', requireAuth, async (req, res) => {
  const { id: arenaId } = req.params;

  const lobActionSchema = z.object({
    agentId: z.string().uuid(),
    turnId: z.string().uuid(),
    action: z.object({
      type: z.enum(['post_bid', 'post_ask', 'cancel', 'pass']),
      price: z.number().int().positive().max(1_000_000).optional(),
      qty: z.number().int().positive().max(10_000).optional(),
      orderId: z.string().uuid().optional(),
    }),
  });

  const body = lobActionSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json(apiError(ErrorCode.INVALID_ACTION, 'Invalid action', false, body.error.issues));
    return;
  }

  // Verify agent ownership
  if (req.user?.agentId !== body.data.agentId) {
    res.status(403).json(apiError(ErrorCode.FORBIDDEN, 'Not your agent'));
    return;
  }

  // Verify arena exists, is running, and the agent is seated
  const arenaIdStr = String(arenaId);
  try {
    const [arenaRow] = await db
      .select({ status: schema.arenas.status, gameType: schema.arenas.gameType })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaIdStr))
      .limit(1);
    if (!arenaRow) {
      res.status(404).json(apiError(ErrorCode.ARENA_NOT_FOUND, 'Arena not found'));
      return;
    }
    if (arenaRow.status !== 'running') {
      res.status(400).json(apiError(ErrorCode.INVALID_ACTION, 'Arena is not running'));
      return;
    }
    const [seat] = await db
      .select({ agentId: schema.arenaSeats.agentId })
      .from(schema.arenaSeats)
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaIdStr),
        eq(schema.arenaSeats.agentId, body.data.agentId),
        eq(schema.arenaSeats.isActive, true),
      ))
      .limit(1);
    if (!seat) {
      res.status(403).json(apiError(ErrorCode.AGENT_NOT_IN_ARENA, 'Agent is not seated in this arena'));
      return;
    }
  } catch {
    res.status(500).json(apiError(ErrorCode.INTERNAL_ERROR, 'Failed to validate arena seat', true));
    return;
  }

  // Store pending LOB action in Redis for the LOB orchestrator to pick up
  try {
    const redis = await getRedisClient();
    const key = `lob:pending:${arenaId}:${body.data.agentId}`;
    await redis.set(key, JSON.stringify({ turnId: body.data.turnId, action: body.data.action }), { EX: 30 });
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(500).json(apiError(ErrorCode.INTERNAL_ERROR, 'Failed to submit LOB action', true));
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

    // Public runtimes no longer need inbound webhook configuration.
    // The only networked seat detail still read here is the internal bot://
    // transport used for local bot shortcuts.
    const seats = await db
      .select({
        seatIndex: schema.arenaSeats.seatIndex,
        currentStack: schema.arenaSeats.currentStack,
        agentId: schema.agents.id,
        agentName: schema.agents.name,
        apiUrl: schema.agents.apiUrl,
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

    // Start the appropriate game loop based on game type
    if (arena.gameType === 'lob_market_making') {
      // Fetch ownerId for each seat (needed by LOB orchestrator for chip settlement)
      const lobSeats = await db
        .select({
          agentId: schema.agents.id,
          userId: schema.agents.ownerId,
          seatIndex: schema.arenaSeats.seatIndex,
        })
        .from(schema.arenaSeats)
        .innerJoin(schema.agents, eq(schema.arenaSeats.agentId, schema.agents.id))
        .where(and(
          eq(schema.arenaSeats.arenaId, arenaId),
          eq(schema.arenaSeats.isActive, true),
        ))
        .orderBy(schema.arenaSeats.seatIndex);

      const { startLOBGame } = await import('../services/lob-orchestrator.js');
      startLOBGame(arenaId, lobSeats, {
        startingCash: arena.startingStack,
      });
    } else {
      const { startGame } = await import('../services/orchestrator.js');
      startGame(arenaId, arena, seats);
    }

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
      .select({
        id: schema.arenas.id,
        status: schema.arenas.status,
        currentHandNumber: schema.arenas.currentHandNumber,
        startedAt: schema.arenas.startedAt,
        finishedAt: schema.arenas.finishedAt,
      })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);

    if (!arena) {
      res.status(404).json({ error: 'Arena not found' });
      return;
    }

    const { arena: reconciledArena, snapshot } = await getResolvedArenaSnapshot(arena);

    if (reconciledArena.status === 'waiting') {
      res.json({ snapshot: null, arenaStatus: 'waiting' });
      return;
    }

    res.json({ snapshot, arenaStatus: reconciledArena.status });
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

/**
 * GET /arenas/:id/hands/:handNumber/replay
 * Returns replay steps for a completed hand.
 */
arenasRouter.get('/:id/hands/:handNumber/replay', async (req, res) => {
  const arenaId = String(req.params['id']);
  const handNumber = parseInt(String(req.params['handNumber']), 10);
  if (isNaN(handNumber)) { res.status(400).json({ error: 'Invalid hand number' }); return; }

  try {
    const [hand] = await db
      .select({
        id: schema.gameHands.id,
        replaySteps: schema.gameHands.replaySteps,
        winnersJson: schema.gameHands.winnersJson,
        vrfSeed: schema.gameHands.vrfSeed,
      })
      .from(schema.gameHands)
      .where(and(
        eq(schema.gameHands.arenaId, arenaId),
        eq(schema.gameHands.handNumber, handNumber),
      ))
      .limit(1);

    if (!hand) { res.status(404).json({ error: 'Hand not found' }); return; }
    if (!hand.replaySteps?.length) { res.status(404).json({ error: 'Replay not available' }); return; }

    const startingStacks: Record<string, number> = {};
    const firstStep = hand.replaySteps[0];
    if (firstStep) {
      for (const ps of firstStep.playerStates) {
        startingStacks[ps.agentId] = ps.stack + (ps.bet ?? 0);
      }
    }

    res.json({
      arenaId,
      handNumber,
      startingStacks,
      steps: hand.replaySteps,
      winners: hand.winnersJson ?? [],
      vrfSeed: hand.vrfSeed ?? undefined,
    } satisfies HandReplayResponse);
  } catch {
    res.status(500).json({ error: 'Failed to fetch replay' });
  }
});

/**
 * POST /arenas/:id/hands/:handNumber/thinking
 * Allows a seated agent to upload thinking text for each step of a completed hand.
 * Must be called within 30 seconds of hand end.
 */
arenasRouter.post('/:id/hands/:handNumber/thinking', requireAuth, async (req, res) => {
  const arenaId = String(req.params['id']);
  const handNumber = parseInt(String(req.params['handNumber']), 10);
  if (isNaN(handNumber)) { res.status(400).json({ error: 'Invalid hand number' }); return; }

  const agentId = req.user?.agentId;
  if (!agentId) { res.status(403).json({ error: 'Agent auth required' }); return; }

  const bodySchema = z.object({
    steps: z.array(z.object({
      sequenceNumber: z.number().int().min(0),
      thinkingText: z.string().min(1).max(10_000),
    })).min(1).max(500),
  });

  try {
    const body = bodySchema.parse(req.body);

    // Verify agent is seated in this arena
    const [seat] = await db
      .select({ agentId: schema.arenaSeats.agentId })
      .from(schema.arenaSeats)
      .where(and(
        eq(schema.arenaSeats.arenaId, arenaId),
        eq(schema.arenaSeats.agentId, agentId),
      ))
      .limit(1);

    if (!seat) { res.status(403).json({ error: 'Not authorized for this arena' }); return; }

    // Check 30-second upload window
    const { handEndedAt } = await import('../services/orchestrator.js');
    const endedAt = handEndedAt.get(`${arenaId}:${handNumber}`);
    if (!endedAt || Date.now() - endedAt > 30_000) {
      res.status(410).json({ error: 'Thinking upload window expired' });
      return;
    }

    // Get the hand record
    const [hand] = await db
      .select({ id: schema.gameHands.id, replaySteps: schema.gameHands.replaySteps })
      .from(schema.gameHands)
      .where(and(
        eq(schema.gameHands.arenaId, arenaId),
        eq(schema.gameHands.handNumber, handNumber),
      ))
      .limit(1);

    if (!hand) { res.status(404).json({ error: 'Hand not found' }); return; }

    // Insert thinking records (idempotent)
    await db.insert(schema.agentThinking).values(
      body.steps.map((s) => ({
        handId: hand.id,
        arenaId,
        agentId,
        sequenceNumber: s.sequenceNumber,
        thinkingText: s.thinkingText,
      }))
    ).onConflictDoNothing();

    // Patch replaySteps with thinkingText inline
    if (hand.replaySteps?.length) {
      const updatedSteps = hand.replaySteps.map((step) => {
        const thinking = body.steps.find((s) => s.sequenceNumber === step.sequenceNumber);
        if (thinking) return { ...step, thinkingText: thinking.thinkingText };
        return step;
      });
      await db.update(schema.gameHands)
        .set({ replaySteps: updatedSteps })
        .where(eq(schema.gameHands.id, hand.id));
    }

    res.json({ ok: true, uploaded: body.steps.length });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to upload thinking' });
  }
});

/**
 * GET /arenas/:id/hands/:handNumber/thinking
 * Returns uploaded thinking text grouped by agentId.
 */
arenasRouter.get('/:id/hands/:handNumber/thinking', async (req, res) => {
  const arenaId = String(req.params['id']);
  const handNumber = parseInt(String(req.params['handNumber']), 10);
  if (isNaN(handNumber)) { res.status(400).json({ error: 'Invalid hand number' }); return; }

  try {
    const [hand] = await db
      .select({ id: schema.gameHands.id })
      .from(schema.gameHands)
      .where(and(
        eq(schema.gameHands.arenaId, arenaId),
        eq(schema.gameHands.handNumber, handNumber),
      ))
      .limit(1);

    if (!hand) { res.status(404).json({ error: 'Hand not found' }); return; }

    const thinkingRows = await db
      .select()
      .from(schema.agentThinking)
      .where(eq(schema.agentThinking.handId, hand.id))
      .orderBy(schema.agentThinking.sequenceNumber);

    const thinking: Record<string, Array<{ sequenceNumber: number; thinkingText: string }>> = {};
    for (const row of thinkingRows) {
      if (!thinking[row.agentId]) thinking[row.agentId] = [];
      thinking[row.agentId]!.push({
        sequenceNumber: row.sequenceNumber,
        thinkingText: row.thinkingText,
      });
    }

    res.json({ handNumber, thinking });
  } catch {
    res.status(500).json({ error: 'Failed to fetch thinking' });
  }
});

/**
 * GET /arenas/:id/turns?limit=200&offset=0
 * Paginated turn log for replay. Public.
 */
arenasRouter.get('/:id/turns', async (req, res) => {
  try {
    const arenaId = String(req.params['id']);

    const [arena] = await db
      .select({ id: schema.arenas.id })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);
    if (!arena) { res.status(404).json({ error: 'Arena not found' }); return; }

    const rawLimit = parseInt(String(req.query['limit'] ?? '200'), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? '0'), 10);
    const limit = Math.min(isNaN(rawLimit) ? 200 : rawLimit, 200);
    const offset = isNaN(rawOffset) ? 0 : rawOffset;

    const [totalRow] = await db
      .select({ total: count(schema.arenaTurnLog.id) })
      .from(schema.arenaTurnLog)
      .where(eq(schema.arenaTurnLog.arenaId, arenaId));

    const turns = await db
      .select({
        id: schema.arenaTurnLog.id,
        agentId: schema.arenaTurnLog.agentId,
        turnId: schema.arenaTurnLog.turnId,
        turnNumber: schema.arenaTurnLog.turnNumber,
        state: schema.arenaTurnLog.state,
        action: schema.arenaTurnLog.action,
        latencyMs: schema.arenaTurnLog.latencyMs,
        createdAt: schema.arenaTurnLog.createdAt,
      })
      .from(schema.arenaTurnLog)
      .where(eq(schema.arenaTurnLog.arenaId, arenaId))
      .orderBy(asc(schema.arenaTurnLog.turnNumber))
      .limit(limit)
      .offset(offset);

    res.json({ turns, total: totalRow?.total ?? 0 });
  } catch {
    res.status(500).json({ error: 'Failed to fetch turns' });
  }
});

/**
 * GET /arenas/:id/turns/:turnId
 * Single turn detail by UUID. Public.
 */
arenasRouter.get('/:id/turns/:turnId', async (req, res) => {
  try {
    const arenaId = String(req.params['id']);
    const turnId = String(req.params['turnId']);

    const [turn] = await db
      .select()
      .from(schema.arenaTurnLog)
      .where(and(
        eq(schema.arenaTurnLog.arenaId, arenaId),
        eq(schema.arenaTurnLog.turnId, turnId),
      ))
      .limit(1);

    if (!turn) { res.status(404).json({ error: 'Turn not found' }); return; }
    res.json(turn);
  } catch {
    res.status(500).json({ error: 'Failed to fetch turn' });
  }
});

/**
 * GET /arenas/:id/agents/:agentId/traces?limit=50
 * Agent error traces. Public.
 */
arenasRouter.get('/:id/agents/:agentId/traces', async (req, res) => {
  try {
    const arenaId = String(req.params['id']);
    const agentId = String(req.params['agentId']);

    const [arena] = await db
      .select({ id: schema.arenas.id })
      .from(schema.arenas)
      .where(eq(schema.arenas.id, arenaId))
      .limit(1);
    if (!arena) { res.status(404).json({ error: 'Arena not found' }); return; }

    const rawLimit = parseInt(String(req.query['limit'] ?? '50'), 10);
    const limit = Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100);

    const [totalRow] = await db
      .select({ total: count(schema.agentErrorLog.id) })
      .from(schema.agentErrorLog)
      .where(and(
        eq(schema.agentErrorLog.arenaId, arenaId),
        eq(schema.agentErrorLog.agentId, agentId),
      ));

    const traces = await db
      .select({
        id: schema.agentErrorLog.id,
        agentId: schema.agentErrorLog.agentId,
        turnId: schema.agentErrorLog.turnId,
        errorType: schema.agentErrorLog.errorType,
        details: schema.agentErrorLog.details,
        createdAt: schema.agentErrorLog.createdAt,
      })
      .from(schema.agentErrorLog)
      .where(and(
        eq(schema.agentErrorLog.arenaId, arenaId),
        eq(schema.agentErrorLog.agentId, agentId),
      ))
      .orderBy(desc(schema.agentErrorLog.createdAt))
      .limit(limit);

    res.json({ traces, total: totalRow?.total ?? 0 });
  } catch {
    res.status(500).json({ error: 'Failed to fetch traces' });
  }
});
