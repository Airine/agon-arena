import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mock getRedisClient before importing the module under test.
// vi.mock is hoisted, so mockRedis must be defined with vi.hoisted.
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
  incrementFingerprintAccountCount,
} from '../rate-limit.js';

// ---------------------------------------------------------------------------
// Helpers to build minimal mock req/res/next objects
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '1.2.3.4',
    socket: { remoteAddress: '1.2.3.4' },
    headers: {
      'user-agent': 'Mozilla/5.0',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      accept: 'text/html',
    },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _json?: unknown; _headers?: Record<string, unknown> } {
  const res: Response & { _status?: number; _json?: unknown; _headers?: Record<string, unknown> } = {
    _status: undefined,
    _json: undefined,
    _headers: {},
  } as unknown as Response & { _status?: number; _json?: unknown; _headers?: Record<string, unknown> };

  res.status = (code: number) => {
    res._status = code;
    return res;
  };
  res.json = (body: unknown) => {
    res._json = body;
    return res;
  };
  res.setHeader = (name: string, value: unknown) => {
    res._headers![name] = value;
    return res;
  };

  return res;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ---------------------------------------------------------------------------
// ipRateLimit tests
// ---------------------------------------------------------------------------

describe('ipRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through when under the limit', async () => {
    mockRedis.incr.mockResolvedValue(3);
    mockRedis.expire.mockResolvedValue(1);

    const middleware = ipRateLimit(60, 10, 'rl:test');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
    expect(res._headers!['X-RateLimit-Limit']).toBe(10);
    expect(res._headers!['X-RateLimit-Remaining']).toBe(7);
  });

  it('passes through when exactly at the limit', async () => {
    mockRedis.incr.mockResolvedValue(10);

    const middleware = ipRateLimit(60, 10, 'rl:test');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
    expect(res._headers!['X-RateLimit-Remaining']).toBe(0);
  });

  it('returns 429 when over the limit', async () => {
    mockRedis.incr.mockResolvedValue(11);

    const middleware = ipRateLimit(60, 10, 'rl:test');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._json).toMatchObject({ error: 'Too many requests', retryAfter: 60 });
  });

  it('sets expire only on first request (incr returns 1)', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const middleware = ipRateLimit(60, 10, 'rl:test');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(mockRedis.expire).toHaveBeenCalledWith('rl:test:1.2.3.4', 60);
  });

  it('does not call expire when counter > 1', async () => {
    mockRedis.incr.mockResolvedValue(5);

    const middleware = ipRateLimit(60, 10, 'rl:test');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it('fails open on Redis error (calls next without blocking)', async () => {
    mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

    const middleware = ipRateLimit(60, 10, 'rl:test');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });

  it('uses fallback IP when req.ip is undefined', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const middleware = ipRateLimit(60, 10, 'rl:test');
    const req = makeReq({ ip: undefined, socket: { remoteAddress: '9.9.9.9' } } as Partial<Request>);
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(mockRedis.incr).toHaveBeenCalledWith('rl:test:9.9.9.9');
  });
});

// ---------------------------------------------------------------------------
// deviceFingerprintLimit tests
// ---------------------------------------------------------------------------

describe('deviceFingerprintLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through when under the limit and sets req.deviceFingerprint', async () => {
    mockRedis.get.mockResolvedValue('1');

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((req as any).deviceFingerprint).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (req as any).deviceFingerprint).toBe('string');
  });

  it('passes through when count is null (no prior registrations)', async () => {
    mockRedis.get.mockResolvedValue(null);

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 429 when count equals maxAccounts', async () => {
    mockRedis.get.mockResolvedValue('3');

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

  it('returns 429 when count exceeds maxAccounts', async () => {
    mockRedis.get.mockResolvedValue('5');

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
  });

  it('fails open on Redis error', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis down'));

    const middleware = deviceFingerprintLimit(86400, 3);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeDeviceFingerprint tests
// ---------------------------------------------------------------------------

describe('computeDeviceFingerprint', () => {
  it('is deterministic — same inputs produce the same hash', () => {
    const req1 = makeReq();
    const req2 = makeReq();

    expect(computeDeviceFingerprint(req1)).toBe(computeDeviceFingerprint(req2));
  });

  it('produces a 64-char hex string (SHA-256)', () => {
    const fingerprint = computeDeviceFingerprint(makeReq());
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different User-Agent strings', () => {
    const req1 = makeReq({ headers: { 'user-agent': 'Chrome/100' } } as Partial<Request>);
    const req2 = makeReq({ headers: { 'user-agent': 'Firefox/99' } } as Partial<Request>);

    expect(computeDeviceFingerprint(req1)).not.toBe(computeDeviceFingerprint(req2));
  });

  it('produces different hashes for different IPs', () => {
    const req1 = makeReq({ ip: '1.1.1.1' });
    const req2 = makeReq({ ip: '2.2.2.2' });

    expect(computeDeviceFingerprint(req1)).not.toBe(computeDeviceFingerprint(req2));
  });

  it('handles missing optional headers gracefully', () => {
    const req = makeReq({ headers: {} } as Partial<Request>);
    // Should not throw
    const fingerprint = computeDeviceFingerprint(req);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// incrementFingerprintAccountCount tests
// ---------------------------------------------------------------------------

describe('incrementFingerprintAccountCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments the Redis counter for the given fingerprint', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    await incrementFingerprintAccountCount('abc123');

    expect(mockRedis.incr).toHaveBeenCalledWith('fp:reg:abc123');
  });

  it('sets expire with default 24h window on first increment', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    await incrementFingerprintAccountCount('abc123');

    expect(mockRedis.expire).toHaveBeenCalledWith('fp:reg:abc123', 86400);
  });

  it('uses a custom windowSecs when provided', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    await incrementFingerprintAccountCount('abc123', 3600);

    expect(mockRedis.expire).toHaveBeenCalledWith('fp:reg:abc123', 3600);
  });

  it('does not set expire when counter > 1 (TTL already set)', async () => {
    mockRedis.incr.mockResolvedValue(2);

    await incrementFingerprintAccountCount('abc123');

    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it('swallows Redis errors without throwing', async () => {
    mockRedis.incr.mockRejectedValue(new Error('Redis unavailable'));

    // Should not throw
    await expect(incrementFingerprintAccountCount('abc123')).resolves.toBeUndefined();
  });
});
