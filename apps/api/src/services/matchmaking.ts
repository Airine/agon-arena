/**
 * AGO-32: Auto-matchmaking queue (60s SLA, fill with bots if needed)
 *
 * Architecture:
 * - Redis sorted set: matchmaking:queue:{mode}
 *   score = join timestamp (ms), value = JSON(QueueEntry)
 * - Processor runs every POLL_INTERVAL_MS, checks all modes
 * - Match fires when: queue.length >= minPlayers OR oldest entry > MATCH_TIMEOUT_MS
 * - Bot fills: when oldest entry > MATCH_TIMEOUT_MS but < minPlayers real agents
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getRedisClient } from './redis.js';
import { startGame } from './orchestrator.js';
import { getIO } from './io.js';
import { publishEvent } from './kafka.js';
import { BOT_PROFILES } from './bot.js';

const QUEUE_KEY_PREFIX = 'matchmaking:queue:';
const POLL_INTERVAL_MS = 5_000;    // check queues every 5 seconds
const MATCH_TIMEOUT_MS = 60_000;   // 60s SLA

// Minimum real players per mode (bots fill the rest)
const MIN_REAL_PLAYERS: Record<string, number> = {
  practice: 2,
  cash: 2,
  tournament: 3,
};

// Target table size (ideal full table)
const TARGET_PLAYERS: Record<string, number> = {
  practice: 6,
  cash: 6,
  tournament: 6,
};

export interface QueueEntry {
  agentId: string;
  userId: string;
  agentName: string;
  apiUrl: string;
  webhookPublicKey: string | null;
  joinedAt: number; // ms
}

let processorTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add an agent to the matchmaking queue for a given mode.
 * Idempotent: re-joining refreshes the timestamp.
 */
export async function joinQueue(mode: 'practice' | 'cash' | 'tournament', entry: QueueEntry): Promise<void> {
  const redis = await getRedisClient();
  const key = `${QUEUE_KEY_PREFIX}${mode}`;
  const value = JSON.stringify(entry);
  // ZADD NX: add if not member (prevents score reset on duplicate join)
  await redis.zAdd(key, { score: entry.joinedAt, value }, { NX: true });
}

/**
 * Remove an agent from all queues (leave matchmaking).
 */
export async function leaveQueue(agentId: string): Promise<void> {
  const redis = await getRedisClient();
  for (const mode of ['practice', 'cash', 'tournament']) {
    const key = `${QUEUE_KEY_PREFIX}${mode}`;
    // Scan for the entry matching this agentId (entries are JSON blobs)
    const all = await redis.zRange(key, 0, -1);
    for (const val of all) {
      try {
        const entry = JSON.parse(val) as QueueEntry;
        if (entry.agentId === agentId) {
          await redis.zRem(key, val);
        }
      } catch { /* skip malformed */ }
    }
  }
}

/**
 * Get current queue position and size for an agent.
 */
