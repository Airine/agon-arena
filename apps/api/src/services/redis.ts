import { createClient, type RedisClientType } from 'redis';
import { createHash } from 'crypto';
import type {
  AgentActionSubmission,
  AgentRuntimeSnapshot,
  AgentTurnRequest,
  GameState,
} from '@agon/types';

type RedisClient = RedisClientType;

let client: RedisClient | null = null;

export async function getRedisClient(): Promise<RedisClient> {
  if (!client) {
    client = createClient({
      url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    }) as RedisClient;
    client.on('error', (err) => console.error('[Redis] Client error:', err));
    await client.connect();
  }
  return client;
}

const SIWE_NONCE_PREFIX = 'siwe:nonce:';
const SIWE_NONCE_TTL_SECONDS = 300; // 5 minutes

/**
 * Store a SIWE nonce in Redis with 5-minute TTL.
 * Key: siwe:nonce:<nonce>  Value: "1" (existence check only)
 */
export async function storeSiweNonce(nonce: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(`${SIWE_NONCE_PREFIX}${nonce}`, '1', {
    EX: SIWE_NONCE_TTL_SECONDS,
  });
}

/**
 * Consume a SIWE nonce — atomic check-and-delete.
 * Returns true if nonce existed (valid), false if already used or expired.
 */
export async function consumeSiweNonce(nonce: string): Promise<boolean> {
  const redis = await getRedisClient();
  // Use DEL which returns the count of deleted keys (1 = existed, 0 = not found)
  const deleted = await redis.del(`${SIWE_NONCE_PREFIX}${nonce}`);
  return deleted === 1;
}

const AGENT_NONCE_PREFIX = 'agent:nonce:';
const AGENT_NONCE_TTL_SECONDS = 300; // 5 minutes

/**
 * Store an agent registration nonce in Redis with 5-minute TTL.
 * Key: agent:nonce:<nonce>  Value: "1"
 */
export async function storeAgentNonce(nonce: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(`${AGENT_NONCE_PREFIX}${nonce}`, '1', {
    EX: AGENT_NONCE_TTL_SECONDS,
  });
}

/**
 * Consume an agent registration nonce — atomic check-and-delete.
 * Returns true if nonce existed (valid), false if already used or expired.
 */
export async function consumeAgentNonce(nonce: string): Promise<boolean> {
  const redis = await getRedisClient();
  const deleted = await redis.del(`${AGENT_NONCE_PREFIX}${nonce}`);
  return deleted === 1;
}

const AGENT_ACCESS_NONCE_PREFIX = 'agent:access:nonce:';
const AGENT_ACCESS_NONCE_TTL_SECONDS = 300; // 5 minutes

/**
 * Claim an agent access nonce that the client generated itself.
 * Returns true only for the first successful claim within the TTL window.
 */
export async function claimAgentAccessNonce(nonce: string): Promise<boolean> {
  const redis = await getRedisClient();
  const result = await redis.set(`${AGENT_ACCESS_NONCE_PREFIX}${nonce}`, '1', {
    EX: AGENT_ACCESS_NONCE_TTL_SECONDS,
    NX: true,
  });
  return result === 'OK';
}

const BIND_NONCE_PREFIX = 'bind:nonce:';
const BIND_NONCE_TTL_SECONDS = 300; // 5 minutes

/**
 * Store an owner-bind nonce in Redis with 5-minute TTL.
 * Key: bind:nonce:<nonce>  Value: "1"
 */
export async function storeBindNonce(nonce: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(`${BIND_NONCE_PREFIX}${nonce}`, '1', {
    EX: BIND_NONCE_TTL_SECONDS,
  });
}

/**
 * Consume an owner-bind nonce — atomic check-and-delete.
 * Returns true if nonce existed (valid), false if already used or expired.
 */
export async function consumeBindNonce(nonce: string): Promise<boolean> {
  const redis = await getRedisClient();
  const deleted = await redis.del(`${BIND_NONCE_PREFIX}${nonce}`);
  return deleted === 1;
}

// ---------------------------------------------------------------------------
// Email OTP challenges
// ---------------------------------------------------------------------------

export type EmailOtpPurpose = 'login' | 'bind_email';

export interface EmailOtpChallengePayload {
  email: string;
  purpose: EmailOtpPurpose;
  codeHash: string;
  attempts: number;
  inviteCode?: string;
  username?: string;
  createdAt: number;
}

export type EmailOtpConsumeResult =
  | { ok: true; payload: Omit<EmailOtpChallengePayload, 'codeHash' | 'attempts'>; ttlSeconds: number }
  | { ok: false; reason: 'expired' | 'invalid_code' | 'too_many_attempts' };

