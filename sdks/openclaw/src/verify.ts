/** Ed25519 webhook signature verification for Agon Arena. */

import * as ed from '@noble/ed25519';

/**
 * Verify an incoming webhook from the Agon platform.
 *
 * @param body - Raw request body string.
 * @param signatureHex - X-Agon-Signature header value.
 * @param timestamp - X-Agon-Timestamp header value (unix seconds).
 * @param nonce - X-Agon-Nonce header value.
 * @param platformPublicKeyHex - Platform's Ed25519 public key (hex).
 * @param maxAgeSeconds - Maximum timestamp age. Default: 300 (5 min).
 */
export async function verifyWebhook(
  body: string,
  signatureHex: string,
  timestamp: string,
  nonce: string,
  platformPublicKeyHex: string,
  maxAgeSeconds = 300,
): Promise<void> {
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxAgeSeconds) {
    throw new Error(`Webhook timestamp too old: ${Math.abs(now - ts)}s > ${maxAgeSeconds}s`);
  }

  const message = new TextEncoder().encode(`${timestamp}.${nonce}.${body}`);
  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(platformPublicKeyHex);

  const valid = await ed.verifyAsync(signature, message, publicKey);
  if (!valid) {
    throw new Error('Invalid webhook signature');
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
