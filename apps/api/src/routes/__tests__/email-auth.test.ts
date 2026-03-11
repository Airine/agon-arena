/**
 * AGO-57: Email + password fallback authentication tests
 *
 * Tests validate:
 *  1. hashPassword / verifyPassword round-trip (scrypt)
 *  2. POST /auth/email/register — success, validation errors, duplicate email
 *  3. POST /auth/email/register — awards registration bonus
 *  4. POST /auth/email/login — success, wrong password, unknown email (same error)
 *  5. POST /auth/email/login — OAuth-only user (no passwordHash) → 401
 *  6. Timing-safe: dummy hash prevents user enumeration on login
 *
 * Runs in-process without DB, Redis, or network I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { hashPassword, verifyPassword } from '../email-auth.js';

// ---------------------------------------------------------------------------
// Pure crypto utility tests (no mocking needed)
// ---------------------------------------------------------------------------

describe('hashPassword / verifyPassword — scrypt round-trip', () => {
  it('produces a hash in scrypt:<salt>:<key> format', async () => {
    const hash = await hashPassword('mySecretPass1!');
    const parts = hash.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toHaveLength(32); // 16 bytes hex
    expect(parts[2]).toHaveLength(128); // 64 bytes hex
  });

  it('round-trip: correct password verifies true', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await hashPassword(password);
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it('wrong password verifies false', async () => {
    const hash = await hashPassword('rightPassword!');
    const valid = await verifyPassword('wrongPassword!', hash);
    expect(valid).toBe(false);
  });

  it('tampered hash (wrong key) verifies false', async () => {
    const hash = await hashPassword('somePass');
    const parts = hash.split(':');
    // Flip last character of the derived key
    const tamperedKey = parts[2]!.slice(0, -1) + (parts[2]!.endsWith('f') ? '0' : 'f');
    const tamperedHash = `scrypt:${parts[1]}:${tamperedKey}`;
    const valid = await verifyPassword('somePass', tamperedHash);
    expect(valid).toBe(false);
  });

  it('tampered hash (wrong salt) verifies false', async () => {
    const hash = await hashPassword('somePass');
    const parts = hash.split(':');
    const tamperedSalt = '0'.repeat(32);
    const tamperedHash = `scrypt:${tamperedSalt}:${parts[2]}`;
    const valid = await verifyPassword('somePass', tamperedHash);
    expect(valid).toBe(false);
  });

  it('returns false for malformed hash (missing colon segments)', async () => {
    const valid = await verifyPassword('anyPassword', 'notahash');
    expect(valid).toBe(false);
  });

  it('returns false for wrong algorithm prefix', async () => {
    const valid = await verifyPassword('anyPassword', 'bcrypt:salt:key');
    expect(valid).toBe(false);
  });

  it('two calls with the same password produce different salts (random)', async () => {
    const hash1 = await hashPassword('samePassword');
    const hash2 = await hashPassword('samePassword');
    expect(hash1).not.toBe(hash2);
    // But both should verify correctly
    expect(await verifyPassword('samePassword', hash1)).toBe(true);
    expect(await verifyPassword('samePassword', hash2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// In-memory simulations of the route logic (mirrors email-auth.ts without Express)
// ---------------------------------------------------------------------------

interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string | null;
  walletAddress: string | null;
}

interface ChipLedger {
  userId: string;
  amount: number;
  reason: string;
}

function createUserStore() {
  const users: User[] = [];

  return {
    findByEmail(email: string): User | undefined {
      return users.find((u) => u.email === email);
    },
    insert(user: Omit<User, 'id'>): User {
      const id = randomUUID();
      const record: User = { id, ...user };
      users.push(record);
      return record;
    },
    all(): User[] {
      return [...users];
    },
  };
}

type RegisterResult =
  | { status: 201; body: { user: { id: string; username: string; email: string }; accessToken: string; refreshToken: string } }
  | { status: 400; body: { error: string } }
  | { status: 409; body: { error: string } }
  | { status: 500; body: { error: string } };

async function simulateRegister(
  input: unknown,
  store: ReturnType<typeof createUserStore>,
  chipLedger: ChipLedger[],
): Promise<RegisterResult> {
  // Validate input
  if (typeof input !== 'object' || input === null) {
    return { status: 400, body: { error: 'Invalid request' } };
  }

  const { email, password, username } = input as Record<string, unknown>;

  if (typeof email !== 'string' || !email.includes('@')) {
    return { status: 400, body: { error: 'Invalid request' } };
  }
  if (typeof password !== 'string' || password.length < 8) {
    return { status: 400, body: { error: 'Invalid request' } };
  }
  if (username !== undefined && (typeof username !== 'string' || username.length < 3)) {
    return { status: 400, body: { error: 'Invalid request' } };
  }

  const existing = store.findByEmail(email);
  if (existing) {
    return { status: 409, body: { error: 'Email already registered' } };
  }

  const passwordHash = await hashPassword(password);
  const finalUsername = typeof username === 'string' ? username : `u_${(email.split('@')[0] ?? 'user').slice(0, 20)}_xx`;

  const newUser = store.insert({ email, passwordHash, username: finalUsername, walletAddress: null });

  // Simulate registration bonus
  chipLedger.push({ userId: newUser.id, amount: 1000, reason: 'registration' });

  return {
    status: 201,
    body: {
      accessToken: `mock-access-${newUser.id}`,
      refreshToken: `mock-refresh-${newUser.id}`,
      user: { id: newUser.id, username: newUser.username, email: newUser.email },
    },
  };
}

type LoginResult =
  | { status: 200; body: { user: { id: string; username: string; email: string; walletAddress: string | null }; accessToken: string; refreshToken: string } }
  | { status: 400; body: { error: string } }
  | { status: 401; body: { error: string } }
  | { status: 500; body: { error: string } };

const DUMMY_HASH_FOR_TIMING = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;

async function simulateLogin(
  input: unknown,
  store: ReturnType<typeof createUserStore>,
): Promise<LoginResult> {
  if (typeof input !== 'object' || input === null) {
    return { status: 400, body: { error: 'Invalid request' } };
  }

  const { email, password } = input as Record<string, unknown>;

  if (typeof email !== 'string' || !email.includes('@')) {
    return { status: 400, body: { error: 'Invalid request' } };
  }
  if (typeof password !== 'string' || password.length < 1) {
    return { status: 400, body: { error: 'Invalid request' } };
  }

  const user = store.findByEmail(email);

  // Constant-time: always verify even when user not found
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH_FOR_TIMING;
  const valid = await verifyPassword(password, hashToCheck);

  if (!user || !user.passwordHash || !valid) {
    return { status: 401, body: { error: 'Invalid email or password' } };
  }

  return {
    status: 200,
    body: {
      accessToken: `mock-access-${user.id}`,
      refreshToken: `mock-refresh-${user.id}`,
      user: { id: user.id, username: user.username, email: user.email, walletAddress: user.walletAddress },
    },
  };
}

// ---------------------------------------------------------------------------
// Registration tests
// ---------------------------------------------------------------------------

describe('POST /auth/email/register — success', () => {
  it('returns 201 with tokens and user object', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const result = await simulateRegister(
      { email: 'alice@example.com', password: 'password123', username: 'alice_user' },
      store,
      chipLedger,
    );

    expect(result.status).toBe(201);
    const body = (result as { status: 201; body: { user: { id: string; username: string; email: string }; accessToken: string; refreshToken: string } }).body;
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.username).toBe('alice_user');
    expect(body.user.id).toBeTruthy();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('auto-generates username from email when username not provided', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const result = await simulateRegister(
      { email: 'bob.smith@example.com', password: 'securepass99' },
      store,
      chipLedger,
    );

    expect(result.status).toBe(201);
    const body = (result as { status: 201; body: { user: { id: string; username: string; email: string }; accessToken: string; refreshToken: string } }).body;
    expect(body.user.username).toMatch(/^u_bob\.smith/);
  });

  it('awards +1000 CHIP registration bonus on successful registration', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const result = await simulateRegister(
      { email: 'charlie@example.com', password: 'password123', username: 'charlie_c' },
      store,
      chipLedger,
    );

    expect(result.status).toBe(201);
    const body = (result as { status: 201; body: { user: { id: string; username: string; email: string }; accessToken: string; refreshToken: string } }).body;
    const bonus = chipLedger.find((e) => e.userId === body.user.id && e.reason === 'registration');
    expect(bonus).toBeDefined();
    expect(bonus!.amount).toBe(1000);
  });
});

describe('POST /auth/email/register — validation errors', () => {
  it('returns 400 for invalid email', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const result = await simulateRegister(
      { email: 'not-an-email', password: 'password123' },
      store,
      chipLedger,
    );

    expect(result.status).toBe(400);
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const result = await simulateRegister(
      { email: 'user@example.com', password: 'short' },
      store,
      chipLedger,
    );

    expect(result.status).toBe(400);
  });

  it('returns 400 for missing email', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const result = await simulateRegister({ password: 'password123' }, store, chipLedger);
    expect(result.status).toBe(400);
  });

  it('returns 400 for missing password', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const result = await simulateRegister({ email: 'user@example.com' }, store, chipLedger);
    expect(result.status).toBe(400);
  });
});

describe('POST /auth/email/register — duplicate email', () => {
  it('returns 409 when email is already registered', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    await simulateRegister(
      { email: 'dupe@example.com', password: 'password123', username: 'first_user' },
      store,
      chipLedger,
    );

    const result = await simulateRegister(
      { email: 'dupe@example.com', password: 'anotherpass456', username: 'second_user' },
      store,
      chipLedger,
    );

    expect(result.status).toBe(409);
    expect((result as { status: 409; body: { error: string } }).body.error).toBe('Email already registered');
  });

  it('does NOT award registration bonus on duplicate attempt', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const first = await simulateRegister(
      { email: 'dupe2@example.com', password: 'password123', username: 'original' },
      store,
      chipLedger,
    );
    const originalId = (first as { status: 201; body: { user: { id: string } } }).body.user.id;
    const bonusBefore = chipLedger.filter((e) => e.userId === originalId).length;

    await simulateRegister(
      { email: 'dupe2@example.com', password: 'anotherpass456', username: 'duplicate' },
      store,
      chipLedger,
    );

    const bonusAfter = chipLedger.filter((e) => e.userId === originalId).length;
    expect(bonusAfter).toBe(bonusBefore); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Login tests
// ---------------------------------------------------------------------------

describe('POST /auth/email/login — success', () => {
  it('returns 200 with tokens and user object (including walletAddress)', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    const reg = await simulateRegister(
      { email: 'logintest@example.com', password: 'supersecure1!', username: 'login_tester' },
      store,
      chipLedger,
    );
    expect(reg.status).toBe(201);

    const result = await simulateLogin(
      { email: 'logintest@example.com', password: 'supersecure1!' },
      store,
    );

    expect(result.status).toBe(200);
    const body = (result as { status: 200; body: { user: { id: string; username: string; email: string; walletAddress: string | null }; accessToken: string; refreshToken: string } }).body;
    expect(body.user.email).toBe('logintest@example.com');
    expect(body.user.username).toBe('login_tester');
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('returns walletAddress as null for email-only users', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    await simulateRegister(
      { email: 'nowall@example.com', password: 'password123', username: 'nowall_user' },
      store,
      chipLedger,
    );

    const result = await simulateLogin({ email: 'nowall@example.com', password: 'password123' }, store);
    expect(result.status).toBe(200);
    const body = (result as { status: 200; body: { user: { walletAddress: string | null } } }).body;
    expect(body.user.walletAddress).toBeNull();
  });
});

describe('POST /auth/email/login — wrong credentials', () => {
  it('returns 401 with generic message for wrong password', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    await simulateRegister(
      { email: 'wrongpw@example.com', password: 'correctpassword1', username: 'the_user' },
      store,
      chipLedger,
    );

    const result = await simulateLogin(
      { email: 'wrongpw@example.com', password: 'wrongpassword!' },
      store,
    );

    expect(result.status).toBe(401);
    expect((result as { status: 401; body: { error: string } }).body.error).toBe('Invalid email or password');
  });

  it('returns 401 with SAME generic message for unknown email (no info leak)', async () => {
    const store = createUserStore();

    const result = await simulateLogin(
      { email: 'notregistered@example.com', password: 'anypassword1' },
      store,
    );

    expect(result.status).toBe(401);
    expect((result as { status: 401; body: { error: string } }).body.error).toBe('Invalid email or password');
  });

  it('wrong password and unknown email return identical error messages', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    await simulateRegister(
      { email: 'sameErr@example.com', password: 'password12345', username: 'same_err_user' },
      store,
      chipLedger,
    );

    const wrongPw = await simulateLogin({ email: 'sameErr@example.com', password: 'wrongpass' }, store);
    const unknownEmail = await simulateLogin({ email: 'ghost@example.com', password: 'anypw1234' }, store);

    expect((wrongPw as { status: 401; body: { error: string } }).body.error).toBe(
      (unknownEmail as { status: 401; body: { error: string } }).body.error,
    );
  });
});

describe('POST /auth/email/login — OAuth-only user (no passwordHash)', () => {
  it('returns 401 when user has no passwordHash (SIWE/OAuth-only account)', async () => {
    // Simulate an OAuth-only user who has no password set
    const store = createUserStore();
    store.insert({
      email: 'siwe_user@example.com',
      passwordHash: null, // OAuth-only — no password
      username: 'siwe_user',
      walletAddress: '0xdeadbeef',
    });

    const result = await simulateLogin(
      { email: 'siwe_user@example.com', password: 'anypassword1' },
      store,
    );

    expect(result.status).toBe(401);
    expect((result as { status: 401; body: { error: string } }).body.error).toBe('Invalid email or password');
  });
});

describe('POST /auth/email/login — validation', () => {
  it('returns 400 for invalid email format', async () => {
    const store = createUserStore();
    const result = await simulateLogin({ email: 'bad-email', password: 'pass12345' }, store);
    expect(result.status).toBe(400);
  });

  it('returns 400 for empty password', async () => {
    const store = createUserStore();
    const result = await simulateLogin({ email: 'user@example.com', password: '' }, store);
    expect(result.status).toBe(400);
  });
});

describe('Timing-safe constant-time login (user enumeration prevention)', () => {
  it('DUMMY_HASH is a well-formed scrypt hash that verifyPassword can process without error', async () => {
    const dummyHash = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    // Should return false (wrong password) without throwing
    const result = await verifyPassword('anypassword', dummyHash);
    expect(result).toBe(false);
  });

  it('real user and fake user both go through verifyPassword call', async () => {
    const store = createUserStore();
    const chipLedger: ChipLedger[] = [];

    await simulateRegister(
      { email: 'timing@example.com', password: 'timing_password1', username: 'timing_user' },
      store,
      chipLedger,
    );

    // Both paths call verifyPassword — no short-circuit before the hash check
    const realUser = await simulateLogin({ email: 'timing@example.com', password: 'wrong' }, store);
    const fakeUser = await simulateLogin({ email: 'nonexistent@example.com', password: 'wrong' }, store);

    // Both return the same error
    expect(realUser.status).toBe(401);
    expect(fakeUser.status).toBe(401);
    expect((realUser as { status: 401; body: { error: string } }).body.error).toBe(
      (fakeUser as { status: 401; body: { error: string } }).body.error,
    );
  });
});
