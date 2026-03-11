import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { generateCommit, verifyVRFCommit, seededShuffle } from '../vrf.js';
import { createDeck } from '../../game/deck.js';

describe('vrf', () => {
  describe('generateCommit', () => {
    it('should return seed as 64-char hex string', () => {
      const result = generateCommit();
      expect(result.seed).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return commit as 64-char hex string', () => {
      const result = generateCommit();
      expect(result.commit).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return signature as 128-char hex string', () => {
      const result = generateCommit();
      expect(result.signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it('should return publicKey as 64-char hex string', () => {
      const result = generateCommit();
      expect(result.publicKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return a commit equal to SHA-256(seed)', () => {
      const result = generateCommit();
      const seedBytes = Buffer.from(result.seed, 'hex');
      const expected = crypto.createHash('sha256').update(seedBytes).digest('hex');
      expect(result.commit).toBe(expected);
    });

    it('should produce different seeds on each call', () => {
      const a = generateCommit();
      const b = generateCommit();
      expect(a.seed).not.toBe(b.seed);
    });

    it('should produce different commits on each call', () => {
      const a = generateCommit();
      const b = generateCommit();
      expect(a.commit).not.toBe(b.commit);
    });
  });

  describe('verifyVRFCommit', () => {
    it('should return true for a valid seed/commit pair', () => {
      const { seed, commit } = generateCommit();
      expect(verifyVRFCommit(seed, commit)).toBe(true);
    });

    it('should return false for a tampered seed', () => {
      const { commit } = generateCommit();
      const tamperedSeed = crypto.randomBytes(32).toString('hex');
      expect(verifyVRFCommit(tamperedSeed, commit)).toBe(false);
    });

    it('should return false for a wrong commit', () => {
      const { seed } = generateCommit();
      const wrongCommit = crypto.randomBytes(32).toString('hex');
      expect(verifyVRFCommit(seed, wrongCommit)).toBe(false);
    });

    it('should return false if seed has wrong length', () => {
      const { commit } = generateCommit();
      const shortSeed = crypto.randomBytes(16).toString('hex'); // 16 bytes = 32 hex chars, not 64
      expect(verifyVRFCommit(shortSeed, commit)).toBe(false);
    });

    it('should return false for non-hex input', () => {
      expect(verifyVRFCommit('not-hex!', 'deadbeef'.repeat(8))).toBe(false);
    });

    it('should return false for empty strings', () => {
      expect(verifyVRFCommit('', '')).toBe(false);
    });
  });

  describe('seededShuffle', () => {
    it('should be deterministic — same seed produces same order', () => {
      const seed = crypto.randomBytes(32).toString('hex');
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const a = seededShuffle(items, seed);
      const b = seededShuffle(items, seed);
      expect(a).toEqual(b);
    });

    it('should be a permutation — all elements present, no duplicates', () => {
      const seed = crypto.randomBytes(32).toString('hex');
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = seededShuffle(items, seed);
      expect(result).toHaveLength(items.length);
      expect(new Set(result).size).toBe(items.length);
      for (const item of items) {
        expect(result).toContain(item);
      }
    });

    it('should not mutate the input array', () => {
      const seed = crypto.randomBytes(32).toString('hex');
      const items = [1, 2, 3, 4, 5];
      const original = [...items];
      seededShuffle(items, seed);
      expect(items).toEqual(original);
    });

    it('should produce different orders for different seeds (probabilistic)', () => {
      const seedA = crypto.randomBytes(32).toString('hex');
      const seedB = crypto.randomBytes(32).toString('hex');
      const items = Array.from({ length: 52 }, (_, i) => i);
      const a = seededShuffle(items, seedA);
      const b = seededShuffle(items, seedB);
      // With 52 items the probability of two random permutations being equal is 1/52! ≈ 0
      expect(a).not.toEqual(b);
    });

    it('should handle a 52-card deck', () => {
      const seed = crypto.randomBytes(32).toString('hex');
      const deck = createDeck();
      const shuffled = seededShuffle(deck, seed);
      expect(shuffled).toHaveLength(52);
      // All original cards present
      for (const card of deck) {
        expect(shuffled.some((c) => c.suit === card.suit && c.rank === card.rank)).toBe(true);
      }
    });

    it('should produce the same shuffle for a 52-card deck given the same seed', () => {
      const seed = crypto.randomBytes(32).toString('hex');
      const deck = createDeck();
      const a = seededShuffle(deck, seed);
      const b = seededShuffle(deck, seed);
      expect(a.map((c) => `${c.rank}${c.suit}`)).toEqual(b.map((c) => `${c.rank}${c.suit}`));
    });

    it('should handle an empty array', () => {
      const seed = crypto.randomBytes(32).toString('hex');
      expect(seededShuffle([], seed)).toEqual([]);
    });

    it('should handle a single-element array', () => {
      const seed = crypto.randomBytes(32).toString('hex');
      expect(seededShuffle([42], seed)).toEqual([42]);
    });
  });
});
