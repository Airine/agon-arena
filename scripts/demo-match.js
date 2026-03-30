#!/usr/bin/env node
/**
 * demo-match.js
 *
 * Bootstraps two local AI agents ("Claude" and "Codex"), creates a live arena,
 * seats both, then runs their game loops in parallel.
 *
 * Usage:
 *   node scripts/demo-match.js
 *   node scripts/demo-match.js --api-base http://localhost:4000 --hands 20
 *
 * Open http://localhost:3000/markets/<arenaId> to watch as a spectator.
 */

'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { io } = require(path.join(__dirname, '../sdks/agent-skill/node_modules/socket.io-client'));
const { Wallet } = require(path.join(__dirname, '../sdks/agent-skill/node_modules/ethers'));
const { buildAgentAccessHeaders } = require('../sdks/agent-skill/lib/access');
const { requestJson } = require('../sdks/agent-skill/lib/api');
const { normalizeApiBase, deriveSocketOrigin } = require('../sdks/agent-skill/lib/constants');
const { persistSession } = require('../sdks/agent-skill/lib/session');
const { createWallet } = require('../sdks/agent-skill/lib/wallet');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
};

const API_BASE = normalizeApiBase(getArg('--api-base', 'http://localhost:4000'));
const SOCKET_ORIGIN = deriveSocketOrigin(API_BASE);
const WEB_BASE = getArg('--web-base', 'http://localhost:3000');
const MAX_HANDS = parseInt(getArg('--hands', '15'), 10);
const STATE_ROOT = path.join(os.tmpdir(), 'agon-demo');

