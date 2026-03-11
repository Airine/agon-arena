/**
 * AGO-65: X (Twitter) OAuth 2.0 PKCE social login integration
 *
 * Flow:
 *   1. GET /auth/twitter          → generate CSRF state + PKCE → redirect to X
 *   2. GET /auth/twitter/callback → validate state → exchange code+verifier for token
 *                                 → fetch profile → find-or-create user → award CHIP
 *                                 → issue JWT → store exchange code → redirect to frontend
 *   3. GET /auth/twitter/exchange → redeem exchange code → return token pair
 *
 * Security guarantees:
 *  - CSRF state: single-use, Redis TTL=10min
 *  - PKCE: SHA-256 code challenge (S256 method, required by Twitter OAuth 2.0)
 *  - One Twitter account per user (unique constraint on social_bindings)
 *  - One user per Twitter account (unique providerUserId constraint)
 *  - CHIP reward: idempotent via chipRewarded flag (cannot double-claim)
 *  - Exchange code: single-use, 60s TTL (tokens never pass through URL)
 */

import { Router, type Router as RouterType } from 'express';
import { randomBytes, randomUUID, createHash } from 'crypto';
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

export const twitterOAuthRouter: RouterType = Router();

// Twitter OAuth 2.0 app credentials (set in environment)
function getTwitterClientId(): string {
  const id = process.env['TWITTER_CLIENT_ID'];
  if (!id) throw new Error('TWITTER_CLIENT_ID is not set');
  return id;
}

function getTwitterClientSecret(): string {
  const secret = process.env['TWITTER_CLIENT_SECRET'];
  if (!secret) throw new Error('TWITTER_CLIENT_SECRET is not set');
  return secret;
}

function getTwitterRedirectUri(): string {
  return process.env['TWITTER_REDIRECT_URI'] ?? 'http://localhost:3001/auth/twitter/callback';
}

