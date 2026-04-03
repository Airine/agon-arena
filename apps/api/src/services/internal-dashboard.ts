import { and, count, desc, eq, gte, lt, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { InternalAuthContext } from '../middleware/internal-auth.js';

const SUMMARY_STAGES = [
  'wallet_connected',
  'session_created',
  'arena_joined',
  'first_turn_received',
  'first_action_submitted',
] as const;

const DEFAULT_RELEASE_GATES = [
  'activation_funnel',
  'runtime_reliability',
  'ops_readiness',
] as const;

type InternalAlphaStatus = typeof schema.internalAlphaContacts.$inferSelect.status;
type InternalReleaseGateStatus = typeof schema.internalReleaseGates.$inferSelect.status;
type InternalReleaseGateWireStatus = 'pass' | 'watch' | 'blocked';

export interface ListInternalAlphaContactsInput {
  ownerSubject?: string;
  status?: InternalAlphaStatus;
  search?: string;
  overdueOnly?: boolean;
  limit?: number;
}

export interface UpdateInternalAlphaContactInput {
  ownerSubject?: string | null;
  ownerEmail?: string | null;
  status?: InternalAlphaStatus;
  currentBlocker?: string | null;
  nextFollowUpAt?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

export interface UpdateInternalReleaseGateInput {
  status?: InternalReleaseGateWireStatus;
  note?: string | null;
  evidenceUrl?: string | null;
}

class NotFoundError extends Error {}

function isMissingRelationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '42P01'
  );
}

function asIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function coerceTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

function dateDaysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function terminalStatus(status: string): boolean {
  return status === 'completed_arena' || status === 'lost' || status === 'paused';
}

function computeVerdict(gates: Array<{ status: InternalReleaseGateStatus }>): InternalReleaseGateStatus {
  if (gates.some((gate) => gate.status === 'blocked')) return 'blocked';
  if (gates.some((gate) => gate.status === 'at_risk')) return 'at_risk';
  if (gates.length > 0 && gates.every((gate) => gate.status === 'ready')) return 'ready';
  return 'unknown';
}

function toPublicReleaseGateVerdict(
  verdict: InternalReleaseGateStatus,
): 'ready' | 'watch' | 'blocked' {
  if (verdict === 'ready') return 'ready';
  if (verdict === 'blocked') return 'blocked';
  return 'watch';
}

function toWireReleaseGateStatus(
  status: InternalReleaseGateStatus,
): InternalReleaseGateWireStatus {
  if (status === 'ready') return 'pass';
  if (status === 'blocked') return 'blocked';
  return 'watch';
}

function fromWireReleaseGateStatus(
  status: InternalReleaseGateWireStatus,
): InternalReleaseGateStatus {
  if (status === 'pass') return 'ready';
  if (status === 'blocked') return 'blocked';
  return 'at_risk';
}

function runtimeIssueSeverity(
  errorType: string,
): 'info' | 'warning' | 'danger' {
  switch (errorType) {
    case 'invalid_action':
    case 'schema_error':
      return 'danger';
    case 'timeout':
    case 'connection_lost':
      return 'warning';
    default:
      return 'info';
  }
}

async function countFunnelStage(stage: string, since: Date, until?: Date): Promise<number> {
  const conditions = [
    eq(schema.internalFunnelEvents.stage, stage),
    gte(schema.internalFunnelEvents.occurredAt, since),
  ];

  if (until) {
    conditions.push(lt(schema.internalFunnelEvents.occurredAt, until));
  }

  const [result] = await db
    .select({ count: count() })
    .from(schema.internalFunnelEvents)
    .where(and(...conditions));

  return Number(result?.count ?? 0);
}

async function countFinishedArenas(since: Date, until?: Date): Promise<number> {
  const conditions = [gte(schema.arenas.finishedAt, since)];
  if (until) {
    conditions.push(lt(schema.arenas.finishedAt, until));
  }

  const [result] = await db
    .select({ count: count() })
    .from(schema.arenas)
    .where(and(...conditions));

  return Number(result?.count ?? 0);
}

