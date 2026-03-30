'use strict';
const { parseBaseOptions, wantsHelp } = require('../lib/cli');
const { requestJson } = require('../lib/api');
const {
  DEFAULT_API_BASE,
  DEFAULT_STATE_DIR,
  normalizeApiBase,
} = require('../lib/constants');
const { getSessionForRole } = require('../lib/session');
const { jsonResult, loadRunState } = require('../lib/state');

function help(subcommand) {
  if (subcommand === 'upload') {
    return [
      'Usage: agon-agent thinking upload [options]',
      '',
      'Uploads agent thinking text for each action taken during a completed hand.',
      'Must be called within 30 seconds of hand end.',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      '',
      'Options:',
      '  --arena-id <id>        Arena id; falls back to run-state.json',
      '  --hand-number <n>      Required hand number',
      '  --steps <json>         Required JSON array: [{sequenceNumber, thinkingText}, ...]',
      '  --api-base <url>       Public REST base URL',
      '  --state-dir <path>     Session file directory',
      '  --role <name>          Runtime role to authenticate as',
    ].join('\n');
  }

  return [
    'Usage: agon-agent thinking <subcommand> [options]',
    '',
    'Subcommands:',
    '  upload    Upload thinking text for a completed hand (within 30s of hand end)',
  ].join('\n');
}

/**
 * Upload thinking text for a completed hand.
 *
 * Programmatic usage:
 *   const { uploadThinking } = require('./commands/thinking');
 *   await uploadThinking({ apiBase, token, arenaId, handNumber, steps });
 */
async function uploadThinking({ apiBase, token, arenaId, handNumber, steps }) {
  return requestJson({
    baseUrl: normalizeApiBase(apiBase),
    method: 'POST',
    routePath: `/arenas/${arenaId}/hands/${handNumber}/thinking`,
    token,
    body: { steps },
  });
}

async function runUpload(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('upload')}\n`);
    return;
  }

  const { values } = parseBaseOptions(argv, {
    'arena-id': { type: 'string' },
    'hand-number': { type: 'string' },
    steps: { type: 'string' },
  });

  if (!values['hand-number']) {
    throw new Error('--hand-number is required.');
  }
  if (!values.steps) {
    throw new Error('--steps is required (JSON array of {sequenceNumber, thinkingText}).');
  }

  const handNumber = parseInt(values['hand-number'], 10);
  if (isNaN(handNumber)) throw new Error('--hand-number must be an integer.');

  let steps;
  try {
    steps = JSON.parse(values.steps);
  } catch {
    throw new Error('--steps must be valid JSON.');
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('--steps must be a non-empty JSON array.');
  }

  const { session } = getSessionForRole(values['state-dir'], values.role);
  const arenaId = values['arena-id'] || loadRunState(values['state-dir']).arena?.id;
  if (!arenaId) {
    throw new Error('Arena id is required. Pass --arena-id or join an arena first.');
  }

  const apiBase = normalizeApiBase(values['api-base']);
  const result = await uploadThinking({
    apiBase,
    token: session.access_token,
    arenaId,
    handNumber,
    steps,
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'thinking_uploaded',
    artifacts: {},
    data: {
      apiBase,
      arenaId,
      handNumber,
      uploaded: result.uploaded,
    },
  }), null, 2)}\n`);
}

async function run(subcommand, argv) {
  if (!subcommand || wantsHelp(argv)) {
    process.stdout.write(`${help(subcommand)}\n`);
    return;
  }
  if (subcommand === 'upload') return runUpload(argv);
  throw new Error(`Unknown thinking subcommand "${subcommand}".`);
}

module.exports = { help, run, uploadThinking };
