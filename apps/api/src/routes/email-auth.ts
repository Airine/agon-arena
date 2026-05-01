import { Router, type Request, type Response, type Router as RouterType } from 'express';
import { randomBytes, randomInt } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { issueTokenPair } from '../services/jwt.js';
import { chipService } from '../services/chip.js';
import {
  consumeEmailOtpChallenge,
  restoreEmailOtpChallenge,
  storeEmailOtpChallenge,
  type EmailOtpPurpose,
} from '../services/redis.js';
import { sendEmailOtp, shouldExposeDevEmailOtp } from '../services/email.js';
import {
  createHumanUserWithInviteGate,
  InviteGateError,
  satisfyInviteGateForUser,
} from '../services/invite-gate.js';

export const emailAuthRouter: RouterType = Router();

const otpPurposeSchema = z.enum(['login', 'bind_email']);

const requestCodeSchema = z.object({
  email: z.string().email().max(255),
  purpose: otpPurposeSchema.default('login'),
  inviteCode: z.string().max(20).optional(),
});

const verifyCodeSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  inviteCode: z.string().max(20).optional(),
  username: z.string().min(3).max(50).optional(),
});

const bindRequestSchema = z.object({
  email: z.string().email().max(255),
  inviteCode: z.string().max(20).optional(),
});

