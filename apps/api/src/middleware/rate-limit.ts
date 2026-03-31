import { createHash } from 'crypto';
import type { RequestHandler } from 'express';
import { getRedisClient } from '../services/redis.js';

/**
 * IP-based rate limiter using Redis sliding window counters.
 *
 * @param windowSecs - Time window in seconds
 * @param maxRequests - Max requests per window per IP
 * @param keyPrefix - Redis key prefix (e.g. 'rl:auth:siwe')
 */
export function ipRateLimit(
  windowSecs: number,
  maxRequests: number,
  keyPrefix: string,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const redis = await getRedisClient();
      const key = `${keyPrefix}:${ip}`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSecs);
      }

      if (current > maxRequests) {
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: windowSecs,
        });
        return;
      }

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
      next();
    } catch (err) {
      // On Redis error, fail open (don't block legitimate requests)
      console.error('[RateLimit] Redis error:', err);
      next();
    }
  };
}

/**
 * User ID-based rate limiter using Redis counters.
 * Requires auth middleware to have run first (sets req.user).
 * If no userId is present, passes through (ipRateLimit handles unauthenticated).
 *
 * @param windowSecs - Time window in seconds
 * @param maxRequests - Max requests per window per userId
 * @param keyPrefix - Redis key prefix (e.g. 'rl:global:auth')
 */
export function userRateLimit(
  windowSecs: number,
  maxRequests: number,
  keyPrefix: string,
): RequestHandler {
  return async (req, res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    if (!userId) { next(); return; }
    try {
      const redis = await getRedisClient();
      const key = `${keyPrefix}:${userId}`;
      const current = await redis.incr(key);
      if (current === 1) await redis.expire(key, windowSecs);
      if (current > maxRequests) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMITED',
          retryable: true,
          retryAfterMs: windowSecs * 1000,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('[RateLimit] Redis error:', err);
      next();
    }
  };
}

/**
 * Compute a device fingerprint from request headers.
 * The fingerprint is a SHA-256 hash of stable browser signals.
 * Used to detect account farm patterns from the same device.
 */
export function computeDeviceFingerprint(req: import('express').Request): string {
  const signals = [
    req.headers['user-agent'] ?? '',
    req.headers['accept-language'] ?? '',
    req.headers['accept-encoding'] ?? '',
    req.headers['accept'] ?? '',
    req.ip ?? '',
  ].join('|');

  return createHash('sha256').update(signals).digest('hex');
}

/**
 * Device fingerprint rate limiter.
 * Limits the number of new account registrations from the same device fingerprint.
 *
 * @param windowSecs - Time window in seconds
 * @param maxAccounts - Max new accounts per window per fingerprint
 */
export function deviceFingerprintLimit(
  windowSecs: number,
  maxAccounts: number,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const fingerprint = computeDeviceFingerprint(req);
      const redis = await getRedisClient();
      const key = `fp:reg:${fingerprint}`;

      const current = await redis.get(key);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= maxAccounts) {
        res.status(429).json({
          error: 'Too many accounts created from this device',
          retryAfter: windowSecs,
        });
        return;
      }

      // Store fingerprint in request for post-registration increment
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).deviceFingerprint = fingerprint;
      next();
    } catch (err) {
      console.error('[DeviceFingerprint] Redis error:', err);
      next();
    }
  };
}

/**
 * Increment the device fingerprint account counter after a successful registration.
 * Call this AFTER the user account is successfully created.
 */
export async function incrementFingerprintAccountCount(
  fingerprint: string,
  windowSecs = 86400, // 24 hours default
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `fp:reg:${fingerprint}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSecs);
    }
  } catch (err) {
    console.error('[DeviceFingerprint] Failed to increment:', err);
  }
}
