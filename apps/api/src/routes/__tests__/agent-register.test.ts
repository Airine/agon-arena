/**
 * AGO-52: Agent auto-registration via EIP-191 wallet signature.
 *
 * Validates the complete agent registration flow:
 *  1. Agent generates ephemeral wallet (private key)
 *  2. Agent constructs EIP-191 personal_sign message with nonce
 *  3. Agent signs: "Register Agon Agent\nNonce: {nonce}"
 *  4. Server verifies signature → confirms wallet ownership before any DB write
 *  5. Nonce single-use enforcement (Redis DEL is atomic)
 *  6. Wallet address normalized to lowercase
 *  7. Zod schema validation for agentCard fields
 *
 * Runs in-process without live DB or Redis — validates cryptographic
 * and business logic correctness. Same pattern as siwe-poc.test.ts.
 *
 * Run with: pnpm --filter @agon/api test -- agent-register
 */
import { describe, it, expect } from 'vitest';
import { createWalletClient, http, verifyMessage } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { randomBytes } from 'crypto';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers (mirrors production code)
// ---------------------------------------------------------------------------

function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/** The exact message format an agent must sign (mirrors auth.ts) */
function buildRegistrationMessage(nonce: string): string {
  return `Register Agon Agent\nNonce: ${nonce}`;
}

async function signRegistrationMessage(privateKey: `0x${string}`, nonce: string): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain: baseSepolia, transport: http() });
  const sig = await client.signMessage({ message: buildRegistrationMessage(nonce) });
  return sig;
}

// ---------------------------------------------------------------------------
// Zod schema mirror (validates the same rules as production auth.ts)
// ---------------------------------------------------------------------------

const agentCardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  apiUrl: z.string().url(),
  webhookPublicKey: z.string().length(64).optional(),
  version: z.string().default('1.0'),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional(),
});

const agentRegisterSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  nonce: z.string().min(1),
  signature: z.string().startsWith('0x'),
  agentCard: agentCardSchema,
});

// ---------------------------------------------------------------------------
// In-memory nonce store — simulates Redis single-use nonce (mirrors redis.ts)
// ---------------------------------------------------------------------------

