/**
 * AGO-24: VRF Commit-Reveal scheme for verifiable card dealing.
 *
 * Protocol:
 *   1. Before dealing: server generates seed, computes commit = SHA-256(seed)
 *      and signs the commit with platform Ed25519 key.
 *   2. Commit + signature broadcast to all players (can't change cards now).
 *   3. Dealing: deck shuffled deterministically from seed using SHA-256 PRNG.
 *   4. After hand: seed revealed. Anyone can verify commit = SHA-256(seed).
 *
 * Seeded PRNG: for each Fisher-Yates swap at index i,
 *   random_bytes = SHA-256(seed_bytes || LE_uint32(i))
 *   j = readUInt32BE(random_bytes[0:4]) % (i + 1)
 */
import crypto from 'crypto';
import { signData, getPlatformPublicKeyHex } from './webhook-crypto.js';
import type { Card } from '@agon/types';

export interface VRFCommitment {
  commit: string;    // SHA-256(seed) — hex, 64 chars — published before dealing
  signature: string; // Ed25519(platform_privkey, commit_bytes) — hex, 128 chars
  publicKey: string; // Platform Ed25519 public key — for external verification
}

export interface VRFReveal {
  seed: string;   // 32-byte random seed — hex, 64 chars — revealed after hand
  commit: string; // Must equal SHA-256(seed)
}

/**
 * Generate a fresh VRF commitment for one hand.
 * Returns the private seed (keep secret until reveal) and the public commitment.
 */
export function generateCommit(): VRFReveal & VRFCommitment {
  const seedBytes = crypto.randomBytes(32);
  const seed = seedBytes.toString('hex');
  const commitBytes = crypto.createHash('sha256').update(seedBytes).digest();
  const commit = commitBytes.toString('hex');
  const signature = signData(commitBytes);
  const publicKey = getPlatformPublicKeyHex();
  return { seed, commit, signature, publicKey };
}

/**
 * Verify that a revealed seed matches its prior commitment.
 * Returns true if SHA-256(seed) === commit.
 */
export function verifyVRFCommit(seed: string, commit: string): boolean {
  try {
    const seedBytes = Buffer.from(seed, 'hex');
    if (seedBytes.length !== 32) return false;
    const expected = crypto.createHash('sha256').update(seedBytes).digest('hex');
    return expected === commit;
  } catch {
    return false;
  }
}

/**
 * Deterministic Fisher-Yates shuffle using a VRF seed.
 * For each swap index i, derives a random j in [0, i+1) via:
 *   hash = SHA-256(seed_bytes || LE_uint32(i))
 *   j = readUInt32BE(hash[0:4]) % (i + 1)
 * Pure function — does not mutate the input array.
 */
export function seededShuffle<T>(items: T[], seedHex: string): T[] {
  const result = [...items];
  const seedBytes = Buffer.from(seedHex, 'hex');
  const counterBuf = Buffer.allocUnsafe(4);

  for (let i = result.length - 1; i > 0; i--) {
    counterBuf.writeUInt32LE(i, 0);
    const hashBytes = crypto.createHash('sha256')
      .update(seedBytes)
      .update(counterBuf)
      .digest();
    const rand = hashBytes.readUInt32BE(0);
    const j = rand % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }

  return result;
}
