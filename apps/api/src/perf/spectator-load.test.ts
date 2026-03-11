/**
 * AGO-44: Load test — 1000 concurrent WebSocket spectators.
 *
 * Validates that the Socket.io broadcast layer can sustain 1000 simultaneous
 * spectator connections receiving game events with acceptable latency, memory
 * footprint, and zero message loss.
 *
 * Metrics collected:
 *  - Connection success rate & connection time
 *  - Broadcast latency P50 / P95 / P99
 *  - Message delivery rate (loss detection)
 *  - Heap memory delta under load
 *
 * Run with: pnpm --filter @agon/api perf:test -- spectator-load
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket as ServerSocket } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function stats(latencies: number[]) {
  if (latencies.length === 0) {
    return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0, count: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    min: sorted[0]!,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!,
    mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    count: latencies.length,
  };
}

function formatMs(v: number): string {
  return v.toFixed(2) + 'ms';
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const PORT = 0;
const ARENA_ID = '00000000-0000-0000-0000-000000001000';

let httpServer: HttpServer;
let ioServer: SocketIOServer;
let serverAddress: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      httpServer = createServer();
      ioServer = new SocketIOServer(httpServer, {
        cors: { origin: '*' },
        // Match production transport
        transports: ['websocket'],
      });

      ioServer.on('connection', (socket: ServerSocket) => {
        socket.on('join:arena', (arenaId: string) => {
          socket.join(`arena:${arenaId}`);
        });
        socket.on('leave:arena', (arenaId: string) => {
          socket.leave(`arena:${arenaId}`);
        });
      });

      httpServer.listen(PORT, () => {
        const addr = httpServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        serverAddress = `http://localhost:${port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      ioServer.close();
      httpServer.close(() => resolve());
    }),
);

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

/**
 * Connect N clients in batches to avoid overwhelming the event loop.
 * Returns connected clients and connection time statistics.
 */
async function connectClientsBatched(
  total: number,
  batchSize = 50,
): Promise<{ clients: ClientSocket[]; connectionTimes: number[]; failed: number }> {
  const clients: ClientSocket[] = [];
  const connectionTimes: number[] = [];
  let failed = 0;

  for (let offset = 0; offset < total; offset += batchSize) {
    const count = Math.min(batchSize, total - offset);

    const batchPromises = Array.from({ length: count }, () => {
      const startTime = performance.now();
      return new Promise<ClientSocket | null>((resolve) => {
        const client = ioClient(serverAddress, {
          transports: ['websocket'],
          forceNew: true,
          timeout: 10_000,
        });

        client.on('connect', () => {
          connectionTimes.push(performance.now() - startTime);
          client.emit('join:arena', ARENA_ID);
          resolve(client);
        });

        client.on('connect_error', () => {
          failed++;
          client.disconnect();
          resolve(null);
        });

        // Per-client timeout
        setTimeout(() => {
          if (!client.connected) {
            failed++;
            client.disconnect();
            resolve(null);
          }
        }, 10_000);
      });
    });

    const results = await Promise.all(batchPromises);
    for (const c of results) {
      if (c) clients.push(c);
    }
  }

  // Wait for room joins to propagate
  await sleep(200);
  return { clients, connectionTimes, failed };
}

