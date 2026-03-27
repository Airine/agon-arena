const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Helper to create a unique temp dir per test
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
}

// ─── Session tests ────────────────────────────────────────────────────────────

const { persistSession, getSessionForRole } = require('../lib/session');
const { loadJson } = require('../lib/state');
const { sessionPath } = require('../lib/state');

test('persistSession saves expires_at from payload.expiresAt', () => {
  const dir = makeTmpDir();
  persistSession(dir, 'agent', {
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: 9999999999000,
    user: { id: 'u1' },
    agent: { id: 'a1' },
  });
  const saved = JSON.parse(fs.readFileSync(sessionPath(dir, 'agent'), 'utf8'));
  assert.equal(saved.expires_at, 9999999999000);
});

test('persistSession saves null when expiresAt missing', () => {
  const dir = makeTmpDir();
  persistSession(dir, 'agent', {
    accessToken: 'tok',
    user: { id: 'u1' },
    agent: { id: 'a1' },
  });
  const saved = JSON.parse(fs.readFileSync(sessionPath(dir, 'agent'), 'utf8'));
  assert.equal(saved.expires_at, null);
});

test('persistSession saves access_token and refresh_token', () => {
  const dir = makeTmpDir();
  persistSession(dir, 'agent', {
    accessToken: 'my-access-token',
    refreshToken: 'my-refresh-token',
    user: { id: 'u1' },
    agent: { id: 'a1' },
  });
  const saved = JSON.parse(fs.readFileSync(sessionPath(dir, 'agent'), 'utf8'));
  assert.equal(saved.access_token, 'my-access-token');
  assert.equal(saved.refresh_token, 'my-refresh-token');
});

test('getSessionForRole throws when access_token missing', () => {
  const dir = makeTmpDir();
  const { saveSession } = require('../lib/state');
  saveSession(dir, 'agent', { agent: { id: 'a1' }, user: { id: 'u1' } });
  assert.throws(
    () => getSessionForRole(dir, 'agent'),
    /Session not found for role/,
  );
});

// ─── State tests ──────────────────────────────────────────────────────────────

const { updateRunState } = require('../lib/state');

test('updateRunState deep merges nested objects — sibling fields preserved', () => {
  const dir = makeTmpDir();
  updateRunState(dir, { arena: { id: 'a1', status: 'waiting' } });
  const result = updateRunState(dir, { arena: { status: 'active' } });
  assert.equal(result.arena.id, 'a1', 'arena.id should be preserved after second update');
  assert.equal(result.arena.status, 'active', 'arena.status should be updated');
});

test('updateRunState does not clobber top-level fields', () => {
  const dir = makeTmpDir();
  updateRunState(dir, { wallet: 'resolved', session: 'active' });
  const result = updateRunState(dir, { session: 'expired' });
  assert.equal(result.wallet, 'resolved', 'wallet should still be resolved');
  assert.equal(result.session, 'expired', 'session should be updated');
});

test('updateRunState filters undefined values', () => {
  const dir = makeTmpDir();
  const result = updateRunState(dir, { arena: undefined, wallet: 'resolved' });
  assert.equal(result.wallet, 'resolved');
  // arena should not be set (since it was undefined and filtered)
  assert.ok(!('arena' in result) || result.arena !== undefined, 'arena key with undefined should not be set');
});

test('updateRunState always sets updated_at', () => {
  const dir = makeTmpDir();
  const result = updateRunState(dir, { wallet: 'test' });
  assert.ok(typeof result.updated_at === 'number', 'updated_at should be a number');
  assert.ok(result.updated_at > 0, 'updated_at should be > 0');
});

// ─── Socket test ──────────────────────────────────────────────────────────────

test('connectRuntimeSocket rejects with AGENT_AUTH_ERROR on agent:error event', async () => {
  const { Server: IOServer } = require('socket.io');
  const { connectRuntimeSocket } = require('../lib/socket');

  const httpServer = http.createServer();
  const io = new IOServer(httpServer);
  await new Promise((r) => httpServer.listen(0, r));
  const port = httpServer.address().port;

  io.on('connection', (socket) => {
    socket.on('agent:subscribe', () => {
      socket.emit('agent:error', { message: 'token expired' });
    });
  });

  let caught = null;
  try {
    await connectRuntimeSocket({
      apiBase: `http://localhost:${port}`,
      token: 'fake-token',
      agentId: 'agent-1',
      arenaId: 'arena-1',
      onEvent: () => {},
    });
  } catch (err) {
    caught = err;
  } finally {
    io.close();
    await new Promise((r) => httpServer.close(r));
  }

  assert.ok(caught, 'should have rejected');
  assert.equal(caught.code, 'AGENT_AUTH_ERROR');
});
