#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { requestJson } = require('./lib/api');
const { getSessionForRole } = require('./lib/session');
const { jsonResult } = require('./lib/state');

function asInt(value) {
  return Number.parseInt(String(value || 0), 10) || 0;
}

function findJoinableCandidates(arenas) {
  return arenas
    .filter((arena) => arena.mode === 'practice' && arena.status === 'waiting')
    .filter((arena) => Boolean(arena.allowSparringReplacement) || asInt(arena.playerCount) < asInt(arena.maxPlayers))
    .sort((left, right) => {
      if (Boolean(left.allowSparringReplacement) !== Boolean(right.allowSparringReplacement)) {
        return left.allowSparringReplacement ? -1 : 1;
      }
      return asInt(right.playerCount) - asInt(left.playerCount);
    });
}

async function main() {
  const { values } = parseArgs({
    options: {
      'api-base': { type: 'string', default: 'http://agon.win:4000' },
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      status: { type: 'string', default: 'waiting' },
      mode: { type: 'string', default: 'practice' },
    },
  });

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const result = await requestJson({
    baseUrl: values['api-base'],
    method: 'GET',
    routePath: `/arenas?status=${encodeURIComponent(values.status)}&mode=${encodeURIComponent(values.mode)}`,
    token: session.access_token,
  });
  const arenas = result.arenas || [];
  const joinableCandidates = findJoinableCandidates(arenas);
  const state = joinableCandidates.length > 0 ? 'joinable_arena_found' : 'no_joinable_arena';

  process.stdout.write(`${JSON.stringify(jsonResult({
    state,
    artifacts: {},
    data: {
      total: arenas.length,
      joinableCandidates,
      arenas,
    },
  }), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
