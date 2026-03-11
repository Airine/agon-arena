import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = getJwtSecret();
const JWT_ISSUER = 'agon-arena';

function getJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret && process.env['NODE_ENV'] === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (!secret) {
    console.warn('[Auth] No JWT_SECRET set — using dev-only fallback. DO NOT use in production.');
  }
  return secret ?? 'dev-only-unsafe-secret-do-not-use-in-production';
}

export interface AuthPayload {
  userId: string;
  username: string;
  walletAddress?: string; // EVM address (lowercase 0x...) — present for SIWE users
  agentId?: string; // Present for agent JWTs (auto-registered agents)
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: (process.env['JWT_EXPIRES_IN'] ?? '7d') as jwt.SignOptions['expiresIn'],
    issuer: JWT_ISSUER,
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as AuthPayload;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
