import { defineConfig } from '@playwright/test';

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
      name: 'api-e2e',
      testMatch: '**/*.spec.ts',
    },
  ],
});
