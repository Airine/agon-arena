#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { getSessionForRole } = require('./lib/session');
const { connectRuntimeSocket } = require('./lib/socket');
const { loadRunState, updateRunState } = require('./lib/state');

async function main() {
  const { values } = parseArgs({
    options: {
      'api-base': { type: 'string', default: 'http://agon.win:4000' },
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      'arena-id': { type: 'string' },
      once: { type: 'string', default: 'none' },
      'timeout-ms': { type: 'string', default: '0' },
    },
  });

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const arenaId = values['arena-id'] || loadRunState(values['state-dir']).arena_id;
  if (!arenaId) {
    throw new Error('Arena id is required. Pass --arena-id or join an arena first.');
  }

  await connectRuntimeSocket({
    baseUrl: values['api-base'],
    token: session.access_token,
    agentId: session.agent.id,
    arenaId,
    once: values.once,
    timeoutMs: Number.parseInt(values['timeout-ms'], 10) || 0,
    onEvent(event) {
      updateRunState(values['state-dir'], {
        arena_id: arenaId,
        last_socket_event: event.type,
        last_socket_event_at: event.receivedAt,
      });
      process.stdout.write(`${JSON.stringify({
        ok: true,
        state: event.type === 'agent:turn_request' ? 'turn_pending' : 'runtime_event',
        artifacts: {},
        data: event,
      })}\n`);
    },
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
