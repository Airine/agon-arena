import { describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

const FREE_LIMIT = 100;
const MAX_ATTEMPTS = 5;

interface OtpRecord {
  email: string;
  code: string;
  attempts: number;
  consumed: boolean;
  expiresAt: number;
}

function createOtpStore(now = () => Date.now()) {
  const records = new Map<string, OtpRecord>();
  const cooldowns = new Map<string, number>();

  return {
    request(email: string, code: string, ttlMs = 600_000, cooldownMs = 60_000) {
      const normalized = email.toLowerCase();
      const cooldownUntil = cooldowns.get(normalized) ?? 0;
      if (cooldownUntil > now()) {
        return { ok: false as const, cooldownMs: cooldownUntil - now() };
      }
      records.set(normalized, {
        email: normalized,
        code,
        attempts: 0,
        consumed: false,
        expiresAt: now() + ttlMs,
      });
      cooldowns.set(normalized, now() + cooldownMs);
      return { ok: true as const };
    },
    verify(email: string, code: string) {
      const record = records.get(email.toLowerCase());
      if (!record || record.consumed || record.expiresAt <= now()) return 'expired';
      if (record.attempts >= MAX_ATTEMPTS) return 'too_many_attempts';
      if (record.code !== code) {
        record.attempts += 1;
        return record.attempts >= MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code';
      }
      record.consumed = true;
      return 'ok';
    },
    restore(email: string, code: string, ttlMs = 600_000) {
      const normalized = email.toLowerCase();
      records.set(normalized, {
        email: normalized,
        code,
        attempts: 0,
        consumed: false,
        expiresAt: now() + ttlMs,
      });
    },
  };
}

interface User {
  id: string;
  email: string | null;
  walletAddress: string | null;
  inviteGateSatisfiedAt: Date | null;
  invitedByCodeId: string | null;
}

interface InviteCode {
  id: string;
  code: string;
  createdByUserId: string;
  usedByUserId: string | null;
}

function createGateStore() {
  const users = new Map<string, User>();
  const codes = new Map<string, InviteCode>();

  function gatedCount() {
    return [...users.values()].filter((user) => user.inviteGateSatisfiedAt !== null).length;
  }

  function satisfyGate(userId: string, inviteCode?: string) {
    const user = users.get(userId)!;
    if (user.inviteGateSatisfiedAt) return { ok: true, reason: 'already_satisfied' };
    if (gatedCount() < FREE_LIMIT) {
      user.inviteGateSatisfiedAt = new Date();
      return { ok: true, reason: 'free_early' };
    }
    if (!inviteCode) return { ok: false, error: 'invite_required' };
    const code = codes.get(inviteCode);
    if (!code) return { ok: false, error: 'invalid_invite_code' };
    if (code.usedByUserId) return { ok: false, error: 'invite_code_used' };
    if (code.createdByUserId === userId) return { ok: false, error: 'self_invite' };
    code.usedByUserId = userId;
    user.invitedByCodeId = code.id;
    user.inviteGateSatisfiedAt = new Date();
    return { ok: true, reason: 'invite_code' };
  }

  return {
    addUser(input: Partial<User> = {}) {
      const id = input.id ?? randomUUID();
      const user: User = {
        id,
        email: input.email ?? null,
        walletAddress: input.walletAddress ?? null,
        inviteGateSatisfiedAt: input.inviteGateSatisfiedAt ?? null,
        invitedByCodeId: input.invitedByCodeId ?? null,
      };
      users.set(id, user);
      return user;
    },
    addInvite(createdByUserId: string, code = `AGON-${randomUUID().slice(0, 4).toUpperCase()}-TEST`) {
      const record: InviteCode = { id: randomUUID(), code, createdByUserId, usedByUserId: null };
      codes.set(code, record);
      return record;
    },
    satisfyGate,
    gatedCount,
  };
}

describe('email OTP flow', () => {
  it('enforces cooldown between code requests', () => {
    let now = 1_000;
    const store = createOtpStore(() => now);

    expect(store.request('alice@example.com', '123456').ok).toBe(true);
    const second = store.request('alice@example.com', '654321');
    expect(second.ok).toBe(false);
    now += 61_000;
    expect(store.request('alice@example.com', '654321').ok).toBe(true);
  });

  it('consumes a valid code exactly once', () => {
    const store = createOtpStore();
    store.request('alice@example.com', '123456');

    expect(store.verify('alice@example.com', '123456')).toBe('ok');
    expect(store.verify('alice@example.com', '123456')).toBe('expired');
  });

  it('locks out after the maximum number of invalid attempts', () => {
    const store = createOtpStore();
    store.request('alice@example.com', '123456');

    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect(store.verify('alice@example.com', '000000')).toBe('invalid_code');
    }
    expect(store.verify('alice@example.com', '000000')).toBe('too_many_attempts');
  });
});

