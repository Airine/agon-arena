import type { NextFunction, Request, Response } from 'express';

export interface InternalAuthContext {
  subject: string;
  email: string;
  displayName?: string;
}

declare global {
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

export function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  const subject = readHeader(req.headers['x-internal-auth-subject']);
  const email = readHeader(req.headers['x-internal-auth-email']);
  const displayName = readHeader(req.headers['x-internal-auth-display-name']);

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
