import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { SiweMessage } from 'siwe';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { issueTokenPair, rotateRefreshToken, revokeAccessToken } from '../services/jwt.js';
import { getPlatformPublicKeyHex } from '../services/webhook-crypto.js';
import { storeSiweNonce, consumeSiweNonce, storeAgentNonce, consumeAgentNonce, storeBindNonce, consumeBindNonce } from '../services/redis.js';
import { incrementFingerprintAccountCount } from '../middleware/rate-limit.js';
import { verifyMessage } from 'viem';
import { chipService } from '../services/chip.js';

// ---------------------------------------------------------------------------
// Invite code redemption helper (AGO-68)
// ---------------------------------------------------------------------------

/**
 * Redeem an invite code for a newly registered user.
 * Marks the code as used and credits the referee's +500 CHIP reward.
 * Fire-and-forget safe — errors are logged but do not fail registration.
 *
 * @param newUserId - The just-created user's ID
 * @param inviteCode - The raw code string (e.g. "AGON-A1B2-C3D4")
 */
async function redeemInviteCode(newUserId: string, inviteCode: string): Promise<void> {
  try {
    // Load and validate the invite code
    const [codeRow] = await db
      .select({
        id: schema.inviteCodes.id,
        createdByUserId: schema.inviteCodes.createdByUserId,
        usedAt: schema.inviteCodes.usedAt,
      })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, inviteCode.toUpperCase()))
      .limit(1);

    if (!codeRow) return; // code doesn't exist — ignore silently
    if (codeRow.usedAt !== null) return; // already used
    if (codeRow.createdByUserId === newUserId) return; // cannot invite yourself

    // Mark code as used and link to user (atomic)
    await db.transaction(async (tx) => {
      await tx
        .update(schema.inviteCodes)
        .set({ usedByUserId: newUserId, usedAt: new Date() })
        .where(eq(schema.inviteCodes.id, codeRow.id));

      await tx
        .update(schema.users)
        .set({ invitedByCodeId: codeRow.id, updatedAt: new Date() })
        .where(eq(schema.users.id, newUserId));
    });

    // Award referee +500 CHIP
    await chipService.allocateInviteRefereeReward(newUserId, codeRow.id);
  } catch (err) {
    // Invite redemption is best-effort — log but do not break registration
    console.error('[InviteRedeem] Error:', err);
  }
}

export const authRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// SIWE (Sign-In with Ethereum)
// ---------------------------------------------------------------------------

/**
 * GET /auth/siwe/nonce
 * Returns a fresh random nonce. Stored in Redis (TTL=5min, single-use).
 */
