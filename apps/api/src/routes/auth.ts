import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { SiweMessage } from 'siwe';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { issueTokenPair, rotateRefreshToken, revokeAccessToken } from '../services/jwt.js';
import {
  agentAccessHeaderSchema,
  agentCardSchema,
  verifyAgentAccessRequest,
} from '../services/agent-access.js';
import { getPlatformPublicKeyHex } from '../services/webhook-crypto.js';
import { publishFunnelEvent } from '../services/kafka.js';
import {
  claimAgentAccessNonce,
  storeSiweNonce,
  consumeSiweNonce,
  storeAgentNonce,
  consumeAgentNonce,
  storeBindNonce,
  consumeBindNonce,
} from '../services/redis.js';
import { incrementFingerprintAccountCount } from '../middleware/rate-limit.js';
import { verifyMessage } from 'viem';
import { chipService } from '../services/chip.js';
import { InviteGateError, satisfyInviteGateForUser } from '../services/invite-gate.js';
import { verifyEmailCodeHandler } from './email-auth.js';

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
    const { message, signature } = siweVerifySchema.parse(req.body);

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
// Retired email/password compatibility endpoints
// ---------------------------------------------------------------------------

authRouter.post('/register', async (req, res) => {
  if (req.body && typeof req.body === 'object' && 'password' in req.body) {
    res.status(400).json({ error: 'Password registration has been retired. Use /auth/email/request-code and /auth/email/verify.' });
    return;
  }
  await verifyEmailCodeHandler(req, res);
});

authRouter.post('/login', async (req, res) => {
  if (req.body && typeof req.body === 'object' && 'password' in req.body) {
    res.status(400).json({ error: 'Password login has been retired. Use /auth/email/request-code and /auth/email/verify.' });
    return;
  }
  await verifyEmailCodeHandler(req, res);
});

// ---------------------------------------------------------------------------
// Wallet binding for existing human accounts
// ---------------------------------------------------------------------------

authRouter.get('/wallet/bind-nonce', requireAuth, async (_req, res) => {
  try {
    const nonce = randomBytes(16).toString('hex');
    await storeBindNonce(nonce);
    res.json({ nonce });
  } catch {
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

const walletBindVerifySchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  nonce: z.string().min(1),
  signature: z.string().startsWith('0x'),
  inviteCode: z.string().max(20).optional(),
});

authRouter.post('/wallet/bind-verify', requireAuth, async (req, res) => {
  try {
    const { walletAddress: rawAddress, nonce, signature, inviteCode } = walletBindVerifySchema.parse(req.body);
    const walletAddress = rawAddress.toLowerCase();
    const message = `Bind Agon Wallet\nAddress: ${walletAddress}\nNonce: ${nonce}`;

    let valid = false;
    try {
      valid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      valid = false;
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid wallet signature' });
      return;
    }

    const nonceValid = await consumeBindNonce(nonce);
    if (!nonceValid) {
      res.status(401).json({ error: 'Nonce already used or expired' });
      return;
    }

    const [currentUser] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
        walletAddress: schema.users.walletAddress,
      })
      .from(schema.users)
      .where(eq(schema.users.id, req.user!.userId))
      .limit(1);

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (currentUser.walletAddress) {
      if (currentUser.walletAddress === walletAddress) {
        const tokens = await issueTokenPair({
          userId: currentUser.id,
          username: currentUser.username,
          walletAddress,
        });
        res.json({ ...tokens, user: currentUser });
        return;
      }
      res.status(409).json({ error: 'This account already has a wallet bound' });
      return;
    }

    const [existingWalletUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.walletAddress, walletAddress))
      .limit(1);
    if (existingWalletUser && existingWalletUser.id !== currentUser.id) {
      res.status(409).json({ error: 'Wallet is already bound to another account' });
      return;
    }

    const gate = await satisfyInviteGateForUser({ userId: currentUser.id, inviteCode });
    if (gate.inviteCodeId) {
      await chipService.allocateInviteRefereeReward(currentUser.id, gate.inviteCodeId);
    }

    await db
      .update(schema.users)
      .set({ walletAddress, updatedAt: new Date() })
      .where(eq(schema.users.id, currentUser.id));

    const user = { ...currentUser, walletAddress };
    const tokens = await issueTokenPair({
      userId: user.id,
      username: user.username,
      walletAddress,
    });

    res.json({ ...tokens, user, inviteGate: { reason: gate.reason } });
  } catch (err) {
    if (err instanceof InviteGateError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    console.error('[WalletBind] Error:', err);
    res.status(500).json({ error: 'Failed to bind wallet' });
  }
});

