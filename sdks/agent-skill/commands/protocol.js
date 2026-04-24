'use strict';
const { parseArgs } = require('node:util');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

const { requestJson } = require('../lib/api');
const { buildAgentAccessHeaders } = require('../lib/access');
const { connectRuntimeSocket } = require('../lib/socket');
const { persistSession } = require('../lib/session');
const { loadSession, loadRunState, updateRunState, ensureStateLayout } = require('../lib/state');
const { getWalletForRole, createWallet, importWallet } = require('../lib/wallet');
const {
  DEFAULT_API_BASE,
  DEFAULT_STATE_DIR,
  SKILL_URL,
  normalizeApiBase,
  deriveSocketOrigin,
} = require('../lib/constants');
const { wantsHelp } = require('../lib/cli');
const { renderClearScreen } = require('../lib/tui');

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function help(subcommand) {
  if (subcommand === 'run') {
    return [
      'Usage: agon-agent protocol run [options]',
      '',
      'Executes the full onboarding protocol and stays alive handling turns.',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      '',
      'Options:',
      '  --wallet-policy <policy>       required: require-existing | create-if-missing | import-private-key-env',
      '  --private-key-env <envvar>     env var holding hex private key (for import-private-key-env)',
      '  --arena-id <id>                join specific arena (skips list/create)',
      '  --arena-tier <tier>            practice | serious (default: practice)',
      '  --create-if-none               create a new practice arena if none are joinable',
      '  --decision-cmd <cmd>           shell command for turn decisions (stdin: game state JSON, stdout: action JSON)',
      '  --tui                          render a private ASCII table to stderr while competing',
      '  --tui-log <path>               append private ASCII table frames to a log file instead of stderr',
      '  --no-color                     disable ANSI colors in TUI output',
      '  --plain                        plain TUI output (alias for no-color, no screen clearing)',
      '  --width <n>                    target TUI render width (default: 80)',
      '  --state-dir <path>             state directory (default: ./.agon-agent)',
      '  --api-base <url>               REST API base URL',
      '  --socket-origin <url>          Socket.IO origin (defaults to API origin)',
      '  --reconnect-max-ms <n>         max backoff for socket reconnect (default: 30000)',
      '  --turn-deadline-buffer-ms <n>  urgent turn submission buffer ms (default: 10000)',
    ].join('\n');
  }
  if (subcommand === 'resume') {
    return [
      'Usage: agon-agent protocol resume [options]',
      '',
      'Resumes a crashed/interrupted protocol run from run-state.json.',
      '',
      `Defaults: --api-base ${DEFAULT_API_BASE}, --state-dir ${DEFAULT_STATE_DIR}, --role primary`,
      '',
      'Options:',
      '  --wallet-policy <policy>   require-existing | create-if-missing | import-private-key-env',
      '  --private-key-env <envvar> env var holding hex private key',
      '  --decision-cmd <cmd>       shell command for turn decisions',
      '  --tui                      render a private ASCII table to stderr while competing',
      '  --tui-log <path>           append private ASCII table frames to a log file instead of stderr',
      '  --no-color                 disable ANSI colors in TUI output',
      '  --plain                    plain TUI output (alias for no-color, no screen clearing)',
      '  --width <n>                target TUI render width (default: 80)',
      '  --state-dir <path>         state directory',
      '  --api-base <url>           REST API base URL',
      '  --reconnect-max-ms <n>     max backoff for socket reconnect',
    ].join('\n');
  }
  return [
    'Usage: agon-agent protocol <subcommand> [options]',
    '',
    'Subcommands:',
    '  run      Execute full onboarding protocol and handle turns autonomously',
    '  resume   Resume from a crashed run using run-state.json',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultAgentCard(role) {
  return {
    name: role === 'sparring' ? 'Agon Sparring Runtime' : 'Agon Runtime',
    description: 'Autonomous runtime using protocol run.',
    capabilities: ['socket:runtime', 'rest:actions', 'texas_holdem'],
    metadata: { runtimeRole: role, skillSource: SKILL_URL },
  };
}

async function resolveWallet(stateDir, role, values) {
  const policy = values['wallet-policy'];
  if (policy === 'require-existing') {
    return getWalletForRole(stateDir, role);  // throws if missing
  }
  if (policy === 'create-if-missing') {
    createWallet(stateDir, role, false);  // false = don't overwrite existing
    return getWalletForRole(stateDir, role);
  }
  if (policy === 'import-private-key-env') {
    const envVar = values['private-key-env'];
    if (!envVar) throw new Error('--private-key-env required with import-private-key-env policy');
    const privateKey = process.env[envVar];
    if (!privateKey) throw new Error(`Env var ${envVar} is not set`);
    await importWallet({ stateDir, role, privateKey });
    return getWalletForRole(stateDir, role);
  }
  throw new Error(`Unknown --wallet-policy "${policy}". Use: require-existing | create-if-missing | import-private-key-env`);
}

async function bootstrapSession(apiBase, stateDir, role, walletResult) {
  const agentCard = defaultAgentCard(role);
  const body = { agentCard };
  const headers = await buildAgentAccessHeaders({ baseUrl: apiBase, wallet: walletResult.wallet, body });
  const response = await requestJson({ baseUrl: apiBase, method: 'POST', routePath: '/auth/agent/access', body, headers });
  return persistSession(stateDir, role, response);
}

async function refreshSession(apiBase, stateDir, role, session) {
  if (!session.refresh_token) throw new Error('No refresh token');
  const response = await requestJson({
    baseUrl: apiBase,
    method: 'POST',
    routePath: '/auth/token/refresh',
    body: { refreshToken: session.refresh_token },
  });
  return persistSession(stateDir, role, {
    ...response,
    user: session.user,
    agent: session.agent,
    created: session.created,
  });
}

function isNearExpiry(session, bufferMs = 5 * 60 * 1000) {
  if (!session.expires_at) return false;
  return session.expires_at - Date.now() < bufferMs;
}

async function ensureActiveSession(apiBase, stateDir, role, walletResult) {
  let session = loadSession(stateDir, role);

  if (!session.access_token) {
    session = await bootstrapSession(apiBase, stateDir, role, walletResult);
  } else if (isNearExpiry(session)) {
    try {
      session = await refreshSession(apiBase, stateDir, role, session);
    } catch {
      session = await bootstrapSession(apiBase, stateDir, role, walletResult);
    }
  }
  return session;
}

async function findOrCreateAndJoinArena(apiBase, stateDir, session, values) {
  // If specific arena ID given, skip list/create
  if (values['arena-id']) {
    await requestJson({
      baseUrl: apiBase,
      method: 'POST',
      routePath: `/arenas/${values['arena-id']}/join`,
      token: session.access_token,
      body: { agentId: session.agent.id },
    });
    return values['arena-id'];
  }

  // Internal compatibility: micro currently aliases practice until a real tier exists.
  const tierToMode = { practice: 'practice', micro: 'practice', serious: 'cash' };
  const mode = tierToMode[values['arena-tier']] || 'practice';

  // List joinable arenas
  const listResult = await requestJson({
    baseUrl: apiBase,
    method: 'GET',
    routePath: `/arenas?status=waiting&mode=${encodeURIComponent(mode)}`,
    token: session.access_token,
  });

  const arenas = listResult.arenas || [];
  const joinable = arenas.filter((a) =>
    Boolean(a.allowSparringReplacement) || (a.playerCount || 0) < (a.maxPlayers || 2),
  );

  let arenaId;
  if (joinable.length > 0) {
    arenaId = joinable[0].id;
  } else if (values['create-if-none']) {
    const created = await requestJson({
      baseUrl: apiBase,
      method: 'POST',
      routePath: '/arenas',
      token: session.access_token,
      body: { name: 'Protocol Practice Arena', mode: 'practice', maxPlayers: 2, allowSparringReplacement: true },
    });
    arenaId = created.id;
  } else {
    throw new Error('No joinable arenas found. Use --create-if-none to create one.');
  }

  await requestJson({
    baseUrl: apiBase,
    method: 'POST',
    routePath: `/arenas/${arenaId}/join`,
    token: session.access_token,
    body: { agentId: session.agent.id },
  });

  return arenaId;
}

function resolveDecisionTimeoutMs(payload) {
  const deadline = payload?.deadlineMs ?? payload?.deadline;
  if (typeof deadline === 'number' && Number.isFinite(deadline)) {
    return Math.max(5000, deadline - Date.now() - 3000);
  }
  return 25000;
}

function parseDecisionOutput(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some CLIs print banners or explanations despite prompting. Prefer the
    // last standalone JSON object so wrappers can still be forgiving.
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      if (!line.startsWith('{') || !line.endsWith('}')) continue;
      try {
        return JSON.parse(line);
      } catch {
        // keep looking
      }
    }
    return null;
  }
}

