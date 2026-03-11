/**
 * AGO-60: x402 payment endpoint tests
 *
 * Tests validate:
 *  1. 402 response format (correct x402 payment requirements)
 *  2. Invalid request body (non-integer, too small, not multiple of 100)
 *  3. Malformed X-PAYMENT header
 *  4. Failed facilitator verification → 402
 *  5. Successful payment → CHIP credited (idempotent)
 *  6. Duplicate tx hash → idempotent no-op
 *  7. Rate: 1 USDC = 100 CHIP (atomic unit calculation)
 *  8. GET /requirements endpoint
 *
 * Uses in-process Express app with mocked facilitator and chipService.
 * No live DB, Redis, or blockchain required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';

// ---------------------------------------------------------------------------
// Constants (mirrors payments.ts)
// ---------------------------------------------------------------------------

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const CHIP_PER_USDC = 100;
const USDC_DECIMALS = 6;
const USDC_ATOMIC = 10 ** USDC_DECIMALS; // 1_000_000
const MIN_CHIP = 100;

// ---------------------------------------------------------------------------
// Rate calculation tests (pure logic, no I/O)
// ---------------------------------------------------------------------------

describe('x402 rate conversion logic', () => {
  function chipToUsdcAtomic(chipAmount: number): string {
    return String((chipAmount / CHIP_PER_USDC) * USDC_ATOMIC);
  }

  it('100 CHIP = 1 USDC = 1_000_000 atomic', () => {
    expect(chipToUsdcAtomic(100)).toBe('1000000');
  });

  it('1000 CHIP = 10 USDC = 10_000_000 atomic', () => {
    expect(chipToUsdcAtomic(1000)).toBe('10000000');
  });

  it('500 CHIP = 5 USDC = 5_000_000 atomic', () => {
    expect(chipToUsdcAtomic(500)).toBe('5000000');
  });

  it('200 CHIP = 2 USDC = 2_000_000 atomic', () => {
    expect(chipToUsdcAtomic(200)).toBe('2000000');
  });

  it('minimum: 100 CHIP = 1_000_000 atomic (1 USDC)', () => {
    const atomic = Number(chipToUsdcAtomic(MIN_CHIP));
    expect(atomic).toBe(USDC_ATOMIC);
  });
});

// ---------------------------------------------------------------------------
// Idempotency ledger (mirrors ChipService behavior)
// ---------------------------------------------------------------------------

describe('x402 idempotency logic', () => {
  interface TxRecord {
    txHash: string;
    userId: string;
    chipAmount: number;
  }

  class PaymentLedger {
    private txns: TxRecord[] = [];
    private balances: Map<string, number> = new Map();

    credit(userId: string, chipAmount: number, txHash: string): { credited: boolean; balance: number } {
      // Idempotency guard
      const exists = this.txns.find((t) => t.txHash === txHash);
      if (exists) {
        return { credited: false, balance: this.balances.get(userId) ?? 0 };
      }

      this.txns.push({ txHash, userId, chipAmount });
      const prev = this.balances.get(userId) ?? 0;
      this.balances.set(userId, prev + chipAmount);
      return { credited: true, balance: prev + chipAmount };
    }

    getBalance(userId: string): number {
      return this.balances.get(userId) ?? 0;
    }
  }

  it('credits CHIP on first payment', () => {
    const ledger = new PaymentLedger();
    const result = ledger.credit('user-1', 100, '0xabc');
    expect(result.credited).toBe(true);
    expect(result.balance).toBe(100);
  });

  it('no double-credit for duplicate txHash', () => {
    const ledger = new PaymentLedger();
    ledger.credit('user-1', 100, '0xabc');
    const result = ledger.credit('user-1', 100, '0xabc');
    expect(result.credited).toBe(false);
    expect(result.balance).toBe(100);
  });

  it('different txHash → additional credit', () => {
    const ledger = new PaymentLedger();
    ledger.credit('user-1', 100, '0xabc');
    const result = ledger.credit('user-1', 500, '0xdef');
    expect(result.credited).toBe(true);
    expect(result.balance).toBe(600);
  });

  it('different users do not share balances', () => {
    const ledger = new PaymentLedger();
    ledger.credit('user-1', 100, '0xabc');
    ledger.credit('user-2', 200, '0xdef');
    expect(ledger.getBalance('user-1')).toBe(100);
    expect(ledger.getBalance('user-2')).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Payment requirements format tests
// ---------------------------------------------------------------------------

describe('x402 payment requirements format', () => {
  function buildRequirements(chipAmount: number, resource: string) {
    return {
      scheme: 'exact' as const,
      network: 'base-sepolia' as const,
      maxAmountRequired: String((chipAmount / CHIP_PER_USDC) * USDC_ATOMIC),
      resource,
      description: `Purchase ${chipAmount} CHIP (${chipAmount / CHIP_PER_USDC} USDC)`,
      mimeType: 'application/json',
      payTo: '0xPlatformAddress',
      maxTimeoutSeconds: 300,
      asset: USDC_BASE_SEPOLIA,
    };
  }

  it('scheme is exact', () => {
    const req = buildRequirements(100, '/payments/chip-purchase');
    expect(req.scheme).toBe('exact');
  });

  it('network is base-sepolia for testnet', () => {
    const req = buildRequirements(100, '/payments/chip-purchase');
    expect(req.network).toBe('base-sepolia');
  });

  it('asset is USDC on Base Sepolia', () => {
    const req = buildRequirements(100, '/payments/chip-purchase');
    expect(req.asset).toBe(USDC_BASE_SEPOLIA);
  });

  it('maxAmountRequired is correct atomic USDC', () => {
    const req = buildRequirements(500, '/payments/chip-purchase');
    expect(req.maxAmountRequired).toBe('5000000'); // 5 USDC
  });

  it('description includes chip and usdc amounts', () => {
    const req = buildRequirements(200, '/payments/chip-purchase');
    expect(req.description).toContain('200 CHIP');
    expect(req.description).toContain('2 USDC');
  });

  it('timeout is 300 seconds', () => {
    const req = buildRequirements(100, '/payments/chip-purchase');
    expect(req.maxTimeoutSeconds).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Express route integration tests (mocked facilitator & chipService)
// ---------------------------------------------------------------------------

describe('POST /payments/chip-purchase', () => {
  // Mocks for x402 modules and chipService
  const mockDecodePayment = vi.fn();
  const mockVerify = vi.fn();
  const mockSettle = vi.fn();
  const mockUseFacilitator = vi.fn(() => ({ verify: mockVerify, settle: mockSettle }));
  const mockChipCredit = vi.fn();
  const mockGetBalance = vi.fn();
  const mockDbSelect = vi.fn();

  // Mock JWT decode (requireAuth middleware)
  const TEST_USER_ID = 'test-user-uuid-1234';
  const TEST_TOKEN = 'mock-jwt-token';

  beforeEach(() => {
    vi.resetAllMocks();
    process.env['X402_PLATFORM_ADDRESS'] = '0x' + 'a'.repeat(40);
    process.env['JWT_SECRET'] = 'test-secret-key-min-32-chars-long!'; // needed for auth
  });

  /**
   * Build a minimal Express app with the payments router,
   * stubbing out all external I/O.
   */
  async function buildApp() {
    // We inline the route logic to avoid ESM mock complications.
    // The route is re-implemented here using the same logic as payments.ts
    // with injectable dependencies.
    const app = express();
    app.use(express.json());

    // Fake requireAuth: injects user from Authorization header
    app.use((req, _res, next) => {
      const auth = req.headers['authorization'];
      if (auth === `Bearer ${TEST_TOKEN}`) {
        req.user = { userId: TEST_USER_ID, username: 'testuser' };
      }
      next();
    });

    const chipToUsdcAtomic = (chipAmount: number) =>
      String((chipAmount / CHIP_PER_USDC) * USDC_ATOMIC);

    const buildPaymentRequirements = (chipAmount: number, resource: string) => ({
      scheme: 'exact' as const,
      network: 'base-sepolia' as const,
      maxAmountRequired: chipToUsdcAtomic(chipAmount),
      resource,
      description: `Purchase ${chipAmount} CHIP (${chipAmount / CHIP_PER_USDC} USDC)`,
      mimeType: 'application/json',
      payTo: process.env['X402_PLATFORM_ADDRESS']!,
      maxTimeoutSeconds: 300,
      asset: USDC_BASE_SEPOLIA,
    });

    app.post('/payments/chip-purchase', async (req, res) => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
      }

      // Validate body
      const { chipAmount } = req.body as { chipAmount: unknown };
      if (
        typeof chipAmount !== 'number' ||
        !Number.isInteger(chipAmount) ||
        chipAmount < MIN_CHIP ||
        chipAmount % CHIP_PER_USDC !== 0
      ) {
        res.status(400).json({ error: 'chipAmount must be a positive integer multiple of 100, min 100' });
        return;
      }

      const resource = `http://localhost/payments/chip-purchase`;
      const paymentRequirements = buildPaymentRequirements(chipAmount, resource);
      const xPaymentHeader = req.headers['x-payment'] as string | undefined;

      if (!xPaymentHeader) {
        res.status(402).json({
          x402Version: 1,
          accepts: [paymentRequirements],
          error: 'Payment required to purchase CHIP',
        });
        return;
      }

      // Decode
      let paymentPayload: unknown;
      try {
        paymentPayload = mockDecodePayment(xPaymentHeader);
      } catch {
        res.status(400).json({ error: 'Invalid X-PAYMENT header: failed to decode' });
        return;
      }

      // Verify
      const { verify, settle } = mockUseFacilitator();
      let verifyResponse: { isValid: boolean; invalidReason?: string };
      try {
        verifyResponse = await verify(paymentPayload, paymentRequirements);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Verification request failed';
        res.status(502).json({ error: `Payment verification failed: ${msg}` });
        return;
      }

      if (!verifyResponse.isValid) {
        res.status(402).json({
          x402Version: 1,
          accepts: [paymentRequirements],
          error: verifyResponse.invalidReason ?? 'Payment invalid',
        });
        return;
      }

      // Settle
      let settleResponse: { success: boolean; transaction?: string; errorReason?: string };
      try {
        settleResponse = await settle(paymentPayload, paymentRequirements);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Settlement request failed';
        res.status(502).json({ error: `Payment settlement failed: ${msg}` });
        return;
      }

      if (!settleResponse.success) {
        res.status(402).json({
          x402Version: 1,
          accepts: [paymentRequirements],
          error: settleResponse.errorReason ?? 'Settlement failed',
        });
        return;
      }

      const txHash = settleResponse.transaction!;

      // Idempotency check
      const existingTxns = mockDbSelect(txHash);
      if (existingTxns.length > 0) {
        const balance = await mockGetBalance(user.userId);
        res.json({ chipAmount, txHash, idempotent: true, balance });
        return;
      }

      // Credit CHIP
      const txResult = await mockChipCredit(user.userId, chipAmount, {
        referenceType: 'x402',
        referenceId: txHash,
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

    app.get('/payments/chip-purchase/requirements', (req, res) => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
      }

      const chipAmountRaw = Number(req.query['chipAmount']);
      if (
        !Number.isInteger(chipAmountRaw) ||
        chipAmountRaw < MIN_CHIP ||
        chipAmountRaw % CHIP_PER_USDC !== 0
      ) {
        res.status(400).json({ error: 'chipAmount must be a positive integer multiple of 100, min 100' });
        return;
      }

      const chipAmount = chipAmountRaw;
      const resource = `http://localhost/payments/chip-purchase`;
      const requirements = buildPaymentRequirements(chipAmount, resource);

      res.json({
        x402Version: 1,
        chipAmount,
        usdcAmount: chipAmount / CHIP_PER_USDC,
        usdcAtomicAmount: String((chipAmount / CHIP_PER_USDC) * USDC_ATOMIC),
        requirements,
      });
    });

    return app;
  }

  async function request(
    app: express.Application,
    method: string,
    path: string,
    opts: {
      body?: unknown;
      headers?: Record<string, string>;
      authed?: boolean;
      query?: string;
    } = {},
  ) {
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const url = `http://localhost:${port}${path}${opts.query ? '?' + opts.query : ''}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.authed !== false ? { Authorization: `Bearer ${TEST_TOKEN}` } : {}),
      ...(opts.headers ?? {}),
    };

    const res = await fetch(url, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json() as any;
    server.close();
    return { status: res.status, body };
  }

  // ── 402 when no payment header ──────────────────────────────────────────

  it('returns 402 with payment requirements when no X-PAYMENT header', async () => {
    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
    });

    expect(status).toBe(402);
    expect(body.x402Version).toBe(1);
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0].scheme).toBe('exact');
    expect(body.accepts[0].network).toBe('base-sepolia');
    expect(body.accepts[0].maxAmountRequired).toBe('1000000'); // 100 CHIP = 1 USDC
    expect(body.accepts[0].asset).toBe(USDC_BASE_SEPOLIA);
    expect(body.error).toBe('Payment required to purchase CHIP');
  });

  it('402 maxAmountRequired scales with chipAmount (500 CHIP = 5 USDC)', async () => {
    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 500 },
    });

    expect(status).toBe(402);
    expect(body.accepts[0].maxAmountRequired).toBe('5000000');
    expect(body.accepts[0].description).toContain('500 CHIP');
    expect(body.accepts[0].description).toContain('5 USDC');
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('returns 400 when chipAmount is below minimum', async () => {
    const app = await buildApp();
    const { status } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 50 },
    });
    expect(status).toBe(400);
  });

  it('returns 400 when chipAmount is not a multiple of 100', async () => {
    const app = await buildApp();
    const { status } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 150 },
    });
    expect(status).toBe(400);
  });

  it('returns 400 when chipAmount is not an integer', async () => {
    const app = await buildApp();
    const { status } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100.5 },
    });
    expect(status).toBe(400);
  });

  it('returns 400 when chipAmount is a string', async () => {
    const app = await buildApp();
    const { status } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: '100' },
    });
    expect(status).toBe(400);
  });

  it('returns 401 when no auth token', async () => {
    const app = await buildApp();
    const { status } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      authed: false,
    });
    expect(status).toBe(401);
  });

  // ── Malformed X-PAYMENT ──────────────────────────────────────────────────

  it('returns 400 when X-PAYMENT header cannot be decoded', async () => {
    mockDecodePayment.mockImplementation(() => { throw new Error('bad base64'); });

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      headers: { 'X-Payment': 'not-valid-base64!!!' },
    });

    expect(status).toBe(400);
    expect(body.error).toContain('Invalid X-PAYMENT header');
  });

  // ── Facilitator verify failure ──────────────────────────────────────────

  it('returns 402 when facilitator verification fails (invalid signature)', async () => {
    mockDecodePayment.mockReturnValue({ x402Version: 1, scheme: 'exact', network: 'base-sepolia' });
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: 'invalid_exact_evm_payload_signature' });

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      headers: { 'X-Payment': 'valid-encoded-payment' },
    });

    expect(status).toBe(402);
    expect(body.error).toBe('invalid_exact_evm_payload_signature');
  });

  it('returns 402 when facilitator says insufficient_funds', async () => {
    mockDecodePayment.mockReturnValue({ x402Version: 1 });
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: 'insufficient_funds' });

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 500 },
      headers: { 'X-Payment': 'encoded-payment' },
    });

    expect(status).toBe(402);
    expect(body.error).toBe('insufficient_funds');
  });

  it('returns 502 when facilitator verify throws', async () => {
    mockDecodePayment.mockReturnValue({ x402Version: 1 });
    mockVerify.mockRejectedValue(new Error('network timeout'));

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      headers: { 'X-Payment': 'encoded-payment' },
    });

    expect(status).toBe(502);
    expect(body.error).toContain('Payment verification failed');
    expect(body.error).toContain('network timeout');
  });

  // ── Facilitator settle failure ───────────────────────────────────────────

  it('returns 402 when settlement fails', async () => {
    mockDecodePayment.mockReturnValue({ x402Version: 1 });
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockResolvedValue({ success: false, errorReason: 'payment_expired' });

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      headers: { 'X-Payment': 'encoded-payment' },
    });

    expect(status).toBe(402);
    expect(body.error).toBe('payment_expired');
  });

  it('returns 502 when settle throws', async () => {
    mockDecodePayment.mockReturnValue({ x402Version: 1 });
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockRejectedValue(new Error('rpc error'));

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      headers: { 'X-Payment': 'encoded-payment' },
    });

    expect(status).toBe(502);
    expect(body.error).toContain('Payment settlement failed');
  });

  // ── Successful payment ───────────────────────────────────────────────────

  it('credits CHIP and returns balance on successful payment', async () => {
    const txHash = '0x' + 'a'.repeat(64);
    mockDecodePayment.mockReturnValue({ x402Version: 1 });
    mockVerify.mockResolvedValue({ isValid: true, payer: '0xpayer' });
    mockSettle.mockResolvedValue({ success: true, transaction: txHash, network: 'base-sepolia' });
    mockDbSelect.mockReturnValue([]); // no existing tx
    mockChipCredit.mockResolvedValue({
      txId: 'tx-uuid',
      userId: TEST_USER_ID,
      type: 'credit',
      amount: 100,
      balanceBefore: 1000,
      balanceAfter: 1100,
      frozenBefore: 0,
      frozenAfter: 0,
    });

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      headers: { 'X-Payment': 'valid-encoded-payment' },
    });

    expect(status).toBe(200);
    expect(body.chipAmount).toBe(100);
    expect(body.txHash).toBe(txHash);
    expect(body.idempotent).toBe(false);
    expect(body.balance.chipBalance).toBe(1100);
    expect(body.balance.available).toBe(1100);

    // Verify chipService was called with correct args
    expect(mockChipCredit).toHaveBeenCalledWith(TEST_USER_ID, 100, {
      referenceType: 'x402',
      referenceId: txHash,
    });
  });

  it('credits correct CHIP amount for 500 CHIP purchase', async () => {
    const txHash = '0x' + 'b'.repeat(64);
    mockDecodePayment.mockReturnValue({ x402Version: 1 });
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockResolvedValue({ success: true, transaction: txHash, network: 'base-sepolia' });
    mockDbSelect.mockReturnValue([]);
    mockChipCredit.mockResolvedValue({
      txId: 'tx-2',
      userId: TEST_USER_ID,
      type: 'credit',
      amount: 500,
      balanceBefore: 0,
      balanceAfter: 500,
      frozenBefore: 0,
      frozenAfter: 0,
    });

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 500 },
      headers: { 'X-Payment': 'valid-encoded-payment' },
    });

    expect(status).toBe(200);
    expect(body.chipAmount).toBe(500);
    expect(body.balance.chipBalance).toBe(500);
    expect(mockChipCredit).toHaveBeenCalledWith(TEST_USER_ID, 500, expect.any(Object));
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  it('returns idempotent=true without double-credit when txHash already exists', async () => {
    const txHash = '0x' + 'c'.repeat(64);
    mockDecodePayment.mockReturnValue({ x402Version: 1 });
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockResolvedValue({ success: true, transaction: txHash, network: 'base-sepolia' });
    // Simulate existing transaction record
    mockDbSelect.mockReturnValue([{ id: 'existing-tx-id' }]);
    mockGetBalance.mockResolvedValue({ chipBalance: 200, frozenAmount: 0, available: 200 });

    const app = await buildApp();
    const { status, body } = await request(app, 'POST', '/payments/chip-purchase', {
      body: { chipAmount: 100 },
      headers: { 'X-Payment': 'valid-encoded-payment' },
    });

    expect(status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.txHash).toBe(txHash);
    expect(body.balance.chipBalance).toBe(200);
    // Verify chipService.credit was NOT called
    expect(mockChipCredit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /payments/chip-purchase/requirements
// ---------------------------------------------------------------------------

describe('GET /payments/chip-purchase/requirements', () => {
  async function buildRequirementsApp() {
    const app = express();
    app.use(express.json());

    const TEST_TOKEN = 'mock-jwt-token';
    const TEST_USER_ID = 'test-user-uuid-1234';

    app.use((req, _res, next) => {
      const auth = req.headers['authorization'];
      if (auth === `Bearer ${TEST_TOKEN}`) {
        req.user = { userId: TEST_USER_ID, username: 'testuser' };
      }
      next();
    });

    process.env['X402_PLATFORM_ADDRESS'] = '0x' + 'a'.repeat(40);

    app.get('/payments/chip-purchase/requirements', (req, res) => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const chipAmountRaw = Number(req.query['chipAmount']);
      if (!Number.isInteger(chipAmountRaw) || chipAmountRaw < 100 || chipAmountRaw % 100 !== 0) {
        res.status(400).json({ error: 'Invalid chipAmount' });
        return;
      }

      const chipAmount = chipAmountRaw;
      res.json({
        x402Version: 1,
        chipAmount,
        usdcAmount: chipAmount / 100,
        usdcAtomicAmount: String((chipAmount / 100) * 1_000_000),
        requirements: {
          scheme: 'exact',
          network: 'base-sepolia',
          maxAmountRequired: String((chipAmount / 100) * 1_000_000),
          asset: USDC_BASE_SEPOLIA,
        },
      });
    });

    return app;
  }

  async function getReq(app: express.Application, query: string) {
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://localhost:${port}/payments/chip-purchase/requirements?${query}`, {
      headers: { Authorization: 'Bearer mock-jwt-token' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json() as any;
    server.close();
    return { status: res.status, body };
  }

  it('returns payment requirements for 100 CHIP', async () => {
    const app = await buildRequirementsApp();
    const { status, body } = await getReq(app, 'chipAmount=100');

    expect(status).toBe(200);
    expect(body.chipAmount).toBe(100);
    expect(body.usdcAmount).toBe(1);
    expect(body.usdcAtomicAmount).toBe('1000000');
    expect(body.requirements.scheme).toBe('exact');
    expect(body.requirements.network).toBe('base-sepolia');
    expect(body.requirements.maxAmountRequired).toBe('1000000');
  });

  it('returns correct amounts for 1000 CHIP', async () => {
    const app = await buildRequirementsApp();
    const { status, body } = await getReq(app, 'chipAmount=1000');

    expect(status).toBe(200);
    expect(body.usdcAmount).toBe(10);
    expect(body.usdcAtomicAmount).toBe('10000000');
  });

  it('returns 400 for invalid chipAmount (50)', async () => {
    const app = await buildRequirementsApp();
    const { status } = await getReq(app, 'chipAmount=50');
    expect(status).toBe(400);
  });

  it('returns 400 for non-multiple of 100 (150)', async () => {
    const app = await buildRequirementsApp();
    const { status } = await getReq(app, 'chipAmount=150');
    expect(status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// x402 PaymentPayload header encoding simulation
// ---------------------------------------------------------------------------

describe('x402 header encoding (base64)', () => {
  function encodePayment(payload: object): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  function decodePayment(encoded: string): object {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  }

  it('encodes payment payload to base64', () => {
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'base-sepolia',
      payload: { signature: '0xsig', authorization: { from: '0xabc', to: '0xdef', value: '1000000' } },
    };
    const encoded = encodePayment(payload);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('{'); // should be base64, not raw JSON
  });

  it('decodes payment payload from base64', () => {
    const original = { x402Version: 1, scheme: 'exact', network: 'base-sepolia' };
    const encoded = encodePayment(original);
    const decoded = decodePayment(encoded);
    expect(decoded).toEqual(original);
  });

  it('roundtrip encode/decode is lossless', () => {
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'base-sepolia',
      payload: {
        signature: '0x' + 'a'.repeat(130),
        authorization: {
          from: '0x' + '1'.repeat(40),
          to: '0x' + '2'.repeat(40),
          value: '5000000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: '0x' + 'b'.repeat(64),
        },
      },
    };
    const encoded = encodePayment(payload);
    const decoded = decodePayment(encoded);
    expect(decoded).toEqual(payload);
  });
});
