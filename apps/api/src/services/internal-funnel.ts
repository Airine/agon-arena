import { eq, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AgentFunnelEvent } from './kafka.js';

function normalizeDimension(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
}

function bucketStartFor(ts: Date): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
}

async function resolveFramework(agentId: string): Promise<string> {
  const [agent] = await db
    .select({ metadata: schema.agents.metadata })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  const metadata = (agent?.metadata ?? {}) as Record<string, unknown>;
  return normalizeDimension(metadata['framework'] ?? metadata['sdk'] ?? metadata['runtime']);
}

async function resolveArenaType(arenaId?: string): Promise<string> {
  if (!arenaId) return 'unknown';

  const [arena] = await db
    .select({ gameType: schema.arenas.gameType })
    .from(schema.arenas)
    .where(eq(schema.arenas.id, arenaId))
    .limit(1);

  return normalizeDimension(arena?.gameType);
}

export async function materializeInternalFunnelEvent(event: AgentFunnelEvent): Promise<boolean> {
  const occurredAt = new Date(event.ts);
  const framework = await resolveFramework(event.agentId);
  const arenaType = await resolveArenaType(event.arenaId);
  const bucketStart = bucketStartFor(occurredAt);

  const insertedEvents = await db
    .insert(schema.internalFunnelEvents)
    .values({
      eventType: event.eventType,
      stage: event.stage,
      agentId: event.agentId,
      userId: event.userId,
      arenaId: event.arenaId ?? null,
      sourceTopic: 'agon.agent.funnel',
      source: 'unknown',
      framework,
      arenaType,
      occurredAt,
    })
    .onConflictDoNothing({
      target: [schema.internalFunnelEvents.stage, schema.internalFunnelEvents.agentId],
    })
    .returning();

  if (insertedEvents.length === 0) {
    return false;
  }

  await db
    .insert(schema.internalFunnelStageRollups)
    .values({
      bucketStart,
      bucketGranularity: 'day',
      stage: event.stage,
      source: 'unknown',
      framework,
      arenaType,
      uniqueAgents: 1,
      eventCount: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.internalFunnelStageRollups.bucketStart,
        schema.internalFunnelStageRollups.bucketGranularity,
        schema.internalFunnelStageRollups.stage,
        schema.internalFunnelStageRollups.source,
        schema.internalFunnelStageRollups.framework,
        schema.internalFunnelStageRollups.arenaType,
      ],
      set: {
        uniqueAgents: sql`${schema.internalFunnelStageRollups.uniqueAgents} + 1`,
        eventCount: sql`${schema.internalFunnelStageRollups.eventCount} + 1`,
        updatedAt: new Date(),
      },
    });

  await db
    .update(schema.internalAlphaContacts)
    .set({
      lastActivityAt: occurredAt,
      updatedAt: new Date(),
    })
    .where(or(
      eq(schema.internalAlphaContacts.userId, event.userId),
      eq(schema.internalAlphaContacts.agentId, event.agentId),
    ));

  return true;
}
