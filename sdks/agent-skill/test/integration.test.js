'use strict';
/**
 * Integration tests for sdks/agent-skill lib functions.
 *
 * Each test spins up the in-process mock server on a random port, exercises
 * the lib layer directly (not via the CLI), then tears down the server.
 *
 * Run individually:
 *   node --test test/integration.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { createMockServer } = require('./mock-server');
const { requestJson } = require('../lib/api');
const { buildAgentAccessHeaders } = require('../lib/access');
const { persistSession, getSessionForRole } = require('../lib/session');
const { connectRuntimeSocket } = require('../lib/socket');
const { createWallet } = require('../lib/wallet');
const { updateRunState, loadRunState } = require('../lib/state');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agon-integ-'));
}

/**
 * Perform the full bootstrap sequence against the mock server:
 *   createWallet → POST /auth/agent/access → persistSession
 * Returns { stateDir, session, apiBase }
 */
async function bootstrapAgent(serverUrl, stateDir) {
  const dir = stateDir || makeTmpDir();

  // 1. Create a local wallet (no network)
  const { record } = createWallet(dir, 'primary');
  assert.ok(record.address, 'wallet should have an address');

  // 2. Auth: build signed headers and POST /auth/agent/access
  const { Wallet } = require('ethers');
  const wallet = new Wallet(record.private_key);

  const body = { agentCard: { name: 'Test Agent', capabilities: ['texas_holdem'] } };
  const accessHeaders = await buildAgentAccessHeaders({
    baseUrl: serverUrl,
    wallet,
    body,
  });

  const authResponse = await requestJson({
    baseUrl: serverUrl,
    method: 'POST',
    routePath: '/auth/agent/access',
    body,
    headers: accessHeaders,
  });

  assert.ok(authResponse.accessToken, 'auth response should include accessToken');
  assert.ok(authResponse.agent && authResponse.agent.id, 'auth response should include agent.id');

  // 3. Persist the session to disk
  const session = persistSession(dir, 'primary', authResponse);
  assert.equal(session.access_token, authResponse.accessToken);

  return { stateDir: dir, session, apiBase: serverUrl };
}

// ─── Test 1: Full onboarding flow — wallet → auth → arena list → join → runtime get ──

test('onboarding flow: wallet create → auth → arena join → runtime get', async () => {
  const server = await createMockServer({
    overrides: {
      arenaList: [
        {
          id: 'arena-1',
          name: 'Test Arena',
          status: 'waiting',
          mode: 'practice',
          allowSparringReplacement: true,
          playerCount: 0,
          maxPlayers: 2,
        },
      ],
    },
  });

  try {
    const { stateDir, session } = await bootstrapAgent(server.url);

    // Arena list
    const listResult = await requestJson({
      baseUrl: server.url,
      method: 'GET',
      routePath: '/arenas?status=waiting&mode=practice',
      token: session.access_token,
    });
    assert.ok(Array.isArray(listResult.arenas), 'arenas should be an array');
    assert.equal(listResult.arenas[0].id, 'arena-1');

    // Arena join
    const joinResult = await requestJson({
      baseUrl: server.url,
      method: 'POST',
      routePath: '/arenas/arena-1/join',
      token: session.access_token,
      body: { agentId: session.agent.id },
    });
    assert.ok(joinResult.status === 'waiting' || joinResult.seatIndex !== undefined,
      'join should return seat info');
    assert.equal(joinResult.spectate_url, 'http://localhost:3000/markets/arena-1');
    assert.equal(joinResult.player_spectate_url, `http://localhost:3000/markets/arena-1?agent=${session.agent.id}`);

    updateRunState(stateDir, { arena_id: 'arena-1' });

    // Runtime get
    const runtimeResult = await requestJson({
      baseUrl: server.url,
      method: 'GET',
      routePath: `/arenas/arena-1/runtime?agentId=${encodeURIComponent(session.agent.id)}`,
      token: session.access_token,
    });
    assert.ok('snapshot' in runtimeResult, 'runtime result should include snapshot');
    assert.equal(runtimeResult.lastProcessedTurnId, null);

    // Verify run-state was persisted
    const runState = loadRunState(stateDir);
    assert.equal(runState.arena_id, 'arena-1');
  } finally {
    await server.close();
  }
});

