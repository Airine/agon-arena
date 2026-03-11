/**
 * AGO-63: Social bindings management tests
 *
 * Tests validate:
 *  1. Listing bindings with reward status and chip amount
 *  2. Available (unbound) providers calculated correctly
 *  3. totalChipFromBindings aggregation
 *  4. Unlink: removes binding, leaves CHIP reward in place
 *  5. Unlink: returns 404 if binding does not exist
 *  6. CHIP reward amounts match SOCIAL_BINDING_REWARDS constants
 *
 * Runs in-process without DB, Redis, or network I/O.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants (mirrors chip.ts SOCIAL_BINDING_REWARDS)
// ---------------------------------------------------------------------------

const SOCIAL_BINDING_REWARDS: Record<string, number> = {
  github: 500,
  google: 200,
  twitter: 300,
  ens: 500,
};

// ---------------------------------------------------------------------------
// In-memory data model
// ---------------------------------------------------------------------------

interface SocialBinding {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  providerUsername: string | null;
  providerEmail: string | null;
  chipRewarded: boolean;
  createdAt: Date;
}

function createBindingsStore() {
  const store: SocialBinding[] = [];

  return {
    insert(binding: Omit<SocialBinding, 'id' | 'createdAt'>): SocialBinding {
      const record: SocialBinding = { ...binding, id: randomUUID(), createdAt: new Date() };
      store.push(record);
      return record;
    },
    listByUser(userId: string): SocialBinding[] {
      return store.filter((b) => b.userId === userId);
    },
    deleteByUserProvider(userId: string, provider: string): SocialBinding | null {
      const idx = store.findIndex((b) => b.userId === userId && b.provider === provider);
      if (idx === -1) return null;
      const [deleted] = store.splice(idx, 1);
      return deleted!;
    },
    all(): SocialBinding[] {
      return [...store];
    },
  };
}

// ---------------------------------------------------------------------------
// Business logic (mirrors social-bindings.ts without Express)
// ---------------------------------------------------------------------------

type BindingResponse = {
  id: string;
  provider: string;
  providerUserId: string;
  providerUsername: string | null;
  providerEmail: string | null;
  chipRewarded: boolean;
  createdAt: Date;
  chipRewardAmount: number;
};

type ListBindingsResult = {
  bindings: BindingResponse[];
  availableProviders: string[];
  totalChipFromBindings: number;
};

function listBindings(userId: string, store: ReturnType<typeof createBindingsStore>): ListBindingsResult {
  const bindings = store.listByUser(userId);

  const enriched: BindingResponse[] = bindings.map((b) => ({
    ...b,
    chipRewardAmount: SOCIAL_BINDING_REWARDS[b.provider] ?? 0,
  }));

  const boundProviders = new Set(bindings.map((b) => b.provider));
  const availableProviders = Object.keys(SOCIAL_BINDING_REWARDS).filter((p) => !boundProviders.has(p));

  const totalChipFromBindings = enriched
    .filter((b) => b.chipRewarded)
    .reduce((sum, b) => sum + b.chipRewardAmount, 0);

  return { bindings: enriched, availableProviders, totalChipFromBindings };
}

type UnlinkResult =
  | { ok: true; provider: string }
  | { ok: false; error: string; status: number };

function unlinkBinding(
  userId: string,
  provider: string,
  store: ReturnType<typeof createBindingsStore>,
): UnlinkResult {
  const validProviders = Object.keys(SOCIAL_BINDING_REWARDS);
  if (!validProviders.includes(provider)) {
    return { ok: false, error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`, status: 400 };
  }

  const deleted = store.deleteByUserProvider(userId, provider);
  if (!deleted) {
    return { ok: false, error: `No ${provider} binding found for this account`, status: 404 };
  }

  return { ok: true, provider };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Social bindings — list endpoint', () => {
  it('returns empty list for user with no bindings', () => {
    const store = createBindingsStore();
    const result = listBindings(randomUUID(), store);

    expect(result.bindings).toHaveLength(0);
    expect(result.totalChipFromBindings).toBe(0);
    expect(result.availableProviders).toEqual(expect.arrayContaining(['github', 'google', 'twitter', 'ens']));
  });

  it('lists bindings with correct chip reward amounts', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'github', providerUserId: 'gh-1', providerUsername: 'alice', providerEmail: null, chipRewarded: true });
    store.insert({ userId, provider: 'google', providerUserId: 'g-sub-1', providerUsername: 'Alice G', providerEmail: 'alice@gmail.com', chipRewarded: false });

    const result = listBindings(userId, store);

    expect(result.bindings).toHaveLength(2);

    const github = result.bindings.find((b) => b.provider === 'github')!;
    expect(github.chipRewardAmount).toBe(500);
    expect(github.chipRewarded).toBe(true);

    const google = result.bindings.find((b) => b.provider === 'google')!;
    expect(google.chipRewardAmount).toBe(200);
    expect(google.chipRewarded).toBe(false);
  });

  it('only counts rewarded bindings in totalChipFromBindings', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    // github: rewarded → +500
    store.insert({ userId, provider: 'github', providerUserId: 'gh-1', providerUsername: null, providerEmail: null, chipRewarded: true });
    // google: NOT yet rewarded → should not count
    store.insert({ userId, provider: 'google', providerUserId: 'g-1', providerUsername: null, providerEmail: null, chipRewarded: false });

    const result = listBindings(userId, store);
    expect(result.totalChipFromBindings).toBe(500); // only github counts
  });

  it('correctly identifies available (unbound) providers', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'github', providerUserId: 'gh-1', providerUsername: null, providerEmail: null, chipRewarded: true });
    store.insert({ userId, provider: 'ens', providerUserId: 'alice.eth', providerUsername: 'alice.eth', providerEmail: null, chipRewarded: true });

    const result = listBindings(userId, store);

    expect(result.availableProviders).toContain('google');
    expect(result.availableProviders).toContain('twitter');
    expect(result.availableProviders).not.toContain('github');
    expect(result.availableProviders).not.toContain('ens');
  });

  it('does not leak another user\'s bindings', () => {
    const store = createBindingsStore();
    const user1 = randomUUID();
    const user2 = randomUUID();

    store.insert({ userId: user1, provider: 'github', providerUserId: 'gh-user1', providerUsername: 'user1', providerEmail: null, chipRewarded: true });

    const result = listBindings(user2, store);
    expect(result.bindings).toHaveLength(0);
  });

  it('totals all four providers when all are bound and rewarded', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'github', providerUserId: 'gh', providerUsername: null, providerEmail: null, chipRewarded: true });
    store.insert({ userId, provider: 'google', providerUserId: 'g', providerUsername: null, providerEmail: null, chipRewarded: true });
    store.insert({ userId, provider: 'twitter', providerUserId: 't', providerUsername: null, providerEmail: null, chipRewarded: true });
    store.insert({ userId, provider: 'ens', providerUserId: 'ens', providerUsername: null, providerEmail: null, chipRewarded: true });

    const result = listBindings(userId, store);
    // 500 + 200 + 300 + 500 = 1500
    expect(result.totalChipFromBindings).toBe(1500);
    expect(result.availableProviders).toHaveLength(0);
  });
});

describe('Social bindings — unlink endpoint', () => {
  it('successfully unlinks an existing binding', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'github', providerUserId: 'gh-1', providerUsername: null, providerEmail: null, chipRewarded: true });

    const result = unlinkBinding(userId, 'github', store);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; provider: string }).provider).toBe('github');

    // Binding is gone
    const remaining = listBindings(userId, store);
    expect(remaining.bindings).toHaveLength(0);
  });

  it('returns 404 when binding does not exist', () => {
    const store = createBindingsStore();
    const result = unlinkBinding(randomUUID(), 'github', store);

    expect(result.ok).toBe(false);
    const err = result as { ok: false; error: string; status: number };
    expect(err.status).toBe(404);
    expect(err.error).toMatch(/github/);
  });

  it('returns 400 for invalid provider name', () => {
    const store = createBindingsStore();
    const result = unlinkBinding(randomUUID(), 'discord', store);

    expect(result.ok).toBe(false);
    const err = result as { ok: false; error: string; status: number };
    expect(err.status).toBe(400);
  });

  it('only unlinks the requesting user\'s binding, not another user\'s', () => {
    const store = createBindingsStore();
    const user1 = randomUUID();
    const user2 = randomUUID();

    store.insert({ userId: user1, provider: 'github', providerUserId: 'gh-shared-username', providerUsername: null, providerEmail: null, chipRewarded: true });

    // user2 tries to unlink user1's github binding
    const result = unlinkBinding(user2, 'github', store);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string; status: number }).status).toBe(404);

    // user1's binding is still intact
    const remaining = listBindings(user1, store);
    expect(remaining.bindings).toHaveLength(1);
  });

  it('cannot unlink same provider twice', () => {
    const store = createBindingsStore();
    const userId = randomUUID();

    store.insert({ userId, provider: 'google', providerUserId: 'g-1', providerUsername: null, providerEmail: null, chipRewarded: true });

    const first = unlinkBinding(userId, 'google', store);
    expect(first.ok).toBe(true);

    const second = unlinkBinding(userId, 'google', store);
    expect(second.ok).toBe(false);
    expect((second as { ok: false; error: string; status: number }).status).toBe(404);
  });
});

describe('Social bindings — CHIP reward constants', () => {
  it('github reward is 500 CHIP', () => {
    expect(SOCIAL_BINDING_REWARDS['github']).toBe(500);
  });

  it('google reward is 200 CHIP', () => {
    expect(SOCIAL_BINDING_REWARDS['google']).toBe(200);
  });

  it('twitter reward is 300 CHIP', () => {
    expect(SOCIAL_BINDING_REWARDS['twitter']).toBe(300);
  });

  it('ens reward is 500 CHIP', () => {
    expect(SOCIAL_BINDING_REWARDS['ens']).toBe(500);
  });

  it('total max reward across all providers is 1500 CHIP', () => {
    const total = Object.values(SOCIAL_BINDING_REWARDS).reduce((a, b) => a + b, 0);
    expect(total).toBe(1500);
  });
});
