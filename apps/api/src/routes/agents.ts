import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const agentsRouter: RouterType = Router();

const createAgentSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  apiUrl: z.string().url(),
});

const updateAgentSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional(),
  apiUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
});

/**
 * POST /agents - Register a new agent.
 * Returns the agent record and a raw API key (shown once).
 */
agentsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const body = createAgentSchema.parse(req.body);

    // Generate API key: agon_<random hex>
    const rawApiKey = `agon_${crypto.randomBytes(32).toString('hex')}`;
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    const [agent] = await db
      .insert(schema.agents)
      .values({
        ownerId: req.user!.userId,
        name: body.name,
        description: body.description ?? null,
        apiUrl: body.apiUrl,
        apiKeyHash,
      })
      .returning();

    res.status(201).json({
      agent: {
        id: agent!.id,
        name: agent!.name,
        description: agent!.description,
        apiUrl: agent!.apiUrl,
        eloRating: agent!.eloRating,
        isActive: agent!.isActive,
        createdAt: agent!.createdAt,
      },
      apiKey: rawApiKey, // Only shown once
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
agentsRouter.get('/', async (req, res) => {
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
agentsRouter.get('/:id', async (req, res) => {
  try {
    const [agent] = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        description: schema.agents.description,
        ownerId: schema.agents.ownerId,
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
 * PUT /agents/:id - Update agent. Owner only.
 */
agentsRouter.put('/:id', requireAuth, async (req, res) => {
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
        ...(body.apiUrl !== undefined && { apiUrl: body.apiUrl }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, agentId))
      .returning({
        id: schema.agents.id,
        name: schema.agents.name,
        description: schema.agents.description,
        apiUrl: schema.agents.apiUrl,
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
 * DELETE /agents/:id - Soft-delete (deactivate). Owner only.
 */
agentsRouter.delete('/:id', requireAuth, async (req, res) => {
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
