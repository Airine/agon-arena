import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { SiweMessage } from 'siwe';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { getPlatformPublicKeyHex } from '../services/webhook-crypto.js';
import { storeSiweNonce, consumeSiweNonce } from '../services/redis.js';

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

    if (!user) {
      // Auto-register: username derived from wallet (0x1234...abcd → w1234abcd)
      const shortAddr = walletAddress.slice(2, 6) + walletAddress.slice(-4);
      const username = `w${shortAddr}${randomBytes(2).toString('hex')}`;
      [user] = await db
        .insert(schema.users)
        .values({ username, walletAddress })
        .returning({ id: schema.users.id, username: schema.users.username, walletAddress: schema.users.walletAddress });
    }

    const token = signToken({ userId: user!.id, username: user!.username, walletAddress: user!.walletAddress ?? undefined });
    res.json({ token, user: { id: user!.id, username: user!.username, walletAddress: user!.walletAddress } });
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

    const token = signToken({ userId: user!.id, username: user!.username });
    res.status(201).json({ token, user: { id: user!.id, username: user!.username } });
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

    const token = signToken({ userId: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Login failed' });
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
