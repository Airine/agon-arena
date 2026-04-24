'use strict';

const { formatCards, stripAnsi } = require('./cards');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gold: '\x1b[1;33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function colorize(value, code, enabled) {
  return enabled ? `${code}${value}${ANSI.reset}` : value;
}

function compactId(value) {
  if (!value) return '?';
  const text = String(value);
  return text.length <= 8 ? text : `${text.slice(0, 8)}…`;
}

function visibleLength(value) {
  return stripAnsi(value).length;
}

function padRight(value, width) {
  const text = String(value ?? '');
  const missing = width - visibleLength(text);
  return missing > 0 ? `${text}${' '.repeat(missing)}` : text;
}

function truncate(value, width) {
  const text = String(value ?? '');
  if (visibleLength(text) <= width) return text;
  const plain = stripAnsi(text);
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

function money(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '?';
  return value.toLocaleString();
}

function totalPot(state) {
  return (state?.pots || []).reduce((sum, pot) => sum + (Number(pot.amount) || 0), 0);
}

function actionLabel(action) {
  if (!action) return 'none';
  const type = action.type || action.action || '?';
  return `${String(type).toUpperCase()}${action.amount ? ` ${action.amount}` : ''}`;
}

function resolveTurn(source) {
  if (!source) return null;
  if (source.pendingTurn) return source.pendingTurn;
  if (source.turnId || source.state || source.validActions) return source;
  return null;
}

function resolveState(source, mode) {
  const turn = resolveTurn(source);
  if (turn?.state) return turn.state;
  if (!source) return null;
  if (source.gameState) return source.gameState;
  if (source.state) return source.state;
  if (mode === 'spectator') return source.publicState || source.privateState || null;
  return source.privateState || source.publicState || null;
}

function legalActionsLine(turn) {
  if (!turn || !Array.isArray(turn.validActions) || turn.validActions.length === 0) {
    return 'legal: none';
  }
  const parts = turn.validActions.map((action) => {
    if (action === 'call') return `call ${turn.callAmount ?? 0}`;
    if (action === 'raise') return `raise ${turn.minRaise ?? 0}..${turn.maxRaise ?? 0}`;
    return action;
  });
  return `legal: ${parts.join(' | ')}`;
}

function renderPlayer(player, state, turn, options) {
  const color = options.color !== false;
  const agentId = options.agentId || turn?.agentId;
  const isMe = agentId && player.agentId === agentId;
  const isCurrent = state.currentActorIndex !== null &&
    state.players[state.currentActorIndex]?.agentId === player.agentId;
  const badges = [];
  if (state.dealerIndex === player.position || state.dealerIndex === state.players.indexOf(player)) badges.push('DLR');
  if (state.smallBlindIndex === state.players.indexOf(player)) badges.push('SB');
  if (state.bigBlindIndex === state.players.indexOf(player)) badges.push('BB');
  if (player.isAllIn) badges.push(colorize('ALL-IN', ANSI.red, color));
  if (player.isFolded) badges.push(colorize('FOLD', ANSI.dim, color));
  if (isCurrent) badges.push(colorize('TURN', ANSI.gold, color));

  const name = truncate(isMe ? `YOU(${player.agentName || compactId(player.agentId)})` : (player.agentName || compactId(player.agentId)), 18);
  const seat = String(player.position ?? state.players.indexOf(player)).padStart(2, ' ');
  const stack = money(player.stack);
  const bet = player.bet ? `bet ${money(player.bet)}` : 'bet -';
  const prefix = isCurrent ? colorize('>', ANSI.gold, color) : ' ';
  const base = `${prefix} seat ${seat}  ${padRight(name, 18)} stack ${padRight(stack, 8)} ${padRight(bet, 11)} ${badges.join(' ')}`;
  const line = player.isFolded ? colorize(base, ANSI.dim, color) : base;

  const cardLine = (player.cards && player.cards.length > 0)
    ? `        hole: ${formatCards(player.cards, { color })}${player.expression ? `  expr: ${player.expression}` : ''}`
    : null;
  return cardLine ? [line, cardLine] : [line];
}

function box(lines, width) {
  const inner = Math.max(40, width - 2);
  const top = `┌${'─'.repeat(inner)}┐`;
  const bottom = `└${'─'.repeat(inner)}┘`;
  const body = lines.map((line) => {
    const clipped = truncate(line, inner - 2);
    return `│ ${padRight(clipped, inner - 2)} │`;
  });
  return [top, ...body, bottom].join('\n');
}

function renderSnapshot(source, options = {}) {
  const color = options.color !== false;
  const width = Number(options.width) || 80;
  const mode = options.mode || 'private';
  const turn = resolveTurn(source);
  const state = resolveState(source, mode);
  const arenaId = source?.arenaId || turn?.arenaId || state?.arenaId || options.arenaId;
  const handNumber = turn?.handNumber ?? source?.handNumber ?? state?.handNumber ?? 0;

  if (!state) {
    return box([
      `${colorize('AGON ARENA', ANSI.gold, color)} · arena ${compactId(arenaId)}`,
      '',
      'waiting for game state...',
    ], width);
  }

  const header = `${colorize('AGON ARENA', ANSI.gold, color)} · arena ${compactId(arenaId)} · hand #${handNumber || state.handNumber || 0} · ${state.stage || 'unknown'}`;
  const community = formatCards(state.communityCards || [], { color });
  const lastAction = state.lastAction
    ? `${compactId(state.lastAction.agentId)} ${actionLabel(state.lastAction.action)}`
    : 'none';

  const lines = [
    header,
    '',
    `community: ${community}`,
    `pot: ${money(totalPot(state))}    blinds: ${money(state.smallBlindAmount)}/${money(state.bigBlindAmount)}`,
    '',
  ];

  for (const player of state.players || []) {
    lines.push(...renderPlayer(player, state, turn, options));
  }

  lines.push('');
  lines.push(`last: ${lastAction}`);
  lines.push(legalActionsLine(turn));
  return box(lines, width);
}

function renderClearScreen(source, options = {}) {
  const rendered = `${renderSnapshot(source, options)}\n`;
  return options.clear === false ? rendered : `\x1b[H\x1b[2J${rendered}`;
}

module.exports = {
  renderClearScreen,
  renderSnapshot,
};
