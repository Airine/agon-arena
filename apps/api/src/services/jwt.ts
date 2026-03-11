import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'crypto';
import { getRedisClient } from './redis.js';

const JWT_SECRET = getJwtSecret();
const JWT_ISSUER = 'agon-arena';
const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;    // 24 hours
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret && process.env['NODE_ENV'] === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (!secret) {
    console.warn('[JWT] No JWT_SECRET set — using dev-only fallback. DO NOT use in production.');
  }
  return secret ?? 'dev-only-unsafe-secret-do-not-use-in-production';
}

// ---------------------------------------------------------------------------
// Token payload types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  // Standard claims (set by jsonwebtoken: sub, iat, exp, iss)
  sub: string;       // userId
  jti: string;       // unique token ID for revocation
  iat?: number;
  exp?: number;
  iss?: string;

  // Agon custom claims
  type: 'human' | 'agent';
  account_id: string;    // userId (alias for sub, per TechArch spec)
  username: string;
  walletAddress?: string; // EVM address (lowercase 0x...) — present for Web3 users
  agentId?: string;       // Present for agent JWTs
}

export interface TokenIssuanceInput {
  userId: string;
  username: string;
  type?: 'human' | 'agent';
  walletAddress?: string;
  agentId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

// ---------------------------------------------------------------------------
// Access token: sign / verify
// ---------------------------------------------------------------------------

/**
 * Sign a new access token (24h TTL).
 * Embeds jti for revocation support.
 */
export function signAccessToken(input: TokenIssuanceInput): string {
  const jti = randomUUID();
  const type: 'human' | 'agent' = input.type ?? (input.agentId ? 'agent' : 'human');

  const payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'> = {
    sub: input.userId,
    jti,
    type,
    account_id: input.userId,
    username: input.username,
    ...(input.walletAddress && { walletAddress: input.walletAddress }),
    ...(input.agentId && { agentId: input.agentId }),
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: JWT_ISSUER,
  });
}

/**
 * Verify an access token.
 * Returns the payload if valid; throws on invalid/expired.
 * Does NOT check the revocation blacklist here (use `verifyAccessTokenFull` for that).
 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as JwtPayload;
}

/**
 * Verify an access token AND check the Redis blacklist.
 * Throws if the token has been revoked.
 */
export async function verifyAccessTokenFull(token: string): Promise<JwtPayload> {
  const payload = verifyAccessToken(token);

  if (await isJtiBlacklisted(payload.jti)) {
    throw new Error('Token has been revoked');
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Refresh tokens: issue / consume / revoke
// ---------------------------------------------------------------------------

/**
 * Issue a token pair (access + refresh).
 * The refresh token is stored in Redis with a 7-day TTL.
 * Returns both tokens.
 */
export async function issueTokenPair(input: TokenIssuanceInput): Promise<TokenPair> {
  const accessToken = signAccessToken(input);
  const refreshToken = randomUUID();
  await storeRefreshToken(refreshToken, input, REFRESH_TOKEN_TTL_SECONDS);

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Refresh: consume an existing refresh token and issue a new token pair.
 * Atomic: the old refresh token is deleted before the new pair is issued.
 *
 * Returns null if the refresh token is invalid or expired.
 */
export async function rotateRefreshToken(refreshToken: string): Promise<TokenPair | null> {
  const input = await consumeRefreshToken(refreshToken);
  if (!input) return null;

  return issueTokenPair(input);
}

// ---------------------------------------------------------------------------
// Token revocation (access token blacklist)
// ---------------------------------------------------------------------------

/**
 * Revoke an access token by blacklisting its jti in Redis.
 * The blacklist entry TTL matches the token's remaining lifetime (up to 24h).
 */
export async function revokeAccessToken(token: string): Promise<void> {
  let payload: JwtPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    // Already expired or invalid — nothing to revoke
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp ?? now + ACCESS_TOKEN_TTL_SECONDS;
  const ttl = Math.max(1, exp - now);

  await blacklistJti(payload.jti, ttl);
}

// ---------------------------------------------------------------------------
// Redis helpers (JWT-specific keys)
// ---------------------------------------------------------------------------

const JTI_BLACKLIST_PREFIX = 'jwt:blacklist:';
const REFRESH_TOKEN_PREFIX = 'jwt:refresh:';

async function blacklistJti(jti: string, ttlSeconds: number): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(`${JTI_BLACKLIST_PREFIX}${jti}`, '1', { EX: ttlSeconds });
}

async function isJtiBlacklisted(jti: string): Promise<boolean> {
  const redis = await getRedisClient();
  const val = await redis.get(`${JTI_BLACKLIST_PREFIX}${jti}`);
  return val !== null;
}

async function storeRefreshToken(
  token: string,
  input: TokenIssuanceInput,
  ttlSeconds: number,
): Promise<void> {
  const redis = await getRedisClient();
  // Hash the token before storing (avoid leaking raw token in Redis dump)
  const key = `${REFRESH_TOKEN_PREFIX}${hashToken(token)}`;
  await redis.set(key, JSON.stringify(input), { EX: ttlSeconds });
}

async function consumeRefreshToken(token: string): Promise<TokenIssuanceInput | null> {
  const redis = await getRedisClient();
  const key = `${REFRESH_TOKEN_PREFIX}${hashToken(token)}`;
  const val = await redis.getDel(key); // atomic get-and-delete
  if (!val) return null;
  try {
    return JSON.parse(val) as TokenIssuanceInput;
  } catch {
    return null;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Legacy compatibility shim
// (keeps middleware/auth.ts unchanged — existing callers still work)
// ---------------------------------------------------------------------------

/** @deprecated Use signAccessToken + issueTokenPair instead. */
export const legacySignToken = signAccessToken;
/** @deprecated Use verifyAccessToken instead. */
export const legacyVerifyToken = verifyAccessToken;
