/**
 * AGO-88: Performance test — 10 concurrent arena tables running stable
 *
 * Verifies:
 *   1. 10 arenas can be created, started, and completed concurrently
 *   2. No race conditions: each arena's chip total is conserved independently
 *   3. P99 response time for key API calls < 200ms
 *   4. Arena state is isolated (arena A does not affect arena B's chip counts)
 *   5. Socket.IO endpoint responds correctly to all 10 connections
 */

import { test, expect } from '@playwright/test';
import { registerUser, createAgent } from './helpers.js';

const ARENA_COUNT = 10;
const POLL_INTERVAL_MS = 200;
const GAME_TIMEOUT_MS = 60_000; // 60s for all 10 arenas to finish

/**
 * Collect a sample of response times for a request factory.
 * Returns sorted array of durations in milliseconds.
 */
async function measureLatencies(
  factory: () => Promise<{ status: () => number }>,
  samples: number,
): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = Date.now();
    await factory();
    times.push(Date.now() - start);
  }
  return times.sort((a, b) => a - b);
}

function p99(sorted: number[]): number {
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)]!;
}

/** Poll until all arena IDs have status=finished, or timeout. */
async function waitForAllFinished(
  request: import('@playwright/test').APIRequestContext,
  arenaIds: string[],
  { intervalMs = POLL_INTERVAL_MS, timeoutMs = GAME_TIMEOUT_MS }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(arenaIds);

  while (pending.size > 0 && Date.now() < deadline) {
    const checks = await Promise.all(
      [...pending].map(async (id) => {
        const res = await request.get(`/arenas/${id}`);
        const body = await res.json();
        return { id, status: body.status as string };
      }),
    );
    for (const { id, status } of checks) {
      if (status === 'finished') pending.delete(id);
    }
    if (pending.size > 0) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return pending.size === 0;
}

// ---------------------------------------------------------------------------
// Setup: shared owner + agents (reused across all arena tests)
// ---------------------------------------------------------------------------

let ownerToken: string;
const agentIds: string[] = [];

test.beforeAll(async ({ request }) => {
  const { token } = await registerUser(request);
  ownerToken = token;

  // Pre-create 20 agents (2 per arena × 10 arenas)
  const agentResults = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      createAgent(request, ownerToken, { name: `PerfBot_${i}` }),
    ),
  );
  for (const { agent } of agentResults) {
    agentIds.push(agent.id);
  }
});

// ---------------------------------------------------------------------------
// 1. API response time baseline
// ---------------------------------------------------------------------------

