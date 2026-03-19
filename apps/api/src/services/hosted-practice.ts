import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { isHostedSkillSparring } from './arena-admission.js';
import { startGame } from './orchestrator.js';

const BOT_OWNER_ID = '00000000-0000-0000-0000-000000000001';
const HOSTED_SPARRING_NAME = 'HostedSkill Sparring';
const HOSTED_SPARRING_API_URL = 'bot://call';
const HOSTED_SPARRING_METADATA = {
  runtimeRole: 'sparring',
  hostedSkillRole: 'sparring',
  hostedSkill: {
    version: 3,
    role: 'sparring',
    source: 'http://agon.win/.well-known/agon-agent-skill.txt',
    transport: HOSTED_SPARRING_API_URL,
    surface: 'self-built-practice',
  },
};

interface HostedPracticeArenaRow {
  id: string;
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  mode: 'practice' | 'cash' | 'tournament';
  allowSparringReplacement: boolean;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  maxHands: number;
  createdByUserId: string | null;
}

interface HostedPracticeSeatRow {
  id: string;
  agentId: string;
  seatIndex: number;
  currentStack: number;
  agentName: string;
  apiUrl: string | null;
  agentMetadata: unknown;
  ownerId: string;
}

function isHostedPracticeArena(arena: HostedPracticeArenaRow): boolean {
  return (
    arena.mode === 'practice' &&
    arena.status === 'waiting' &&
    arena.allowSparringReplacement &&
    arena.maxPlayers === 2 &&
    Boolean(arena.createdByUserId)
  );
}

export function shouldAutoSeatHostedSparring(
  arena: HostedPracticeArenaRow,
  seats: HostedPracticeSeatRow[],
): boolean {
  if (!isHostedPracticeArena(arena)) return false;
  if (seats.length !== 1) return false;
  if (seats.some((seat) => isHostedSkillSparring(seat.agentMetadata))) return false;

  return seats.some((seat) => (
    !isHostedSkillSparring(seat.agentMetadata) &&
    seat.ownerId === arena.createdByUserId
  ));
}

export function shouldAutoStartHostedPracticeArena(
  arena: HostedPracticeArenaRow,
  seats: HostedPracticeSeatRow[],
): boolean {
  if (!isHostedPracticeArena(arena)) return false;
  if (seats.length < 2) return false;

  const creatorSeatExists = seats.some((seat) => (
    !isHostedSkillSparring(seat.agentMetadata) &&
    seat.ownerId === arena.createdByUserId
  ));

  return creatorSeatExists;
}

async function getOrCreateHostedSparringAgent(): Promise<{
  id: string;
  name: string;
  apiUrl: string;
}> {
  const [existing] = await db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      apiUrl: schema.agents.apiUrl,
    })
    .from(schema.agents)
    .where(and(
      eq(schema.agents.name, HOSTED_SPARRING_NAME),
      eq(schema.agents.apiUrl, HOSTED_SPARRING_API_URL),
    ))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      apiUrl: existing.apiUrl ?? HOSTED_SPARRING_API_URL,
    };
  }

  await db.insert(schema.users).values({
    id: BOT_OWNER_ID,
    username: 'bot-system',
  }).onConflictDoNothing();

  const [agent] = await db
    .insert(schema.agents)
    .values({
      ownerId: BOT_OWNER_ID,
      creatorUserId: BOT_OWNER_ID,
      agentAddress: null,
      name: HOSTED_SPARRING_NAME,
      description: 'Auto-filled sparring bot for self-built hosted practice arenas.',
      apiUrl: HOSTED_SPARRING_API_URL,
      metadata: HOSTED_SPARRING_METADATA,
    })
    .returning({
      id: schema.agents.id,
      name: schema.agents.name,
      apiUrl: schema.agents.apiUrl,
    });

  return {
    id: agent!.id,
    name: agent!.name,
    apiUrl: agent!.apiUrl ?? HOSTED_SPARRING_API_URL,
  };
}

async function getArenaSeatDetails(arenaId: string): Promise<HostedPracticeSeatRow[]> {
  return db
    .select({
      id: schema.arenaSeats.id,
      agentId: schema.arenaSeats.agentId,
      seatIndex: schema.arenaSeats.seatIndex,
      currentStack: schema.arenaSeats.currentStack,
      agentName: schema.agents.name,
      apiUrl: schema.agents.apiUrl,
      agentMetadata: schema.agents.metadata,
      ownerId: schema.agents.ownerId,
    })
    .from(schema.arenaSeats)
    .innerJoin(schema.agents, eq(schema.arenaSeats.agentId, schema.agents.id))
    .where(and(
      eq(schema.arenaSeats.arenaId, arenaId),
      eq(schema.arenaSeats.isActive, true),
    ))
    .orderBy(schema.arenaSeats.seatIndex);
}

async function ensureHostedSparringSeat(arena: HostedPracticeArenaRow): Promise<boolean> {
  const seats = await getArenaSeatDetails(arena.id);
  if (!shouldAutoSeatHostedSparring(arena, seats)) {
    return false;
  }

  const sparringAgent = await getOrCreateHostedSparringAgent();
  const takenSeats = new Set(seats.map((seat) => seat.seatIndex));
  let seatIndex = 0;
  while (takenSeats.has(seatIndex)) seatIndex++;

  await db.insert(schema.arenaSeats).values({
    arenaId: arena.id,
    agentId: sparringAgent.id,
    seatIndex,
    currentStack: arena.startingStack,
  }).onConflictDoNothing();

  return true;
}

async function maybeAutoStartArena(arena: HostedPracticeArenaRow): Promise<boolean> {
  const seats = await getArenaSeatDetails(arena.id);
  if (!shouldAutoStartHostedPracticeArena(arena, seats)) {
    return false;
  }

  const [startedArena] = await db
    .update(schema.arenas)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(
      eq(schema.arenas.id, arena.id),
      eq(schema.arenas.status, 'waiting'),
    ))
    .returning({
      id: schema.arenas.id,
      smallBlind: schema.arenas.smallBlind,
      bigBlind: schema.arenas.bigBlind,
      startingStack: schema.arenas.startingStack,
      maxHands: schema.arenas.maxHands,
    });

  if (!startedArena) {
    return false;
  }

  startGame(arena.id, startedArena, seats.map((seat) => ({
    seatIndex: seat.seatIndex,
    currentStack: seat.currentStack,
    agentId: seat.agentId,
    agentName: seat.agentName,
    apiUrl: seat.apiUrl,
  })));

  return true;
}

export async function advanceHostedPracticeArena(arenaId: string): Promise<{
  sparringInserted: boolean;
  autoStarted: boolean;
}> {
  const [arena] = await db
    .select({
      id: schema.arenas.id,
      status: schema.arenas.status,
      mode: schema.arenas.mode,
      allowSparringReplacement: schema.arenas.allowSparringReplacement,
      maxPlayers: schema.arenas.maxPlayers,
      smallBlind: schema.arenas.smallBlind,
      bigBlind: schema.arenas.bigBlind,
      startingStack: schema.arenas.startingStack,
      maxHands: schema.arenas.maxHands,
      createdByUserId: schema.arenas.createdByUserId,
    })
    .from(schema.arenas)
    .where(eq(schema.arenas.id, arenaId))
    .limit(1);

  if (!arena || !isHostedPracticeArena(arena)) {
    return { sparringInserted: false, autoStarted: false };
  }

  const sparringInserted = await ensureHostedSparringSeat(arena);
  const autoStarted = await maybeAutoStartArena(arena);
  return { sparringInserted, autoStarted };
}
