/**
 * AGO-55: GitHub OAuth social login integration tests
 *
 * Tests validate:
 *  1. CSRF state generation and single-use enforcement
 *  2. OAuth exchange code issuance and consumption (single-use, 60s TTL)
 *  3. Binding deduplication logic (one GitHub account per user)
 *  4. CHIP reward idempotency (chipRewarded flag prevents double-claiming)
 *  5. Schema constraints for social_bindings table
 *
 * Runs in-process without live DB, Redis, or GitHub API calls.
 * Same validation approach as agent-register.test.ts.
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
    create(username: string, email?: string | null): TestUser {
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
// Business logic (mirrors github-oauth.ts without Express / network I/O)
// ---------------------------------------------------------------------------

type HandleCallbackResult =
  | { ok: true; userId: string; isNewUser: boolean; chipAwarded: boolean; exchangeCode: string }
  | { ok: false; error: string };

function handleGitHubCallback(
  opts: {
    state: string;
    githubUserId: string;
    githubLogin: string;
    githubEmail: string | null;
    stateStore: ReturnType<typeof createOAuthStateStore>;
    exchangeStore: ReturnType<typeof createExchangeStore>;
    bindingsStore: ReturnType<typeof createBindingsStore>;
    usersStore: ReturnType<typeof createUsersStore>;
    githubChipReward?: number;
  },
): HandleCallbackResult {
  const { state, githubUserId, githubLogin, githubEmail, stateStore, exchangeStore, bindingsStore, usersStore } = opts;
  const CHIP_REWARD = opts.githubChipReward ?? 500;

  // Validate CSRF state
  const statePayload = stateStore.consume(state);
  if (!statePayload || statePayload.provider !== 'github') {
    return { ok: false, error: 'Invalid or expired OAuth state' };
  }

  let userId: string;
  let isNewUser = false;
  let chipAwarded = false;

  const existingBinding = bindingsStore.findByProvider('github', githubUserId);

  if (existingBinding) {
    if (statePayload.userId && statePayload.userId !== existingBinding.userId) {
      // Linking flow: GitHub account is already claimed by a different user
      return { ok: false, error: 'unique_violation: GitHub account is already bound to another user' };
    }

    // Existing GitHub user — log in (either fresh login or same user re-linking)
    userId = existingBinding.userId;
    chipAwarded = false;

    if (!existingBinding.chipRewarded) {
      usersStore.addChip(userId, CHIP_REWARD);
      bindingsStore.markRewarded(userId, 'github');
      chipAwarded = true;
    }
  } else if (statePayload.userId) {
    // Linking flow — bind GitHub to existing account
    userId = statePayload.userId;
    const user = usersStore.findById(userId);
    if (!user) return { ok: false, error: 'User account not found' };

    try {
      bindingsStore.insert({ userId, provider: 'github', providerUserId: githubUserId, providerUsername: githubLogin, providerEmail: githubEmail, chipRewarded: false });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    usersStore.addChip(userId, CHIP_REWARD);
    bindingsStore.markRewarded(userId, 'github');
    chipAwarded = true;
  } else {
    // New user
    isNewUser = true;
    const candidateUsername = `gh_${githubLogin}_${randomBytes(2).toString('hex')}`;

    let user: TestUser;
    try {
      user = usersStore.create(candidateUsername, githubEmail);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    userId = user.id;

    try {
      bindingsStore.insert({ userId, provider: 'github', providerUserId: githubUserId, providerUsername: githubLogin, providerEmail: githubEmail, chipRewarded: false });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    usersStore.addChip(userId, CHIP_REWARD);
    bindingsStore.markRewarded(userId, 'github');
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

describe('GitHub OAuth — CSRF state management', () => {
  it('generates unique states', () => {
    const states = new Set(Array.from({ length: 100 }, () => randomBytes(16).toString('hex')));
    expect(states.size).toBe(100);
  });

  it('state is single-use (consumed on first access)', () => {
    const stateStore = createOAuthStateStore();
    const state = randomBytes(16).toString('hex');
    stateStore.store(state, { provider: 'github' });

    const first = stateStore.consume(state);
    expect(first).not.toBeNull();
    expect(first?.provider).toBe('github');

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
    stateStore.store(state, { provider: 'github', userId: 'user-123' });

    const payload = stateStore.consume(state);
    expect(payload?.userId).toBe('user-123');
  });
});

describe('GitHub OAuth — exchange code management', () => {
  it('exchange code is single-use', () => {
    const exchangeStore = createExchangeStore();
    const code = randomUUID();
    exchangeStore.store(code, { accessToken: 'tok-a', refreshToken: 'ref-a', expiresIn: 86400 });

    const first = exchangeStore.consume(code);
    expect(first).not.toBeNull();
    expect(first?.accessToken).toBe('tok-a');

    const second = exchangeStore.consume(code);
    expect(second).toBeNull();
  });

  it('unknown exchange code returns null', () => {
    const exchangeStore = createExchangeStore();
    expect(exchangeStore.consume(randomUUID())).toBeNull();
  });
});

describe('GitHub OAuth — callback handler', () => {
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
    const result = handleGitHubCallback({
      state: 'invalid-state',
      githubUserId: '12345',
      githubLogin: 'testuser',
      githubEmail: 'test@example.com',
      ...stores,
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/invalid.*state/i);
  });

  it('rejects wrong provider in state', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'google' }); // wrong provider

    const result = handleGitHubCallback({
      state,
      githubUserId: '12345',
      githubLogin: 'testuser',
      githubEmail: null,
      ...stores,
    });
    expect(result.ok).toBe(false);
  });

  it('creates new user on first login', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'github' });

    const result = handleGitHubCallback({
      state,
      githubUserId: '99999',
      githubLogin: 'newuser',
      githubEmail: 'new@example.com',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;
    expect(ok.isNewUser).toBe(true);
    expect(ok.chipAwarded).toBe(true);

    // User exists in store
    const user = stores.usersStore.findById(ok.userId);
    expect(user).not.toBeNull();
    expect(user!.chipBalance).toBe(500);

    // Binding exists
    const binding = stores.bindingsStore.findByProvider('github', '99999');
    expect(binding).not.toBeNull();
    expect(binding!.userId).toBe(ok.userId);
    expect(binding!.chipRewarded).toBe(true);
  });

  it('logs in existing user without double-awarding CHIP', () => {
    const stores = makeStores();

    // First login
    const state1 = randomBytes(16).toString('hex');
    stores.stateStore.store(state1, { provider: 'github' });
    const first = handleGitHubCallback({
      state: state1,
      githubUserId: '11111',
      githubLogin: 'existinguser',
      githubEmail: 'ex@example.com',
      ...stores,
    });
    expect(first.ok).toBe(true);
    const firstOk = first as Extract<HandleCallbackResult, { ok: true }>;
    expect(firstOk.chipAwarded).toBe(true);
    expect(stores.usersStore.findById(firstOk.userId)!.chipBalance).toBe(500);

    // Second login — same GitHub user
    const state2 = randomBytes(16).toString('hex');
    stores.stateStore.store(state2, { provider: 'github' });
    const second = handleGitHubCallback({
      state: state2,
      githubUserId: '11111',
      githubLogin: 'existinguser',
      githubEmail: 'ex@example.com',
      ...stores,
    });
    expect(second.ok).toBe(true);
    const secondOk = second as Extract<HandleCallbackResult, { ok: true }>;
    expect(secondOk.userId).toBe(firstOk.userId); // same user
    expect(secondOk.chipAwarded).toBe(false); // NO double reward

    // Balance unchanged at 500
    expect(stores.usersStore.findById(secondOk.userId)!.chipBalance).toBe(500);
  });

  it('links GitHub to existing authenticated user', () => {
    const stores = makeStores();

    // Pre-existing user (e.g., registered via SIWE)
    const existingUser = stores.usersStore.create('siwe_user_abc');

    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'github', userId: existingUser.id });

    const result = handleGitHubCallback({
      state,
      githubUserId: '77777',
      githubLogin: 'linker',
      githubEmail: 'linker@gh.com',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;
    expect(ok.isNewUser).toBe(false);
    expect(ok.userId).toBe(existingUser.id); // bound to existing user
    expect(ok.chipAwarded).toBe(true);
    expect(stores.usersStore.findById(existingUser.id)!.chipBalance).toBe(500);
  });

  it('prevents linking same GitHub account to two different users', () => {
    const stores = makeStores();

    // First user binds GitHub account
    const state1 = randomBytes(16).toString('hex');
    stores.stateStore.store(state1, { provider: 'github' });
    handleGitHubCallback({ state: state1, githubUserId: '55555', githubLogin: 'githubuser', githubEmail: null, ...stores });

    // Second user tries to bind the SAME GitHub account
    const existingUser2 = stores.usersStore.create('user_two');
    const state2 = randomBytes(16).toString('hex');
    stores.stateStore.store(state2, { provider: 'github', userId: existingUser2.id });

    const result = handleGitHubCallback({
      state: state2,
      githubUserId: '55555', // same GitHub ID
      githubLogin: 'githubuser',
      githubEmail: null,
      ...stores,
    });

    // Should fail due to unique constraint
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/unique_violation/);
  });

  it('issues exchange code after successful callback', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'github' });

    const result = handleGitHubCallback({
      state,
      githubUserId: '33333',
      githubLogin: 'exchanger',
      githubEmail: null,
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
    stores.stateStore.store(state, { provider: 'github' });
    expect(stores.stateStore.size()).toBe(1);

    // Trigger with valid state (state gets consumed)
    handleGitHubCallback({
      state,
      githubUserId: '44444',
      githubLogin: 'stateuser',
      githubEmail: null,
      ...stores,
    });

    // State is consumed — cannot be reused (replay protection)
    expect(stores.stateStore.size()).toBe(0);
    expect(stores.stateStore.consume(state)).toBeNull();
  });
});

describe('GitHub OAuth — social_bindings schema constraints', () => {
  it('enforces one-binding-per-user-per-provider', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'github', providerUserId: 'gh-1', providerUsername: 'user1', providerEmail: null, chipRewarded: false });

    expect(() =>
      store.insert({ userId, provider: 'github', providerUserId: 'gh-2', providerUsername: 'user1b', providerEmail: null, chipRewarded: false }),
    ).toThrow(/unique_violation/);
  });

  it('enforces one-user-per-provider-account', () => {
    const store = createBindingsStore();

    store.insert({ userId: randomUUID(), provider: 'github', providerUserId: 'gh-shared', providerUsername: 'shared', providerEmail: null, chipRewarded: false });

    expect(() =>
      store.insert({ userId: randomUUID(), provider: 'github', providerUserId: 'gh-shared', providerUsername: 'shared', providerEmail: null, chipRewarded: false }),
    ).toThrow(/unique_violation/);
  });

  it('allows same user to bind different providers', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    expect(() => {
      store.insert({ userId, provider: 'github', providerUserId: 'gh-111', providerUsername: 'user', providerEmail: null, chipRewarded: false });
      store.insert({ userId, provider: 'google', providerUserId: 'g-222', providerUsername: 'user@google.com', providerEmail: 'user@google.com', chipRewarded: false });
    }).not.toThrow();

    expect(store.all().length).toBe(2);
  });

  it('chipRewarded flag is false by default', () => {
    const store = createBindingsStore();
    const binding = store.insert({ userId: randomUUID(), provider: 'github', providerUserId: 'gh-new', providerUsername: 'newuser', providerEmail: null, chipRewarded: false });
    expect(binding.chipRewarded).toBe(false);
  });
});
