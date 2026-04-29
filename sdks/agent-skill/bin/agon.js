#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { CLI_COMMANDS, DEFAULT_API_BASE, RAW_INSTALL_URL, REPO_URL } = require('../lib/constants');
const { watch: watchTui } = require('./agon-tui');
const protocol = require('../commands/protocol');

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
    case 'schema':
      return require('../commands/schema');
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
    '  +play --practice',
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
    '  schema <name>',
    '  smoke',
    '  protocol run',
    '  protocol resume',
    '',
    'Examples:',
    '  agon +play --practice --tui',
    '  agon +play --practice --decision-cmd "bash ./decide-codex.sh"',
    '  agon protocol run --wallet-policy=create-if-missing --create-if-none --decision-cmd "node decide.js"',
    '  agon protocol resume --wallet-policy=require-existing --decision-cmd "node decide.js"',
    '  agon schema action.submit',
    '  agon +watch <arena-id> --plain',
    '  agon smoke full --wallet-policy=create-if-missing --api-base https://agon.win/api',
    '',
    `Supported commands: ${CLI_COMMANDS.join(', ')}`,
  ].join('\n') + '\n');
}

function printPlayHelp() {
  process.stdout.write([
    'Usage: agon +play --practice [options]',
    '',
    'Starts a practice protocol run with agent-friendly defaults.',
    '',
    'Defaults added by +play:',
    '  --wallet-policy=create-if-missing',
    '  --create-if-none',
    '  --arena-tier=practice',
    '  --decision-cmd=<bundled heuristic>',
    '',
    'Wallet state:',
    '  Uses --state-dir ./.agon-agent unless overridden.',
    '  Reuses an existing wallet and does not overwrite it.',
    '',
    'Common options:',
    '  --api-base <url>',
    '  --state-dir <path>',
    '  --arena-id <id>',
    '  --decision-cmd <cmd>',
    '  --tui',
    '  --tui-log <path>',
    '  --plain',
    '  --width <n>',
    '',
    'Examples:',
    '  agon +play --practice --tui',
    '  agon +play --practice --api-base http://localhost:4000 --state-dir ./.agon-agent',
    '  agon +play --practice --decision-cmd "bash ./decide-codex.sh"',
  ].join('\n') + '\n');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function defaultPracticeDecisionCmd() {
  return `node ${shellQuote(path.join(__dirname, '..', 'examples', 'decide-heuristic.mjs'))}`;
}

function hasOption(argv, option) {
  return argv.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function buildPracticePlayArgs(argv) {
  const passthrough = argv.filter((arg) =>
    arg !== '--practice' &&
    arg !== 'practice' &&
    !arg.startsWith('--practice='));
  const defaults = [];
  if (!hasOption(passthrough, '--wallet-policy')) {
    defaults.push('--wallet-policy=create-if-missing');
  }
  if (!hasOption(passthrough, '--arena-tier')) {
    defaults.push('--arena-tier=practice');
  }
  if (!hasOption(passthrough, '--arena-id') && !passthrough.includes('--create-if-none')) {
    defaults.push('--create-if-none');
  }
  if (!hasOption(passthrough, '--decision-cmd')) {
    defaults.push(`--decision-cmd=${defaultPracticeDecisionCmd()}`);
  }
  return [...defaults, ...passthrough];
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
  if (group === '+play') {
    const playArgs = [subcommand, ...rest].filter(Boolean);
    if (playArgs.length === 0 || playArgs.includes('--help') || playArgs.includes('-h')) {
      printPlayHelp();
      return;
    }
    await protocol.run('run', buildPracticePlayArgs(playArgs));
    return;
  }

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
  buildPracticePlayArgs,
  run,
};