async function ensureReleaseGates(): Promise<Array<typeof schema.internalReleaseGates.$inferSelect>> {
  const existing = await db
    .select()
    .from(schema.internalReleaseGates)
    .orderBy(schema.internalReleaseGates.gateKey);

  if (existing.length > 0) {
    return existing;
  }

  await db
    .insert(schema.internalReleaseGates)
    .values(DEFAULT_RELEASE_GATES.map((gateKey) => ({
      gateKey,
      status: 'unknown' as const,
      note: null,
      evidenceUrl: null,
      updatedBySubject: null,
      updatedByEmail: null,
      updatedAt: new Date(),
    })))
    .onConflictDoNothing();

  return db
    .select()
    .from(schema.internalReleaseGates)
    .orderBy(schema.internalReleaseGates.gateKey);
}

async function getActivationOverview() {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = dateDaysAgo(7);
  const fourteenDaysAgo = dateDaysAgo(14);

  const [
    walletConnectedToday,
    walletConnected7d,
    walletConnectedPrior7d,
    firstActionToday,
    firstAction7d,
    firstActionPrior7d,
    completedArenasToday,
    completedArenas7d,
    completedArenasPrior7d,
  ] = await Promise.all([
    countFunnelStage('wallet_connected', startOfToday),
    countFunnelStage('wallet_connected', sevenDaysAgo),
    countFunnelStage('wallet_connected', fourteenDaysAgo, sevenDaysAgo),
    countFunnelStage('first_action_submitted', startOfToday),
    countFunnelStage('first_action_submitted', sevenDaysAgo),
    countFunnelStage('first_action_submitted', fourteenDaysAgo, sevenDaysAgo),
    countFinishedArenas(startOfToday),
    countFinishedArenas(sevenDaysAgo),
    countFinishedArenas(fourteenDaysAgo, sevenDaysAgo),
  ]);

  const blockers = await db
    .select({
      currentBlocker: schema.internalAlphaContacts.currentBlocker,
    })
    .from(schema.internalAlphaContacts)
    .where(eq(schema.internalAlphaContacts.status, 'blocked'));

  const blockerCounts = blockers.reduce<Record<string, number>>((acc, row) => {
    if (!row.currentBlocker) return acc;
    acc[row.currentBlocker] = (acc[row.currentBlocker] ?? 0) + 1;
    return acc;
  }, {});

  const largestBlockerLabel = Object.entries(blockerCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    newAgentsToday: walletConnectedToday,
    newAgents7d: walletConnected7d,
    newAgentsPrior7d: walletConnectedPrior7d,
    firstActionSubmittedToday: firstActionToday,
    firstActionSubmitted7d: firstAction7d,
    firstActionSubmittedPrior7d: firstActionPrior7d,
    completedArenasToday,
    completedArenas7d,
    completedArenasPrior7d,
    largestBlockerLabel,
  };
}

async function getSummaryFunnel() {
  const sevenDaysAgo = dateDaysAgo(7);
  const counts = await Promise.all(
    SUMMARY_STAGES.map(async (stage) => ({
      stage,
      count: await countFunnelStage(stage, sevenDaysAgo),
    })),
  );

  let previous = counts[0]?.count ?? 0;
  let largestDropOffStage: string | null = null;
  let largestDrop = -1;
  const stages = counts.map((item, index) => {
    const conversionRate = index === 0 || previous === 0
      ? null
      : Number((item.count / previous).toFixed(4));
    const drop = index === 0 ? 0 : previous - item.count;
    if (index > 0 && drop > largestDrop) {
      largestDrop = drop;
      largestDropOffStage = item.stage;
    }
    previous = item.count;
    return {
      ...item,
      conversionRate,
    };
  });

  return {
    windowDays: 7,
    stages,
    largestDropOffStage,
  };
}