const bindVerifySchema = z.object({
  email: z.string().email().max(255),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  inviteCode: z.string().max(20).optional(),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeInviteCode(code: string | undefined): string | undefined {
  const normalized = code?.trim().toUpperCase();
  return normalized || undefined;
}

function otpTtlSeconds(): number {
  return Number(process.env['EMAIL_OTP_TTL_SECONDS'] ?? '600');
}

function otpCooldownSeconds(): number {
  return Number(process.env['EMAIL_OTP_RESEND_COOLDOWN_SECONDS'] ?? '60');
}

function otpMaxAttempts(): number {
  return Number(process.env['EMAIL_OTP_MAX_ATTEMPTS'] ?? '5');
}

function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function usernameFromEmail(email: string): string {
  const local = email.split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20) || 'user';
  return `u_${local}_${randomBytes(2).toString('hex')}`;
}

function inviteGateErrorResponse(res: Response, err: InviteGateError): void {
  res.status(err.status).json({ error: err.message, code: err.code });
}

async function issueEmailCode(input: {
  email: string;
  purpose: EmailOtpPurpose;
  inviteCode?: string;
}): Promise<{ sent: boolean; devCode?: string; cooldownSeconds?: number }> {
  const email = normalizeEmail(input.email);
  const code = generateEmailCode();
  const ttlSeconds = otpTtlSeconds();
  const stored = await storeEmailOtpChallenge({
    email,
    purpose: input.purpose,
    code,
    ttlSeconds,
    cooldownSeconds: otpCooldownSeconds(),
    inviteCode: normalizeInviteCode(input.inviteCode),
  });

  if (!stored.stored) {
    return { sent: false, cooldownSeconds: stored.cooldownSeconds };
  }

  await sendEmailOtp({
    email,
    code,
    ttlMinutes: Math.ceil(ttlSeconds / 60),
    purpose: input.purpose,
  });

  return {
    sent: true,
    ...(shouldExposeDevEmailOtp() && { devCode: code }),
  };
}

async function consumeEmailCode(input: {
  email: string;
  purpose: EmailOtpPurpose;
  code: string;
}): Promise<{ email: string; ttlSeconds: number; inviteCode?: string }> {
  const result = await consumeEmailOtpChallenge({
    email: normalizeEmail(input.email),
    purpose: input.purpose,
    code: input.code,
    maxAttempts: otpMaxAttempts(),
  });

  if (!result.ok) {
    const message =
      result.reason === 'expired'
        ? 'Verification code expired or was not requested'
        : result.reason === 'too_many_attempts'
          ? 'Too many invalid verification attempts'
          : 'Invalid verification code';
    throw new InviteGateError(401, result.reason, message);
  }

  return {
    email: result.payload.email,
    ttlSeconds: result.ttlSeconds,
    ...(result.payload.inviteCode && { inviteCode: result.payload.inviteCode }),
  };
}

async function restoreConsumedEmailCode(input: {
  email: string;
  purpose: EmailOtpPurpose;
  code: string;
  ttlSeconds: number;
  inviteCode?: string;
}): Promise<void> {
  try {
    await restoreEmailOtpChallenge({
      email: normalizeEmail(input.email),
      purpose: input.purpose,
      code: input.code,
      ttlSeconds: input.ttlSeconds,
      inviteCode: normalizeInviteCode(input.inviteCode),
    });
  } catch (err) {
    console.warn('[EmailAuth] Failed to restore consumed OTP after invite-gate error:', err);
  }
}

// ---------------------------------------------------------------------------
// POST /auth/email/request-code
// ---------------------------------------------------------------------------

emailAuthRouter.post('/request-code', async (req, res) => {
  try {
    const body = requestCodeSchema.parse(req.body);
    const result = await issueEmailCode({
      email: body.email,
      purpose: body.purpose,
      inviteCode: body.inviteCode,
    });

    if (result.cooldownSeconds) {
      res.status(429).json({
        error: `Please wait ${result.cooldownSeconds}s before requesting another code`,
        cooldownSeconds: result.cooldownSeconds,
      });
      return;
    }

    res.json({
      sent: result.sent,
      expiresIn: otpTtlSeconds(),
      ...(result.devCode && { devCode: result.devCode }),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      return;
    }
    console.error('[EmailAuth] Request code error:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/email/verify
// Existing email logs in; new email registers after invite-gate satisfaction.
// ---------------------------------------------------------------------------

export async function verifyEmailCodeHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = verifyCodeSchema.parse(req.body);
    const payload = await consumeEmailCode({ email: body.email, purpose: 'login', code: body.code });
    const email = normalizeEmail(payload.email);

    const [existing] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
        walletAddress: schema.users.walletAddress,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing) {
      const tokens = await issueTokenPair({
        userId: existing.id,
        username: existing.username,
        ...(existing.walletAddress && { walletAddress: existing.walletAddress }),
      });
      res.json({ ...tokens, user: existing, created: false });
      return;
    }

    const inviteCode = normalizeInviteCode(body.inviteCode) ?? payload.inviteCode;
    let created: Awaited<ReturnType<typeof createHumanUserWithInviteGate>>;
    try {
      created = await createHumanUserWithInviteGate({
        email,
        username: body.username ?? usernameFromEmail(email),
        inviteCode,
      });
    } catch (err) {
      if (err instanceof InviteGateError) {
        await restoreConsumedEmailCode({
          email,
          purpose: 'login',
          code: body.code,
          ttlSeconds: payload.ttlSeconds,
          inviteCode,
        });
      }
      throw err;
    }

    await chipService.allocateRegistrationBonus(created.user.id);
    if (created.inviteCodeId) {
      await chipService.allocateInviteRefereeReward(created.user.id, created.inviteCodeId);
    }

    const tokens = await issueTokenPair({
      userId: created.user.id,
      username: created.user.username,
    });

    res.status(201).json({
      ...tokens,
      user: { ...created.user, walletAddress: null },
      created: true,
      inviteGate: { reason: created.reason },
    });
  } catch (err) {
    if (err instanceof InviteGateError) {
      inviteGateErrorResponse(res, err);
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      return;
    }
    const message = err instanceof Error ? err.message : 'Email verification failed';
    const status = message.includes('unique') ? 409 : 500;
    console.error('[EmailAuth] Verify error:', err);
    res.status(status).json({ error: status === 409 ? 'Email or username already registered' : 'Email verification failed' });
  }
}

emailAuthRouter.post('/verify', verifyEmailCodeHandler);

// Retired password endpoints kept as explicit errors for old callers.
emailAuthRouter.post('/register', (_req, res) => {
  res.status(400).json({ error: 'Password registration has been retired. Use /auth/email/request-code and /auth/email/verify.' });
});

emailAuthRouter.post('/login', (_req, res) => {
  res.status(400).json({ error: 'Password login has been retired. Use /auth/email/request-code and /auth/email/verify.' });
});

// ---------------------------------------------------------------------------
// Authenticated email binding
// ---------------------------------------------------------------------------

emailAuthRouter.post('/bind/request-code', requireAuth, async (req, res) => {
  try {
    const body = bindRequestSchema.parse(req.body);
    const email = normalizeEmail(body.email);

    const [currentUser] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, req.user!.userId))
      .limit(1);

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (currentUser.email) {
      res.status(409).json({ error: 'This account already has an email bound' });
      return;
    }

    const [existingEmailUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existingEmailUser && existingEmailUser.id !== req.user!.userId) {
      res.status(409).json({ error: 'Email is already bound to another account' });
      return;
    }

    const result = await issueEmailCode({
      email,
      purpose: 'bind_email',
      inviteCode: body.inviteCode,
    });

    if (result.cooldownSeconds) {
      res.status(429).json({
        error: `Please wait ${result.cooldownSeconds}s before requesting another code`,
        cooldownSeconds: result.cooldownSeconds,
      });
      return;
    }

    res.json({
      sent: result.sent,
      expiresIn: otpTtlSeconds(),
      ...(result.devCode && { devCode: result.devCode }),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      return;
    }
    console.error('[EmailAuth] Bind request error:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

emailAuthRouter.post('/bind/verify', requireAuth, async (req, res) => {
  try {
    const body = bindVerifySchema.parse(req.body);
    const payload = await consumeEmailCode({ email: body.email, purpose: 'bind_email', code: body.code });
    const email = normalizeEmail(payload.email);

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
    if (currentUser.email) {
      res.status(409).json({ error: 'This account already has an email bound' });
      return;
    }

    const [existingEmailUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existingEmailUser && existingEmailUser.id !== currentUser.id) {
      res.status(409).json({ error: 'Email is already bound to another account' });
      return;
    }

    const inviteCode = normalizeInviteCode(body.inviteCode) ?? payload.inviteCode;
    let gate: Awaited<ReturnType<typeof satisfyInviteGateForUser>>;
    try {
      gate = await satisfyInviteGateForUser({
        userId: currentUser.id,
        inviteCode,
      });
    } catch (err) {
      if (err instanceof InviteGateError) {
        await restoreConsumedEmailCode({
          email,
          purpose: 'bind_email',
          code: body.code,
          ttlSeconds: payload.ttlSeconds,
          inviteCode,
        });
      }
      throw err;
    }
    if (gate.inviteCodeId) {
      await chipService.allocateInviteRefereeReward(currentUser.id, gate.inviteCodeId);
    }

    await db
      .update(schema.users)
      .set({ email, updatedAt: new Date() })
      .where(eq(schema.users.id, currentUser.id));

    res.json({
      user: {
        ...currentUser,
        email,
      },
      inviteGate: { reason: gate.reason },
    });
  } catch (err) {
    if (err instanceof InviteGateError) {
      inviteGateErrorResponse(res, err);
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      return;
    }
    console.error('[EmailAuth] Bind verify error:', err);
    res.status(500).json({ error: 'Failed to bind email' });
  }
});
