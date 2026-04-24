import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

export function readTurnFromStdin() {
  const raw = readStdin().trim();
  if (!raw) throw new Error('No turn JSON received on stdin');
  const parsed = JSON.parse(raw);
  return parsed.pendingTurn || parsed.snapshot?.pendingTurn || parsed;
}

function rankValue(rank) {
  return {
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
  }[String(rank).toUpperCase()] ?? 0;
}

function estimateHandStrength(holeCards, communityCards) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) return 0.3;
  const r1 = rankValue(holeCards[0]?.rank);
  const r2 = rankValue(holeCards[1]?.rank);
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const paired = r1 === r2;
  const suited = holeCards[0]?.suit === holeCards[1]?.suit;

  let score = (high + low) / 28;
  if (paired) score += 0.3;
  if (suited) score += 0.05;
  if (high - low <= 2 && !paired) score += 0.05;

  if (Array.isArray(communityCards) && communityCards.length > 0) {
    const allRanks = [...holeCards, ...communityCards].map((card) => rankValue(card?.rank));
    const rankCounts = new Map();
    for (const rank of allRanks) {
      rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
    }
    const maxCount = Math.max(...rankCounts.values());
    if (maxCount >= 4) score = 0.95;
    else if (maxCount === 3) score = Math.max(score, 0.75);
    else if (maxCount === 2) score = Math.max(score, 0.55);
  }

  return Math.min(score, 1);
}

function clampRaise(amount, turn) {
  const minRaise = Number(turn.minRaise ?? turn.state?.minRaise ?? 0);
  const maxRaise = Number(turn.maxRaise ?? minRaise);
  if (!Number.isFinite(amount)) return minRaise;
  return Math.min(Math.max(Math.round(amount), minRaise), maxRaise);
}

export function makeHeuristicDecision(turn) {
  const validActions = turn.validActions || [];
  const state = turn.state || {};
  const me = (state.players || []).find((player) => player.agentId === turn.agentId);
  const holeCards = me?.cards || [];
  const strength = estimateHandStrength(holeCards, state.communityCards || []);
  const bigBlind = Number(state.bigBlindAmount || 20);
  const stack = Number(me?.stack || 0);
  const callAmount = Number(turn.callAmount || 0);
  const minRaise = Number(turn.minRaise || 0);
  const maxRaise = Number(turn.maxRaise || 0);
  const shortStack = stack > 0 && stack <= bigBlind * 6;
  const narrowRaiseWindow = maxRaise > 0 && maxRaise - minRaise <= bigBlind * 3;

  if (validActions.includes('all_in') && (callAmount >= stack || shortStack || narrowRaiseWindow)) {
    return { action: 'all_in', expression: strength > 0.7 ? '🔥' : '😬' };
  }

  if (strength > 0.8 && validActions.includes('raise')) {
    return { action: 'raise', amount: clampRaise((state.bigBlindAmount || 20) * 3, turn), expression: '😎' };
  }
  if (strength > 0.8 && validActions.includes('all_in')) return { action: 'all_in', expression: '🔥' };
  if (strength > 0.5 && validActions.includes('call')) return { action: 'call', expression: '🙂' };
  if (validActions.includes('check')) return { action: 'check', expression: '🧊' };
  if (strength > 0.35 && validActions.includes('call')) return { action: 'call', expression: '🤔' };
  return { action: 'fold', expression: '🙃' };
}

function formatCard(card) {
  if (!card) return '??';
  const suits = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };
  return `${card.rank || '?'}${suits[card.suit] || card.suit || '?'}`;
}