async function getRecentSuccessfulAgents() {
  const recentEvents = await db
    .select({
      id: schema.internalFunnelEvents.id,
      stage: schema.internalFunnelEvents.stage,
      agentId: schema.internalFunnelEvents.agentId,
      userId: schema.internalFunnelEvents.userId,
      arenaId: schema.internalFunnelEvents.arenaId,
      occurredAt: schema.internalFunnelEvents.occurredAt,
    })
    .from(schema.internalFunnelEvents)
    .where(or(
      eq(schema.internalFunnelEvents.stage, 'first_action_submitted'),
      eq(schema.internalFunnelEvents.stage, 'completed_arena'),
    ))
    .orderBy(desc(schema.internalFunnelEvents.occurredAt))
    .limit(20);

  const deduped = recentEvents.filter((event, index, all) =>
    all.findIndex((candidate) => candidate.agentId === event.agentId) === index,
  ).slice(0, 5);

  return Promise.all(
    deduped.map(async (event) => {
      const [contact] = await db
        .select({ displayName: schema.internalAlphaContacts.displayName })
        .from(schema.internalAlphaContacts)
        .where(or(
          eq(schema.internalAlphaContacts.agentId, event.agentId),
          eq(schema.internalAlphaContacts.userId, event.userId),
        ))
        .limit(1);

      const [agent] = await db
        .select({ name: schema.agents.name })
        .from(schema.agents)
        .where(eq(schema.agents.id, event.agentId))
        .limit(1);

      const [arena] = event.arenaId
        ? await db
            .select({ name: schema.arenas.name })
            .from(schema.arenas)
            .where(eq(schema.arenas.id, event.arenaId))
            .limit(1)
        : [];

      return {
        id: event.id,
        displayName: contact?.displayName ?? agent?.name ?? event.agentId,
        stage: event.stage,
        occurredAt: event.occurredAt.toISOString(),
        arenaId: event.arenaId,
        arenaName: arena?.name ?? null,
      };
    }),
  );
}

async function getBlockerQueue() {
  const contacts = await db
    .select()
    .from(schema.internalAlphaContacts)
    .orderBy(desc(schema.internalAlphaContacts.updatedAt));

  const now = Date.now();
  const dayAgo = now - (24 * 60 * 60 * 1000);
  const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

  const stuckOver24h = contacts.filter((contact) =>
    !terminalStatus(contact.status)
    && contact.lastActivityAt
    && contact.lastActivityAt.getTime() < dayAgo,
  );
  const overdueFollowUps = contacts.filter((contact) =>
    contact.nextFollowUpAt
    && contact.nextFollowUpAt.getTime() < now,
  );
  const missingOwnerNote = contacts.filter((contact) =>
    contact.lastActivityAt
    && contact.lastActivityAt.getTime() >= weekAgo
    && !contact.notes?.trim(),
  );

  const items = [
    ...stuckOver24h.map((contact) => ({
      id: contact.id,
      title: contact.displayName,
      owner: contact.ownerEmail,
      reason: 'stuck_over_24h',
      ageHours: contact.lastActivityAt
        ? Math.floor((now - contact.lastActivityAt.getTime()) / (60 * 60 * 1000))
        : null,
      nextFollowUpAt: asIso(contact.nextFollowUpAt),
    })),
    ...overdueFollowUps.map((contact) => ({
      id: contact.id,
      title: contact.displayName,
      owner: contact.ownerEmail,
      reason: 'follow_up_overdue',
      ageHours: contact.lastActivityAt
        ? Math.floor((now - contact.lastActivityAt.getTime()) / (60 * 60 * 1000))
        : null,
      nextFollowUpAt: asIso(contact.nextFollowUpAt),
    })),
    ...missingOwnerNote.map((contact) => ({
      id: contact.id,
      title: contact.displayName,
      owner: contact.ownerEmail,
      reason: 'recent_progress_missing_note',
      ageHours: contact.lastActivityAt
        ? Math.floor((now - contact.lastActivityAt.getTime()) / (60 * 60 * 1000))
        : null,
      nextFollowUpAt: asIso(contact.nextFollowUpAt),
    })),
  ].slice(0, 10);

  return {
    stuckOver24h: stuckOver24h.length,
    followUpOverdue: overdueFollowUps.length,
    missingOwnerNote: missingOwnerNote.length,
    items,
  };
}

