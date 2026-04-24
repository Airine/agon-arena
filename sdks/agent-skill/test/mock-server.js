'use strict';
const http = require('node:http');
const { Server: IOServer } = require('socket.io');

/**
 * Creates a minimal mock Agon Arena server for integration tests.
 *
 * @param {object} opts
 * @param {number} [opts.port=0] - Port to listen on (0 = random)
 * @param {object} [opts.overrides] - Override specific route responses
 * @returns {Promise<MockServer>}
 */
async function createMockServer({ port = 0, overrides = {} } = {}) {
  const calls = [];  // Track all incoming requests for assertions

  // Mutable state for dynamic test scenarios
  let nextArenaList = overrides.arenaList || [];
  let nextTurnRequest = overrides.turnRequest || null;
  let tokenExpiry = overrides.expiresAt || (Date.now() + 3600000);

  const httpServer = http.createServer((req, res) => {
    const call = { method: req.method, url: req.url };
    calls.push(call);

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      call.body = parsed;
      handleRequest(req, res, parsed, { nextArenaList, tokenExpiry, overrides });
    });
  });

  const io = new IOServer(httpServer, { cors: { origin: '*' } });

  // Track connected sockets for test control
  const connectedSockets = new Set();

  io.on('connection', (socket) => {
    connectedSockets.add(socket);
    socket.on('agent:subscribe', ({ agentId, arenaId }) => {
      socket.emit('agent:runtime_snapshot', {
        arenaId,
        agentId,
        snapshot: { hand: ['Ah', 'Kd'], communityCards: [], pot: 0, toCall: 0, stack: 1000, position: 'BTN', players: [] },
      });
    });
    socket.on('disconnect', () => connectedSockets.delete(socket));
  });

  await new Promise((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
  const actualPort = httpServer.address().port;

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    io,
    calls,
    /** Emit a turn request to all connected sockets */
    emitTurnRequest(arenaId = 'arena-1', turnId = 'turn-1', options = {}) {
      io.emit('agent:turn_request', {
        arenaId,
        turnId,
        handId: options.handId || 'hand-1',
        handNumber: options.handNumber || 1,
        agentId: options.agentId || 'ag1',
        validActions: ['fold', 'call', 'raise'],
        deadline: Date.now() + 30000,
        snapshot: {
          hand: ['Ah', 'Kd'],
          communityCards: ['2c', '7h', 'Js'],
          pot: 150,
          toCall: 50,
          stack: 900,
          position: 'BTN',
          players: [],
        },
      });
    },
    /** Emit a hand action event with replay sequence metadata */
    emitHandAction({
      arenaId = 'arena-1',
      handNumber = 1,
      sequenceNumber = 1,
      actorAgentId = 'ag1',
      action = { type: 'fold' },
    } = {}) {
      io.emit('agent:arena_event', {
        type: 'hand:action',
        arenaId,
        handNumber,
        sequenceNumber,
        actorAgentId,
        action,
        state: { handNumber, players: [] },
      });
    },
    /** Emit a hand end arena event */
    emitHandEnd(arenaId = 'arena-1', handNumber = 1) {
      io.emit('agent:arena_event', {
        type: 'hand:end',
        arenaId,
        handNumber,
        winners: [],
        state: { handNumber, players: [] },
      });
    },
    /** Emit arena finished event */
    emitArenaFinished(arenaId = 'arena-1') {
      io.emit('agent:arena_event', { type: 'arena_finished', arenaId });
    },
    /** Emit agent:error to simulate auth failure */
    emitAuthError() {
      io.emit('agent:error', { message: 'token expired' });
    },
    close() {
      return new Promise((resolve) => {
        io.close(() => httpServer.close(resolve));
      });
    },
  };
}

function handleRequest(req, res, body, { nextArenaList, tokenExpiry, overrides }) {
  const url = req.url.split('?')[0];
  const method = req.method;

  function json(statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // Health
  if (method === 'GET' && url === '/health') {
    return json(200, { status: 'ok' });
  }

  // Access bootstrap (agent SIWE — accept any signed request)
  if (method === 'POST' && url === '/auth/agent/access') {
    return json(200, {
      accessToken: 'tok-' + Date.now(),
      refreshToken: 'ref-' + Date.now(),
      expiresAt: tokenExpiry,
      created: true,
      user: { id: 'u1' },
      agent: { id: 'ag1', agentAddress: '0xdeadbeef' },
    });
  }

  // Token refresh
  if (method === 'POST' && url === '/auth/token/refresh') {
    return json(200, {
      accessToken: 'tok-refreshed-' + Date.now(),
      refreshToken: 'ref-refreshed-' + Date.now(),
      expiresAt: Date.now() + 3600000,
    });
  }

  // Arena list
  if (method === 'GET' && url.startsWith('/arenas') && !url.includes('/runtime') && !url.includes('/join') && !url.includes('/actions')) {
    return json(200, { arenas: nextArenaList });
  }

  // Arena create
  if (method === 'POST' && url === '/arenas') {
    return json(201, {
      id: 'arena-' + Date.now(),
      name: body.name || 'Test Arena',
      status: 'waiting',
      mode: body.mode || 'practice',
      allowSparringReplacement: true,
      maxPlayers: 2,
    });
  }

  // Arena join
  const joinMatch = url.match(/^\/arenas\/([^/]+)\/join$/);
  if (method === 'POST' && joinMatch) {
    return json(200, {
      seatIndex: 0,
      replacement: null,
      status: 'waiting',
    });
  }

  // Runtime get
  const runtimeMatch = url.match(/^\/arenas\/([^/]+)\/runtime$/);
  if (method === 'GET' && runtimeMatch) {
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

  // Action submit
  const actionsMatch = url.match(/^\/arenas\/([^/]+)\/actions$/);
  if (method === 'POST' && actionsMatch) {
    return json(200, {
      turnId: body.turnId,
      accepted: true,
    });
  }

  // Thinking upload
  const thinkingMatch = url.match(/^\/arenas\/([^/]+)\/hands\/(\d+)\/thinking$/);
  if (method === 'POST' && thinkingMatch) {
    return json(200, {
      ok: true,
      uploaded: Array.isArray(body.steps) ? body.steps.length : 0,
    });
  }

  // 404
  json(404, { error: `Not found: ${method} ${url}` });
}

module.exports = { createMockServer };