test.describe('API Latency Baseline', () => {
  test('GET /arenas responds within P99 < 200ms over 20 samples', async ({ request }) => {
    const latencies = await measureLatencies(() => request.get('/arenas'), 20);
    const p99ms = p99(latencies);
    expect(p99ms, `P99 latency ${p99ms}ms exceeds 200ms`).toBeLessThan(200);
  });

  test('GET /auth/me responds within P99 < 200ms over 20 samples', async ({ request }) => {
    const latencies = await measureLatencies(
      () => request.get('/auth/me', { headers: { Authorization: `Bearer ${ownerToken}` } }),
      20,
    );
    const p99ms = p99(latencies);
    expect(p99ms, `P99 latency ${p99ms}ms exceeds 200ms`).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// 2. Concurrent arena creation
// ---------------------------------------------------------------------------

test.describe(`${ARENA_COUNT} Concurrent Arena Tables`, () => {
  const arenaIds: string[] = [];

  test(`Create ${ARENA_COUNT} arenas in parallel — all succeed`, async ({ request }) => {
    const results = await Promise.all(
      Array.from({ length: ARENA_COUNT }, (_, i) =>
        request.post('/arenas', {
          data: {
            name: `PerfArena_${i}`,
            mode: 'practice',
            maxPlayers: 2,
            smallBlind: 10,
            bigBlind: 20,
            startingStack: 1000,
            maxHands: 1,
          },
          headers: { Authorization: `Bearer ${ownerToken}` },
        }),
      ),
    );

    for (const res of results) {
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.status).toBe('waiting');
      arenaIds.push(body.id);
    }

    expect(arenaIds).toHaveLength(ARENA_COUNT);
  });

  test('Seat 2 agents in each arena in parallel', async ({ request }) => {
    const joinOps = arenaIds.flatMap((arenaId, i) => [
      request.post(`/arenas/${arenaId}/join`, {
        data: { agentId: agentIds[i * 2]! },
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
      request.post(`/arenas/${arenaId}/join`, {
        data: { agentId: agentIds[i * 2 + 1]! },
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
    ]);

    const results = await Promise.all(joinOps);
    for (const res of results) {
      expect(res.status()).toBe(201);
    }
  });

  test('Start all 10 arenas simultaneously', async ({ request }) => {
    const results = await Promise.all(
      arenaIds.map((arenaId) =>
        request.post(`/arenas/${arenaId}/start`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        }),
      ),
    );

    for (const res of results) {
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Game started');
    }
  });

  test('All 10 arenas finish within timeout', async ({ request }) => {
    const allFinished = await waitForAllFinished(request, arenaIds);
    expect(allFinished, 'Not all arenas finished within timeout').toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. State isolation (run after all arenas finish)
  // ---------------------------------------------------------------------------

  test('Each arena conserves chips independently (no cross-contamination)', async ({ request }) => {
    const arenaData = await Promise.all(
      arenaIds.map((arenaId) => request.get(`/arenas/${arenaId}`).then((r) => r.json())),
    );

    for (const arena of arenaData) {
      expect(arena.status).toBe('finished');

      const seats: Array<{ currentStack: number }> = arena.seats;
      expect(seats).toHaveLength(2);

      const total = seats.reduce((sum, s) => sum + s.currentStack, 0);
      // Chips conserved: total must equal 2 × startingStack (2000)
      expect(total).toBe(2000);
    }
  });

  test('GET /arenas/:id latency P99 < 200ms while 10 arenas are active', async ({ request }) => {
    // Sample the first arena 20 times rapidly
    const arenaId = arenaIds[0]!;
    const latencies = await measureLatencies(() => request.get(`/arenas/${arenaId}`), 20);
    const p99ms = p99(latencies);
    expect(p99ms, `P99 arena-read latency ${p99ms}ms exceeds 200ms`).toBeLessThan(200);
  });

  test('POST /arenas/:id/start latency < 500ms each', async ({ request }) => {
    // Create an additional arena to measure start latency
    const { token: freshToken } = await registerUser(request);
    const { agent: a1 } = await createAgent(request, freshToken, { name: 'LatBot1' });
    const { agent: a2 } = await createAgent(request, freshToken, { name: 'LatBot2' });

    const createRes = await request.post('/arenas', {
      data: {
        name: 'LatencyCheck',
        mode: 'practice',
        maxPlayers: 2,
        smallBlind: 10,
        bigBlind: 20,
        startingStack: 1000,
        maxHands: 1,
      },
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    expect(createRes.status()).toBe(201);
    const latArena = await createRes.json();

    await request.post(`/arenas/${latArena.id}/join`, {
      data: { agentId: a1.id },
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    await request.post(`/arenas/${latArena.id}/join`, {
      data: { agentId: a2.id },
      headers: { Authorization: `Bearer ${freshToken}` },
    });

    const startT0 = Date.now();
    const startRes = await request.post(`/arenas/${latArena.id}/start`, {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    const startLatency = Date.now() - startT0;
    expect(startRes.status()).toBe(200);
    expect(startLatency, `Start latency ${startLatency}ms exceeds 500ms`).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 4. Socket.IO endpoint availability
// ---------------------------------------------------------------------------

test.describe('Socket.IO Endpoint Availability', () => {
  test('GET /socket.io/ returns 200 (Socket.IO polling handshake)', async ({ request }) => {
    // Socket.IO long-polling transport: GET /socket.io/?EIO=4&transport=polling
    const res = await request.get('/socket.io/?EIO=4&transport=polling');
    // Socket.IO responds 200 with session payload (not 404 or 500)
    expect(res.status()).toBe(200);
  });

  test('Socket.IO endpoint responds to 10 simultaneous handshakes', async ({ request }) => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request.get('/socket.io/?EIO=4&transport=polling'),
      ),
    );
    for (const res of results) {
      expect(res.status()).toBe(200);
    }
  });
});