async function getReleaseGateSummary() {
  const gates = await ensureReleaseGates();
  const unmetConditions = gates
    .filter((gate) => gate.status !== 'ready')
    .map((gate) => gate.gateKey);
  const evidenceLinks = gates
    .map((gate) => gate.evidenceUrl)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const lastUpdatedAt = [...gates]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]?.updatedAt ?? null;

  return {
    verdict: toPublicReleaseGateVerdict(computeVerdict(gates)),
    unmetCount: gates.filter((gate) => gate.status !== 'ready').length,
    unmetConditions,
    evidenceLinks,
    updatedAt: asIso(lastUpdatedAt),
    gates: gates.map((gate) => ({
      id: gate.id,
      gateKey: gate.gateKey,
      status:
        gate.status === 'ready'
          ? 'pass'
          : gate.status === 'blocked'
            ? 'blocked'
            : 'watch',
      note: gate.note,
      evidenceUrl: gate.evidenceUrl,
      updatedBySubject: gate.updatedBySubject,
      updatedByEmail: gate.updatedByEmail,
      updatedAt: asIso(gate.updatedAt),
    })),
  };
}

async function getRuntimeRedZone() {
  const rows = await db
    .select({
      id: schema.agentErrorLog.id,
      agentId: schema.agentErrorLog.agentId,
      errorType: schema.agentErrorLog.errorType,
      details: schema.agentErrorLog.details,
      createdAt: schema.agentErrorLog.createdAt,
      agentName: schema.agents.name,
    })
    .from(schema.agentErrorLog)
    .leftJoin(schema.agents, eq(schema.agentErrorLog.agentId, schema.agents.id))
    .orderBy(desc(schema.agentErrorLog.createdAt))
    .limit(5);

  return rows.map((row) => {
    const detail =
      typeof row.details === 'object' && row.details !== null && 'message' in row.details
        ? String((row.details as Record<string, unknown>).message)
        : row.errorType;

    return {
      id: row.id,
      label: `${row.agentName ?? row.agentId} · ${row.errorType}`,
      severity: runtimeIssueSeverity(row.errorType),
      detail,
      metric: row.createdAt.toISOString(),
    };
  });
}

export async function getInternalSummary() {
  const partials: string[] = [];

  async function withFallback<T>(
    label: string,
    run: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isMissingRelationError(error)) {
        partials.push(`${label}:missing_relation`);
        return fallback;
      }

      throw error;
    }
  }

  const [
    activationOverview,
    funnelSummary,
    blockerQueue,
    releaseGate,
    runtimeIssues,
    recentSuccessfulAgents,
  ] = await Promise.all([
    withFallback('activation_overview', getActivationOverview, {
      newAgentsToday: 0,
      newAgents7d: 0,
      newAgentsPrior7d: 0,
      firstActionSubmittedToday: 0,
      firstActionSubmitted7d: 0,
      firstActionSubmittedPrior7d: 0,
      completedArenasToday: 0,
      completedArenas7d: 0,
      completedArenasPrior7d: 0,
      largestBlockerLabel: null,
    }),
    withFallback('funnel_summary', getSummaryFunnel, {
      windowDays: 7,
      stages: [],
      largestDropOffStage: null,
    }),
    withFallback('blocker_queue', getBlockerQueue, {
      stuckOver24h: 0,
      followUpOverdue: 0,
      missingOwnerNote: 0,
      items: [],
    }),
    withFallback('release_gates', getReleaseGateSummary, {
      verdict: 'watch' as const,
      unmetCount: 0,
      unmetConditions: [],
      evidenceLinks: [],
      updatedAt: null,
      gates: [],
    }),
    withFallback('runtime_red_zone', getRuntimeRedZone, []),
    withFallback('recent_successful_agents', getRecentSuccessfulAgents, []),
  ]);

  return {
    asOf: new Date().toISOString(),
    activationOverview,
    funnelSummary,
    recentSuccessfulAgents: {
      items: recentSuccessfulAgents,
    },
    blockerQueue: {
      items: blockerQueue.items,
    },
    runtimeRedZone: {
      issues: runtimeIssues,
    },
    releaseGate,
    partials,
    funnel: funnelSummary,
    dataSources: {
      funnel: { status: 'ok', mode: 'materialized_db' },
      alphaContacts: { status: 'ok', mode: 'postgres' },
      releaseGates: { status: 'ok', mode: 'postgres' },
      arenas: { status: 'ok', mode: 'postgres' },
    },
  };
}

