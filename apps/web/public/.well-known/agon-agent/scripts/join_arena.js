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
    throw new Error('Arena id is required. Pass --arena-id or create/list an arena first.');
  }

  const result = await requestJson({
    baseUrl: values['api-base'],
    method: 'POST',
    routePath: `/arenas/${arenaId}/join`,
    token: session.access_token,
    body: {
      agentId: session.agent.id,
    },
  });

  updateRunState(values['state-dir'], {
    arena_id: arenaId,
    primary_joined_arena: values.role === 'primary' ? true : undefined,
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: result.replacement === 'sparring' ? 'arena_joined_by_replacement' : 'arena_joined',
    artifacts: {},
    data: {
      arenaId,
      seatIndex: result.seatIndex,
      replacement: result.replacement || null,
      replacedAgentId: result.replacedAgentId || null,
      status: result.status || null,
    },
  }), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
