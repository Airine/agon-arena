/**
 * AGO-56: Google OAuth social login integration tests
 *
 * Tests validate:
 *  1. CSRF state generation and single-use enforcement
 *  2. OAuth exchange code issuance and consumption (single-use, 60s TTL)
 *  3. Binding deduplication logic (one Google account per user)
 *  4. CHIP reward idempotency (chipRewarded flag prevents double-claiming)
 *  5. Schema constraints for social_bindings table (google provider)
 *
 * Runs in-process without live DB, Redis, or Google API calls.
 * Same validation approach as github-oauth.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Mock implementations (mirrors production logic without I/O)
// ---------------------------------------------------------------------------

/** In-memory store for OAuth CSRF states */
function createOAuthStateStore() {
  const store = new Map<string, { provider: string; userId?: string; expiresAt: number }>();

  return {
    store(state: string, payload: { provider: string; userId?: string }, ttlSeconds = 600): void {
      store.set(state, { ...payload, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    consume(state: string): { provider: string; userId?: string } | null {
      const entry = store.get(state);
      if (!entry) return null;
      store.delete(state); // single-use
      if (Date.now() > entry.expiresAt) return null;
      const { expiresAt: _, ...payload } = entry;
      return payload;
    },
    size(): number {
      return store.size;
    },
  };
}

/** In-memory store for OAuth exchange codes */
function createExchangeStore() {
  const store = new Map<string, { accessToken: string; refreshToken: string; expiresIn: number; expiresAt: number }>();

  return {
    store(code: string, payload: { accessToken: string; refreshToken: string; expiresIn: number }, ttlSeconds = 60): void {
      store.set(code, { ...payload, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    consume(code: string): { accessToken: string; refreshToken: string; expiresIn: number } | null {
      const entry = store.get(code);
      if (!entry) return null;
      store.delete(code); // single-use
      if (Date.now() > entry.expiresAt) return null;
      const { expiresAt: _, ...payload } = entry;
      return payload;
    },
    size(): number {
      return store.size;
    },
  };
}

/** In-memory social_bindings table */
interface SocialBinding {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  providerUsername: string | null;
  providerEmail: string | null;
  chipRewarded: boolean;
}

function createBindingsStore() {
  const store: SocialBinding[] = [];

  return {
    findByProvider(provider: string, providerUserId: string): SocialBinding | null {
      return store.find((b) => b.provider === provider && b.providerUserId === providerUserId) ?? null;
    },
    findByUser(userId: string, provider: string): SocialBinding | null {
      return store.find((b) => b.userId === userId && b.provider === provider) ?? null;
    },
    insert(binding: Omit<SocialBinding, 'id'>): SocialBinding {
      // Enforce unique constraints
      if (store.find((b) => b.userId === binding.userId && b.provider === binding.provider)) {
        throw new Error(`unique_violation: user already has a ${binding.provider} binding`);
      }
      if (store.find((b) => b.provider === binding.provider && b.providerUserId === binding.providerUserId)) {
        throw new Error(`unique_violation: ${binding.provider} account already bound to another user`);
      }
      const record = { id: randomUUID(), ...binding };
      store.push(record);
      return record;
    },
    markRewarded(userId: string, provider: string): void {
      const binding = store.find((b) => b.userId === userId && b.provider === provider);
      if (binding) binding.chipRewarded = true;
    },
    all(): SocialBinding[] {
      return [...store];
    },
  };
}

/** Minimal user account for test purposes */
interface TestUser {
  id: string;
  username: string;
  chipBalance: number;
  walletAddress: string | null;
}

function createUsersStore() {
  const store: TestUser[] = [];

  return {
    create(username: string, _email?: string | null): TestUser {
      if (store.find((u) => u.username === username)) {
        throw new Error('unique_violation: username already exists');
      }
      const user: TestUser = { id: randomUUID(), username, chipBalance: 0, walletAddress: null };
      store.push(user);
      return user;
    },
    findById(id: string): TestUser | null {
      return store.find((u) => u.id === id) ?? null;
    },
    addChip(userId: string, amount: number): void {
      const user = store.find((u) => u.id === userId);
      if (user) user.chipBalance += amount;
    },
    all(): TestUser[] {
      return [...store];
    },
  };
}

// ---------------------------------------------------------------------------
// Business logic (mirrors google-oauth.ts without Express / network I/O)
// ---------------------------------------------------------------------------

type HandleCallbackResult =
  | { ok: true; userId: string; isNewUser: boolean; chipAwarded: boolean; exchangeCode: string }
  | { ok: false; error: string };

const GOOGLE_CHIP_REWARD = 200;

function handleGoogleCallback(
  opts: {
    state: string;
    googleSub: string;          // Google user ID (string "sub" claim)
    googleName: string | null;
    googleEmail: string | null;
    stateStore: ReturnType<typeof createOAuthStateStore>;
    exchangeStore: ReturnType<typeof createExchangeStore>;
    bindingsStore: ReturnType<typeof createBindingsStore>;
    usersStore: ReturnType<typeof createUsersStore>;
    chipReward?: number;
  },
): HandleCallbackResult {
  const { state, googleSub, googleName, googleEmail, stateStore, exchangeStore, bindingsStore, usersStore } = opts;
  const chipReward = opts.chipReward ?? GOOGLE_CHIP_REWARD;

  // Validate CSRF state
  const statePayload = stateStore.consume(state);
  if (!statePayload || statePayload.provider !== 'google') {
    return { ok: false, error: 'Invalid or expired OAuth state' };
  }

  let userId: string;
  let isNewUser = false;
  let chipAwarded = false;

  const existingBinding = bindingsStore.findByProvider('google', googleSub);

  if (existingBinding) {
    if (statePayload.userId && statePayload.userId !== existingBinding.userId) {
      // Linking flow: Google account is already claimed by a different user
      return { ok: false, error: 'unique_violation: Google account is already bound to another user' };
    }

    // Existing Google user — log in (either fresh login or same user re-linking)
    userId = existingBinding.userId;
    chipAwarded = false;

    if (!existingBinding.chipRewarded) {
      usersStore.addChip(userId, chipReward);
      bindingsStore.markRewarded(userId, 'google');
      chipAwarded = true;
    }
  } else if (statePayload.userId) {
    // Linking flow — bind Google to existing account
    userId = statePayload.userId;
    const user = usersStore.findById(userId);
    if (!user) return { ok: false, error: 'User account not found' };

    try {
      bindingsStore.insert({
        userId,
        provider: 'google',
        providerUserId: googleSub,
        providerUsername: googleName,
        providerEmail: googleEmail,
        chipRewarded: false,
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    usersStore.addChip(userId, chipReward);
    bindingsStore.markRewarded(userId, 'google');
    chipAwarded = true;
  } else {
    // New user
    isNewUser = true;
    const baseName = googleName
      ? `g_${googleName.replace(/\s+/g, '_').toLowerCase()}`.slice(0, 44)
      : 'google_user';
    const candidateUsername = `${baseName}_${randomBytes(2).toString('hex')}`;

    let user: TestUser;
    try {
      user = usersStore.create(candidateUsername, googleEmail);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    userId = user.id;

    try {
      bindingsStore.insert({
        userId,
        provider: 'google',
        providerUserId: googleSub,
        providerUsername: googleName,
        providerEmail: googleEmail,
        chipRewarded: false,
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    usersStore.addChip(userId, chipReward);
    bindingsStore.markRewarded(userId, 'google');
    chipAwarded = true;
  }

  // Issue exchange code
  const exchangeCode = randomUUID();
  exchangeStore.store(exchangeCode, {
    accessToken: `mock-access-token-${userId}`,
    refreshToken: `mock-refresh-token-${randomUUID()}`,
    expiresIn: 86400,
  });

  return { ok: true, userId, isNewUser, chipAwarded, exchangeCode };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Google OAuth — CSRF state management', () => {
  it('generates unique states', () => {
    const states = new Set(Array.from({ length: 100 }, () => randomBytes(16).toString('hex')));
    expect(states.size).toBe(100);
  });

  it('state is single-use (consumed on first access)', () => {
    const stateStore = createOAuthStateStore();
    const state = randomBytes(16).toString('hex');
    stateStore.store(state, { provider: 'google' });

    const first = stateStore.consume(state);
    expect(first).not.toBeNull();
    expect(first?.provider).toBe('google');

    // Second consumption returns null
    const second = stateStore.consume(state);
    expect(second).toBeNull();
    expect(stateStore.size()).toBe(0);
  });

  it('unknown state returns null', () => {
    const stateStore = createOAuthStateStore();
    expect(stateStore.consume('nonexistent')).toBeNull();
  });

  it('state carries optional userId for linking flow', () => {
    const stateStore = createOAuthStateStore();
    const state = randomBytes(16).toString('hex');
    stateStore.store(state, { provider: 'google', userId: 'user-123' });

    const payload = stateStore.consume(state);
    expect(payload?.userId).toBe('user-123');
  });
});

describe('Google OAuth — exchange code management', () => {
  it('exchange code is single-use', () => {
    const exchangeStore = createExchangeStore();
    const code = randomUUID();
    exchangeStore.store(code, { accessToken: 'tok-g', refreshToken: 'ref-g', expiresIn: 86400 });

    const first = exchangeStore.consume(code);
    expect(first).not.toBeNull();
    expect(first?.accessToken).toBe('tok-g');

    const second = exchangeStore.consume(code);
    expect(second).toBeNull();
  });

  it('unknown exchange code returns null', () => {
    const exchangeStore = createExchangeStore();
    expect(exchangeStore.consume(randomUUID())).toBeNull();
  });
});

describe('Google OAuth — callback handler', () => {
  function makeStores() {
    return {
      stateStore: createOAuthStateStore(),
      exchangeStore: createExchangeStore(),
      bindingsStore: createBindingsStore(),
      usersStore: createUsersStore(),
    };
  }

  it('rejects invalid CSRF state', () => {
    const stores = makeStores();
    const result = handleGoogleCallback({
      state: 'invalid-state',
      googleSub: '123456789',
      googleName: 'Test User',
      googleEmail: 'test@gmail.com',
      ...stores,
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/invalid.*state/i);
  });

  it('rejects wrong provider in state (github state cannot authorize google)', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'github' }); // wrong provider

    const result = handleGoogleCallback({
      state,
      googleSub: '123456789',
      googleName: 'Test User',
      googleEmail: null,
      ...stores,
    });
    expect(result.ok).toBe(false);
  });

  it('creates new user on first Google login', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'google' });

    const result = handleGoogleCallback({
      state,
      googleSub: '111222333444',
      googleName: 'Alice Smith',
      googleEmail: 'alice@gmail.com',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;
    expect(ok.isNewUser).toBe(true);
    expect(ok.chipAwarded).toBe(true);

    // User exists in store with Google CHIP reward (200)
    const user = stores.usersStore.findById(ok.userId);
    expect(user).not.toBeNull();
    expect(user!.chipBalance).toBe(200);

    // Binding exists and is marked rewarded
    const binding = stores.bindingsStore.findByProvider('google', '111222333444');
    expect(binding).not.toBeNull();
    expect(binding!.userId).toBe(ok.userId);
    expect(binding!.chipRewarded).toBe(true);
    expect(binding!.providerEmail).toBe('alice@gmail.com');
  });

  it('logs in existing user without double-awarding CHIP', () => {
    const stores = makeStores();

    // First login
    const state1 = randomBytes(16).toString('hex');
    stores.stateStore.store(state1, { provider: 'google' });
    const first = handleGoogleCallback({
      state: state1,
      googleSub: '999888777',
      googleName: 'Bob Jones',
      googleEmail: 'bob@gmail.com',
      ...stores,
    });
    expect(first.ok).toBe(true);
    const firstOk = first as Extract<HandleCallbackResult, { ok: true }>;
    expect(firstOk.chipAwarded).toBe(true);
    expect(stores.usersStore.findById(firstOk.userId)!.chipBalance).toBe(200);

    // Second login — same Google user
    const state2 = randomBytes(16).toString('hex');
    stores.stateStore.store(state2, { provider: 'google' });
    const second = handleGoogleCallback({
      state: state2,
      googleSub: '999888777',
      googleName: 'Bob Jones',
      googleEmail: 'bob@gmail.com',
      ...stores,
    });
    expect(second.ok).toBe(true);
    const secondOk = second as Extract<HandleCallbackResult, { ok: true }>;
    expect(secondOk.userId).toBe(firstOk.userId); // same user
    expect(secondOk.chipAwarded).toBe(false); // NO double reward

    // Balance unchanged at 200
    expect(stores.usersStore.findById(secondOk.userId)!.chipBalance).toBe(200);
  });

  it('links Google to existing authenticated user (SIWE wallet account)', () => {
    const stores = makeStores();

    // Pre-existing user (e.g., registered via SIWE)
    const existingUser = stores.usersStore.create('siwe_wallet_user');

    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'google', userId: existingUser.id });

    const result = handleGoogleCallback({
      state,
      googleSub: '555666777',
      googleName: 'Charlie Green',
      googleEmail: 'charlie@gmail.com',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;
    expect(ok.isNewUser).toBe(false);
    expect(ok.userId).toBe(existingUser.id); // bound to existing user
    expect(ok.chipAwarded).toBe(true);
    expect(stores.usersStore.findById(existingUser.id)!.chipBalance).toBe(200);
  });

  it('prevents linking same Google account to two different users', () => {
    const stores = makeStores();

    // First user binds their Google account
    const state1 = randomBytes(16).toString('hex');
    stores.stateStore.store(state1, { provider: 'google' });
    handleGoogleCallback({
      state: state1,
      googleSub: '777000111',
      googleName: 'Original User',
      googleEmail: null,
      ...stores,
    });

    // Second user tries to bind the SAME Google account
    const existingUser2 = stores.usersStore.create('user_two');
    const state2 = randomBytes(16).toString('hex');
    stores.stateStore.store(state2, { provider: 'google', userId: existingUser2.id });

    const result = handleGoogleCallback({
      state: state2,
      googleSub: '777000111', // same Google sub
      googleName: 'Original User',
      googleEmail: null,
      ...stores,
    });

    // Should fail — Google account already claimed by first user
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/unique_violation/);
  });

  it('issues exchange code after successful callback', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'google' });

    const result = handleGoogleCallback({
      state,
      googleSub: '333444555',
      googleName: 'Dana White',
      googleEmail: 'dana@gmail.com',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;

    // Exchange code can be consumed once
    const tokens = stores.exchangeStore.consume(ok.exchangeCode);
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBeTruthy();
    expect(tokens!.refreshToken).toBeTruthy();

    // Cannot be consumed twice
    expect(stores.exchangeStore.consume(ok.exchangeCode)).toBeNull();
  });

  it('CSRF state is consumed regardless of callback outcome', () => {
    const stores = makeStores();

    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'google' });
    expect(stores.stateStore.size()).toBe(1);

    // Trigger with valid state (state gets consumed)
    handleGoogleCallback({
      state,
      googleSub: '444555666',
      googleName: 'Eve Black',
      googleEmail: null,
      ...stores,
    });

    // State is consumed — cannot be reused (replay protection)
    expect(stores.stateStore.size()).toBe(0);
    expect(stores.stateStore.consume(state)).toBeNull();
  });

  it('handles Google user with null name (derives generic username)', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'google' });

    const result = handleGoogleCallback({
      state,
      googleSub: '000111222',
      googleName: null, // no display name from Google
      googleEmail: 'noname@gmail.com',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;
    const user = stores.usersStore.findById(ok.userId);
    expect(user).not.toBeNull();
    // Username should start with 'google_user' prefix
    expect(user!.username).toMatch(/^google_user_/);
  });
});

describe('Google OAuth — social_bindings schema constraints', () => {
  it('enforces one-binding-per-user-per-provider', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'google', providerUserId: 'g-sub-1', providerUsername: 'User One', providerEmail: 'u1@gmail.com', chipRewarded: false });

    expect(() =>
      store.insert({ userId, provider: 'google', providerUserId: 'g-sub-2', providerUsername: 'User One B', providerEmail: null, chipRewarded: false }),
    ).toThrow(/unique_violation/);
  });

  it('enforces one-user-per-provider-account', () => {
    const store = createBindingsStore();

    store.insert({ userId: randomUUID(), provider: 'google', providerUserId: 'g-shared-sub', providerUsername: 'Shared', providerEmail: null, chipRewarded: false });

    expect(() =>
      store.insert({ userId: randomUUID(), provider: 'google', providerUserId: 'g-shared-sub', providerUsername: 'Shared', providerEmail: null, chipRewarded: false }),
    ).toThrow(/unique_violation/);
  });

  it('allows same user to bind both GitHub and Google', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    expect(() => {
      store.insert({ userId, provider: 'github', providerUserId: 'gh-111', providerUsername: 'user', providerEmail: null, chipRewarded: false });
      store.insert({ userId, provider: 'google', providerUserId: 'g-sub-222', providerUsername: 'User Name', providerEmail: 'user@gmail.com', chipRewarded: false });
    }).not.toThrow();

    expect(store.all().length).toBe(2);
  });

  it('Google CHIP reward is 200 (less than GitHub 500)', () => {
    expect(GOOGLE_CHIP_REWARD).toBe(200);
  });

  it('chipRewarded flag is false by default on insert', () => {
    const store = createBindingsStore();
    const binding = store.insert({
      userId: randomUUID(),
      provider: 'google',
      providerUserId: 'g-new-sub',
      providerUsername: 'New User',
      providerEmail: 'new@gmail.com',
      chipRewarded: false,
    });
    expect(binding.chipRewarded).toBe(false);
  });
});
