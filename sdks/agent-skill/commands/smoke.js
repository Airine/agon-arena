const { parseArgs } = require('node:util');
const { spawnSync } = require('node:child_process');
const { wantsHelp, parseBaseOptions } = require('../lib/cli');
const { buildAgentAccessHeaders } = require('../lib/access');
const { requestJson } = require('../lib/api');
const { connectRuntimeSocket } = require('../lib/socket');
const { DEFAULT_API_BASE, DEFAULT_STATE_DIR, normalizeApiBase } = require('../lib/constants');
const { jsonResult } = require('../lib/state');
const { persistSession } = require('../lib/session');

function help(subcommand) {
  if (subcommand === 'full') {
    return [
      'Usage: agon smoke full [options]',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      '',
      'Options:',
      '  --api-base <url>              Public REST base URL to probe',
      '  --state-dir <path>            Read/write wallet and session files here',
      '  --role <name>                 Runtime role (primary or sparring)',
      '  --wallet-policy <policy>      (required) one of: require-existing | create-if-missing | import-private-key-env',
      '  --private-key-env <envvar>    Env var holding private key (required when --wallet-policy=import-private-key-env)',
      '  --decision-cmd <cmd>          Optional: shell command for turn decisions (enables step 9)',
      '',
      'Runs a 7-step protocol chain smoke test. Each step emits a JSON line:',
      '  { "step": N, "name": "...", "status": "PASS" | "FAIL" | "SKIP", "data": {...} }',
      '',
      'Steps:',
      '  1: health       — GET /health',
      '  2: wallet       — resolve wallet per --wallet-policy',
      '  3: access       — POST /auth/agent/access (bootstrap)',
      '  4: arena-list   — GET /arenas?status=waiting&mode=practice',
      '  5: arena-create — POST /arenas { name, mode: "practice", maxPlayers: 2, allowSparringReplacement: true, isSmoke: true }',
      '  6: arena-join   — POST /arenas/:id/join',
      '  7: runtime-get  — GET /arenas/:id/runtime?agentId=:agentId',
      '  8: socket       — connect socket, wait for agent:runtime_snapshot (15s timeout)',
      '  9: turn         — (if --decision-cmd) wait for turn_request, invoke subprocess, submit action',
      '',
      'Final line: { "ok": true|false, "state": "smoke_full_ok"|"smoke_full_fail", "steps": N, "passed": N, "failed": N }',
    ].join('\n');
  }

  return [
    'Usage: agon smoke [options]',
    '',
    `Defaults: --api-base ${DEFAULT_API_BASE}`,
    'Options:',
    '  --api-base <url>      Public REST base URL to probe',
    '',
    'This optional smoke test only checks the public health path. It does not play a hand.',
    '',
    'Subcommands:',
    '  full                  Run the full 7-step protocol chain smoke test',
  ].join('\n');
}

async function runHealth(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
    },
  });

  const apiBase = normalizeApiBase(values['api-base']);
  const result = await requestJson({
    baseUrl: apiBase,
    method: 'GET',
    routePath: '/health',
  });

  process.stdout.write(`${JSON.stringify(jsonResult({
    state: 'smoke_ok',
    artifacts: {},
    data: {
      apiBase,
      health: result,
    },
  }), null, 2)}\n`);
}

async function resolveWalletForSmoke(stateDir, role, values) {
  const policy = values['wallet-policy'];
  if (!policy) throw new Error('--wallet-policy is required for smoke full');

  const { createWallet, importWallet, getWalletForRole } = require('../lib/wallet');

  if (policy === 'create-if-missing') {
    const { record } = createWallet(stateDir, role, false);
    const { Wallet } = require('ethers');
    const wallet = new Wallet(record.private_key.startsWith('0x') ? record.private_key : `0x${record.private_key}`);
    return { record, wallet };
  }
  if (policy === 'require-existing') {
    return getWalletForRole(stateDir, role);
  }
  if (policy === 'import-private-key-env') {
    const envVar = values['private-key-env'];
    if (!envVar) throw new Error('--private-key-env required with import-private-key-env policy');
    const privateKey = process.env[envVar];
    if (!privateKey) throw new Error(`Env var ${envVar} is not set`);
    const result = await importWallet({ stateDir, role, privateKey });
    return result;
  }
  throw new Error(`Unknown --wallet-policy: ${policy}`);
}

function emitStep(step, name, status, data = {}) {
  process.stdout.write(`${JSON.stringify({ step, name, status, data })}\n`);
}

function extractPendingTurn(source) {
  if (!source || typeof source !== 'object') return null;
  const snapshot = source.snapshot || source;
  const pendingTurn = snapshot?.pendingTurn;
  if (pendingTurn && typeof pendingTurn === 'object') return pendingTurn;
  return null;
}