// Isolated CODEX_HOME: no skills/, just a minimal config so Codex doesn't
// load `using-superpowers` or any other skill when called from this script.
const CODEX_DEMO_HOME = path.join(os.tmpdir(), 'agon-codex-home');
fs.mkdirSync(CODEX_DEMO_HOME, { recursive: true });
fs.writeFileSync(
  path.join(CODEX_DEMO_HOME, 'config.toml'),
  'model = "gpt-5.4"\nmodel_reasoning_effort = "auto"\n',
);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const COLORS = { reset: '\x1b[0m', gold: '\x1b[33m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m' };
function log(tag, color, ...msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${COLORS.dim}${ts}${COLORS.reset} ${color}[${tag}]${COLORS.reset}`, ...msg);
}

// ---------------------------------------------------------------------------
// Bootstrap: wallet → access → return { token, agentId }
// ---------------------------------------------------------------------------

async function bootstrap(name, stateDir) {
  log(name, COLORS.cyan, 'bootstrapping...');

  const { record } = createWallet(stateDir, 'primary', false);
  const wallet = new Wallet(
    record.private_key.startsWith('0x') ? record.private_key : `0x${record.private_key}`
  );

  const body = {
    agentCard: {
      name,
      description: `${name} — local demo agent`,
      capabilities: ['socket:runtime', 'rest:actions', 'texas_holdem'],
      metadata: { demo: true },
    },
  };

  const headers = await buildAgentAccessHeaders({ baseUrl: API_BASE, wallet, body });
  const response = await requestJson({
    baseUrl: API_BASE, method: 'POST', routePath: '/auth/agent/access', body, headers,
  });

  const session = persistSession(stateDir, 'primary', response);
  log(name, COLORS.cyan, `ready — agentId=${session.agent.id.slice(0, 8)}…`);
  return { token: session.access_token, agentId: session.agent.id, name };
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/** Run a CLI command, return stdout as string. Rejects on timeout or non-zero exit. */
function runCLI(cmd, args, timeoutMs = 30000, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      env: { ...process.env, ...extraEnv },
    };
    const proc = execFile(cmd, args, opts, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
    // surface stderr for debugging
    proc.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) process.stderr.write(`  [${cmd}:stderr] ${line}\n`);
    });
  });
}

/** Format a Card object {rank, suit} → e.g. "Ah", "Kd" */
function fmtCard(c) {
  if (!c) return '?';
  if (typeof c === 'string') return c;
  const suitChar = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };
  return `${c.rank}${suitChar[c.suit] || c.suit}`;
}

/** Build a concise poker-state prompt from a turn request */
function buildPokerPrompt(turn) {
  const myPlayer = (turn.state?.players || []).find(p => p.agentId === turn.agentId) || {};
  const holeCards = (myPlayer.cards || []).map(fmtCard).join(' ') || '(hidden)';
  const community = (turn.state?.communityCards || []).map(fmtCard).join(' ') || '(none)';
  const pot = (turn.state?.pots || []).reduce((s, p) => s + p.amount, 0);
  const stage = turn.state?.stage || '?';
  const stack = myPlayer.stack ?? '?';
  const callAmt = turn.callAmount ?? 0;
  const minR = turn.minRaise ?? 0;
  const maxR = turn.maxRaise ?? 0;
  const validActions = (turn.validActions || []).join(', ');
  const canRaise = turn.validActions?.includes('raise') && maxR >= minR;

  return `You are playing heads-up Texas Hold'em poker. Make your decision.

GAME STATE
  Hand: ${turn.handNumber}  |  Stage: ${stage}
  Your hole cards: ${holeCards}
  Community cards: ${community}
  Pot: ${pot}  |  Your stack: ${stack}  |  To call: ${callAmt}${canRaise ? `\n  Raise range: ${minR}–${maxR}` : ''}

VALID ACTIONS: ${validActions}

Reply with EXACTLY ONE line — no explanation:
  fold
  check
  call
  raise <integer amount>  (only if raise is valid, amount between ${minR} and ${maxR})

Your move:`;
}

/** Parse an action line from CLI text output */
function parseActionFromText(text, validActions, minRaise, maxRaise) {
  const lower = (text || '').toLowerCase();
  const has = (a) => validActions.includes(a);
  const clamp = (n) => Math.min(Math.max(Math.round(n), minRaise), maxRaise);

  // Explicit raise with amount
  const raiseMatch = lower.match(/\braise\s+(\d+)/);
  if (raiseMatch && has('raise') && maxRaise >= minRaise) {
    return { action: 'raise', amount: clamp(parseInt(raiseMatch[1], 10)) };
  }
  if (lower.includes('fold') && has('fold')) return { action: 'fold' };
  if (lower.includes('check') && has('check')) return { action: 'check' };
  if (lower.includes('call') && has('call')) return { action: 'call' };
  if (lower.includes('raise') && has('raise') && maxRaise >= minRaise) {
    return { action: 'raise', amount: clamp(minRaise) };
  }

  // Fallback: safest valid action
  if (has('check')) return { action: 'check' };
  if (has('call')) return { action: 'call' };
  return { action: 'fold' };
}

// ---------------------------------------------------------------------------
// AI CLI decision functions (async)
// ---------------------------------------------------------------------------

async function claudeDecide(turn) {
  const prompt = buildPokerPrompt(turn);
  try {
    const output = await runCLI('claude', ['-p', prompt], 30000);
    const first = output.split('\n').find(l => l.trim().length > 0) || output;
    log('Claude', COLORS.dim, `raw: "${first.slice(0, 80)}"`);
    return parseActionFromText(output, turn.validActions || [], turn.minRaise || 0, turn.maxRaise || 0);
  } catch (err) {
    log('Claude', COLORS.red, `CLI error: ${err.message.slice(0, 80)} — using fallback`);
    return parseActionFromText('', turn.validActions || [], turn.minRaise || 0, turn.maxRaise || 0);
  }
}

async function codexDecide(turn) {
  const prompt = buildPokerPrompt(turn);
  try {
    // Pass isolated CODEX_HOME so no skills (e.g. using-superpowers) are loaded
    const output = await runCLI('codex', ['exec', prompt], 120000, { CODEX_HOME: CODEX_DEMO_HOME });
    const first = output.split('\n').find(l => l.trim().length > 0) || output;
    log('Codex', COLORS.dim, `raw: "${first.slice(0, 80)}"`);
    return parseActionFromText(output, turn.validActions || [], turn.minRaise || 0, turn.maxRaise || 0);
  } catch (err) {
    log('Codex', COLORS.red, `CLI error: ${err.message.slice(0, 80)} — using fallback`);
    return parseActionFromText('', turn.validActions || [], turn.minRaise || 0, turn.maxRaise || 0);
  }
}

// ---------------------------------------------------------------------------
// Game loop for one agent
// ---------------------------------------------------------------------------

function runAgentLoop({ token, agentId, arenaId, name, decide, agentNames }) {
  return new Promise((resolve) => {
    let handCount = 0;
    let lastHandWinner = null;
    const submittedTurnIds = new Set();   // dedupe: don't submit same turn twice

    const socket = io(SOCKET_ORIGIN, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('connect', () => {
      socket.emit('agent:subscribe', { agentId, arenaId });
      log(name, name === 'Claude' ? COLORS.gold : COLORS.cyan, `socket connected → subscribed to arena`);
    });

    socket.on('connect_error', (err) => {
      log(name, COLORS.red, `socket error: ${err.message}`);
    });

    socket.on('agent:turn_request', async (payload) => {
      const turn = payload?.pendingTurn || payload;
      const turnId = turn?.id || turn?.turnId;
      if (!turnId) return;

      // Only act when it's this agent's turn
      const forAgentId = turn?.agentId || payload?.agentId;
      if (forAgentId && forAgentId !== agentId) return;

      // Dedupe — socket may replay the same turn
      if (submittedTurnIds.has(turnId)) return;
      submittedTurnIds.add(turnId);

      log(name, name === 'Claude' ? COLORS.gold : COLORS.cyan,
        `hand ${turn.handNumber || '?'} (${turn.state?.stage || '?'}) — deciding…`);

      const decision = await decide(turn);
      log(name, name === 'Claude' ? COLORS.gold : COLORS.cyan,
        `→ ${decision.action}${decision.amount ? ` ${decision.amount}` : ''}`);

      try {
        await requestJson({
          baseUrl: API_BASE,
          method: 'POST',
          routePath: `/arenas/${arenaId}/actions`,
          token,
          body: { agentId, turnId, action: decision.action, amount: decision.amount },
        });
      } catch (err) {
        log(name, COLORS.red, `submit failed: ${err.message}`);
      }
    });

    socket.on('agent:arena_event', (payload) => {
      const type = payload?.type || payload?.event;

      if (type === 'hand:end') {
        handCount++;
        const winnerAgentId = payload?.winners?.[0]?.agentId;
        const winnerName = (agentNames && winnerAgentId && agentNames[winnerAgentId]) || winnerAgentId?.slice(0, 8) || '?';
        lastHandWinner = winnerName;
        log(name, COLORS.dim, `hand ${handCount} complete — winner: ${winnerName}`);
      }

      if (type === 'arena:finished') {
        log(name, COLORS.green, `arena finished — match winner: ${lastHandWinner || '?'}`);
        resolve({ name, winner: lastHandWinner || '?' });
        socket.disconnect();
      }
    });

    socket.on('disconnect', () => {
      resolve({ name, disconnected: true });
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${COLORS.gold}╔═══════════════════════════════════╗`);
  console.log(`║   AGON ARENA  —  DEMO MATCH       ║`);
  console.log(`║   Claude  vs  Codex               ║`);
  console.log(`╚═══════════════════════════════════╝${COLORS.reset}\n`);

  // 1. Bootstrap both agents
  const [claude, codex] = await Promise.all([
    bootstrap('Claude', path.join(STATE_ROOT, 'claude')),
    bootstrap('Codex',  path.join(STATE_ROOT, 'codex')),
  ]);

  // 2. Claude creates the arena
  log('Arena', COLORS.gold, `creating arena (${MAX_HANDS} hands)…`);
  const arena = await requestJson({
    baseUrl: API_BASE,
    method: 'POST',
    routePath: '/arenas',
    token: claude.token,
    body: {
      name: `Claude vs Codex — Demo #${Math.floor(Math.random() * 1000)}`,
      mode: 'practice',
      maxHands: MAX_HANDS,
      startingStack: 5000,
      smallBlind: 10,
      bigBlind: 20,
      isSmoke: false,
      allowSparringReplacement: false,   // prevent auto-fill with sparring bot
    },
  });

  const arenaId = arena.id || arena?.arena?.id;
  if (!arenaId) { console.error('Failed to create arena', arena); process.exit(1); }

  console.log(`\n${COLORS.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Watch live: ${WEB_BASE}/markets/${arenaId}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}\n`);

  // 3. Agents join sequentially (avoid race with auto-advance)
  await requestJson({ baseUrl: API_BASE, method: 'POST', routePath: `/arenas/${arenaId}/join`, token: claude.token, body: { agentId: claude.agentId } });
  log('Arena', COLORS.gold, 'Claude seated');
  await requestJson({ baseUrl: API_BASE, method: 'POST', routePath: `/arenas/${arenaId}/join`, token: codex.token,  body: { agentId: codex.agentId } });
  log('Arena', COLORS.gold, 'Codex seated');

  // 4. Creator starts the game
  await requestJson({ baseUrl: API_BASE, method: 'POST', routePath: `/arenas/${arenaId}/start`, token: claude.token, body: {} });
  log('Arena', COLORS.gold, 'arena started — game loop running…');

  // 4. Run game loops in parallel
  const agentNames = { [claude.agentId]: 'Claude', [codex.agentId]: 'Codex' };
  const [result] = await Promise.all([
    runAgentLoop({ ...claude, arenaId, decide: claudeDecide, agentNames }),
    runAgentLoop({ ...codex,  arenaId, decide: codexDecide,  agentNames }),
  ]);

  console.log(`\n${COLORS.gold}══ MATCH COMPLETE ══${COLORS.reset}`);
  console.log(`Winner: ${COLORS.green}${result?.winner || '?'}${COLORS.reset}`);
  console.log(`Replay: ${WEB_BASE}/markets/${arenaId}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${COLORS.red}Fatal:${COLORS.reset}`, err.message);
  process.exit(1);
});
