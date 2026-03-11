/**
 * AGO-85: E2E test — full game lifecycle
 *
 * Flow:
 *   1. Register owner user + create 2 agents
 *   2. Create a practice arena (maxHands: 1 → finishes after 1 hand)
 *   3. Seat both agents
 *   4. Start the game — verifies arena transitions to 'running'
 *   5. Poll until arena transitions to 'finished' (bots play instantly)
 *   6. Verify agent stats (handsPlayed updated)
 *   7. Verify VRF commit-reveal integrity via GET /arenas/:id/hands
 */

import { test, expect } from '@playwright/test';
import { registerUser, createAgent } from './helpers.js';
import crypto from 'crypto';

/** Poll a predicate every intervalMs until it returns true or timeoutMs elapses. */
async function pollUntil(
  predicate: () => Promise<boolean>,
  { intervalMs = 500, timeoutMs = 15_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

test.describe('Full Game Lifecycle (matchmaking → deal → showdown → payout)', () => {
  let token: string;
  let agent1Id: string;
  let agent2Id: string;
  let arenaId: string;

  test.beforeAll(async ({ request }) => {
    const { token: t } = await registerUser(request);
    token = t;

    const { agent: a1 } = await createAgent(request, token, { name: 'BotA' });
    const { agent: a2 } = await createAgent(request, token, { name: 'BotB' });
    agent1Id = a1.id;
    agent2Id = a2.id;
  });

  // ------------------------------------------------------------------
  // Arena creation
  // ------------------------------------------------------------------

  test('POST /arenas creates a 1-hand practice arena', async ({ request }) => {
    const res = await request.post('/arenas', {
      data: {
        name: 'E2E Lifecycle Arena',
        mode: 'practice',
        maxPlayers: 2,
        smallBlind: 10,
        bigBlind: 20,
        startingStack: 1000,
        maxHands: 1, // finish after exactly 1 hand
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toBe('waiting');
    expect(body.maxHands).toBe(1);
    arenaId = body.id;
  });

  // ------------------------------------------------------------------
  // Seating agents
  // ------------------------------------------------------------------

  test('POST /arenas/:id/join seats both agents', async ({ request }) => {
    const r1 = await request.post(`/arenas/${arenaId}/join`, {
      data: { agentId: agent1Id },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r1.status()).toBe(201);
    const s1 = await r1.json();
    expect(s1.currentStack).toBe(1000);

    const r2 = await request.post(`/arenas/${arenaId}/join`, {
      data: { agentId: agent2Id },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r2.status()).toBe(201);
  });

  // ------------------------------------------------------------------
  // Start game
  // ------------------------------------------------------------------

  test('POST /arenas/:id/start transitions arena to running', async ({ request }) => {
    const res = await request.post(`/arenas/${arenaId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.message).toBe('Game started');
    expect(body.playerCount).toBe(2);

    // Arena status must now be 'running'
    const arenaRes = await request.get(`/arenas/${arenaId}`);
    const arena = await arenaRes.json();
    expect(arena.status).toBe('running');
  });

  // ------------------------------------------------------------------
  // Wait for game to finish (bots play synchronously, should be fast)
  // ------------------------------------------------------------------

  test('Arena transitions to finished after 1 hand', async ({ request }) => {
    const finished = await pollUntil(
      async () => {
        const res = await request.get(`/arenas/${arenaId}`);
        const body = await res.json();
        return body.status === 'finished';
      },
      { intervalMs: 300, timeoutMs: 20_000 },
    );

    expect(finished, 'Arena did not finish within timeout').toBe(true);
  });

  // ------------------------------------------------------------------
  // Verify chip redistribution
  // ------------------------------------------------------------------

  test('Chips redistributed: one agent gained, one lost', async ({ request }) => {
    const arenaRes = await request.get(`/arenas/${arenaId}`);
    const arena = await arenaRes.json();
    expect(arena.status).toBe('finished');

    const seats: Array<{ currentStack: number; agentId: string }> = arena.seats;
    expect(seats).toHaveLength(2);

    const stacks = seats.map((s) => s.currentStack);
    const total = stacks.reduce((a, b) => a + b, 0);

    // Total chips are conserved (no rake in practice mode)
    expect(total).toBe(2000); // 2 players × 1000 starting stack

    // At least one player's stack changed (chips moved between players)
    const unchanged = stacks.filter((s) => s === 1000);
    expect(unchanged.length).toBeLessThan(2);
  });

  // ------------------------------------------------------------------
  // Verify agent stats updated
  // ------------------------------------------------------------------

  test('Agent stats reflect completed hand', async ({ request }) => {
    const [r1, r2] = await Promise.all([
      request.get(`/agents/${agent1Id}`),
      request.get(`/agents/${agent2Id}`),
    ]);

    const a1 = await r1.json();
    const a2 = await r2.json();

    // Both agents played at least 1 hand
    expect(a1.handsPlayed).toBeGreaterThanOrEqual(1);
    expect(a2.handsPlayed).toBeGreaterThanOrEqual(1);

    // Exactly one agent won the hand
    const totalWins = (a1.handsWon ?? 0) + (a2.handsWon ?? 0);
    expect(totalWins).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // VRF commit-reveal integrity
  // ------------------------------------------------------------------

  test('GET /arenas/:id/hands returns hand with VRF commit and revealed seed', async ({ request }) => {
    const res = await request.get(`/arenas/${arenaId}/hands`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);

    const hand = body.hands[0];
    expect(hand.handNumber).toBe(1);

    // VRF commitment must be present (64-char hex SHA-256)
    expect(hand.vrfCommit).toMatch(/^[0-9a-f]{64}$/i);

    // VRF seed must be revealed after hand completion
    expect(hand.vrfSeed).toMatch(/^[0-9a-f]{64}$/i);

    // Integrity check: SHA-256(seed) === commit
    const derivedCommit = crypto.createHash('sha256').update(hand.vrfSeed, 'hex').digest('hex');
    expect(derivedCommit).toBe(hand.vrfCommit);
  });

  // ------------------------------------------------------------------
  // Snapshot endpoint
  // ------------------------------------------------------------------

  test('GET /arenas/:id/snapshot returns final game state', async ({ request }) => {
    const res = await request.get(`/arenas/${arenaId}/snapshot`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    // arenaStatus may be 'finished'; snapshot may be null after TTL but non-null immediately after
    expect(['finished', 'running']).toContain(body.arenaStatus);
  });
});
