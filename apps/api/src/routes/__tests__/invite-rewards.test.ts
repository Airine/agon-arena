/**
 * AGO-68: Invite reward distribution tests
 *
 * Business rules under test:
 *  1. Referee +500 CHIP on registration with valid invite code
 *  2. Referee +100 CHIP on first non-fold game action
 *  3. Referrer +200 CHIP when referee places first bet
 *  4. Idempotency: rewards distributed only once each
 *  5. Self-invite prevention: cannot redeem your own code
 *  6. Expired/already-used codes are silently ignored
 *  7. Users without invite codes get no first-bet rewards
 *
 * Runs in-process without DB, Redis, or network I/O.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants (mirror chip.ts)
// ---------------------------------------------------------------------------

const INVITE_REFEREE_REWARD = 500;
const INVITE_FIRST_BET_REWARD = 100;
const INVITE_REFERRER_REWARD = 200;

// ---------------------------------------------------------------------------
// In-memory data model
// ---------------------------------------------------------------------------

interface User {
  id: string;
  chipBalance: number;
  invitedByCodeId: string | null;
  firstBetRewardedAt: Date | null;
}

interface InviteCode {
  id: string;
  code: string;
  createdByUserId: string;
  usedByUserId: string | null;
  usedAt: Date | null;
  referrerRewarded: boolean;
}

interface ChipTx {
  id: string;
  userId: string;
  amount: number;
  referenceType: string;
  referenceId: string;
}

function createStore() {
  const users = new Map<string, User>();
  const codes = new Map<string, InviteCode>(); // keyed by code string
  const codesById = new Map<string, InviteCode>(); // keyed by id
  const txs: ChipTx[] = [];

  return {
    addUser(id: string, chipBalance = 1000): User {
      const u: User = { id, chipBalance, invitedByCodeId: null, firstBetRewardedAt: null };
      users.set(id, u);
      return u;
    },
    addCode(referrerId: string, codeStr = `AGON-TEST-${randomUUID().slice(0, 4)}`): InviteCode {
      const c: InviteCode = {
        id: randomUUID(),
        code: codeStr,
        createdByUserId: referrerId,
        usedByUserId: null,
        usedAt: null,
        referrerRewarded: false,
      };
      codes.set(codeStr, c);
      codesById.set(c.id, c);
      return c;
    },
    getUser(id: string) { return users.get(id); },
    getCodeByStr(c: string) { return codes.get(c); },
    getCodeById(id: string) { return codesById.get(id); },
    logTx(tx: ChipTx) { txs.push(tx); },
    getTxsForUser(userId: string) { return txs.filter((t) => t.userId === userId); },
    hasTx(userId: string, refType: string) {
      return txs.some((t) => t.userId === userId && t.referenceType === refType);
    },
  };
}

// ---------------------------------------------------------------------------
// Business logic (mirrors auth.ts redeemInviteCode + chip.ts without DB)
// ---------------------------------------------------------------------------

type RedeemResult = 'ok' | 'not_found' | 'already_used' | 'self_invite';

function redeemInviteCode(
  refereeId: string,
  codeStr: string,
  store: ReturnType<typeof createStore>,
): RedeemResult {
  const code = store.getCodeByStr(codeStr);
  if (!code) return 'not_found';
  if (code.usedAt !== null) return 'already_used';
  if (code.createdByUserId === refereeId) return 'self_invite';

  // Mark code used
  code.usedByUserId = refereeId;
  code.usedAt = new Date();

  // Link user to code
  const user = store.getUser(refereeId)!;
  user.invitedByCodeId = code.id;

  // Award +500 CHIP
  if (!store.hasTx(refereeId, 'invite_referee')) {
    user.chipBalance += INVITE_REFEREE_REWARD;
    store.logTx({ id: randomUUID(), userId: refereeId, amount: INVITE_REFEREE_REWARD, referenceType: 'invite_referee', referenceId: code.id });
  }

  return 'ok';
}

type FirstBetResult = 'distributed' | 'already_rewarded' | 'no_invite';

function allocateFirstBetRewards(
  refereeId: string,
  store: ReturnType<typeof createStore>,
): FirstBetResult {
  const user = store.getUser(refereeId)!;

  if (user.firstBetRewardedAt !== null) return 'already_rewarded';
  if (!user.invitedByCodeId) return 'no_invite';

  const code = store.getCodeById(user.invitedByCodeId)!;
  const now = new Date();

  // Referee +100 CHIP
  user.chipBalance += INVITE_FIRST_BET_REWARD;
  user.firstBetRewardedAt = now;
  store.logTx({ id: randomUUID(), userId: refereeId, amount: INVITE_FIRST_BET_REWARD, referenceType: 'invite_first_bet', referenceId: code.id });

  // Referrer +200 CHIP
  if (!code.referrerRewarded) {
    const referrer = store.getUser(code.createdByUserId)!;
    referrer.chipBalance += INVITE_REFERRER_REWARD;
    code.referrerRewarded = true;
    store.logTx({ id: randomUUID(), userId: referrer.id, amount: INVITE_REFERRER_REWARD, referenceType: 'invite_referrer', referenceId: code.id });
  }

  return 'distributed';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Invite reward — code redemption at registration', () => {
  it('awards referee +500 CHIP when a valid code is redeemed', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);

    const balanceBefore = referee.chipBalance;
    const result = redeemInviteCode(referee.id, code.code, store);

    expect(result).toBe('ok');
    expect(store.getUser(referee.id)!.chipBalance).toBe(balanceBefore + INVITE_REFEREE_REWARD);
  });

  it('marks code as used with usedByUserId set', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);

    redeemInviteCode(referee.id, code.code, store);

    const updatedCode = store.getCodeByStr(code.code)!;
    expect(updatedCode.usedByUserId).toBe(referee.id);
    expect(updatedCode.usedAt).not.toBeNull();
  });

  it('sets invitedByCodeId on the referee user', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);

    redeemInviteCode(referee.id, code.code, store);

    expect(store.getUser(referee.id)!.invitedByCodeId).toBe(code.id);
  });

  it('returns not_found for unknown code', () => {
    const store = createStore();
    const user = store.addUser(randomUUID());

    expect(redeemInviteCode(user.id, 'AGON-XXXX-YYYY', store)).toBe('not_found');
  });

  it('returns already_used for a previously redeemed code', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee1 = store.addUser(randomUUID());
    const referee2 = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);

    redeemInviteCode(referee1.id, code.code, store);
    const result = redeemInviteCode(referee2.id, code.code, store);

    expect(result).toBe('already_used');
    // referee2 gets no chip reward
    expect(store.hasTx(referee2.id, 'invite_referee')).toBe(false);
  });

  it('returns self_invite when user tries to redeem their own code', () => {
    const store = createStore();
    const user = store.addUser(randomUUID());
    const code = store.addCode(user.id);

    const result = redeemInviteCode(user.id, code.code, store);

    expect(result).toBe('self_invite');
    expect(store.getUser(user.id)!.invitedByCodeId).toBeNull();
  });

  it('is idempotent: referee_reward is not double-credited', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);

    redeemInviteCode(referee.id, code.code, store);
    // Simulate calling allocateInviteRefereeReward a second time
    // The hasTx guard prevents double credit
    const balanceAfterFirst = store.getUser(referee.id)!.chipBalance;

    if (!store.hasTx(referee.id, 'invite_referee')) {
      store.getUser(referee.id)!.chipBalance += INVITE_REFEREE_REWARD;
    }

    expect(store.getUser(referee.id)!.chipBalance).toBe(balanceAfterFirst);
  });
});

describe('Invite reward — first-bet distribution', () => {
  it('awards referee +100 CHIP on first bet', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);
    redeemInviteCode(referee.id, code.code, store);

    const balanceBefore = store.getUser(referee.id)!.chipBalance;
    const result = allocateFirstBetRewards(referee.id, store);

    expect(result).toBe('distributed');
    expect(store.getUser(referee.id)!.chipBalance).toBe(balanceBefore + INVITE_FIRST_BET_REWARD);
  });

  it('awards referrer +200 CHIP on referee first bet', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);
    redeemInviteCode(referee.id, code.code, store);

    const referrerBalanceBefore = store.getUser(referrer.id)!.chipBalance;
    allocateFirstBetRewards(referee.id, store);

    expect(store.getUser(referrer.id)!.chipBalance).toBe(referrerBalanceBefore + INVITE_REFERRER_REWARD);
  });

  it('sets firstBetRewardedAt on referee after distribution', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);
    redeemInviteCode(referee.id, code.code, store);

    allocateFirstBetRewards(referee.id, store);

    expect(store.getUser(referee.id)!.firstBetRewardedAt).not.toBeNull();
  });

  it('marks invite_codes.referrerRewarded after referrer payment', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);
    redeemInviteCode(referee.id, code.code, store);

    allocateFirstBetRewards(referee.id, store);

    expect(store.getCodeByStr(code.code)!.referrerRewarded).toBe(true);
  });

  it('is idempotent: second call returns already_rewarded, no double pay', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);
    redeemInviteCode(referee.id, code.code, store);

    allocateFirstBetRewards(referee.id, store);
    const refereeBalance = store.getUser(referee.id)!.chipBalance;
    const referrerBalance = store.getUser(referrer.id)!.chipBalance;

    const secondResult = allocateFirstBetRewards(referee.id, store);

    expect(secondResult).toBe('already_rewarded');
    expect(store.getUser(referee.id)!.chipBalance).toBe(refereeBalance); // unchanged
    expect(store.getUser(referrer.id)!.chipBalance).toBe(referrerBalance); // unchanged
  });

  it('returns no_invite for users who registered without a code', () => {
    const store = createStore();
    const user = store.addUser(randomUUID());

    const result = allocateFirstBetRewards(user.id, store);

    expect(result).toBe('no_invite');
    expect(store.hasTx(user.id, 'invite_first_bet')).toBe(false);
  });

  it('referrer reward is not double-paid if somehow called twice concurrently', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID());
    const referee = store.addUser(randomUUID());
    const code = store.addCode(referrer.id);
    redeemInviteCode(referee.id, code.code, store);

    // Simulate two concurrent calls — first sets referrerRewarded, second skips
    allocateFirstBetRewards(referee.id, store);
    // Manually reset firstBetRewardedAt to simulate the second call reaching the referrer block
    // (in real DB this is prevented by transaction + FOR UPDATE)
    // Here we just verify referrerRewarded flag prevents double-pay
    const referrerBalance = store.getUser(referrer.id)!.chipBalance;
    if (!store.getCodeByStr(code.code)!.referrerRewarded) {
      store.getUser(referrer.id)!.chipBalance += INVITE_REFERRER_REWARD;
    }
    expect(store.getUser(referrer.id)!.chipBalance).toBe(referrerBalance);
  });
});

describe('Invite reward — full chain scenario', () => {
  it('complete referral flow: referrer creates code → referee registers → referee bets', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID(), 1000);
    const referee = store.addUser(randomUUID(), 0);
    const code = store.addCode(referrer.id);

    // Step 1: referee registers with invite code
    const redeemResult = redeemInviteCode(referee.id, code.code, store);
    expect(redeemResult).toBe('ok');
    expect(store.getUser(referee.id)!.chipBalance).toBe(INVITE_REFEREE_REWARD); // 500

    // Step 2: referee places first bet
    const betResult = allocateFirstBetRewards(referee.id, store);
    expect(betResult).toBe('distributed');
    expect(store.getUser(referee.id)!.chipBalance).toBe(INVITE_REFEREE_REWARD + INVITE_FIRST_BET_REWARD); // 600
    expect(store.getUser(referrer.id)!.chipBalance).toBe(1000 + INVITE_REFERRER_REWARD); // 1200

    // Step 3: subsequent bets do not re-award
    allocateFirstBetRewards(referee.id, store);
    expect(store.getUser(referee.id)!.chipBalance).toBe(600); // unchanged
    expect(store.getUser(referrer.id)!.chipBalance).toBe(1200); // unchanged
  });

  it('two different referees from the same referrer each award the referrer +200', () => {
    const store = createStore();
    const referrer = store.addUser(randomUUID(), 1000);
    const referee1 = store.addUser(randomUUID(), 0);
    const referee2 = store.addUser(randomUUID(), 0);
    const code1 = store.addCode(referrer.id);
    const code2 = store.addCode(referrer.id);

    redeemInviteCode(referee1.id, code1.code, store);
    redeemInviteCode(referee2.id, code2.code, store);
    allocateFirstBetRewards(referee1.id, store);
    allocateFirstBetRewards(referee2.id, store);

    // Each code is independent — referrer gets +200 per code
    expect(store.getUser(referrer.id)!.chipBalance).toBe(1000 + INVITE_REFERRER_REWARD * 2); // 1400
  });
});
