import type { Request, Response, NextFunction } from 'express';
import { signAccessToken, verifyAccessToken, type JwtPayload } from '../services/jwt.js';

/**
 * AuthPayload exposed on req.user.
 * Maps fields from JwtPayload to the shape callers expect.
 */
export interface AuthPayload {
  userId: string;
  username: string;
  walletAddress?: string; // EVM address (lowercase 0x...) — present for SIWE users
  agentId?: string;       // Present for agent JWTs (auto-registered agents)
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

function toAuthPayload(p: JwtPayload): AuthPayload {
  return {
    userId: p.sub,
    username: p.username,
    ...(p.walletAddress && { walletAddress: p.walletAddress }),
    ...(p.agentId && { agentId: p.agentId }),
  };
}

/**
 * Sign a new access token.
 * Delegates to services/jwt.ts — kept for backward compatibility.
 */
export function signToken(payload: AuthPayload): string {
  return signAccessToken({
    userId: payload.userId,
    username: payload.username,
    walletAddress: payload.walletAddress,
    agentId: payload.agentId,
  });
}

/**
 * Verify an access token and return the AuthPayload.
 * Delegates to services/jwt.ts — kept for backward compatibility.
 * NOTE: does NOT check the revocation blacklist. Use verifyAccessTokenFull in services/jwt.ts
 *       if you need revocation checking.
 */
export function verifyToken(token: string): AuthPayload {
  const p = verifyAccessToken(token);
  return toAuthPayload(p);
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
