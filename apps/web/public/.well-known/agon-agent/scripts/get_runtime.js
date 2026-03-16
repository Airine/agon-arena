#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { requestJson } = require('./lib/api');
const { getSessionForRole } = require('./lib/session');
const { jsonResult, loadRunState, updateRunState } = require('./lib/state');

async function main() {
  const { values } = parseArgs({
    options: {
      'api-base': { type: 'string', default: 'http://agon.win:4000' },
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      'arena-id': { type: 'string' },
    },
  });

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const arenaId = values['arena-id'] || loadRunState(values['state-dir']).arena_id;
  if (!arenaId) {
    throw new Error('Arena id is required. Pass --arena-id or join an arena first.');
  }

  const result = await requestJson({
    baseUrl: values['api-base'],
    method: 'GET',
    routePath: `/arenas/${arenaId}/runtime?agentId=${encodeURIComponent(session.agent.id)}`,
    token: session.access_token,
  });
  const pendingTurn = result.snapshot?.pendingTurn || null;
  updateRunState(values['state-dir'], {
    arena_id: arenaId,
    last_runtime_sync_at: Date.now(),
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: pendingTurn ? 'turn_pending' : 'runtime_synced',
    artifacts: {},
    data: {
      arenaId,
      snapshot: result.snapshot,
    },
  }), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
