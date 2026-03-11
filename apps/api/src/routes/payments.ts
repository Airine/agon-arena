/**
 * AGO-60: x402 payment endpoint integration (1 USDC = 100 CHIP)
 *
 * Flow:
 *   POST /payments/chip-purchase { chipAmount: number }
 *
 *   1. No X-PAYMENT header → 402 with payment requirements
 *   2. X-PAYMENT header present → verify → settle → credit CHIP (idempotent)
 *
 * Security invariants:
 *  - JWT required (user identity from token)
 *  - chipAmount must be a positive integer, multiple of 100 (min 100)
 *  - Idempotent: settlement tx hash used as referenceId (prevents double-credit)
 *  - Verify before settle: no on-chain settlement if verification fails
 *  - Network: configured via X402_NETWORK env var (default: base-sepolia)
 *
 * Rate: 1 USDC = 100 CHIP
 * USDC address: configured via X402_USDC_ADDRESS env var
 *   Testnet (Base Sepolia): 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *   Mainnet (Base):         0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { chipService } from '../services/chip.js';
import { db, schema } from '../db/index.js';
import { decodePayment } from 'x402/schemes';
import { useFacilitator } from 'x402/verify';
import type { PaymentRequirements } from 'x402/types';

export const paymentsRouter: RouterType = Router();

// ─── Constants ─────────────────────────────────────────────────────────────

/** Payment network — set X402_NETWORK=base for mainnet, default: base-sepolia */
const NETWORK = (process.env['X402_NETWORK'] ?? 'base-sepolia') as string;

/** USDC contract address — set X402_USDC_ADDRESS for mainnet:
 *   Base Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   Default (Base Sepolia): 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 */
const USDC_BASE_SEPOLIA = process.env['X402_USDC_ADDRESS'] ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

/** Exchange rate: 1 USDC = 100 CHIP */
const CHIP_PER_USDC = 100;

/** USDC decimals */
const USDC_DECIMALS = 6;

/** Atomic units per USDC */
const USDC_ATOMIC = 10 ** USDC_DECIMALS; // 1_000_000

/** Min purchase: 100 CHIP = 1 USDC */
const MIN_CHIP_PURCHASE = 100;

/** x402 protocol version */
const X402_VERSION = 1;

/** Timeout for payment authorization (seconds) */
const MAX_TIMEOUT_SECONDS = 300;

// ─── Helpers ───────────────────────────────────────────────────────────────

function getPlatformAddress(): string {
  const addr = process.env['X402_PLATFORM_ADDRESS'];
  if (!addr) throw new Error('X402_PLATFORM_ADDRESS env var is not set');
  return addr;
}

function getFacilitatorUrl(): string | undefined {
  return process.env['X402_FACILITATOR_URL']; // undefined → default https://x402.org/facilitator
}

/** Convert CHIP amount to USDC atomic units (bigint string). */
function chipToUsdcAtomic(chipAmount: number): string {
  // chipAmount CHIP ÷ CHIP_PER_USDC × USDC_ATOMIC
  // e.g. 100 CHIP → 100/100 × 1_000_000 = 1_000_000
  return String((chipAmount / CHIP_PER_USDC) * USDC_ATOMIC);
}

/** Build payment requirements for a chip purchase. */
function buildPaymentRequirements(chipAmount: number, resource: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: NETWORK,
    maxAmountRequired: chipToUsdcAtomic(chipAmount),
    resource,
    description: `Purchase ${chipAmount} CHIP (${chipAmount / CHIP_PER_USDC} USDC)`,
    mimeType: 'application/json',
    payTo: getPlatformAddress(),
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    asset: USDC_BASE_SEPOLIA,
  };
}

// ─── Request validation ────────────────────────────────────────────────────

const purchaseBodySchema = z.object({
  chipAmount: z
    .number()
    .int('chipAmount must be an integer')
    .min(MIN_CHIP_PURCHASE, `Minimum purchase is ${MIN_CHIP_PURCHASE} CHIP`)
    .refine((n) => n % CHIP_PER_USDC === 0, `chipAmount must be a multiple of ${CHIP_PER_USDC}`),
});

// ─── Route ─────────────────────────────────────────────────────────────────

/**
 * POST /payments/chip-purchase
 *
 * Requires: JWT auth, body { chipAmount: number }
 *
 * Without X-PAYMENT header: returns 402 with payment requirements.
 * With X-PAYMENT header:    verifies + settles + credits CHIP.
 */