authRouter.get('/siwe/nonce', async (_req, res) => {
  try {
    const nonce = randomBytes(16).toString('hex');
    await storeSiweNonce(nonce);
    res.json({ nonce });
  } catch {
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

const siweVerifySchema = z.object({
  message: z.string(),   // Serialized EIP-4361 SIWE message
  signature: z.string(), // 0x-prefixed hex signature
  // AGO-68: optional invite code for new wallet registrations
  inviteCode: z.string().max(20).optional(),
});

/**
 * POST /auth/siwe/verify
 * Verifies SIWE message + signature, issues JWT.
 * Creates user account on first login (auto-username from wallet).
 *
 * Security guarantees:
 *  - Nonce is single-use (consumed from Redis atomically)
 *  - Domain validated against SIWE_DOMAIN env var
 *  - Chain ID validated against SIWE_CHAIN_ID env var (default: 84532 = Base Sepolia)
 */
authRouter.post('/siwe/verify', async (req, res) => {
  try {
    const { message, signature, inviteCode } = siweVerifySchema.parse(req.body);

    const siweMessage = new SiweMessage(message);

    // Validate domain
    const expectedDomain = process.env['SIWE_DOMAIN'] ?? 'localhost';
    if (siweMessage.domain !== expectedDomain) {
      res.status(400).json({ error: 'Invalid domain in SIWE message' });
      return;
    }

    // Validate chain ID (Base Sepolia = 84532, Base Mainnet = 8453)
    const expectedChainId = Number(process.env['SIWE_CHAIN_ID'] ?? '84532');
    if (siweMessage.chainId !== expectedChainId) {
      res.status(400).json({ error: 'Invalid chain ID in SIWE message' });
      return;
    }

    // Verify EIP-4361 signature
    const { data: verified } = await siweMessage.verify({ signature });
    if (!verified) {
      res.status(401).json({ error: 'Invalid SIWE signature' });
      return;
    }

    // Consume nonce — single-use enforcement
    const nonceValid = await consumeSiweNonce(siweMessage.nonce);
    if (!nonceValid) {
      res.status(401).json({ error: 'Nonce already used or expired' });
      return;
    }

    const walletAddress = siweMessage.address.toLowerCase();

    // Find or create user
    let [user] = await db
      .select({ id: schema.users.id, username: schema.users.username, walletAddress: schema.users.walletAddress })
      .from(schema.users)
      .where(eq(schema.users.walletAddress, walletAddress))
      .limit(1);

    let isNewUser = false;
    if (!user) {
      // Auto-register: username derived from wallet (0x1234...abcd → w1234abcd)
      const shortAddr = walletAddress.slice(2, 6) + walletAddress.slice(-4);
      const username = `w${shortAddr}${randomBytes(2).toString('hex')}`;
      [user] = await db
        .insert(schema.users)
        .values({ username, walletAddress })
        .returning({ id: schema.users.id, username: schema.users.username, walletAddress: schema.users.walletAddress });
      isNewUser = true;
    }

    if (isNewUser) {
      await chipService.allocateRegistrationBonus(user!.id);
      // AGO-68: redeem invite code for new SIWE users (best-effort)
      if (inviteCode) {
        await redeemInviteCode(user!.id, inviteCode);
      }
      // AGO-69: increment device fingerprint account counter (best-effort)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((req as any).deviceFingerprint) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await incrementFingerprintAccountCount((req as any).deviceFingerprint as string);
      }
    }

    const tokens = await issueTokenPair({ userId: user!.id, username: user!.username, walletAddress: user!.walletAddress ?? undefined });
    res.json({ ...tokens, user: { id: user!.id, username: user!.username, walletAddress: user!.walletAddress } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    console.error('[SIWE] Verify error:', err);
    res.status(500).json({ error: 'SIWE verification failed' });
  }
});

// ---------------------------------------------------------------------------
// Email / Password auth (fallback)
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6),
  // AGO-68: optional invite code (format: "AGON-XXXX-XXXX")
  inviteCode: z.string().max(20).optional(),
});

authRouter.post('/register', async (req, res) => {
  try {
    const body = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 10);

    const [user] = await db
      .insert(schema.users)
      .values({
        username: body.username,
        email: body.email,
        passwordHash,
      })
      .returning({ id: schema.users.id, username: schema.users.username });

    await chipService.allocateRegistrationBonus(user!.id);

    // AGO-68: redeem invite code if provided (best-effort, does not fail registration)
    if (body.inviteCode) {
      await redeemInviteCode(user!.id, body.inviteCode);
    }

    const tokens = await issueTokenPair({ userId: user!.id, username: user!.username });
    res.status(201).json({ ...tokens, user: { id: user!.id, username: user!.username } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    const message = err instanceof Error ? err.message : 'Registration failed';
    const status = message.includes('unique') ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post('/login', async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, body.email))
      .limit(1);

    if (!user || !user.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const tokens = await issueTokenPair({ userId: user.id, username: user.username });
    res.json({ ...tokens, user: { id: user.id, username: user.username } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Login failed' });
  }
});

// ---------------------------------------------------------------------------
// Agent auto-registration (EIP-191 wallet signature)
// ---------------------------------------------------------------------------

/**
 * GET /auth/agent/nonce
 * Returns a fresh random nonce for agent registration. Single-use, TTL=5min.
 */
authRouter.get('/agent/nonce', async (_req, res) => {
  try {
    const nonce = randomBytes(16).toString('hex');
    await storeAgentNonce(nonce);
    res.json({ nonce });
  } catch {
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

const agentCardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  apiUrl: z.string().url(),
  webhookPublicKey: z.string().length(64).optional(), // Ed25519 public key hex
  version: z.string().default('1.0'),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional(),
});

const agentRegisterSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  nonce: z.string().min(1),
  signature: z.string().startsWith('0x'),
  agentCard: agentCardSchema,
});

/**
 * POST /auth/agent/register
 * Agent self-registers using an EIP-191 personal_sign wallet signature.
 * Creates a user account + agent record on first call; idempotent on subsequent calls.
 *
 * Message format (agent must sign exactly):
 *   "Register Agon Agent\nNonce: {nonce}"
 *
 * Security guarantees:
 *  - Wallet ownership proven before any account creation
 *  - Nonce is single-use (consumed from Redis atomically)
 *  - Wallet address normalized to lowercase
 */
authRouter.post('/agent/register', async (req, res) => {
  try {
    const { walletAddress: rawAddress, nonce, signature, agentCard } = agentRegisterSchema.parse(req.body);

    const message = `Register Agon Agent\nNonce: ${nonce}` as const;

    // Verify EIP-191 personal_sign — recover signer address
    let signerAddress: string;
    try {
      const valid = await verifyMessage({
        address: rawAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!valid) {
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }
      signerAddress = rawAddress.toLowerCase();
    } catch {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    // Consume nonce — single-use enforcement
    const nonceValid = await consumeAgentNonce(nonce);
    if (!nonceValid) {
      res.status(401).json({ error: 'Nonce already used or expired' });
      return;
    }

    const walletAddress = signerAddress;

    // Find or create user for this wallet
    let [user] = await db
      .select({ id: schema.users.id, username: schema.users.username, walletAddress: schema.users.walletAddress })
      .from(schema.users)
      .where(eq(schema.users.walletAddress, walletAddress))
      .limit(1);

    let isNewAgentUser = false;
    if (!user) {
      const shortAddr = walletAddress.slice(2, 6) + walletAddress.slice(-4);
      const username = `agent_${shortAddr}${randomBytes(2).toString('hex')}`;
      [user] = await db
        .insert(schema.users)
        .values({ username, walletAddress })
        .returning({ id: schema.users.id, username: schema.users.username, walletAddress: schema.users.walletAddress });
      isNewAgentUser = true;
    }

    if (isNewAgentUser) {
      await chipService.allocateRegistrationBonus(user!.id);
    }

    // Find or create agent record for this owner
    let [agent] = await db
      .select({ id: schema.agents.id, name: schema.agents.name, apiUrl: schema.agents.apiUrl })
      .from(schema.agents)
      .where(eq(schema.agents.ownerId, user!.id))
      .limit(1);

    if (!agent) {
      const { capabilities, metadata: extraMeta, ...cardRest } = agentCard;
      [agent] = await db
        .insert(schema.agents)
        .values({
          ownerId: user!.id,
          name: cardRest.name,
          description: cardRest.description,
          apiUrl: cardRest.apiUrl,
          webhookPublicKey: cardRest.webhookPublicKey,
          version: cardRest.version,
          metadata: { capabilities, ...extraMeta },
        })
        .returning({ id: schema.agents.id, name: schema.agents.name, apiUrl: schema.agents.apiUrl });
    }

    const tokens = await issueTokenPair({
      userId: user!.id,
      username: user!.username,
      walletAddress: user!.walletAddress ?? undefined,
      agentId: agent!.id,
      type: 'agent',
    });

    res.status(201).json({
      ...tokens,
      user: { id: user!.id, username: user!.username, walletAddress: user!.walletAddress },
      agent: { id: agent!.id, name: agent!.name, apiUrl: agent!.apiUrl },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    console.error('[Agent] Register error:', err);
    res.status(500).json({ error: 'Agent registration failed' });
  }
});

// ---------------------------------------------------------------------------
// Owner-Agent ownership chain (AGO-53)
// ---------------------------------------------------------------------------

const MAX_OWNERSHIP_DEPTH = 5;

/**
 * GET /auth/agent/bind-nonce
 * Returns a fresh nonce for the owner-bind flow. Single-use, TTL=5min.
 */
authRouter.get('/agent/bind-nonce', async (_req, res) => {
  try {
    const nonce = randomBytes(16).toString('hex');
    await storeBindNonce(nonce);
    res.json({ nonce });
  } catch {
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

const bindOwnerSchema = z.object({
  agentId: z.string().uuid(),           // The child agent being bound
  ownerAgentId: z.string().uuid(),      // The owner (parent) agent
  nonce: z.string().min(1),
  signature: z.string().startsWith('0x'), // Owner's EIP-191 signature
});

/**
 * Recursively compute the chain depth from an agent up to the root.
 * Returns the number of ancestors (0 = no parent, 4 = 4 parents above).
 * Aborts and returns MAX_OWNERSHIP_DEPTH + 1 if a cycle is detected.
 */
async function computeChainDepth(
  agentId: string,
  visited: Set<string> = new Set(),
): Promise<number> {
  if (visited.has(agentId)) return MAX_OWNERSHIP_DEPTH + 1; // cycle sentinel
  visited.add(agentId);

  const [row] = await db
    .select({ ownerAgentId: schema.agents.ownerAgentId })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  if (!row || !row.ownerAgentId) return 0;
  return 1 + (await computeChainDepth(row.ownerAgentId, visited));
}

/**
 * POST /auth/agent/bind-owner
 * Bind a child agent to an owner agent. Requires the owner's EIP-191 signature.
 *
 * Message format (owner must sign exactly):
 *   "Bind Agent\nOwner: {ownerWalletAddress}\nAgent: {agentWalletAddress}\nNonce: {nonce}"
 *
 * Business rules:
 *  - Owner must be a registered agent with a known walletAddress
 *  - Chain depth after binding must not exceed MAX_OWNERSHIP_DEPTH (5)
 *  - No circular dependencies allowed
 *  - Each agent may only have one owner (overwrites existing)
 */
authRouter.post('/agent/bind-owner', async (req, res) => {
  try {
    const { agentId, ownerAgentId, nonce, signature } = bindOwnerSchema.parse(req.body);

    if (agentId === ownerAgentId) {
      res.status(400).json({ error: 'Agent cannot own itself' });
      return;
    }

    // Load child agent + its user (to get wallet address)
    const [childRow] = await db
      .select({
        agentId: schema.agents.id,
        walletAddress: schema.users.walletAddress,
      })
      .from(schema.agents)
      .innerJoin(schema.users, eq(schema.agents.ownerId, schema.users.id))
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!childRow) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!childRow.walletAddress) {
      res.status(400).json({ error: 'Child agent has no wallet address' });
      return;
    }

    // Load owner agent + its user (to get wallet address for signature verification)
    const [ownerRow] = await db
      .select({
        agentId: schema.agents.id,
        walletAddress: schema.users.walletAddress,
      })
      .from(schema.agents)
      .innerJoin(schema.users, eq(schema.agents.ownerId, schema.users.id))
      .where(eq(schema.agents.id, ownerAgentId))
      .limit(1);

    if (!ownerRow) {
      res.status(404).json({ error: 'Owner agent not found' });
      return;
    }

    if (!ownerRow.walletAddress) {
      res.status(400).json({ error: 'Owner agent has no wallet address' });
      return;
    }

    // Verify owner's EIP-191 signature
    const message =
      `Bind Agent\nOwner: ${ownerRow.walletAddress}\nAgent: ${childRow.walletAddress}\nNonce: ${nonce}`;

    try {
      const valid = await verifyMessage({
        address: ownerRow.walletAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!valid) {
        res.status(401).json({ error: 'Invalid owner signature' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid owner signature' });
      return;
    }

    // Consume nonce (single-use)
    const nonceValid = await consumeBindNonce(nonce);
    if (!nonceValid) {
      res.status(401).json({ error: 'Nonce already used or expired' });
      return;
    }

    // Cycle detection: would setting child.ownerAgentId = ownerAgentId create a cycle?
    // A cycle exists if ownerAgentId is already a descendant of agentId.
    const ownerChainDepth = await computeChainDepth(ownerAgentId);
    if (ownerChainDepth >= MAX_OWNERSHIP_DEPTH + 1) {
      res.status(400).json({ error: 'Circular ownership detected' });
      return;
    }

    if (ownerChainDepth + 1 >= MAX_OWNERSHIP_DEPTH) {
      res.status(400).json({ error: `Ownership chain would exceed maximum depth of ${MAX_OWNERSHIP_DEPTH}` });
      return;
    }

    // Detect cycle: if agentId is an ancestor of ownerAgentId, binding would create a loop.
    async function isAncestor(potentialAncestorId: string, targetId: string): Promise<boolean> {
      const visited = new Set<string>();
      let current: string | null = targetId;
      while (current) {
        if (visited.has(current)) return false; // already a cycle elsewhere, stop
        visited.add(current);
        if (current === potentialAncestorId) return true;
        const [row] = await db
          .select({ ownerAgentId: schema.agents.ownerAgentId })
          .from(schema.agents)
          .where(eq(schema.agents.id, current))
          .limit(1);
        current = row?.ownerAgentId ?? null;
      }
      return false;
    }

    const wouldCycle = await isAncestor(agentId, ownerAgentId);
    if (wouldCycle) {
      res.status(400).json({ error: 'Circular ownership detected' });
      return;
    }

    // Bind: set ownerAgentId on the child agent
    await db
      .update(schema.agents)
      .set({ ownerAgentId })
      .where(eq(schema.agents.id, agentId));

    res.json({
      agentId,
      ownerAgentId,
      message: 'Ownership binding successful',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    console.error('[BindOwner] Error:', err);
    res.status(500).json({ error: 'Failed to bind owner' });
  }
});

/**
 * GET /auth/agent/:agentId/ownership-chain
 * Returns the full ownership chain for an agent, from the agent up to its root owner.
 *
 * Response: { chain: [{ agentId, name, walletAddress }, ...] }
 * chain[0] is the queried agent; chain[last] is the root (no owner).
 */
authRouter.get('/agent/:agentId/ownership-chain', async (req, res) => {
  try {
    const { agentId } = req.params;

    if (!agentId || !/^[0-9a-f-]{36}$/.test(agentId)) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const chain: Array<{ agentId: string; name: string; walletAddress: string | null }> = [];
    const visited = new Set<string>();
    let currentId: string | null = agentId;

    while (currentId) {
      if (visited.has(currentId)) {
        // Cycle in DB (data integrity violation) — return what we have
        break;
      }
      visited.add(currentId);

      const [row] = await db
        .select({
          agentId: schema.agents.id,
          name: schema.agents.name,
          ownerAgentId: schema.agents.ownerAgentId,
          walletAddress: schema.users.walletAddress,
        })
        .from(schema.agents)
        .innerJoin(schema.users, eq(schema.agents.ownerId, schema.users.id))
        .where(eq(schema.agents.id, currentId))
        .limit(1);

      if (!row) {
        if (chain.length === 0) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }
        break;
      }

      chain.push({ agentId: row.agentId, name: row.name, walletAddress: row.walletAddress });
      currentId = row.ownerAgentId ?? null;
    }

    res.json({ chain, depth: chain.length });
  } catch (err) {
    console.error('[OwnershipChain] Error:', err);
    res.status(500).json({ error: 'Failed to fetch ownership chain' });
  }
});

// ---------------------------------------------------------------------------
// Token management: refresh + revoke (AGO-54)
// ---------------------------------------------------------------------------

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * POST /auth/token/refresh
 * Exchange a valid refresh token for a new token pair.
 * The old refresh token is consumed (rotation — cannot be reused).
 */
authRouter.post('/token/refresh', async (req, res) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const pair = await rotateRefreshToken(refreshToken);

    if (!pair) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    res.json(pair);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

const revokeSchema = z.object({
  token: z.string().min(1),
});

/**
 * POST /auth/token/revoke
 * Revoke an access token by adding its jti to the Redis blacklist.
 * Idempotent: revoking an already-expired or already-revoked token succeeds silently.
 */
authRouter.post('/token/revoke', requireAuth, async (req, res) => {
  try {
    const { token } = revokeSchema.parse(req.body);
    await revokeAccessToken(token);
    res.json({ revoked: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Token revocation failed' });
  }
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/**
 * GET /auth/public-key - Platform's Ed25519 public key for webhook verification.
 */
authRouter.get('/public-key', (_req, res) => {
  res.json({
    algorithm: 'Ed25519',
    publicKey: getPlatformPublicKeyHex(),
    format: 'raw-hex',
    usage: 'Verify X-Agon-Signature headers on webhook requests',
  });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
        walletAddress: schema.users.walletAddress,
        chipBalance: schema.users.chipBalance,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, req.user!.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});
