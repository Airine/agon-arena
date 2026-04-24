'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { createMockServer } = require('./mock-server');

const CLI_PATH = path.join(__dirname, '../bin/agon.js');
const NODE = process.execPath;

/** Collect stdout JSON lines from a spawned CLI process */
function collectJsonLines(proc, { maxLines, stopOnState, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const lines = [];
    let buffer = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Timed out waiting for state after ${timeoutMs}ms. Lines so far: ${JSON.stringify(lines)}`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const part of parts) {
        if (!part.trim()) continue;
        try {
          const parsed = JSON.parse(part);
          lines.push(parsed);
          if (stopOnState && parsed.state === stopOnState) {
            clearTimeout(timer);
            proc.kill('SIGTERM');
            resolve(lines);
            return;
          }
          if (maxLines && lines.length >= maxLines) {
            clearTimeout(timer);
            proc.kill('SIGTERM');
            resolve(lines);
            return;
          }
        } catch { /* ignore non-JSON */ }
      }
    });

    proc.on('exit', () => {
      clearTimeout(timer);
      resolve(lines);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition');
}

// Test 1: --help
test('protocol run --help shows usage', () => {
  const result = spawnSync(NODE, [CLI_PATH, 'protocol', 'run', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--wallet-policy/);
  assert.match(result.stdout, /--decision-cmd/);
  assert.match(result.stdout, /--width/);
  assert.match(result.stdout, /--plain/);
});

// Test 2: --help for resume
test('protocol resume --help shows usage', () => {
  const result = spawnSync(NODE, [CLI_PATH, 'protocol', 'resume', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--state-dir/);
  assert.match(result.stdout, /--width/);
  assert.match(result.stdout, /--plain/);
});

// Test 3: protocol run exits with error when no wallet and require-existing
test('protocol run exits non-zero when --wallet-policy=require-existing and no wallet', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
  try {
    const server = await createMockServer();
    try {
      const result = spawnSync(NODE, [
        CLI_PATH, 'protocol', 'run',
        '--wallet-policy=require-existing',
        `--api-base=${server.url}`,
        `--state-dir=${tmpDir}`,
      ], { encoding: 'utf8', timeout: 5000 });
      assert.notEqual(result.status, 0, 'should fail when no wallet');
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 4: TRACER BULLET — protocol run reaches state:competing (happy path)
test('protocol run reaches state:competing with create-if-missing and create-if-none', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
  try {
    const server = await createMockServer();
    try {
      const proc = spawn(NODE, [
        CLI_PATH, 'protocol', 'run',
        '--wallet-policy=create-if-missing',
        '--create-if-none',
        `--api-base=${server.url}`,
        `--state-dir=${tmpDir}`,
      ]);

      const lines = await collectJsonLines(proc, {
        stopOnState: 'competing',
        timeoutMs: 15000,
      });

      const states = lines.map((l) => l.state);
      assert.ok(states.includes('competing'), `Expected 'competing' state. Got: ${JSON.stringify(states)}`);

      // Verify the state machine progress
      const expected = ['wallet_resolved', 'session_ready', 'arena_joined', 'runtime_synced', 'competing'];
      for (const state of expected) {
        assert.ok(states.includes(state), `Missing expected state: ${state}. Got: ${JSON.stringify(states)}`);
      }
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agon +play --practice reaches state:competing with automatic wallet creation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
  try {
    const server = await createMockServer();
    try {
      const proc = spawn(NODE, [
        CLI_PATH, '+play',
        '--practice',
        `--api-base=${server.url}`,
        `--state-dir=${tmpDir}`,
      ]);

      const lines = await collectJsonLines(proc, {
        stopOnState: 'competing',
        timeoutMs: 15000,
      });

      const states = lines.map((line) => line.state);
      assert.ok(states.includes('wallet_resolved'), `Missing wallet_resolved state. Got: ${JSON.stringify(states)}`);
      assert.ok(states.includes('competing'), `Missing competing state. Got: ${JSON.stringify(states)}`);
      assert.ok(fs.existsSync(path.join(tmpDir, 'primary-wallet.json')), 'expected +play to create the primary wallet file');
      assert.ok(server.calls.some((call) => call.method === 'POST' && call.url === '/arenas'), 'expected +play to create a practice arena when none is joinable');
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 5: protocol run handles a turn_request via --decision-cmd
test('protocol run invokes --decision-cmd on turn_request and submits action', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));

  // Create a simple decision script that outputs fold
  const decisionScript = path.join(tmpDir, 'decide.js');
  fs.writeFileSync(decisionScript, `
    process.stdin.resume();
    process.stdout.write(JSON.stringify({ action: 'fold', amount: 0 }) + '\\n');
  `);

  try {
    const server = await createMockServer();
    try {
      const proc = spawn(NODE, [
        CLI_PATH, 'protocol', 'run',
        '--wallet-policy=create-if-missing',
        '--create-if-none',
        `--api-base=${server.url}`,
        `--state-dir=${tmpDir}`,
        `--decision-cmd=node ${decisionScript}`,
      ]);

      // Wait for competing state, then emit a turn request
      const linesPromise = collectJsonLines(proc, {
        stopOnState: 'action_submitted',
        timeoutMs: 20000,
      });

      // Give it time to reach competing state, then emit turn
      await new Promise((r) => setTimeout(r, 3000));
      server.emitTurnRequest('arena-1', 'turn-xyz');

      const lines = await linesPromise;
      const states = lines.map((l) => l.state);
      assert.ok(
        states.includes('action_submitted') || server.calls.some((c) => c.method === 'POST' && c.url.includes('/actions')),
        `Expected action_submitted or POST /actions call. States: ${JSON.stringify(states)}`,
      );
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('protocol run uploads thinkingText after hand:end when sequenceNumber is observed', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
  const decisionScript = path.join(tmpDir, 'decide-thinking.js');
  fs.writeFileSync(decisionScript, `
    process.stdin.resume();
    process.stdout.write(JSON.stringify({
      action: 'fold',
      amount: 0,
      thinkingText: 'Pot odds are poor, so folding preserves stack.'
    }) + '\\n');
  `);

  try {
    const server = await createMockServer();
    try {
      const proc = spawn(NODE, [
        CLI_PATH, 'protocol', 'run',
        '--wallet-policy=create-if-missing',
        '--create-if-none',
        `--api-base=${server.url}`,
        `--state-dir=${tmpDir}`,
        `--decision-cmd=node ${decisionScript}`,
      ]);

      const linesPromise = collectJsonLines(proc, {
        stopOnState: 'thinking_uploaded',
        timeoutMs: 20000,
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));
      server.emitTurnRequest('arena-1', 'turn-thinking', { handNumber: 1 });
      await waitFor(() => server.calls.some((call) =>
        call.method === 'POST' && /\/arenas\/[^/]+\/actions$/.test(call.url)));
      server.emitHandAction({ arenaId: 'arena-1', handNumber: 1, sequenceNumber: 4, actorAgentId: 'ag1' });
      server.emitHandEnd('arena-1', 1);

      const lines = await linesPromise;
      const states = lines.map((line) => line.state);
      assert.ok(states.includes('thinking_uploaded'), `Expected thinking_uploaded. Got: ${JSON.stringify(states)}`);

      const thinkingCall = server.calls.find((call) =>
        call.method === 'POST' && /\/arenas\/[^/]+\/hands\/1\/thinking$/.test(call.url));
      assert.ok(thinkingCall, 'expected POST /thinking call');
      assert.deepEqual(thinkingCall.body.steps, [
        {
          sequenceNumber: 4,
          thinkingText: 'Pot odds are poor, so folding preserves stack.',
        },
      ]);
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 6: protocol run exits cleanly on arena_finished event
test('protocol run exits 0 when arena_finished event received', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
  try {
    const server = await createMockServer();
    try {
      const proc = spawn(NODE, [
        CLI_PATH, 'protocol', 'run',
        '--wallet-policy=create-if-missing',
        '--create-if-none',
        `--api-base=${server.url}`,
        `--state-dir=${tmpDir}`,
      ]);

      // Wait for competing, then emit arena_finished
      const linesPromise = collectJsonLines(proc, {
        stopOnState: 'arena_finished',
        timeoutMs: 20000,
      });

      await new Promise((r) => setTimeout(r, 3000));
      server.emitArenaFinished('arena-1');

      const lines = await linesPromise;
      const exitCode = await new Promise((r) => proc.on('exit', r));
      assert.equal(exitCode, 0, 'Should exit 0 on arena_finished');
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 7: protocol run skips arena list when --arena-id is given
test('protocol run joins specific arena when --arena-id is provided', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
  try {
    const server = await createMockServer();
    try {
      const proc = spawn(NODE, [
        CLI_PATH, 'protocol', 'run',
        '--wallet-policy=create-if-missing',
        `--arena-id=arena-specific`,
        `--api-base=${server.url}`,
        `--state-dir=${tmpDir}`,
      ]);

      const lines = await collectJsonLines(proc, {
        stopOnState: 'competing',
        timeoutMs: 15000,
      });

      // Should NOT have called GET /arenas (list)
      const listCalls = server.calls.filter((c) => c.method === 'GET' && c.url.startsWith('/arenas') && !c.url.includes('/runtime') && !c.url.includes('/join'));
      // With --arena-id, skip the list step — only join
      const joinCalls = server.calls.filter((c) => c.method === 'POST' && c.url.includes('/arenas/arena-specific/join'));
      assert.ok(joinCalls.length > 0, 'Should have joined the specified arena');
      assert.equal(listCalls.length, 0, 'Should not have called arena list when --arena-id is given');
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
