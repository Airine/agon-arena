import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { eq, and, desc, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidEd25519PublicKey, getPlatformPublicKeyHex, isUrlSafe } from '../services/webhook-crypto.js';

export const agentsRouter: RouterType = Router();

/**
 * 7-field agent registration schema:
 * 1. name         - Display name (3-100 chars)
 * 2. description  - Short description (max 500 chars)
 * 3. apiUrl       - Webhook URL for receiving game actions
 * 4. webhookPublicKey - Ed25519 public key hex (64 chars = 32 bytes)
 * 5. avatarUrl    - Agent avatar image URL
 * 6. version      - AAP protocol version
 * 7. metadata     - Free-form JSON (framework, language, etc.)
 */
const createAgentSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  apiUrl: z.string().url(),
  webhookPublicKey: z.string().length(64).regex(/^[0-9a-f]{64}$/i, {
    message: 'Must be a 64-character hex-encoded Ed25519 public key',
  }),
  avatarUrl: z.string().url().max(500).optional(),
  version: z.string().max(20).default('1.0'),
  metadata: z.record(z.unknown()).optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional(),
  apiUrl: z.string().url().optional(),
  webhookPublicKey: z.string().length(64).regex(/^[0-9a-f]{64}$/i, {
    message: 'Must be a 64-character hex-encoded Ed25519 public key',
  }).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  version: z.string().max(20).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * POST /agents - Register a new agent.
 * Requires all 7 fields (some optional). Returns the agent record and a raw API key (shown once).
 */
agentsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const body = createAgentSchema.parse(req.body);

    // Validate the Ed25519 public key is actually usable
    if (!isValidEd25519PublicKey(body.webhookPublicKey)) {
      res.status(400).json({ error: 'Invalid Ed25519 public key' });
      return;
    }

    // SSRF protection: block private/internal URLs
    if (!isUrlSafe(body.apiUrl)) {
      res.status(400).json({ error: 'apiUrl must be a public HTTP(S) URL (private/internal IPs are blocked)' });
      return;
    }

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
        webhookPublicKey: body.webhookPublicKey,
        avatarUrl: body.avatarUrl ?? null,
        version: body.version,
        metadata: body.metadata ?? null,
      })
      .returning();

    res.status(201).json({
      agent: {
        id: agent!.id,
        name: agent!.name,
        description: agent!.description,
        apiUrl: agent!.apiUrl,
        webhookPublicKey: agent!.webhookPublicKey,
        avatarUrl: agent!.avatarUrl,
        version: agent!.version,
        metadata: agent!.metadata,
        eloRating: agent!.eloRating,
        isActive: agent!.isActive,
        createdAt: agent!.createdAt,
      },
      apiKey: rawApiKey, // Only shown once
      platformPublicKey: getPlatformPublicKeyHex(), // Platform's Ed25519 public key for verifying webhooks
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
agentsRouter.get('/:id', async (req, res) => {
  try {
    const [agent] = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        description: schema.agents.description,
        ownerId: schema.agents.ownerId,
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

    // Validate Ed25519 key if being updated
    if (body.webhookPublicKey && !isValidEd25519PublicKey(body.webhookPublicKey)) {
      res.status(400).json({ error: 'Invalid Ed25519 public key' });
      return;
    }

    // SSRF protection on URL update
    if (body.apiUrl && !isUrlSafe(body.apiUrl)) {
      res.status(400).json({ error: 'apiUrl must be a public HTTP(S) URL (private/internal IPs are blocked)' });
      return;
    }

    const [updated] = await db
      .update(schema.agents)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.apiUrl !== undefined && { apiUrl: body.apiUrl }),
        ...(body.webhookPublicKey !== undefined && { webhookPublicKey: body.webhookPublicKey }),
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
        apiUrl: schema.agents.apiUrl,
        webhookPublicKey: schema.agents.webhookPublicKey,
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
agentsRouter.get('/:id/matches', async (req, res) => {
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
