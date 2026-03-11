/**
 * AGO-90: Frontend E2E — Complete User Journey
 *
 * Tests the full user journey through the Agon Arena frontend:
 *  - Login page (SIWE + email tabs)
 *  - Register page (form fields + invite code)
 *  - Dashboard (connect form + CHIP wallet with mocked auth)
 *  - Arena Lobby (filter buttons + arena cards with mocked API)
 *  - Arena Spectator (connection status + layout)
 *  - Settings page (auth redirect + profile + agent registration form)
 *
 * API calls are intercepted via page.route() so tests run without a backend.
 * WebSocket connections are not established (no WS server), so arena viewer
 * shows "Disconnected" — this is the expected UI state for that scenario.
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEB_URL = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';
const API_ORIGIN = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockUser = {
  id: 'user-test-123',
  username: 'testplayer',
  email: 'test@agon.arena',
  walletAddress: '0xAbCd1234567890abcdef1234567890abcdef1234',
  chipBalance: 2500,
  createdAt: '2026-01-15T00:00:00Z',
};

const mockArenas = [
  {
    id: 'arena-alpha',
    name: 'Alpha Table',
    gameType: 'texas_holdem',
    status: 'running',
    playerCount: 4,
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    spectatorCount: 8,
    createdAt: '2026-03-12T00:00:00Z',
  },
  {
    id: 'arena-beta',
    name: 'Beta Table',
    gameType: 'texas_holdem',
    status: 'waiting',
    playerCount: 2,
    maxPlayers: 6,
    smallBlind: 5,
    bigBlind: 10,
    startingStack: 500,
    spectatorCount: 1,
    createdAt: '2026-03-12T01:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock the /api/auth/me endpoint (used by lib/api.ts) */
async function mockAuthMe(page: Page) {
  await page.route(`${API_ORIGIN}/api/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUser),
    });
  });
}

/** Mock the /auth/me endpoint (used directly by dashboard page) */
async function mockDashboardAuthMe(page: Page) {
  await page.route(`${API_ORIGIN}/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUser),
    });
  });
}

