import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { count } from 'drizzle-orm';
import pg from 'pg';
import {
  users,
  agents,
  arenas,
  internalAlphaContacts,
  internalReleaseGates,
  internalFunnelEvents,
} from './schema.js';

async function hasTable(pool: pg.Pool, tableName: string): Promise<boolean> {
  const result = await pool.query(
    'select to_regclass($1) as table_name',
    [`public.${tableName}`],
  );
  return Boolean(result.rows[0]?.table_name);
}

async function seed() {
  const pool = new pg.Pool({
    connectionString: process.env['DATABASE_URL'],
  });

  const db = drizzle(pool);

  console.log('Seeding database...');

  // Create test users
  const [user1, user2] = await db
    .insert(users)
    .values([
      {
        username: 'alice',
        email: 'alice@agon.ai',
        passwordHash: '$2a$10$placeholder_hash_alice',
        chipBalance: 50000,
      },
      {
        username: 'bob',
        email: 'bob@agon.ai',
        passwordHash: '$2a$10$placeholder_hash_bob',
        chipBalance: 50000,
      },
    ])
    .returning();

  console.log(`Created users: ${user1!.username}, ${user2!.username}`);

  // Create test agents
  const [agent1, agent2, agent3] = await db
    .insert(agents)
    .values([
      {
        ownerId: user1!.id,
        creatorUserId: user1!.id,
        agentAddress: null,
        name: 'PokerBot-Alpha',
        description: 'Conservative strategy agent',
        apiUrl: 'http://localhost:5001/action',
        eloRating: 1200,
      },
      {
        ownerId: user1!.id,
        creatorUserId: user1!.id,
        agentAddress: null,
        name: 'PokerBot-Beta',
        description: 'Aggressive bluffing agent',
        apiUrl: 'http://localhost:5002/action',
        eloRating: 1350,
      },
      {
        ownerId: user2!.id,
        creatorUserId: user2!.id,
        agentAddress: null,
        name: 'DeepStack-v1',
        description: 'Neural network based agent',
        apiUrl: 'http://localhost:5003/action',
        eloRating: 1500,
      },
    ])
    .returning();

  console.log(`Created agents: ${agent1!.name}, ${agent2!.name}, ${agent3!.name}`);

  // Create a waiting arena
  const [arena] = await db
    .insert(arenas)
    .values([
      {
        name: 'Beginner Table #1',
        gameType: 'texas_holdem',
        status: 'waiting',
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        startingStack: 1000,
      },
    ])
    .returning();

  console.log(`Created arena: ${arena!.name}`);

  if (
    await hasTable(pool, 'internal_alpha_contacts') &&
    await hasTable(pool, 'internal_release_gates') &&
    await hasTable(pool, 'internal_funnel_events')
  ) {
    const [alphaCount] = await db
      .select({ count: count() })
      .from(internalAlphaContacts);

    if (Number(alphaCount?.count ?? 0) === 0) {
      await db.insert(internalAlphaContacts).values([
        {
          userId: user1!.id,
          agentId: agent1!.id,
          displayName: 'Alice / PokerBot-Alpha',
          source: 'manual',
          ownerSubject: 'ops-dev',
          ownerEmail: 'ops@example.com',
          status: 'blocked',
          currentBlocker: 'Wallet auth stalled',
          nextFollowUpAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          lastActivityAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
          notes: '',
          tags: ['priority', 'wallet'],
        },
        {
          userId: user2!.id,
          agentId: agent3!.id,
          displayName: 'Bob / DeepStack-v1',
          source: 'referral',
          ownerSubject: 'ops-dev',
          ownerEmail: 'ops@example.com',
          status: 'first_action_submitted',
          currentBlocker: null,
          nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          lastActivityAt: new Date(),
          notes: 'Reached first live action.',
          tags: ['warm'],
        },
      ]);
      console.log('Seeded internal alpha contacts.');
    }

    await db
      .insert(internalReleaseGates)
      .values([
        {
          gateKey: 'activation_funnel',
          status: 'at_risk',
          note: 'External conversion still thin.',
          evidenceUrl: null,
          updatedBySubject: 'ops-dev',
          updatedByEmail: 'ops@example.com',
          updatedAt: new Date(),
        },
        {
          gateKey: 'runtime_reliability',
          status: 'ready',
          note: 'Public runtime stability batch is green locally.',
          evidenceUrl: null,
          updatedBySubject: 'ops-dev',
          updatedByEmail: 'ops@example.com',
          updatedAt: new Date(),
        },
        {
          gateKey: 'ops_readiness',
          status: 'unknown',
          note: 'Need a weekly gate report ritual.',
          evidenceUrl: null,
          updatedBySubject: 'ops-dev',
          updatedByEmail: 'ops@example.com',
          updatedAt: new Date(),
        },
      ])
      .onConflictDoNothing();

    const [funnelCount] = await db
      .select({ count: count() })
      .from(internalFunnelEvents);

    if (Number(funnelCount?.count ?? 0) === 0) {
      const now = Date.now();
      await db.insert(internalFunnelEvents).values([
        {
          eventType: 'agent_funnel',
          stage: 'wallet_connected',
          agentId: agent1!.id,
          userId: user1!.id,
          arenaId: arena!.id,
          sourceTopic: 'agon.agent.funnel',
          source: 'manual',
          framework: 'custom',
          arenaType: 'texas_holdem',
          occurredAt: new Date(now - 26 * 60 * 60 * 1000),
        },
        {
          eventType: 'agent_funnel',
          stage: 'session_created',
          agentId: agent1!.id,
          userId: user1!.id,
          arenaId: arena!.id,
          sourceTopic: 'agon.agent.funnel',
          source: 'manual',
          framework: 'custom',
          arenaType: 'texas_holdem',
          occurredAt: new Date(now - 25 * 60 * 60 * 1000),
        },
        {
          eventType: 'agent_funnel',
          stage: 'wallet_connected',
          agentId: agent3!.id,
          userId: user2!.id,
          arenaId: arena!.id,
          sourceTopic: 'agon.agent.funnel',
          source: 'referral',
          framework: 'custom',
          arenaType: 'texas_holdem',
          occurredAt: new Date(now - 3 * 60 * 60 * 1000),
        },
        {
          eventType: 'agent_funnel',
          stage: 'session_created',
          agentId: agent3!.id,
          userId: user2!.id,
          arenaId: arena!.id,
          sourceTopic: 'agon.agent.funnel',
          source: 'referral',
          framework: 'custom',
          arenaType: 'texas_holdem',
          occurredAt: new Date(now - 2 * 60 * 60 * 1000),
        },
        {
          eventType: 'agent_funnel',
          stage: 'arena_joined',
          agentId: agent3!.id,
          userId: user2!.id,
          arenaId: arena!.id,
          sourceTopic: 'agon.agent.funnel',
          source: 'referral',
          framework: 'custom',
          arenaType: 'texas_holdem',
          occurredAt: new Date(now - 90 * 60 * 1000),
        },
        {
          eventType: 'agent_funnel',
          stage: 'first_turn_received',
          agentId: agent3!.id,
          userId: user2!.id,
          arenaId: arena!.id,
          sourceTopic: 'agon.agent.funnel',
          source: 'referral',
          framework: 'custom',
          arenaType: 'texas_holdem',
          occurredAt: new Date(now - 45 * 60 * 1000),
        },
        {
          eventType: 'agent_funnel',
          stage: 'first_action_submitted',
          agentId: agent3!.id,
          userId: user2!.id,
          arenaId: arena!.id,
          sourceTopic: 'agon.agent.funnel',
          source: 'referral',
          framework: 'custom',
          arenaType: 'texas_holdem',
          occurredAt: new Date(now - 30 * 60 * 1000),
        },
      ]);
      console.log('Seeded internal funnel events.');
    }
  }

  console.log('Seed complete.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
