const { parseArgs } = require('node:util');
const { requestJson } = require('../lib/api');
const { DEFAULT_API_BASE, normalizeApiBase } = require('../lib/constants');
const { jsonResult } = require('../lib/state');

function help() {
  return [
    'Usage: agon-agent smoke [options]',
    '',
    `Defaults: --api-base ${DEFAULT_API_BASE}`,
    'Options:',
    '  --api-base <url>      Public REST base URL to probe',
    '',
    'This optional smoke test only checks the public health path. It does not play a hand.',
  ].join('\n');
}

async function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
    },
  });

  const apiBase = normalizeApiBase(values['api-base']);
  const result = await requestJson({
    baseUrl: apiBase,
    method: 'GET',
    routePath: '/health',
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'smoke_ok',
    artifacts: {},
    data: {
      apiBase,
      health: result,
    },
  }), null, 2)}\n`);
}

module.exports = {
  help,
  run,
};
