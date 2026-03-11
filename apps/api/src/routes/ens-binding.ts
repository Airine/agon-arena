/**
 * AGO-66: ENS domain verification binding (+500 CHIP reward)
 *
 * Flow (NOT OAuth — wallet ownership proof via ENS resolution):
 *   POST /auth/ens/verify
 *     1. Require auth (JWT from SIWE login — must have walletAddress)
 *     2. Validate ENS name format (*.eth)
 *     3. Check user has walletAddress (SIWE required)
 *     4. Check user doesn't already have an ENS binding
 *     5. Check the ENS name isn't already claimed by another user
 *     6. Resolve ENS name → Ethereum address via viem + public RPC
 *     7. Compare resolved address to user's walletAddress (case-insensitive)
 *     8. Insert social_bindings row (provider='ens')
 *     9. Call chipService.allocateSocialBindingReward() → +500 CHIP
 *    10. Return { bound, ensName, chipAwarded, chipAmount }
 *
 * Security:
 *   - walletAddress ownership proven by SIWE (JWT contains walletAddress)
 *   - ENS resolution via viem mainnet public RPC (cloudflare-eth.com fallback)
 *   - One ENS binding per user (unique constraint: userId + provider)
 *   - One user per ENS name (unique constraint: provider + providerUserId)
 *   - CHIP reward is idempotent via chipRewarded flag
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { chipService } from '../services/chip.js';

export const ensBindingRouter: RouterType = Router();

// All routes require authentication
ensBindingRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// ENS resolution via viem
// ---------------------------------------------------------------------------

function getEthRpcUrl(): string {
  return process.env['ETH_RPC_URL'] ?? 'https://cloudflare-eth.com';
}

/**
 * Resolve an ENS name to an Ethereum address using viem + public mainnet RPC.
 * Returns the checksummed address, or null if the name doesn't resolve.
 */
export async function resolveEnsAddress(ensName: string): Promise<string | null> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(getEthRpcUrl()),
    });

    const address = await client.getEnsAddress({
      name: normalize(ensName),
    });

    return address ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const verifyBodySchema = z.object({
  // ENS name: must end in .eth, label part 3-100 chars
  ensName: z
    .string()
    .min(5, 'ENS name too short')
    .max(104, 'ENS name too long')
    .regex(/^[a-zA-Z0-9-]+\.eth$/, 'ENS name must be a valid *.eth name (e.g. alice.eth)'),
});

// ---------------------------------------------------------------------------
// POST /auth/ens/verify
// ---------------------------------------------------------------------------

ensBindingRouter.post('/verify', async (req, res) => {
  try {
    // 1. Validate request body
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid ENS name', details: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.userId;
    const { ensName } = parsed.data;
    const normalizedName = ensName.toLowerCase();

    // 2. Load user — must have a walletAddress (SIWE login required)
    const [user] = await db
      .select({ walletAddress: schema.users.walletAddress })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user?.walletAddress) {
      res.status(400).json({
        error: 'ENS binding requires a connected wallet. Please sign in with Ethereum (SIWE) first.',
      });
      return;
    }

    // 3. Check user doesn't already have an ENS binding
    const [existingUserBinding] = await db
      .select({ id: schema.socialBindings.id })
      .from(schema.socialBindings)
      .where(
        and(
          eq(schema.socialBindings.userId, userId),
          eq(schema.socialBindings.provider, 'ens'),
        ),
      )
      .limit(1);

    if (existingUserBinding) {
      res.status(409).json({ error: 'An ENS name is already bound to this account' });
      return;
    }

    // 4. Check the ENS name isn't already claimed by another user
    const [otherBinding] = await db
      .select({ userId: schema.socialBindings.userId })
      .from(schema.socialBindings)
      .where(
        and(
          eq(schema.socialBindings.provider, 'ens'),
          eq(schema.socialBindings.providerUserId, normalizedName),
        ),
      )
      .limit(1);

    if (otherBinding && otherBinding.userId !== userId) {
      res.status(409).json({ error: 'This ENS name is already bound to another account' });
      return;
    }

    // 5. Resolve ENS name to Ethereum address
    const resolvedAddress = await resolveEnsAddress(normalizedName);
    if (!resolvedAddress) {
      res.status(422).json({
        error: `Cannot resolve ENS name: ${normalizedName}. Ensure the name exists and has an ETH record set.`,
      });
      return;
    }

    // 6. Verify the resolved address matches user's walletAddress
    if (resolvedAddress.toLowerCase() !== user.walletAddress.toLowerCase()) {
      res.status(403).json({
        error: 'ENS name does not resolve to your wallet address',
        resolvedAddress,
        walletAddress: user.walletAddress,
      });
      return;
    }

    // 7. Create the binding
    await db.insert(schema.socialBindings).values({
      userId,
      provider: 'ens',
      providerUserId: normalizedName,
      providerUsername: normalizedName,
      chipRewarded: false,
    });

    // 8. Award CHIP (+500 for ENS binding)
    const chipResult = await chipService.allocateSocialBindingReward(userId, 'ens', normalizedName);

    res.json({
      bound: true,
      ensName: normalizedName,
      chipAwarded: chipResult !== null,
      chipAmount: chipResult?.amount ?? 0,
    });
  } catch (err) {
    console.error('[ENS Binding] Error:', err);
    res.status(500).json({ error: 'ENS binding failed' });
  }
});
