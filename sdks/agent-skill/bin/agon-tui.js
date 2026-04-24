#!/usr/bin/env node
'use strict';

const { io } = require('socket.io-client');
const { requestJson } = require('../lib/api');
const {
  DEFAULT_API_BASE,
  deriveSocketOrigin,
  normalizeApiBase,
} = require('../lib/constants');
const { renderClearScreen } = require('../lib/tui');

function help() {
  return [
    'Usage: agon-tui watch <arena-id> [options]',
    '',
    'Watches a public arena as an ASCII poker table.',
    '',
    `Defaults: --api-base ${DEFAULT_API_BASE}`,
    '',
    'Options:',
    '  --api-base <url>        Public REST API base URL',
    '  --socket-origin <url>   Socket.IO origin; defaults to API origin',
    '  --no-color              Disable ANSI colors',
    '  --plain                 Plain output (alias for no-color, no screen clearing)',
    '  --width <n>             Target render width (default: 80)',
    '  --once                  Render the current snapshot and exit',
  ].join('\n');
}

function parseArgs(argv) {
  const [command, arenaId, ...rest] = argv;
  const values = {
    command,
    arenaId,
    apiBase: DEFAULT_API_BASE,
    socketOrigin: undefined,
    color: true,
    plain: false,
    width: 80,
    once: false,
  };

  if (arenaId === '--help' || arenaId === '-h') {
    values.help = true;
    values.arenaId = undefined;
  }

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--api-base') values.apiBase = rest[++index];
    else if (arg.startsWith('--api-base=')) values.apiBase = arg.slice('--api-base='.length);
    else if (arg === '--socket-origin') values.socketOrigin = rest[++index];
    else if (arg.startsWith('--socket-origin=')) values.socketOrigin = arg.slice('--socket-origin='.length);
    else if (arg === '--no-color') values.color = false;
    else if (arg === '--plain') {
      values.plain = true;
      values.color = false;
    }
    else if (arg === '--width') values.width = parseInt(rest[++index], 10) || 80;
    else if (arg.startsWith('--width=')) values.width = parseInt(arg.slice('--width='.length), 10) || 80;
    else if (arg === '--once') values.once = true;
    else if (arg === '--help' || arg === '-h') values.help = true;
    else throw new Error(`Unknown option "${arg}"`);
  }
  return values;
}

function renderState(payload, options) {
  const state = payload?.state || payload?.resultingState || payload?.finalState || payload?.gameState || payload;
  const source = {
    arenaId: options.arenaId,
    handNumber: payload?.handNumber ?? state?.handNumber ?? 0,
    publicState: state || null,
    privateState: null,
    pendingTurn: null,
    updatedAt: Date.now(),
  };
  process.stdout.write(renderClearScreen(source, {
    arenaId: options.arenaId,
    mode: 'spectator',
    color: options.color,
    clear: !options.plain,
    width: options.width,
  }));
}

async function renderInitialSnapshot(apiBase, arenaId, options) {
  const result = await requestJson({
    baseUrl: apiBase,
    method: 'GET',
    routePath: `/arenas/${arenaId}/snapshot`,
  });
  if (result.snapshot?.gameState) {
    renderState(
      { state: result.snapshot.gameState, handNumber: result.snapshot.handNumber },
      options,
    );
    return;
  }
  process.stdout.write(renderClearScreen({
    arenaId,
    handNumber: 0,
    publicState: null,
    privateState: null,
    pendingTurn: null,
  }, {
    arenaId,
    mode: 'spectator',
    color: options.color,
    clear: !options.plain,
    width: options.width,
  }));
}

async function watch(argv) {
  const values = parseArgs(argv);
  if (values.help || values.command !== 'watch' || !values.arenaId) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  const apiBase = normalizeApiBase(values.apiBase);
  const socketOrigin = values.socketOrigin || deriveSocketOrigin(apiBase);
  await renderInitialSnapshot(apiBase, values.arenaId, values);
  if (values.once) return;
  const renderOptions = {
    arenaId: values.arenaId,
    color: values.color,
    plain: values.plain,
    width: values.width,
  };

  const socket = io(socketOrigin, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: true,
  });

  socket.on('connect', () => {
    socket.emit('subscribe', { arenaId: values.arenaId });
  });
  socket.on('game:state_update', (payload) => renderState(payload, renderOptions));
  socket.on('game:action', (payload) => renderState(payload, renderOptions));
  socket.on('hand:end', (payload) => renderState(payload, renderOptions));
  socket.on('arena:finished', () => {
    process.stdout.write('\nArena finished.\n');
    socket.disconnect();
  });
  socket.on('arena:full', () => {
    process.stderr.write('Arena spectator cap reached.\n');
    socket.disconnect();
    process.exitCode = 1;
  });
  socket.on('connect_error', (err) => {
    process.stderr.write(`Socket error: ${err.message}\n`);
  });
}

if (require.main === module) {
  watch(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  help,
  parseArgs,
  watch,
};