async function runFull(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('full')}\n`);
    return;
  }

  const { values } = parseBaseOptions(argv, {
    'wallet-policy': { type: 'string' },
    'private-key-env': { type: 'string' },
    'decision-cmd': { type: 'string' },
  });

  if (!values['wallet-policy']) {
    throw new Error('--wallet-policy is required for smoke full');
  }

  const apiBase = normalizeApiBase(values['api-base']);
  const stateDir = values['state-dir'];
  const role = values.role;

  const results = [];
  let arenaId = null;
  let agentId = null;
  let accessToken = null;

  function step(n, name, status, data = {}) {
    emitStep(n, name, status, data);
    results.push({ step: n, name, status });
  }

  // Step 1: health
  let healthOk = false;
  try {
    const health = await requestJson({ baseUrl: apiBase, method: 'GET', routePath: '/health' });
    healthOk = health && health.status === 'ok';
    step(1, 'health', healthOk ? 'PASS' : 'FAIL', { health });
  } catch (err) {
    step(1, 'health', 'FAIL', { error: err.message });
  }

  // Step 2: wallet
  let walletRecord = null;
  let wallet = null;
  try {
    const resolved = await resolveWalletForSmoke(stateDir, role, values);
    walletRecord = resolved.record;
    wallet = resolved.wallet;
    step(2, 'wallet', 'PASS', { address: walletRecord.address });
  } catch (err) {
    step(2, 'wallet', 'FAIL', { error: err.message });
  }

  // Step 3: access bootstrap
  let sessionOk = false;
  if (wallet) {
    try {
      const body = {
        agentCard: {
          name: 'Agon Smoke Runtime',
          description: 'Smoke test agent',
          capabilities: ['socket:runtime', 'rest:actions', 'texas_holdem'],
          metadata: { runtimeRole: role, isSmoke: true },
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
      const session = persistSession(stateDir, role, response);
      accessToken = session.access_token;
      agentId = session.agent?.id;
      sessionOk = Boolean(accessToken && agentId);
      step(3, 'access', sessionOk ? 'PASS' : 'FAIL', { agentId });
    } catch (err) {
      step(3, 'access', 'FAIL', { error: err.message });
    }
  } else {
    step(3, 'access', 'SKIP', { reason: 'wallet step failed' });
  }

  // Step 4: arena-list
  let arenaListOk = false;
  if (sessionOk) {
    try {
      const arenaListResult = await requestJson({
        baseUrl: apiBase,
        method: 'GET',
        routePath: '/arenas?status=waiting&mode=practice',
        token: accessToken,
      });
      const arenas = Array.isArray(arenaListResult) ? arenaListResult : arenaListResult?.arenas;
      arenaListOk = Array.isArray(arenas);
      step(4, 'arena-list', arenaListOk ? 'PASS' : 'FAIL', {
        count: Array.isArray(arenas) ? arenas.length : undefined,
      });
    } catch (err) {
      step(4, 'arena-list', 'FAIL', { error: err.message });
    }
  } else {
    step(4, 'arena-list', 'SKIP', { reason: 'access step failed' });
  }

  // Step 5: arena-create
  let arenaCreated = false;
  if (sessionOk) {
    try {
      const arena = await requestJson({
        baseUrl: apiBase,
        method: 'POST',
        routePath: '/arenas',
        token: accessToken,
        body: {
          name: 'Smoke Practice Arena',
          mode: 'practice',
          maxPlayers: 2,
          allowSparringReplacement: true,
          isSmoke: true,
        },
      });
      arenaId = arena?.id;
      arenaCreated = Boolean(arenaId);
      step(5, 'arena-create', arenaCreated ? 'PASS' : 'FAIL', {
        arenaId,
        spectate_url: arena?.spectate_url || null,
      });
    } catch (err) {
      step(5, 'arena-create', 'FAIL', { error: err.message });
    }
  } else {
    step(5, 'arena-create', 'SKIP', { reason: 'access step failed' });
  }

  // Step 6: arena-join
  let arenaJoined = false;
  if (arenaCreated && arenaId) {
    try {
      const joinResult = await requestJson({
        baseUrl: apiBase,
        method: 'POST',
        routePath: `/arenas/${arenaId}/join`,
        token: accessToken,
        body: { agentId },
      });
      arenaJoined = Boolean(joinResult);
      step(6, 'arena-join', arenaJoined ? 'PASS' : 'FAIL', {
        arenaId,
        spectate_url: joinResult.spectate_url || null,
        player_spectate_url: joinResult.player_spectate_url || null,
      });
    } catch (err) {
      step(6, 'arena-join', 'FAIL', { error: err.message });
    }
  } else {
    step(6, 'arena-join', 'SKIP', { reason: 'arena-create step failed' });
  }

  // Step 7: runtime-get
  let runtimeOk = false;
  let pendingTurn = null;
  if (arenaJoined && arenaId && agentId) {
    try {
      const runtime = await requestJson({
        baseUrl: apiBase,
        method: 'GET',
        routePath: `/arenas/${arenaId}/runtime?agentId=${agentId}`,
        token: accessToken,
      });
      pendingTurn = extractPendingTurn(runtime);
      runtimeOk = Boolean(runtime);
      step(7, 'runtime-get', runtimeOk ? 'PASS' : 'FAIL', { runtime });
    } catch (err) {
      step(7, 'runtime-get', 'FAIL', { error: err.message });
    }
  } else {
    step(7, 'runtime-get', 'SKIP', { reason: 'arena-join step failed' });
  }

  // Step 8: socket
  let socketOk = false;
  if (runtimeOk && accessToken && agentId && arenaId) {
    try {
      let snapshotPayload = null;
      await connectRuntimeSocket({
        apiBase,
        token: accessToken,
        agentId,
        arenaId,
        onEvent: ({ type, payload }) => {
          if (type === 'agent:runtime_snapshot') {
            snapshotPayload = payload;
            pendingTurn = extractPendingTurn(payload) || pendingTurn;
          }
        },
        once: 'agent:runtime_snapshot',
        timeoutMs: 15000,
      });
      socketOk = true;
      step(8, 'socket', 'PASS', { snapshot: snapshotPayload });
    } catch (err) {
      step(8, 'socket', 'FAIL', { error: err.message });
    }
  } else {
    step(8, 'socket', 'SKIP', { reason: 'runtime-get step failed' });
  }

  // Step 9: turn (optional — only if --decision-cmd supplied)
  if (values['decision-cmd']) {
    if (socketOk && accessToken && agentId && arenaId) {
      try {
        let turnRequest = pendingTurn;
        if (!turnRequest) {
          await connectRuntimeSocket({
            apiBase,
            token: accessToken,
            agentId,
            arenaId,
            onEvent: ({ type, payload }) => {
              if (type === 'agent:turn_request') turnRequest = payload;
              if (type === 'agent:runtime_snapshot') turnRequest = extractPendingTurn(payload) || turnRequest;
            },
            once: 'agent:runtime_snapshot',
            timeoutMs: 15000,
          });
        }
        if (!turnRequest) {
          await connectRuntimeSocket({
            apiBase,
            token: accessToken,
            agentId,
            arenaId,
            onEvent: ({ type, payload }) => {
              if (type === 'agent:turn_request') turnRequest = payload;
            },
            once: 'agent:turn_request',
            timeoutMs: 30000,
          });
        }
        if (turnRequest) {
          const cmdResult = spawnSync(values['decision-cmd'], {
            shell: true,
            input: JSON.stringify(turnRequest),
            encoding: 'utf8',
          });
          if (cmdResult.status !== 0) throw new Error(`decision-cmd exited ${cmdResult.status}: ${cmdResult.stderr}`);
          const action = JSON.parse(cmdResult.stdout.trim());
          const turnId = turnRequest.turnId || turnRequest.id;
          if (!turnId) throw new Error('turn_request did not include a turnId');
          const submitBody = { agentId, ...action, turnId };
          if (submitBody.expression !== undefined) submitBody.expression = String(submitBody.expression).slice(0, 10);
          if (submitBody.amount !== undefined) {
            const amount = Number.parseInt(submitBody.amount, 10);
            if (['raise', 'all_in'].includes(submitBody.action) && amount > 0) {
              submitBody.amount = amount;
            } else {
              delete submitBody.amount;
            }
          }
          await requestJson({
            baseUrl: apiBase,
            method: 'POST',
            routePath: `/arenas/${arenaId}/actions`,
            token: accessToken,
            body: submitBody,
          });
          step(9, 'turn', 'PASS', { action });
        } else {
          step(9, 'turn', 'FAIL', { error: 'No turn_request received' });
        }
      } catch (err) {
        step(9, 'turn', 'FAIL', { error: err.message });
      }
    } else {
      step(9, 'turn', 'SKIP', { reason: 'socket step failed' });
    }
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const allPassed = failed === 0;

  process.stdout.write(`${JSON.stringify({
    ok: allPassed,
    state: allPassed ? 'smoke_full_ok' : 'smoke_full_fail',
    steps: results.length,
    passed,
    failed,
  })}\n`);
}

async function run(argv) {
  if (argv[0] === 'full') return runFull(argv.slice(1));
  return runHealth(argv);
}

module.exports = {
  help,
  run,
};
