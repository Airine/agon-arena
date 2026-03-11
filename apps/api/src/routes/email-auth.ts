/**
 * AGO-57: Email + password fallback authentication
 *
 * Provides POST /auth/email/register and POST /auth/email/login as a fallback
 * for users who do not have Ethereum wallets.
 *
 * Security guarantees:
 *  - scrypt (Node.js built-in crypto) — no new npm dependencies
 *  - Password format: scrypt:<salt>:<derivedKey>
 *  - Timing-safe: always runs verifyPassword even when user not found
 *  - Generic error "Invalid email or password" for both wrong-password and unknown-user
 *  - Registration bonus: +1000 CHIP via allocateRegistrationBonus
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { db, schema } from '../db/index.js';
import { issueTokenPair } from '../services/jwt.js';
import { chipService } from '../services/chip.js';

const scryptAsync = promisify(scrypt);

// ---------------------------------------------------------------------------
// Password hashing utilities (scrypt, Node.js built-in crypto)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, key] = parts;
  if (!salt || !key) return false;
  try {
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const keyBuffer = Buffer.from(key, 'hex');
    if (derivedKey.length !== keyBuffer.length) return false;
    return timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}

// Dummy hash used for timing-safe constant-time verification when user not found
const DUMMY_HASH = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const emailAuthRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  username: z.string().min(3).max(44).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ---------------------------------------------------------------------------
// POST /auth/email/register
// ---------------------------------------------------------------------------

emailAuthRouter.post('/register', async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const { email, password, username } = parsed.data;

    // Check email uniqueness
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await hashPassword(password);

    // Generate username from email if not provided
    const finalUsername =
      username ?? `u_${email.split('@')[0]!.slice(0, 20)}_${randomBytes(2).toString('hex')}`;

    const [newUser] = await db
      .insert(schema.users)
      .values({
        email,
        passwordHash,
        username: finalUsername,
      })
      .returning({ id: schema.users.id, username: schema.users.username });

    if (!newUser) {
      res.status(500).json({ error: 'Failed to create account' });
      return;
    }

    // Award registration bonus (+1000 CHIP)
    await chipService.allocateRegistrationBonus(newUser.id);

    const tokens = await issueTokenPair({ userId: newUser.id, username: newUser.username });

    res.status(201).json({
      ...tokens,
      user: { id: newUser.id, username: newUser.username, email },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('unique')) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    console.error('[EmailAuth] Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/email/login
// ---------------------------------------------------------------------------

emailAuthRouter.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    const { email, password } = parsed.data;

    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
        passwordHash: schema.users.passwordHash,
        walletAddress: schema.users.walletAddress,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    // Constant-time: always verify even if user not found (prevent timing attacks / user enumeration)
    const hashToCheck = user?.passwordHash ?? DUMMY_HASH;
    const valid = await verifyPassword(password, hashToCheck);

    if (!user || !user.passwordHash || !valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const tokens = await issueTokenPair({
      userId: user.id,
      username: user.username,
      ...(user.walletAddress && { walletAddress: user.walletAddress }),
    });

    res.json({
      ...tokens,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        walletAddress: user.walletAddress,
      },
    });
  } catch (err) {
    console.error('[EmailAuth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});
