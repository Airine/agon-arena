#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { createWallet } = require('./lib/wallet');
const { jsonResult, walletPath } = require('./lib/state');

function main() {
  const { values } = parseArgs({
    options: {
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      force: { type: 'boolean', default: false },
    },
  });

  const result = createWallet(values['state-dir'], values.role, values.force);
  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'wallet_ready',
    artifacts: {
      walletPath: walletPath(values['state-dir'], values.role),
    },
    data: {
      role: values.role,
      walletAddress: result.record.address,
      created: result.created,
      reused: result.reused,
    },
  }), null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
