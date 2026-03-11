/**
 * AGO-56: Google OAuth social login integration
 *
 * Flow:
 *   1. GET /auth/google          → generate CSRF state → redirect to Google
 *   2. GET /auth/google/callback → validate state → exchange code → fetch profile
 *                                → find-or-create user → award CHIP → issue JWT
 *                                → store exchange code → redirect to frontend
 *   3. GET /auth/google/exchange → redeem exchange code → return token pair
 *
 * Security guarantees:
 *  - CSRF state: single-use, Redis TTL=10min
 *  - One Google account per user (unique constraint on social_bindings)
 *  - One user per Google account (unique providerUserId constraint)
 *  - CHIP reward: idempotent via chipRewarded flag (cannot double-claim)
 *  - Exchange code: single-use, 60s TTL (tokens never pass through URL)
 */

import { Router, type Router as RouterType } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import axios from 'axios';
import { db, schema } from '../db/index.js';
import { issueTokenPair } from '../services/jwt.js';
import { chipService } from '../services/chip.js';
import {
  storeOAuthState,
  consumeOAuthState,
  storeOAuthExchange,
  consumeOAuthExchange,
} from '../services/redis.js';

export const googleOAuthRouter: RouterType = Router();

// Google OAuth app credentials (set in environment)
function getGoogleClientId(): string {
  const id = process.env['GOOGLE_CLIENT_ID'];
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set');
  return id;
}

function getGoogleClientSecret(): string {
  const secret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET is not set');
  return secret;
}

function getFrontendUrl(): string {
  return process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
}

function getApiBaseUrl(): string {
  return process.env['API_BASE_URL'] ?? 'http://localhost:4000';
}

// ---------------------------------------------------------------------------
// GET /auth/google
// Redirects user to Google OAuth authorization page.
// ---------------------------------------------------------------------------

