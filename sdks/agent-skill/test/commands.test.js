/**
 * TDD tests for new subcommands: access refresh and smoke full
 *
 * Run with: node --test ./test/commands.test.js
 */
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');
const { Server: IOServer } = require('socket.io');

const CLI_PATH = path.join(__dirname, '../bin/agon.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a temp state dir with a pre-built session file */
function makeTempStateWithSession(sessionOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
  const session = {
    access_token: 'tok-old',
    refresh_token: 'ref-old',
    expires_at: Date.now() + 999999,
    user: { id: 'u1' },
    agent: { id: 'ag1', agentAddress: '0xabc' },
    role: 'primary',
    updated_at: Date.now(),
    ...sessionOverrides,
  };
  fs.writeFileSync(path.join(dir, 'primary-session.json'), JSON.stringify(session));
  return { dir, session };
}

/** Create a deterministic test wallet file inside the given state dir */
function makeTestWallet(dir) {
  const wallet = {
    address: '0x1234567890123456789012345678901234567890',
    private_key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    created_at: Date.now(),
    role: 'primary',
    source: 'created',
  };
  fs.writeFileSync(path.join(dir, 'primary-wallet.json'), JSON.stringify(wallet));
  return wallet;
}

async function spawnCliJson(args, { timeoutMs = 30_000 } = {}) {
  const { stdout, stderr, exitCode } = await new Promise((resolve) => {
    const proc = spawn(process.execPath, [CLI_PATH, ...args]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr, exitCode: 1 });
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });

  const jsonLines = stdout.split('\n')
    .map((line) => {
      try {
        return JSON.parse(line.trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return { stdout, stderr, exitCode, jsonLines };
}

async function createStrictSmokeServer() {
  const calls = [];
  let subscribeCount = 0;

  const httpServer = http.createServer((req, res) => {
    const call = { method: req.method, url: req.url };
    calls.push(call);

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      call.body = parsed;

      const url = req.url.split('?')[0];
      const method = req.method;
      const json = (statusCode, data) => {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      if (method === 'GET' && url === '/health') {
        return json(200, { status: 'ok' });
      }

      if (method === 'POST' && url === '/auth/agent/access') {
        return json(200, {
          accessToken: 'tok-strict',
          refreshToken: 'ref-strict',
          expiresAt: Date.now() + 3_600_000,
          created: true,
          user: { id: 'u1' },
          agent: { id: 'ag1', agentAddress: '0xdeadbeef' },
        });
      }

      if (method === 'GET' && url === '/arenas') {
        return json(200, {
          arenas: [],
          meta: { total: 0, page: 1, pageSize: 25 },
        });
      }

      if (method === 'POST' && url === '/arenas') {
        if (typeof parsed.name !== 'string' || parsed.name.length < 3 || parsed.name.length > 100) {
          return json(400, { error: 'name must be between 3 and 100 characters' });
        }

        return json(201, {
          id: 'arena-strict-1',
          name: parsed.name,
          status: 'waiting',
          mode: parsed.mode || 'practice',
          spectate_url: 'http://localhost:3000/markets/arena-strict-1',
        });
      }

      if (method === 'POST' && url === '/arenas/arena-strict-1/join') {
        return json(200, {
          seatIndex: 0,
          status: 'waiting',
          spectate_url: 'http://localhost:3000/markets/arena-strict-1',
          player_spectate_url: 'http://localhost:3000/markets/arena-strict-1?agent=ag1',
        });
      }

      if (method === 'GET' && url === '/arenas/arena-strict-1/runtime') {
        return json(200, {
          lastProcessedTurnId: null,
          snapshot: {
            pendingTurn: null,
            hand: ['Ah', 'Kd'],
            communityCards: [],
            pot: 0,
            toCall: 0,
            stack: 1000,
            position: 'BTN',
            players: [],
          },
        });
      }

      if (method === 'POST' && url === '/arenas/arena-strict-1/actions') {
        return json(200, { turnId: parsed.turnId || null, accepted: true });
      }

      return json(404, { error: `Not found: ${method} ${url}` });
    });
  });

  const io = new IOServer(httpServer, { cors: { origin: '*' } });
  io.on('connection', (socket) => {
    socket.on('agent:subscribe', ({ agentId, arenaId }) => {
      subscribeCount += 1;
      if (subscribeCount === 1) {
        socket.emit('agent:runtime_snapshot', {
          arenaId,
          agentId,
          snapshot: {
            hand: ['Ah', 'Kd'],
            communityCards: [],
            pot: 0,
            toCall: 0,
            stack: 1000,
            position: 'BTN',
            players: [],
          },
        });
      }
    });
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close() {
      return new Promise((resolve) => {
        io.close(() => httpServer.close(resolve));
      });
    },
  };
}

// Attempt to load a mock server if the parallel agent has created it
let createMockServer;
try {
  createMockServer = require('./mock-server').createMockServer;
} catch {
  createMockServer = null;
}

// ─── --help tests (always run, no server needed) ─────────────────────────────

test('access refresh --help shows usage', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, 'access', 'refresh', '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /refresh/, 'stdout should mention "refresh"');
});

test('access refresh --help does not require wallet-policy', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, 'access', 'refresh', '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  // refresh operates on the session, not the wallet — wallet-policy not needed
  assert.doesNotMatch(result.stdout, /wallet-policy/);
});

test('smoke full --help shows usage', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, 'smoke', 'full', '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /full/, 'stdout should mention "full"');
});

test('smoke full --help lists --wallet-policy as an option', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, 'smoke', 'full', '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /wallet-policy/, 'stdout should mention "--wallet-policy"');
});

