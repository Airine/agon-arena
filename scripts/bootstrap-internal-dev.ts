import 'dotenv/config';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import pg from 'pg';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_PATH = path.resolve(
  REPO_ROOT,
  'apps/api/drizzle/0016_sour_rockslide.sql',
);

async function hasTable(pool: pg.Pool, tableName: string): Promise<boolean> {
  const result = await pool.query(
    'select to_regclass($1) as table_name',
    [`public.${tableName}`],
  );
  return Boolean(result.rows[0]?.table_name);
}

async function ensureInternalTables(pool: pg.Pool): Promise<void> {
  const internalTablesExist = await hasTable(pool, 'internal_alpha_contacts');
  if (internalTablesExist) {
    return;
  }

  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function seedReleaseGates(pool: pg.Pool): Promise<void> {
  await pool.query(`
    insert into internal_release_gates (
      gate_key, status, note, evidence_url, updated_by_subject, updated_by_email, updated_at
    )
    values
      ('activation_funnel', 'at_risk', 'External conversion still thin.', null, 'ops-dev', 'ops@example.com', now()),
      ('runtime_reliability', 'ready', 'Public runtime stability batch is green locally.', null, 'ops-dev', 'ops@example.com', now()),
      ('ops_readiness', 'unknown', 'Need a weekly gate report ritual.', null, 'ops-dev', 'ops@example.com', now())
    on conflict (gate_key) do nothing
  `);
}

async function seedAlphaContactsAndFunnel(pool: pg.Pool): Promise<void> {
  const users = await pool.query(`
    select id, username, email
    from users
    where email is not null
    order by created_at asc
    limit 2
  `);

  if (users.rows.length < 2) {
    return;
  }

  const agents = await pool.query(`
    select id, name, owner_id
    from agents
    order by created_at asc
    limit 2
  `);

  if (agents.rows.length < 2) {
    return;
  }

  await pool.query(`
    insert into internal_alpha_contacts (
      user_id, agent_id, display_name, source, owner_subject, owner_email,
      status, current_blocker, next_follow_up_at, last_activity_at, notes, tags, created_at, updated_at
    )
    select *
    from (
      values
        (
          $1::uuid,
          $2::uuid,
          'Alpha Contact / ' || $3::text,
          'manual',
          'ops-dev',
          'ops@example.com',
          'blocked'::internal_alpha_contact_status,
          'Wallet auth stalled',
          now() - interval '2 hour',
          now() - interval '26 hour',
          '',
          '["priority","wallet"]'::jsonb,
          now(),
          now()
        ),
        (
          $4::uuid,
          $5::uuid,
          'Successful Contact / ' || $6::text,
          'referral',
          'ops-dev',
          'ops@example.com',
          'first_action_submitted'::internal_alpha_contact_status,
          null,
          now() + interval '1 day',
          now(),
          'Reached first live action.',
          '["warm"]'::jsonb,
          now(),
          now()
        )
    ) as seed_rows(
      user_id, agent_id, display_name, source, owner_subject, owner_email,
      status, current_blocker, next_follow_up_at, last_activity_at, notes, tags, created_at, updated_at
    )
    where not exists (select 1 from internal_alpha_contacts)
  `, [
    users.rows[0].id,
    agents.rows[0].id,
    agents.rows[0].name,
    users.rows[1].id,
    agents.rows[1].id,
    agents.rows[1].name,
  ]);

  await pool.query(`
    insert into internal_funnel_events (
      event_type, stage, agent_id, user_id, arena_id, source_topic, source, framework, arena_type, occurred_at, ingested_at
    )
    select *
    from (
      values
        ('agent_funnel', 'wallet_connected', $1::uuid, $2::uuid, null::uuid, 'agon.agent.funnel', 'manual', 'custom', 'texas_holdem', now() - interval '26 hour', now()),
        ('agent_funnel', 'session_created', $1::uuid, $2::uuid, null::uuid, 'agon.agent.funnel', 'manual', 'custom', 'texas_holdem', now() - interval '25 hour', now()),
        ('agent_funnel', 'wallet_connected', $3::uuid, $4::uuid, null::uuid, 'agon.agent.funnel', 'referral', 'custom', 'texas_holdem', now() - interval '3 hour', now()),
        ('agent_funnel', 'session_created', $3::uuid, $4::uuid, null::uuid, 'agon.agent.funnel', 'referral', 'custom', 'texas_holdem', now() - interval '2 hour', now()),
        ('agent_funnel', 'arena_joined', $3::uuid, $4::uuid, null::uuid, 'agon.agent.funnel', 'referral', 'custom', 'texas_holdem', now() - interval '90 minute', now()),
        ('agent_funnel', 'first_turn_received', $3::uuid, $4::uuid, null::uuid, 'agon.agent.funnel', 'referral', 'custom', 'texas_holdem', now() - interval '45 minute', now()),
        ('agent_funnel', 'first_action_submitted', $3::uuid, $4::uuid, null::uuid, 'agon.agent.funnel', 'referral', 'custom', 'texas_holdem', now() - interval '30 minute', now())
    ) as seed_rows(
      event_type, stage, agent_id, user_id, arena_id, source_topic, source, framework, arena_type, occurred_at, ingested_at
    )
    where not exists (select 1 from internal_funnel_events)
  `, [
    agents.rows[0].id,
    users.rows[0].id,
    agents.rows[1].id,
    users.rows[1].id,
  ]);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new pg.Pool({ connectionString });

  try {
    await ensureInternalTables(pool);
    await seedReleaseGates(pool);
    await seedAlphaContactsAndFunnel(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