googleOAuthRouter.get('/', async (req, res) => {
  try {
    const clientId = getGoogleClientId();

    // Generate CSRF state — single-use, 10min TTL
    const state = randomBytes(16).toString('hex');
    // Optionally pass along a userId if user is already authenticated (linking flow)
    const userId = (req.query['userId'] as string | undefined);

    await storeOAuthState(state, { provider: 'google', userId });

    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleAuthUrl.searchParams.set('client_id', clientId);
    googleAuthUrl.searchParams.set('redirect_uri', `${getApiBaseUrl()}/auth/google/callback`);
    googleAuthUrl.searchParams.set('response_type', 'code');
    googleAuthUrl.searchParams.set('scope', 'openid email profile');
    googleAuthUrl.searchParams.set('state', state);
    googleAuthUrl.searchParams.set('access_type', 'online');

    res.redirect(googleAuthUrl.toString());
  } catch (err) {
    console.error('[Google OAuth] Redirect error:', err);
    res.status(500).json({ error: 'Failed to initiate Google OAuth' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/google/callback
// Google redirects here after user authorizes (or denies).
// ---------------------------------------------------------------------------

googleOAuthRouter.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl();
  const errorRedirect = (msg: string) =>
    res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent(msg)}`);

  try {
    const code = req.query['code'] as string | undefined;
    const state = req.query['state'] as string | undefined;
    const errorParam = req.query['error'] as string | undefined;

    // User denied OAuth
    if (errorParam) {
      return errorRedirect('Google authorization was denied');
    }

    if (!code || !state) {
      return errorRedirect('Missing code or state parameter');
    }

    // Validate CSRF state (single-use)
    const statePayload = await consumeOAuthState(state);
    if (!statePayload || statePayload.provider !== 'google') {
      return errorRedirect('Invalid or expired OAuth state');
    }

    // Exchange authorization code for access token
    let googleAccessToken: string;
    try {
      const tokenResponse = await axios.post<{
        access_token: string;
        token_type: string;
        error?: string;
      }>(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id: getGoogleClientId(),
          client_secret: getGoogleClientSecret(),
          redirect_uri: `${getApiBaseUrl()}/auth/google/callback`,
          grant_type: 'authorization_code',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      if (tokenResponse.data.error || !tokenResponse.data.access_token) {
        console.error('[Google OAuth] Token exchange error:', tokenResponse.data);
        return errorRedirect('Failed to exchange authorization code');
      }

      googleAccessToken = tokenResponse.data.access_token;
    } catch (err) {
      console.error('[Google OAuth] Token exchange request failed:', err);
      return errorRedirect('Failed to exchange authorization code');
    }

    // Fetch Google user profile via userinfo endpoint
    let googleUser: { sub: string; email: string | null; name: string | null };
    try {
      const profileResponse = await axios.get<{
        sub: string;
        email?: string;
        name?: string;
        picture?: string;
        email_verified?: boolean;
      }>(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        { headers: { Authorization: `Bearer ${googleAccessToken}` } },
      );

      googleUser = {
        sub: profileResponse.data.sub,
        email: profileResponse.data.email ?? null,
        name: profileResponse.data.name ?? null,
      };
    } catch (err) {
      console.error('[Google OAuth] Profile fetch failed:', err);
      return errorRedirect('Failed to fetch Google profile');
    }

    const providerUserId = googleUser.sub;

    // Find existing binding for this Google account
    const [existingBinding] = await db
      .select({ userId: schema.socialBindings.userId })
      .from(schema.socialBindings)
      .where(
        and(
          eq(schema.socialBindings.provider, 'google'),
          eq(schema.socialBindings.providerUserId, providerUserId),
        ),
      )
      .limit(1);

    let userId: string;
    let username: string;
    let walletAddress: string | null = null;

    if (existingBinding) {
      if (statePayload.userId && statePayload.userId !== existingBinding.userId) {
        // Linking flow: Google account is already claimed by a different user — reject
        return errorRedirect('Google account is already linked to another user');
      }

      // Existing Google user — log them in (fresh login or same user re-linking)
      userId = existingBinding.userId;

      const [user] = await db
        .select({ username: schema.users.username, walletAddress: schema.users.walletAddress })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (!user) {
        return errorRedirect('User account not found');
      }

      username = user.username;
      walletAddress = user.walletAddress ?? null;
    } else if (statePayload.userId) {
      // Linking flow: user is already authenticated — bind Google to their existing account
      userId = statePayload.userId;

      const [user] = await db
        .select({ username: schema.users.username, walletAddress: schema.users.walletAddress })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (!user) {
        return errorRedirect('User account not found');
      }

      username = user.username;
      walletAddress = user.walletAddress ?? null;

      // Create the binding
      await db.insert(schema.socialBindings).values({
        userId,
        provider: 'google',
        providerUserId,
        providerUsername: googleUser.name ?? undefined,
        providerEmail: googleUser.email ?? undefined,
        chipRewarded: false,
      });
    } else {
      // New user — create account + binding
      // Derive username from display name or fall back to a generic prefix
      const baseName = googleUser.name
        ? `g_${googleUser.name.replace(/\s+/g, '_').toLowerCase()}`.slice(0, 44)
        : 'google_user';
      const candidateUsername = `${baseName}_${randomBytes(2).toString('hex')}`;

      const [newUser] = await db
        .insert(schema.users)
        .values({
          username: candidateUsername,
          email: googleUser.email ?? undefined,
        })
        .returning({ id: schema.users.id, username: schema.users.username });

      if (!newUser) {
        return errorRedirect('Failed to create user account');
      }

      userId = newUser.id;
      username = newUser.username;

      await db.insert(schema.socialBindings).values({
        userId,
        provider: 'google',
        providerUserId,
        providerUsername: googleUser.name ?? undefined,
        providerEmail: googleUser.email ?? undefined,
        chipRewarded: false,
      });

      // Award registration bonus for brand-new users
      await chipService.allocateRegistrationBonus(userId);
    }

    // Award CHIP for first Google binding (idempotent — guarded by chipRewarded flag)
    await chipService.allocateSocialBindingReward(userId, 'google', providerUserId);

    // Issue JWT token pair
    const tokens = await issueTokenPair({
      userId,
      username,
      ...(walletAddress && { walletAddress }),
    });

    // Store exchange code (60s TTL) — tokens never travel via redirect URL
    const exchangeCode = randomUUID();
    await storeOAuthExchange(exchangeCode, tokens);

    // Redirect to frontend with exchange code
    res.redirect(`${frontendUrl}/auth/callback?code=${exchangeCode}`);
  } catch (err) {
    console.error('[Google OAuth] Callback error:', err);
    return errorRedirect('Google OAuth failed');
  }
});

// ---------------------------------------------------------------------------
// GET /auth/google/exchange?code=<exchangeCode>
// Frontend redeems a short-lived exchange code for a token pair.
// Shared across all OAuth providers (same Redis key space).
// ---------------------------------------------------------------------------

googleOAuthRouter.get('/exchange', async (req, res) => {
  const code = req.query['code'] as string | undefined;
  if (!code) {
    res.status(400).json({ error: 'Missing exchange code' });
    return;
  }

  const payload = await consumeOAuthExchange(code);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired exchange code' });
    return;
  }

  res.json(payload);
});
