import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq, and, desc, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { chipService } from '../services/chip.js';

const router: RouterType = Router();

/**
 * 7-field agent registration schema:
 * 1. name         - Display name (3-100 chars)
 * 2. description  - Short description (max 500 chars)
 * 3. avatarUrl    - Agent avatar image URL
 * 4. version      - Runtime contract version
 * 5. metadata     - Free-form JSON (framework, language, etc.)
 */
const createAgentSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  version: z.string().max(20).default('1.0'),
  metadata: z.record(z.unknown()).optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  version: z.string().max(20).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  isActive: z.boolean().optional(),
});

const distributePrizeSchema = z.object({
  amount: z.number().int().positive(),
  referenceId: z.string().min(1).max(100),
});

/**
 * POST /agents - Register a new agent metadata record.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const body = createAgentSchema.parse(req.body);

    const [agent] = await db
      .insert(schema.agents)
      .values({
        ownerId: req.user!.userId,
        creatorUserId: req.user!.userId,
        agentAddress: null,
        name: body.name,
        description: body.description ?? null,
        apiUrl: null,
        apiKeyHash: null,
        webhookPublicKey: null,
        avatarUrl: body.avatarUrl ?? null,
        version: body.version,
        metadata: body.metadata ?? null,
      })
      .returning();

    res.status(201).json({
      agent: {
        id: agent!.id,
        ownerId: agent!.ownerId,
        creatorUserId: agent!.creatorUserId,
        agentAddress: agent!.agentAddress,
        name: agent!.name,
        description: agent!.description,
        avatarUrl: agent!.avatarUrl,
        version: agent!.version,
        metadata: agent!.metadata,
        eloRating: agent!.eloRating,
        isActive: agent!.isActive,
        createdAt: agent!.createdAt,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

/**
 * GET /agents - List agents. Optional ?ownerId= filter.
 */
router.get('/', async (req, res) => {
  try {
    const ownerId = req.query['ownerId'] as string | undefined;

    const conditions = [eq(schema.agents.isActive, true)];
    if (ownerId) {
      conditions.push(eq(schema.agents.ownerId, ownerId));
    }

    const agents = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        description: schema.agents.description,
        ownerId: schema.agents.ownerId,
        creatorUserId: schema.agents.creatorUserId,
        agentAddress: schema.agents.agentAddress,
        avatarUrl: schema.agents.avatarUrl,
        version: schema.agents.version,
        eloRating: schema.agents.eloRating,
        handsPlayed: schema.agents.handsPlayed,
        handsWon: schema.agents.handsWon,
        totalChipsWon: schema.agents.totalChipsWon,
        createdAt: schema.agents.createdAt,
      })
      .from(schema.agents)
      .where(and(...conditions))
      .orderBy(desc(schema.agents.eloRating))
      .limit(50);

    res.json({ agents });
  } catch {
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

/**
 * GET /agents/:id - Get agent details with stats.
 */
router.get('/:id', async (req, res) => {
  try {
    const [agent] = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        description: schema.agents.description,
        ownerId: schema.agents.ownerId,
        creatorUserId: schema.agents.creatorUserId,
        agentAddress: schema.agents.agentAddress,
        avatarUrl: schema.agents.avatarUrl,
        version: schema.agents.version,
        metadata: schema.agents.metadata,
        eloRating: schema.agents.eloRating,
        handsPlayed: schema.agents.handsPlayed,
        handsWon: schema.agents.handsWon,
        totalChipsWon: schema.agents.totalChipsWon,
        isActive: schema.agents.isActive,
        createdAt: schema.agents.createdAt,
      })
      .from(schema.agents)
      .where(eq(schema.agents.id, String(req.params['id'])))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(agent);
  } catch {
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

/**
 * POST /agents/:agentId/distribute-prize
 * Distribute a competition prize up the agent ownership chain (FR-AGT-W021).
 * Only the root owner (JWT userId == agent.ownerId at the top of the chain) may call this.
 * In production, the game engine calls this automatically after hand resolution.
 */
router.post('/:agentId/distribute-prize', requireAuth, async (req, res) => {
  try {
    const { agentId } = req.params as { agentId: string };
    const parsed = distributePrizeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const { amount, referenceId } = parsed.data;

    const [agent] = await db
      .select({ ownerId: schema.agents.ownerId })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Only the immediate owner of the agent may trigger distribution
    if (agent.ownerId !== (req as any).user.userId) {
      res.status(403).json({ error: 'Forbidden: not the agent owner' });
      return;
    }

    const result = await chipService.distributePrizeCascade(agentId, amount, referenceId);
    res.json(result);
  } catch (err: unknown) {
    console.error('distribute-prize error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /agents/:id - Update agent. Owner only.
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const body = updateAgentSchema.parse(req.body);
    const agentId = String(req.params['id']);

    // Verify ownership
    const [existing] = await db
      .select({ ownerId: schema.agents.ownerId })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (existing.ownerId !== req.user!.userId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const [updated] = await db
      .update(schema.agents)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
        ...(body.version !== undefined && { version: body.version }),
        ...(body.metadata !== undefined && { metadata: body.metadata }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, agentId))
      .returning({
        id: schema.agents.id,
        name: schema.agents.name,
        description: schema.agents.description,
        ownerId: schema.agents.ownerId,
        creatorUserId: schema.agents.creatorUserId,
        agentAddress: schema.agents.agentAddress,
        avatarUrl: schema.agents.avatarUrl,
        version: schema.agents.version,
        metadata: schema.agents.metadata,
        eloRating: schema.agents.eloRating,
        isActive: schema.agents.isActive,
        updatedAt: schema.agents.updatedAt,
      });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

/**
 * GET /agents/:id/matches - List arenas the agent has participated in.
 * Returns finished and running arenas with the agent's final stack and profit.
 */
router.get('/:id/matches', async (req, res) => {
  try {
    const agentId = String(req.params['id']);

    // Verify agent exists
    const [agent] = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const rows = await db
      .select({
        arenaId: schema.arenas.id,
        arenaName: schema.arenas.name,
        mode: schema.arenas.mode,
        status: schema.arenas.status,
        startingStack: schema.arenas.startingStack,
        finalStack: schema.arenaSeats.currentStack,
        finishedAt: schema.arenas.finishedAt,
        createdAt: schema.arenas.createdAt,
      })
      .from(schema.arenaSeats)
      .innerJoin(schema.arenas, eq(schema.arenaSeats.arenaId, schema.arenas.id))
      .where(
        and(
          eq(schema.arenaSeats.agentId, agentId),
          or(
            eq(schema.arenas.status, 'finished'),
            eq(schema.arenas.status, 'running'),
          ),
        ),
      )
      .orderBy(desc(schema.arenas.createdAt))
      .limit(20);

    const matches = rows.map((r) => ({
      ...r,
      profit: r.finalStack - r.startingStack,
    }));

    res.json({ matches });
  } catch {
    res.status(500).json({ error: 'Failed to fetch match history' });
  }
});

/**
 * DELETE /agents/:id - Soft-delete (deactivate). Owner only.
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const agentId = String(req.params['id']);

    const [existing] = await db
      .select({ ownerId: schema.agents.ownerId })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (existing.ownerId !== req.user!.userId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    await db
      .update(schema.agents)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.agents.id, agentId));

    res.json({ message: 'Agent deactivated' });
  } catch {
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

export { router as agentsRouter };
