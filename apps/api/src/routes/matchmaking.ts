/**
 * AGO-32: Matchmaking API routes
 *
 * POST /matchmaking/join   — Join the queue for a specific arena mode
 * DELETE /matchmaking/leave — Leave all queues
 * GET /matchmaking/status  — Check queue position for authenticated agent
 */
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { joinQueue, leaveQueue, getQueueStatus } from '../services/matchmaking.js';

export const matchmakingRouter: RouterType = Router();

const joinQueueSchema = z.object({
  agentId: z.string().uuid(),
  mode: z.enum(['practice', 'cash', 'tournament']).default('practice'),
});

/**
 * POST /matchmaking/join
 * Body: { agentId: string, mode: 'practice' | 'cash' | 'tournament' }
 *
 * Queues the specified agent for auto-matching. The agent must be owned by the
 * authenticated user. Game starts within 60s (60s SLA guaranteed).
 */
matchmakingRouter.post('/join', requireAuth, async (req, res) => {
  try {
    const { agentId, mode } = joinQueueSchema.parse(req.body);

    // Verify agent ownership and fetch connection details
    const [agent] = await db
      .select({
        id: schema.agents.id,
        ownerId: schema.agents.ownerId,
        name: schema.agents.name,
        apiUrl: schema.agents.apiUrl,
        webhookPublicKey: schema.agents.webhookPublicKey,
        isActive: schema.agents.isActive,
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

    const joinedAt = Date.now();
    const tier =
      mode === 'practice' ? 'practice'
      : mode === 'cash' ? 'micro'
      : 'serious';
    await joinQueue(mode, {
      agentId: agent.id,
      userId: req.user!.userId,
      agentName: agent.name,
      apiUrl: agent.apiUrl,
      webhookPublicKey: agent.webhookPublicKey,
      joinedAt,
      tier,
    });

    res.status(202).json({
      message: 'Joined matchmaking queue',
      agentId,
      mode,
      joinedAt,
      estimatedWaitMs: 60_000, // 60s SLA
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to join queue' });
  }
});

/**
 * DELETE /matchmaking/leave
 * Body: { agentId: string }
 *
 * Remove the agent from all queues.
 */
matchmakingRouter.delete('/leave', requireAuth, async (req, res) => {
  try {
    const { agentId } = z.object({ agentId: z.string().uuid() }).parse(req.body);

    // Verify ownership before removing
    const [agent] = await db
      .select({ ownerId: schema.agents.ownerId })
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

    await leaveQueue(agentId);
    res.json({ message: 'Left matchmaking queue', agentId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to leave queue' });
  }
});

/**
 * GET /matchmaking/status?agentId=<uuid>
 *
 * Check the current queue position for an agent.
 */
matchmakingRouter.get('/status', requireAuth, async (req, res) => {
  try {
    const agentId = z.string().uuid().parse(req.query['agentId']);

    const [agent] = await db
      .select({ ownerId: schema.agents.ownerId })
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

    const status = await getQueueStatus(agentId);
    res.json({ agentId, ...status });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch queue status' });
  }
});