function getFrontendUrl(): string {
  return process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * Generate a PKCE code verifier — 43-128 chars, base64url-encoded random bytes.
 * Using 32 bytes → 43 base64url characters (after removing padding).
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Derive PKCE code challenge from verifier using SHA-256.
 * code_challenge = base64url(SHA256(code_verifier))
 */
function generateCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// GET /auth/twitter
// Redirects user to X (Twitter) OAuth 2.0 authorization page.
// ---------------------------------------------------------------------------

twitterOAuthRouter.get('/', async (req, res) => {
  try {
    const clientId = getTwitterClientId();

    // Generate CSRF state — single-use, 10min TTL
    const state = randomBytes(16).toString('hex');
    // Optionally pass along a userId if user is already authenticated (linking flow)
    const userId = (req.query['userId'] as string | undefined);

    // Generate PKCE code verifier and challenge
    const codeVerifier = generateCodeVerifier();

    await storeOAuthState(state, { provider: 'twitter', userId, codeVerifier });

    const twitterAuthUrl = new URL('https://twitter.com/i/oauth2/authorize');
    twitterAuthUrl.searchParams.set('response_type', 'code');
    twitterAuthUrl.searchParams.set('client_id', clientId);
    twitterAuthUrl.searchParams.set('redirect_uri', getTwitterRedirectUri());
    twitterAuthUrl.searchParams.set('state', state);
    twitterAuthUrl.searchParams.set('scope', 'tweet.read users.read offline.access');
    twitterAuthUrl.searchParams.set('code_challenge', generateCodeChallenge(codeVerifier));
    twitterAuthUrl.searchParams.set('code_challenge_method', 'S256');

    res.redirect(twitterAuthUrl.toString());
  } catch (err) {
    console.error('[Twitter OAuth] Redirect error:', err);
    res.status(500).json({ error: 'Failed to initiate Twitter OAuth' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/twitter/callback
// Twitter redirects here after user authorizes (or denies).
// ---------------------------------------------------------------------------

twitterOAuthRouter.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl();
  const errorRedirect = (msg: string) =>
    res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent(msg)}`);

  try {
    const code = req.query['code'] as string | undefined;
    const state = req.query['state'] as string | undefined;
    const errorParam = req.query['error'] as string | undefined;

    // User denied OAuth
    if (errorParam) {
      return errorRedirect('Twitter authorization was denied');
    }

    if (!code || !state) {
      return errorRedirect('Missing code or state parameter');
    }

    // Validate CSRF state (single-use) — also retrieves codeVerifier
    const statePayload = await consumeOAuthState(state);
    if (!statePayload || statePayload.provider !== 'twitter') {
      return errorRedirect('Invalid or expired OAuth state');
    }

    const codeVerifier = statePayload.codeVerifier;
    if (!codeVerifier) {
      return errorRedirect('Missing PKCE code verifier');
    }

    // Exchange authorization code + PKCE verifier for access token
    let twitterAccessToken: string;
    try {
      const clientId = getTwitterClientId();
      const clientSecret = getTwitterClientSecret();
      // Basic auth: base64(client_id:client_secret)
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const tokenResponse = await axios.post<{
        access_token: string;
        token_type: string;
        error?: string;
        error_description?: string;
      }>(
        'https://api.twitter.com/2/oauth2/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: getTwitterRedirectUri(),
          code_verifier: codeVerifier,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
          },
        },
      );

      if (tokenResponse.data.error || !tokenResponse.data.access_token) {
        console.error('[Twitter OAuth] Token exchange error:', tokenResponse.data);
        return errorRedirect('Failed to exchange authorization code');
      }

      twitterAccessToken = tokenResponse.data.access_token;
    } catch (err) {
      console.error('[Twitter OAuth] Token exchange request failed:', err);
      return errorRedirect('Failed to exchange authorization code');
    }

    // Fetch Twitter user profile
    let twitterUser: { id: string; username: string; name: string };
    try {
      const profileResponse = await axios.get<{
        data: { id: string; username: string; name: string };
      }>(
        'https://api.twitter.com/2/users/me?user.fields=username,name',
        { headers: { Authorization: `Bearer ${twitterAccessToken}` } },
      );

      twitterUser = {
        id: profileResponse.data.data.id,
        username: profileResponse.data.data.username,
        name: profileResponse.data.data.name,
      };
    } catch (err) {
      console.error('[Twitter OAuth] Profile fetch failed:', err);
      return errorRedirect('Failed to fetch Twitter profile');
    }

    const providerUserId = String(twitterUser.id);
    const providerUsername = `@${twitterUser.username}`;

    // Find existing binding for this Twitter account
    const [existingBinding] = await db
      .select({ userId: schema.socialBindings.userId })
      .from(schema.socialBindings)
      .where(
        and(
          eq(schema.socialBindings.provider, 'twitter'),
          eq(schema.socialBindings.providerUserId, providerUserId),
        ),
      )
      .limit(1);

    let userId: string;
    let username: string;
    let walletAddress: string | null = null;

    if (existingBinding) {
      if (statePayload.userId && statePayload.userId !== existingBinding.userId) {
        // Linking flow: Twitter account is already claimed by a different user — reject
        return errorRedirect('Twitter account is already linked to another user');
      }

      // Existing Twitter user — log them in (fresh login or same user re-linking)
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
      // Linking flow: user is already authenticated — bind Twitter to their existing account
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
        provider: 'twitter',
        providerUserId,
        providerUsername,
        chipRewarded: false,
      });
    } else {
      // New user — create account + binding
      const baseName = `tw_${twitterUser.username}`.slice(0, 44);
      // Append random suffix to avoid collisions
      const candidateUsername = `${baseName}_${randomBytes(2).toString('hex')}`;

      const [newUser] = await db
        .insert(schema.users)
        .values({
          username: candidateUsername,
        })
        .returning({ id: schema.users.id, username: schema.users.username });

      if (!newUser) {
        return errorRedirect('Failed to create user account');
      }

      userId = newUser.id;
      username = newUser.username;

      await db.insert(schema.socialBindings).values({
        userId,
        provider: 'twitter',
        providerUserId,
        providerUsername,
        chipRewarded: false,
      });

      // Award registration bonus for brand-new users
      await chipService.allocateRegistrationBonus(userId);
    }

    // Award CHIP for first Twitter binding (idempotent — guarded by chipRewarded flag)
    await chipService.allocateSocialBindingReward(userId, 'twitter', providerUserId);

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
    console.error('[Twitter OAuth] Callback error:', err);
    return errorRedirect('Twitter OAuth failed');
  }
});

// ---------------------------------------------------------------------------
// GET /auth/twitter/exchange?code=<exchangeCode>
// Frontend redeems a short-lived exchange code for a token pair.
// ---------------------------------------------------------------------------

twitterOAuthRouter.get('/exchange', async (req, res) => {
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
