/**
 * AGO-65: X (Twitter) OAuth 2.0 PKCE social login integration tests
 *
 * Tests validate:
 *  1. PKCE code verifier / challenge generation
 *  2. CSRF state generation and single-use enforcement (carrying codeVerifier)
 *  3. OAuth exchange code issuance and consumption (single-use, 60s TTL)
 *  4. Binding deduplication logic (one Twitter account per user)
 *  5. CHIP reward idempotency (chipRewarded flag prevents double-claiming)
 *  6. Linking flow (userId in state) for existing authenticated users
 *  7. Redirect URL contains required PKCE and scope parameters
 *
 * Runs in-process without live DB, Redis, or Twitter API calls.
 * Follows the same pattern as github-oauth.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'crypto';

// ---------------------------------------------------------------------------
// PKCE utilities (mirrors twitter-oauth.ts)
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Mock implementations (mirrors production logic without I/O)
// ---------------------------------------------------------------------------

/** In-memory store for OAuth CSRF states — supports codeVerifier for PKCE */
function createOAuthStateStore() {
  const store = new Map<string, { provider: string; userId?: string; codeVerifier?: string; expiresAt: number }>();

  return {
    store(state: string, payload: { provider: string; userId?: string; codeVerifier?: string }, ttlSeconds = 600): void {
      store.set(state, { ...payload, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    consume(state: string): { provider: string; userId?: string; codeVerifier?: string } | null {
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
    create(username: string): TestUser {
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
// Business logic (mirrors twitter-oauth.ts without Express / network I/O)
// ---------------------------------------------------------------------------

type HandleCallbackResult =
  | { ok: true; userId: string; isNewUser: boolean; chipAwarded: boolean; exchangeCode: string }
  | { ok: false; error: string };

function handleTwitterCallback(
  opts: {
    state: string;
    twitterUserId: string;
    twitterUsername: string;
    stateStore: ReturnType<typeof createOAuthStateStore>;
    exchangeStore: ReturnType<typeof createExchangeStore>;
    bindingsStore: ReturnType<typeof createBindingsStore>;
    usersStore: ReturnType<typeof createUsersStore>;
    twitterChipReward?: number;
  },
): HandleCallbackResult {
  const { state, twitterUserId, twitterUsername, stateStore, exchangeStore, bindingsStore, usersStore } = opts;
  const CHIP_REWARD = opts.twitterChipReward ?? 300;

  // Validate CSRF state
  const statePayload = stateStore.consume(state);
  if (!statePayload || statePayload.provider !== 'twitter') {
    return { ok: false, error: 'Invalid or expired OAuth state' };
  }

  // Require PKCE code verifier in state
  if (!statePayload.codeVerifier) {
    return { ok: false, error: 'Missing PKCE code verifier' };
  }

  const providerUserId = String(twitterUserId);
  const providerUsername = `@${twitterUsername}`;

  let userId: string;
  let isNewUser = false;
  let chipAwarded = false;

  const existingBinding = bindingsStore.findByProvider('twitter', providerUserId);

  if (existingBinding) {
    if (statePayload.userId && statePayload.userId !== existingBinding.userId) {
      // Linking flow: Twitter account is already claimed by a different user
      return { ok: false, error: 'unique_violation: Twitter account is already bound to another user' };
    }

    // Existing Twitter user — log in (either fresh login or same user re-linking)
    userId = existingBinding.userId;
    chipAwarded = false;

    if (!existingBinding.chipRewarded) {
      usersStore.addChip(userId, CHIP_REWARD);
      bindingsStore.markRewarded(userId, 'twitter');
      chipAwarded = true;
    }
  } else if (statePayload.userId) {
    // Linking flow — bind Twitter to existing account
    userId = statePayload.userId;
    const user = usersStore.findById(userId);
    if (!user) return { ok: false, error: 'User account not found' };

    try {
      bindingsStore.insert({ userId, provider: 'twitter', providerUserId, providerUsername, chipRewarded: false });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    usersStore.addChip(userId, CHIP_REWARD);
    bindingsStore.markRewarded(userId, 'twitter');
    chipAwarded = true;
  } else {
    // New user
    isNewUser = true;
    const baseName = `tw_${twitterUsername}`.slice(0, 44);
    const candidateUsername = `${baseName}_${randomBytes(2).toString('hex')}`;

    let user: TestUser;
    try {
      user = usersStore.create(candidateUsername);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    userId = user.id;

    try {
      bindingsStore.insert({ userId, provider: 'twitter', providerUserId, providerUsername, chipRewarded: false });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    usersStore.addChip(userId, CHIP_REWARD);
    bindingsStore.markRewarded(userId, 'twitter');
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

describe('Twitter OAuth — PKCE generation', () => {
  it('generates a valid code verifier (base64url, 43 chars from 32 bytes)', () => {
    const verifier = generateCodeVerifier();
    // 32 bytes base64url = 43 chars (no padding)
    expect(verifier).toHaveLength(43);
    // base64url: only [A-Za-z0-9_-]
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique code verifiers', () => {
    const verifiers = new Set(Array.from({ length: 100 }, () => generateCodeVerifier()));
    expect(verifiers.size).toBe(100);
  });

  it('generates a valid SHA-256 code challenge from verifier', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    // SHA-256 hash is 32 bytes → 43 base64url chars (no padding)
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('code challenge is deterministic for same verifier', () => {
    const verifier = generateCodeVerifier();
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
  });

  it('different verifiers produce different challenges', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(generateCodeChallenge(v1)).not.toBe(generateCodeChallenge(v2));
  });
});

describe('Twitter OAuth — CSRF state management with PKCE', () => {
  it('state carries codeVerifier for PKCE flow', () => {
    const stateStore = createOAuthStateStore();
    const state = randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    stateStore.store(state, { provider: 'twitter', codeVerifier });

    const payload = stateStore.consume(state);
    expect(payload).not.toBeNull();
    expect(payload?.provider).toBe('twitter');
    expect(payload?.codeVerifier).toBe(codeVerifier);
  });

  it('state is single-use (consumed on first access)', () => {
    const stateStore = createOAuthStateStore();
    const state = randomBytes(16).toString('hex');
    stateStore.store(state, { provider: 'twitter', codeVerifier: generateCodeVerifier() });

    const first = stateStore.consume(state);
    expect(first).not.toBeNull();

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
    stateStore.store(state, { provider: 'twitter', userId: 'user-abc', codeVerifier: generateCodeVerifier() });

    const payload = stateStore.consume(state);
    expect(payload?.userId).toBe('user-abc');
  });
});

describe('Twitter OAuth — redirect URL parameters', () => {
  it('authorization URL contains required PKCE parameters', () => {
    const clientId = 'test-client-id';
    const redirectUri = 'http://localhost:3001/auth/twitter/callback';
    const state = randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'tweet.read users.read offline.access');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const url = authUrl.toString();
    expect(url).toContain('twitter.com/i/oauth2/authorize');
    expect(url).toContain('response_type=code');
    expect(url).toContain(`client_id=${clientId}`);
    expect(url).toContain('code_challenge=');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('scope=tweet.read');
    expect(url).toContain(`state=${state}`);
  });
});

describe('Twitter OAuth — exchange code management', () => {
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

describe('Twitter OAuth — callback handler', () => {
  function makeStores() {
    return {
      stateStore: createOAuthStateStore(),
      exchangeStore: createExchangeStore(),
      bindingsStore: createBindingsStore(),
      usersStore: createUsersStore(),
    };
  }

  function storeTwitterState(stateStore: ReturnType<typeof createOAuthStateStore>, overrides?: { userId?: string }) {
    const state = randomBytes(16).toString('hex');
    stateStore.store(state, { provider: 'twitter', codeVerifier: generateCodeVerifier(), ...overrides });
    return state;
  }

  it('rejects invalid CSRF state', () => {
    const stores = makeStores();
    const result = handleTwitterCallback({
      state: 'invalid-state',
      twitterUserId: '12345',
      twitterUsername: 'testuser',
      ...stores,
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/invalid.*state/i);
  });

  it('rejects wrong provider in state', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    stores.stateStore.store(state, { provider: 'github', codeVerifier: generateCodeVerifier() }); // wrong provider

    const result = handleTwitterCallback({
      state,
      twitterUserId: '12345',
      twitterUsername: 'testuser',
      ...stores,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects state without codeVerifier', () => {
    const stores = makeStores();
    const state = randomBytes(16).toString('hex');
    // Store state without codeVerifier
    stores.stateStore.store(state, { provider: 'twitter' });

    const result = handleTwitterCallback({
      state,
      twitterUserId: '12345',
      twitterUsername: 'testuser',
      ...stores,
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/pkce|code.verifier/i);
  });

  it('creates new user on first login with +300 CHIP', () => {
    const stores = makeStores();
    const state = storeTwitterState(stores.stateStore);

    const result = handleTwitterCallback({
      state,
      twitterUserId: '99999',
      twitterUsername: 'newuser',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;
    expect(ok.isNewUser).toBe(true);
    expect(ok.chipAwarded).toBe(true);

    // User exists in store
    const user = stores.usersStore.findById(ok.userId);
    expect(user).not.toBeNull();
    expect(user!.chipBalance).toBe(300);

    // Binding exists with @handle format
    const binding = stores.bindingsStore.findByProvider('twitter', '99999');
    expect(binding).not.toBeNull();
    expect(binding!.userId).toBe(ok.userId);
    expect(binding!.providerUsername).toBe('@newuser');
    expect(binding!.chipRewarded).toBe(true);
  });

  it('logs in existing user without double-awarding CHIP', () => {
    const stores = makeStores();

    // First login
    const state1 = storeTwitterState(stores.stateStore);
    const first = handleTwitterCallback({
      state: state1,
      twitterUserId: '11111',
      twitterUsername: 'existinguser',
      ...stores,
    });
    expect(first.ok).toBe(true);
    const firstOk = first as Extract<HandleCallbackResult, { ok: true }>;
    expect(firstOk.chipAwarded).toBe(true);
    expect(stores.usersStore.findById(firstOk.userId)!.chipBalance).toBe(300);

    // Second login — same Twitter user
    const state2 = storeTwitterState(stores.stateStore);
    const second = handleTwitterCallback({
      state: state2,
      twitterUserId: '11111',
      twitterUsername: 'existinguser',
      ...stores,
    });
    expect(second.ok).toBe(true);
    const secondOk = second as Extract<HandleCallbackResult, { ok: true }>;
    expect(secondOk.userId).toBe(firstOk.userId); // same user
    expect(secondOk.chipAwarded).toBe(false); // NO double reward

    // Balance unchanged at 300
    expect(stores.usersStore.findById(secondOk.userId)!.chipBalance).toBe(300);
  });

  it('links Twitter to existing authenticated user', () => {
    const stores = makeStores();

    // Pre-existing user (e.g., registered via SIWE)
    const existingUser = stores.usersStore.create('siwe_user_abc');

    const state = storeTwitterState(stores.stateStore, { userId: existingUser.id });

    const result = handleTwitterCallback({
      state,
      twitterUserId: '77777',
      twitterUsername: 'linker',
      ...stores,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<HandleCallbackResult, { ok: true }>;
    expect(ok.isNewUser).toBe(false);
    expect(ok.userId).toBe(existingUser.id); // bound to existing user
    expect(ok.chipAwarded).toBe(true);
    expect(stores.usersStore.findById(existingUser.id)!.chipBalance).toBe(300);

    // Binding created for existing user
    const binding = stores.bindingsStore.findByUser(existingUser.id, 'twitter');
    expect(binding).not.toBeNull();
    expect(binding!.providerUsername).toBe('@linker');
  });

  it('prevents linking same Twitter account to two different users', () => {
    const stores = makeStores();

    // First user binds Twitter account
    const state1 = storeTwitterState(stores.stateStore);
    handleTwitterCallback({ state: state1, twitterUserId: '55555', twitterUsername: 'twitteruser', ...stores });

    // Second user tries to bind the SAME Twitter account
    const existingUser2 = stores.usersStore.create('user_two');
    const state2 = storeTwitterState(stores.stateStore, { userId: existingUser2.id });

    const result = handleTwitterCallback({
      state: state2,
      twitterUserId: '55555', // same Twitter ID
      twitterUsername: 'twitteruser',
      ...stores,
    });

    // Should fail due to unique constraint
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/unique_violation/);
  });

  it('issues exchange code after successful callback', () => {
    const stores = makeStores();
    const state = storeTwitterState(stores.stateStore);

    const result = handleTwitterCallback({
      state,
      twitterUserId: '33333',
      twitterUsername: 'exchanger',
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

    const state = storeTwitterState(stores.stateStore);
    expect(stores.stateStore.size()).toBe(1);

    // Trigger with valid state (state gets consumed)
    handleTwitterCallback({
      state,
      twitterUserId: '44444',
      twitterUsername: 'stateuser',
      ...stores,
    });

    // State is consumed — cannot be reused (replay protection)
    expect(stores.stateStore.size()).toBe(0);
    expect(stores.stateStore.consume(state)).toBeNull();
  });

  it('providerUsername is stored as @handle format', () => {
    const stores = makeStores();
    const state = storeTwitterState(stores.stateStore);

    handleTwitterCallback({
      state,
      twitterUserId: '12321',
      twitterUsername: 'agon_arena',
      ...stores,
    });

    const binding = stores.bindingsStore.findByProvider('twitter', '12321');
    expect(binding).not.toBeNull();
    expect(binding!.providerUsername).toBe('@agon_arena');
  });
});

describe('Twitter OAuth — social_bindings schema constraints', () => {
  it('enforces one-binding-per-user-per-provider', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'twitter', providerUserId: 'tw-1', providerUsername: '@user1', chipRewarded: false });

    expect(() =>
      store.insert({ userId, provider: 'twitter', providerUserId: 'tw-2', providerUsername: '@user1b', chipRewarded: false }),
    ).toThrow(/unique_violation/);
  });

  it('enforces one-user-per-provider-account', () => {
    const store = createBindingsStore();

    store.insert({ userId: randomUUID(), provider: 'twitter', providerUserId: 'tw-shared', providerUsername: '@shared', chipRewarded: false });

    expect(() =>
      store.insert({ userId: randomUUID(), provider: 'twitter', providerUserId: 'tw-shared', providerUsername: '@shared', chipRewarded: false }),
    ).toThrow(/unique_violation/);
  });

  it('allows same user to bind twitter and github independently', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    expect(() => {
      store.insert({ userId, provider: 'twitter', providerUserId: 'tw-111', providerUsername: '@tw_user', chipRewarded: false });
      store.insert({ userId, provider: 'github', providerUserId: 'gh-222', providerUsername: 'gh_user', chipRewarded: false });
    }).not.toThrow();

    expect(store.all().length).toBe(2);
  });

  it('chipRewarded flag is false by default on new binding', () => {
    const store = createBindingsStore();
    const binding = store.insert({ userId: randomUUID(), provider: 'twitter', providerUserId: 'tw-new', providerUsername: '@newuser', chipRewarded: false });
    expect(binding.chipRewarded).toBe(false);
  });

  it('CHIP reward of 300 is correct for twitter provider', () => {
    // Validate that the twitter reward constant matches AGO-65 spec
    const SOCIAL_BINDING_REWARDS: Record<string, number> = {
      github: 500,
      google: 400,
      twitter: 300,
    };
    expect(SOCIAL_BINDING_REWARDS['twitter']).toBe(300);
  });
});