export async function getQueueStatus(agentId: string): Promise<{
  mode: string | null;
  position: number | null;
  queueSize: number;
  waitingMs: number | null;
}> {
  const redis = await getRedisClient();
  for (const mode of ['practice', 'cash', 'tournament']) {
    const key = `${QUEUE_KEY_PREFIX}${mode}`;
    const all = await redis.zRangeWithScores(key, 0, -1);
    for (let i = 0; i < all.length; i++) {
      try {
        const entry = JSON.parse(all[i]!.value) as QueueEntry;
        if (entry.agentId === agentId) {
          return {
            mode,
            position: i + 1,
            queueSize: all.length,
            waitingMs: Date.now() - all[i]!.score,
          };
        }
      } catch { /* skip */ }
    }
  }
  return { mode: null, position: null, queueSize: 0, waitingMs: null };
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/**
 * Start the background queue processor. Call once on server startup.
 */
export function startMatchmakingProcessor(): void {
  if (processorTimer) return; // already running
  processorTimer = setInterval(() => {
    processAllQueues().catch((err) => {
      console.error('[Matchmaking] Queue processor error:', err);
    });
  }, POLL_INTERVAL_MS);
  console.log('[Matchmaking] Queue processor started (poll interval: 5s, SLA: 60s)');
}

export function stopMatchmakingProcessor(): void {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
}

async function processAllQueues(): Promise<void> {
  for (const mode of ['practice', 'cash', 'tournament'] as const) {
    await processQueue(mode);
  }
}

async function processQueue(mode: 'practice' | 'cash' | 'tournament'): Promise<void> {
  const redis = await getRedisClient();
  const key = `${QUEUE_KEY_PREFIX}${mode}`;

  const entries = await redis.zRangeWithScores(key, 0, -1);
  if (entries.length === 0) return;

  const minPlayers = MIN_REAL_PLAYERS[mode] ?? 2;
  const oldestEntry = entries[0]!;
  const waitingMs = Date.now() - oldestEntry.score;

  const hasEnoughPlayers = entries.length >= minPlayers;
  const timeoutExpired = waitingMs >= MATCH_TIMEOUT_MS;

  // Only match if: (a) enough real players, or (b) at least 2 and timeout expired
  if (!hasEnoughPlayers && (!timeoutExpired || entries.length < 2)) return;

  // Parse all entries
  const realPlayers: QueueEntry[] = [];
  const validValues: string[] = [];
  for (const e of entries) {
    try {
      realPlayers.push(JSON.parse(e.value) as QueueEntry);
      validValues.push(e.value);
    } catch { /* skip malformed */ }
  }

  if (realPlayers.length < 2) return;

  // Remove matched players from queue atomically
  await redis.zRem(key, validValues);

  // Determine final player set (cap at TARGET_PLAYERS, fill with bots if timeout)
  const target = TARGET_PLAYERS[mode] ?? 6;
  const players = realPlayers.slice(0, target);

  if (timeoutExpired && players.length < minPlayers) {
    // Edge case: still under minimum after removing — restore and skip
    for (let i = 0; i < validValues.length; i++) {
      await redis.zAdd(key, { score: realPlayers[i]!.joinedAt, value: validValues[i]! });
    }
    return;
  }

  // Fill with bots if timeout expired and still room
  if (timeoutExpired) {
    const botsNeeded = Math.max(0, minPlayers - players.length);
    for (let i = 0; i < botsNeeded; i++) {
      players.push(await createBotEntry(i));
    }
  }

  // Create arena + seats + start game
  await createMatchedGame(mode, players);
}

// Stable bot agent IDs (lazy-initialized, persisted in DB)
const botAgentIds: Map<string, string> = new Map();
const BOT_OWNER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Get or create a stable bot agent record in the DB.
 * Bot agents satisfy FK constraints while using bot:// apiUrl scheme.
 */
async function getOrCreateBotAgent(botName: string): Promise<string> {
  if (botAgentIds.has(botName)) return botAgentIds.get(botName)!;

  const existing = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.name, botName))
    .limit(1);

  if (existing[0]) {
    botAgentIds.set(botName, existing[0].id);
    return existing[0].id;
  }

  // Ensure system user exists (ON CONFLICT DO NOTHING)
  await db.insert(schema.users).values({
    id: BOT_OWNER_ID,
    username: 'bot-system',
  }).onConflictDoNothing();

  const [agent] = await db.insert(schema.agents).values({
    ownerId: BOT_OWNER_ID,
    name: botName,
    description: 'Auto-fill bot agent',
    apiUrl: 'bot://random',
  }).returning({ id: schema.agents.id });

  const id = agent!.id;
  botAgentIds.set(botName, id);
  return id;
}

/**
 * Create a bot entry for queue filling.
 * Cycles through BOT_PROFILES so each seat gets a distinct personality.
 */
async function createBotEntry(index: number): Promise<QueueEntry> {
  const profile = BOT_PROFILES[index % BOT_PROFILES.length]!;
  const agentId = await getOrCreateBotAgent(profile.name);
  return {
    agentId,
    userId: BOT_OWNER_ID,
    agentName: profile.name,
    apiUrl: profile.url,
    webhookPublicKey: null,
    joinedAt: Date.now(),
  };
}

/**
 * Create an arena, seat all players, and start the game.
 * This mirrors the manual flow of POST /arenas → POST /arenas/:id/join → POST /arenas/:id/start.
 */
async function createMatchedGame(
  mode: 'practice' | 'cash' | 'tournament',
  players: QueueEntry[],
): Promise<void> {
  const blinds = { smallBlind: 10, bigBlind: 20, startingStack: 1000 };

  // Create arena record
  const [arena] = await db
    .insert(schema.arenas)
    .values({
      name: `Auto-Match ${new Date().toISOString().slice(0, 16)}`,
      mode,
      maxPlayers: players.length,
      smallBlind: blinds.smallBlind,
      bigBlind: blinds.bigBlind,
      startingStack: blinds.startingStack,
      maxHands: mode === 'practice' ? 100 : 0,
      buyInAmount: 0,
      status: 'running',
      startedAt: new Date(),
    })
    .returning();

  if (!arena) return;

  // Seat all players
  for (let i = 0; i < players.length; i++) {
    await db.insert(schema.arenaSeats).values({
      arenaId: arena.id,
      agentId: players[i]!.agentId,
      seatIndex: i,
      currentStack: blinds.startingStack,
    }).onConflictDoNothing();
  }

  // Notify players via Socket.io
  getIO().emit('matchmaking:matched', {
    arenaId: arena.id,
    mode,
    players: players.map((p) => ({ agentId: p.agentId, agentName: p.agentName })),
  });

  publishEvent({
    eventType: 'arena_matched',
    arenaId: arena.id,
    mode,
    playerCount: players.length,
    ts: Date.now(),
  });

  console.log(`[Matchmaking] Created ${mode} match: arena=${arena.id}, players=${players.length}`);

  // Start game loop
  startGame(arena.id, arena, players.map((p, i) => ({
    seatIndex: i,
    currentStack: blinds.startingStack,
    agentId: p.agentId,
    agentName: p.agentName,
    apiUrl: p.apiUrl,
    webhookPublicKey: p.webhookPublicKey,
  })));
}
