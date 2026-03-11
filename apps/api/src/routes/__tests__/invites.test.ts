/**
 * AGO-67: Invite code generation tests
 *
 * Tests validate:
 *  1. Code format: "AGON-XXXX-XXXX" — uppercase, no ambiguous chars
 *  2. Max 5 codes per user
 *  3. Unverified user cannot generate codes
 *  4. Verified via wallet or social binding
 *  5. Collision resistance (unique code generation)
 *  6. List endpoint returns stats (used/unused/canGenerate)
 *
 * Runs in-process without DB, Redis, or network I/O.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CODES_PER_USER = 5;
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_REGEX = /^AGON-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

// ---------------------------------------------------------------------------
// Code generation logic (mirrors invites.ts)
// ---------------------------------------------------------------------------

function generateInviteCode(): string {
  const buf = randomBytes(8);
  let chars = '';
  for (const byte of buf) {
    chars += SAFE_CHARS[byte % SAFE_CHARS.length];
  }
  return `AGON-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

// ---------------------------------------------------------------------------
// In-memory data model
// ---------------------------------------------------------------------------

interface InviteCode {
  id: string;
  code: string;
  createdByUserId: string;
  usedByUserId: string | null;
  usedAt: Date | null;
  referrerRewarded: boolean;
  createdAt: Date;
}

interface TestUser {
  id: string;
  walletAddress: string | null;
  socialBindings: string[]; // provider names
}

function createInviteStore() {
  const codes: InviteCode[] = [];
  const usedCodes = new Set<string>();

  return {
    insert(code: string, userId: string): InviteCode | null {
      if (codes.find((c) => c.code === code)) return null; // collision
      const record: InviteCode = {
        id: randomUUID(),
        code,
        createdByUserId: userId,
        usedByUserId: null,
        usedAt: null,
        referrerRewarded: false,
        createdAt: new Date(),
      };
      codes.push(record);
      return record;
    },
    countByUser(userId: string): number {
      return codes.filter((c) => c.createdByUserId === userId).length;
    },
    listByUser(userId: string): InviteCode[] {
      return codes.filter((c) => c.createdByUserId === userId);
    },
    markUsed(code: string, byUserId: string): boolean {
      const record = codes.find((c) => c.code === code);
      if (!record || record.usedAt) return false;
      record.usedByUserId = byUserId;
      record.usedAt = new Date();
      usedCodes.add(code);
      return true;
    },
    all(): InviteCode[] {
      return [...codes];
    },
  };
}

// ---------------------------------------------------------------------------
// Business logic (mirrors invites.ts without Express)
// ---------------------------------------------------------------------------

type GenerateResult =
  | { ok: true; codes: string[]; total: number; remaining: number }
  | { ok: false; error: string; status: number };

function generateCodes(
  user: TestUser,
  store: ReturnType<typeof createInviteStore>,
  requestedCount?: number,
): GenerateResult {
  // Verification check
  const isVerified = Boolean(user.walletAddress) || user.socialBindings.length > 0;
  if (!isVerified) {
    return {
      ok: false,
      error: 'Account not verified. Link a wallet (SIWE) or a social account before generating invite codes.',
      status: 403,
    };
  }

  const existing = store.countByUser(user.id);
  const canGenerate = MAX_CODES_PER_USER - existing;

  if (canGenerate <= 0) {
    return {
      ok: false,
      error: `Maximum of ${MAX_CODES_PER_USER} invite codes already generated`,
      status: 409,
    };
  }

  const toGenerate = Math.min(requestedCount ?? canGenerate, canGenerate);
  if (toGenerate <= 0) {
    return { ok: false, error: 'count must be >= 1', status: 400 };
  }

  const newCodes: string[] = [];
  let attempts = 0;
  while (newCodes.length < toGenerate && attempts < toGenerate * 5) {
    attempts++;
    const code = generateInviteCode();
    const inserted = store.insert(code, user.id);
    if (inserted) newCodes.push(inserted.code);
  }

  return {
    ok: true,
    codes: newCodes,
    total: existing + newCodes.length,
    remaining: MAX_CODES_PER_USER - existing - newCodes.length,
  };
}

type ListResult = {
  codes: InviteCode[];
  stats: { total: number; used: number; unused: number; max: number; canGenerate: number };
};

function listCodes(userId: string, store: ReturnType<typeof createInviteStore>): ListResult {
  const codes = store.listByUser(userId);
  const used = codes.filter((c) => c.usedAt !== null).length;
  const unused = codes.filter((c) => c.usedAt === null).length;
  return {
    codes,
    stats: {
      total: codes.length,
      used,
      unused,
      max: MAX_CODES_PER_USER,
      canGenerate: MAX_CODES_PER_USER - codes.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Invite code — format validation', () => {
  it('generates codes matching AGON-XXXX-XXXX pattern', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(CODE_REGEX);
    }
  });

  it('random segments do not contain ambiguous characters (0, O, I, 1, L)', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      // Only validate the random portion (after the fixed "AGON-" brand prefix)
      const randomPart = code.replace(/^AGON-/, '');
      expect(randomPart).not.toMatch(/[0OI1L]/);
    }
  });

  it('codes are unique across many generations', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInviteCode()));
    // With 32^8 ≈ 1T possibilities, 1000 samples should not collide
    expect(codes.size).toBe(1000);
  });

  it('code is always exactly 14 characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateInviteCode()).toHaveLength(14);
    }
  });
});

describe('Invite code generation — verification gating', () => {
  it('allows wallet-verified users to generate codes', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: '0xabc', socialBindings: [] };

    const result = generateCodes(user, store);
    expect(result.ok).toBe(true);
  });

  it('allows socially-verified users (GitHub binding) to generate codes', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: null, socialBindings: ['github'] };

    const result = generateCodes(user, store);
    expect(result.ok).toBe(true);
  });

  it('rejects unverified users (no wallet, no social)', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: null, socialBindings: [] };

    const result = generateCodes(user, store);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string; status: number }).status).toBe(403);
  });
});

describe('Invite code generation — quota enforcement', () => {
  it('generates up to 5 codes when called with no count (fills to max)', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: '0xabc', socialBindings: [] };

    const result = generateCodes(user, store);
    expect(result.ok).toBe(true);
    const ok = result as { ok: true; codes: string[]; total: number; remaining: number };
    expect(ok.codes).toHaveLength(5);
    expect(ok.total).toBe(5);
    expect(ok.remaining).toBe(0);
  });

  it('generates partial batch when user already has some codes', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: '0xabc', socialBindings: [] };

    // Generate 3 first
    const first = generateCodes(user, store, 3) as { ok: true; codes: string[] };
    expect(first.codes).toHaveLength(3);

    // Generate remaining 2
    const second = generateCodes(user, store) as { ok: true; codes: string[]; total: number; remaining: number };
    expect(second.codes).toHaveLength(2);
    expect(second.total).toBe(5);
    expect(second.remaining).toBe(0);
  });

  it('rejects when user already has 5 codes', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: '0xabc', socialBindings: [] };

    generateCodes(user, store); // fills to 5

    const result = generateCodes(user, store);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string; status: number }).status).toBe(409);
  });

  it('respects requested count (generates fewer than max remaining)', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: '0xabc', socialBindings: [] };

    const result = generateCodes(user, store, 2) as { ok: true; codes: string[] };
    expect(result.codes).toHaveLength(2);
    expect(store.countByUser(user.id)).toBe(2);
  });

  it('two users each get their own independent 5-code quota', () => {
    const store = createInviteStore();
    const user1: TestUser = { id: randomUUID(), walletAddress: '0x111', socialBindings: [] };
    const user2: TestUser = { id: randomUUID(), walletAddress: '0x222', socialBindings: [] };

    generateCodes(user1, store); // fills user1 to 5
    const r2 = generateCodes(user2, store) as { ok: true; codes: string[] };

    expect(r2.codes).toHaveLength(5); // user2 gets their full 5
    expect(store.countByUser(user1.id)).toBe(5);
    expect(store.countByUser(user2.id)).toBe(5);
  });
});

describe('Invite code list endpoint', () => {
  it('returns empty list for new user', () => {
    const store = createInviteStore();
    const result = listCodes(randomUUID(), store);

    expect(result.codes).toHaveLength(0);
    expect(result.stats.total).toBe(0);
    expect(result.stats.canGenerate).toBe(5);
  });

  it('correctly counts used vs unused codes', () => {
    const store = createInviteStore();
    const user: TestUser = { id: randomUUID(), walletAddress: '0xabc', socialBindings: [] };

    generateCodes(user, store, 3);

    // Simulate using 1 code
    const codes = store.listByUser(user.id);
    store.markUsed(codes[0]!.code, randomUUID());

    const result = listCodes(user.id, store);
    expect(result.stats.total).toBe(3);
    expect(result.stats.used).toBe(1);
    expect(result.stats.unused).toBe(2);
    expect(result.stats.canGenerate).toBe(2);
  });

  it('does not expose another user\'s codes', () => {
    const store = createInviteStore();
    const user1: TestUser = { id: randomUUID(), walletAddress: '0xabc', socialBindings: [] };
    const user2Id = randomUUID();

    generateCodes(user1, store);

    const result = listCodes(user2Id, store);
    expect(result.codes).toHaveLength(0);
  });
});
