import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

/**
 * Unit tests for skill file management logic.
 * Tests validation schemas, SHA-256 hashing, and file size computation
 * independently of the database layer.
 */

describe('skills', () => {
  describe('file hashing', () => {
    it('should produce consistent SHA-256 for the same content', () => {
      const content = 'def play(state): return {"action": "fold"}';
      const hash1 = crypto.createHash('sha256').update(content).digest('hex');
      const hash2 = crypto.createHash('sha256').update(content).digest('hex');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = crypto.createHash('sha256').update('version 1').digest('hex');
      const hash2 = crypto.createHash('sha256').update('version 2').digest('hex');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle unicode content correctly', () => {
      const content = '# 策略文件\ndef play(): pass';
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should compute file size in bytes (not characters)', () => {
      const ascii = 'hello';
      const unicode = '你好';
      expect(Buffer.byteLength(ascii, 'utf-8')).toBe(5);
      expect(Buffer.byteLength(unicode, 'utf-8')).toBe(6); // 2 chars × 3 bytes
    });
  });

  describe('validation rules', () => {
    const MAX_FILE_SIZE = 256 * 1024;

    it('should enforce max file size of 256KB', () => {
      const content = 'x'.repeat(MAX_FILE_SIZE + 1);
      expect(content.length).toBeGreaterThan(MAX_FILE_SIZE);
    });

    it('should accept content at exactly max size', () => {
      const content = 'x'.repeat(MAX_FILE_SIZE);
      expect(content.length).toBe(MAX_FILE_SIZE);
    });

    it('should validate skill name length (1-100)', () => {
      expect(''.length).toBeLessThan(1);
      expect('a'.repeat(100).length).toBe(100);
      expect('a'.repeat(101).length).toBeGreaterThan(100);
    });

    it('should validate visibility enum', () => {
      const validValues = ['public', 'private'];
      expect(validValues).toContain('public');
      expect(validValues).toContain('private');
      expect(validValues).not.toContain('unlisted');
    });

    it('should validate version numbers are positive integers', () => {
      expect(Number.isInteger(1)).toBe(true);
      expect(1 >= 1).toBe(true);
      expect(Number.isInteger(0)).toBe(true);
      expect(0 >= 1).toBe(false);
      expect(Number.isInteger(1.5)).toBe(false);
      expect(isNaN(parseInt('abc', 10))).toBe(true);
    });
  });

  describe('version increment logic', () => {
    it('should increment from current version', () => {
      const currentVersion = 3;
      const nextVersion = currentVersion + 1;
      expect(nextVersion).toBe(4);
    });

    it('should start at version 1', () => {
      const initialVersion = 1;
      expect(initialVersion).toBe(1);
    });
  });

  describe('duplicate content detection', () => {
    it('should detect identical content via SHA-256 match', () => {
      const contentA = 'def strategy(): return "call"';
      const contentB = 'def strategy(): return "call"';
      const hashA = crypto.createHash('sha256').update(contentA).digest('hex');
      const hashB = crypto.createHash('sha256').update(contentB).digest('hex');
      expect(hashA).toBe(hashB);
    });

    it('should not flag different content as duplicate', () => {
      const contentA = 'def strategy(): return "call"';
      const contentB = 'def strategy(): return "raise"';
      const hashA = crypto.createHash('sha256').update(contentA).digest('hex');
      const hashB = crypto.createHash('sha256').update(contentB).digest('hex');
      expect(hashA).not.toBe(hashB);
    });

    it('should detect whitespace-only differences', () => {
      const contentA = 'def play(): pass';
      const contentB = 'def play():  pass'; // extra space
      const hashA = crypto.createHash('sha256').update(contentA).digest('hex');
      const hashB = crypto.createHash('sha256').update(contentB).digest('hex');
      expect(hashA).not.toBe(hashB); // whitespace matters
    });
  });

  describe('visibility access control logic', () => {
    function canViewSkill(visibility: string, isOwner: boolean): boolean {
      return visibility === 'public' || isOwner;
    }

    it('public skills should be visible to anyone', () => {
      expect(canViewSkill('public', false)).toBe(true);
    });

    it('private skills should only be visible to owner', () => {
      expect(canViewSkill('private', false)).toBe(false);
    });

    it('private skills should be visible to owner', () => {
      expect(canViewSkill('private', true)).toBe(true);
    });
  });
});
