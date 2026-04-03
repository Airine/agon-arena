import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mockStore = new Map<string, { value: string; exp?: number }>();

vi.mock('../../services/redis.js', () => ({
  getRedisClient: vi.fn(() => ({
    set: vi.fn(async (key: string, value: string, opts?: { EX?: number }) => {
      mockStore.set(key, { value, exp: opts?.EX });
    }),
    get: vi.fn(async (key: string) => {
      const entry = mockStore.get(key);
      return entry ? entry.value : null;
    }),
    getDel: vi.fn(async (key: string) => {
      const entry = mockStore.get(key);
      mockStore.delete(key);
      return entry ? entry.value : null;
    }),
  })),
}));

import { requireAuth } from '../auth.js';
import { revokeAccessToken, signAccessToken } from '../../services/jwt.js';

function makeReq(token?: string): Request {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as Request;
}

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
  } as Response & { statusCode?: number; body?: unknown };

  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };

  return res;
}

describe('requireAuth', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('accepts a valid bearer token', async () => {
    const token = signAccessToken({ userId: 'user-1', username: 'test-user' });
    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        username: 'test-user',
      }),
    );
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects a revoked bearer token', async () => {
    const token = signAccessToken({ userId: 'user-2', username: 'revoked-user' });
    await revokeAccessToken(token);

    const req = makeReq(token);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
  });
});
