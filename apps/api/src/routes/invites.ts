/**
 * AGO-67: Invite code generation (5 codes per verified user)
 *
 * Flow:
 *   POST /auth/invites/generate  — generate invite codes (up to 5 total)
 *   GET  /auth/invites           — list user's invite codes (used/unused)
 *
 * Verification requirement:
 *   A user is "verified" if they have at least one social binding OR a wallet address.
 *   Unverified accounts (email-only, no social link, no wallet) cannot generate codes.
 *   This prevents fresh sock-puppet accounts from farming invites.
 *
 * Code format: "AGON-XXXX-XXXX" where X is uppercase alphanumeric (base-36 without 0/O/I/1)
 *
 * Business rules:
 *   - Max 5 total invite codes per user (active + used combined)
 *   - Codes are permanent — cannot be deleted, only redeemed
 *   - Redemption handled by AGO-68 (invite reward distribution)
 */

import { Router, type Router as RouterType } from 'express';
import { randomBytes } from 'crypto';
import { eq, count } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const invitesRouter: RouterType = Router();

// All routes require authentication
invitesRouter.use(requireAuth);

const MAX_CODES_PER_USER = 5;

// Safe alphanumeric charset — excludes visually ambiguous chars (0, O, I, 1, L)
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generate a single invite code in "AGON-XXXX-XXXX" format.
 * Uses cryptographically random bytes mapped to SAFE_CHARS.
 */
function generateInviteCode(): string {
  const buf = randomBytes(8);
  let chars = '';
  for (const byte of buf) {
    chars += SAFE_CHARS[byte % SAFE_CHARS.length];
  }
  return `AGON-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

// ---------------------------------------------------------------------------
// POST /auth/invites/generate
// Generate invite codes for the current user (up to MAX_CODES_PER_USER total).
// Returns newly created codes only (not all codes).
// ---------------------------------------------------------------------------

invitesRouter.post('/generate', async (req, res) => {
  try {
    const userId = req.user!.userId;

    // Check that user is "verified" (has wallet or social binding)
    const [userRow] = await db
      .select({ walletAddress: schema.users.walletAddress })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!userRow) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isWalletVerified = Boolean(userRow.walletAddress);

    if (!isWalletVerified) {
      // Check for at least one social binding
      const [bindingRow] = await db
        .select({ id: schema.socialBindings.id })
        .from(schema.socialBindings)
        .where(eq(schema.socialBindings.userId, userId))
        .limit(1);

      if (!bindingRow) {
        res.status(403).json({
          error: 'Account not verified. Link a wallet (SIWE) or a social account (GitHub/Google) before generating invite codes.',
        });
        return;
      }
    }

    // Count existing codes for this user
    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.createdByUserId, userId));

    const existing = Number(total);
    const canGenerate = MAX_CODES_PER_USER - existing;

    if (canGenerate <= 0) {
      res.status(409).json({
        error: `Maximum of ${MAX_CODES_PER_USER} invite codes already generated`,
        existing,
        max: MAX_CODES_PER_USER,
      });
      return;
    }

    // How many codes to generate now? Default: fill to max.
    const requestedCount = Math.min(
      Number(req.body?.count ?? canGenerate),
      canGenerate,
    );

    if (requestedCount <= 0) {
      res.status(400).json({ error: 'count must be >= 1' });
      return;
    }

    // Generate codes (retry on collision — extremely rare with 32^8 = 1T space)
    const newCodes: string[] = [];
    let attempts = 0;
    while (newCodes.length < requestedCount && attempts < requestedCount * 5) {
      attempts++;
      const code = generateInviteCode();
      try {
        const [inserted] = await db
          .insert(schema.inviteCodes)
          .values({ code, createdByUserId: userId })
          .returning({ code: schema.inviteCodes.code });
        if (inserted) newCodes.push(inserted.code);
      } catch {
        // Unique collision — retry (virtually impossible, but defensive)
      }
    }

    res.status(201).json({
      codes: newCodes,
      total: existing + newCodes.length,
      remaining: MAX_CODES_PER_USER - existing - newCodes.length,
    });
  } catch (err) {
    console.error('[Invites] Generate error:', err);
    res.status(500).json({ error: 'Failed to generate invite codes' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/invites
// List all invite codes for the current user.
// ---------------------------------------------------------------------------

invitesRouter.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId;

    const codes = await db
      .select({
        id: schema.inviteCodes.id,
        code: schema.inviteCodes.code,
        usedByUserId: schema.inviteCodes.usedByUserId,
        usedAt: schema.inviteCodes.usedAt,
        referrerRewarded: schema.inviteCodes.referrerRewarded,
        createdAt: schema.inviteCodes.createdAt,
      })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.createdByUserId, userId));

    const used = codes.filter((c) => c.usedAt !== null).length;
    const unused = codes.filter((c) => c.usedAt === null).length;

    res.json({
      codes,
      stats: {
        total: codes.length,
        used,
        unused,
        max: MAX_CODES_PER_USER,
        canGenerate: MAX_CODES_PER_USER - codes.length,
      },
    });
  } catch (err) {
    console.error('[Invites] List error:', err);
    res.status(500).json({ error: 'Failed to fetch invite codes' });
  }
});
