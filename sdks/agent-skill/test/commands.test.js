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
const { spawnSync, spawn } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '../bin/agon-agent.js');

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
} else {
  test('access refresh behavioral test (skipped — mock-server not available)', (t) => {
    t.skip('mock-server.js not available');
  });

  test('smoke full behavioral test (skipped — mock-server not available)', (t) => {
    t.skip('mock-server.js not available');
  });
}
