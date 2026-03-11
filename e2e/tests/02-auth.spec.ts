import { test, expect } from '@playwright/test';
import { uniqueUser, registerUser, generateEthAccount, buildSiweMessage } from './helpers.js';

test.describe('Authentication', () => {
  const user = uniqueUser();
  let token: string;

  test('POST /auth/register creates user and returns JWT', async ({ request }) => {
    const res = await request.post('/auth/register', { data: user });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(user.username);
    token = body.token;
  });

  test('POST /auth/register rejects duplicate email', async ({ request }) => {
    const res = await request.post('/auth/register', { data: user });
    expect(res.status()).toBe(409);
  });

  test('POST /auth/register rejects invalid data', async ({ request }) => {
    const res = await request.post('/auth/register', {
      data: { username: 'ab', email: 'bad', password: '12' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /auth/login with valid credentials', async ({ request }) => {
    const res = await request.post('/auth/login', {
      data: { email: user.email, password: user.password },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(user.username);
  });

  test('POST /auth/login with wrong password returns 401', async ({ request }) => {
    const res = await request.post('/auth/login', {
      data: { email: user.email, password: 'WrongPass' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /auth/me with valid token', async ({ request }) => {
    const res = await request.get('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.username).toBe(user.username);
    expect(body.email).toBe(user.email);
    expect(body.chipBalance).toBeDefined();
  });

  test('GET /auth/me without token returns 401', async ({ request }) => {
    const res = await request.get('/auth/me');
    expect(res.status()).toBe(401);
  });

  test('GET /auth/public-key returns Ed25519 key info', async ({ request }) => {
    const res = await request.get('/auth/public-key');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.algorithm).toBe('Ed25519');
    expect(body.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// JWT Token Lifecycle (refresh + revoke)
// ---------------------------------------------------------------------------

test.describe('JWT Token Lifecycle', () => {
  let accessToken: string;
  let refreshToken: string;

  test.beforeAll(async ({ request }) => {
    const { token: t } = await registerUser(request);
    // registerUser calls /auth/register which returns token+refreshToken
    const res = await request.post('/auth/register', { data: uniqueUser() });
    const body = await res.json();
    accessToken = body.token;
    refreshToken = body.refreshToken;
  });

  test('POST /auth/token/refresh exchanges refreshToken for new pair', async ({ request }) => {
    const res = await request.post('/auth/token/refresh', {
      data: { refreshToken },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    // New tokens are different from old (rotation)
    expect(body.refreshToken).not.toBe(refreshToken);
    // Update for subsequent tests
    accessToken = body.token;
    refreshToken = body.refreshToken;
  });

  test('POST /auth/token/refresh rejects already-consumed refreshToken', async ({ request }) => {
    // The old refreshToken was consumed in the previous test
    const oldRefreshToken = refreshToken;
    // Rotate once more so we have a fresh pair
    const rotateRes = await request.post('/auth/token/refresh', {
      data: { refreshToken: oldRefreshToken },
    });
    expect(rotateRes.status()).toBe(200);
    const newBody = await rotateRes.json();

    // Now try to reuse the old one — should fail
    const res = await request.post('/auth/token/refresh', {
      data: { refreshToken: oldRefreshToken },
    });
    expect(res.status()).toBe(401);

    // Update state
    accessToken = newBody.token;
    refreshToken = newBody.refreshToken;
  });

  test('POST /auth/token/refresh rejects completely invalid token', async ({ request }) => {
    const res = await request.post('/auth/token/refresh', {
      data: { refreshToken: 'not-a-valid-token-at-all' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /auth/token/revoke blacklists access token (logout)', async ({ request }) => {
    // Revoke the current access token
    const revokeRes = await request.post('/auth/token/revoke', {
      data: { token: accessToken },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(revokeRes.status()).toBe(200);
    const revokeBody = await revokeRes.json();
    expect(revokeBody.revoked).toBe(true);

    // Revoked token should no longer access protected endpoints
    const meRes = await request.get('/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(meRes.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SIWE Authentication (Sign-In with Ethereum)
// ---------------------------------------------------------------------------

test.describe('SIWE Authentication', () => {
  test('GET /auth/siwe/nonce returns a unique hex nonce', async ({ request }) => {
    const res = await request.get('/auth/siwe/nonce');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.nonce).toMatch(/^[0-9a-f]{32}$/);

    // Two consecutive nonces must differ
    const res2 = await request.get('/auth/siwe/nonce');
    const body2 = await res2.json();
    expect(body2.nonce).not.toBe(body.nonce);
  });

  test('POST /auth/siwe/verify accepts a valid SIWE signature → issues JWT', async ({ request }) => {
    // 1. Get a fresh nonce
    const nonceRes = await request.get('/auth/siwe/nonce');
    const { nonce } = await nonceRes.json();

    // 2. Generate an Ethereum account and sign the SIWE message
    const { account } = generateEthAccount();
    const message = buildSiweMessage({ address: account.address, nonce });
    const signature = await account.signMessage({ message });

    // 3. Verify
    const res = await request.post('/auth/siwe/verify', {
      data: { message, signature },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.walletAddress).toBe(account.address.toLowerCase());
  });

  test('POST /auth/siwe/verify rejects nonce reuse', async ({ request }) => {
    const nonceRes = await request.get('/auth/siwe/nonce');
    const { nonce } = await nonceRes.json();

    const { account } = generateEthAccount();
    const message = buildSiweMessage({ address: account.address, nonce });
    const signature = await account.signMessage({ message });

    // First call succeeds
    const first = await request.post('/auth/siwe/verify', { data: { message, signature } });
    expect(first.status()).toBe(200);

    // Second call with same nonce fails (single-use)
    const second = await request.post('/auth/siwe/verify', { data: { message, signature } });
    expect(second.status()).toBe(401);
  });

  test('POST /auth/siwe/verify rejects wrong domain', async ({ request }) => {
    const nonceRes = await request.get('/auth/siwe/nonce');
    const { nonce } = await nonceRes.json();

    const { account } = generateEthAccount();
    const message = buildSiweMessage({
      address: account.address,
      nonce,
      domain: 'evil.example.com',
    });
    const signature = await account.signMessage({ message });

    const res = await request.post('/auth/siwe/verify', { data: { message, signature } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('domain');
  });

  test('POST /auth/siwe/verify rejects wrong chainId', async ({ request }) => {
    const nonceRes = await request.get('/auth/siwe/nonce');
    const { nonce } = await nonceRes.json();

    const { account } = generateEthAccount();
    const message = buildSiweMessage({
      address: account.address,
      nonce,
      chainId: 1, // Ethereum mainnet — not Base Sepolia
    });
    const signature = await account.signMessage({ message });

    const res = await request.post('/auth/siwe/verify', { data: { message, signature } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('chain');
  });

  test('POST /auth/siwe/verify rejects malformed message', async ({ request }) => {
    const res = await request.post('/auth/siwe/verify', {
      data: { message: 'not a valid siwe message', signature: '0x' + 'a'.repeat(130) },
    });
    // 400 (parse error) or 500 (unexpected error) — must not be 200
    expect(res.status()).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Agent Auto-Registration (EIP-191 personal_sign)
// ---------------------------------------------------------------------------

test.describe('Agent Auto-Registration', () => {
  const agentCard = {
    name: 'E2E Bot',
    description: 'Auto-registration E2E test agent',
    apiUrl: 'https://example.com/e2e-hook',
    version: '1.0',
    capabilities: ['texas-holdem'],
  };

  test('GET /auth/agent/nonce returns a unique hex nonce', async ({ request }) => {
    const res = await request.get('/auth/agent/nonce');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  test('POST /auth/agent/register creates user+agent with valid EIP-191 signature', async ({ request }) => {
    const nonceRes = await request.get('/auth/agent/nonce');
    const { nonce } = await nonceRes.json();

    const { account } = generateEthAccount();
    const message = `Register Agon Agent\nNonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    const res = await request.post('/auth/agent/register', {
      data: {
        walletAddress: account.address,
        nonce,
        signature,
        agentCard,
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.walletAddress).toBe(account.address.toLowerCase());
    expect(body.agent.name).toBe(agentCard.name);
  });

  test('POST /auth/agent/register is idempotent (same wallet → returns existing agent)', async ({ request }) => {
    const { account } = generateEthAccount();

    // First registration
    const nonce1Res = await request.get('/auth/agent/nonce');
    const { nonce: nonce1 } = await nonce1Res.json();
    const sig1 = await account.signMessage({ message: `Register Agon Agent\nNonce: ${nonce1}` });

    const first = await request.post('/auth/agent/register', {
      data: { walletAddress: account.address, nonce: nonce1, signature: sig1, agentCard },
    });
    expect(first.status()).toBe(201);
    const firstBody = await first.json();

    // Second registration with same wallet (different nonce)
    const nonce2Res = await request.get('/auth/agent/nonce');
    const { nonce: nonce2 } = await nonce2Res.json();
    const sig2 = await account.signMessage({ message: `Register Agon Agent\nNonce: ${nonce2}` });

    const second = await request.post('/auth/agent/register', {
      data: { walletAddress: account.address, nonce: nonce2, signature: sig2, agentCard },
    });
    expect(second.status()).toBe(201);
    const secondBody = await second.json();

    // Same agent returned
    expect(secondBody.agent.id).toBe(firstBody.agent.id);
  });

  test('POST /auth/agent/register rejects nonce reuse', async ({ request }) => {
    const nonceRes = await request.get('/auth/agent/nonce');
    const { nonce } = await nonceRes.json();

    const { account } = generateEthAccount();
    const signature = await account.signMessage({ message: `Register Agon Agent\nNonce: ${nonce}` });

    // First call succeeds
    const first = await request.post('/auth/agent/register', {
      data: { walletAddress: account.address, nonce, signature, agentCard },
    });
    expect(first.status()).toBe(201);

    // Second call with same nonce fails
    const second = await request.post('/auth/agent/register', {
      data: { walletAddress: account.address, nonce, signature, agentCard },
    });
    expect(second.status()).toBe(401);
  });

  test('POST /auth/agent/register rejects invalid signature', async ({ request }) => {
    const nonceRes = await request.get('/auth/agent/nonce');
    const { nonce } = await nonceRes.json();

    const { account } = generateEthAccount();
    // Sign with a different account than walletAddress
    const { account: wrongAccount } = generateEthAccount();
    const signature = await wrongAccount.signMessage({ message: `Register Agon Agent\nNonce: ${nonce}` });

    const res = await request.post('/auth/agent/register', {
      data: { walletAddress: account.address, nonce, signature, agentCard },
    });
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// OAuth Providers (GitHub, Google) — structural tests
// ---------------------------------------------------------------------------

test.describe('OAuth Providers', () => {
  test('GET /auth/github/exchange rejects missing code', async ({ request }) => {
    const res = await request.get('/auth/github/exchange');
    expect(res.status()).toBe(400);
  });

  test('GET /auth/github/exchange rejects invalid exchange code', async ({ request }) => {
    const res = await request.get('/auth/github/exchange?code=definitely-not-valid-uuid');
    expect(res.status()).toBe(401);
  });

  test('GET /auth/google/exchange rejects missing code', async ({ request }) => {
    const res = await request.get('/auth/google/exchange');
    expect(res.status()).toBe(400);
  });

  test('GET /auth/google/exchange rejects invalid exchange code', async ({ request }) => {
    const res = await request.get('/auth/google/exchange?code=definitely-not-valid-uuid');
    expect(res.status()).toBe(401);
  });

  test('GET /auth/github initiates OAuth (responds, not 404)', async ({ request }) => {
    // When GITHUB_CLIENT_ID is set: 302 redirect to GitHub
    // When not set: 500 (missing env var) — either is acceptable, never 404
    const res = await request.get('/auth/github', { maxRedirects: 0 });
    expect(res.status()).not.toBe(404);
  });

  test('GET /auth/google initiates OAuth (responds, not 404)', async ({ request }) => {
    const res = await request.get('/auth/google', { maxRedirects: 0 });
    expect(res.status()).not.toBe(404);
  });
});
