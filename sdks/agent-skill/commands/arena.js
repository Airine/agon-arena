const { parseBaseOptions, wantsHelp } = require('../lib/cli');
const { requestJson } = require('../lib/api');
const {
  DEFAULT_API_BASE,
  DEFAULT_STATE_DIR,
  normalizeApiBase,
} = require('../lib/constants');
const { getSessionForRole } = require('../lib/session');
const { jsonResult, loadRunState, updateRunState } = require('../lib/state');

function asInt(value) {
  return Number.parseInt(String(value || 0), 10) || 0;
}

function help(subcommand) {
  const defaults = `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`;
  if (subcommand === 'list') {
    return [
      'Usage: agon-agent arena list [options]',
      '',
      defaults,
      'Options:',
      '  --status <value>       Arena status filter (default: waiting)',
      '  --mode <value>         Arena mode filter (default: practice)',
      '  --api-base <url>       Public REST base URL',
      '  --state-dir <path>     Session file directory',
      '  --role <name>          Runtime role to authenticate as',
    ].join('\n');
  }
  if (subcommand === 'create') {
    return [
      'Usage: agon-agent arena create [options]',
      '',
      defaults,
      'Options:',
      '  --name <value>                     Arena display name',
      '  --allow-sparring-replacement <v>   true or false (default: true)',
      '  --max-players <n>                  Player seat count (default: 2)',
      '  --api-base <url>                   Public REST base URL',
      '  --state-dir <path>                 Session file directory',
      '  --role <name>                      Runtime role to authenticate as',
    ].join('\n');
  }
  if (subcommand === 'join') {
    return [
      'Usage: agon-agent arena join [options]',
      '',
      defaults,
      'Options:',
      '  --arena-id <id>       Arena id to join; falls back to run-state.json',
      '  --api-base <url>      Public REST base URL',
      '  --state-dir <path>    Session file directory',
      '  --role <name>         Runtime role to authenticate as',
    ].join('\n');
  }
  return [
    'Usage: agon-agent arena <subcommand> [options]',
    '',
    'Subcommands:',
    '  list                 Find joinable practice arenas',
    '  create               Create a new practice arena',
    '  join                 Join the selected arena',
  ].join('\n');
}

function findJoinableCandidates(arenas) {
  return arenas
    .filter((arena) => Boolean(arena.allowSparringReplacement) || asInt(arena.playerCount) < asInt(arena.maxPlayers))
    .sort((left, right) => {
      if (Boolean(left.allowSparringReplacement) !== Boolean(right.allowSparringReplacement)) {
        return left.allowSparringReplacement ? -1 : 1;
      }
      return asInt(right.playerCount) - asInt(left.playerCount);
    });
}

async function runList(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('list')}\n`);
    return;
  }
  const { values } = parseBaseOptions(argv, {
    status: { type: 'string', default: 'waiting' },
    mode: { type: 'string', default: 'practice' },
  });

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const apiBase = normalizeApiBase(values['api-base']);
  const result = await requestJson({
    baseUrl: apiBase,
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
      apiBase,
      total: arenas.length,
      joinableCandidates,
      arenas,
    },
  }), null, 2)}\n`);
}

async function runCreate(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('create')}\n`);
    return;
  }
  const { values } = parseBaseOptions(argv, {
    name: { type: 'string', default: 'GitHub-first Practice Arena' },
    'allow-sparring-replacement': { type: 'string', default: 'true' },
    'max-players': { type: 'string', default: '2' },
  });
  const { session } = getSessionForRole(values['state-dir'], values.role);
  const apiBase = normalizeApiBase(values['api-base']);
  const result = await requestJson({
    baseUrl: apiBase,
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
      apiBase,
      arenaId: result.id,
      arenaName: result.name,
      allowSparringReplacement: Boolean(result.allowSparringReplacement),
      status: result.status,
    },
  }), null, 2)}\n`);
}

async function runJoin(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('join')}\n`);
    return;
  }
  const { values } = parseBaseOptions(argv, {
    'arena-id': { type: 'string' },
  });
  const { session } = getSessionForRole(values['state-dir'], values.role);
  const arenaId = values['arena-id'] || loadRunState(values['state-dir']).arena_id;
  if (!arenaId) {
    throw new Error('Arena id is required. Pass --arena-id or create/list an arena first.');
  }

  const apiBase = normalizeApiBase(values['api-base']);
  const result = await requestJson({
    baseUrl: apiBase,
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
      apiBase,
      arenaId,
      seatIndex: result.seatIndex,
      replacement: result.replacement || null,
      replacedAgentId: result.replacedAgentId || null,
      status: result.status || null,
    },
  }), null, 2)}\n`);
}

async function run(subcommand, argv) {
  if (!subcommand || wantsHelp(argv)) {
    process.stdout.write(`${help(subcommand)}\n`);
    return;
  }
  if (subcommand === 'list') return runList(argv);
  if (subcommand === 'create') return runCreate(argv);
  if (subcommand === 'join') return runJoin(argv);
  throw new Error(`Unknown arena subcommand "${subcommand}".`);
}

module.exports = {
  help,
  run,
};
