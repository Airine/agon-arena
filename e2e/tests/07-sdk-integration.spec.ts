/**
 * AGO-89: SDK Integration Tests — Python, OpenClaw, ElizaOS agents complete a full game.
 *
 * Strategy:
 *   Each "SDK agent" is simulated by a lightweight inline Node.js HTTP server that:
 *   - Receives POST /action (camelCase AAP webhook from orchestrator)
 *   - Responds with a valid poker action from validActions
 *
 *   Three server personalities mirror the three SDK strategies:
 *   - pythonAgent  → call-first (like SimplePokerAgent in Python SDK)
 *   - openclawAgent → raise-first (like suggestAction in OpenClaw SDK)
 *   - elizaosAgent  → check-first (like ElizaOS makeDecision)
 *
 * Full flow:
 *   1. Start 3 inline webhook servers on random ports
 *   2. Register 1 owner user + 3 agents pointing to those servers
 *   3. Create a practice arena (maxHands: 3)
 *   4. Seat all 3 agents
 *   5. Start the game
 *   6. Poll until arena.status === 'finished'
 *   7. Verify chip conservation (3 × startingStack)
 *   8. Verify all agents played hands
 *   9. Verify VRF commit-reveal integrity
 */

import { test, expect } from '@playwright/test';
import http from 'http';
import net from 'net';
import { registerUser, createAgent, generateEd25519KeyPair } from './helpers.js';

// ---------------------------------------------------------------------------
// Inline webhook server utilities
// ---------------------------------------------------------------------------

type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in';

interface AAPActionRequest {
  gameId: string;
  handId: string;
  agentId: string;
  validActions: ActionType[];
  state: Record<string, unknown>;
  timeoutMs: number;
}

interface AAPActionResponse {
  action: ActionType;
  amount?: number;
}

/** Strategy function: given valid actions, pick one. */
type Strategy = (validActions: ActionType[]) => AAPActionResponse;

/** Get a random available OS port. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

/** Start a minimal AAP webhook server on the given port. Returns the server + URL. */
function startWebhookServer(port: number, strategy: Strategy): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/action') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const request: AAPActionRequest = JSON.parse(body);
          const response = strategy(request.validActions ?? ['fold']);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch {
          // Fallback: fold on parse error
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ action: 'fold' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, '127.0.0.1');
  return server;
}

// ---------------------------------------------------------------------------
// SDK-style strategies
// ---------------------------------------------------------------------------

/**
 * Python SDK strategy: SimplePokerAgent — call if possible, else fold.
 * Mirrors: `if Action.CALL in valid_actions: return call; else: return fold`
 */
const pythonStrategy: Strategy = (validActions) => {
  if (validActions.includes('call')) return { action: 'call' };
  if (validActions.includes('check')) return { action: 'check' };
  return { action: 'fold' };
};

/**
 * OpenClaw SDK strategy: suggestAction heuristic — raise first (strong hand),
 * fall back to call, then check, then fold.
 * Mirrors `suggestAction()` with strength > 0.8.
 */
const openclawStrategy: Strategy = (validActions) => {
  if (validActions.includes('raise')) return { action: 'raise' };
  if (validActions.includes('call')) return { action: 'call' };
  if (validActions.includes('check')) return { action: 'check' };
  return { action: 'fold' };
};

/**
 * ElizaOS SDK strategy: makeDecision — check first (passive), then call, then fold.
 * Mirrors the conservative ElizaOS agent that avoids raises.
 */
const elizaosStrategy: Strategy = (validActions) => {
  if (validActions.includes('check')) return { action: 'check' };
  if (validActions.includes('call')) return { action: 'call' };
  return { action: 'fold' };
};

// ---------------------------------------------------------------------------
// Poll helper
// ---------------------------------------------------------------------------

