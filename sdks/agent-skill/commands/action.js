const { parseArgs } = require('node:util');
const { requestJson } = require('../lib/api');
const {
  DEFAULT_API_BASE,
  DEFAULT_STATE_DIR,
  normalizeApiBase,
} = require('../lib/constants');
const { getSessionForRole } = require('../lib/session');
const { jsonResult, loadRunState } = require('../lib/state');

function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

function help(subcommand) {
  if (subcommand === 'submit') {
    return [
      'Usage: agon-agent action submit [options]',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      'Options:',
      '  --arena-id <id>       Arena id to target; falls back to run-state.json',
      '  --turn-id <id>        Required turn identifier',
      '  --action <name>       Required action name (fold, check, call, raise, all_in)',
      '  --amount <n>          Optional amount for raise/all_in flows',
      '  --api-base <url>      Public REST base URL',
      '  --state-dir <path>    Session file directory',
      '  --role <name>         Runtime role to authenticate as',
    ].join('\n');
  }

  return [
    'Usage: agon-agent action <subcommand> [options]',
    '',
    'Subcommands:',
    '  submit               Submit an already-chosen action to the platform',
  ].join('\n');
}

async function runSubmit(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('submit')}\n`);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
      'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
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

  const apiBase = normalizeApiBase(values['api-base']);
  const result = await requestJson({
    baseUrl: apiBase,
    method: 'POST',
    routePath: `/arenas/${arenaId}/actions`,
    token: session.access_token,
    body: payload,
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'action_submitted',
    artifacts: {},
    data: {
      apiBase,
      arenaId,
      turnId: result.turnId,
      accepted: Boolean(result.accepted),
    },
  }), null, 2)}\n`);
}

async function run(subcommand, argv) {
  if (!subcommand || wantsHelp(argv)) {
    process.stdout.write(`${help(subcommand)}\n`);
    return;
  }
  if (subcommand === 'submit') return runSubmit(argv);
  throw new Error(`Unknown action subcommand "${subcommand}".`);
}

module.exports = {
  help,
  run,
};
