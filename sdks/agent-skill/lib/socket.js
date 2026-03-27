const { io } = require('socket.io-client');
const { deriveSocketOrigin } = require('./constants');

function connectRuntimeSocket({
  socketOrigin,
  apiBase,
  token,
  agentId,
  arenaId,
  onEvent,
  once = 'none',
  timeoutMs = 0,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle = null;
    const socket = io(socketOrigin || deriveSocketOrigin(apiBase), {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
    });

    function finish(error) {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      socket.disconnect();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    function handle(type, payload) {
      onEvent({ type, payload, receivedAt: Date.now() });
      if (once === 'any' || once === type) {
        finish();
      }
    }

    socket.on('connect', () => {
      socket.emit('agent:subscribe', { agentId, arenaId });
      onEvent({ type: 'socket:connected', payload: { agentId, arenaId }, receivedAt: Date.now() });
    });

    socket.on('agent:runtime_snapshot', (payload) => handle('agent:runtime_snapshot', payload));
    socket.on('agent:turn_request', (payload) => handle('agent:turn_request', payload));
    socket.on('agent:arena_event', (payload) => handle('agent:arena_event', payload));
    socket.on('connect_error', (error) => finish(error));
    socket.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    socket.on('agent:error', (payload) => {
      const err = new Error(`agent:error: ${payload?.message || 'subscription auth failed'}`);
      err.code = 'AGENT_AUTH_ERROR';
      err.payload = payload;
      finish(err);
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => finish(), timeoutMs);
    }
  });
}

module.exports = {
  connectRuntimeSocket,
};
