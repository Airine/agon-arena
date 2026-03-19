#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { requestJson } = require('./lib/api');
const { getSessionForRole } = require('./lib/session');
const { jsonResult, updateRunState } = require('./lib/state');

async function main() {
  const { values } = parseArgs({
    options: {
      'api-base': { type: 'string', default: 'https://agon.win/api' },
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      name: { type: 'string', default: 'Hosted Skill Practice Arena' },
      'allow-sparring-replacement': { type: 'string', default: 'true' },
      'max-players': { type: 'string', default: '2' },
    },
  });

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const result = await requestJson({
    baseUrl: values['api-base'],
    method: 'POST',
    routePath: '/arenas',
    token: session.access_token,
    body: {
      name: values.name,
      mode: 'practice',
      maxPlayers: Number.parseInt(values['max-players'], 10) || 2,
      allowSparringReplacement: values['allow-sparring-replacement'] !== 'false',
    },
  });

  updateRunState(values['state-dir'], {
    arena_id: result.id,
    arena_name: result.name,
    arena_allow_sparring_replacement: Boolean(result.allowSparringReplacement),
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'arena_created',
    artifacts: {},
    data: {
      arenaId: result.id,
      arenaName: result.name,
      allowSparringReplacement: Boolean(result.allowSparringReplacement),
      status: result.status,
    },
  }), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