test('smoke full --help lists protocol steps', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, 'smoke', 'full', '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  // Should describe the chain of steps
  assert.match(result.stdout, /health/, 'should list health step');
  assert.match(result.stdout, /access|bootstrap/, 'should list access step');
});

// ─── Error-path tests (no server, just local state validation) ────────────────

test('access refresh fails when session has no refresh token', () => {
  const { dir } = makeTempStateWithSession({ refresh_token: null });
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, 'access', 'refresh', '--state-dir', dir],
    { encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0, 'should exit non-zero when refresh token is missing');
  assert.match(result.stderr, /refresh token|bootstrap/i);
});

test('access refresh fails when session file does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-empty-'));
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, 'access', 'refresh', '--state-dir', dir],
    { encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0, 'should exit non-zero when session is absent');
});

test('smoke full fails when --wallet-policy is not supplied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-nopolicy-'));
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, 'smoke', 'full', '--state-dir', dir, '--api-base', 'http://localhost:19999'],
    { encoding: 'utf8' },
  );

  // Should fail (non-zero exit) with a message about wallet-policy
  assert.notEqual(result.status, 0, 'should exit non-zero when --wallet-policy missing');
  assert.match(result.stderr, /wallet-policy/i);
});

// ─── Behavioral tests (require mock server) ───────────────────────────────────

