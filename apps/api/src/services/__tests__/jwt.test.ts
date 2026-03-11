import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Redis — all tests run without a real Redis connection
// ---------------------------------------------------------------------------
const mockStore = new Map<string, { value: string; exp?: number }>();

vi.mock('../redis.js', () => ({
  getRedisClient: vi.fn(() => ({
    set: vi.fn(async (key: string, value: string, opts?: { EX?: number }) => {
      mockStore.set(key, { value, exp: opts?.EX });
    }),
    get: vi.fn(async (key: string) => {
      const entry = mockStore.get(key);
      return entry ? entry.value : null;
    }),
    del: vi.fn(async (key: string) => {
      const had = mockStore.has(key);
      mockStore.delete(key);
      return had ? 1 : 0;
    }),
    getDel: vi.fn(async (key: string) => {
      const entry = mockStore.get(key);
      mockStore.delete(key);
      return entry ? entry.value : null;
    }),
  })),
}));

// Import after mocking
import {
  signAccessToken,
  verifyAccessToken,
  verifyAccessTokenFull,
  issueTokenPair,
  rotateRefreshToken,
  revokeAccessToken,
  type TokenIssuanceInput,
} from '../jwt.js';

const baseInput: TokenIssuanceInput = {
  userId: 'user-uuid-1',
  username: 'testuser',
};

const walletInput: TokenIssuanceInput = {
  userId: 'user-uuid-2',
  username: 'walletuser',
  walletAddress: '0xdeadbeef',
};

const agentInput: TokenIssuanceInput = {
  userId: 'user-uuid-3',
  username: 'agentuser',
  agentId: 'agent-uuid-1',
  type: 'agent',
};

describe('signAccessToken / verifyAccessToken', () => {
  beforeEach(() => mockStore.clear());

  it('signs and verifies a basic token', () => {
    const token = signAccessToken(baseInput);
    const payload = verifyAccessToken(token);

    expect(payload.sub).toBe(baseInput.userId);
    expect(payload.username).toBe(baseInput.username);
    expect(payload.account_id).toBe(baseInput.userId);
    expect(payload.type).toBe('human');
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/); // UUID format
  });

  it('includes walletAddress when provided', () => {
    const token = signAccessToken(walletInput);
    const payload = verifyAccessToken(token);
    expect(payload.walletAddress).toBe('0xdeadbeef');
    expect(payload.type).toBe('human');
  });

  it('sets type to agent when agentId is provided', () => {
    const token = signAccessToken(agentInput);
    const payload = verifyAccessToken(token);
    expect(payload.agentId).toBe('agent-uuid-1');
    expect(payload.type).toBe('agent');
  });

  it('throws on invalid token', () => {
    expect(() => verifyAccessToken('not-a-jwt')).toThrow();
  });

  it('throws on tampered token', () => {
    const token = signAccessToken(baseInput);
    const tampered = token.slice(0, -10) + 'tampered!!';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });
});

describe('verifyAccessTokenFull (blacklist check)', () => {
  beforeEach(() => mockStore.clear());

  it('returns payload for a valid, non-revoked token', async () => {
    const token = signAccessToken(baseInput);
    const payload = await verifyAccessTokenFull(token);
    expect(payload.sub).toBe(baseInput.userId);
  });

  it('throws when token jti is blacklisted', async () => {
    const token = signAccessToken(baseInput);
    const payload = verifyAccessToken(token);

    // Manually blacklist the jti
    const redis = await (await import('../redis.js')).getRedisClient();
    await redis.set(`jwt:blacklist:${payload.jti}`, '1', { EX: 86400 });

    await expect(verifyAccessTokenFull(token)).rejects.toThrow('revoked');
  });
});

describe('issueTokenPair', () => {
  beforeEach(() => mockStore.clear());

  it('returns accessToken, refreshToken, and expiresIn', async () => {
    const pair = await issueTokenPair(baseInput);

    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.expiresIn).toBe(86400); // 24h
  });

  it('access token payload is valid', async () => {
    const pair = await issueTokenPair(baseInput);
    const payload = verifyAccessToken(pair.accessToken);
    expect(payload.sub).toBe(baseInput.userId);
  });

  it('stores refresh token in Redis', async () => {
    const pair = await issueTokenPair(baseInput);

    // The refresh token hash should be in the mock store
    const hasRefresh = [...mockStore.keys()].some((k) => k.startsWith('jwt:refresh:'));
    expect(hasRefresh).toBe(true);
    // Only one refresh token stored
    const refreshKeys = [...mockStore.keys()].filter((k) => k.startsWith('jwt:refresh:'));
    expect(refreshKeys).toHaveLength(1);

    // The stored value should contain userId
    const storedRaw = mockStore.get(refreshKeys[0]!)!.value;
    const stored = JSON.parse(storedRaw) as TokenIssuanceInput;
    expect(stored.userId).toBe(baseInput.userId);

    // The refresh token itself should not appear as a key (we hash it)
    expect(mockStore.has(`jwt:refresh:${pair.refreshToken}`)).toBe(false);
  });
});

describe('rotateRefreshToken', () => {
  beforeEach(() => mockStore.clear());

  it('issues new token pair on valid refresh token', async () => {
    const original = await issueTokenPair(baseInput);
    const rotated = await rotateRefreshToken(original.refreshToken);

    expect(rotated).not.toBeNull();
    expect(rotated!.accessToken).toBeTruthy();
    expect(rotated!.refreshToken).toBeTruthy();
    // New refresh token is different (rotated)
    expect(rotated!.refreshToken).not.toBe(original.refreshToken);
  });

  it('returns null for unknown refresh token', async () => {
    const result = await rotateRefreshToken('unknown-token');
    expect(result).toBeNull();
  });

  it('old refresh token cannot be reused after rotation', async () => {
    const original = await issueTokenPair(baseInput);
    await rotateRefreshToken(original.refreshToken);

    // Second rotation with same old token should fail
    const second = await rotateRefreshToken(original.refreshToken);
    expect(second).toBeNull();
  });
});

describe('revokeAccessToken', () => {
  beforeEach(() => mockStore.clear());

  it('blacklists the jti of a valid token', async () => {
    const token = signAccessToken(baseInput);
    const payload = verifyAccessToken(token);

    await revokeAccessToken(token);

    const blacklisted = mockStore.has(`jwt:blacklist:${payload.jti}`);
    expect(blacklisted).toBe(true);
  });

  it('revoked token fails verifyAccessTokenFull', async () => {
    const token = signAccessToken(baseInput);
    await revokeAccessToken(token);
    await expect(verifyAccessTokenFull(token)).rejects.toThrow('revoked');
  });

  it('does not throw on already-expired token', async () => {
    // Can't easily create an expired token in a unit test, but we can verify
    // that revokeAccessToken handles bad tokens gracefully
    await expect(revokeAccessToken('totally-invalid')).resolves.not.toThrow();
  });
});
