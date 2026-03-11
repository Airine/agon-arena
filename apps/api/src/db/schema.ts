import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Enums
export const arenaStatusEnum = pgEnum('arena_status', ['waiting', 'running', 'finished', 'cancelled']);
export const gameTypeEnum = pgEnum('game_type', ['texas_holdem']);
export const gameStageEnum = pgEnum('game_stage', [
  'waiting', 'pre_flop', 'flop', 'turn', 'river', 'showdown', 'finished'
]);
export const actionTypeEnum = pgEnum('action_type', ['fold', 'check', 'call', 'raise', 'all_in', 'timeout']);
export const skillVisibilityEnum = pgEnum('skill_visibility', ['public', 'private']);

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  // walletAddress: EVM address (0x...) — primary Web3 identity; null for email-only users
  walletAddress: varchar('wallet_address', { length: 42 }).unique(),
  // email/passwordHash are optional — SIWE users may not have them
  email: varchar('email', { length: 255 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  chipBalance: bigint('chip_balance', { mode: 'number' }).notNull().default(0),
  frozenAmount: bigint('frozen_amount', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_username_idx').on(t.username),
  uniqueIndex('users_email_idx').on(t.email),
  uniqueIndex('users_wallet_idx').on(t.walletAddress),
]);

// Agents table
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  apiUrl: varchar('api_url', { length: 500 }).notNull(),
  apiKeyHash: varchar('api_key_hash', { length: 255 }), // For verifying agent identity
  webhookPublicKey: varchar('webhook_public_key', { length: 128 }), // Ed25519 public key (hex)
  avatarUrl: varchar('avatar_url', { length: 500 }),
  version: varchar('version', { length: 20 }).notNull().default('1.0'), // AAP protocol version
  metadata: jsonb('metadata'), // Free-form agent metadata (framework, language, etc.)
  eloRating: integer('elo_rating').notNull().default(1200),
  handsPlayed: integer('hands_played').notNull().default(0),
  handsWon: integer('hands_won').notNull().default(0),
  totalChipsWon: bigint('total_chips_won', { mode: 'number' }).notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('agents_owner_idx').on(t.ownerId),
  index('agents_elo_idx').on(t.eloRating),
]);

// Arenas table
export const arenas = pgTable('arenas', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  gameType: gameTypeEnum('game_type').notNull().default('texas_holdem'),
  status: arenaStatusEnum('status').notNull().default('waiting'),
  maxPlayers: integer('max_players').notNull().default(6),
  smallBlind: integer('small_blind').notNull().default(10),
  bigBlind: integer('big_blind').notNull().default(20),
  startingStack: integer('starting_stack').notNull().default(1000),
  currentHandNumber: integer('current_hand_number').notNull().default(0),
  spectatorCount: integer('spectator_count').notNull().default(0),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('arenas_status_idx').on(t.status),
]);

// Arena seats (which agents are seated)
export const arenaSeats = pgTable('arena_seats', {
  id: uuid('id').primaryKey().defaultRandom(),
  arenaId: uuid('arena_id').notNull().references(() => arenas.id),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  seatIndex: integer('seat_index').notNull(), // 0-based
  currentStack: integer('current_stack').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (t) => [
  index('arena_seats_arena_idx').on(t.arenaId),
  uniqueIndex('arena_seats_unique_seat').on(t.arenaId, t.seatIndex),
]);

// Game hands table
export const gameHands = pgTable('game_hands', {
  id: uuid('id').primaryKey().defaultRandom(),
  arenaId: uuid('arena_id').notNull().references(() => arenas.id),
  handNumber: integer('hand_number').notNull(),
  stage: gameStageEnum('stage').notNull().default('pre_flop'),
  stateSnapshot: jsonb('state_snapshot'), // Full GameState JSON for replay
  communityCards: jsonb('community_cards'), // Card[]
  potAmount: integer('pot_amount').notNull().default(0),
  winnersJson: jsonb('winners_json'), // Winner[]
  dealerIndex: integer('dealer_index').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
}, (t) => [
  index('game_hands_arena_idx').on(t.arenaId),
  uniqueIndex('game_hands_arena_number_idx').on(t.arenaId, t.handNumber),
]);

// Skills table (agent strategies / code packages)
export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  visibility: skillVisibilityEnum('visibility').notNull().default('private'),
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('skills_agent_idx').on(t.agentId),
  index('skills_visibility_idx').on(t.visibility),
  uniqueIndex('skills_agent_name_idx').on(t.agentId, t.name),
]);

// Skill versions table (immutable version snapshots)
export const skillVersions = pgTable('skill_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  fileContent: text('file_content').notNull(), // Source code / strategy definition
  fileSha256: varchar('file_sha256', { length: 64 }).notNull(), // Content-addressable hash
  fileSize: integer('file_size').notNull(), // Bytes
  changelog: text('changelog'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('skill_versions_skill_idx').on(t.skillId),
  uniqueIndex('skill_versions_skill_version_idx').on(t.skillId, t.version),
]);

// Game actions table
export const gameActions = pgTable('game_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  handId: uuid('hand_id').notNull().references(() => gameHands.id),
  arenaId: uuid('arena_id').notNull().references(() => arenas.id),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  actionType: actionTypeEnum('action_type').notNull(),
  amount: integer('amount'), // For raise/all_in
  stage: gameStageEnum('stage').notNull(),
  sequenceNumber: integer('sequence_number').notNull(), // Order within hand
  responseTimeMs: integer('response_time_ms'), // How long agent took to respond
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('game_actions_hand_idx').on(t.handId),
  index('game_actions_arena_idx').on(t.arenaId),
  index('game_actions_agent_idx').on(t.agentId),
]);

// CHIP transaction types
export const chipTxTypeEnum = pgEnum('chip_tx_type', [
  'credit',    // add chips (purchase, prize, bonus)
  'debit',     // remove chips (fee, penalty)
  'freeze',    // lock chips for game entry
  'unfreeze',  // release locked chips back
  'transfer',  // user-to-user transfer
]);

// CHIP audit log — every balance mutation writes a row here
export const chipTransactions = pgTable('chip_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: chipTxTypeEnum('type').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(), // always positive
  balanceBefore: bigint('balance_before', { mode: 'number' }).notNull(),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
  frozenBefore: bigint('frozen_before', { mode: 'number' }).notNull(),
  frozenAfter: bigint('frozen_after', { mode: 'number' }).notNull(),
  // Link the tx to the entity that caused it (arena entry, hand prize, x402 purchase, etc.)
  referenceId: varchar('reference_id', { length: 255 }),
  referenceType: varchar('reference_type', { length: 50 }), // 'arena' | 'hand' | 'x402' | 'admin'
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('chip_tx_user_idx').on(t.userId),
  index('chip_tx_created_idx').on(t.createdAt),
  index('chip_tx_reference_idx').on(t.referenceType, t.referenceId),
]);
