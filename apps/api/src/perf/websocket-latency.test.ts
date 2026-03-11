/**
 * AGO-47: WebSocket (Socket.io) broadcast latency test.
 *
 * Measures P50 / P95 / P99 latency for Socket.io events broadcast to
 * arena spectators under varying concurrency.
 *
 * The test spins up a lightweight HTTP + Socket.io server, connects N
 * clients, joins them into an arena room, then fires a batch of events
 * and records per-client receive timestamps.
 *
 * Run with: pnpm --filter @agon/api perf:test
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

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const PORT = 0; // let OS pick a free port
const ARENA_ID = '00000000-0000-0000-0000-000000000001';

let httpServer: HttpServer;
let ioServer: SocketIOServer;
let serverAddress: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      httpServer = createServer();
      ioServer = new SocketIOServer(httpServer, {
        cors: { origin: '*' },
      });

      ioServer.on('connection', (socket: ServerSocket) => {
        socket.on('join:arena', (arenaId: string) => {
          socket.join(`arena:${arenaId}`);
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
// Helpers
// ---------------------------------------------------------------------------

async function connectClients(count: number): Promise<ClientSocket[]> {
  const clients: ClientSocket[] = [];

  const promises = Array.from({ length: count }, () => {
    return new Promise<ClientSocket>((resolve) => {
      const client = ioClient(serverAddress, {
        transports: ['websocket'],
        forceNew: true,
      });
      client.on('connect', () => {
        client.emit('join:arena', ARENA_ID);
        // Small delay to let the join propagate
        setTimeout(() => resolve(client), 20);
      });
    });
  });

  const results = await Promise.all(promises);
  clients.push(...results);
  return clients;
}

function disconnectClients(clients: ClientSocket[]): void {
  for (const c of clients) {
    c.disconnect();
  }
}

/**
 * Fire `eventCount` events from the server and record per-client latencies.
 */
async function measureBroadcastLatency(
  clients: ClientSocket[],
  eventCount: number,
): Promise<number[]> {
  const latencies: number[] = [];

  return new Promise<number[]>((resolve) => {
    let received = 0;
    const expected = clients.length * eventCount;

    for (const client of clients) {
      client.on('perf:ping', (payload: { sentAt: number }) => {
        const latency = performance.now() - payload.sentAt;
        latencies.push(latency);
        received++;
        if (received >= expected) {
          // Remove listeners to avoid leaking across test runs
          for (const c of clients) c.off('perf:ping');
          resolve(latencies);
        }
      });
    }

    // Fire events
    for (let i = 0; i < eventCount; i++) {
      ioServer.to(`arena:${ARENA_ID}`).emit('perf:ping', {
        sentAt: performance.now(),
        seq: i,
      });
    }

    // Safety timeout
    setTimeout(() => {
      for (const c of clients) c.off('perf:ping');
      resolve(latencies);
    }, 10_000);
  });
}

/**
 * Simulate game-like event bursts: hand:start, game:action × N, hand:end.
 */
