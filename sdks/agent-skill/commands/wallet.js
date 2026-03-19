const { parseArgs } = require('node:util');
const { DEFAULT_STATE_DIR } = require('../lib/constants');
const { jsonResult, walletPath } = require('../lib/state');
const { createWallet, importWallet } = require('../lib/wallet');

function help(subcommand) {
  if (subcommand === 'create') {
    return [
      'Usage: agon-agent wallet create [options]',
      '',
      `Defaults: --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      'Options:',
      '  --state-dir <path>   Persist wallet/session files under this directory',
      '  --role <name>        Runtime role to manage (primary or sparring)',
      '  --force              Overwrite an existing wallet for this role',
    ].join('\n');
  }

  if (subcommand === 'import') {
    return [
      'Usage: agon-agent wallet import [options]',
      '',
      `Defaults: --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      'Options:',
      '  --private-key <hex>  Import a raw EVM private key',
      '  --wallet-json <path> Import a wallet JSON or keystore file',
      '  --password <value>   Password for encrypted keystore JSON',
      '  --state-dir <path>   Persist wallet/session files under this directory',
      '  --role <name>        Runtime role to manage (primary or sparring)',
      '  --force              Overwrite an existing wallet for this role',
    ].join('\n');
  }

  return [
    'Usage: agon-agent wallet <subcommand> [options]',
    '',
    'Subcommands:',
    '  create               Create a fresh wallet after user approval',
    '  import               Import an existing wallet from key or JSON',
  ].join('\n');
}

function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

async function runCreate(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('create')}\n`);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
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

async function runImport(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('import')}\n`);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
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

async function run(subcommand, argv) {
  if (!subcommand || wantsHelp(argv)) {
    process.stdout.write(`${help(subcommand)}\n`);
    return;
  }

  if (subcommand === 'create') return runCreate(argv);
  if (subcommand === 'import') return runImport(argv);

  throw new Error(`Unknown wallet subcommand "${subcommand}".`);
}

module.exports = {
  help,
  run,
};
