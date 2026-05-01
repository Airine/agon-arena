import { count, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type InviteGateReason = 'free_early' | 'invite_code' | 'legacy';

export class InviteGateError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InviteGateError';
  }
}

const DEFAULT_FREE_LIMIT = 100;
const INVITE_GATE_LOCK_ID = 770171;

function freeLimit(): number {
  const raw = process.env['INVITE_GATE_FREE_LIMIT'];
  const parsed = raw ? Number(raw) : DEFAULT_FREE_LIMIT;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_FREE_LIMIT;
}

function normalizeInviteCode(code: string | undefined): string | null {
  const normalized = code?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function inviteRequiredError(): InviteGateError {
  return new InviteGateError(
    403,
    'invite_required',
    'Invite code is required for new human accounts after the first 100 registrations',
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockInviteGate(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${INVITE_GATE_LOCK_ID})`);
}

async function gatedUserCount(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(schema.users)
    .where(sql`${schema.users.inviteGateSatisfiedAt} IS NOT NULL`);
  return Number(row?.total ?? 0);
}

async function resolveGate(tx: Tx, inviteCode: string | undefined, currentUserId?: string): Promise<{
  reason: InviteGateReason;
  inviteCodeId: string | null;
}> {
  if ((await gatedUserCount(tx)) < freeLimit()) {
    return { reason: 'free_early', inviteCodeId: null };
  }

  const normalizedCode = normalizeInviteCode(inviteCode);
  if (!normalizedCode) {
    throw inviteRequiredError();
  }

  const [codeRow] = await tx
    .select({
      id: schema.inviteCodes.id,
      createdByUserId: schema.inviteCodes.createdByUserId,
      usedByUserId: schema.inviteCodes.usedByUserId,
      usedAt: schema.inviteCodes.usedAt,
    })
    .from(schema.inviteCodes)
    .where(eq(schema.inviteCodes.code, normalizedCode))
    .limit(1);

  if (!codeRow) {
    throw new InviteGateError(400, 'invalid_invite_code', 'Invalid invite code');
  }
  if (codeRow.usedAt !== null || codeRow.usedByUserId !== null) {
    throw new InviteGateError(409, 'invite_code_used', 'Invite code has already been used');
  }
  if (currentUserId && codeRow.createdByUserId === currentUserId) {
    throw new InviteGateError(400, 'self_invite', 'You cannot redeem your own invite code');
  }

  return { reason: 'invite_code', inviteCodeId: codeRow.id };
}

export async function createHumanUserWithInviteGate(input: {
  username: string;
  email?: string | null;
  inviteCode?: string;
}): Promise<{
  user: { id: string; username: string; email: string | null };
  inviteCodeId: string | null;
  reason: InviteGateReason;
}> {
  return db.transaction(async (tx) => {
    await lockInviteGate(tx);
    const gate = await resolveGate(tx, input.inviteCode);
    const now = new Date();

    const [user] = await tx
      .insert(schema.users)
      .values({
        username: input.username,
        email: input.email ?? undefined,
        invitedByCodeId: gate.inviteCodeId ?? undefined,
        inviteGateSatisfiedAt: now,
        inviteGateReason: gate.reason,
      })
      .returning({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
      });

    if (!user) {
      throw new Error('Failed to create user account');
    }

    if (gate.inviteCodeId) {
      await tx
        .update(schema.inviteCodes)
        .set({ usedByUserId: user.id, usedAt: now })
        .where(eq(schema.inviteCodes.id, gate.inviteCodeId));
    }

    return { user, inviteCodeId: gate.inviteCodeId, reason: gate.reason };
  });
}

export async function satisfyInviteGateForUser(input: {
  userId: string;
  inviteCode?: string;
}): Promise<{ satisfied: boolean; inviteCodeId: string | null; reason: InviteGateReason | null }> {
  return db.transaction(async (tx) => {
    await lockInviteGate(tx);

    const [user] = await tx
      .select({
        id: schema.users.id,
        inviteGateSatisfiedAt: schema.users.inviteGateSatisfiedAt,
        inviteGateReason: schema.users.inviteGateReason,
      })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);

    if (!user) {
      throw new InviteGateError(404, 'user_not_found', 'User not found');
    }

    if (user.inviteGateSatisfiedAt) {
      return {
        satisfied: true,
        inviteCodeId: null,
        reason: user.inviteGateReason as InviteGateReason | null,
      };
    }

    const gate = await resolveGate(tx, input.inviteCode, input.userId);
    const now = new Date();

    await tx
      .update(schema.users)
      .set({
        invitedByCodeId: gate.inviteCodeId ?? undefined,
        inviteGateSatisfiedAt: now,
        inviteGateReason: gate.reason,
        updatedAt: now,
      })
      .where(eq(schema.users.id, input.userId));

    if (gate.inviteCodeId) {
      await tx
        .update(schema.inviteCodes)
        .set({ usedByUserId: input.userId, usedAt: now })
        .where(eq(schema.inviteCodes.id, gate.inviteCodeId));
    }

    return { satisfied: true, inviteCodeId: gate.inviteCodeId, reason: gate.reason };
  });
}