function disconnectClients(clients: ClientSocket[]): void {
  for (const c of clients) c.disconnect();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Broadcast measurement
// ---------------------------------------------------------------------------

async function measureBroadcastLatency(
  clients: ClientSocket[],
  eventCount: number,
): Promise<{ latencies: number[]; delivered: number; expected: number }> {
  const latencies: number[] = [];
  const expected = clients.length * eventCount;

  return new Promise((resolve) => {
    let delivered = 0;

    for (const client of clients) {
      client.on('perf:ping', (payload: { sentAt: number }) => {
        latencies.push(performance.now() - payload.sentAt);
        delivered++;
        if (delivered >= expected) {
          for (const c of clients) c.off('perf:ping');
          resolve({ latencies, delivered, expected });
        }
      });
    }

    // Emit events with 10ms spacing to simulate realistic broadcast cadence
    let seq = 0;
    const interval = setInterval(() => {
      if (seq >= eventCount) {
        clearInterval(interval);
        return;
      }
      ioServer.to(`arena:${ARENA_ID}`).emit('perf:ping', {
        sentAt: performance.now(),
        seq,
      });
      seq++;
    }, 10);

    // Safety timeout — generous for 1000 clients
    setTimeout(() => {
      clearInterval(interval);
      for (const c of clients) c.off('perf:ping');
      resolve({ latencies, delivered, expected });
    }, 30_000);
  });
}

/**
 * Simulate a realistic game session with hand:start / game:action / hand:end
 * event sequences and measure per-client latencies.
 */
async function measureGameSessionLatency(
  clients: ClientSocket[],
  handCount: number,
  actionsPerHand: number,
): Promise<{ latencies: number[]; delivered: number; expected: number }> {
  const latencies: number[] = [];
  const eventsPerHand = 1 + actionsPerHand + 1;
  const totalEvents = handCount * eventsPerHand;
  const expected = clients.length * totalEvents;

  return new Promise((resolve) => {
    let delivered = 0;

    const handler = (payload: { sentAt: number }) => {
      latencies.push(performance.now() - payload.sentAt);
      delivered++;
      if (delivered >= expected) {
        cleanup();
        resolve({ latencies, delivered, expected });
      }
    };

    const cleanup = () => {
      for (const c of clients) {
        c.off('hand:start', handler);
        c.off('game:action', handler);
        c.off('hand:end', handler);
      }
    };

    for (const client of clients) {
      client.on('hand:start', handler);
      client.on('game:action', handler);
      client.on('hand:end', handler);
    }

    // Emit game events with realistic pacing
    let handIndex = 0;
    const emitHand = () => {
      if (handIndex >= handCount) return;

      ioServer.to(`arena:${ARENA_ID}`).emit('hand:start', {
        sentAt: performance.now(),
        handNumber: handIndex + 1,
        players: [
          { agentId: 'agent-1', agentName: 'AlphaBot', stack: 10000 },
          { agentId: 'agent-2', agentName: 'BetaBot', stack: 10000 },
        ],
      });

      // Actions spaced 5ms apart
      for (let a = 0; a < actionsPerHand; a++) {
        setTimeout(() => {
          ioServer.to(`arena:${ARENA_ID}`).emit('game:action', {
            sentAt: performance.now(),
            handNumber: handIndex + 1,
            agentId: a % 2 === 0 ? 'agent-1' : 'agent-2',
            action: { type: 'call' },
            resultingState: { stage: 'flop', communityCards: ['Ah', 'Kd', '9c'] },
          });
        }, (a + 1) * 5);
      }

      setTimeout(() => {
        ioServer.to(`arena:${ARENA_ID}`).emit('hand:end', {
          sentAt: performance.now(),
          handNumber: handIndex + 1,
          winners: [{ agentId: 'agent-1', amount: 200 }],
        });
        handIndex++;
        // Next hand after a brief gap
        if (handIndex < handCount) setTimeout(emitHand, 50);
      }, (actionsPerHand + 1) * 5 + 20);
    };

    emitHand();

    // Safety timeout
    setTimeout(() => {
      cleanup();
      resolve({ latencies, delivered, expected });
    }, 60_000);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('1000 concurrent spectator load test', { timeout: 120_000 }, () => {
  it('connects 1000 clients with >99% success rate', async () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    const { clients, connectionTimes, failed } = await connectClientsBatched(1000);
    const totalTime = performance.now() - startTime;

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDelta = heapAfter - heapBefore;
    const connStats = stats(connectionTimes);
    const successRate = (clients.length / (clients.length + failed)) * 100;

    console.log('\n  === 1000 Client Connection ===');
    console.log(`  Connected: ${clients.length} / ${clients.length + failed}  (${successRate.toFixed(1)}%)`);
    console.log(`  Total time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`  Connection time — p50=${formatMs(connStats.p50)}  p95=${formatMs(connStats.p95)}  p99=${formatMs(connStats.p99)}`);
    console.log(`  Heap delta: ${formatMB(heapDelta)}`);

    // Assertions
    expect(successRate).toBeGreaterThanOrEqual(99);
    expect(connStats.p99).toBeLessThan(5000);

    disconnectClients(clients);
  });

  it('broadcasts to 500 spectators — P99 < 500ms', async () => {
    const { clients } = await connectClientsBatched(500);
    const { latencies, delivered, expected } = await measureBroadcastLatency(clients, 20);
    const s = stats(latencies);
    const deliveryRate = (delivered / expected) * 100;

    console.log('\n  === 500 Spectators × 20 Events ===');
    console.log(`  Delivery: ${delivered}/${expected} (${deliveryRate.toFixed(1)}%)`);
    console.log(`  Latency — p50=${formatMs(s.p50)}  p95=${formatMs(s.p95)}  p99=${formatMs(s.p99)}  max=${formatMs(s.max)}`);

    expect(deliveryRate).toBeGreaterThanOrEqual(99);
    expect(s.p99).toBeLessThan(500);
    disconnectClients(clients);
  });

  it('broadcasts to 1000 spectators — P99 < 1000ms', async () => {
    const { clients } = await connectClientsBatched(1000);
    const heapBefore = process.memoryUsage().heapUsed;

    const { latencies, delivered, expected } = await measureBroadcastLatency(clients, 20);
    const s = stats(latencies);
    const deliveryRate = (delivered / expected) * 100;

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDelta = heapAfter - heapBefore;

    console.log('\n  === 1000 Spectators × 20 Events ===');
    console.log(`  Delivery: ${delivered}/${expected} (${deliveryRate.toFixed(1)}%)`);
    console.log(`  Latency — p50=${formatMs(s.p50)}  p95=${formatMs(s.p95)}  p99=${formatMs(s.p99)}  max=${formatMs(s.max)}`);
    console.log(`  Heap delta during broadcast: ${formatMB(heapDelta)}`);

    expect(deliveryRate).toBeGreaterThanOrEqual(99);
    expect(s.p99).toBeLessThan(1000);
    disconnectClients(clients);
  });

  it('1000 spectators — realistic game session (5 hands × 8 actions)', async () => {
    const { clients } = await connectClientsBatched(1000);
    const heapBefore = process.memoryUsage().heapUsed;

    const { latencies, delivered, expected } = await measureGameSessionLatency(clients, 5, 8);
    const s = stats(latencies);
    const deliveryRate = (delivered / expected) * 100;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;

    console.log('\n  === 1000 Spectators — Game Session (5 hands × 8 actions) ===');
    console.log(`  Total events per client: ${5 * (1 + 8 + 1)} = 50`);
    console.log(`  Delivery: ${delivered}/${expected} (${deliveryRate.toFixed(1)}%)`);
    console.log(`  Latency — p50=${formatMs(s.p50)}  p95=${formatMs(s.p95)}  p99=${formatMs(s.p99)}  max=${formatMs(s.max)}`);
    console.log(`  Heap delta: ${formatMB(heapDelta)}`);

    expect(deliveryRate).toBeGreaterThanOrEqual(99);
    expect(s.p99).toBeLessThan(1000);
    disconnectClients(clients);
  });

  it('sustained load — 1000 spectators × 50 events with memory stability', async () => {
    const { clients } = await connectClientsBatched(1000);

    // Force GC if available to get a clean baseline
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    const { latencies, delivered, expected } = await measureBroadcastLatency(clients, 50);
    const s = stats(latencies);
    const deliveryRate = (delivered / expected) * 100;

    if (global.gc) global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDelta = heapAfter - heapBefore;

    console.log('\n  === Sustained Load: 1000 × 50 Events ===');
    console.log(`  Total messages: ${expected.toLocaleString()}`);
    console.log(`  Delivery: ${delivered}/${expected} (${deliveryRate.toFixed(1)}%)`);
    console.log(`  Latency — p50=${formatMs(s.p50)}  p95=${formatMs(s.p95)}  p99=${formatMs(s.p99)}  max=${formatMs(s.max)}`);
    console.log(`  Heap delta: ${formatMB(heapDelta)}`);
    console.log(`  Throughput: ~${((delivered / (s.max * clients.length)) * 1000).toFixed(0)} events/s delivered`);

    expect(deliveryRate).toBeGreaterThanOrEqual(98);
    expect(s.p99).toBeLessThan(2000);
    // Memory shouldn't grow more than 200MB for 50k messages
    expect(heapDelta).toBeLessThan(200 * 1024 * 1024);
    disconnectClients(clients);
  });

  it('multi-arena — 500 spectators each in 2 arenas simultaneously', async () => {
    const ARENA_2 = '00000000-0000-0000-0000-000000002000';
    const { clients: arena1Clients } = await connectClientsBatched(500);

    // Connect second set to a different arena
    const arena2Clients: ClientSocket[] = [];
    const batchSize = 50;
    for (let offset = 0; offset < 500; offset += batchSize) {
      const count = Math.min(batchSize, 500 - offset);
      const batch = await Promise.all(
        Array.from({ length: count }, () =>
          new Promise<ClientSocket>((resolve) => {
            const client = ioClient(serverAddress, {
              transports: ['websocket'],
              forceNew: true,
            });
            client.on('connect', () => {
              client.emit('join:arena', ARENA_2);
              resolve(client);
            });
          }),
        ),
      );
      arena2Clients.push(...batch);
    }
    await sleep(200);

    // Broadcast to both arenas concurrently
    const latencies1: number[] = [];
    const latencies2: number[] = [];
    const eventCount = 10;

    const measure = (
      clients: ClientSocket[],
      arenaId: string,
      collector: number[],
    ): Promise<number> =>
      new Promise((resolve) => {
        let received = 0;
        const expected = clients.length * eventCount;

        for (const c of clients) {
          c.on('perf:ping', (payload: { sentAt: number; arena: string }) => {
            if (payload.arena === arenaId) {
              collector.push(performance.now() - payload.sentAt);
              received++;
              if (received >= expected) {
                for (const cl of clients) cl.off('perf:ping');
                resolve(received);
              }
            }
          });
        }

        let seq = 0;
        const iv = setInterval(() => {
          if (seq >= eventCount) { clearInterval(iv); return; }
          ioServer.to(`arena:${arenaId}`).emit('perf:ping', {
            sentAt: performance.now(),
            seq,
            arena: arenaId,
          });
          seq++;
        }, 15);

        setTimeout(() => {
          clearInterval(iv);
          for (const cl of clients) cl.off('perf:ping');
          resolve(received);
        }, 20_000);
      });

    const [d1, d2] = await Promise.all([
      measure(arena1Clients, ARENA_ID, latencies1),
      measure(arena2Clients, ARENA_2, latencies2),
    ]);

    const s1 = stats(latencies1);
    const s2 = stats(latencies2);

    console.log('\n  === Multi-Arena: 2 × 500 Spectators × 10 Events ===');
    console.log(`  Arena 1 — delivered=${d1}  p50=${formatMs(s1.p50)}  p95=${formatMs(s1.p95)}  p99=${formatMs(s1.p99)}`);
    console.log(`  Arena 2 — delivered=${d2}  p50=${formatMs(s2.p50)}  p95=${formatMs(s2.p95)}  p99=${formatMs(s2.p99)}`);

    expect(d1).toBeGreaterThanOrEqual(arena1Clients.length * eventCount * 0.99);
    expect(d2).toBeGreaterThanOrEqual(arena2Clients.length * eventCount * 0.99);
    expect(s1.p99).toBeLessThan(1000);
    expect(s2.p99).toBeLessThan(1000);

    disconnectClients(arena1Clients);
    disconnectClients(arena2Clients);
  });
});
