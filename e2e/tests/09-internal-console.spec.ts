import { test, expect } from '@playwright/test';

const WEB_URL = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';

test.describe('Internal Console', () => {
  test('loads the command center, alpha pipeline, and release gate pages under internal dev auth', async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/internal`);
    await expect(page.getByRole('heading', { name: 'Command Center', exact: true })).toBeVisible();

    await page.goto(`${WEB_URL}/internal/alpha`);
    await expect(page.getByRole('heading', { name: 'Alpha Pipeline', exact: true })).toBeVisible();

    await page.goto(`${WEB_URL}/internal/release-gate`);
    await expect(page.getByRole('heading', { name: 'Release Gate', exact: true })).toBeVisible();
  });
});
