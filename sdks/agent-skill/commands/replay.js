'use strict';

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { requestJson } = require('../lib/api');
const { DEFAULT_API_BASE, normalizeApiBase } = require('../lib/constants');
const { wantsHelp } = require('../lib/cli');
const { jsonResult } = require('../lib/state');

function help() {
  return [
    'Usage: agon replay <file.ndjson> [options]',
    '       agon replay --file <file.ndjson> [options]',
    '       agon replay --arena-id <id> --hand-number <n> [options]',
    '',
    'Replays a saved protocol NDJSON stream or fetches replay events from the API and prints a JSON summary.',
    '',
    'Options:',
    '  --file <path>        Saved NDJSON file emitted by protocol run stdout',
    '  --arena-id <id>      Fetch replay events from the API',
    '  --hand-number <n>   Hand number for API replay: GET /arenas/<id>/hands/<n>/replay',
    `  --api-base <url>     Public REST base URL (default: ${DEFAULT_API_BASE})`,
    '  --limit <n>          Maximum events to process',
    '',
    'Examples:',
    '  agon +play --practice > /tmp/agon-run.ndjson',
    '  agon replay /tmp/agon-run.ndjson',
    '  agon replay --arena-id arena-123 --hand-number 1 --api-base https://agon.win/api',
  ].join('\n');
}

function parseNdjson(text, sourceLabel) {
  const events = [];
  const lines = String(text || '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid NDJSON JSON at ${sourceLabel}:${index + 1}: ${error.message}`);
    }
  }

  return events;
}

function eventsFromApiPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.replay)) return payload.replay;
  if (Array.isArray(payload?.steps)) return payload.steps;
  if (Array.isArray(payload?.data?.events)) return payload.data.events;
  if (Array.isArray(payload?.data?.steps)) return payload.data.steps;
  throw new Error('Replay API response must be an array or include an events/steps array.');
}

function stateName(event) {
  return event?.state || event?.type || event?.event || (Number.isInteger(event?.sequenceNumber) ? 'replay_step' : null);
}

function extractArenaId(event) {
  return event?.arenaId || event?.data?.arenaId || event?.payload?.arenaId || event?.arena?.id || null;
}

function summarizeEvents(events, source) {
  const states = [];
  const stateCounts = {};
  const arenas = new Set();
  const actions = [];
  const thinkingUploads = [];
  let finished = false;
  if (source?.arenaId) arenas.add(source.arenaId);

  for (const event of events) {
    const state = stateName(event);
    if (state) {
      states.push(state);
      stateCounts[state] = (stateCounts[state] || 0) + 1;
      if (state === 'arena_finished' || state === 'arena:finished') finished = true;
    }

    const arenaId = extractArenaId(event);
    if (arenaId) arenas.add(arenaId);

    if (state === 'action_submitted' || state === 'replay_step' || event?.type === 'hand:action') {
      actions.push({
        arenaId,
        turnId: event?.data?.turnId || event?.turnId || event?.payload?.turnId || null,
        handNumber: event?.data?.handNumber || event?.handNumber || source?.handNumber || null,
        actorAgentId: event?.actorAgentId || event?.payload?.actorAgentId || null,
        action: event?.data?.action || event?.action?.type || event?.action || null,
        sequenceNumber: event?.sequenceNumber || event?.payload?.sequenceNumber || null,
      });
    }

    if (state === 'thinking_uploaded') {
      thinkingUploads.push({
        arenaId,
        handNumber: event?.data?.handNumber || event?.handNumber || null,
        uploaded: event?.data?.uploaded || event?.uploaded || null,
      });
    }
  }

  return jsonResult({
    state: 'replay_loaded',
    artifacts: {},
    data: {
      source,
      totalEvents: events.length,
      arenaIds: [...arenas],
      states,
      stateCounts,
      actions,
      thinkingUploads,
      finished,
    },
  });
}

async function loadEvents(values, positionals) {
  const limit = values.limit ? Number.parseInt(values.limit, 10) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer.');
  }

  const filePath = values.file || positionals[0];
  if (filePath) {
    const events = parseNdjson(fs.readFileSync(filePath, 'utf8'), filePath);
    return { source: { type: 'file', path: filePath }, events: limit ? events.slice(0, limit) : events };
  }

  if (values['arena-id']) {
    if (!values['hand-number']) {
      throw new Error('--hand-number is required with --arena-id for API replay.');
    }
    const handNumber = Number.parseInt(values['hand-number'], 10);
    if (!Number.isInteger(handNumber) || handNumber < 1) {
      throw new Error('--hand-number must be a positive integer.');
    }
    const apiBase = normalizeApiBase(values['api-base']);
    const payload = await requestJson({
      baseUrl: apiBase,
      method: 'GET',
      routePath: `/arenas/${encodeURIComponent(values['arena-id'])}/hands/${handNumber}/replay`,
    });
    const events = eventsFromApiPayload(payload);
    return {
      source: { type: 'api', apiBase, arenaId: values['arena-id'], handNumber },
      events: limit ? events.slice(0, limit) : events,
    };
  }

  throw new Error('Replay source is required. Pass <file.ndjson>, --file, or --arena-id.');
}

async function run(subcommand, argv = []) {
  const args = [subcommand, ...argv].filter(Boolean);
  if (args.length === 0 || wantsHelp(args)) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      'arena-id': { type: 'string' },
      'hand-number': { type: 'string' },
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
      limit: { type: 'string' },
    },
  });

  const { source, events } = await loadEvents(values, positionals);
  process.stdout.write(`${JSON.stringify(summarizeEvents(events, source), null, 2)}\n`);
}

module.exports = {
  eventsFromApiPayload,
  help,
  parseNdjson,
  run,
  summarizeEvents,
};
