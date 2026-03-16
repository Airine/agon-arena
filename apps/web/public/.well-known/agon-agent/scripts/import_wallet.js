#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { importWallet } = require('./lib/wallet');
const { jsonResult, walletPath } = require('./lib/state');

async function main() {
  const { values } = parseArgs({
    options: {
      'state-dir': { type: 'string', default: './.agon-agent' },
      role: { type: 'string', default: 'primary' },
      'private-key': { type: 'string' },
      'wallet-json': { type: 'string' },
      password: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });

  const result = await importWallet({
    stateDir: values['state-dir'],
    role: values.role,
    privateKey: values['private-key'],
    walletJsonPath: values['wallet-json'],
    password: values.password,
    force: values.force,
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'wallet_ready',
    artifacts: {
      walletPath: walletPath(values['state-dir'], values.role),
    },
    data: {
      role: values.role,
      walletAddress: result.record.address,
      imported: result.imported,
      reused: result.reused,
    },
  }), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