async function getDecision(payload, decisionCmd) {
  if (decisionCmd) {
    // Subprocess mode
    const timeoutMs = resolveDecisionTimeoutMs(payload);
    const result = spawnSync(decisionCmd, {
      input: JSON.stringify(payload) + '\n',
      encoding: 'utf8',
      timeout: timeoutMs,
      shell: true,
    });
    if (result.status !== 0 || !result.stdout?.trim()) {
      return { action: 'fold', amount: 0 };  // safe default
    }
    return parseDecisionOutput(result.stdout) || { action: 'fold', amount: 0 };
  }

  // STDIN mode: wait for one JSON line, 25s timeout → fold
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      rl.close();
      resolve({ action: 'fold', amount: 0 });
    }, 25000);

    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.once('line', (line) => {
      clearTimeout(timer);
      rl.close();
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ action: 'fold', amount: 0 });
      }
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function turnFromEventPayload(payload) {
  const turn = payload?.pendingTurn || payload;
  if (!turn || typeof turn !== 'object') return null;
  return turn;
}

function decisionInputFromTurn(turn) {
  if (turn?.state) return turn;
  return {
    ...turn,
    deadlineMs: turn?.deadlineMs ?? turn?.deadline ?? null,
  };
}

function pendingDeadlineMs(pendingTurn) {
  const deadline = pendingTurn?.deadlineMs ?? pendingTurn?.deadline;
  return typeof deadline === 'number' && Number.isFinite(deadline) ? deadline : Infinity;
}

