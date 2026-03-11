import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { chipService } from '../services/chip.js';
import { db, schema } from '../db/index.js';

const router = Router();

const distributePrizeSchema = z.object({
  amount: z.number().int().positive(),
  referenceId: z.string().min(1).max(100),
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

export { router as agentsRouter };
