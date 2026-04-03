import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { requireInternalAuth } from '../internal-auth.js';

function makeReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    status(code: number) {
      this._status = code;
      return this;
    },
    json(payload: unknown) {
      this._json = payload;
      return this;
    },
  } as Response & { _status?: number; _json?: unknown };

  return res;
}

describe('requireInternalAuth', () => {
  beforeEach(() => {
    delete process.env['INTERNAL_AUTH_SHARED_SECRET'];
  });

  it('rejects when required internal identity headers are missing', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireInternalAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ error: 'Missing or invalid internal auth headers' });
  });

  it('rejects when the shared secret is configured but missing from the request', () => {
    process.env['INTERNAL_AUTH_SHARED_SECRET'] = 'phase-1-secret';
    const req = makeReq({
      'x-internal-auth-subject': 'staff-123',
      'x-internal-auth-email': 'staff@example.com',
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireInternalAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ error: 'Invalid internal auth bridge secret' });
  });

  it('attaches the internal auth context when the request is valid', () => {
    process.env['INTERNAL_AUTH_SHARED_SECRET'] = 'phase-1-secret';
    const req = makeReq({
      'x-internal-auth-subject': 'staff-123',
      'x-internal-auth-email': 'staff@example.com',
      'x-internal-auth-display-name': 'Staff Example',
      'x-internal-auth-secret': 'phase-1-secret',
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireInternalAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.internalUser).toEqual({
      subject: 'staff-123',
      email: 'staff@example.com',
      displayName: 'Staff Example',
    });
  });

  it('accepts the web/session header aliases used by the Next.js middleware bridge', () => {
    process.env['INTERNAL_AUTH_SHARED_SECRET'] = 'phase-1-secret';
    const req = makeReq({
      'x-internal-subject': 'staff-123',
      'x-internal-email': 'staff@example.com',
      'x-internal-display-name': 'Staff Example',
      'x-internal-auth-secret': 'phase-1-secret',
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireInternalAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.internalUser).toEqual({
      subject: 'staff-123',
      email: 'staff@example.com',
      displayName: 'Staff Example',
    });
  });
});