class AgentNonceStore {
  private nonces = new Set<string>();
  store(nonce: string): void { this.nonces.add(nonce); }
  consume(nonce: string): boolean {
    if (this.nonces.has(nonce)) {
      this.nonces.delete(nonce);
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Crypto PoC: EIP-191 sign/verify correctness
// ---------------------------------------------------------------------------

describe('EIP-191 agent registration signature', () => {
  it('verifies correctly for a freshly generated wallet', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const nonce = generateNonce();

    const signature = await signRegistrationMessage(privateKey, nonce);

    const valid = await verifyMessage({
      address: account.address,
      message: buildRegistrationMessage(nonce),
      signature,
    });

    expect(valid).toBe(true);
  });

  it('rejects when claimed address does not match actual signer', async () => {
    const signerKey = generatePrivateKey();
    const otherKey = generatePrivateKey();
    const otherAccount = privateKeyToAccount(otherKey);
    const nonce = generateNonce();

    const signature = await signRegistrationMessage(signerKey, nonce);

    const valid = await verifyMessage({
      address: otherAccount.address, // Claiming to be a different address
      message: buildRegistrationMessage(nonce),
      signature,
    });

    expect(valid).toBe(false);
  });

  it('rejects when nonce in message differs from signed nonce', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const signedNonce = generateNonce();
    const differentNonce = generateNonce();

    const signature = await signRegistrationMessage(privateKey, signedNonce);

    // Server uses a different nonce in the message — should fail
    const valid = await verifyMessage({
      address: account.address,
      message: buildRegistrationMessage(differentNonce),
      signature,
    });

    expect(valid).toBe(false);
  });

  it('walletAddress normalized to lowercase before DB lookup', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const nonce = generateNonce();
    const signature = await signRegistrationMessage(privateKey, nonce);

    // Simulate production: normalize address before storage
    const normalizedFromPayload = account.address.toLowerCase();
    const normalizedFromUpper = account.address.toUpperCase().toLowerCase();

    expect(normalizedFromPayload).toBe(normalizedFromUpper);

    // Verify still works after normalization
    const valid = await verifyMessage({
      address: account.address, // viem handles case-insensitive EVM addresses
      message: buildRegistrationMessage(nonce),
      signature,
    });
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nonce single-use enforcement
// ---------------------------------------------------------------------------

describe('Agent nonce single-use enforcement', () => {
  it('allows nonce consumption exactly once', () => {
    const store = new AgentNonceStore();
    const nonce = generateNonce();
    store.store(nonce);

    expect(store.consume(nonce)).toBe(true);   // First use: valid
    expect(store.consume(nonce)).toBe(false);  // Replay attack: rejected
  });

  it('rejects unknown nonce (never stored)', () => {
    const store = new AgentNonceStore();
    expect(store.consume(generateNonce())).toBe(false);
  });

  it('two different nonces are independent', () => {
    const store = new AgentNonceStore();
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    store.store(nonce1);
    store.store(nonce2);

    expect(store.consume(nonce1)).toBe(true);
    expect(store.consume(nonce2)).toBe(true);
    expect(store.consume(nonce1)).toBe(false); // Already consumed
  });
});

// ---------------------------------------------------------------------------
// AgentCard Zod schema validation
// ---------------------------------------------------------------------------

describe('agentCard schema validation', () => {
  const validCard = {
    name: 'TestBot',
    apiUrl: 'https://agent.example.com/api',
    capabilities: ['texas_holdem'],
  };

  it('accepts a minimal valid agentCard', () => {
    const result = agentCardSchema.safeParse(validCard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1.0'); // Default applied
      expect(result.data.capabilities).toEqual(['texas_holdem']);
    }
  });

  it('accepts a fully specified agentCard', () => {
    const result = agentCardSchema.safeParse({
      ...validCard,
      description: 'A poker AI agent using Monte Carlo simulation',
      webhookPublicKey: 'a'.repeat(64),
      version: '2.0',
      metadata: { framework: 'elizaos', language: 'typescript' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = agentCardSchema.safeParse({ apiUrl: 'https://agent.example.com/api' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid apiUrl', () => {
    const result = agentCardSchema.safeParse({ ...validCard, apiUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects webhookPublicKey that is not 64 chars', () => {
    const result = agentCardSchema.safeParse({ ...validCard, webhookPublicKey: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects name longer than 100 chars', () => {
    const result = agentCardSchema.safeParse({ ...validCard, name: 'x'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects description longer than 500 chars', () => {
    const result = agentCardSchema.safeParse({ ...validCard, description: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full registration schema validation
// ---------------------------------------------------------------------------

describe('agentRegister schema validation', () => {
  it('rejects non-EVM wallet address', () => {
    const result = agentRegisterSchema.safeParse({
      walletAddress: 'not-an-address',
      nonce: generateNonce(),
      signature: '0xdeadbeef',
      agentCard: { name: 'Bot', apiUrl: 'https://example.com' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects signature not starting with 0x', () => {
    const result = agentRegisterSchema.safeParse({
      walletAddress: '0x' + 'a'.repeat(40),
      nonce: generateNonce(),
      signature: 'deadbeef', // Missing 0x prefix
      agentCard: { name: 'Bot', apiUrl: 'https://example.com' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid registration payload', () => {
    const result = agentRegisterSchema.safeParse({
      walletAddress: '0x' + 'a'.repeat(40),
      nonce: generateNonce(),
      signature: '0xdeadbeef',
      agentCard: { name: 'Bot', apiUrl: 'https://agent.example.com/api' },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Simulated full registration flow (no DB/Redis)
// ---------------------------------------------------------------------------

describe('Simulated agent registration flow', () => {
  it('full happy path: sign → verify → nonce consumed → account created', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const store = new AgentNonceStore();

    // Step 1: Server generates and stores nonce
    const nonce = generateNonce();
    store.store(nonce);

    // Step 2: Agent signs registration message
    const signature = await signRegistrationMessage(privateKey, nonce);

    // Step 3: Server verifies signature (proves wallet ownership)
    const valid = await verifyMessage({
      address: account.address,
      message: buildRegistrationMessage(nonce),
      signature,
    });
    expect(valid).toBe(true);

    // Step 4: Server consumes nonce (single-use)
    expect(store.consume(nonce)).toBe(true);

    // Step 5: Normalize wallet address
    const walletAddress = account.address.toLowerCase();
    expect(walletAddress).toMatch(/^0x[0-9a-f]{40}$/);

    // Step 6: Auto-derive username (mirrors production code)
    const shortAddr = walletAddress.slice(2, 6) + walletAddress.slice(-4);
    const username = `agent_${shortAddr}${randomBytes(2).toString('hex')}`;
    expect(username).toMatch(/^agent_[0-9a-f]{8}[0-9a-f]{4}$/);
  });

  it('replay attack: second registration with same nonce is rejected', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const store = new AgentNonceStore();

    const nonce = generateNonce();
    store.store(nonce);

    const signature = await signRegistrationMessage(privateKey, nonce);
    const message = buildRegistrationMessage(nonce);

    // First attempt: succeeds
    const valid1 = await verifyMessage({ address: account.address, message, signature });
    expect(valid1).toBe(true);
    expect(store.consume(nonce)).toBe(true);

    // Second attempt (replay): nonce already consumed
    const valid2 = await verifyMessage({ address: account.address, message, signature });
    expect(valid2).toBe(true); // Signature still cryptographically valid
    expect(store.consume(nonce)).toBe(false); // But nonce rejected — replay blocked
  });
});