async function pollUntil(
  predicate: () => Promise<boolean>,
  { intervalMs = 400, timeoutMs = 25_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('SDK Integration — Python + OpenClaw + ElizaOS agents complete a full game', () => {
  const STARTING_STACK = 1000;
  const MAX_HANDS = 3;

  // Shared state
  let token: string;
  let pythonAgentId: string;
  let openclawAgentId: string;
  let elizaosAgentId: string;
  let arenaId: string;

  // Inline webhook servers
  let pythonServer: http.Server;
  let openclawServer: http.Server;
  let elizaosServer: http.Server;

  let pythonWebhookUrl: string;
  let openclawWebhookUrl: string;
  let elizaosWebhookUrl: string;

  // ------------------------------------------------------------------
  // Setup: start inline servers + register agents
  // ------------------------------------------------------------------

  test.beforeAll(async ({ request }) => {
    // Find 3 free ports
    const [pythonPort, openclawPort, elizaosPort] = await Promise.all([
      getFreePort(),
      getFreePort(),
      getFreePort(),
    ]);

    pythonWebhookUrl = `http://127.0.0.1:${pythonPort}`;
    openclawWebhookUrl = `http://127.0.0.1:${openclawPort}`;
    elizaosWebhookUrl = `http://127.0.0.1:${elizaosPort}`;

    // Start webhook servers
    pythonServer = startWebhookServer(pythonPort, pythonStrategy);
    openclawServer = startWebhookServer(openclawPort, openclawStrategy);
    elizaosServer = startWebhookServer(elizaosPort, elizaosStrategy);

    // Register owner user
    const { token: t } = await registerUser(request);
    token = t;

    // Register 3 agents, one per SDK type
    const { publicKeyHex: pythonKey } = generateEd25519KeyPair();
    const { publicKeyHex: openclawKey } = generateEd25519KeyPair();
    const { publicKeyHex: elizaosKey } = generateEd25519KeyPair();

    const [pResult, oResult, eResult] = await Promise.all([
      createAgent(request, token, {
        name: 'Python-SDK-Agent',
        apiUrl: `${pythonWebhookUrl}/action`,
        webhookPublicKey: pythonKey,
        description: 'Python SDK call-first agent',
      }),
      createAgent(request, token, {
        name: 'OpenClaw-SDK-Agent',
        apiUrl: `${openclawWebhookUrl}/action`,
        webhookPublicKey: openclawKey,
        description: 'OpenClaw SDK raise-first agent',
      }),
      createAgent(request, token, {
        name: 'ElizaOS-SDK-Agent',
        apiUrl: `${elizaosWebhookUrl}/action`,
        webhookPublicKey: elizaosKey,
        description: 'ElizaOS SDK check-first agent',
      }),
    ]);

    expect(pResult.statusCode, 'Python agent registration failed').toBe(201);
    expect(oResult.statusCode, 'OpenClaw agent registration failed').toBe(201);
    expect(eResult.statusCode, 'ElizaOS agent registration failed').toBe(201);

    pythonAgentId = pResult.agent.id;
    openclawAgentId = oResult.agent.id;
    elizaosAgentId = eResult.agent.id;
  });

  test.afterAll(async () => {
    await Promise.all([
      new Promise<void>((r) => pythonServer?.close(() => r())),
      new Promise<void>((r) => openclawServer?.close(() => r())),
      new Promise<void>((r) => elizaosServer?.close(() => r())),
    ]);
  });

  // ------------------------------------------------------------------
  // 1. Webhook server health — each SDK server is reachable
  // ------------------------------------------------------------------

  test('Python SDK webhook server is healthy', async () => {
    const res = await fetch(`${pythonWebhookUrl}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  test('OpenClaw SDK webhook server is healthy', async () => {
    const res = await fetch(`${openclawWebhookUrl}/health`);
    expect(res.ok).toBe(true);
  });

  test('ElizaOS SDK webhook server is healthy', async () => {
    const res = await fetch(`${elizaosWebhookUrl}/health`);
    expect(res.ok).toBe(true);
  });

  // ------------------------------------------------------------------
  // 2. Strategy verification — each SDK responds correctly to actions
  // ------------------------------------------------------------------

  test('Python agent returns call when available', async () => {
    const payload = {
      gameId: 'test-game', handId: 'test-hand', agentId: pythonAgentId,
      validActions: ['fold', 'call', 'raise'],
      state: {}, timeoutMs: 5000,
    };
    const res = await fetch(`${pythonWebhookUrl}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json() as AAPActionResponse;
    expect(body.action).toBe('call');
  });

  test('OpenClaw agent returns raise when available', async () => {
    const payload = {
      gameId: 'test-game', handId: 'test-hand', agentId: openclawAgentId,
      validActions: ['fold', 'call', 'raise'],
      state: {}, timeoutMs: 5000,
    };
    const res = await fetch(`${openclawWebhookUrl}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json() as AAPActionResponse;
    expect(body.action).toBe('raise');
  });

  test('ElizaOS agent returns check when available', async () => {
    const payload = {
      gameId: 'test-game', handId: 'test-hand', agentId: elizaosAgentId,
      validActions: ['check', 'raise'],
      state: {}, timeoutMs: 5000,
    };
    const res = await fetch(`${elizaosWebhookUrl}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json() as AAPActionResponse;
    expect(body.action).toBe('check');
  });

  test('All SDK agents fall back to fold when only fold is valid', async () => {
    const payload = {
      gameId: 'test-game', handId: 'test-hand', agentId: 'agent-x',
      validActions: ['fold'],
      state: {}, timeoutMs: 5000,
    };

    const [pRes, oRes, eRes] = await Promise.all([
      fetch(`${pythonWebhookUrl}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      fetch(`${openclawWebhookUrl}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      fetch(`${elizaosWebhookUrl}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    ]);

    const [p, o, e] = await Promise.all([
      pRes.json() as Promise<AAPActionResponse>,
      oRes.json() as Promise<AAPActionResponse>,
      eRes.json() as Promise<AAPActionResponse>,
    ]);

    expect(p.action).toBe('fold');
    expect(o.action).toBe('fold');
    expect(e.action).toBe('fold');
  });

  // ------------------------------------------------------------------
  // 3. Full game lifecycle — 3 SDK agents play a complete arena
  // ------------------------------------------------------------------

  test('POST /arenas creates a 3-player, 3-hand practice arena', async ({ request }) => {
    const res = await request.post('/arenas', {
      data: {
        name: 'SDK Integration Arena',
        mode: 'practice',
        maxPlayers: 3,
        smallBlind: 10,
        bigBlind: 20,
        startingStack: STARTING_STACK,
        maxHands: MAX_HANDS,
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.status).toBe('waiting');
    expect(body.maxPlayers).toBe(3);
    expect(body.maxHands).toBe(MAX_HANDS);
    arenaId = body.id;
  });

  test('All 3 SDK agents are seated successfully', async ({ request }) => {
    const results = await Promise.all([
      request.post(`/arenas/${arenaId}/join`, {
        data: { agentId: pythonAgentId },
        headers: { Authorization: `Bearer ${token}` },
      }),
      request.post(`/arenas/${arenaId}/join`, {
        data: { agentId: openclawAgentId },
        headers: { Authorization: `Bearer ${token}` },
      }),
      request.post(`/arenas/${arenaId}/join`, {
        data: { agentId: elizaosAgentId },
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    for (const r of results) {
      expect(r.status()).toBe(201);
      const body = await r.json();
      expect(body.currentStack).toBe(STARTING_STACK);
    }

    // Verify seats in arena
    const arenaRes = await request.get(`/arenas/${arenaId}`);
    const arena = await arenaRes.json();
    expect(arena.seats).toHaveLength(3);
  });

  test('POST /arenas/:id/start transitions arena to running', async ({ request }) => {
    const res = await request.post(`/arenas/${arenaId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.message).toBe('Game started');
    expect(body.playerCount).toBe(3);

    // Arena must be running
    const arenaRes = await request.get(`/arenas/${arenaId}`);
    const arena = await arenaRes.json();
    expect(arena.status).toBe('running');
  });

  test('Arena finishes after all hands complete (SDK agents respond to webhooks)', async ({ request }) => {
    const finished = await pollUntil(
      async () => {
        const res = await request.get(`/arenas/${arenaId}`);
        const body = await res.json();
        return body.status === 'finished';
      },
      { intervalMs: 400, timeoutMs: 30_000 },
    );

    expect(finished, 'Arena did not finish within 30s — SDK webhook servers may not be reachable').toBe(true);
  });

  // ------------------------------------------------------------------
  // 4. Post-game assertions
  // ------------------------------------------------------------------

  test('Chip conservation: total chips equal 3 × startingStack', async ({ request }) => {
    const res = await request.get(`/arenas/${arenaId}`);
    const arena = await res.json();

    expect(arena.status).toBe('finished');
    const seats: Array<{ currentStack: number; agentId: string }> = arena.seats;
    expect(seats).toHaveLength(3);

    const total = seats.reduce((sum, s) => sum + s.currentStack, 0);
    expect(total).toBe(3 * STARTING_STACK); // No rake in practice mode
  });

  test('All 3 agents participated (handsPlayed ≥ 1)', async ({ request }) => {
    const [pRes, oRes, eRes] = await Promise.all([
      request.get(`/agents/${pythonAgentId}`),
      request.get(`/agents/${openclawAgentId}`),
      request.get(`/agents/${elizaosAgentId}`),
    ]);

    const [python, openclaw, elizaos] = await Promise.all([
      pRes.json(),
      oRes.json(),
      eRes.json(),
    ]);

    expect(python.handsPlayed, 'Python agent did not play any hands').toBeGreaterThanOrEqual(1);
    expect(openclaw.handsPlayed, 'OpenClaw agent did not play any hands').toBeGreaterThanOrEqual(1);
    expect(elizaos.handsPlayed, 'ElizaOS agent did not play any hands').toBeGreaterThanOrEqual(1);
  });

  test('At least one agent changed chip count (chips moved between players)', async ({ request }) => {
    const res = await request.get(`/arenas/${arenaId}`);
    const arena = await res.json();
    const seats: Array<{ currentStack: number }> = arena.seats;

    const unchanged = seats.filter((s) => s.currentStack === STARTING_STACK);
    // At least one player won or lost chips
    expect(unchanged.length).toBeLessThan(3);
  });

  test('At least one agent won a hand', async ({ request }) => {
    const [pRes, oRes, eRes] = await Promise.all([
      request.get(`/agents/${pythonAgentId}`),
      request.get(`/agents/${openclawAgentId}`),
      request.get(`/agents/${elizaosAgentId}`),
    ]);

    const [python, openclaw, elizaos] = await Promise.all([
      pRes.json(),
      oRes.json(),
      eRes.json(),
    ]);

    const totalWins = (python.handsWon ?? 0) + (openclaw.handsWon ?? 0) + (elizaos.handsWon ?? 0);
    expect(totalWins).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // 5. VRF commit-reveal integrity
  // ------------------------------------------------------------------

  test('GET /arenas/:id/hands returns hands with valid VRF commit-reveal', async ({ request }) => {
    const { createHash } = await import('crypto');

    const res = await request.get(`/arenas/${arenaId}/hands`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.count).toBeLessThanOrEqual(MAX_HANDS);

    for (const hand of body.hands) {
      // VRF commit must be 64-char hex (SHA-256)
      expect(hand.vrfCommit).toMatch(/^[0-9a-f]{64}$/i);
      // VRF seed revealed after hand completion
      expect(hand.vrfSeed).toMatch(/^[0-9a-f]{64}$/i);
      // Integrity: SHA-256(seed) === commit
      const derived = createHash('sha256').update(hand.vrfSeed, 'hex').digest('hex');
      expect(derived).toBe(hand.vrfCommit);
    }
  });

  // ------------------------------------------------------------------
  // 6. Snapshot endpoint returns valid data
  // ------------------------------------------------------------------

  test('GET /arenas/:id/snapshot returns finished arena state', async ({ request }) => {
    const res = await request.get(`/arenas/${arenaId}/snapshot`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(['finished', 'running']).toContain(body.arenaStatus);
  });
});
