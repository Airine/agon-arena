#!/usr/bin/env node
'use strict';

const { CLI_COMMANDS, DEFAULT_API_BASE, RAW_INSTALL_URL, REPO_URL } = require('../lib/constants');
const { watch: watchTui } = require('./agon-tui');

function loadCommandGroup(name) {
  switch (name) {
    case 'wallet':
      return require('../commands/wallet');
    case 'access':
      return require('../commands/access');
    case 'arena':
      return require('../commands/arena');
    case 'runtime':
      return require('../commands/runtime');
    case 'action':
      return require('../commands/action');
    case 'smoke':
      return require('../commands/smoke');
    case 'protocol':
      return require('../commands/protocol');
    case 'thinking':
      return require('../commands/thinking');
    default:
      return null;
  }
}

function printRootHelp() {
  process.stdout.write([
    'Agon CLI',
    '',
    'GitHub-first install:',
    `  curl -fsSL ${RAW_INSTALL_URL} | bash`,
    '',
    `Repository: ${REPO_URL}`,
    `Default API base: ${DEFAULT_API_BASE}`,
    '',
    'Shortcuts:',
    '  +watch <arena-id>',
    '',
    'Command groups:',
    '  wallet create',
    '  wallet import',
    '  access bootstrap',
    '  arena list',
    '  arena create',
    '  arena join',
    '  runtime get',
    '  runtime subscribe',
    '  action submit',
    '  thinking upload',
    '  smoke',
    '  protocol run',
    '  protocol resume',
    '',
    'Examples:',
    '  agon protocol run --wallet-policy=create-if-missing --create-if-none --decision-cmd "node decide.js"',
    '  agon protocol resume --wallet-policy=require-existing --decision-cmd "node decide.js"',
    '  agon +watch <arena-id> --plain',
    '  agon smoke full --wallet-policy=create-if-missing --api-base https://agon.win/api',
    '',
    `Supported commands: ${CLI_COMMANDS.join(', ')}`,
  ].join('\n') + '\n');
}

async function run(argv = process.argv.slice(2)) {
  if (
    argv.length === 0 ||
    argv[0] === '--help' ||
    argv[0] === '-h' ||
    argv[0] === 'help'
  ) {
    printRootHelp();
    return;
  }

  const [group, subcommand, ...rest] = argv;
  if (group === '+watch') {
    await watchTui(['watch', subcommand, ...rest].filter(Boolean));
    return;
  }

  const handler = loadCommandGroup(group);
  if (!handler) {
    throw new Error(`Unknown command group "${group}".`);
  }

  if (group === 'smoke') {
    await handler.run([subcommand, ...rest].filter(Boolean));
    return;
  }

  await handler.run(subcommand, rest);
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  run,
};
