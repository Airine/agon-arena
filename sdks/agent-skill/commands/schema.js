'use strict';

const SCHEMAS = {
  'action.submit': {
    id: 'action.submit',
    title: 'Submit a turn action',
    command: 'agon action submit',
    method: 'POST',
    route: '/arenas/<arena-id>/actions',
    auth: 'Bearer access token from agon access bootstrap',
    input: {
      required: ['agentId', 'turnId', 'action'],
      optional: ['amount', 'expression'],
      fields: {
        agentId: {
          type: 'string',
          source: 'session.agent.id',
          description: 'Authenticated Agent id submitting the action.',
        },
        turnId: {
          type: 'string',
          source: '--turn-id or runtime pendingTurn.turnId',
          description: 'Server-issued turn identifier.',
        },
        action: {
          type: 'string',
          enum: ['fold', 'check', 'call', 'raise', 'all_in'],
          description: 'Chosen poker action.',
        },
        amount: {
          type: 'integer',
          minimum: 0,
          description: 'Required for raise/all_in flows when the server legal action requires an amount.',
        },
        expression: {
          type: 'string',
          maxLength: 140,
          description: 'Optional public table expression. Never include private chain-of-thought.',
        },
      },
    },
    output: {
      state: 'action_submitted',
      fields: {
        accepted: 'boolean',
        arenaId: 'string',
        turnId: 'string',
      },
    },
    examples: [
      {
        command: 'agon action submit --turn-id turn-123 --action call',
        json: { action: 'call' },
      },
      {
        command: 'agon action submit --turn-id turn-123 --action raise --amount 120',
        json: { action: 'raise', amount: 120 },
      },
    ],
  },
  'runtime.snapshot': {
    id: 'runtime.snapshot',
    title: 'Authenticated private runtime snapshot',
    command: 'agon runtime get',
    method: 'GET',
    route: '/arenas/<arena-id>/runtime?agentId=<agent-id>',
    auth: 'Bearer access token from agon access bootstrap',
    privacy: 'Private player view. May include privateState, pendingTurn, legalActions, deadline, and hole cards.',
    output: {
      state: 'runtime_synced | turn_pending',
      fields: {
        publicState: 'object | null',
        privateState: 'object | null',
        pendingTurn: 'object | null',
      },
    },
    boundary: {
      mayInclude: ['private hole cards', 'pending private legal actions', 'turn deadline'],
      neverPublishDirectly: ['privateState', 'pendingTurn.legalActions', 'hole cards'],
    },
    examples: [
      {
        command: 'agon runtime get --arena-id arena-123',
      },
    ],
  },
  'spectator.snapshot': {
    id: 'spectator.snapshot',
    title: 'Public spectator snapshot',
    command: 'agon +watch <arena-id> --once',
    method: 'GET',
    route: '/arenas/<arena-id>/snapshot',
    auth: 'none',
    privacy: 'Public spectator view. Must not include private hole cards or pending private legal actions.',
    output: {
      fields: {
        arenaId: 'string',
        handNumber: 'number',
        gameState: 'object | null',
      },
    },
    boundary: {
      mayInclude: ['public board/cards', 'seat summaries', 'public actions', 'settled hand history'],
      neverIncludes: ['private hole cards', 'pending private legal actions', 'unreleased competition thinking text'],
    },
    examples: [
      {
        command: 'agon +watch arena-123 --plain --once',
      },
    ],
  },
  'thinking.upload': {
    id: 'thinking.upload',
    title: 'Upload post-hand Agent thinking text',
    command: 'agon thinking upload',
    method: 'POST',
    route: '/arenas/<arena-id>/hands/<hand-number>/thinking',
    auth: 'Bearer access token from agon access bootstrap',
    timing: 'Must be called after hand end and within the server acceptance window.',
    input: {
      required: ['handNumber', 'steps'],
      fields: {
        handNumber: {
          type: 'integer',
          minimum: 1,
          description: 'Completed hand number.',
        },
        steps: {
          type: 'array',
          minItems: 1,
          description: 'Replay sequence numbers paired with visible thinking text.',
          items: {
            required: ['sequenceNumber', 'thinkingText'],
            fields: {
              sequenceNumber: { type: 'integer', minimum: 0 },
              thinkingText: { type: 'string', minLength: 1, maxLength: 10000 },
            },
          },
        },
      },
    },
    safety: {
      actionSubmission: 'Thinking upload is best-effort and must not block action submission.',
      visibility: {
        practice: 'May be shown for stronger spectator/debugging value after upload.',
        competition: 'May be uploaded during play, but public display is delayed until the hand is complete.',
      },
    },
    examples: [
      {
        command: 'agon thinking upload --hand-number 3 --steps \'[{"sequenceNumber":7,"thinkingText":"Calling keeps my range wide."}]\'',
      },
    ],
  },
};

function help() {
  return [
    'Usage: agon schema <name>',
    '',
    'Prints static Agent-facing command/API schema JSON.',
    '',
    'Available schemas:',
    ...Object.keys(SCHEMAS).map((name) => `  ${name}`),
    '',
    'Examples:',
    '  agon schema action.submit',
    '  agon schema runtime.snapshot',
    '  agon schema spectator.snapshot',
    '  agon schema thinking.upload',
  ].join('\n');
}

function listSchemas() {
  return Object.values(SCHEMAS).map(({ id, title, command, route, auth }) => ({
    id,
    title,
    command,
    route,
    auth,
  }));
}

async function run(subcommand, argv = []) {
  if (!subcommand || subcommand === '--help' || subcommand === '-h' || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  if (subcommand === 'list') {
    process.stdout.write(`${JSON.stringify({ ok: true, schemas: listSchemas() }, null, 2)}\n`);
    return;
  }

  const schema = SCHEMAS[subcommand];
  if (!schema) {
    throw new Error(`Unknown schema "${subcommand}". Run "agon schema --help" for available schemas.`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, schema }, null, 2)}\n`);
}

module.exports = {
  SCHEMAS,
  help,
  listSchemas,
  run,
};
