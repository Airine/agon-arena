import type { NextFunction, Request, Response } from 'express';

export interface InternalAuthContext {
  subject: string;
  email: string;
  displayName?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      internalUser?: InternalAuthContext;
    }
  }
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readHeaderAlias(
  headers: Request['headers'],
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = readHeader(headers[name.toLowerCase()]);
    if (value) return value;
  }

  return undefined;
}

export function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  const subject = readHeaderAlias(req.headers, [
    'x-internal-auth-subject',
    'x-internal-subject',
  ]);
  const email = readHeaderAlias(req.headers, [
    'x-internal-auth-email',
    'x-internal-email',
  ]);
  const displayName = readHeaderAlias(req.headers, [
    'x-internal-auth-display-name',
    'x-internal-display-name',
  ]);

  if (!subject || !email) {
    if (process.env['INTERNAL_AUTH_DEV_BYPASS'] === '1') {
      req.internalUser = {
        subject: process.env['INTERNAL_DEV_SUBJECT'] ?? 'dev-internal-user',
        email: process.env['INTERNAL_DEV_EMAIL'] ?? 'dev@example.com',
        ...(process.env['INTERNAL_DEV_NAME']
          ? { displayName: process.env['INTERNAL_DEV_NAME'] }
          : {}),
      };
      next();
      return;
    }
  }

  if (!subject || !email) {
    res.status(401).json({ error: 'Missing or invalid internal auth headers' });
    return;
  }

  const configuredSecret = process.env['INTERNAL_AUTH_SHARED_SECRET'];
  if (configuredSecret) {
    const requestSecret = readHeader(req.headers['x-internal-auth-secret']);
    if (requestSecret !== configuredSecret) {
      res.status(401).json({ error: 'Invalid internal auth bridge secret' });
      return;
    }
  }

  req.internalUser = {
    subject,
    email,
    ...(displayName ? { displayName } : {}),
  };

  next();
}
