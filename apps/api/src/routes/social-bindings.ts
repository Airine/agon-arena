/**
 * AGO-63: Social bindings management API
 *
 * Provides authenticated endpoints for managing social account bindings:
 *   GET  /auth/social/bindings            — list current user's bindings + CHIP status
 *   DELETE /auth/social/bindings/:provider — unlink a social account
 *
 * Binding initiation (OAuth redirect) is handled per-provider:
 *   GET /auth/github  → github-oauth.ts (AGO-55)
 *   GET /auth/google  → google-oauth.ts (AGO-56)
 *
 * CHIP rewards by provider:
 *   github  → +500 CHIP (one-time, on first bind)
 *   google  → +200 CHIP
 *   twitter → +300 CHIP
 *   ens     → +500 CHIP
 */

import { Router, type Router as RouterType } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { SOCIAL_BINDING_REWARDS } from '../services/chip.js';

export const socialBindingsRouter: RouterType = Router();

// All routes require authentication
socialBindingsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /auth/social/bindings
// Returns all social bindings for the current user, with CHIP reward status.
// ---------------------------------------------------------------------------

socialBindingsRouter.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId;

    const bindings = await db
      .select({
        id: schema.socialBindings.id,
        provider: schema.socialBindings.provider,
        providerUserId: schema.socialBindings.providerUserId,
        providerUsername: schema.socialBindings.providerUsername,
        providerEmail: schema.socialBindings.providerEmail,
        chipRewarded: schema.socialBindings.chipRewarded,
        createdAt: schema.socialBindings.createdAt,
      })
      .from(schema.socialBindings)
      .where(eq(schema.socialBindings.userId, userId));

    // Annotate each binding with the reward amount for context
    const enriched = bindings.map((b) => ({
      ...b,
      chipRewardAmount: SOCIAL_BINDING_REWARDS[b.provider] ?? 0,
    }));

    // Available providers not yet bound (to guide users toward more rewards)
    const boundProviders = new Set(bindings.map((b) => b.provider));
    const availableProviders = Object.keys(SOCIAL_BINDING_REWARDS).filter(
      (p) => !boundProviders.has(p as typeof schema.socialBindings.$inferSelect.provider),
    );

    res.json({
      bindings: enriched,
      availableProviders,
      totalChipFromBindings: enriched
        .filter((b) => b.chipRewarded)
        .reduce((sum, b) => sum + b.chipRewardAmount, 0),
    });
  } catch (err) {
    console.error('[SocialBindings] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch social bindings' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /auth/social/bindings/:provider
// Unlink a social provider from the current user's account.
// Does NOT refund CHIP rewards.
// ---------------------------------------------------------------------------

socialBindingsRouter.delete('/:provider', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { provider } = req.params;

    // Validate provider
    const validProviders = Object.keys(SOCIAL_BINDING_REWARDS);
    if (!validProviders.includes(provider)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
      return;
    }

    const [deleted] = await db
      .delete(schema.socialBindings)
      .where(
        and(
          eq(schema.socialBindings.userId, userId),
          eq(schema.socialBindings.provider, provider as typeof schema.socialBindings.$inferSelect.provider),
        ),
      )
      .returning({ id: schema.socialBindings.id, provider: schema.socialBindings.provider });

    if (!deleted) {
      res.status(404).json({ error: `No ${provider} binding found for this account` });
      return;
    }

    res.json({
      unlinked: true,
      provider: deleted.provider,
      note: 'CHIP rewards already distributed are not refunded',
    });
  } catch (err) {
    console.error('[SocialBindings] DELETE error:', err);
    res.status(500).json({ error: 'Failed to unlink social account' });
  }
});
