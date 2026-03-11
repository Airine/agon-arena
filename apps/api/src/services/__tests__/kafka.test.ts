import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Producer } from 'kafkajs';

// Mock kafkajs entirely so the module can be imported without a real broker
vi.mock('kafkajs', () => {
  return {
    Kafka: vi.fn().mockImplementation(() => ({
      producer: vi.fn().mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue([]),
      }),
    })),
    CompressionTypes: { GZIP: 1 },
  };
});

import {
  publishEvent,
  shutdownKafka,
  _resetForTest,
  _enableForTest,
  type GameActionEvent,
  type HandStartEvent,
  type HandEndEvent,
  type ArenaMatchedEvent,
  type ArenaFinishedEvent,
} from '../kafka.js';

function makeMockProducer(sendImpl?: () => Promise<unknown>): Producer {
  return {
    send: vi.fn().mockImplementation(sendImpl ?? (() => Promise.resolve([]))),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn(),
    transaction: vi.fn(),
    events: {} as Producer['events'],
    on: vi.fn(),
    logger: vi.fn() as unknown as Producer['logger'],
  } as unknown as Producer;
}

describe('kafka', () => {
  beforeEach(() => {
    _resetForTest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetForTest();
  });

  // ---------------------------------------------------------------------------
  // No-op when not initialized
  // ---------------------------------------------------------------------------

  describe('publishEvent — not initialized', () => {
    it('should not throw when producer is not initialized', () => {
      const event: HandStartEvent = {
        eventType: 'hand_start',
        arenaId: 'arena-1',
        handId: 'hand-1',
        handNumber: 1,
        playerCount: 4,
        vrfCommit: 'abc',
        ts: Date.now(),
      };
      expect(() => publishEvent(event)).not.toThrow();
    });

    it('should be a no-op (no send called) when not initialized', () => {
      const mockProducer = makeMockProducer();
      // Do NOT call _enableForTest — producer remains null
      const event: ArenaFinishedEvent = { eventType: 'arena_finished', arenaId: 'x', ts: 0 };
      publishEvent(event);
      expect(mockProducer.send).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Topic routing
  // ---------------------------------------------------------------------------

  describe('publishEvent — topic routing', () => {
    it('game_action → agon.game.actions', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: GameActionEvent = {
        eventType: 'game_action',
        arenaId: 'arena-1',
        handId: 'hand-1',
        handNumber: 1,
        agentId: 'agent-1',
        action: { type: 'fold' },
        stage: 'preflop',
        sequenceNumber: 1,
        responseTimeMs: 123,
        ts: Date.now(),
      };
      publishEvent(event);

      expect(mockProducer.send).toHaveBeenCalledOnce();
      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.topic).toBe('agon.game.actions');
    });

    it('hand_start → agon.game.hands', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: HandStartEvent = {
        eventType: 'hand_start',
        arenaId: 'arena-1',
        handId: 'hand-1',
        handNumber: 2,
        playerCount: 3,
        vrfCommit: 'commit-xyz',
        ts: Date.now(),
      };
      publishEvent(event);

      expect(mockProducer.send).toHaveBeenCalledOnce();
      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.topic).toBe('agon.game.hands');
    });

    it('hand_end → agon.game.hands', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: HandEndEvent = {
        eventType: 'hand_end',
        arenaId: 'arena-1',
        handId: 'hand-1',
        handNumber: 2,
        winners: [{ agentId: 'agent-1', amount: 200 }],
        potAmount: 200,
        vrfSeed: 'seed-abc',
        ts: Date.now(),
      };
      publishEvent(event);

      expect(mockProducer.send).toHaveBeenCalledOnce();
      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.topic).toBe('agon.game.hands');
    });

    it('arena_matched → agon.game.arenas', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: ArenaMatchedEvent = {
        eventType: 'arena_matched',
        arenaId: 'arena-1',
        mode: 'cash',
        playerCount: 6,
        ts: Date.now(),
      };
      publishEvent(event);

      expect(mockProducer.send).toHaveBeenCalledOnce();
      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.topic).toBe('agon.game.arenas');
    });

    it('arena_finished → agon.game.arenas', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: ArenaFinishedEvent = {
        eventType: 'arena_finished',
        arenaId: 'arena-1',
        ts: Date.now(),
      };
      publishEvent(event);

      expect(mockProducer.send).toHaveBeenCalledOnce();
      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.topic).toBe('agon.game.arenas');
    });
  });

  // ---------------------------------------------------------------------------
  // Message key (arenaId for partition locality)
  // ---------------------------------------------------------------------------

  describe('publishEvent — message key', () => {
    it('uses arenaId as message key', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: ArenaFinishedEvent = {
        eventType: 'arena_finished',
        arenaId: 'arena-99',
        ts: Date.now(),
      };
      publishEvent(event);

      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.messages[0].key).toBe('arena-99');
    });
  });

  // ---------------------------------------------------------------------------
  // event_type header
  // ---------------------------------------------------------------------------

  describe('publishEvent — headers', () => {
    it('includes event_type header matching eventType', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: HandStartEvent = {
        eventType: 'hand_start',
        arenaId: 'arena-1',
        handId: 'hand-1',
        handNumber: 1,
        playerCount: 2,
        vrfCommit: 'c',
        ts: 0,
      };
      publishEvent(event);

      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.messages[0].headers.event_type).toBe('hand_start');
    });

    it('includes schema_version header set to "1"', () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      const event: ArenaMatchedEvent = {
        eventType: 'arena_matched',
        arenaId: 'arena-2',
        mode: 'practice',
        playerCount: 2,
        ts: 0,
      };
      publishEvent(event);

      const call = (mockProducer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.messages[0].headers.schema_version).toBe('1');
    });
  });

  // ---------------------------------------------------------------------------
  // Error swallowing
  // ---------------------------------------------------------------------------

  describe('publishEvent — error handling', () => {
    it('swallows errors from producer.send() and does not propagate', async () => {
      const mockProducer = makeMockProducer(() => Promise.reject(new Error('broker down')));
      _enableForTest(mockProducer);

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const event: ArenaFinishedEvent = { eventType: 'arena_finished', arenaId: 'a', ts: 0 };

      // publishEvent is fire-and-forget; we flush microtasks to let the rejected promise settle
      expect(() => publishEvent(event)).not.toThrow();

      // Wait for the micro-task queue to drain so the .catch() handler runs
      await Promise.resolve();
      await Promise.resolve();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Kafka] Failed to publish arena_finished:'),
        'broker down',
      );

      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // shutdownKafka — no-op when not connected
  // ---------------------------------------------------------------------------

  describe('shutdownKafka', () => {
    it('is a no-op and does not throw when not connected', async () => {
      // _resetForTest already called in beforeEach
      await expect(shutdownKafka()).resolves.toBeUndefined();
    });

    it('disconnects the producer and resets state when connected', async () => {
      const mockProducer = makeMockProducer();
      _enableForTest(mockProducer);

      await shutdownKafka();

      expect(mockProducer.disconnect).toHaveBeenCalledOnce();

      // After shutdown, publishEvent should be a no-op
      const event: ArenaFinishedEvent = { eventType: 'arena_finished', arenaId: 'z', ts: 0 };
      publishEvent(event);
      // send was never called after disconnect
      expect(mockProducer.send).not.toHaveBeenCalled();
    });
  });
});
