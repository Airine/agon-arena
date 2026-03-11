/**
 * AGO-21: PoC — SIWE (Sign-In with Ethereum) integration test.
 *
 * Validates the complete SIWE flow:
 *  1. Generate ephemeral Ethereum wallet (private key)
 *  2. Create EIP-4361 SIWE message with nonce
 *  3. Sign the message with the wallet's private key
 *  4. Verify the signature using the siwe library
 *  5. Ensure nonce single-use enforcement
 *  6. Validate domain & chain-ID checks
 *
 * This test runs in-process without DB/Redis dependencies —
 * it validates cryptographic correctness of the SIWE protocol.
 *
 * Run with: pnpm --filter @agon/api test -- siwe-poc
 */
import { describe, it, expect } from 'vitest';
import { SiweMessage } from 'siwe';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOMAIN = 'localhost';
const ORIGIN = 'http://localhost:3000';
const CHAIN_ID = 84532; // Base Sepolia

function createSiweMessage(address: string, nonce: string, opts?: Partial<{
  domain: string;
  chainId: number;
  statement: string;
  expirationTime: string;
}>): SiweMessage {
  return new SiweMessage({
    domain: opts?.domain ?? DOMAIN,
    address,
    statement: opts?.statement ?? 'Sign in to Agon Arena',
    uri: ORIGIN,
    version: '1',
    chainId: opts?.chainId ?? CHAIN_ID,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: opts?.expirationTime,
  });
}

function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// In-memory nonce store (simulates Redis single-use nonce)
// ---------------------------------------------------------------------------

class NonceStore {
  private nonces = new Set<string>();

  store(nonce: string): void {
    this.nonces.add(nonce);
  }

  consume(nonce: string): boolean {
    if (this.nonces.has(nonce)) {
      this.nonces.delete(nonce);
      return true;
    }
    return false;
  }

  has(nonce: string): boolean {
    return this.nonces.has(nonce);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SIWE PoC integration test', () => {
  it('generates a valid Ethereum wallet from private key', () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('creates a valid EIP-4361 SIWE message', () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();
    const message = createSiweMessage(account.address, nonce);
    const prepared = message.prepareMessage();

    expect(prepared).toContain(DOMAIN);
    expect(prepared).toContain(account.address);
    expect(prepared).toContain(nonce);
    expect(prepared).toContain('Sign in to Agon Arena');
    expect(prepared).toContain(`Chain ID: ${CHAIN_ID}`);
  });

  it('signs and verifies a SIWE message successfully', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const nonce = generateNonce();

    // Step 1: Create SIWE message
    const siweMessage = createSiweMessage(account.address, nonce);
    const messageStr = siweMessage.prepareMessage();

    // Step 2: Sign with wallet
    const signature = await account.signMessage({ message: messageStr });
    expect(signature).toMatch(/^0x[0-9a-f]+$/i);

    // Step 3: Verify
    const parsedMessage = new SiweMessage(messageStr);
    const { data: verified } = await parsedMessage.verify({ signature });

    expect(verified).toBeTruthy();
    expect(parsedMessage.address).toBe(account.address);
    expect(parsedMessage.nonce).toBe(nonce);
    expect(parsedMessage.chainId).toBe(CHAIN_ID);
    expect(parsedMessage.domain).toBe(DOMAIN);
  });

  it('rejects a signature from a different wallet', async () => {
    const realAccount = privateKeyToAccount(generatePrivateKey());
    const attackerAccount = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();

    // Create message for the real account
    const siweMessage = createSiweMessage(realAccount.address, nonce);
    const messageStr = siweMessage.prepareMessage();

    // Attacker signs with their own key
    const forgedSignature = await attackerAccount.signMessage({ message: messageStr });

    // Verification should fail — signature doesn't match the address in the message
    const parsedMessage = new SiweMessage(messageStr);
    try {
      const { data: verified } = await parsedMessage.verify({ signature: forgedSignature });
      // If verify doesn't throw, the data should indicate mismatch
      expect(verified).toBeFalsy();
    } catch (err) {
      // SIWE throws on signature mismatch — this is expected
      expect(err).toBeDefined();
    }
  });

