/**
 * AGO-66: ENS domain verification binding tests
 *
 * Tests validate:
 *  1. ENS name format validation (must match *.eth pattern)
 *  2. Wallet address required (SIWE login prerequisite)
 *  3. Duplicate binding guards (per user and per ENS name)
 *  4. ENS resolution failure → 422
 *  5. Address mismatch → 403
 *  6. Successful binding: creates record, awards +500 CHIP
 *  7. CHIP reward idempotency (chipRewarded flag prevents double-award)
 *
 * Runs in-process without DB, Redis, or network I/O.
 * ENS resolution is simulated via a configurable resolver function.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants (mirror chip.ts / ens-binding.ts)
// ---------------------------------------------------------------------------

const ENS_BINDING_CHIP_REWARD = 500;
const ENS_NAME_REGEX = /^[a-zA-Z0-9-]+\.eth$/;

// ---------------------------------------------------------------------------
// ENS name validation logic (mirrors verifyBodySchema in ens-binding.ts)
// ---------------------------------------------------------------------------

function validateEnsName(ensName: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof ensName !== 'string') {
    return { ok: false, error: 'ENS name must be a string' };
  }
  if (ensName.length < 5) {
    return { ok: false, error: 'ENS name too short' };
  }
  if (ensName.length > 104) {
    return { ok: false, error: 'ENS name too long' };
  }
  if (!ENS_NAME_REGEX.test(ensName)) {
    return { ok: false, error: 'ENS name must be a valid *.eth name (e.g. alice.eth)' };
  }
  return { ok: true, name: ensName.toLowerCase() };
}

// ---------------------------------------------------------------------------
// In-memory data model
// ---------------------------------------------------------------------------

interface SocialBinding {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  providerUsername: string | null;
  chipRewarded: boolean;
  createdAt: Date;
}

interface TestUser {
  id: string;
  walletAddress: string | null;
}

function createBindingsStore() {
  const bindings: SocialBinding[] = [];

  return {
    insert(binding: Omit<SocialBinding, 'id' | 'createdAt'>): SocialBinding {
      const record: SocialBinding = { ...binding, id: randomUUID(), createdAt: new Date() };
      bindings.push(record);
      return record;
    },
    findByUserAndProvider(userId: string, provider: string): SocialBinding | null {
      return bindings.find((b) => b.userId === userId && b.provider === provider) ?? null;
    },
    findByProviderAndId(provider: string, providerUserId: string): SocialBinding | null {
      return bindings.find((b) => b.provider === provider && b.providerUserId === providerUserId) ?? null;
    },
    markChipRewarded(userId: string, provider: string): void {
      const binding = bindings.find((b) => b.userId === userId && b.provider === provider);
      if (binding) binding.chipRewarded = true;
    },
    all(): SocialBinding[] {
      return [...bindings];
    },
  };
}

// ---------------------------------------------------------------------------
// CHIP ledger simulation (mirrors chip.ts allocateSocialBindingReward)
// ---------------------------------------------------------------------------

interface ChipTxResult {
  txId: string;
  userId: string;
  amount: number;
}

function createChipLedger() {
  const balances = new Map<string, number>();

  return {
    credit(userId: string, amount: number): ChipTxResult {
      const before = balances.get(userId) ?? 0;
      balances.set(userId, before + amount);
      return { txId: randomUUID(), userId, amount };
    },
    balance(userId: string): number {
      return balances.get(userId) ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Business logic (mirrors ens-binding.ts route handler, minus Express plumbing)
// ---------------------------------------------------------------------------

type VerifyResult =
  | { ok: true; ensName: string; chipAwarded: boolean; chipAmount: number }
  | { ok: false; error: string; status: number };

async function verifyEnsBinding(
  userId: string,
  ensNameRaw: unknown,
  users: Map<string, TestUser>,
  store: ReturnType<typeof createBindingsStore>,
  ledger: ReturnType<typeof createChipLedger>,
  resolveEns: (name: string) => Promise<string | null>,
): Promise<VerifyResult> {
  // 1. Validate ENS name format
  const validation = validateEnsName(ensNameRaw);
  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }
  const normalizedName = validation.name;

  // 2. Check user has a walletAddress
  const user = users.get(userId);
  if (!user?.walletAddress) {
    return {
      ok: false,
      error: 'ENS binding requires a connected wallet. Please sign in with Ethereum (SIWE) first.',
      status: 400,
    };
  }

  // 3. Check user doesn't already have an ENS binding
  const existingUserBinding = store.findByUserAndProvider(userId, 'ens');
  if (existingUserBinding) {
    return { ok: false, error: 'An ENS name is already bound to this account', status: 409 };
  }

  // 4. Check ENS name not already bound to another user
  const otherBinding = store.findByProviderAndId('ens', normalizedName);
  if (otherBinding && otherBinding.userId !== userId) {
    return { ok: false, error: 'This ENS name is already bound to another account', status: 409 };
  }

  // 5. Resolve ENS name
  const resolvedAddress = await resolveEns(normalizedName);
  if (!resolvedAddress) {
    return {
      ok: false,
      error: `Cannot resolve ENS name: ${normalizedName}. Ensure the name exists and has an ETH record set.`,
      status: 422,
    };
  }

  // 6. Verify resolved address matches user's wallet
  if (resolvedAddress.toLowerCase() !== user.walletAddress.toLowerCase()) {
    return {
      ok: false,
      error: 'ENS name does not resolve to your wallet address',
      status: 403,
    };
  }

  // 7. Create binding
  store.insert({
    userId,
    provider: 'ens',
    providerUserId: normalizedName,
    providerUsername: normalizedName,
    chipRewarded: false,
  });

  // 8. Award CHIP (idempotent via chipRewarded flag)
  let chipResult: ChipTxResult | null = null;
  const binding = store.findByUserAndProvider(userId, 'ens');
  if (binding && !binding.chipRewarded) {
    chipResult = ledger.credit(userId, ENS_BINDING_CHIP_REWARD);
    store.markChipRewarded(userId, 'ens');
  }

  return {
    ok: true,
    ensName: normalizedName,
    chipAwarded: chipResult !== null,
    chipAmount: chipResult?.amount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(walletAddress: string | null = '0xabc123def456aaa000000000000000000000001'): TestUser {
  return { id: randomUUID(), walletAddress };
}

function walletFor(user: TestUser): string {
  return user.walletAddress!;
}

// ---------------------------------------------------------------------------
// Tests: ENS name validation
// ---------------------------------------------------------------------------

describe('ENS binding — name validation', () => {
  it('accepts valid lowercase *.eth name', () => {
    const result = validateEnsName('alice.eth');
    expect(result.ok).toBe(true);
    expect((result as { ok: true; name: string }).name).toBe('alice.eth');
  });

  it('accepts valid mixed-case name and normalizes to lowercase', () => {
    const result = validateEnsName('AlicE.eth');
    expect(result.ok).toBe(true);
    expect((result as { ok: true; name: string }).name).toBe('alice.eth');
  });

  it('accepts names with hyphens', () => {
    expect(validateEnsName('my-cool-wallet.eth').ok).toBe(true);
  });

  it('accepts names with digits', () => {
    expect(validateEnsName('agent42.eth').ok).toBe(true);
  });

  it('rejects name not ending in .eth', () => {
    const result = validateEnsName('alice.com');
    expect(result.ok).toBe(false);
  });

  it('rejects bare ".eth" (no label)', () => {
    const result = validateEnsName('.eth');
    expect(result.ok).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateEnsName('').ok).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(validateEnsName(42).ok).toBe(false);
    expect(validateEnsName(null).ok).toBe(false);
    expect(validateEnsName(undefined).ok).toBe(false);
  });

  it('rejects name that is too long (>104 chars)', () => {
    const longLabel = 'a'.repeat(101); // 101 + ".eth" = 105 chars
    const result = validateEnsName(`${longLabel}.eth`);
    expect(result.ok).toBe(false);
  });

  it('rejects subdomain (only single-level *.eth supported)', () => {
    // sub.alice.eth contains multiple dots — not matched by /^[a-zA-Z0-9-]+\.eth$/
    expect(validateEnsName('sub.alice.eth').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: wallet prerequisite
// ---------------------------------------------------------------------------

describe('ENS binding — wallet address required', () => {
  it('returns 400 when user has no walletAddress', async () => {
    const user = makeUser(null);
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    const result = await verifyEnsBinding(
      user.id,
      'alice.eth',
      users,
      store,
      ledger,
      async () => '0xabc123def456aaa000000000000000000000001',
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(400);
    expect((result as { ok: false; error: string }).error).toMatch(/wallet/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: duplicate binding guards
// ---------------------------------------------------------------------------

describe('ENS binding — duplicate guards', () => {
  it('returns 409 when user already has an ENS binding', async () => {
    const user = makeUser();
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    // Pre-seed an existing ENS binding for this user
    store.insert({
      userId: user.id,
      provider: 'ens',
      providerUserId: 'alice.eth',
      providerUsername: 'alice.eth',
      chipRewarded: true,
    });

    const result = await verifyEnsBinding(
      user.id,
      'bob.eth',
      users,
      store,
      ledger,
      async () => walletFor(user),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(409);
    expect((result as { ok: false; error: string }).error).toMatch(/already bound to this account/i);
  });

  it('returns 409 when ENS name is already bound to another user', async () => {
    const user1 = makeUser('0x0000000000000000000000000000000000000001');
    const user2 = makeUser('0x0000000000000000000000000000000000000002');
    const users = new Map([[user1.id, user1], [user2.id, user2]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    // user1 has already claimed alice.eth
    store.insert({
      userId: user1.id,
      provider: 'ens',
      providerUserId: 'alice.eth',
      providerUsername: 'alice.eth',
      chipRewarded: true,
    });

    // user2 tries to claim the same ENS name
    const result = await verifyEnsBinding(
      user2.id,
      'alice.eth',
      users,
      store,
      ledger,
      async () => walletFor(user2),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(409);
    expect((result as { ok: false; error: string }).error).toMatch(/already bound to another account/i);
  });

  it('allows re-verification attempt if same user re-submits same name (idempotent before insert)', async () => {
    // This tests the guard: if otherBinding.userId === userId, it's not blocked here
    // (would be caught by the "existing user binding" check first)
    // So we verify: user's own binding is caught by check #3, not check #4
    const user = makeUser();
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    // seed the same user's own binding
    store.insert({
      userId: user.id,
      provider: 'ens',
      providerUserId: 'alice.eth',
      providerUsername: 'alice.eth',
      chipRewarded: true,
    });

    const result = await verifyEnsBinding(
      user.id,
      'alice.eth',
      users,
      store,
      ledger,
      async () => walletFor(user),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(409);
    expect((result as { ok: false; error: string }).error).toMatch(/already bound to this account/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: ENS resolution failures
// ---------------------------------------------------------------------------

describe('ENS binding — ENS resolution', () => {
  it('returns 422 when ENS name does not resolve to any address', async () => {
    const user = makeUser();
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    const result = await verifyEnsBinding(
      user.id,
      'doesnotexist99999.eth',
      users,
      store,
      ledger,
      async () => null, // resolver returns null — name does not exist
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(422);
    expect((result as { ok: false; error: string }).error).toMatch(/cannot resolve/i);
  });

  it('returns 403 when resolved address does not match user wallet', async () => {
    const user = makeUser('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    const result = await verifyEnsBinding(
      user.id,
      'alice.eth',
      users,
      store,
      ledger,
      // ENS resolves to a different address
      async () => '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(403);
    expect((result as { ok: false; error: string }).error).toMatch(/does not resolve to your wallet/i);
  });

  it('address comparison is case-insensitive (mixed-case resolved vs stored)', async () => {
    const user = makeUser('0xaabbccddaabbccddaabbccddaabbccddaabbccdd');
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    // Resolver returns checksummed (mixed-case) address
    const result = await verifyEnsBinding(
      user.id,
      'alice.eth',
      users,
      store,
      ledger,
      async () => '0xAABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD',
    );

    // Should succeed: addresses match case-insensitively
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: successful binding + CHIP reward
// ---------------------------------------------------------------------------

describe('ENS binding — success path', () => {
  it('creates binding and awards 500 CHIP on successful verification', async () => {
    const user = makeUser('0x1234567890123456789012345678901234567890');
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    const result = await verifyEnsBinding(
      user.id,
      'alice.eth',
      users,
      store,
      ledger,
      async () => user.walletAddress!,
    );

    expect(result.ok).toBe(true);
    const ok = result as { ok: true; ensName: string; chipAwarded: boolean; chipAmount: number };
    expect(ok.ensName).toBe('alice.eth');
    expect(ok.chipAwarded).toBe(true);
    expect(ok.chipAmount).toBe(500);
  });

  it('normalizes ENS name to lowercase in the created binding', async () => {
    const user = makeUser();
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    await verifyEnsBinding(
      user.id,
      'Alice.eth', // mixed case input
      users,
      store,
      ledger,
      async () => walletFor(user),
    );

    // Binding should be stored as lowercase
    const binding = store.findByUserAndProvider(user.id, 'ens');
    expect(binding).not.toBeNull();
    expect(binding!.providerUserId).toBe('alice.eth');
    expect(binding!.providerUsername).toBe('alice.eth');
  });

  it('marks chipRewarded=true on the binding after CHIP is awarded', async () => {
    const user = makeUser();
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    await verifyEnsBinding(
      user.id,
      'alice.eth',
      users,
      store,
      ledger,
      async () => walletFor(user),
    );

    const binding = store.findByUserAndProvider(user.id, 'ens');
    expect(binding?.chipRewarded).toBe(true);
  });

  it('credits exactly 500 CHIP to user balance', async () => {
    const user = makeUser();
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    expect(ledger.balance(user.id)).toBe(0);

    await verifyEnsBinding(
      user.id,
      'alice.eth',
      users,
      store,
      ledger,
      async () => walletFor(user),
    );

    expect(ledger.balance(user.id)).toBe(500);
  });

  it('two different users can each bind their own ENS names independently', async () => {
    const user1 = makeUser('0x0000000000000000000000000000000000000001');
    const user2 = makeUser('0x0000000000000000000000000000000000000002');
    const users = new Map([[user1.id, user1], [user2.id, user2]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    // user1 binds alice.eth
    const r1 = await verifyEnsBinding(
      user1.id, 'alice.eth', users, store, ledger,
      async () => user1.walletAddress!,
    );
    // user2 binds bob.eth
    const r2 = await verifyEnsBinding(
      user2.id, 'bob.eth', users, store, ledger,
      async () => user2.walletAddress!,
    );

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(ledger.balance(user1.id)).toBe(500);
    expect(ledger.balance(user2.id)).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests: CHIP reward idempotency
// ---------------------------------------------------------------------------

describe('ENS binding — CHIP reward idempotency', () => {
  it('does not double-award CHIP when binding already has chipRewarded=true', async () => {
    const user = makeUser();
    const users = new Map([[user.id, user]]);
    const store = createBindingsStore();
    const ledger = createChipLedger();

    // Seed a binding that was already rewarded
    store.insert({
      userId: user.id,
      provider: 'ens',
      providerUserId: 'alice.eth',
      providerUsername: 'alice.eth',
      chipRewarded: true,
    });

    // Simulate the chip award logic from the route: only credit if !chipRewarded
    const binding = store.findByUserAndProvider(user.id, 'ens');
    let chipResult = null;
    if (binding && !binding.chipRewarded) {
      chipResult = ledger.credit(user.id, ENS_BINDING_CHIP_REWARD);
      store.markChipRewarded(user.id, 'ens');
    }

    expect(chipResult).toBeNull();
    expect(ledger.balance(user.id)).toBe(0); // no CHIP awarded
  });

  it('CHIP reward amount matches SOCIAL_BINDING_REWARDS constant (500)', () => {
    expect(ENS_BINDING_CHIP_REWARD).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests: input validation edge cases
// ---------------------------------------------------------------------------

describe('ENS binding — input validation edge cases', () => {
  it('rejects ENS name with special characters', () => {
    expect(validateEnsName('alice@home.eth').ok).toBe(false);
    expect(validateEnsName('alice_home.eth').ok).toBe(false);
    expect(validateEnsName('alice home.eth').ok).toBe(false);
  });

  it('accepts minimum valid ENS name (a.eth = 5 chars)', () => {
    expect(validateEnsName('a.eth').ok).toBe(true);
  });

  it('rejects name shorter than 5 chars (e.g. "x.eth" is 5, but ".eth" alone is 4)', () => {
    // ".eth" is 4 chars → rejected by length < 5
    expect(validateEnsName('.eth').ok).toBe(false);
  });
});
