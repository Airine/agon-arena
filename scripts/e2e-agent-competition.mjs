#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const { buildAgentAccessHeaders } = require('../sdks/agent-skill/lib/access');
const { requestJson } = require('../sdks/agent-skill/lib/api');
const { normalizeApiBase } = require('../sdks/agent-skill/lib/constants');
const { persistSession } = require('../sdks/agent-skill/lib/session');
const { createWallet, getWalletForRole } = require('../sdks/agent-skill/lib/wallet');

const cliPath = path.join(repoRoot, 'sdks/agent-skill/bin/agon.js');
const examplesDir = path.join(repoRoot, 'sdks/agent-skill/examples');

function parseArgs(argv) {
  const values = {
    apiBase: 'http://localhost:4000',
    webBase: 'http://localhost:3000',
    agents: 4,
    hands: 15,
    wrappers: ['claude', 'codex', 'hermes', 'heuristic'],
    outDir: path.join(os.tmpdir(), 'agon-e2e'),
    timeoutMs: 5 * 60 * 1000,
    tui: true,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === '--api-base') values.apiBase = next();
    else if (arg.startsWith('--api-base=')) values.apiBase = arg.slice('--api-base='.length);
    else if (arg === '--web-base') values.webBase = next();
    else if (arg.startsWith('--web-base=')) values.webBase = arg.slice('--web-base='.length);
    else if (arg === '--agents') values.agents = Number(next());
    else if (arg.startsWith('--agents=')) values.agents = Number(arg.slice('--agents='.length));
    else if (arg === '--hands') values.hands = Number(next());
    else if (arg.startsWith('--hands=')) values.hands = Number(arg.slice('--hands='.length));
    else if (arg === '--wrappers') values.wrappers = String(next()).split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg.startsWith('--wrappers=')) values.wrappers = arg.slice('--wrappers='.length).split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--out-dir') values.outDir = next();
    else if (arg.startsWith('--out-dir=')) values.outDir = arg.slice('--out-dir='.length);
    else if (arg === '--timeout-ms') values.timeoutMs = Number(next());
    else if (arg.startsWith('--timeout-ms=')) values.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    else if (arg === '--no-tui') values.tui = false;
    else if (arg === '--help' || arg === '-h') values.help = true;
    else throw new Error(`Unknown option "${arg}"`);
  }
  values.agents = Math.max(2, Math.min(Number(values.agents) || 4, 8));
  values.hands = Math.max(1, Number(values.hands) || 15);
  return values;
}

function help() {
  return [
    'Usage: node scripts/e2e-agent-competition.mjs [options]',
    '',
    'Runs a local multi-agent Texas Holdem competition through the public agon CLI.',
    '',
    'Options:',
    '  --api-base <url>       API base URL (default: http://localhost:4000)',
    '  --web-base <url>       Web base URL for report links (default: http://localhost:3000)',
    '  --agents <n>           Number of agents, 2-8 (default: 4)',
    '  --hands <n>            Max hands for the arena (default: 15)',
    '  --wrappers <list>      Comma list: claude,codex,hermes,heuristic',
    '  --out-dir <path>       Output directory (default: /tmp/agon-e2e)',
    '  --timeout-ms <n>       Match timeout (default: 300000)',
    '  --no-tui               Do not write per-agent TUI logs',
  ].join('\n');
}

function commandExists(command) {
  return spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).status === 0;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function resolveWrapper(requested) {
  const normalized = String(requested || 'heuristic').toLowerCase();
  if (normalized === 'claude' && commandExists('claude')) {
    return { requested: normalized, actual: 'claude', command: `bash ${shellQuote(path.join(examplesDir, 'decide-claude.sh'))}` };
  }
  if (normalized === 'codex' && commandExists('codex')) {
    return { requested: normalized, actual: 'codex', command: `bash ${shellQuote(path.join(examplesDir, 'decide-codex.sh'))}` };
  }
  if (normalized === 'hermes' && (process.env.HERMES_CMD || commandExists('hermes'))) {
    return { requested: normalized, actual: 'hermes', command: `bash ${shellQuote(path.join(examplesDir, 'decide-hermes.sh'))}` };
  }
  return {
    requested: normalized,
    actual: 'heuristic',
    command: `node ${shellQuote(path.join(examplesDir, 'decide-heuristic.mjs'))}`,
  };
}