export function buildPrompt(turn) {
  const state = turn.state || {};
  const me = (state.players || []).find((player) => player.agentId === turn.agentId) || {};
  const holeCards = (me.cards || []).map(formatCard).join(' ') || '(hidden)';
  const community = (state.communityCards || []).map(formatCard).join(' ') || '(none)';
  const pot = (state.pots || []).reduce((sum, potInfo) => sum + (Number(potInfo.amount) || 0), 0);
  const lastAction = state.lastAction
    ? `${state.lastAction.agentId}: ${state.lastAction.action?.type || '?'} ${state.lastAction.action?.amount || ''}`.trim()
    : 'none';

  return [
    'You are playing Texas Holdem poker as an autonomous Agon Arena agent.',
    'Choose exactly one legal action.',
    '',
    `Hand: ${turn.handNumber ?? state.handNumber ?? '?'}`,
    `Stage: ${state.stage || '?'}`,
    `Your hole cards: ${holeCards}`,
    `Community cards: ${community}`,
    `Pot: ${pot}`,
    `Your stack: ${me.stack ?? '?'}`,
    `To call: ${turn.callAmount ?? 0}`,
    `Raise range: ${turn.minRaise ?? 0}..${turn.maxRaise ?? 0}`,
    `Valid actions: ${(turn.validActions || []).join(', ')}`,
    `Last action: ${lastAction}`,
    '',
    'Output exactly one JSON object and no explanation.',
    'Allowed shape: {"action":"fold|check|call|raise|all_in","amount":number_optional,"expression":"emoji_optional"}',
  ].join('\n');
}

export function parseDecisionText(text, turn) {
  const trimmed = String(text || '').trim();
  const validActions = turn.validActions || [];
  if (trimmed) {
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      if (!line.startsWith('{') || !line.endsWith('}')) continue;
      try {
        const parsed = JSON.parse(line);
        if (validActions.includes(parsed.action)) {
          if (parsed.action === 'raise') parsed.amount = clampRaise(parsed.amount, turn);
          return parsed;
        }
      } catch {
        // keep looking
      }
    }
  }

  const lower = trimmed.toLowerCase();
  const raiseMatch = lower.match(/\braise\s+(\d+)/);
  if (raiseMatch && validActions.includes('raise')) {
    return { action: 'raise', amount: clampRaise(Number(raiseMatch[1]), turn) };
  }
  for (const action of ['fold', 'check', 'call', 'all_in', 'raise']) {
    if (lower.includes(action) && validActions.includes(action)) {
      return action === 'raise'
        ? { action: 'raise', amount: clampRaise(turn.minRaise, turn) }
        : { action };
    }
  }
  return makeHeuristicDecision(turn);
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0;
}

function runShell(command, input, timeoutMs, env = {}) {
  const result = spawnSync(command, {
    input,
    encoding: 'utf8',
    shell: true,
    timeout: timeoutMs,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0 || !result.stdout?.trim()) {
    throw new Error(result.stderr?.trim() || `command failed: ${command}`);
  }
  return result.stdout;
}

function timeoutFromEnv(name, fallbackMs) {
  const value = Number(process.env[name] || '');
  return Number.isFinite(value) && value > 0 ? value : fallbackMs;
}

export function runCliDecision(kind, turn) {
  const prompt = buildPrompt(turn);
  if (kind === 'claude') {
    if (!commandExists('claude')) return makeHeuristicDecision(turn);
    return parseDecisionText(runShell('claude -p', prompt, timeoutFromEnv('AGON_CLAUDE_TIMEOUT_MS', 8000)), turn);
  }
  if (kind === 'codex') {
    if (!commandExists('codex')) return makeHeuristicDecision(turn);
    const codexHome = process.env.CODEX_DEMO_HOME || path.join(os.tmpdir(), 'agon-codex-home');
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, 'config.toml');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, 'model = "gpt-5.4"\nmodel_reasoning_effort = "low"\n', 'utf8');
    }
    const escapedPrompt = JSON.stringify(prompt);
    return parseDecisionText(
      runShell(`codex exec ${escapedPrompt}`, '', timeoutFromEnv('AGON_CODEX_TIMEOUT_MS', 8000), { CODEX_HOME: codexHome }),
      turn,
    );
  }
  if (kind === 'hermes') {
    const custom = process.env.HERMES_CMD;
    if (custom) return parseDecisionText(runShell(custom, prompt, timeoutFromEnv('AGON_HERMES_TIMEOUT_MS', 8000)), turn);
    if (!commandExists('hermes')) return makeHeuristicDecision(turn);
    return parseDecisionText(runShell('hermes -p', prompt, timeoutFromEnv('AGON_HERMES_TIMEOUT_MS', 8000)), turn);
  }
  return makeHeuristicDecision(turn);
}

export function printDecision(decision) {
  process.stdout.write(`${JSON.stringify(decision)}\n`);
}