// ---------------------------------------------------------------------------
// Agent auto-registration (EIP-191 wallet signature)
// ---------------------------------------------------------------------------

const agentAccessBodySchema = z.object({
  agentCard: agentCardSchema.optional(),
});

/**
 * POST /auth/agent/access
 * Agent wallet bootstrap:
 *  - verifies EIP-191 signed request headers
 *  - creates user + agent on first access
 *  - returns a JWT pair tied to the agent identity
 */
authRouter.post('/agent/access', async (req, res) => {
  try {
    const rawBody = req.body ?? {};
    const headers = agentAccessHeaderSchema.parse({
      address: req.get('X-Agent-Address'),
      timestamp: req.get('X-Timestamp'),
      nonce: req.get('X-Nonce'),
      signature: req.get('X-Signature'),
    });

    const verification = await verifyAgentAccessRequest({
      headers,
      method: req.method,
      path: `${req.baseUrl}${req.path}`,
      body: rawBody,
    });
    if (!verification.ok) {
      res.status(verification.status).json({ error: verification.error });
      return;
    }

    const body = agentAccessBodySchema.parse(rawBody);

    const nonceClaimed = await claimAgentAccessNonce(headers.nonce);
    if (!nonceClaimed) {
      res.status(401).json({ error: 'Nonce already used or expired' });
      return;
    }

    let [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        walletAddress: schema.users.walletAddress,
      })
      .from(schema.users)
      .where(eq(schema.users.walletAddress, verification.walletAddress))
      .limit(1);

    if (!user && !body.agentCard) {
      res.status(400).json({ error: 'agentCard is required when registering a new agent' });
      return;
    }

    let created = false;
    if (!user) {
      const shortAddr =
        verification.walletAddress.slice(2, 6) + verification.walletAddress.slice(-4);
      const username = `agent_${shortAddr}${randomBytes(2).toString('hex')}`;
      [user] = await db
        .insert(schema.users)
        .values({ username, walletAddress: verification.walletAddress })
        .returning({
          id: schema.users.id,
          username: schema.users.username,
          walletAddress: schema.users.walletAddress,
        });
      created = true;
      await chipService.allocateRegistrationBonus(user!.id);
    }

    let [agent] = await db
      .select({
        id: schema.agents.id,
        ownerId: schema.agents.ownerId,
        creatorUserId: schema.agents.creatorUserId,
        agentAddress: schema.agents.agentAddress,
        name: schema.agents.name,
        description: schema.agents.description,
        version: schema.agents.version,
        metadata: schema.agents.metadata,
      })
      .from(schema.agents)
      .where(eq(schema.agents.agentAddress, verification.walletAddress))
      .limit(1);

    if (!agent) {
      if (!body.agentCard) {
        res.status(400).json({ error: 'agentCard is required when registering a new agent' });
        return;
      }
      const { capabilities, metadata: extraMeta, ...cardRest } = body.agentCard;
      [agent] = await db
        .insert(schema.agents)
        .values({
          ownerId: user!.id,
          creatorUserId: user!.id,
          agentAddress: verification.walletAddress,
          name: cardRest.name,
          description: cardRest.description ?? null,
          apiUrl: null,
          webhookPublicKey: null,
          version: cardRest.version,
          metadata: { capabilities, ...extraMeta },
        })
        .returning({
          id: schema.agents.id,
          ownerId: schema.agents.ownerId,
          creatorUserId: schema.agents.creatorUserId,
          agentAddress: schema.agents.agentAddress,
          name: schema.agents.name,
          description: schema.agents.description,
          version: schema.agents.version,
          metadata: schema.agents.metadata,
        });
      created = true;
    } else if (agent.ownerId !== user!.id) {
      res.status(409).json({ error: 'Agent identity is already bound to a different owner record' });
      return;
    }

    // Funnel: wallet ownership proven — agent connected their wallet
    publishFunnelEvent({
      eventType: 'agent_funnel',
      stage: 'wallet_connected',
      agentId: agent!.id,
      userId: user!.id,
      ts: new Date().toISOString(),
    });

    const tokens = await issueTokenPair({
      userId: user!.id,
      username: user!.username,
      walletAddress: user!.walletAddress ?? undefined,
      agentId: agent!.id,
      agentAddress: agent!.agentAddress ?? verification.walletAddress,
      type: 'agent',
    });

    // Funnel: session issued
    publishFunnelEvent({
      eventType: 'agent_funnel',
      stage: 'session_created',
      agentId: agent!.id,
      userId: user!.id,
      ts: new Date().toISOString(),
    });

    res.status(created ? 201 : 200).json({
      ...tokens,
      created,
      user: {
        id: user!.id,
        username: user!.username,
        walletAddress: user!.walletAddress,
      },
      agent: {
        id: agent!.id,
        ownerId: agent!.ownerId,
        creatorUserId: agent!.creatorUserId,
        agentAddress: agent!.agentAddress,
        name: agent!.name,
        description: agent!.description,
        version: agent!.version,
        metadata: agent!.metadata,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    console.error('[Agent] Access error:', err);
    res.status(500).json({ error: 'Agent access failed' });
  }
});

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
      .select({
        id: schema.agents.id,
        ownerId: schema.agents.ownerId,
        creatorUserId: schema.agents.creatorUserId,
        agentAddress: schema.agents.agentAddress,
        name: schema.agents.name,
        description: schema.agents.description,
        version: schema.agents.version,
        metadata: schema.agents.metadata,
      })
      .from(schema.agents)
      .where(eq(schema.agents.agentAddress, walletAddress))
      .limit(1);

    if (!agent) {
      const { capabilities, metadata: extraMeta, ...cardRest } = agentCard;
      [agent] = await db
        .insert(schema.agents)
        .values({
          ownerId: user!.id,
          creatorUserId: user!.id,
          agentAddress: walletAddress,
          name: cardRest.name,
          description: cardRest.description ?? null,
          apiUrl: null,
          webhookPublicKey: null,
          version: cardRest.version,
          metadata: { capabilities, ...extraMeta },
        })
        .returning({
          id: schema.agents.id,
          ownerId: schema.agents.ownerId,
          creatorUserId: schema.agents.creatorUserId,
          agentAddress: schema.agents.agentAddress,
          name: schema.agents.name,
          description: schema.agents.description,
          version: schema.agents.version,
          metadata: schema.agents.metadata,
        });
    } else if (agent.ownerId !== user!.id) {
      res.status(409).json({ error: 'Agent identity is already bound to a different owner record' });
      return;
    }

    const tokens = await issueTokenPair({
      userId: user!.id,
      username: user!.username,
      walletAddress: user!.walletAddress ?? undefined,
      agentId: agent!.id,
      agentAddress: agent!.agentAddress ?? walletAddress,
      type: 'agent',
    });

    res.status(201).json({
      ...tokens,
      user: { id: user!.id, username: user!.username, walletAddress: user!.walletAddress },
      agent: {
        id: agent!.id,
        ownerId: agent!.ownerId,
        creatorUserId: agent!.creatorUserId,
        agentAddress: agent!.agentAddress,
        name: agent!.name,
        description: agent!.description,
        version: agent!.version,
        metadata: agent!.metadata,
      },
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
        inviteGateSatisfiedAt: schema.users.inviteGateSatisfiedAt,
        inviteGateReason: schema.users.inviteGateReason,
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