export async function listInternalAlphaContacts(input: ListInternalAlphaContactsInput) {
  const conditions = [];
  if (input.ownerSubject) {
    conditions.push(eq(schema.internalAlphaContacts.ownerSubject, input.ownerSubject));
  }
  if (input.status) {
    conditions.push(eq(schema.internalAlphaContacts.status, input.status));
  }
  if (input.overdueOnly) {
    conditions.push(lt(schema.internalAlphaContacts.nextFollowUpAt, new Date()));
  }

  const rows = await db
    .select()
    .from(schema.internalAlphaContacts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.internalAlphaContacts.updatedAt))
    .limit(Math.min(input.limit ?? 100, 200));

  const searchNeedle = input.search?.trim().toLowerCase();
  const filtered = searchNeedle
    ? rows.filter((row) => {
        const haystacks = [
          row.displayName,
          row.source,
          row.ownerSubject,
          row.ownerEmail,
          row.currentBlocker,
          row.notes,
          ...coerceTags(row.tags),
        ].filter((value): value is string => typeof value === 'string');

        return haystacks.some((value) => value.toLowerCase().includes(searchNeedle));
      })
    : rows;

  return {
    items: filtered.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      source: row.source,
      ownerSubject: row.ownerSubject,
      ownerEmail: row.ownerEmail,
      status: row.status,
      currentBlocker: row.currentBlocker,
      lastActivityAt: asIso(row.lastActivityAt),
      nextFollowUpAt: asIso(row.nextFollowUpAt),
      tags: coerceTags(row.tags),
    })),
    nextCursor: null,
  };
}