async function measureGameEventLatency(
  clients: ClientSocket[],
  handCount: number,
  actionsPerHand: number,
): Promise<number[]> {
  const latencies: number[] = [];
  const eventsPerHand = 1 + actionsPerHand + 1; // start + actions + end
  const totalEvents = handCount * eventsPerHand;
  const expected = clients.length * totalEvents;

  return new Promise<number[]>((resolve) => {
    let received = 0;

    const handler = (payload: { sentAt: number }) => {
      latencies.push(performance.now() - payload.sentAt);
      received++;
      if (received >= expected) {
        for (const c of clients) {
          c.off('hand:start', handler);
          c.off('game:action', handler);
          c.off('hand:end', handler);
        }
        resolve(latencies);
      }
    };

    for (const client of clients) {
      client.on('hand:start', handler);
      client.on('game:action', handler);
      client.on('hand:end', handler);
    }

    // Emit game events
    for (let h = 0; h < handCount; h++) {
      ioServer.to(`arena:${ARENA_ID}`).emit('hand:start', {
        sentAt: performance.now(),
        handNumber: h + 1,
      });

      for (let a = 0; a < actionsPerHand; a++) {
        ioServer.to(`arena:${ARENA_ID}`).emit('game:action', {
          sentAt: performance.now(),
          handNumber: h + 1,
          seq: a,
        });
      }

      ioServer.to(`arena:${ARENA_ID}`).emit('hand:end', {
        sentAt: performance.now(),
        handNumber: h + 1,
      });
    }

    setTimeout(() => {
      for (const c of clients) {
        c.off('hand:start', handler);
        c.off('game:action', handler);
        c.off('hand:end', handler);
      }
      resolve(latencies);
    }, 15_000);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocket broadcast latency', () => {
  it('1 client, 100 events — baseline', async () => {
    const clients = await connectClients(1);
    const latencies = await measureBroadcastLatency(clients, 100);
    const s = stats(latencies);

    console.log(`  1 client × 100 events:  p50=${s.p50.toFixed(2)}ms  p95=${s.p95.toFixed(2)}ms  p99=${s.p99.toFixed(2)}ms  mean=${s.mean.toFixed(2)}ms`);

    expect(s.p99).toBeLessThan(50); // P99 < 50ms for localhost
    disconnectClients(clients);
  });

  it('10 clients, 100 events — moderate load', async () => {
    const clients = await connectClients(10);
    const latencies = await measureBroadcastLatency(clients, 100);
    const s = stats(latencies);

    console.log(`  10 clients × 100 events: p50=${s.p50.toFixed(2)}ms  p95=${s.p95.toFixed(2)}ms  p99=${s.p99.toFixed(2)}ms  mean=${s.mean.toFixed(2)}ms`);

    expect(s.p99).toBeLessThan(100);
    disconnectClients(clients);
  });

  it('50 clients, 100 events — high concurrency', async () => {
    const clients = await connectClients(50);
    const latencies = await measureBroadcastLatency(clients, 100);
    const s = stats(latencies);

    console.log(`  50 clients × 100 events: p50=${s.p50.toFixed(2)}ms  p95=${s.p95.toFixed(2)}ms  p99=${s.p99.toFixed(2)}ms  mean=${s.mean.toFixed(2)}ms`);

    expect(s.p99).toBeLessThan(200);
    disconnectClients(clients);
  });

  it('100 clients, 50 events — stress test', async () => {
    const clients = await connectClients(100);
    const latencies = await measureBroadcastLatency(clients, 50);
    const s = stats(latencies);

    console.log(`  100 clients × 50 events: p50=${s.p50.toFixed(2)}ms  p95=${s.p95.toFixed(2)}ms  p99=${s.p99.toFixed(2)}ms  mean=${s.mean.toFixed(2)}ms`);

    expect(s.p99).toBeLessThan(500);
    disconnectClients(clients);
  });
});

describe('Game event broadcast latency', () => {
  it('10 spectators, 10 hands × 8 actions — realistic game session', async () => {
    const clients = await connectClients(10);
    const latencies = await measureGameEventLatency(clients, 10, 8);
    const s = stats(latencies);

    console.log(`  Game events (10 spectators, 10 hands × 8 actions):`);
    console.log(`    p50=${s.p50.toFixed(2)}ms  p95=${s.p95.toFixed(2)}ms  p99=${s.p99.toFixed(2)}ms  mean=${s.mean.toFixed(2)}ms  count=${s.count}`);

    expect(s.p99).toBeLessThan(100);
    disconnectClients(clients);
  });

  it('50 spectators, 20 hands × 12 actions — high-traffic arena', async () => {
    const clients = await connectClients(50);
    const latencies = await measureGameEventLatency(clients, 20, 12);
    const s = stats(latencies);

    console.log(`  Game events (50 spectators, 20 hands × 12 actions):`);
    console.log(`    p50=${s.p50.toFixed(2)}ms  p95=${s.p95.toFixed(2)}ms  p99=${s.p99.toFixed(2)}ms  mean=${s.mean.toFixed(2)}ms  count=${s.count}`);

    expect(s.p99).toBeLessThan(200);
    disconnectClients(clients);
  });
});
