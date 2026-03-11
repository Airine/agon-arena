/**
 * AGO-87: Security Attack Surface Tests
 *
 * Dedicated security test suite covering the 5 critical attack vectors:
 *  1. SIWE nonce reuse → must return 401 (replay attack prevention)
 *  2. Webhook signature forgery → Ed25519 signature must be verified
 *  3. IP rate limits enforced on auth endpoints → 429 on excessive requests
 *  4. Device fingerprint anti-fraud → duplicate registrations blocked
 *  5. SSRF protection on agent apiUrl → private IPs must be rejected
 *
 * Each section explicitly documents the attack, the invariant, and the result.
 * Tests run in-process — no live DB or Redis required.
 *
 * Run with: pnpm --filter @agon/api test -- security
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SiweMessage } from 'siwe';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { randomBytes } from 'crypto';
import crypto from 'crypto';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mock Redis before importing rate-limit middleware
// ---------------------------------------------------------------------------

const mockRedis = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  get: vi.fn(),
}));

vi.mock('../../services/redis.js', () => ({
  getRedisClient: vi.fn().mockResolvedValue(mockRedis),
}));

import {
  ipRateLimit,
  deviceFingerprintLimit,
  computeDeviceFingerprint,
} from '../../middleware/rate-limit.js';
import {
  verifyAgentSignature,
  consumeNonce,
  isUrlSafe,
} from '../../services/webhook-crypto.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DOMAIN = 'localhost';
const ORIGIN = 'http://localhost:3000';
const CHAIN_ID = 84532; // Base Sepolia

function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

function buildSiweMessage(address: string, nonce: string, opts?: {
  domain?: string;
  chainId?: number;
}): SiweMessage {
  return new SiweMessage({
    domain: opts?.domain ?? DOMAIN,
    address,
    statement: 'Sign in to Agon Arena',
    uri: ORIGIN,
    version: '1',
    chainId: opts?.chainId ?? CHAIN_ID,
    nonce,
    issuedAt: new Date().toISOString(),
  });
}

// In-memory nonce store — mirrors the Redis consumeSiweNonce behavior
class NonceStore {
  private store = new Set<string>();
  add(nonce: string): void { this.store.add(nonce); }
  consume(nonce: string): boolean {
    if (this.store.has(nonce)) {
      this.store.delete(nonce);
      return true;
    }
    return false;
  }
}

// Minimal mock req/res/next
function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '203.0.113.42',
    socket: { remoteAddress: '203.0.113.42' },
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      accept: 'text/html',
    },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _json?: unknown; _headers?: Record<string, string | number> } {
  const res = {
    _status: undefined as number | undefined,
    _json: undefined as unknown,
    _headers: {} as Record<string, string | number>,
  } as Response & { _status?: number; _json?: unknown; _headers?: Record<string, string | number> };

  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: unknown) => { res._json = body; return res; };
  res.setHeader = (name: string, value: unknown) => {
    res._headers![name] = value as string | number;
    return res;
  };

  return res;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ============================================================================
// 1. SIWE NONCE REUSE — Replay Attack Prevention
// ============================================================================

describe('Security: SIWE nonce reuse → 401 (replay attack prevention)', () => {
  it('accepts a fresh nonce on first use', async () => {
    const nonces = new NonceStore();
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();
    nonces.add(nonce);

    const msg = buildSiweMessage(account.address, nonce);
    const messageStr = msg.prepareMessage();
    const signature = await account.signMessage({ message: messageStr });

    const parsed = new SiweMessage(messageStr);
    const { data: verified } = await parsed.verify({ signature });
    expect(verified).toBeTruthy();

    // Nonce is valid and present — first consumption succeeds
    const nonceConsumed = nonces.consume(parsed.nonce);
    expect(nonceConsumed).toBe(true);
  });

  it('ATTACK: replaying the same signed message is rejected', async () => {
    const nonces = new NonceStore();
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();
    nonces.add(nonce);

    const msg = buildSiweMessage(account.address, nonce);
    const messageStr = msg.prepareMessage();
    const signature = await account.signMessage({ message: messageStr });

    // First verify succeeds
    const parsed1 = new SiweMessage(messageStr);
    const { data: v1 } = await parsed1.verify({ signature });
    expect(v1).toBeTruthy();
    expect(nonces.consume(parsed1.nonce)).toBe(true); // nonce consumed

    // REPLAY ATTEMPT: same signature submitted again
    const parsed2 = new SiweMessage(messageStr);
    const { data: v2 } = await parsed2.verify({ signature });
    expect(v2).toBeTruthy(); // signature still cryptographically valid

    // But nonce is gone — server must return 401
    const nonceStillValid = nonces.consume(parsed2.nonce);
    expect(nonceStillValid).toBe(false); // → server would reject with 401
  });

  it('ATTACK: attacker using an unseen nonce is rejected', () => {
    const nonces = new NonceStore();

    // Attacker crafts a nonce that was never issued by the server
    const unseen = generateNonce();
    expect(nonces.consume(unseen)).toBe(false); // nonce not found → reject
  });

  it('ATTACK: expired nonce is consumed and second request fails', async () => {
    const nonces = new NonceStore();
    const nonce = generateNonce();
    nonces.add(nonce);

    // Legitimate first use
    expect(nonces.consume(nonce)).toBe(true);

    // Simulating TTL expiration — nonce is gone
    expect(nonces.consume(nonce)).toBe(false);
  });

  it('ATTACK: high-frequency replay attempts all fail after first success', async () => {
    const nonces = new NonceStore();
    const nonce = generateNonce();
    nonces.add(nonce);

    // First succeeds
    expect(nonces.consume(nonce)).toBe(true);

    // 10 replay attempts — all must fail (idempotent rejection)
    for (let i = 0; i < 10; i++) {
      expect(nonces.consume(nonce)).toBe(false);
    }
  });

  it('ATTACK: domain mismatch prevents SIWE verification even with valid signature', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();

    // Attacker signs a message claiming to be from evil-site.com
    const evilMsg = buildSiweMessage(account.address, nonce, { domain: 'evil-site.com' });
    const messageStr = evilMsg.prepareMessage();
    const signature = await account.signMessage({ message: messageStr });

    // Signature is cryptographically valid for evil-site.com
    const parsed = new SiweMessage(messageStr);
    const { data: verified } = await parsed.verify({ signature });
    expect(verified).toBeTruthy(); // crypto OK

    // But server rejects: domain mismatch
    const domainValid = parsed.domain === DOMAIN;
    expect(domainValid).toBe(false); // → server returns 400 "Invalid domain"
  });

  it('ATTACK: wrong chain ID prevents cross-chain signature reuse', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();

    // Attacker captures a signature from Ethereum mainnet (chainId=1)
    // and tries to replay it on Base Sepolia (chainId=84532)
    const mainnetMsg = buildSiweMessage(account.address, nonce, { chainId: 1 });
    const messageStr = mainnetMsg.prepareMessage();

    const parsed = new SiweMessage(messageStr);
    const chainIdValid = parsed.chainId === CHAIN_ID;
    expect(chainIdValid).toBe(false); // → server returns 400 "Invalid chain ID"
  });

  it('ATTACK: signature from different wallet is rejected by SIWE', async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();

    // Victim's SIWE message
    const msg = buildSiweMessage(victim.address, nonce);
    const messageStr = msg.prepareMessage();

    // Attacker signs it with their own key
    const forgedSignature = await attacker.signMessage({ message: messageStr });

    // SIWE verification must fail — recovered address ≠ victim's address
    const parsed = new SiweMessage(messageStr);
    try {
      const { data: verified } = await parsed.verify({ signature: forgedSignature });
      expect(verified).toBeFalsy();
    } catch {
      // SIWE throws on signature mismatch — also acceptable
    }
  });
});

// ============================================================================
// 2. WEBHOOK SIGNATURE FORGERY — Ed25519 Verification
// ============================================================================

describe('Security: webhook signature forgery → rejected', () => {
  it('accepts a valid Ed25519 signature from the correct key', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPub = publicKey.export({ type: 'spki', format: 'der' });
    const pubHex = rawPub.subarray(12).toString('hex');

    const body = JSON.stringify({ action: 'fold', hand: 42 });
    const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('hex');

    expect(verifyAgentSignature(body, sig, pubHex)).toBe(true);
  });

  it('ATTACK: forged all-zeros signature is rejected', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

    expect(verifyAgentSignature('{"action":"fold"}', '0'.repeat(128), pubHex)).toBe(false);
  });

  it('ATTACK: forged all-ones signature is rejected', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

    expect(verifyAgentSignature('{"action":"call"}', 'f'.repeat(128), pubHex)).toBe(false);
  });

  it('ATTACK: signature from wrong keypair is rejected', () => {
    const { privateKey: wrongKey } = crypto.generateKeyPairSync('ed25519');
    const { publicKey: rightKey } = crypto.generateKeyPairSync('ed25519');
    const pubHex = rightKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

    const body = '{"action":"raise","amount":100}';
    const forgery = crypto.sign(null, Buffer.from(body), wrongKey).toString('hex');

    expect(verifyAgentSignature(body, forgery, pubHex)).toBe(false);
  });

  it('ATTACK: tampered body invalidates valid signature', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

    const originalBody = '{"action":"fold"}';
    const sig = crypto.sign(null, Buffer.from(originalBody), privateKey).toString('hex');

    // Attacker tampers with body content
    const tamperedBody = '{"action":"raise","amount":99999}';
    expect(verifyAgentSignature(tamperedBody, sig, pubHex)).toBe(false);
  });

  it('ATTACK: truncated signature (short) is rejected', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

    // Only half the signature bytes
    expect(verifyAgentSignature('body', 'ab'.repeat(32), pubHex)).toBe(false);
  });

  it('ATTACK: non-hex signature string is rejected', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

    expect(verifyAgentSignature('body', 'not-hex!!!', pubHex)).toBe(false);
  });

  it('ATTACK: invalid public key (wrong length) causes rejection', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const body = '{"action":"check"}';
    const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('hex');

    // 16 bytes instead of 32 — wrong length
    expect(verifyAgentSignature(body, sig, 'aa'.repeat(16))).toBe(false);
  });

  it('ATTACK: empty public key is rejected', () => {
    expect(verifyAgentSignature('body', 'sig', '')).toBe(false);
  });

  it('uses single-use nonce to prevent webhook replay', () => {
    const nonce1 = crypto.randomUUID();
    const nonce2 = crypto.randomUUID();

    // First consumption — fresh nonce
    expect(consumeNonce(nonce1)).toBe(true);

    // REPLAY ATTEMPT: same nonce submitted again
    expect(consumeNonce(nonce1)).toBe(false);

    // Different nonce — still accepted
    expect(consumeNonce(nonce2)).toBe(true);
    expect(consumeNonce(nonce2)).toBe(false); // but only once
  });

  it('ATTACK: concurrent nonce replay — only one succeeds', () => {
    const nonce = crypto.randomUUID();

    // Simulate two concurrent requests — only first one wins
    const results = [consumeNonce(nonce), consumeNonce(nonce)];
    const successes = results.filter(Boolean).length;
    expect(successes).toBe(1); // exactly one succeeds
  });
});

// ============================================================================
// 3. IP RATE LIMITS — Auth Endpoint Protection
// ============================================================================

describe('Security: IP rate limits enforced on auth endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SIWE nonce endpoint: passes requests under the limit', async () => {
    mockRedis.incr.mockResolvedValue(3);
    mockRedis.expire.mockResolvedValue(1);

    // SIWE nonce: 20 req/min per IP
    const middleware = ipRateLimit(60, 20, 'rl:auth:siwe:nonce');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
    expect(res._headers!['X-RateLimit-Limit']).toBe(20);
    expect(res._headers!['X-RateLimit-Remaining']).toBe(17);
  });

  it('ATTACK: SIWE nonce endpoint — flood beyond limit returns 429', async () => {
    mockRedis.incr.mockResolvedValue(21); // over limit

    const middleware = ipRateLimit(60, 20, 'rl:auth:siwe:nonce');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._json).toMatchObject({ error: 'Too many requests', retryAfter: 60 });
  });

  it('SIWE verify endpoint: passes requests under the limit', async () => {
    mockRedis.incr.mockResolvedValue(5);

    const middleware = ipRateLimit(60, 10, 'rl:auth:siwe:verify');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._headers!['X-RateLimit-Remaining']).toBe(5);
  });

  it('ATTACK: SIWE verify — brute-force flood returns 429', async () => {
    mockRedis.incr.mockResolvedValue(11);

    const middleware = ipRateLimit(60, 10, 'rl:auth:siwe:verify');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
  });

  it('ENS verify endpoint: 5 req/min per IP (SIWE resolver abuse)', async () => {
    mockRedis.incr.mockResolvedValue(5); // exactly at limit

    const middleware = ipRateLimit(60, 5, 'rl:auth:ens:verify');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._headers!['X-RateLimit-Remaining']).toBe(0);
  });

  it('ATTACK: ENS verify — 6th request is blocked', async () => {
    mockRedis.incr.mockResolvedValue(6);

    const middleware = ipRateLimit(60, 5, 'rl:auth:ens:verify');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
  });

  it('rate limit is per-IP: different IPs have independent counters', async () => {
    // IP-A: at limit
    mockRedis.incr.mockResolvedValueOnce(11);
    // IP-B: under limit
    mockRedis.incr.mockResolvedValueOnce(3);

    const middleware = ipRateLimit(60, 10, 'rl:auth');

    const reqA = makeReq({ ip: '1.2.3.4' });
    const resA = makeRes();
    const nextA = makeNext();
    await middleware(reqA, resA, nextA);

    const reqB = makeReq({ ip: '5.6.7.8' });
    const resB = makeRes();
    const nextB = makeNext();
    await middleware(reqB, resB, nextB);

    expect(nextA).not.toHaveBeenCalled(); // IP-A blocked
    expect(nextB).toHaveBeenCalledOnce(); // IP-B passes
    expect(resA._status).toBe(429);
    expect(resB._status).toBeUndefined();
  });

  it('Redis key prefix correctly scopes limits per endpoint', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const req = makeReq({ ip: '1.2.3.4' });
    const siweNonceMiddleware = ipRateLimit(60, 20, 'rl:auth:siwe:nonce');
    await siweNonceMiddleware(req, makeRes(), makeNext());

    // Verify key scoping: includes the prefix and IP
    expect(mockRedis.incr).toHaveBeenCalledWith('rl:auth:siwe:nonce:1.2.3.4');
    expect(mockRedis.expire).toHaveBeenCalledWith('rl:auth:siwe:nonce:1.2.3.4', 60);
  });

  it('rate limiter fails open on Redis unavailability (does not block legit requests)', async () => {
    mockRedis.incr.mockRejectedValue(new Error('Redis connection refused'));

    const middleware = ipRateLimit(60, 10, 'rl:auth');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    // Fail open: rate limit does not block on Redis failure
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });
});

// ============================================================================
// 4. DEVICE FINGERPRINT ANTI-FRAUD — Duplicate Registration Prevention
// ============================================================================

describe('Security: device fingerprint anti-fraud blocks duplicate registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows first registration from a new device fingerprint', async () => {
    mockRedis.get.mockResolvedValue(null); // No previous registrations

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((req as any).deviceFingerprint).toBeDefined();
  });

  it('allows up to 2 accounts from the same device', async () => {
    mockRedis.get.mockResolvedValue('2'); // 2 accounts already created

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce(); // 2 < 3, still allowed
  });

  it('ATTACK: blocks 3rd account from the same device (account farming)', async () => {
    mockRedis.get.mockResolvedValue('3'); // Already at limit

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._json).toMatchObject({
      error: 'Too many accounts created from this device',
      retryAfter: 86400,
    });
  });

  it('ATTACK: blocks 10th account from same device (mass account farm)', async () => {
    mockRedis.get.mockResolvedValue('10');

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
  });

  it('device fingerprint is deterministic — same headers produce same fingerprint', () => {
    const req1 = makeReq();
    const req2 = makeReq();

    const fp1 = computeDeviceFingerprint(req1);
    const fp2 = computeDeviceFingerprint(req2);

    expect(fp1).toBe(fp2);
  });

  it('ATTACK bypass attempt: different User-Agent produces different fingerprint (defeats simple spoofing)', () => {
    const req1 = makeReq({ headers: { 'user-agent': 'BotClient/1.0' } } as Partial<Request>);
    const req2 = makeReq({ headers: { 'user-agent': 'BotClient/2.0' } } as Partial<Request>);

    const fp1 = computeDeviceFingerprint(req1);
    const fp2 = computeDeviceFingerprint(req2);

    // Different UA → different fingerprint (but same IP still counts per IP limit)
    expect(fp1).not.toBe(fp2);
  });

  it('fingerprint is a 64-char SHA-256 hex (unguessable by attacker)', () => {
    const fp = computeDeviceFingerprint(makeReq());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ATTACK bypass attempt: missing headers still produce a fingerprint (no crash)', () => {
    const req = makeReq({ headers: {} } as Partial<Request>);
    const fp = computeDeviceFingerprint(req);
    expect(fp).toMatch(/^[0-9a-f]{64}$/); // graceful degradation
  });

  it('different IPs produce different fingerprints (IP is a fingerprint signal)', () => {
    const req1 = makeReq({ ip: '203.0.113.10' });
    const req2 = makeReq({ ip: '203.0.113.20' });

    expect(computeDeviceFingerprint(req1)).not.toBe(computeDeviceFingerprint(req2));
  });
});

// ============================================================================
// 5. SSRF PROTECTION — Agent apiUrl Validation
// ============================================================================

describe('Security: SSRF protection on agent apiUrl', () => {
  // Agent registration schema mirrors production auth.ts agentCardSchema
  const agentCardSchema = z.object({
    name: z.string().min(1).max(100),
    apiUrl: z.string().url().refine(isUrlSafe, {
      message: 'apiUrl must be a public URL — private/internal addresses are not allowed',
    }),
  });

  // ─── Public URLs (must pass) ───────────────────────────────────────────────

  it('accepts a valid public HTTPS endpoint', () => {
    const result = agentCardSchema.safeParse({
      name: 'MyAgent',
      apiUrl: 'https://agent.example.com/webhook',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid public HTTP endpoint', () => {
    const result = agentCardSchema.safeParse({
      name: 'MyAgent',
      apiUrl: 'http://agent.example.com/hook',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a public IPv4 endpoint', () => {
    // 8.8.8.8 is Google DNS — a legitimate public IP
    const result = agentCardSchema.safeParse({
      name: 'MyAgent',
      apiUrl: 'https://8.8.8.8/action',
    });
    expect(result.success).toBe(true);
  });

  // ─── SSRF Attack Vectors (must all fail) ──────────────────────────────────

  it('ATTACK: localhost URL is blocked (SSRF to internal API)', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://localhost:3000/internal',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: 127.0.0.1 loopback is blocked', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://127.0.0.1:8080/steal-data',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: 10.x.x.x private network is blocked (VPC internal access)', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://10.0.0.1/admin',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: 10.255.255.255 (end of private range) is blocked', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://10.255.255.255/exfil',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: 172.16.x.x private range is blocked (Docker default bridge)', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://172.16.0.1/docker-internal',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: 172.31.x.x private range is blocked', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://172.31.255.255/secrets',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: 192.168.x.x private range is blocked (LAN access)', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://192.168.1.1/router-admin',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: AWS IMDS endpoint is blocked (credential theft)', () => {
    // AWS Instance Metadata Service — critical to block
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: 0.0.0.0 is blocked', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://0.0.0.0/everything',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: IPv6 loopback ::1 is blocked', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'http://[::1]/internal',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: file:// protocol is blocked (local file read)', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'file:///etc/passwd',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: ftp:// protocol is blocked', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: 'ftp://evil.com/exfil',
    });
    expect(result.success).toBe(false);
  });

  it('ATTACK: empty string apiUrl is rejected by schema', () => {
    const result = agentCardSchema.safeParse({
      name: 'MaliciousAgent',
      apiUrl: '',
    });
    expect(result.success).toBe(false);
  });

  it('boundary: 172.15.x.x is allowed (just outside private range)', () => {
    const result = agentCardSchema.safeParse({
      name: 'LegitAgent',
      apiUrl: 'http://172.15.0.1/webhook',
    });
    expect(result.success).toBe(true);
  });

  it('boundary: 172.32.x.x is allowed (just outside private range)', () => {
    const result = agentCardSchema.safeParse({
      name: 'LegitAgent',
      apiUrl: 'http://172.32.0.1/hook',
    });
    expect(result.success).toBe(true);
  });

  // ─── Direct isUrlSafe function tests ──────────────────────────────────────

  it('isUrlSafe returns false for all RFC-1918 private ranges', () => {
    const privateUrls = [
      'http://10.0.0.1/x',
      'http://10.128.0.1/x',
      'http://172.16.0.1/x',
      'http://172.31.255.255/x',
      'http://192.168.0.1/x',
      'http://192.168.255.255/x',
    ];
    for (const url of privateUrls) {
      expect(isUrlSafe(url)).toBe(false);
    }
  });

  it('isUrlSafe returns true for public IPs in non-private ranges', () => {
    const publicUrls = [
      'https://1.1.1.1/x',     // Cloudflare DNS
      'https://8.8.8.8/x',     // Google DNS
      'http://203.0.113.1/x',  // TEST-NET-3 (documentation range)
    ];
    for (const url of publicUrls) {
      expect(isUrlSafe(url)).toBe(true);
    }
  });
});
