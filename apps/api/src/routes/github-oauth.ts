/**
 * AGO-55: GitHub OAuth social login integration
 *
 * Flow:
 *   1. GET /auth/github          → generate CSRF state → redirect to GitHub
 *   2. GET /auth/github/callback → validate state → exchange code → fetch profile
 *                                → find-or-create user → award CHIP → issue JWT
 *                                → store exchange code → redirect to frontend
 *   3. GET /auth/exchange        → redeem exchange code → return token pair
 *
 * Security guarantees:
 *  - CSRF state: single-use, Redis TTL=10min
 *  - One GitHub account per user (unique constraint on social_bindings)
 *  - One user per GitHub account (unique providerUserId constraint)
 *  - CHIP reward: idempotent via chipRewarded flag (cannot double-claim)
 *  - Exchange code: single-use, 60s TTL (tokens never pass through URL)
 */

import { Router, type Router as RouterType } from 'express';
import { randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import axios from 'axios';
import { db, schema } from '../db/index.js';
import { issueTokenPair } from '../services/jwt.js';
import { chipService } from '../services/chip.js';
import { createHumanUserWithInviteGate, InviteGateError } from '../services/invite-gate.js';
import {
  storeOAuthState,
  consumeOAuthState,
  storeOAuthExchange,
  consumeOAuthExchange,
} from '../services/redis.js';

export const githubOAuthRouter: RouterType = Router();

// GitHub OAuth app credentials (set in environment)
function getGitHubClientId(): string {
  const id = process.env['GITHUB_CLIENT_ID'];
  if (!id) throw new Error('GITHUB_CLIENT_ID is not set');
  return id;
}

function getGitHubClientSecret(): string {
  const secret = process.env['GITHUB_CLIENT_SECRET'];
  if (!secret) throw new Error('GITHUB_CLIENT_SECRET is not set');
  return secret;
}

function getFrontendUrl(): string {
  return process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
}


// ---------------------------------------------------------------------------
// GET /auth/github
// Redirects user to GitHub OAuth authorization page.
// ---------------------------------------------------------------------------

githubOAuthRouter.get('/', async (req, res) => {
  try {
    const clientId = getGitHubClientId();

    // Generate CSRF state — single-use, 10min TTL
    const state = randomBytes(16).toString('hex');
    // Optionally pass along a userId if user is already authenticated (linking flow)
    const userId = (req.query['userId'] as string | undefined);
    const inviteCode = (req.query['inviteCode'] as string | undefined)?.trim().toUpperCase();

    await storeOAuthState(state, { provider: 'github', userId, inviteCode });

    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', clientId);
    githubAuthUrl.searchParams.set('state', state);
    githubAuthUrl.searchParams.set('scope', 'read:user user:email');

    res.redirect(githubAuthUrl.toString());
  } catch (err) {
    console.error('[GitHub OAuth] Redirect error:', err);
    res.status(500).json({ error: 'Failed to initiate GitHub OAuth' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/github/callback
// GitHub redirects here after user authorizes (or denies).
// ---------------------------------------------------------------------------

githubOAuthRouter.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl();
  const errorRedirect = (msg: string) =>
    res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent(msg)}`);

  try {
    const code = req.query['code'] as string | undefined;
    const state = req.query['state'] as string | undefined;
    const errorParam = req.query['error'] as string | undefined;

    // User denied OAuth
    if (errorParam) {
      return errorRedirect('GitHub authorization was denied');
    }

    if (!code || !state) {
      return errorRedirect('Missing code or state parameter');
    }

    // Validate CSRF state (single-use)
    const statePayload = await consumeOAuthState(state);
    if (!statePayload || statePayload.provider !== 'github') {
      return errorRedirect('Invalid or expired OAuth state');
    }

    // Exchange authorization code for access token
    let githubAccessToken: string;
    try {
      const tokenResponse = await axios.post<{ access_token: string; error?: string }>(
        'https://github.com/login/oauth/access_token',
        {
          client_id: getGitHubClientId(),
          client_secret: getGitHubClientSecret(),
          code,
        },
        { headers: { Accept: 'application/json' } },
      );

      if (tokenResponse.data.error || !tokenResponse.data.access_token) {
        console.error('[GitHub OAuth] Token exchange error:', tokenResponse.data);
        return errorRedirect('Failed to exchange authorization code');
      }

      githubAccessToken = tokenResponse.data.access_token;
    } catch (err) {
      console.error('[GitHub OAuth] Token exchange request failed:', err);
      return errorRedirect('Failed to exchange authorization code');
    }

    // Fetch GitHub user profile
    let githubUser: { id: number; login: string; email: string | null; name: string | null };
    try {
      const [profileResponse, emailsResponse] = await Promise.all([
        axios.get<{ id: number; login: string; name: string | null; email: string | null }>(
          'https://api.github.com/user',
          { headers: { Authorization: `Bearer ${githubAccessToken}`, 'User-Agent': 'Agon-Arena' } },
        ),
        axios.get<Array<{ email: string; primary: boolean; verified: boolean }>>(
          'https://api.github.com/user/emails',
          { headers: { Authorization: `Bearer ${githubAccessToken}`, 'User-Agent': 'Agon-Arena' } },
        ),
      ]);

      const primaryEmail = emailsResponse.data.find((e) => e.primary && e.verified)?.email
        ?? emailsResponse.data.find((e) => e.verified)?.email
        ?? profileResponse.data.email
        ?? null;

      githubUser = {
        id: profileResponse.data.id,
        login: profileResponse.data.login,
        name: profileResponse.data.name,
        email: primaryEmail,
      };
    } catch (err) {
      console.error('[GitHub OAuth] Profile fetch failed:', err);
      return errorRedirect('Failed to fetch GitHub profile');
    }

    const providerUserId = String(githubUser.id);

    // Find existing binding for this GitHub account
    const [existingBinding] = await db
      .select({ userId: schema.socialBindings.userId })
      .from(schema.socialBindings)
      .where(
        and(
          eq(schema.socialBindings.provider, 'github'),
          eq(schema.socialBindings.providerUserId, providerUserId),
        ),
      )
      .limit(1);

    let userId: string;
    let username: string;
    let walletAddress: string | null = null;

    if (existingBinding) {
      if (statePayload.userId && statePayload.userId !== existingBinding.userId) {
        // Linking flow: GitHub account is already claimed by a different user — reject
        return errorRedirect('GitHub account is already linked to another user');
      }

      // Existing GitHub user — log them in (fresh login or same user re-linking)
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
      // Linking flow: user is already authenticated — bind GitHub to their existing account
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
        provider: 'github',
        providerUserId,
        providerUsername: githubUser.login,
        providerEmail: githubUser.email ?? undefined,
        chipRewarded: false,
      });
    } else {
      // New user — create account + binding
      const baseUsername = `gh_${githubUser.login}`.slice(0, 44);
      // Append random suffix to avoid collisions
      const candidateUsername = `${baseUsername}_${randomBytes(2).toString('hex')}`;

      const created = await createHumanUserWithInviteGate({
        username: candidateUsername,
        email: githubUser.email ?? undefined,
        inviteCode: statePayload.inviteCode,
      });

      userId = created.user.id;
      username = created.user.username;

      await db.insert(schema.socialBindings).values({
        userId,
        provider: 'github',
        providerUserId,
        providerUsername: githubUser.login,
        providerEmail: githubUser.email ?? undefined,
        chipRewarded: false,
      });

      // Award registration bonus for brand-new users
      await chipService.allocateRegistrationBonus(userId);
      if (created.inviteCodeId) {
        await chipService.allocateInviteRefereeReward(userId, created.inviteCodeId);
      }
    }

    // Award CHIP for first GitHub binding (idempotent — guarded by chipRewarded flag)
    await chipService.allocateSocialBindingReward(userId, 'github', providerUserId);

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
    if (err instanceof InviteGateError) {
      return errorRedirect(err.message);
    }
    console.error('[GitHub OAuth] Callback error:', err);
    return errorRedirect('GitHub OAuth failed');
  }
});

// ---------------------------------------------------------------------------
// GET /auth/exchange?code=<exchangeCode>
// Frontend redeems a short-lived exchange code for a token pair.
// Shared across all OAuth providers.
// ---------------------------------------------------------------------------

githubOAuthRouter.get('/exchange', async (req, res) => {
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