const EMAIL_OTP_PREFIX = 'email:otp:';
const EMAIL_OTP_COOLDOWN_PREFIX = 'email:otp:cooldown:';

function normalizeEmailForRedis(email: string): string {
  return email.trim().toLowerCase();
}

function emailOtpKey(email: string, purpose: EmailOtpPurpose): string {
  return `${EMAIL_OTP_PREFIX}${purpose}:${normalizeEmailForRedis(email)}`;
}

function emailOtpCooldownKey(email: string, purpose: EmailOtpPurpose): string {
  return `${EMAIL_OTP_COOLDOWN_PREFIX}${purpose}:${normalizeEmailForRedis(email)}`;
}

function hashEmailOtpCode(email: string, purpose: EmailOtpPurpose, code: string): string {
  return createHash('sha256')
    .update(`${normalizeEmailForRedis(email)}:${purpose}:${code}`)
    .digest('hex');
}

export async function storeEmailOtpChallenge(input: {
  email: string;
  purpose: EmailOtpPurpose;
  code: string;
  ttlSeconds: number;
  cooldownSeconds: number;
  inviteCode?: string;
  username?: string;
}): Promise<{ stored: true } | { stored: false; cooldownSeconds: number }> {
  const redis = await getRedisClient();
  const cooldownKey = emailOtpCooldownKey(input.email, input.purpose);
  const cooldown = await redis.set(cooldownKey, '1', {
    EX: input.cooldownSeconds,
    NX: true,
  });

  if (cooldown !== 'OK') {
    const ttl = await redis.ttl(cooldownKey);
    return { stored: false, cooldownSeconds: ttl > 0 ? ttl : input.cooldownSeconds };
  }

  const payload: EmailOtpChallengePayload = {
    email: normalizeEmailForRedis(input.email),
    purpose: input.purpose,
    codeHash: hashEmailOtpCode(input.email, input.purpose, input.code),
    attempts: 0,
    ...(input.inviteCode && { inviteCode: input.inviteCode }),
    ...(input.username && { username: input.username }),
    createdAt: Date.now(),
  };

  await redis.set(emailOtpKey(input.email, input.purpose), JSON.stringify(payload), {
    EX: input.ttlSeconds,
  });

  return { stored: true };
}

export async function restoreEmailOtpChallenge(input: {
  email: string;
  purpose: EmailOtpPurpose;
  code: string;
  ttlSeconds: number;
  inviteCode?: string;
  username?: string;
}): Promise<void> {
  if (input.ttlSeconds <= 0) return;

  const redis = await getRedisClient();
  const payload: EmailOtpChallengePayload = {
    email: normalizeEmailForRedis(input.email),
    purpose: input.purpose,
    codeHash: hashEmailOtpCode(input.email, input.purpose, input.code),
    attempts: 0,
    ...(input.inviteCode && { inviteCode: input.inviteCode }),
    ...(input.username && { username: input.username }),
    createdAt: Date.now(),
  };

  await redis.set(emailOtpKey(input.email, input.purpose), JSON.stringify(payload), {
    EX: input.ttlSeconds,
  });
}