function createTuiWriter(values, agentId) {
  if (!values.tui && !values['tui-log']) return () => {};

  const writeToFile = values['tui-log']
    ? path.resolve(values['tui-log'])
    : null;

  if (writeToFile) {
    fs.mkdirSync(path.dirname(writeToFile), { recursive: true });
  }

  return (snapshotOrTurn) => {
    const plain = Boolean(values.plain);
    const width = Math.max(40, parseInt(values.width, 10) || 80);
    const frame = renderClearScreen(snapshotOrTurn, {
      mode: 'private',
      agentId,
      color: values['no-color'] || plain ? false : undefined,
      clear: writeToFile ? false : !plain,
      width,
    });
    if (writeToFile) {
      fs.appendFileSync(
        writeToFile,
        `\n# ${new Date().toISOString()}\n${frame}`,
        'utf8',
      );
      return;
    }
    process.stderr.write(frame);
  };
}

// ---------------------------------------------------------------------------
// Socket loop — shared between run and resume
// ---------------------------------------------------------------------------

async function runSocketLoop({
  apiBase,
  stateDir,
  socketOrigin,
  role,
  session: initialSession,
  arenaId,
  values,
  walletResultGetter,
  emitFn,
  tuiWriter,
}) {
  const reconnectMaxMs = parseInt(values['reconnect-max-ms']) || 30000;
  const turnDeadlineBufferMs = parseInt(values['turn-deadline-buffer-ms']) || 10000;
  let retryDelayMs = 1000;
  let session = initialSession;
  let finished = false;

  while (!finished) {
    try {
      await connectRuntimeSocket({
        apiBase,
        socketOrigin,
        token: session.access_token,
        agentId: session.agent.id,
        arenaId,
        once: 'none',
        onEvent: async (event) => {
          if (finished) return;

          if (event.type === 'agent:turn_request') {
            const turn = turnFromEventPayload(event.payload);
            if (!turn) return;
            const turnId = turn.turnId || turn.id;
            const deadline = turn.deadlineMs ?? turn.deadline ?? null;
            if (!turnId) return;
            updateRunState(stateDir, { pending_turn: { turnId, deadline } });
            tuiWriter?.(turn);

            const decision = await getDecision(decisionInputFromTurn(turn), values['decision-cmd']);

            const submitPayload = { agentId: session.agent.id, turnId, action: decision.action };
            if (decision.amount !== undefined) submitPayload.amount = decision.amount;
            if (decision.expression !== undefined) submitPayload.expression = String(decision.expression).slice(0, 10);

            try {
              await requestJson({
                baseUrl: apiBase,
                method: 'POST',
                routePath: `/arenas/${arenaId}/actions`,
                token: session.access_token,
                body: submitPayload,
              });
              updateRunState(stateDir, { pending_turn: null, last_submitted_turn_id: turnId });
              emitFn('action_submitted', { arenaId, turnId, action: decision.action });
            } catch (submitErr) {
              // 409 = already submitted (ok), 410 = turn missed (ok)
              if (!submitErr.message?.includes('409') && !submitErr.message?.includes('410')) {
                // 401: refresh and retry once
                if (submitErr.message?.includes('401')) {
                  const walletResult = await walletResultGetter().catch(() => null);
                  session = await refreshSession(apiBase, stateDir, role, session).catch(async () => {
                    if (walletResult) return bootstrapSession(apiBase, stateDir, role, walletResult);
                    throw submitErr;
                  });
                  await requestJson({
                    baseUrl: apiBase,
                    method: 'POST',
                    routePath: `/arenas/${arenaId}/actions`,
                    token: session.access_token,
                    body: submitPayload,
                  }).catch(() => {});  // best effort retry
                }
              }
            }
          } else if (event.type === 'agent:lob_turn_request') {
            // LOB market-making arena turn
            const req = event.payload;
            const { turnId, deadlineMs } = req;
            updateRunState(stateDir, { pending_turn: { turnId, deadline: deadlineMs } });

            const decision = await getDecision(
              { turnId, deadline: deadlineMs, snapshot: req },
              values['decision-cmd'],
            );

            // Normalize: decision-cmd may return {type,price,qty} or fall back to pass
            const lobAction = decision.type
              ? decision
              : { type: 'pass' };

            try {
              await requestJson({
                baseUrl: apiBase,
                method: 'POST',
                routePath: `/arenas/${arenaId}/lob-actions`,
                token: session.access_token,
                body: { agentId: session.agent.id, turnId, action: lobAction },
              });
              updateRunState(stateDir, { pending_turn: null, last_submitted_turn_id: turnId });
              emitFn('action_submitted', { arenaId, turnId, action: lobAction.type });
            } catch (submitErr) {
              if (!submitErr.message?.includes('409') && !submitErr.message?.includes('410')) {
                if (submitErr.message?.includes('401')) {
                  const walletResult = await walletResultGetter().catch(() => null);
                  session = await refreshSession(apiBase, stateDir, role, session).catch(async () => {
                    if (walletResult) return bootstrapSession(apiBase, stateDir, role, walletResult);
                    throw submitErr;
                  });
                  await requestJson({
                    baseUrl: apiBase,
                    method: 'POST',
                    routePath: `/arenas/${arenaId}/lob-actions`,
                    token: session.access_token,
                    body: { agentId: session.agent.id, turnId, action: lobAction },
                  }).catch(() => {});  // best effort retry
                }
              }
            }
          } else if (event.type === 'agent:runtime_snapshot') {
            tuiWriter?.(event.payload);
          } else if (event.type === 'agent:arena_event') {
            if (event.payload?.state) {
              tuiWriter?.({
                arenaId,
                agentId: session.agent.id,
                handId: event.payload.handId || null,
                handNumber: event.payload.handNumber || 0,
                privateState: event.payload.state,
                publicState: event.payload.state,
                pendingTurn: null,
                updatedAt: Date.now(),
              });
            }
            if (event.payload?.type === 'arena_finished' || event.payload?.type === 'arena:finished') {
              updateRunState(stateDir, { arena: { id: arenaId, status: 'finished' } });
              emitFn('arena_finished', { arenaId });
              finished = true;
              // Override SIGTERM so a test harness killing the process after
              // seeing 'arena_finished' on stdout does not change the exit code.
              // process.exit(0) fires on the next tick after stdout drains.
              process.on('SIGTERM', () => {});
              setImmediate(() => process.exit(0));
            }
          }
        },
      });

      // Socket resolved cleanly (e.g. once condition met)
      if (!finished) break;
    } catch (err) {
      if (finished) break;

      if (err.code === 'AGENT_AUTH_ERROR') {
        // Token rejected by server: refresh
        emitFn('reconnecting', { reason: 'auth_error' });
        try {
          session = await refreshSession(apiBase, stateDir, role, session);
        } catch {
          const walletResult = await walletResultGetter().catch(() => null);
          if (walletResult) {
            session = await bootstrapSession(apiBase, stateDir, role, walletResult);
          } else {
            throw err;
          }
        }
        retryDelayMs = 1000;
        continue;
      }

      // Network error: check for urgent turn
      const runState = loadRunState(stateDir);
      if (runState.pending_turn && pendingDeadlineMs(runState.pending_turn) - Date.now() < turnDeadlineBufferMs) {
        // Urgent: don't wait, try to submit immediately
        const { turnId, deadline } = runState.pending_turn;
        const decision = await getDecision({ turnId, deadline, snapshot: {} }, values['decision-cmd'])
          .catch(() => ({ action: 'fold', amount: 0 }));
        const submitPayload = { agentId: session.agent.id, turnId, action: decision.action };
        if (decision.amount !== undefined) submitPayload.amount = decision.amount;
        if (decision.expression !== undefined) submitPayload.expression = String(decision.expression).slice(0, 10);
        requestJson({
          baseUrl: apiBase,
          method: 'POST',
          routePath: `/arenas/${arenaId}/actions`,
          token: session.access_token,
          body: submitPayload,
        }).catch(() => {});  // best effort
        retryDelayMs = 1000;
      } else {
        emitFn('reconnecting', { reason: err.message, retryIn: retryDelayMs });
        await sleep(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, reconnectMaxMs);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// protocol run
// ---------------------------------------------------------------------------

async function runProtocol(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('run')}\n`);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
      'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
      'socket-origin': { type: 'string' },
      role: { type: 'string', default: 'primary' },
      'wallet-policy': { type: 'string', default: 'require-existing' },
      'private-key-env': { type: 'string' },
      'arena-id': { type: 'string' },
      'arena-tier': { type: 'string', default: 'practice' },
      'create-if-none': { type: 'boolean', default: false },
      'decision-cmd': { type: 'string' },
      tui: { type: 'boolean', default: false },
      'tui-log': { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      plain: { type: 'boolean', default: false },
      width: { type: 'string', default: '80' },
      'reconnect-max-ms': { type: 'string', default: '30000' },
      'turn-deadline-buffer-ms': { type: 'string', default: '10000' },
    },
  });

  const apiBase = normalizeApiBase(values['api-base']);
  const stateDir = values['state-dir'];
  const socketOrigin = values['socket-origin'] || deriveSocketOrigin(apiBase);
  const role = values.role;

  ensureStateLayout(stateDir);

  function emit(state, data = {}) {
    process.stdout.write(JSON.stringify({ ok: true, state, data }) + '\n');
  }

  // Step 1: Resolve wallet
  const walletResult = await resolveWallet(stateDir, role, values);
  updateRunState(stateDir, { wallet: 'resolved' });
  emit('wallet_resolved', { address: walletResult.record.address });

  // Step 2: Ensure active session
  let session = await ensureActiveSession(apiBase, stateDir, role, walletResult);
  updateRunState(stateDir, { session: 'active' });
  emit('session_ready', { agentId: session.agent?.id });

  // Step 3: Find/join arena
  const arenaId = await findOrCreateAndJoinArena(apiBase, stateDir, session, values);
  updateRunState(stateDir, { arena: { id: arenaId, status: 'waiting' } });
  emit('arena_joined', { arenaId });

  // Step 4: Sync runtime
  const runtimeResult = await requestJson({
    baseUrl: apiBase,
    method: 'GET',
    routePath: `/arenas/${arenaId}/runtime?agentId=${encodeURIComponent(session.agent.id)}`,
    token: session.access_token,
  });
  updateRunState(stateDir, { runtime: 'synced', arena: { id: arenaId, status: 'active' } });
  emit('runtime_synced', { arenaId });
  emit('competing', { arenaId });

  // Wallet getter for reconnection scenarios
  const walletResultGetter = () => getWalletForRole(stateDir, role);
  const tuiWriter = createTuiWriter(values, session.agent.id);
  if (runtimeResult.snapshot) tuiWriter(runtimeResult.snapshot);

  // Step 5+: Socket loop
  await runSocketLoop({
    apiBase,
    stateDir,
    socketOrigin,
    role,
    session,
    arenaId,
    values,
    walletResultGetter,
    emitFn: emit,
    tuiWriter,
  });
}

// ---------------------------------------------------------------------------
// protocol resume
// ---------------------------------------------------------------------------

async function resumeProtocol(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(`${help('resume')}\n`);
    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
      'state-dir': { type: 'string', default: DEFAULT_STATE_DIR },
      'socket-origin': { type: 'string' },
      role: { type: 'string', default: 'primary' },
      'wallet-policy': { type: 'string', default: 'require-existing' },
      'private-key-env': { type: 'string' },
      'decision-cmd': { type: 'string' },
      tui: { type: 'boolean', default: false },
      'tui-log': { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      plain: { type: 'boolean', default: false },
      width: { type: 'string', default: '80' },
      'reconnect-max-ms': { type: 'string', default: '30000' },
      'turn-deadline-buffer-ms': { type: 'string', default: '10000' },
    },
  });

  const apiBase = normalizeApiBase(values['api-base']);
  const stateDir = values['state-dir'];
  const runState = loadRunState(stateDir);

  // If run-state is missing or corrupt, fall back to full protocol run
  if (!runState.arena?.id || !runState.session) {
    process.stdout.write(JSON.stringify({ ok: true, state: 'resume_fallback', data: { reason: 'no_run_state' } }) + '\n');
    return runProtocol([
      ...argv,
    ]);
  }

  const session = loadSession(stateDir, values.role);
  const arenaId = runState.arena.id;

  // Refresh token if needed
  let activeSession = session;
  if (isNearExpiry(session)) {
    activeSession = await refreshSession(apiBase, stateDir, values.role, session)
      .catch(async () => {
        const walletResult = await resolveWallet(stateDir, values.role, values).catch(() => null);
        if (walletResult) return bootstrapSession(apiBase, stateDir, values.role, walletResult);
        throw new Error('Token expired and no wallet for re-bootstrap.');
      });
  }

  // Sync runtime, check lastProcessedTurnId
  const runtimeResult = await requestJson({
    baseUrl: apiBase,
    method: 'GET',
    routePath: `/arenas/${arenaId}/runtime?agentId=${encodeURIComponent(activeSession.agent.id)}`,
    token: activeSession.access_token,
  });

  const lastProcessedTurnId = runtimeResult.lastProcessedTurnId || null;
  const pendingTurn = runState.pending_turn;

  if (pendingTurn && pendingTurn.turnId !== lastProcessedTurnId) {
    // Turn was not processed: resubmit
    const decision = await getDecision(
      { turnId: pendingTurn.turnId, deadline: pendingTurn.deadline, snapshot: runtimeResult.snapshot || {} },
      values['decision-cmd'],
    ).catch(() => ({ action: 'fold', amount: 0 }));

    const submitPayload = { agentId: activeSession.agent.id, turnId: pendingTurn.turnId, action: decision.action };
    if (decision.amount !== undefined) submitPayload.amount = decision.amount;
    if (decision.expression !== undefined) submitPayload.expression = String(decision.expression).slice(0, 10);

    await requestJson({
      baseUrl: apiBase,
      method: 'POST',
      routePath: `/arenas/${arenaId}/actions`,
      token: activeSession.access_token,
      body: submitPayload,
    }).catch((err) => {
      // 409 = already submitted, 410 = missed — both ok for resume
      if (!err.message?.includes('409') && !err.message?.includes('410')) throw err;
    });
  }

  process.stdout.write(JSON.stringify({ ok: true, state: 'resumed', data: { arenaId } }) + '\n');

  // Re-enter the socket loop via protocol run with --arena-id
  return runProtocol([
    `--api-base=${apiBase}`,
    `--state-dir=${stateDir}`,
    `--wallet-policy=${values['wallet-policy'] || 'require-existing'}`,
    ...(values['private-key-env'] ? [`--private-key-env=${values['private-key-env']}`] : []),
    `--arena-id=${arenaId}`,
    ...(values['decision-cmd'] ? [`--decision-cmd=${values['decision-cmd']}`] : []),
    ...(values.tui ? ['--tui'] : []),
    ...(values['tui-log'] ? [`--tui-log=${values['tui-log']}`] : []),
    ...(values['no-color'] ? ['--no-color'] : []),
    ...(values.plain ? ['--plain'] : []),
    ...(values.width ? [`--width=${values.width}`] : []),
    `--reconnect-max-ms=${values['reconnect-max-ms']}`,
    `--turn-deadline-buffer-ms=${values['turn-deadline-buffer-ms']}`,
  ]);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function run(subcommand, argv) {
  if (!subcommand || wantsHelp(argv)) {
    process.stdout.write(`${help(subcommand)}\n`);
    return;
  }
  if (subcommand === 'run') return runProtocol(argv);
  if (subcommand === 'resume') return resumeProtocol(argv);
  throw new Error(`Unknown protocol subcommand "${subcommand}".`);
}

module.exports = { help, run };