paymentsRouter.post('/chip-purchase', requireAuth, async (req, res) => {
  const user = req.user!;

  // 1. Validate body
  const parseResult = purchaseBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Invalid request' });
    return;
  }
  const { chipAmount } = parseResult.data;

  // Resource URL for payment requirements (prefer forwarded host)
  const host = req.get('X-Forwarded-Host') ?? req.get('host') ?? 'localhost';
  const protocol = req.get('X-Forwarded-Proto') ?? (req.secure ? 'https' : 'http');
  const resource = `${protocol}://${host}/payments/chip-purchase`;

  const paymentRequirements = buildPaymentRequirements(chipAmount, resource);

  // 2. Check for X-PAYMENT header
  const xPaymentHeader = req.headers['x-payment'] as string | undefined;

  if (!xPaymentHeader) {
    // No payment provided → return 402 with requirements
    res.status(402).json({
      x402Version: X402_VERSION,
      accepts: [paymentRequirements],
      error: 'Payment required to purchase CHIP',
    });
    return;
  }

  // 3. Decode payment payload
  let paymentPayload;
  try {
    paymentPayload = decodePayment(xPaymentHeader);
  } catch {
    res.status(400).json({ error: 'Invalid X-PAYMENT header: failed to decode' });
    return;
  }

  // 4. Verify payment with facilitator
  const facilitatorUrl = getFacilitatorUrl();
  const { verify, settle } = useFacilitator(
    facilitatorUrl ? { url: facilitatorUrl as `${string}://${string}` } : undefined,
  );

  let verifyResponse;
  try {
    verifyResponse = await verify(paymentPayload, paymentRequirements);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Verification request failed';
    res.status(502).json({ error: `Payment verification failed: ${msg}` });
    return;
  }

  if (!verifyResponse.isValid) {
    res.status(402).json({
      x402Version: X402_VERSION,
      accepts: [paymentRequirements],
      error: verifyResponse.invalidReason ?? 'Payment invalid',
    });
    return;
  }

  // 5. Settle payment on-chain
  let settleResponse;
  try {
    settleResponse = await settle(paymentPayload, paymentRequirements);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Settlement request failed';
    res.status(502).json({ error: `Payment settlement failed: ${msg}` });
    return;
  }

  if (!settleResponse.success) {
    res.status(402).json({
      x402Version: X402_VERSION,
      accepts: [paymentRequirements],
      error: settleResponse.errorReason ?? 'Settlement failed',
    });
    return;
  }

  const txHash = settleResponse.transaction;

  // 6. Idempotency check: has this tx hash already been credited?
  const existingTx = await db
    .select({ id: schema.chipTransactions.id })
    .from(schema.chipTransactions)
    .where(
      and(
        eq(schema.chipTransactions.referenceType, 'x402'),
        eq(schema.chipTransactions.referenceId, txHash),
      ),
    )
    .limit(1);

  if (existingTx.length > 0) {
    // Already credited — return current balance (idempotent success)
    const balance = await chipService.getBalance(user.userId);
    res.json({
      chipAmount,
      txHash,
      idempotent: true,
      balance,
    });
    return;
  }

  // 7. Credit CHIP to user
  const txResult = await chipService.credit(user.userId, chipAmount, {
    referenceType: 'x402',
    referenceId: txHash,
    note: `x402 purchase: ${chipAmount} CHIP for ${chipAmount / CHIP_PER_USDC} USDC (tx: ${txHash})`,
  });

  res.json({
    chipAmount,
    txHash,
    idempotent: false,
    balance: {
      chipBalance: txResult.balanceAfter,
      frozenAmount: txResult.frozenAfter,
      available: txResult.balanceAfter - txResult.frozenAfter,
    },
  });
});

/**
 * GET /payments/chip-purchase/requirements
 *
 * Returns payment requirements for a given chipAmount without initiating payment.
 * Useful for clients to pre-compute the USDC cost before sending X-PAYMENT.
 */
paymentsRouter.get('/chip-purchase/requirements', requireAuth, (req, res) => {
  const chipAmountRaw = Number(req.query['chipAmount']);
  const parseResult = purchaseBodySchema.safeParse({ chipAmount: chipAmountRaw });
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Invalid chipAmount' });
    return;
  }

  const { chipAmount } = parseResult.data;
  const host = req.get('X-Forwarded-Host') ?? req.get('host') ?? 'localhost';
  const protocol = req.get('X-Forwarded-Proto') ?? (req.secure ? 'https' : 'http');
  const resource = `${protocol}://${host}/payments/chip-purchase`;

  const requirements = buildPaymentRequirements(chipAmount, resource);

  res.json({
    x402Version: X402_VERSION,
    chipAmount,
    usdcAmount: chipAmount / CHIP_PER_USDC,
    usdcAtomicAmount: chipToUsdcAtomic(chipAmount),
    requirements,
  });
});
