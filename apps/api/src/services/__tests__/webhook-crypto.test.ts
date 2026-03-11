import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  getPlatformPublicKeyHex,
  signWebhookPayload,
  verifyAgentSignature,
  consumeNonce,
  isTimestampValid,
  isValidEd25519PublicKey,
  isUrlSafe,
} from '../webhook-crypto.js';

describe('webhook-crypto', () => {
  describe('getPlatformPublicKeyHex', () => {
    it('should return a 64-character hex string', () => {
      const key = getPlatformPublicKeyHex();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return the same key on repeated calls', () => {
      expect(getPlatformPublicKeyHex()).toBe(getPlatformPublicKeyHex());
    });
  });

  describe('signWebhookPayload', () => {
    it('should return signature, timestamp, and nonce', () => {
      const result = signWebhookPayload('{"test": true}');
      expect(result.signature).toMatch(/^[0-9a-f]+$/);
      expect(result.signature).toHaveLength(128); // Ed25519 signature is 64 bytes = 128 hex
      expect(Number(result.timestamp)).toBeGreaterThan(0);
      expect(result.nonce).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it('should produce different nonces for each call', () => {
      const a = signWebhookPayload('body');
      const b = signWebhookPayload('body');
      expect(a.nonce).not.toBe(b.nonce);
    });

    it('should produce different signatures for different bodies', () => {
      const a = signWebhookPayload('body1');
      const b = signWebhookPayload('body2');
      expect(a.signature).not.toBe(b.signature);
    });
  });

  describe('verifyAgentSignature', () => {
    it('should verify a valid Ed25519 signature', () => {
      // Generate a test keypair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

      // Extract raw public key hex
      const rawPub = publicKey.export({ type: 'spki', format: 'der' });
      const pubHex = rawPub.subarray(12).toString('hex');

      // Sign a message
      const body = '{"action":"fold"}';
      const signature = crypto.sign(null, Buffer.from(body), privateKey).toString('hex');

      expect(verifyAgentSignature(body, signature, pubHex)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const { publicKey } = crypto.generateKeyPairSync('ed25519');
      const rawPub = publicKey.export({ type: 'spki', format: 'der' });
      const pubHex = rawPub.subarray(12).toString('hex');

      const body = '{"action":"fold"}';
      const badSignature = 'a'.repeat(128);

      expect(verifyAgentSignature(body, badSignature, pubHex)).toBe(false);
    });

    it('should reject signature with wrong public key', () => {
      const { privateKey } = crypto.generateKeyPairSync('ed25519');
      const { publicKey: wrongKey } = crypto.generateKeyPairSync('ed25519');
      const wrongPubHex = wrongKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

      const body = '{"action":"call"}';
      const signature = crypto.sign(null, Buffer.from(body), privateKey).toString('hex');

      expect(verifyAgentSignature(body, signature, wrongPubHex)).toBe(false);
    });

    it('should reject if public key is invalid', () => {
      expect(verifyAgentSignature('body', 'sig', 'not-hex')).toBe(false);
      expect(verifyAgentSignature('body', 'sig', 'aa'.repeat(16))).toBe(false); // Wrong length
    });
  });

  describe('consumeNonce', () => {
    it('should accept a fresh nonce', () => {
      const nonce = crypto.randomUUID();
      expect(consumeNonce(nonce)).toBe(true);
    });

    it('should reject a replayed nonce', () => {
      const nonce = crypto.randomUUID();
      consumeNonce(nonce);
      expect(consumeNonce(nonce)).toBe(false);
    });

    it('should accept different nonces', () => {
      expect(consumeNonce(crypto.randomUUID())).toBe(true);
      expect(consumeNonce(crypto.randomUUID())).toBe(true);
    });
  });

  describe('isTimestampValid', () => {
    it('should accept current timestamp', () => {
      const now = Math.floor(Date.now() / 1000).toString();
      expect(isTimestampValid(now)).toBe(true);
    });

    it('should accept timestamp within tolerance (4 minutes ago)', () => {
      const fourMinAgo = (Math.floor(Date.now() / 1000) - 240).toString();
      expect(isTimestampValid(fourMinAgo)).toBe(true);
    });

    it('should reject timestamp beyond tolerance (10 minutes ago)', () => {
      const tenMinAgo = (Math.floor(Date.now() / 1000) - 600).toString();
      expect(isTimestampValid(tenMinAgo)).toBe(false);
    });

    it('should reject non-numeric timestamp', () => {
      expect(isTimestampValid('not-a-number')).toBe(false);
    });
  });

  describe('isValidEd25519PublicKey', () => {
    it('should accept a valid Ed25519 public key hex', () => {
      const { publicKey } = crypto.generateKeyPairSync('ed25519');
      const rawPub = publicKey.export({ type: 'spki', format: 'der' });
      const pubHex = rawPub.subarray(12).toString('hex');
      expect(isValidEd25519PublicKey(pubHex)).toBe(true);
    });

    it('should reject non-hex string', () => {
      expect(isValidEd25519PublicKey('xyz'.repeat(22))).toBe(false);
    });

    it('should reject wrong length', () => {
      expect(isValidEd25519PublicKey('aa'.repeat(16))).toBe(false);
      expect(isValidEd25519PublicKey('aa'.repeat(33))).toBe(false);
    });

    it('should accept uppercase hex', () => {
      const { publicKey } = crypto.generateKeyPairSync('ed25519');
      const rawPub = publicKey.export({ type: 'spki', format: 'der' });
      const pubHex = rawPub.subarray(12).toString('hex').toUpperCase();
      expect(isValidEd25519PublicKey(pubHex)).toBe(true);
    });
  });

  describe('isUrlSafe', () => {
    it('should accept public HTTPS URLs', () => {
      expect(isUrlSafe('https://agent.example.com/webhook')).toBe(true);
      expect(isUrlSafe('https://8.8.8.8/action')).toBe(true);
    });

    it('should accept public HTTP URLs', () => {
      expect(isUrlSafe('http://agent.example.com/webhook')).toBe(true);
    });

    it('should block localhost', () => {
      expect(isUrlSafe('http://localhost/action')).toBe(false);
      expect(isUrlSafe('http://localhost:3000/action')).toBe(false);
      expect(isUrlSafe('http://127.0.0.1/action')).toBe(false);
      expect(isUrlSafe('http://127.0.0.1:8080/action')).toBe(false);
    });

    it('should block private IP ranges (10.x.x.x)', () => {
      expect(isUrlSafe('http://10.0.0.1/action')).toBe(false);
      expect(isUrlSafe('http://10.255.255.255/action')).toBe(false);
    });

    it('should block private IP ranges (172.16-31.x.x)', () => {
      expect(isUrlSafe('http://172.16.0.1/action')).toBe(false);
      expect(isUrlSafe('http://172.31.255.255/action')).toBe(false);
    });

    it('should allow non-private 172.x ranges', () => {
      expect(isUrlSafe('http://172.15.0.1/action')).toBe(true);
      expect(isUrlSafe('http://172.32.0.1/action')).toBe(true);
    });

    it('should block private IP ranges (192.168.x.x)', () => {
      expect(isUrlSafe('http://192.168.0.1/action')).toBe(false);
      expect(isUrlSafe('http://192.168.1.1/action')).toBe(false);
    });

    it('should block link-local / AWS metadata (169.254.x.x)', () => {
      expect(isUrlSafe('http://169.254.169.254/latest/meta-data')).toBe(false);
    });

    it('should block 0.0.0.0', () => {
      expect(isUrlSafe('http://0.0.0.0/action')).toBe(false);
    });

    it('should block IPv6', () => {
      expect(isUrlSafe('http://[::1]/action')).toBe(false);
    });

    it('should block non-http protocols', () => {
      expect(isUrlSafe('ftp://example.com/file')).toBe(false);
      expect(isUrlSafe('file:///etc/passwd')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isUrlSafe('not-a-url')).toBe(false);
      expect(isUrlSafe('')).toBe(false);
    });
  });
});