// ─── Test 2: Socket subscription receives agent:turn_request event ─────────────

test('socket subscription receives agent:turn_request emitted by mock server', async () => {
  const server = await createMockServer();

  try {
    const { session } = await bootstrapAgent(server.url);
    const received = [];

    // Start the socket listener; use once:'agent:turn_request' to auto-disconnect
    const listenPromise = connectRuntimeSocket({
      apiBase: server.url,
      token: session.access_token,
      agentId: session.agent.id,
      arenaId: 'arena-1',
      once: 'agent:turn_request',
      timeoutMs: 10000,
      onEvent(event) {
        received.push(event);
      },
    });

    // Wait for the socket to connect (snapshot arrives first), then emit turn
    await new Promise((resolve) => setTimeout(resolve, 300));
    server.emitTurnRequest('arena-1', 'turn-test-1');

    await listenPromise;

    const turnEvent = received.find((e) => e.type === 'agent:turn_request');
    assert.ok(turnEvent, 'should have received agent:turn_request');
    assert.equal(turnEvent.payload.arenaId, 'arena-1');
    assert.equal(turnEvent.payload.turnId, 'turn-test-1');
    assert.ok(typeof turnEvent.receivedAt === 'number', 'receivedAt should be a number');
  } finally {
    await server.close();
  }
});

// ─── Test 3: Auth token is preserved across session reload ────────────────────

test('session persisted to disk is correctly reloaded via getSessionForRole', async () => {
  const server = await createMockServer();

  try {
    const stateDir = makeTmpDir();
    const { session: savedSession } = await bootstrapAgent(server.url, stateDir);

    // Reload the session from disk (simulates a new process reading state)
    const { session: loadedSession } = getSessionForRole(stateDir, 'primary');

    assert.equal(loadedSession.access_token, savedSession.access_token,
      'reloaded access_token should match saved value');
    assert.equal(loadedSession.agent.id, savedSession.agent.id,
      'reloaded agent.id should match');
    assert.ok(loadedSession.updated_at > 0, 'updated_at should be set');
  } finally {
    await server.close();
  }
});

// ─── Test 4: Socket receives runtime_snapshot immediately on subscribe ─────────

test('socket emits agent:runtime_snapshot immediately after agent:subscribe', async () => {
  const server = await createMockServer();

  try {
    const { session } = await bootstrapAgent(server.url);
    const received = [];

    await connectRuntimeSocket({
      apiBase: server.url,
      token: session.access_token,
      agentId: session.agent.id,
      arenaId: 'arena-1',
      once: 'agent:runtime_snapshot',
      timeoutMs: 5000,
      onEvent(event) {
        received.push(event);
      },
    });

    const snapshot = received.find((e) => e.type === 'agent:runtime_snapshot');
    assert.ok(snapshot, 'should have received agent:runtime_snapshot');
    assert.ok(snapshot.payload && snapshot.payload.snapshot, 'snapshot payload should be present');
  } finally {
    await server.close();
  }
});

// ─── Test 5: Mock server request tracking records all HTTP calls ───────────────

test('mock server call log records wallet auth and arena join requests', async () => {
  const server = await createMockServer();

  try {
    const { session } = await bootstrapAgent(server.url);

    await requestJson({
      baseUrl: server.url,
      method: 'POST',
      routePath: '/arenas/arena-42/join',
      token: session.access_token,
      body: { agentId: session.agent.id },
    });

    const authCalls = server.calls.filter((c) => c.method === 'POST' && c.url === '/auth/agent/access');
    const joinCalls = server.calls.filter((c) => c.method === 'POST' && c.url.includes('/arenas/arena-42/join'));

    assert.equal(authCalls.length, 1, 'should have exactly one POST /auth/agent/access call');
    assert.equal(joinCalls.length, 1, 'should have exactly one POST /arenas/arena-42/join call');
  } finally {
    await server.close();
  }
});
