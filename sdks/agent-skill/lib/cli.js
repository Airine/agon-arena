const { parseArgs } = require('node:util');
const { DEFAULT_API_BASE, DEFAULT_STATE_DIR } = require('./constants');

function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

function parseBaseOptions(args, extras = {}) {
  return parseArgs({
    args,
    options: {
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
      'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
      role: { type: 'string', default: 'primary' },
      ...extras,
    },
  });
}

module.exports = { parseBaseOptions, wantsHelp };
