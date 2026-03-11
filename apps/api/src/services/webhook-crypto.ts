import crypto from 'crypto';

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TIMESTAMP_TOLERANCE_SEC = 300; // 5 minutes

// In-memory nonce store with TTL (use Redis in production for multi-instance)
const usedNonces = new Map<string, number>(); // nonce → expiry timestamp

// Clean expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiry] of usedNonces) {
    if (now > expiry) usedNonces.delete(nonce);
  }
}, 60_000);

// Platform Ed25519 keypair (loaded from env or generated on startup)
let platformPrivateKey: crypto.KeyObject;
let platformPublicKey: crypto.KeyObject;
let platformPublicKeyHex: string;

function initPlatformKeys(): void {
  const envPrivateKey = process.env['AGON_ED25519_PRIVATE_KEY'];

  if (envPrivateKey) {
    // Load from hex-encoded seed (32 bytes → 64 hex chars)
    const seed = Buffer.from(envPrivateKey, 'hex');
    platformPrivateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        // Ed25519 PKCS8 prefix for 32-byte seed
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        seed,
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    platformPublicKey = crypto.createPublicKey(platformPrivateKey);
  } else {
    // Generate ephemeral keypair (fine for dev, not production)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    platformPrivateKey = privateKey;
    platformPublicKey = publicKey;
    console.warn('[WebhookCrypto] No AGON_ED25519_PRIVATE_KEY set, using ephemeral keypair');
  }

  // Export public key as raw hex (32 bytes → 64 hex chars)
  const rawPub = platformPublicKey.export({ type: 'spki', format: 'der' });
  // Ed25519 SPKI DER is 44 bytes: 12-byte prefix + 32-byte key
  platformPublicKeyHex = rawPub.subarray(12).toString('hex');
}

// Initialize on module load
initPlatformKeys();

/**
 * Get the platform's Ed25519 public key as hex string.
 */
export function getPlatformPublicKeyHex(): string {
  return platformPublicKeyHex;
}

/**
 * Sign a webhook payload for sending to an agent.
 * Returns the signature headers to include in the request.
 */
export function signWebhookPayload(body: string): {
  signature: string;
  timestamp: string;
  nonce: string;
} {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();

  // Sign: timestamp.nonce.body
  const message = Buffer.from(`${timestamp}.${nonce}.${body}`);
  const signature = crypto.sign(null, message, platformPrivateKey).toString('hex');

  return { signature, timestamp, nonce };
}

/**
 * Verify an agent's Ed25519 response signature.
 * @param body - The raw response body string
 * @param signature - The hex-encoded Ed25519 signature from x-agent-signature header
 * @param agentPublicKeyHex - The agent's registered Ed25519 public key (hex)
 * @returns true if signature is valid
 */
export function verifyAgentSignature(
  body: string,
  signature: string,
  agentPublicKeyHex: string,
): boolean {
  try {
    // Reconstruct the public key from raw hex
    const rawKeyBytes = Buffer.from(agentPublicKeyHex, 'hex');
    if (rawKeyBytes.length !== 32) return false;

    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        // Ed25519 SPKI prefix
        Buffer.from('302a300506032b6570032100', 'hex'),
        rawKeyBytes,
      ]),
      format: 'der',
      type: 'spki',
    });

    const signatureBytes = Buffer.from(signature, 'hex');
    const message = Buffer.from(body);

    return crypto.verify(null, message, publicKey, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * Validate that a nonce has not been used before (replay prevention).
 * Returns true if the nonce is fresh, false if it's a replay.
 */
export function consumeNonce(nonce: string): boolean {
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return true;
}

/**
 * Check that a timestamp is within the acceptable tolerance window.
 */
export function isTimestampValid(timestampStr: string): boolean {
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestamp) <= TIMESTAMP_TOLERANCE_SEC;
}

/**
 * Validate an Ed25519 public key hex string.
 * Must be exactly 64 hex characters (32 bytes).
 */
export function isValidEd25519PublicKey(hexKey: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) return false;

  try {
    // Verify we can construct a valid public key from it
    const rawKeyBytes = Buffer.from(hexKey, 'hex');
    crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        rawKeyBytes,
      ]),
      format: 'der',
      type: 'spki',
    });
    return true;
  } catch {
    return false;
  }
}
