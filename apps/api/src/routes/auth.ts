import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { getPlatformPublicKeyHex } from '../services/webhook-crypto.js';

export const authRouter: RouterType = Router();

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

    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
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

/**
 * GET /auth/public-key - Get the platform's Ed25519 public key.
 * Agents use this to verify that webhook requests are genuinely from Agon.
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
