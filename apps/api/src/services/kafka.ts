/**
 * AGO-29: Kafka event stream producer.
 *
 * Publishes game events to Kafka topics for downstream consumers.
 * If KAFKA_BROKERS is not set, all publish calls are no-ops (graceful degradation).
 *
 * Topics:
 *   agon.game.actions  — every player action (fold/check/call/raise/all_in/timeout)
 *   agon.game.hands    — hand start/end lifecycle events
 *   agon.game.arenas   — arena lifecycle (matched, started, finished)
 *
 * Message format:
 *   key: arenaId (for partition locality — all events from one arena go to same partition)
 *   value: JSON-serialized event payload
 *   headers: { event_type, schema_version: '1' }
 */
import { Kafka, type Producer, type ProducerRecord, CompressionTypes } from 'kafkajs';

const TOPIC_ACTIONS = 'agon.game.actions';
const TOPIC_HANDS   = 'agon.game.hands';
const TOPIC_ARENAS  = 'agon.game.arenas';

// Event type interfaces
export interface GameActionEvent {
  eventType: 'game_action';
  arenaId: string;
  handId: string;
  handNumber: number;
  agentId: string;
  action: { type: string; amount?: number };
  stage: string;
  sequenceNumber: number;
  responseTimeMs: number | null;
  ts: number; // unix ms
}

export interface HandStartEvent {
  eventType: 'hand_start';
  arenaId: string;
  handId: string;
  handNumber: number;
  playerCount: number;
  vrfCommit: string;
  ts: number;
}

export interface HandEndEvent {
  eventType: 'hand_end';
  arenaId: string;
  handId: string;
  handNumber: number;
  winners: Array<{ agentId: string; amount: number }>;
  potAmount: number;
  vrfSeed: string;
  ts: number;
}

export interface ArenaMatchedEvent {
  eventType: 'arena_matched';
  arenaId: string;
  mode: string;
  playerCount: number;
  ts: number;
}

export interface ArenaFinishedEvent {
  eventType: 'arena_finished';
  arenaId: string;
  ts: number;
}

export type GameEvent = GameActionEvent | HandStartEvent | HandEndEvent | ArenaMatchedEvent | ArenaFinishedEvent;

let producer: Producer | null = null;
let isConnected = false;
let isEnabled = false;

function getTopicForEvent(event: GameEvent): string {
  switch (event.eventType) {
    case 'game_action': return TOPIC_ACTIONS;
    case 'hand_start':
    case 'hand_end': return TOPIC_HANDS;
    case 'arena_matched':
    case 'arena_finished': return TOPIC_ARENAS;
  }
}

/**
 * Initialize Kafka producer on startup. No-op if KAFKA_BROKERS is not set.
 */
export async function initKafka(): Promise<void> {
  const brokers = process.env['KAFKA_BROKERS'];
  if (!brokers) {
    console.log('[Kafka] KAFKA_BROKERS not set — Kafka publishing disabled');
    return;
  }

  const clientId = process.env['KAFKA_CLIENT_ID'] ?? 'agon-arena-api';
  const kafka = new Kafka({
    clientId,
    brokers: brokers.split(',').map((b) => b.trim()),
  });

  producer = kafka.producer({
    allowAutoTopicCreation: true,
    compression: CompressionTypes.GZIP,
  });

  await producer.connect();
  isConnected = true;
  isEnabled = true;
  console.log(`[Kafka] Producer connected — brokers: ${brokers}`);
}

/**
 * Gracefully shut down the Kafka producer.
 */
export async function shutdownKafka(): Promise<void> {
  if (producer && isConnected) {
    await producer.disconnect();
    isConnected = false;
    producer = null;
    console.log('[Kafka] Producer disconnected');
  }
}

/**
 * Publish a game event to the appropriate Kafka topic.
 * Fire-and-forget: errors are logged but never propagated.
 */
export function publishEvent(event: GameEvent): void {
  if (!isEnabled || !producer || !isConnected) return;

  const topic = getTopicForEvent(event);
  const record: ProducerRecord = {
    topic,
    messages: [{
      key: (event as { arenaId?: string }).arenaId ?? 'global',
      value: JSON.stringify(event),
      headers: {
        event_type: event.eventType,
        schema_version: '1',
      },
    }],
  };

  producer.send(record).catch((err: Error) => {
    console.warn(`[Kafka] Failed to publish ${event.eventType}:`, err.message);
  });
}

/** Exposed for testing */
export function _resetForTest(): void {
  producer = null;
  isConnected = false;
  isEnabled = false;
}

export function _enableForTest(mockProducer: Producer): void {
  producer = mockProducer;
  isConnected = true;
  isEnabled = true;
}
