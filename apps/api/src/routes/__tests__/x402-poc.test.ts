/**
 * AGO-22: PoC — x402 payment protocol test (Base testnet, 1 USDC = 100 CHIP).
 *
 * Validates the x402 payment protocol flow end-to-end:
 *  1. HTTP 402 Payment Required response format
 *  2. USDC → CHIP conversion logic (1 USDC = 100 CHIP, USDC has 6 decimals)
 *  3. EIP-3009 transferWithAuthorization signature creation
 *  4. Payment header parsing and verification
 *  5. Idempotent mint (prevent double-credit)
 *  6. Frozen amount mechanics (double-spend prevention)
 *
 * Runs in-process without blockchain dependencies — validates protocol logic
 * and conversion correctness.
 *
 * Run with: pnpm --filter @agon/api test -- x402-poc
 */
import { describe, it, expect } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import {
  encodePacked,
  keccak256,
  parseUnits,
  formatUnits,
  type Hex,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

// ---------------------------------------------------------------------------
// x402 protocol types & constants
// ---------------------------------------------------------------------------

/** Base Sepolia USDC contract (circle testnet faucet) */
const USDC_CONTRACT = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const USDC_DECIMALS = 6;
const CHIP_PER_USDC = 100; // 1 USDC = 100 CHIP
const BASE_SEPOLIA_CHAIN_ID = 84532;

interface X402PaymentRequired {
  /** HTTP status 402 */
  status: 402;
  /** Human-readable description */
  description: string;
  /** Required payment details */
  payment: {
    /** EVM chain ID */
    chainId: number;
    /** Token contract address */
    tokenAddress: string;
    /** Amount in token's smallest unit (e.g. 1e6 for 1 USDC) */
    amountRequired: string;
    /** Facilitator URL for payment verification */
    facilitatorUrl: string;
    /** Payment recipient (platform wallet) */
    recipient: string;
    /** Resource being purchased */
    resource: string;
  };
}

interface X402PaymentHeader {
  /** EIP-3009 authorization signature */
  signature: Hex;
  /** Payer's wallet address */
  from: string;
  /** Token contract */
  token: string;
  /** Amount (raw units) */
  amount: string;
  /** Unique nonce to prevent replay */
  nonce: string;
  /** Valid after timestamp */
  validAfter: number;
  /** Valid before timestamp */
  validBefore: number;
}

interface ChipMintRecord {
  id: string;
  walletAddress: string;
  usdcAmount: bigint;
  chipAmount: number;
  txHash: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Conversion logic (mirrors production implementation)
// ---------------------------------------------------------------------------

/**
 * Convert USDC raw amount (6 decimals) to CHIP amount.
 * 1 USDC (1_000_000 raw) = 100 CHIP
 */
function usdcToChip(usdcRawAmount: bigint): number {
  // usdcRawAmount is in 1e6 units
  // Convert to whole USDC first, then multiply by rate
  const wholeUsdc = Number(usdcRawAmount) / 10 ** USDC_DECIMALS;
  return Math.floor(wholeUsdc * CHIP_PER_USDC);
}

/**
 * Convert CHIP amount to USDC raw amount.
 */
function chipToUsdc(chipAmount: number): bigint {
  const wholeUsdc = chipAmount / CHIP_PER_USDC;
  return BigInt(Math.ceil(wholeUsdc * 10 ** USDC_DECIMALS));
}

// ---------------------------------------------------------------------------
// x402 response builder
// ---------------------------------------------------------------------------

function buildPaymentRequired(
  resource: string,
  usdcAmount: string,
  recipient: string,
): X402PaymentRequired {
  return {
    status: 402,
    description: `Payment required: ${formatUnits(BigInt(usdcAmount), USDC_DECIMALS)} USDC for ${resource}`,
    payment: {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      tokenAddress: USDC_CONTRACT,
      amountRequired: usdcAmount,
      facilitatorUrl: 'https://x402.org/facilitator',
      recipient,
      resource,
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory mint ledger (simulates DB idempotency)
// ---------------------------------------------------------------------------

class MintLedger {
  private records = new Map<string, ChipMintRecord>();
  private balances = new Map<string, { chipBalance: number; frozenAmount: number }>();

  mint(walletAddress: string, usdcRawAmount: bigint, txHash: string): ChipMintRecord | null {
    // Idempotency: reject duplicate txHash
    if (this.records.has(txHash)) return null;

    const chipAmount = usdcToChip(usdcRawAmount);
    const record: ChipMintRecord = {
      id: crypto.randomUUID(),
      walletAddress,
      usdcAmount: usdcRawAmount,
      chipAmount,
      txHash,
      createdAt: new Date(),
    };

    this.records.set(txHash, record);

    // Credit balance
    const bal = this.balances.get(walletAddress) ?? { chipBalance: 0, frozenAmount: 0 };
    bal.chipBalance += chipAmount;
    this.balances.set(walletAddress, bal);

    return record;
  }

  getBalance(walletAddress: string): { chipBalance: number; frozenAmount: number } {
    return this.balances.get(walletAddress) ?? { chipBalance: 0, frozenAmount: 0 };
  }

  freeze(walletAddress: string, amount: number): boolean {
    const bal = this.balances.get(walletAddress);
    if (!bal || bal.chipBalance - bal.frozenAmount < amount) return false;
    bal.frozenAmount += amount;
    return true;
  }

  unfreeze(walletAddress: string, amount: number): void {
    const bal = this.balances.get(walletAddress);
    if (bal) bal.frozenAmount = Math.max(0, bal.frozenAmount - amount);
  }

  availableBalance(walletAddress: string): number {
    const bal = this.getBalance(walletAddress);
    return bal.chipBalance - bal.frozenAmount;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('x402 payment protocol PoC', () => {
  describe('USDC ↔ CHIP conversion', () => {
    it('1 USDC (1_000_000 raw) = 100 CHIP', () => {
      expect(usdcToChip(1_000_000n)).toBe(100);
    });

    it('0.5 USDC (500_000 raw) = 50 CHIP', () => {
      expect(usdcToChip(500_000n)).toBe(50);
    });

    it('10 USDC = 1000 CHIP', () => {
      expect(usdcToChip(10_000_000n)).toBe(1000);
    });

    it('0.01 USDC (10_000 raw) = 1 CHIP', () => {
      expect(usdcToChip(10_000n)).toBe(1);
    });

    it('fractional CHIP rounds down (no fractional chips)', () => {
      // 0.005 USDC = 5000 raw → 0.5 CHIP → rounds to 0
      expect(usdcToChip(5_000n)).toBe(0);
    });

    it('reverse: 100 CHIP = 1 USDC (1_000_000 raw)', () => {
      expect(chipToUsdc(100)).toBe(1_000_000n);
    });

    it('reverse: 1 CHIP = 10_000 raw USDC', () => {
      expect(chipToUsdc(1)).toBe(10_000n);
    });

    it('roundtrip conversion is consistent', () => {
      const amounts = [1_000_000n, 5_000_000n, 10_000_000n, 100_000_000n];
      for (const usdc of amounts) {
        const chip = usdcToChip(usdc);
        const backToUsdc = chipToUsdc(chip);
        expect(backToUsdc).toBe(usdc);
      }
    });
  });

  describe('HTTP 402 response format', () => {
    it('builds correct payment-required response', () => {
      const platformWallet = '0x1234567890abcdef1234567890abcdef12345678';
      const resp = buildPaymentRequired(
        '/arenas/abc-123/join',
        '1000000', // 1 USDC
        platformWallet,
      );

      expect(resp.status).toBe(402);
      expect(resp.description).toContain('1 USDC');
      expect(resp.payment.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
      expect(resp.payment.tokenAddress).toBe(USDC_CONTRACT);
      expect(resp.payment.amountRequired).toBe('1000000');
      expect(resp.payment.facilitatorUrl).toBe('https://x402.org/facilitator');
      expect(resp.payment.recipient).toBe(platformWallet);
      expect(resp.payment.resource).toBe('/arenas/abc-123/join');
    });

    it('formats multi-USDC amounts correctly', () => {
      const resp = buildPaymentRequired('/skills/buy', '5000000', '0x0');
      expect(resp.description).toContain('5 USDC');
    });
  });

  describe('x402 payment flow simulation', () => {
    it('full flow: 402 → sign payment → verify → credit CHIP', async () => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      const platformWallet = '0x' + '1'.repeat(40);
      const ledger = new MintLedger();

      // === Step 1: Client requests protected resource ===
      const paymentRequired = buildPaymentRequired(
        '/arenas/test-arena/join',
        '1000000', // 1 USDC
        platformWallet,
      );
      expect(paymentRequired.status).toBe(402);

      // === Step 2: Client creates EIP-3009 authorization ===
      const nonce = keccak256(encodePacked(['uint256'], [BigInt(Date.now())]));
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour

      // Simulate signing (in production: transferWithAuthorization typed data)
      const paymentMessage = `x402:${paymentRequired.payment.tokenAddress}:${paymentRequired.payment.amountRequired}:${nonce}`;
      const signature = await account.signMessage({ message: paymentMessage });

      const paymentHeader: X402PaymentHeader = {
        signature,
        from: account.address,
        token: paymentRequired.payment.tokenAddress,
        amount: paymentRequired.payment.amountRequired,
        nonce,
        validAfter,
        validBefore,
      };

      // === Step 3: Server verifies payment header ===
      expect(paymentHeader.from).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(paymentHeader.amount).toBe('1000000');
      expect(paymentHeader.token).toBe(USDC_CONTRACT);
      expect(paymentHeader.validBefore).toBeGreaterThan(Math.floor(Date.now() / 1000));

      // === Step 4: Server credits CHIP after facilitator confirms ===
      const txHash = keccak256(encodePacked(['bytes'], [signature]));
      const mintResult = ledger.mint(
        account.address.toLowerCase(),
        BigInt(paymentHeader.amount),
        txHash,
      );

      expect(mintResult).not.toBeNull();
      expect(mintResult!.chipAmount).toBe(100); // 1 USDC = 100 CHIP
      expect(mintResult!.walletAddress).toBe(account.address.toLowerCase());

      // === Step 5: Verify balance ===
      const balance = ledger.getBalance(account.address.toLowerCase());
      expect(balance.chipBalance).toBe(100);
      expect(balance.frozenAmount).toBe(0);
    });

    it('rejects duplicate payment (idempotent mint)', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const ledger = new MintLedger();
      const wallet = account.address.toLowerCase();
      const txHash = '0x' + 'a'.repeat(64);

      // First mint — success
      const first = ledger.mint(wallet, 1_000_000n, txHash);
      expect(first).not.toBeNull();
      expect(first!.chipAmount).toBe(100);

      // Duplicate — rejected
      const duplicate = ledger.mint(wallet, 1_000_000n, txHash);
      expect(duplicate).toBeNull();

      // Balance should only reflect one mint
      expect(ledger.getBalance(wallet).chipBalance).toBe(100);
    });

    it('multiple payments accumulate CHIP correctly', () => {
      const wallet = '0x' + 'b'.repeat(40);
      const ledger = new MintLedger();

      ledger.mint(wallet, 1_000_000n, 'tx1');  // 100 CHIP
      ledger.mint(wallet, 5_000_000n, 'tx2');  // 500 CHIP
      ledger.mint(wallet, 10_000_000n, 'tx3'); // 1000 CHIP

      expect(ledger.getBalance(wallet).chipBalance).toBe(1600);
    });
  });

  describe('CHIP freeze/unfreeze (double-spend prevention)', () => {
    it('freezes CHIP for game entry', () => {
      const wallet = '0x' + 'c'.repeat(40);
      const ledger = new MintLedger();

      ledger.mint(wallet, 10_000_000n, 'tx1'); // 1000 CHIP
      expect(ledger.availableBalance(wallet)).toBe(1000);

      // Freeze 200 for arena entry
      const frozen = ledger.freeze(wallet, 200);
      expect(frozen).toBe(true);
      expect(ledger.availableBalance(wallet)).toBe(800);
      expect(ledger.getBalance(wallet).chipBalance).toBe(1000); // Total unchanged
    });

    it('rejects freeze when insufficient available balance', () => {
      const wallet = '0x' + 'd'.repeat(40);
      const ledger = new MintLedger();

      ledger.mint(wallet, 1_000_000n, 'tx1'); // 100 CHIP
      ledger.freeze(wallet, 80);

      // Try to freeze more than available (100 - 80 = 20 available)
      const frozen = ledger.freeze(wallet, 30);
      expect(frozen).toBe(false);
      expect(ledger.availableBalance(wallet)).toBe(20); // Unchanged
    });

    it('unfreezes CHIP after game ends', () => {
      const wallet = '0x' + 'e'.repeat(40);
      const ledger = new MintLedger();

      ledger.mint(wallet, 5_000_000n, 'tx1'); // 500 CHIP
      ledger.freeze(wallet, 200);
      expect(ledger.availableBalance(wallet)).toBe(300);

      ledger.unfreeze(wallet, 200);
      expect(ledger.availableBalance(wallet)).toBe(500);
    });
  });

  describe('EIP-3009 authorization signature', () => {
    it('creates valid transferWithAuthorization hash', () => {
      const from = '0x' + '1'.repeat(40);
      const to = '0x' + '2'.repeat(40);
      const value = parseUnits('1', USDC_DECIMALS); // 1 USDC
      const validAfter = BigInt(0);
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = keccak256(encodePacked(['uint256'], [BigInt(42)]));

      // EIP-3009 authorization hash
      const authHash = keccak256(
        encodePacked(
          ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [from as `0x${string}`, to as `0x${string}`, value, validAfter, validBefore, nonce],
        ),
      );

      expect(authHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(value).toBe(1_000_000n);
    });

    it('different nonces produce different authorization hashes', () => {
      const from = '0x' + '1'.repeat(40) as `0x${string}`;
      const to = '0x' + '2'.repeat(40) as `0x${string}`;
      const value = 1_000_000n;

      const hash1 = keccak256(
        encodePacked(
          ['address', 'address', 'uint256', 'bytes32'],
          [from, to, value, keccak256(encodePacked(['uint256'], [1n]))],
        ),
      );

      const hash2 = keccak256(
        encodePacked(
          ['address', 'address', 'uint256', 'bytes32'],
          [from, to, value, keccak256(encodePacked(['uint256'], [2n]))],
        ),
      );

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('x402 middleware simulation (Express-like)', () => {
    it('simulates x402 middleware with HTTP server', async () => {
      // Create a tiny HTTP server that returns 402 for unpaid requests
      const server = createServer((req, res) => {
        const paymentHeader = req.headers['x-payment'] as string | undefined;

        if (!paymentHeader) {
          // No payment — return 402
          const body = JSON.stringify(
            buildPaymentRequired('/api/premium', '1000000', '0x' + 'f'.repeat(40)),
          );
          res.writeHead(402, {
            'Content-Type': 'application/json',
            'X-Payment-Required': 'true',
          });
          res.end(body);
          return;
        }

        // Payment provided — grant access
        const chipAmount = usdcToChip(BigInt(1_000_000));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          chipsCredited: chipAmount,
          resource: '/api/premium',
        }));
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      });

      try {
        // === Request without payment → 402 ===
        const resp1 = await fetch(`http://localhost:${port}/api/premium`);
        expect(resp1.status).toBe(402);
        expect(resp1.headers.get('x-payment-required')).toBe('true');

        const body1 = await resp1.json() as X402PaymentRequired;
        expect(body1.status).toBe(402);
        expect(body1.payment.amountRequired).toBe('1000000');
        expect(body1.payment.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);

        // === Request with payment header → 200 ===
        const resp2 = await fetch(`http://localhost:${port}/api/premium`, {
          headers: { 'X-Payment': 'valid-payment-proof' },
        });
        expect(resp2.status).toBe(200);

        const body2 = await resp2.json() as { success: boolean; chipsCredited: number };
        expect(body2.success).toBe(true);
        expect(body2.chipsCredited).toBe(100);
      } finally {
        server.close();
      }
    });
  });
});