  it('enforces nonce single-use (replay protection)', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();
    const nonceStore = new NonceStore();

    // Store the nonce
    nonceStore.store(nonce);
    expect(nonceStore.has(nonce)).toBe(true);

    // First consumption — should succeed
    expect(nonceStore.consume(nonce)).toBe(true);

    // Second consumption (replay) — should fail
    expect(nonceStore.consume(nonce)).toBe(false);

    // And of course it's gone
    expect(nonceStore.has(nonce)).toBe(false);
  });

  it('validates domain mismatch', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();

    // Create message with wrong domain
    const siweMessage = createSiweMessage(account.address, nonce, {
      domain: 'evil-site.com',
    });
    const messageStr = siweMessage.prepareMessage();
    const signature = await account.signMessage({ message: messageStr });

    // Parsing succeeds but domain doesn't match expected
    const parsed = new SiweMessage(messageStr);
    expect(parsed.domain).toBe('evil-site.com');
    expect(parsed.domain).not.toBe(DOMAIN);

    // Server-side check would reject this
    const expectedDomain = DOMAIN;
    const isValid = parsed.domain === expectedDomain;
    expect(isValid).toBe(false);
  });

  it('validates chain ID mismatch', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();

    // Create message with wrong chain ID (Ethereum mainnet instead of Base Sepolia)
    const siweMessage = createSiweMessage(account.address, nonce, {
      chainId: 1, // Ethereum mainnet
    });
    const messageStr = siweMessage.prepareMessage();

    const parsed = new SiweMessage(messageStr);
    expect(parsed.chainId).toBe(1);
    expect(parsed.chainId).not.toBe(CHAIN_ID);
  });

  it('full flow: nonce → sign → verify → consume → reject replay', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const nonceStore = new NonceStore();

    // === Step 1: Server generates nonce ===
    const nonce = generateNonce();
    nonceStore.store(nonce);

    // === Step 2: Client creates & signs SIWE message ===
    const siweMessage = createSiweMessage(account.address, nonce);
    const messageStr = siweMessage.prepareMessage();
    const signature = await account.signMessage({ message: messageStr });

    // === Step 3: Server verifies signature ===
    const parsed = new SiweMessage(messageStr);

    // Domain check
    expect(parsed.domain).toBe(DOMAIN);

    // Chain ID check
    expect(parsed.chainId).toBe(CHAIN_ID);

    // Cryptographic verification
    const { data: verified } = await parsed.verify({ signature });
    expect(verified).toBeTruthy();

    // === Step 4: Consume nonce (single-use) ===
    const nonceValid = nonceStore.consume(parsed.nonce);
    expect(nonceValid).toBe(true);

    // === Step 5: Extract wallet address for user lookup/creation ===
    const walletAddress = parsed.address.toLowerCase();
    expect(walletAddress).toMatch(/^0x[0-9a-f]{40}$/);

    // Auto-generated username pattern
    const shortAddr = walletAddress.slice(2, 6) + walletAddress.slice(-4);
    const username = `w${shortAddr}`;
    expect(username).toMatch(/^w[0-9a-f]{8}$/);

    // === Step 6: Replay attempt should fail ===
    const replayValid = nonceStore.consume(parsed.nonce);
    expect(replayValid).toBe(false);
  });

  it('handles viem walletClient signMessage (browser-like flow)', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const nonce = generateNonce();

    // Simulate browser wallet client
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });

    // Create SIWE message
    const siweMessage = createSiweMessage(account.address, nonce);
    const messageStr = siweMessage.prepareMessage();

    // Sign using viem walletClient (same API as browser wallet)
    const signature = await walletClient.signMessage({ message: messageStr });

    // Verify
    const parsed = new SiweMessage(messageStr);
    const { data: verified } = await parsed.verify({ signature });
    expect(verified).toBeTruthy();
    expect(parsed.address).toBe(account.address);
  });

  it('wallet address is checksummed in SIWE but we store lowercase', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = generateNonce();

    const siweMessage = createSiweMessage(account.address, nonce);
    const messageStr = siweMessage.prepareMessage();
    const signature = await account.signMessage({ message: messageStr });

    const parsed = new SiweMessage(messageStr);
    const { data: verified } = await parsed.verify({ signature });
    expect(verified).toBeTruthy();

    // SIWE returns checksummed address (mixed case)
    expect(parsed.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // We normalize to lowercase for DB storage
    const normalized = parsed.address.toLowerCase();
    expect(normalized).toMatch(/^0x[0-9a-f]{40}$/);

    // Both should be the same address
    expect(normalized).toBe(account.address.toLowerCase());
  });

  it('concurrent nonce requests produce unique nonces', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    // All 100 nonces should be unique
    expect(nonces.size).toBe(100);
  });
});