export async function consumeEmailOtpChallenge(input: {
  email: string;
  purpose: EmailOtpPurpose;
  code: string;
  maxAttempts: number;
}): Promise<EmailOtpConsumeResult> {
  const redis = await getRedisClient();
  const key = emailOtpKey(input.email, input.purpose);
  const value = await redis.get(key);
  if (!value) return { ok: false, reason: 'expired' };

  let payload: EmailOtpChallengePayload;
  try {
    payload = JSON.parse(value) as EmailOtpChallengePayload;
  } catch {
    await redis.del(key);
    return { ok: false, reason: 'expired' };
  }

  if (payload.attempts >= input.maxAttempts) {
    await redis.del(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const expectedHash = hashEmailOtpCode(input.email, input.purpose, input.code);
  if (payload.codeHash !== expectedHash) {
    const attempts = payload.attempts + 1;
    if (attempts >= input.maxAttempts) {
      await redis.del(key);
      return { ok: false, reason: 'too_many_attempts' };
    }

    const ttl = await redis.ttl(key);
    if (ttl > 0) {
      await redis.set(key, JSON.stringify({ ...payload, attempts }), { EX: ttl });
    } else {
      await redis.del(key);
    }
    return { ok: false, reason: 'invalid_code' };
  }

  const ttlSeconds = await redis.ttl(key);
  await redis.del(key);
  const { codeHash: _codeHash, attempts: _attempts, ...safePayload } = payload;
  return { ok: true, payload: safePayload, ttlSeconds: ttlSeconds > 0 ? ttlSeconds : 0 };
}

// ---------------------------------------------------------------------------
// OAuth CSRF state
// ---------------------------------------------------------------------------

const OAUTH_STATE_PREFIX = 'oauth:state:';
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

export interface OAuthStatePayload {
  provider: string;
  /** userId if the user is already logged in and linking (vs. fresh login) */
  userId?: string;
  /** Invite/referral code supplied before redirecting to the OAuth provider. */
  inviteCode?: string;
  /** PKCE code verifier for OAuth 2.0 flows that require it (e.g. Twitter) */
  codeVerifier?: string;
}

/**
 * Store an OAuth CSRF state with 10-minute TTL.
 * Key: oauth:state:<state>
 */
export async function storeOAuthState(state: string, payload: OAuthStatePayload): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(`${OAUTH_STATE_PREFIX}${state}`, JSON.stringify(payload), {
    EX: OAUTH_STATE_TTL_SECONDS,
  });
}

/**
 * Consume an OAuth CSRF state — atomic check-and-delete.
 * Returns the payload if the state existed, null if invalid/expired.
 */
export async function consumeOAuthState(state: string): Promise<OAuthStatePayload | null> {
  const redis = await getRedisClient();
  const val = await redis.getDel(`${OAUTH_STATE_PREFIX}${state}`);
  if (!val) return null;
  try {
    return JSON.parse(val) as OAuthStatePayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Short-lived OAuth exchange codes (token handoff after OAuth callback)
// ---------------------------------------------------------------------------

const OAUTH_EXCHANGE_PREFIX = 'oauth:exchange:';
const OAUTH_EXCHANGE_TTL_SECONDS = 60; // 60 seconds — frontend must redeem quickly

export interface OAuthExchangePayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Store a short-lived exchange code that the frontend can redeem for a token pair.
 * Prevents tokens from appearing in redirect URLs (single-use, 60s TTL).
 */
export async function storeOAuthExchange(code: string, payload: OAuthExchangePayload): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(`${OAUTH_EXCHANGE_PREFIX}${code}`, JSON.stringify(payload), {
    EX: OAUTH_EXCHANGE_TTL_SECONDS,
  });
}

/**
 * Consume an OAuth exchange code — atomic check-and-delete.
 * Returns the token payload if the code existed, null if invalid/expired.
 */
export async function consumeOAuthExchange(code: string): Promise<OAuthExchangePayload | null> {
  const redis = await getRedisClient();
  const val = await redis.getDel(`${OAUTH_EXCHANGE_PREFIX}${code}`);
  if (!val) return null;
  try {
    return JSON.parse(val) as OAuthExchangePayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Game state snapshot cache (for spectator reconnect)
// ---------------------------------------------------------------------------

const GAME_SNAPSHOT_PREFIX = 'arena:snapshot:';
const GAME_SNAPSHOT_TTL_SECONDS = 3600; // 1 hour (covers game duration)

export interface ArenaSnapshot {
  arenaId: string;
  gameState: GameState;
  handNumber: number;
  updatedAt: number; // Unix ms
}

/**
 * Write the current game state snapshot to Redis.
 * Called after every game:action and hand:end broadcast.
 */
export async function setGameSnapshot(arenaId: string, snapshot: ArenaSnapshot): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(`${GAME_SNAPSHOT_PREFIX}${arenaId}`, JSON.stringify(snapshot), {
    EX: GAME_SNAPSHOT_TTL_SECONDS,
  });
}

/**
 * Read the current game state snapshot from Redis.
 * Returns null if arena not found or not yet started.
 */
export async function getGameSnapshot(arenaId: string): Promise<ArenaSnapshot | null> {
  const redis = await getRedisClient();
  const val = await redis.get(`${GAME_SNAPSHOT_PREFIX}${arenaId}`);
  if (!val) return null;
  try {
    return JSON.parse(val) as ArenaSnapshot;
  } catch {
    return null;
  }
}

export async function clearGameSnapshot(arenaId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(`${GAME_SNAPSHOT_PREFIX}${arenaId}`);
}

// ---------------------------------------------------------------------------
// Agent runtime snapshot + pending turn cache
// ---------------------------------------------------------------------------

const AGENT_RUNTIME_SNAPSHOT_PREFIX = 'agent:runtime:snapshot:';
const AGENT_RUNTIME_SNAPSHOT_TTL_SECONDS = 3600;
const AGENT_PENDING_TURN_PREFIX = 'agent:runtime:turn:';
const ARENA_LOOP_HEARTBEAT_PREFIX = 'arena:loop:heartbeat:';
const ARENA_LOOP_HEARTBEAT_TTL_SECONDS = 20;

export interface StoredAgentTurn extends AgentTurnRequest {
  status: 'pending' | 'submitted';
  createdAt: number;
  submittedAction?: AgentActionSubmission;
  submittedAt?: number;
}

function runtimeSnapshotKey(arenaId: string, agentId: string): string {
  return `${AGENT_RUNTIME_SNAPSHOT_PREFIX}${arenaId}:${agentId}`;
}

function pendingTurnKey(arenaId: string, agentId: string): string {
  return `${AGENT_PENDING_TURN_PREFIX}${arenaId}:${agentId}`;
}

function arenaLoopHeartbeatKey(arenaId: string): string {
  return `${ARENA_LOOP_HEARTBEAT_PREFIX}${arenaId}`;
}

export async function setAgentRuntimeSnapshot(snapshot: AgentRuntimeSnapshot): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(
    runtimeSnapshotKey(snapshot.arenaId, snapshot.agentId),
    JSON.stringify(snapshot),
    { EX: AGENT_RUNTIME_SNAPSHOT_TTL_SECONDS },
  );
}

export async function getAgentRuntimeSnapshot(
  arenaId: string,
  agentId: string,
): Promise<AgentRuntimeSnapshot | null> {
  const redis = await getRedisClient();
  const val = await redis.get(runtimeSnapshotKey(arenaId, agentId));
  if (!val) return null;
  try {
    return JSON.parse(val) as AgentRuntimeSnapshot;
  } catch {
    return null;
  }
}

export async function clearAgentRuntimeSnapshot(arenaId: string, agentId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(runtimeSnapshotKey(arenaId, agentId));
}

export async function setAgentPendingTurn(turn: AgentTurnRequest): Promise<StoredAgentTurn> {
  const redis = await getRedisClient();
  const storedTurn: StoredAgentTurn = {
    ...turn,
    status: 'pending',
    createdAt: Date.now(),
  };
  await redis.set(pendingTurnKey(turn.arenaId, turn.agentId), JSON.stringify(storedTurn));
  return storedTurn;
}

export async function getAgentPendingTurn(
  arenaId: string,
  agentId: string,
): Promise<StoredAgentTurn | null> {
  const redis = await getRedisClient();
  const val = await redis.get(pendingTurnKey(arenaId, agentId));
  if (!val) return null;
  try {
    return JSON.parse(val) as StoredAgentTurn;
  } catch {
    return null;
  }
}

export async function submitAgentPendingTurn(
  arenaId: string,
  agentId: string,
  submission: AgentActionSubmission,
): Promise<StoredAgentTurn | null> {
  const redis = await getRedisClient();
  const key = pendingTurnKey(arenaId, agentId);
  const val = await redis.get(key);
  if (!val) return null;

  let storedTurn: StoredAgentTurn;
  try {
    storedTurn = JSON.parse(val) as StoredAgentTurn;
  } catch {
    return null;
  }

  if (storedTurn.status !== 'pending' || storedTurn.turnId !== submission.turnId) {
    return storedTurn;
  }

  const nextTurn: StoredAgentTurn = {
    ...storedTurn,
    status: 'submitted',
    submittedAction: submission,
    submittedAt: Date.now(),
  };

  await redis.set(key, JSON.stringify(nextTurn));
  return nextTurn;
}

export async function clearAgentPendingTurn(arenaId: string, agentId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(pendingTurnKey(arenaId, agentId));
}

// ---------------------------------------------------------------------------
// Last processed turn ID (for agent deduplication / crash recovery)
// ---------------------------------------------------------------------------

const AGENT_LAST_PROCESSED_TURN_PREFIX = 'agent:last_turn:';
const AGENT_LAST_PROCESSED_TURN_TTL_SECONDS = 86400; // 24 hours

export async function setAgentLastProcessedTurnId(
  arenaId: string,
  agentId: string,
  turnId: string,
): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(
    `${AGENT_LAST_PROCESSED_TURN_PREFIX}${arenaId}:${agentId}`,
    turnId,
    { EX: AGENT_LAST_PROCESSED_TURN_TTL_SECONDS },
  );
}

export async function getAgentLastProcessedTurnId(
  arenaId: string,
  agentId: string,
): Promise<string | null> {
  const redis = await getRedisClient();
  return await redis.get(`${AGENT_LAST_PROCESSED_TURN_PREFIX}${arenaId}:${agentId}`);
}

export async function touchArenaLoopHeartbeat(arenaId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(arenaLoopHeartbeatKey(arenaId), String(Date.now()), {
    EX: ARENA_LOOP_HEARTBEAT_TTL_SECONDS,
  });
}

export async function getArenaLoopHeartbeat(arenaId: string): Promise<number | null> {
  const redis = await getRedisClient();
  const val = await redis.get(arenaLoopHeartbeatKey(arenaId));
  if (!val) return null;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function clearArenaLoopHeartbeat(arenaId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(arenaLoopHeartbeatKey(arenaId));
}
