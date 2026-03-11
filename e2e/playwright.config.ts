import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  workers: 1, // Sequential — tests share DB state

  use: {
    baseURL: process.env['API_BASE_URL'] ?? 'http://localhost:4000',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  reporter: [['list'], ['html', { open: 'never' }]],

  projects: [
    {
      // API integration tests — use Playwright request fixture (no browser)
      name: 'api-e2e',
      testMatch: /0[1-467]-.*\.spec\.ts$/,
    },
    {
      // Frontend browser tests — complete user journey through the Next.js UI
      name: 'frontend-e2e',
      testMatch: '**/05-frontend-user-journey.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env['WEB_BASE_URL'] ?? 'http://localhost:3000',
        // Reset extraHTTPHeaders — frontend tests use page.route() for mocking
        extraHTTPHeaders: {},
      },
    },
  ],
});