if (createMockServer) {
  test('access refresh updates access_token and preserves agent.id', async () => {
    const server = await createMockServer();
    try {
      const { dir } = makeTempStateWithSession();

      // Use spawn (async) so the mock server's event loop can respond
      const { stdout, stderr, exitCode } = await new Promise((resolve) => {
        const proc = spawn(process.execPath, [
          CLI_PATH, 'access', 'refresh',
          '--api-base', server.url,
          '--state-dir', dir,
        ]);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });
        const timer = setTimeout(() => { proc.kill(); resolve({ stdout, stderr, exitCode: 1 }); }, 10_000);
        proc.on('exit', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code }); });
      });

      assert.equal(exitCode, 0, `stderr: ${stderr}`);
      assert.match(stdout, /session_refreshed/);

      // Verify the session file was updated and agent preserved
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'primary-session.json'), 'utf8'));
      assert.ok(saved.access_token !== 'tok-old', 'access_token should be updated from tok-old');
      assert.equal(saved.agent.id, 'ag1', 'agent.id should be preserved from original session');
    } finally {
      await server.close();
    }
  });

  test('smoke full reports PASS for health step', async () => {
    const server = await createMockServer();
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-smoke-'));
      makeTestWallet(dir);

      // Use spawn (async) so the mock server's event loop can respond
      const { stdout, exitCode } = await new Promise((resolve) => {
        const proc = spawn(process.execPath, [
          CLI_PATH, 'smoke', 'full',
          '--wallet-policy', 'require-existing',
          '--api-base', server.url,
          '--state-dir', dir,
        ]);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });
        const timer = setTimeout(() => { proc.kill(); resolve({ stdout, stderr, exitCode: 1 }); }, 30_000);
        proc.on('exit', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code }); });
      });

      // Parse JSON lines from stdout
      const jsonLines = stdout.split('\n')
        .map((l) => { try { return JSON.parse(l.trim()); } catch { return null; } })
        .filter(Boolean);

      const healthStep = jsonLines.find((j) => j.step === 1 || j.name === 'health');
      assert.ok(healthStep, `Should have a health step result. stdout: ${stdout}`);
      assert.equal(healthStep.status, 'PASS', `Health step should PASS, got: ${JSON.stringify(healthStep)}`);
    } finally {
      await server.close();
    }
  });

  test('smoke full accepts paginated arena lists and sends a valid arena name', async () => {
    const server = await createStrictSmokeServer();
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-smoke-strict-'));
      makeTestWallet(dir);

      const { stderr, exitCode, jsonLines } = await spawnCliJson([
        'smoke', 'full',
        '--wallet-policy', 'require-existing',
        '--api-base', server.url,
        '--state-dir', dir,
      ]);

      assert.equal(exitCode, 0, `stderr: ${stderr}`);

      const arenaListStep = jsonLines.find((line) => line.step === 4);
      const arenaCreateStep = jsonLines.find((line) => line.step === 5);
      const summary = jsonLines.at(-1);
      const createCall = server.calls.find((call) => call.method === 'POST' && call.url === '/arenas');

      assert.ok(arenaListStep, 'expected a step 4 result');
      assert.equal(arenaListStep.status, 'PASS', `arena-list should PASS: ${JSON.stringify(arenaListStep)}`);
      assert.ok(arenaCreateStep, 'expected a step 5 result');
      assert.equal(arenaCreateStep.status, 'PASS', `arena-create should PASS: ${JSON.stringify(arenaCreateStep)}`);
      assert.ok(summary, 'expected a summary line');
      assert.equal(summary.ok, true, `expected smoke full to succeed: ${JSON.stringify(summary)}`);
      assert.ok(createCall, 'expected POST /arenas call');
      assert.equal(typeof createCall.body.name, 'string', 'arena create payload should include name');
      assert.ok(createCall.body.name.length >= 3 && createCall.body.name.length <= 100,
        `arena create name should satisfy API length requirement: ${JSON.stringify(createCall.body)}`);
      assert.equal(createCall.body.mode, 'practice', 'smoke full should create a practice arena');
      assert.equal(createCall.body.maxPlayers, 2, 'smoke full should create a heads-up arena');
      assert.equal(createCall.body.allowSparringReplacement, true,
        'smoke full should enable hosted sparring replacement so live practice arenas can start');
    } finally {
      await server.close();
    }
  });

  test('smoke full turn step submits actions to the plural route', async () => {
    const server = await createMockServer();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-smoke-turn-'));
    const decisionScript = path.join(dir, 'decide.js');
    fs.writeFileSync(decisionScript, `
      process.stdin.resume();
      process.stdout.write(JSON.stringify({ action: 'fold', amount: 0 }) + '\\n');
    `);

    try {
      makeTestWallet(dir);

      const resultPromise = spawnCliJson([
        'smoke', 'full',
        '--wallet-policy', 'require-existing',
        '--api-base', server.url,
        '--state-dir', dir,
        '--decision-cmd', `node ${decisionScript}`,
      ], { timeoutMs: 40_000 });

      setTimeout(() => {
        server.emitTurnRequest('arena-1', 'turn-1');
      }, 3_000);

      const { stderr, exitCode, jsonLines } = await resultPromise;
      assert.equal(exitCode, 0, `stderr: ${stderr}`);

      const turnStep = jsonLines.find((line) => line.step === 9);
      const summary = jsonLines.at(-1);

      assert.ok(turnStep, `expected a step 9 result: ${JSON.stringify(jsonLines)}`);
      assert.equal(turnStep.status, 'PASS', `turn step should PASS: ${JSON.stringify(turnStep)}`);
      const actionCall = server.calls.find((call) => call.method === 'POST' && /\/arenas\/[^/]+\/actions$/.test(call.url));
      assert.ok(actionCall, 'expected POST /arenas/:id/actions call');
      assert.equal(actionCall.body.turnId, 'turn-1',
        'smoke full should submit the platform turn id even when the decision omits turnId');
      assert.equal(actionCall.body.amount, undefined,
        'smoke full should omit non-positive amounts for non-raise actions');
      assert.ok(!server.calls.some((call) => call.method === 'POST' && /\/arenas\/[^/]+\/action$/.test(call.url)),
        'should not call deprecated singular /action route');
      assert.ok(summary, 'expected a summary line');
      assert.equal(summary.ok, true, `expected smoke full to succeed: ${JSON.stringify(summary)}`);
    } finally {
      await server.close();
    }
  });

  test('smoke full turn step reuses pending turns from runtime snapshots', async () => {
    const pendingTurn = {
      arenaId: 'arena-1',
      turnId: 'turn-snapshot-1',
      handId: 'hand-1',
      handNumber: 1,
      agentId: 'ag1',
      validActions: ['fold', 'call'],
      deadlineMs: Date.now() + 30_000,
      callAmount: 50,
      minRaise: 100,
      maxRaise: 1000,
      state: {
        hand: ['Ah', 'Kd'],
        communityCards: [],
        pot: 150,
        toCall: 50,
        stack: 950,
        position: 'BTN',
        players: [],
      },
      submitPath: '/arenas/arena-1/actions',
    };
    const server = await createMockServer({ overrides: { runtimeSnapshotPendingTurn: pendingTurn } });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-smoke-pending-turn-'));
    const decisionScript = path.join(dir, 'decide.js');
    fs.writeFileSync(decisionScript, `
      process.stdin.resume();
      process.stdout.write(JSON.stringify({ action: 'fold' }) + '\\n');
    `);

    try {
      makeTestWallet(dir);

      const { stderr, exitCode, jsonLines } = await spawnCliJson([
        'smoke', 'full',
        '--wallet-policy', 'require-existing',
        '--api-base', server.url,
        '--state-dir', dir,
        '--decision-cmd', `node ${decisionScript}`,
      ], { timeoutMs: 40_000 });

      assert.equal(exitCode, 0, `stderr: ${stderr}`);

      const turnStep = jsonLines.find((line) => line.step === 9);
      const actionCall = server.calls.find((call) => call.method === 'POST' && /\/arenas\/[^/]+\/actions$/.test(call.url));

      assert.ok(turnStep, `expected a step 9 result: ${JSON.stringify(jsonLines)}`);
      assert.equal(turnStep.status, 'PASS', `turn step should PASS: ${JSON.stringify(turnStep)}`);
      assert.ok(actionCall, 'expected action submission from the snapshot pending turn');
      assert.equal(actionCall.body.turnId, 'turn-snapshot-1');
    } finally {
      await server.close();
    }
  });
} else {
  test('access refresh behavioral test (skipped — mock-server not available)', (t) => {
    t.skip('mock-server.js not available');
  });

  test('smoke full behavioral test (skipped — mock-server not available)', (t) => {
    t.skip('mock-server.js not available');
  });
}