function agentPlan(count, wrappers) {
  return Array.from({ length: count }, (_, index) => {
    const wrapper = resolveWrapper(wrappers[index % wrappers.length] || 'heuristic');
    return {
      index,
      role: `agent-${index + 1}`,
      name: `${wrapper.actual}-${index + 1}`,
      wrapper,
    };
  });
}

async function bootstrapAgent(apiBase, outDir, plan) {
  const stateDir = path.join(outDir, 'state', plan.role);
  fs.mkdirSync(stateDir, { recursive: true });
  createWallet(stateDir, 'primary', false);
  const { wallet } = getWalletForRole(stateDir, 'primary');

  const body = {
    agentCard: {
      name: plan.name,
      description: `Local e2e ${plan.wrapper.actual} agent`,
      capabilities: ['socket:runtime', 'rest:actions', 'texas_holdem'],
      metadata: {
        e2e: true,
        requestedWrapper: plan.wrapper.requested,
        actualWrapper: plan.wrapper.actual,
      },
    },
  };
  const headers = await buildAgentAccessHeaders({ baseUrl: apiBase, wallet, body });
  const response = await requestJson({
    baseUrl: apiBase,
    method: 'POST',
    routePath: '/auth/agent/access',
    body,
    headers,
  });
  const session = persistSession(stateDir, 'primary', response);
  return { ...plan, stateDir, session, token: session.access_token, agentId: session.agent.id };
}

function spawnProtocol(agent, apiBase, arenaId, outDir, tui) {
  const logsDir = path.join(outDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const stdoutPath = path.join(logsDir, `${agent.role}.jsonl`);
  const stderrPath = path.join(logsDir, `${agent.role}.stderr.log`);
  const tuiPath = path.join(logsDir, `${agent.role}.tui`);

  const args = [
    cliPath,
    'protocol',
    'run',
    '--wallet-policy=require-existing',
    `--api-base=${apiBase}`,
    `--state-dir=${agent.stateDir}`,
    `--arena-id=${arenaId}`,
    `--decision-cmd=${agent.wrapper.command}`,
    '--no-color',
  ];
  if (tui) args.push(`--tui-log=${tuiPath}`);

  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.agent = agent;
  child.stdoutPath = stdoutPath;
  child.stderrPath = stderrPath;
  child.states = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    fs.appendFileSync(stdoutPath, chunk, 'utf8');
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        child.states.push(parsed);
      } catch {
        // keep raw log only
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    fs.appendFileSync(stderrPath, chunk, 'utf8');
  });
  return child;
}

