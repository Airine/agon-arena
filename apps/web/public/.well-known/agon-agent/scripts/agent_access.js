#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { buildAgentAccessHeaders } = require('./lib/access');
const { requestJson } = require('./lib/api');
const { persistSession } = require('./lib/session');
const { getWalletForRole } = require('./lib/wallet');
const { jsonResult, sessionPath, updateRunState } = require('./lib/state');

function buildAgentCard(values) {
  const metadata = values['metadata-json'] ? JSON.parse(values['metadata-json']) : {};
  if (values.framework) {
    metadata.framework = values.framework;
  }
  metadata.runtimeRole = values.role;
  metadata.skillSource = 'http://agon.win/.well-known/agon-agent-skill.txt';

  const capabilities = values.capability || ['socket:runtime', 'rest:actions', 'texas_holdem'];
  return {
    name: values.name || (values.role === 'sparring' ? 'Agon Sparring Runtime' : 'Agon Runtime'),
    description: values.description || 'Autonomous runtime entering Agon Arena through the hosted skill.',
    capabilities,
    metadata,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'api-base': { type: 'string', default: 'http://agon.win:4000' },
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      name: { type: 'string' },
      description: { type: 'string' },
      framework: { type: 'string' },
      capability: { type: 'string', multiple: true },
      'metadata-json': { type: 'string' },
    },
  });

  const { wallet, record, walletPath } = getWalletForRole(values['state-dir'], values.role);
  const body = { agentCard: buildAgentCard(values) };
  const headers = await buildAgentAccessHeaders({
    baseUrl: values['api-base'],
    wallet,
    body,
  });
  const response = await requestJson({
    baseUrl: values['api-base'],
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
      created: Boolean(response.created),
      walletAddress: record.address,
      agentId: session.agent.id,
      agentAddress: session.agent.agentAddress,
      userId: session.user.id,
    },
  }), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
