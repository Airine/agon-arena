const { parseBaseOptions, wantsHelp } = require('../lib/cli');
const { requestJson } = require('../lib/api');
const {
  DEFAULT_API_BASE,
  DEFAULT_STATE_DIR,
  DEFAULT_SOCKET_ORIGIN,
  deriveSocketOrigin,
  normalizeApiBase,
} = require('../lib/constants');
const { getSessionForRole } = require('../lib/session');
const { connectRuntimeSocket } = require('../lib/socket');
const { jsonResult, loadRunState, updateRunState } = require('../lib/state');

function help(subcommand) {
  if (subcommand === 'get') {
    return [
      'Usage: agon runtime get [options]',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      'Options:',
      '  --arena-id <id>       Arena id to inspect; falls back to run-state.json',
      '  --api-base <url>      Public REST base URL',
      '  --state-dir <path>    Session file directory',
      '  --role <name>         Runtime role to authenticate as',
    ].join('\n');
  }

  if (subcommand === 'subscribe') {
    return [
      'Usage: agon runtime subscribe [options]',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --socket-origin ${DEFAULT_SOCKET_ORIGIN}`,
      'Options:',
      '  --arena-id <id>         Arena id to subscribe to; falls back to run-state.json',
      '  --api-base <url>        Public REST base URL',
      '  --socket-origin <url>   Public Socket.IO origin; defaults to the API origin',
      '  --state-dir <path>      Session file directory',
      '  --role <name>           Runtime role to authenticate as',
      '  --once <event>          Exit after the first matching event',
      '  --timeout-ms <n>        Stop listening after this timeout',
    ].join('\n');
  }

  return [
    'Usage: agon runtime <subcommand> [options]',
    '',
    'Subcommands:',
    '  get                  Pull the current private runtime snapshot',
    '  subscribe            Stream runtime events over Socket.IO',
  ].join('\n');
}

async function runGet(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('get')}\n`);
    return;
  }

  const { values } = parseBaseOptions(argv, {
    'arena-id': { type: 'string' },
  });

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const arenaId = values['arena-id'] || loadRunState(values['state-dir']).arena_id;
  if (!arenaId) {
    throw new Error('Arena id is required. Pass --arena-id or join an arena first.');
  }

  const apiBase = normalizeApiBase(values['api-base']);
  const result = await requestJson({
    baseUrl: apiBase,
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
      apiBase,
      arenaId,
      snapshot: result.snapshot,
    },
  }), null, 2)}\n`);
}

async function runSubscribe(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('subscribe')}\n`);
    return;
  }

  const { values } = parseBaseOptions(argv, {
    'socket-origin': { type: 'string' },
    'arena-id': { type: 'string' },
    once: { type: 'string', default: 'none' },
    'timeout-ms': { type: 'string', default: '0' },
  });

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const arenaId = values['arena-id'] || loadRunState(values['state-dir']).arena_id;
  if (!arenaId) {
    throw new Error('Arena id is required. Pass --arena-id or join an arena first.');
  }

  const apiBase = normalizeApiBase(values['api-base']);
  const socketOrigin = values['socket-origin'] || deriveSocketOrigin(apiBase);

  await connectRuntimeSocket({
    apiBase,
    socketOrigin,
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
        data: {
          apiBase,
          socketOrigin,
          ...event,
        },
      })}\n`);
    },
  });
}

async function run(subcommand, argv) {
  if (!subcommand || wantsHelp(argv)) {
    process.stdout.write(`${help(subcommand)}\n`);
    return;
  }
  if (subcommand === 'get') return runGet(argv);
  if (subcommand === 'subscribe') return runSubscribe(argv);
  throw new Error(`Unknown runtime subcommand "${subcommand}".`);
}

module.exports = {
  help,
  run,
};
