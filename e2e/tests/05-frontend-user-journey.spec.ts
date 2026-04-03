import { test, expect, type Page } from '@playwright/test';

const WEB_URL = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';
const API_ORIGIN = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

const mockUser = {
  id: 'user-test-123',
  username: 'testplayer',
  email: 'test@agon.arena',
  walletAddress: '0xAbCd1234567890abcdef1234567890abcdef1234',
  chipBalance: 2500,
  createdAt: '2026-01-15T00:00:00Z',
};

const mockArena = {
  id: 'arena-alpha',
  name: 'Alpha Table',
  gameType: 'texas_holdem',
  mode: 'practice',
  status: 'running',
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  spectatorCount: 8,
  seats: [
    {
      seatIndex: 0,
      agentId: 'agent-alpha',
      agentName: 'Alpha',
      currentStack: 1400,
      eloRating: 1420,
      isActive: true,
    },
    {
      seatIndex: 1,
      agentId: 'agent-beta',
      agentName: 'Beta',
      currentStack: 600,
      eloRating: 1310,
      isActive: true,
    },
  ],
};

const mockArenaList = {
  arenas: [
    {
      id: mockArena.id,
      name: mockArena.name,
      gameType: mockArena.gameType,
      mode: mockArena.mode,
      status: mockArena.status,
      playerCount: 2,
      maxPlayers: 6,
      smallBlind: mockArena.smallBlind,
      bigBlind: mockArena.bigBlind,
      startingStack: mockArena.startingStack,
      spectatorCount: mockArena.spectatorCount,
      createdAt: '2026-03-12T00:00:00Z',
    },
  ],
};

async function mockAuthMe(page: Page) {
  await page.route(`${API_ORIGIN}/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUser),
    });
  });
}

async function mockDashboardData(page: Page) {
  await mockAuthMe(page);
  await page.route(`${API_ORIGIN}/agents**`, async (route) => {
    const url = route.request().url();
    const body = url.includes('/matches')
      ? { matches: [] }
      : { agents: [] };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function seedSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'mock-access-token-for-e2e');
    localStorage.setItem('agon_token', 'mock-access-token-for-e2e');
    localStorage.setItem('refreshToken', 'mock-refresh-token-for-e2e');
  });
}

test.describe('Frontend User Journey', () => {
  test('login shows the current welcome copy and sign-in modes', async ({ page }) => {
    await page.goto(`${WEB_URL}/login`);

    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wallet (SIWE)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email / Password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });

  test('register page redirects to the register mode on /login', async ({ page }) => {
    await page.goto(`${WEB_URL}/register`);
    await expect(page).toHaveURL(/\/login\?mode=register/);
    await expect(page.getByText('Create your account')).toBeVisible();
  });

  test('register persists the returned session before redirecting to the dashboard', async ({
    page,
  }) => {
    await page.route(`${API_ORIGIN}/auth/register`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token',
          user: { id: mockUser.id, username: mockUser.username },
        }),
      });
    });
    await mockDashboardData(page);

    await page.goto(`${WEB_URL}/login?mode=register`);
    await page.getByPlaceholder('coolagent').fill('register_user');
    await page.getByPlaceholder('you@example.com').fill('register_user@example.com');
    await page.getByPlaceholder('••••••••').fill('secret123');
    await page.locator('form').first().getByRole('button', { name: 'Create Account' }).click();

    await page.waitForURL(/\/dashboard/);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Owner ledger' })).toBeVisible();
    await expect(page.getByText('Connect the owner workspace')).toHaveCount(0);
  });

  test('dashboard shows the connect form when unauthenticated', async ({ page }) => {
    await page.goto(`${WEB_URL}/dashboard`);

    await expect(page.getByText('Connect the owner workspace')).toBeVisible();
    await expect(page.getByPlaceholder('eyJ...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Workspace' })).toBeVisible();
  });

  test('dashboard shows the owner workspace when authenticated', async ({ page }) => {
    await seedSession(page);
    await mockDashboardData(page);

    await page.goto(`${WEB_URL}/dashboard`);

    await expect(page.getByRole('heading', { name: 'Owner ledger' })).toBeVisible();
    await expect(page.getByText(/2,500 CHIP/).first()).toBeVisible();
    await expect(page.getByText('Connect the owner workspace')).toHaveCount(0);
  });

  test('markets shows the current public market list', async ({ page }) => {
    await page.goto(`${WEB_URL}/markets`);

    await expect(page.getByRole('heading', { name: 'Markets' })).toBeVisible();
    await expect(page.getByText('AI agents competing in real-time arenas')).toBeVisible();
  });

  test('market detail consumes the backend odds contract without NaN multipliers', async ({
    page,
  }) => {
    await page.route(`${API_ORIGIN}/arenas/${mockArena.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockArena),
      });
    });
    await page.route(`${API_ORIGIN}/arenas/${mockArena.id}/snapshot`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ snapshot: null, arenaStatus: 'running' }),
      });
    });
    await page.route(`${API_ORIGIN}/arenas/${mockArena.id}/odds`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          arenaId: mockArena.id,
          totalPool: 100,
          odds: [
            { agentId: 'agent-alpha', agentName: 'Alpha', odds: 0.75, totalBetOnAgent: 75 },
            { agentId: 'agent-beta', agentName: 'Beta', odds: 0.25, totalBetOnAgent: 25 },
          ],
        }),
      });
    });

    await page.goto(`${WEB_URL}/markets/${mockArena.id}`);

    await expect(page.getByRole('link', { name: '← Markets' })).toBeVisible();
    await expect(page.getByText('Alpha Table')).toBeVisible();
    await expect(page.getByText('PLACE A BET')).toBeVisible();
    await expect(page.getByText('1.3×')).toBeVisible();
    await expect(page.getByText('4.0×')).toBeVisible();
    await expect(page.getByText('NaN×')).toHaveCount(0);
    await expect(page.getByText('Could not load arena')).toHaveCount(0);
  });

  test('settings redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto(`${WEB_URL}/settings`);
    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('settings shows the current profile and agent draft form when authenticated', async ({
    page,
  }) => {
    await seedSession(page);
    await mockAuthMe(page);

    await page.goto(`${WEB_URL}/settings`);

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Owner identity')).toBeVisible();
    await expect(page.getByText('Create an agent profile without runtime networking')).toBeVisible();
    await expect(page.getByPlaceholder('My Strategy Agent')).toBeVisible();
    await expect(
      page.getByPlaceholder('An autonomous agent tuned for repeated strategic decision-making...'),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder('decision-making, execution, risk-management'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Profile' })).toBeVisible();
  });
});
