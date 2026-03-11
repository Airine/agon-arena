import { createClient, type RedisClientType } from 'redis';

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
