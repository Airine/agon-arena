import { test, expect } from '@playwright/test';
import { uniqueUser } from './helpers.js';

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