function waitForState(child, state, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (child.states.some((entry) => entry.state === state)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${child.agent.name} did not reach ${state}`));
      }
    }, 250);
    child.once('exit', (code) => {
      if (!child.states.some((entry) => entry.state === state)) {
        clearInterval(timer);
        reject(new Error(`${child.agent.name} exited before ${state} (code ${code})`));
      }
    });
  });
}

async function waitForArenaFinished(children, timeoutMs) {
  await Promise.race(children.map((child) => waitForState(child, 'arena_finished', timeoutMs)));
}

async function collectReportData(apiBase, arenaId, agents) {
  const [arena, snapshot, turns] = await Promise.all([
    requestJson({ baseUrl: apiBase, method: 'GET', routePath: `/arenas/${arenaId}` }).catch((error) => ({ error: error.message })),
    requestJson({ baseUrl: apiBase, method: 'GET', routePath: `/arenas/${arenaId}/snapshot` }).catch((error) => ({ error: error.message })),
    requestJson({ baseUrl: apiBase, method: 'GET', routePath: `/arenas/${arenaId}/turns?limit=200` }).catch((error) => ({ error: error.message, turns: [] })),
  ]);
  const traces = {};
  for (const agent of agents) {
    traces[agent.agentId] = await requestJson({
      baseUrl: apiBase,
      method: 'GET',
      routePath: `/arenas/${arenaId}/agents/${agent.agentId}/traces?limit=50`,
    }).catch((error) => ({ error: error.message, traces: [], total: 0 }));
  }
  return { arena, snapshot, turns, traces };
}

function finalPlayers(reportData) {
  const arenaSeats = reportData.arena?.seats || [];
  if (reportData.arena?.status === 'finished' && arenaSeats.length) return arenaSeats;

  const state = reportData.snapshot?.snapshot?.gameState;
  if (state?.players?.length) return state.players;
  return arenaSeats;
}

function writeReport({ outDir, apiBase, webBase, arenaId, agents, children, reportData, finishedArena, startedAt, endedAt }) {
  const players = finalPlayers(reportData);
  const finalStackTotal = players.reduce((sum, player) => sum + (Number(player.stack ?? player.currentStack) || 0), 0);
  const expectedStackTotal = agents.length * (Number(reportData.arena?.startingStack) || 0);
  const turns = reportData.turns?.turns || [];
  const traceTotals = agents.map((agent) => reportData.traces[agent.agentId]?.total || 0);
  const timeoutTraces = agents.flatMap((agent) => reportData.traces[agent.agentId]?.traces || [])
    .filter((trace) => trace.errorType === 'timeout');
  const stderrText = children.map((child) => {
    try { return fs.readFileSync(child.stderrPath, 'utf8'); } catch { return ''; }
  }).join('\n');

  const checks = [
    ['all agents registered', agents.every((agent) => agent.agentId)],
    ['arena reached a terminal state', finishedArena.status === 'finished' || finishedArena.status === 'cancelled'],
    ['arena finished successfully', finishedArena.status === 'finished'],
    ['each agent submitted at least one accepted action', agents.every((agent) => turns.some((turn) => turn.agentId === agent.agentId && turn.action))],
    ['no agent timeout traces', timeoutTraces.length === 0],
    ['no visible 409/410 submit errors in agent logs', !/\b(409|410)\b/.test(stderrText)],
    ['final stack total conserved', expectedStackTotal > 0 && finalStackTotal === expectedStackTotal],
  ];

  const lines = [
    '# Agon Arena E2E Agent Competition Report',
    '',
    `- Arena: ${arenaId}`,
    `- API: ${apiBase}`,
    `- Web: ${webBase}/markets/${arenaId}`,
    `- Started: ${new Date(startedAt).toISOString()}`,
    `- Finished: ${new Date(endedAt).toISOString()}`,
    `- Duration: ${Math.round((endedAt - startedAt) / 1000)}s`,
    '',
    '## Checklist',
    '',
    ...checks.map(([label, ok]) => `- [${ok ? 'x' : ' '}] ${label}`),
    '',
    '## Agents',
    '',
    '| Agent | Requested | Actual | Agent ID | Actions | Traces | TUI |',
    '|---|---:|---:|---|---:|---:|---|',
    ...agents.map((agent, index) => {
      const actionCount = turns.filter((turn) => turn.agentId === agent.agentId && turn.action).length;
      const child = children[index];
      return `| ${agent.name} | ${agent.wrapper.requested} | ${agent.wrapper.actual} | ${agent.agentId} | ${actionCount} | ${traceTotals[index]} | ${child?.stdoutPath ? path.basename(child.stdoutPath).replace('.jsonl', '.tui') : ''} |`;
    }),
    '',
    '## Final Stacks',
    '',
    `Expected total: ${expectedStackTotal}`,
    `Observed total: ${finalStackTotal}`,
    '',
    ...players.map((player) => `- ${player.agentName || player.name || player.agentId}: ${player.stack ?? player.currentStack ?? '?'}`),
    '',
    '## Recent Turns',
    '',
    ...turns.slice(-20).map((turn) => `- hand ${turn.turnNumber}: ${turn.agentId} -> ${JSON.stringify(turn.action)}`),
    '',
    '## Agent Error Traces',
    '',
    ...agents.flatMap((agent) => {
      const agentTraces = reportData.traces[agent.agentId]?.traces || [];
      if (agentTraces.length === 0) return [`- ${agent.name}: none`];
      return agentTraces.map((trace) => `- ${agent.name}: ${trace.errorType} ${trace.turnId || ''} ${JSON.stringify(trace.details || {})}`);
    }),
    '',
    '## Artifacts',
    '',
    `- Logs: ${path.join(outDir, 'logs')}`,
  ];

  const reportPath = path.join(outDir, 'report.md');
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  return { reportPath, checks };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  const apiBase = normalizeApiBase(options.apiBase);
  fs.rmSync(options.outDir, { recursive: true, force: true });
  fs.mkdirSync(options.outDir, { recursive: true });
  fs.mkdirSync(path.join(options.outDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(options.outDir, 'state'), { recursive: true });

  const startedAt = Date.now();
  const plans = agentPlan(options.agents, options.wrappers);
  process.stdout.write(`Bootstrapping ${plans.length} agents against ${apiBase}\n`);
  const agents = [];
  for (const plan of plans) {
    const agent = await bootstrapAgent(apiBase, options.outDir, plan);
    agents.push(agent);
    process.stdout.write(`- ${agent.name}: ${agent.agentId} (${agent.wrapper.requested} -> ${agent.wrapper.actual})\n`);
  }

  const creator = agents[0];
  const arena = await requestJson({
    baseUrl: apiBase,
    method: 'POST',
    routePath: '/arenas',
    token: creator.token,
    body: {
      name: `E2E CLI Agent Competition #${Math.floor(Math.random() * 10000)}`,
      mode: 'practice',
      maxPlayers: agents.length,
      maxHands: options.hands,
      startingStack: 1000,
      smallBlind: 10,
      bigBlind: 20,
      isSmoke: false,
      allowSparringReplacement: false,
    },
  });
  const arenaId = arena.id || arena?.arena?.id;
  if (!arenaId) throw new Error(`Arena create response did not include id: ${JSON.stringify(arena)}`);
  process.stdout.write(`Arena created: ${arenaId}\n`);
  process.stdout.write(`Watch: ${options.webBase}/markets/${arenaId}\n`);

  const children = [];
  try {
    for (const agent of agents) {
      const child = spawnProtocol(agent, apiBase, arenaId, options.outDir, options.tui);
      children.push(child);
      await waitForState(child, 'competing', 45000);
    }
    process.stdout.write('All agents joined and subscribed. Starting arena...\n');
    await requestJson({
      baseUrl: apiBase,
      method: 'POST',
      routePath: `/arenas/${arenaId}/start`,
      token: creator.token,
      body: {},
    });

    await waitForArenaFinished(children, options.timeoutMs);
    const finishedArena = await requestJson({ baseUrl: apiBase, method: 'GET', routePath: `/arenas/${arenaId}` });
    const reportData = await collectReportData(apiBase, arenaId, agents);
    const endedAt = Date.now();
    const { reportPath, checks } = writeReport({
      outDir: options.outDir,
      apiBase,
      webBase: options.webBase,
      arenaId,
      agents,
      children,
      reportData,
      finishedArena,
      startedAt,
      endedAt,
    });

    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM');
    }

    const failed = checks.filter(([, ok]) => !ok);
    process.stdout.write(`Report: ${reportPath}\n`);
    if (failed.length) {
      process.stdout.write(`Completed with ${failed.length} failed check(s).\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('All checks passed.\n');
    }
  } catch (error) {
    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM');
    }
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`E2E competition failed: ${error.message}\n`);
  process.exit(1);
});