describe('invite gate for human-controlled entries', () => {
  it('lets the first 100 gated users register without an invite', () => {
    const store = createGateStore();
    for (let i = 0; i < FREE_LIMIT - 1; i++) {
      const user = store.addUser();
      expect(store.satisfyGate(user.id)).toEqual({ ok: true, reason: 'free_early' });
    }

    const hundredth = store.addUser();
    expect(store.satisfyGate(hundredth.id)).toEqual({ ok: true, reason: 'free_early' });
  });

  it('requires a valid unused invite after the free window', () => {
    const store = createGateStore();
    for (let i = 0; i < FREE_LIMIT; i++) {
      const user = store.addUser();
      store.satisfyGate(user.id);
    }

    const referrer = store.addUser({ inviteGateSatisfiedAt: new Date() });
    const invite = store.addInvite(referrer.id, 'AGON-ABCD-EFGH');
    const user = store.addUser();

    expect(store.satisfyGate(user.id)).toEqual({ ok: false, error: 'invite_required' });
    expect(store.satisfyGate(user.id, invite.code)).toEqual({ ok: true, reason: 'invite_code' });
    expect(invite.usedByUserId).toBe(user.id);
  });

  it('does not count pure wallet users against the first 100 invite gate quota', () => {
    const store = createGateStore();
    for (let i = 0; i < 200; i++) {
      store.addUser({ walletAddress: `0x${String(i).padStart(40, '0')}` });
    }

    expect(store.gatedCount()).toBe(0);
    const firstHuman = store.addUser({ email: 'first@example.com' });
    expect(store.satisfyGate(firstHuman.id)).toEqual({ ok: true, reason: 'free_early' });
  });

  it('requires a gate only once when binding email and wallet later', () => {
    const store = createGateStore();
    const user = store.addUser({ email: 'alice@example.com' });

    expect(store.satisfyGate(user.id)).toEqual({ ok: true, reason: 'free_early' });
    expect(store.satisfyGate(user.id)).toEqual({ ok: true, reason: 'already_satisfied' });
  });

  it('keeps a verified code usable after an invite-gate failure so the user can add a code', () => {
    const otp = createOtpStore();
    const gate = createGateStore();
    for (let i = 0; i < FREE_LIMIT; i++) {
      const user = gate.addUser();
      gate.satisfyGate(user.id);
    }

    const newUser = gate.addUser({ email: 'late@example.com' });
    otp.request('late@example.com', '123456');

    expect(otp.verify('late@example.com', '123456')).toBe('ok');
    expect(gate.satisfyGate(newUser.id)).toEqual({ ok: false, error: 'invite_required' });

    otp.restore('late@example.com', '123456');
    const referrer = gate.addUser({ inviteGateSatisfiedAt: new Date() });
    const invite = gate.addInvite(referrer.id, 'AGON-LATE-USER');

    expect(otp.verify('late@example.com', '123456')).toBe('ok');
    expect(gate.satisfyGate(newUser.id, invite.code)).toEqual({ ok: true, reason: 'invite_code' });
  });
});