/** Mock the /agents endpoint (used by dashboard page) */
async function mockAgents(page: Page) {
  await page.route(`${API_ORIGIN}/agents**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ agents: [] }),
    });
  });
}

/** Set the accessToken in localStorage so isLoggedIn() returns true */
async function setAuthToken(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'mock-access-token-for-e2e');
  });
}

/** Set the dashboard token in localStorage (separate from auth system) */
async function setDashboardToken(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('agon_token', 'mock-dashboard-token-for-e2e');
  });
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

test.describe('Login Page', () => {
  test('shows Sign In heading with welcome text', async ({ page }) => {
    await page.goto(`${WEB_URL}/login`);

    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByText('Welcome back to Agon Arena')).toBeVisible();
  });

  test('shows Wallet (SIWE) and Email / Password tabs', async ({ page }) => {
    await page.goto(`${WEB_URL}/login`);

    await expect(page.getByRole('button', { name: 'Wallet (SIWE)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email / Password' })).toBeVisible();
  });

  test('SIWE tab is active by default and shows Connect Wallet button', async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/login`);

    await expect(
      page.getByRole('button', { name: 'Connect Wallet & Sign In' }),
    ).toBeVisible();
  });

  test('switching to Email tab shows email, password inputs and Sign In button', async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/login`);

    await page.getByRole('button', { name: 'Email / Password' }).click();

    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('Email tab shows link to Register page', async ({ page }) => {
    await page.goto(`${WEB_URL}/login`);

    await page.getByRole('button', { name: 'Email / Password' }).click();
    await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('Register Page', () => {
  test('shows Create Account heading with CHIP bonus text', async ({ page }) => {
    await page.goto(`${WEB_URL}/register`);

    await expect(
      page.getByRole('heading', { name: 'Create Account' }),
    ).toBeVisible();
    await expect(page.getByText(/Join Agon Arena/)).toBeVisible();
    await expect(page.getByText(/1,000 CHIP/)).toBeVisible();
  });

  test('shows username, email, password and invite code fields', async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/register`);

    await expect(page.getByPlaceholder('coolagent')).toBeVisible();
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByPlaceholder('AGON-XXXX-XXXX')).toBeVisible();
  });

  test('shows Create Account submit button', async ({ page }) => {
    await page.goto(`${WEB_URL}/register`);

    await expect(
      page.getByRole('button', { name: 'Create Account' }),
    ).toBeVisible();
  });

  test('shows link back to Sign In page', async ({ page }) => {
    await page.goto(`${WEB_URL}/register`);

    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('Owner Dashboard', () => {
  test('shows Owner Dashboard heading', async ({ page }) => {
    await page.goto(`${WEB_URL}/dashboard`);

    await expect(
      page.getByRole('heading', { name: 'Owner Dashboard' }),
    ).toBeVisible();
  });

  test('shows token connect form when unauthenticated', async ({ page }) => {
    await page.goto(`${WEB_URL}/dashboard`);

    await expect(page.getByText('Connect to Dashboard')).toBeVisible();
    await expect(page.getByPlaceholder('eyJ...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
  });

  test('shows CHIP wallet section with balance when authenticated', async ({
    page,
  }) => {
    await mockDashboardAuthMe(page);
    await mockAgents(page);
    await setDashboardToken(page);

    await page.goto(`${WEB_URL}/dashboard`);

    await expect(page.getByText('CHIP Wallet')).toBeVisible();
    await expect(page.getByText('Total Balance')).toBeVisible();
    // chipBalance = 2500
    await expect(page.getByText(/2,500 CHIP/)).toBeVisible();
  });

  test('shows user username in dashboard header when authenticated', async ({
    page,
  }) => {
    await mockDashboardAuthMe(page);
    await mockAgents(page);
    await setDashboardToken(page);

    await page.goto(`${WEB_URL}/dashboard`);

    await expect(page.getByText(mockUser.username)).toBeVisible();
  });

  test('shows My Agents section when authenticated', async ({ page }) => {
    await mockDashboardAuthMe(page);
    await mockAgents(page);
    await setDashboardToken(page);

    await page.goto(`${WEB_URL}/dashboard`);

    await expect(page.getByText(/My Agents/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('Arena Lobby', () => {
  test('shows Arena Lobby heading and subtitle', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ arenas: mockArenas }),
      });
    });

    await page.goto(`${WEB_URL}/arenas`);

    await expect(
      page.getByRole('heading', { name: 'Arena Lobby' }),
    ).toBeVisible();
    await expect(
      page.getByText(/Watch AI agents battle in real-time/),
    ).toBeVisible();
  });

  test('shows All, Live, and Waiting filter buttons', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ arenas: mockArenas }),
      });
    });

    await page.goto(`${WEB_URL}/arenas`);

    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Live' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Waiting' })).toBeVisible();
  });

  test('displays arena cards with name and status badges', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ arenas: mockArenas }),
      });
    });

    await page.goto(`${WEB_URL}/arenas`);

    await expect(page.getByText('Alpha Table')).toBeVisible();
    await expect(page.getByText('LIVE')).toBeVisible();
    await expect(page.getByText('Beta Table')).toBeVisible();
    await expect(page.getByText('WAITING')).toBeVisible();
  });

  test('shows Watch Live link for running arenas', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ arenas: mockArenas }),
      });
    });

    await page.goto(`${WEB_URL}/arenas`);

    await expect(page.getByRole('link', { name: 'Watch Live →' })).toBeVisible();
  });

  test('shows empty state when no arenas returned', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ arenas: [] }),
      });
    });

    await page.goto(`${WEB_URL}/arenas`);

    await expect(page.getByText('No arenas found. Check back soon.')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('Arena Spectator', () => {
  const ARENA_ID = 'test-arena-e2e';

  test('shows back navigation to Lobby', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas/${ARENA_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ARENA_ID,
          name: 'E2E Test Arena',
          status: 'running',
          spectatorCount: 3,
          smallBlind: 25,
          bigBlind: 50,
          seats: [],
        }),
      });
    });

    await page.goto(`${WEB_URL}/arenas/${ARENA_ID}`);

    await expect(page.getByRole('link', { name: '← Lobby' })).toBeVisible();
  });

  test('shows arena name from API response', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas/${ARENA_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ARENA_ID,
          name: 'E2E Test Arena',
          status: 'running',
          spectatorCount: 3,
          smallBlind: 25,
          bigBlind: 50,
          seats: [],
        }),
      });
    });

    await page.goto(`${WEB_URL}/arenas/${ARENA_ID}`);

    await expect(page.getByText('E2E Test Arena')).toBeVisible();
  });

  test('shows blind info in header', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas/${ARENA_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ARENA_ID,
          name: 'Blinds Arena',
          status: 'running',
          spectatorCount: 1,
          smallBlind: 25,
          bigBlind: 50,
          seats: [],
        }),
      });
    });

    await page.goto(`${WEB_URL}/arenas/${ARENA_ID}`);

    await expect(page.getByText('Blinds: $25/$50')).toBeVisible();
  });

  test('shows connection status indicator (Live or Disconnected)', async ({
    page,
  }) => {
    await page.route(`${API_ORIGIN}/arenas/${ARENA_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ARENA_ID,
          name: 'Connection Test Arena',
          status: 'running',
          spectatorCount: 0,
          smallBlind: 10,
          bigBlind: 20,
          seats: [],
        }),
      });
    });

    await page.goto(`${WEB_URL}/arenas/${ARENA_ID}`);

    // Without a running WS server the status will be Disconnected
    await expect(page.getByText(/Live|Disconnected/)).toBeVisible();
  });

  test('shows Chip Equity section', async ({ page }) => {
    await page.route(`${API_ORIGIN}/arenas/${ARENA_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ARENA_ID,
          name: 'Chip Arena',
          status: 'running',
          spectatorCount: 0,
          smallBlind: 10,
          bigBlind: 20,
          seats: [],
        }),
      });
    });

    await page.goto(`${WEB_URL}/arenas/${ARENA_ID}`);

    await expect(page.getByText('Chip Equity')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('Settings Page', () => {
  test('redirects to /login when not authenticated', async ({ page }) => {
    // No accessToken in localStorage
    await page.goto(`${WEB_URL}/settings`);

    // Page should navigate to /login
    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows Settings heading and Profile section when authenticated', async ({
    page,
  }) => {
    await mockAuthMe(page);
    await setAuthToken(page);

    await page.goto(`${WEB_URL}/settings`);

    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeVisible();
    await expect(page.getByText('Profile')).toBeVisible();
  });

  test('shows user data in profile table when authenticated', async ({
    page,
  }) => {
    await mockAuthMe(page);
    await setAuthToken(page);

    await page.goto(`${WEB_URL}/settings`);

    await expect(page.getByText(mockUser.username)).toBeVisible();
    await expect(page.getByText(/CHIP Balance/)).toBeVisible();
  });

  test('shows agent registration panel with form fields', async ({ page }) => {
    await mockAuthMe(page);
    await setAuthToken(page);

    await page.goto(`${WEB_URL}/settings`);

    await expect(page.getByText('Register an Agent')).toBeVisible();
    await expect(page.getByPlaceholder('My Poker Bot')).toBeVisible();
    await expect(
      page.getByPlaceholder('https://your-agent.example.com'),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder('gto, bluff-detection, hand-reading'),
    ).toBeVisible();
  });

  test('shows Register Agent submit button', async ({ page }) => {
    await mockAuthMe(page);
    await setAuthToken(page);

    await page.goto(`${WEB_URL}/settings`);

    await expect(
      page.getByRole('button', { name: 'Register Agent (Sign with Wallet)' }),
    ).toBeVisible();
  });

  test('shows Back to Dashboard link', async ({ page }) => {
    await mockAuthMe(page);
    await setAuthToken(page);

    await page.goto(`${WEB_URL}/settings`);

    await expect(
      page.getByRole('link', { name: '← Back to Dashboard' }),
    ).toBeVisible();
  });

  test('shows Logout button', async ({ page }) => {
    await mockAuthMe(page);
    await setAuthToken(page);

    await page.goto(`${WEB_URL}/settings`);

    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  });
});
