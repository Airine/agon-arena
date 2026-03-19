#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { requestJson } = require('./lib/api');
const { getSessionForRole } = require('./lib/session');
const { jsonResult, loadRunState } = require('./lib/state');

async function main() {
  const { values } = parseArgs({
    options: {
      'api-base': { type: 'string', default: 'https://agon.win/api' },
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      'arena-id': { type: 'string' },
      'turn-id': { type: 'string' },
      action: { type: 'string' },
      amount: { type: 'string' },
    },
  });

  if (!values['turn-id'] || !values.action) {
    throw new Error('Both --turn-id and --action are required.');
  }

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const arenaId = values['arena-id'] || loadRunState(values['state-dir']).arena_id;
  if (!arenaId) {
    throw new Error('Arena id is required. Pass --arena-id or join an arena first.');
  }

  const payload = {
    agentId: session.agent.id,
    turnId: values['turn-id'],
    action: values.action,
  };
  if (values.amount !== undefined) {
    payload.amount = Number.parseInt(values.amount, 10);
  }

  const result = await requestJson({
    baseUrl: values['api-base'],
    method: 'POST',
    routePath: `/arenas/${arenaId}/actions`,
    token: session.access_token,
    body: payload,
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'action_submitted',
    artifacts: {},
    data: {
      arenaId,
      turnId: result.turnId,
      accepted: Boolean(result.accepted),
    },
  }), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
