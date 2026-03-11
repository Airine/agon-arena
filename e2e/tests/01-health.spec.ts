import { test, expect } from '@playwright/test';

test.describe('Health Check', () => {
  test('GET /health returns ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });
});