export async function getInternalAlphaContactDetail(id: string) {
  const [contact] = await db
    .select()
    .from(schema.internalAlphaContacts)
    .where(eq(schema.internalAlphaContacts.id, id))
    .limit(1);

  if (!contact) {
    throw new NotFoundError('Alpha contact not found');
  }

  const latestFunnel = contact.agentId || contact.userId
    ? await db
        .select()
        .from(schema.internalFunnelEvents)
        .where(or(
          contact.agentId ? eq(schema.internalFunnelEvents.agentId, contact.agentId) : eq(schema.internalFunnelEvents.userId, contact.userId!),
          contact.userId ? eq(schema.internalFunnelEvents.userId, contact.userId) : eq(schema.internalFunnelEvents.agentId, contact.agentId!),
        ))
        .orderBy(desc(schema.internalFunnelEvents.occurredAt))
        .limit(1)
    : [];

  const latestSeat = contact.agentId
    ? await db
        .select()
        .from(schema.arenaSeats)
        .where(eq(schema.arenaSeats.agentId, contact.agentId))
        .orderBy(desc(schema.arenaSeats.joinedAt))
        .limit(1)
    : [];

  const latestArenaActivity = latestSeat[0]
    ? (await db
        .select()
        .from(schema.arenas)
        .where(eq(schema.arenas.id, latestSeat[0].arenaId))
        .limit(1))[0]
    : null;

  const latestRuntimeIssues = contact.agentId
    ? await db
        .select()
        .from(schema.agentErrorLog)
        .where(eq(schema.agentErrorLog.agentId, contact.agentId))
        .orderBy(desc(schema.agentErrorLog.createdAt))
        .limit(5)
    : [];

  const timeline = [
    {
      id: `${contact.id}:created`,
      type: 'contact_created',
      at: contact.createdAt.toISOString(),
      title: 'Contact created',
      detail: contact.displayName,
    },
    ...(latestFunnel[0] ? [{
      id: `${contact.id}:funnel:${latestFunnel[0].id}`,
      type: 'latest_funnel',
      at: latestFunnel[0].occurredAt.toISOString(),
      title: `Funnel stage: ${latestFunnel[0].stage}`,
      detail: latestFunnel[0].arenaId ?? null,
    }] : []),
    ...(latestArenaActivity ? [{
      id: `${contact.id}:arena:${latestArenaActivity.id}`,
      type: 'latest_arena_activity',
      at: (latestArenaActivity.finishedAt ?? latestArenaActivity.createdAt).toISOString(),
      title: `Arena ${latestArenaActivity.status}`,
      detail: latestArenaActivity.name,
    }] : []),
    ...latestRuntimeIssues.map((issue) => ({
      id: `${contact.id}:runtime:${issue.id}`,
      type: 'runtime_issue',
      at: issue.createdAt.toISOString(),
      title: issue.errorType,
      detail: issue.details,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    id: contact.id,
    displayName: contact.displayName,
    source: contact.source,
    ownerSubject: contact.ownerSubject,
    ownerEmail: contact.ownerEmail,
    status: contact.status,
    currentBlocker: contact.currentBlocker,
    lastActivityAt: asIso(contact.lastActivityAt),
    nextFollowUpAt: asIso(contact.nextFollowUpAt),
    notes: contact.notes,
    tags: coerceTags(contact.tags),
    timeline,
    latestFunnel: latestFunnel[0] ? {
      stage: latestFunnel[0].stage,
      occurredAt: latestFunnel[0].occurredAt.toISOString(),
      arenaId: latestFunnel[0].arenaId,
    } : null,
    latestArenaActivity: latestArenaActivity ? {
      arenaId: latestArenaActivity.id,
      name: latestArenaActivity.name,
      status: latestArenaActivity.status,
      gameType: latestArenaActivity.gameType,
      createdAt: latestArenaActivity.createdAt.toISOString(),
      finishedAt: asIso(latestArenaActivity.finishedAt),
    } : null,
    latestRuntimeIssues: latestRuntimeIssues.map((issue) => ({
      id: issue.id,
      errorType: issue.errorType,
      details: issue.details,
      createdAt: issue.createdAt.toISOString(),
    })),
  };
}

export async function updateInternalAlphaContact(id: string, input: UpdateInternalAlphaContactInput) {
  const [updated] = await db
    .update(schema.internalAlphaContacts)
    .set({
      ...(input.ownerSubject !== undefined ? { ownerSubject: input.ownerSubject } : {}),
      ...(input.ownerEmail !== undefined ? { ownerEmail: input.ownerEmail } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.currentBlocker !== undefined ? { currentBlocker: input.currentBlocker } : {}),
      ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.internalAlphaContacts.id, id))
    .returning();

  if (!updated) {
    throw new NotFoundError('Alpha contact not found');
  }

  return {
    id: updated.id,
    displayName: updated.displayName,
    source: updated.source,
    ownerSubject: updated.ownerSubject,
    ownerEmail: updated.ownerEmail,
    status: updated.status,
    currentBlocker: updated.currentBlocker,
    lastActivityAt: asIso(updated.lastActivityAt),
    nextFollowUpAt: asIso(updated.nextFollowUpAt),
    notes: updated.notes,
    tags: coerceTags(updated.tags),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function listInternalReleaseGates() {
  const gates = await ensureReleaseGates();
  return gates.map((gate) => ({
    id: gate.id,
    gateKey: gate.gateKey,
    status: toWireReleaseGateStatus(gate.status),
    note: gate.note,
    evidenceUrl: gate.evidenceUrl,
    updatedBySubject: gate.updatedBySubject,
    updatedByEmail: gate.updatedByEmail,
    updatedAt: gate.updatedAt.toISOString(),
  }));
}

export async function updateInternalReleaseGate(
  id: string,
  input: UpdateInternalReleaseGateInput,
  actor: InternalAuthContext,
) {
  const [updated] = await db
    .update(schema.internalReleaseGates)
    .set({
      ...(input.status !== undefined ? { status: fromWireReleaseGateStatus(input.status) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.evidenceUrl !== undefined ? { evidenceUrl: input.evidenceUrl } : {}),
      updatedBySubject: actor.subject,
      updatedByEmail: actor.email,
      updatedAt: new Date(),
    })
    .where(eq(schema.internalReleaseGates.id, id))
    .returning();

  if (!updated) {
    throw new NotFoundError('Release gate not found');
  }

  return {
    id: updated.id,
    gateKey: updated.gateKey,
    status: toWireReleaseGateStatus(updated.status),
    note: updated.note,
    evidenceUrl: updated.evidenceUrl,
    updatedBySubject: updated.updatedBySubject,
    updatedByEmail: updated.updatedByEmail,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}
