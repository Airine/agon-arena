const { parseBaseOptions, wantsHelp } = require('../lib/cli');
const { buildAgentAccessHeaders } = require('../lib/access');
const { requestJson } = require('../lib/api');
const {
  DEFAULT_API_BASE,
  DEFAULT_STATE_DIR,
  SKILL_URL,
  normalizeApiBase,
} = require('../lib/constants');
const { getSessionForRole, persistSession } = require('../lib/session');
const { jsonResult, sessionPath, updateRunState } = require('../lib/state');
const { getWalletForRole } = require('../lib/wallet');

function help(subcommand) {
  if (subcommand === 'bootstrap') {
    return [
      'Usage: agon-agent access bootstrap [options]',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      'Options:',
      '  --api-base <url>       Public REST base URL for Agon Arena',
      '  --state-dir <path>     Read wallet and write session files under this directory',
      '  --role <name>          Runtime role to authenticate (primary or sparring)',
      '  --name <value>         Override the default agentCard.name',
      '  --description <value>  Override the default agentCard.description',
      '  --framework <value>    Set agentCard.metadata.framework',
      '  --capability <value>   Repeatable capability entry for the agent card',
      '  --metadata-json <json> Merge extra metadata into agentCard.metadata',
    ].join('\n');
  }

  if (subcommand === 'refresh') {
    return [
      'Usage: agon-agent access refresh [options]',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      'Options:',
      '  --api-base <url>       Public REST base URL for Agon Arena',
      '  --state-dir <path>     Read and write session files under this directory',
      '  --role <name>          Runtime role to refresh (primary or sparring)',
      '',
      'Rotates the access token using the refresh token from the session file.',
      'Called automatically by `protocol run` when the token is within 5 minutes of expiry',
      'or on a 401 response. Requires an existing session with a refresh token.',
      'Run `access bootstrap` first if no session exists.',
    ].join('\n');
  }

  return [
    'Usage: agon-agent access <subcommand> [options]',
    '',
    'Subcommands:',
    '  bootstrap            Sign and submit POST /auth/agent/access',
    '  refresh              Rotate the access token via POST /auth/token/refresh',
  ].join('\n');
}

function buildAgentCard(values) {
  const metadata = values['metadata-json'] ? JSON.parse(values['metadata-json']) : {};
  if (values.framework) {
    metadata.framework = values.framework;
  }
  metadata.runtimeRole = values.role;
  metadata.skillSource = SKILL_URL;

  const capabilities = values.capability || ['socket:runtime', 'rest:actions', 'texas_holdem'];
  return {
    name: values.name || (values.role === 'sparring' ? 'Agon Sparring Runtime' : 'Agon Runtime'),
    description: values.description || 'Autonomous runtime entering Agon Arena through the GitHub-first hosted skill.',
    capabilities,
    metadata,
  };
}

async function runBootstrap(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('bootstrap')}\n`);
    return;
  }

  const { values } = parseBaseOptions(argv, {
    name: { type: 'string' },
    description: { type: 'string' },
    framework: { type: 'string' },
    capability: { type: 'string', multiple: true },
    'metadata-json': { type: 'string' },
  });

  const apiBase = normalizeApiBase(values['api-base']);
  const { wallet, record, walletPath } = getWalletForRole(values['state-dir'], values.role);
  const body = { agentCard: buildAgentCard(values) };
  const headers = await buildAgentAccessHeaders({
    baseUrl: apiBase,
    wallet,
    body,
  });
  const response = await requestJson({
    baseUrl: apiBase,
    method: 'POST',
    routePath: '/auth/agent/access',
    body,
    headers,
  });

  const session = persistSession(values['state-dir'], values.role, response);
  updateRunState(values['state-dir'], {
    [`${values.role}_agent_id`]: session.agent.id,
    [`${values.role}_wallet_address`]: record.address,
    [`${values.role}_agent_address`]: session.agent.agentAddress,
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'session_ready',
    artifacts: {
      walletPath,
      sessionPath: sessionPath(values['state-dir'], values.role),
    },
    data: {
      role: values.role,
      apiBase,
      created: Boolean(response.created),
      walletAddress: record.address,
      agentId: session.agent.id,
      agentAddress: session.agent.agentAddress,
      userId: session.user.id,
    },
  }), null, 2)}\n`);
}

async function runRefresh(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('refresh')}\n`);
    return;
  }

  const { values } = parseBaseOptions(argv, {});
  const apiBase = normalizeApiBase(values['api-base']);
  const { session: existingSession } = getSessionForRole(values['state-dir'], values.role);

  if (!existingSession.refresh_token) {
    throw new Error('No refresh token in session. Run access bootstrap first.');
  }

  const response = await requestJson({
    baseUrl: apiBase,
    method: 'POST',
    routePath: '/auth/token/refresh',
    body: { refreshToken: existingSession.refresh_token },
  });

  // Preserve agent and user from existing session (refresh response only has tokens + expiry)
  const merged = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: response.expiresAt,
    user: existingSession.user,
    agent: existingSession.agent,
    created: existingSession.created,
  };
  const session = persistSession(values['state-dir'], values.role, merged);

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'session_refreshed',
    artifacts: {
      sessionPath: sessionPath(values['state-dir'], values.role),
    },
    data: {
      role: values.role,
      apiBase,
      agentId: session.agent?.id,
      expiresAt: response.expiresAt,
    },
  }), null, 2)}\n`);
}

async function run(subcommand, argv) {
  if (!subcommand || wantsHelp(argv)) {
    process.stdout.write(`${help(subcommand)}\n`);
    return;
  }

  if (subcommand === 'bootstrap') return runBootstrap(argv);
  if (subcommand === 'refresh') return runRefresh(argv);
  throw new Error(`Unknown access subcommand "${subcommand}".`);
}

module.exports = {
  help,
  run,
};
