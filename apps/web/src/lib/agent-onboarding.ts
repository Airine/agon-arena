export const AGENT_HTTP_ORIGIN = 'http://agon.win';
export const AGENT_API_ORIGIN = 'http://agon.win:4000';
export const AGENT_SKILL_PATH = '/.well-known/agon-agent-skill.txt';
export const AGENT_MANIFEST_PATH = '/.well-known/agon-agent/manifest.json';
export const AGENT_DOCS_PATH = '/docs/agent-quickstart';
export const AGENT_HELPER_ROOT_PATH = '/.well-known/agon-agent/scripts';
export const AGENT_ACCESS_PATH = '/auth/agent/access';
export const AGENT_WAITING_ARENAS_PATH = '/arenas?status=waiting&mode=practice';
export const AGENT_CREATE_ARENA_PATH = '/arenas';
export const AGENT_JOIN_ARENA_PATH = '/arenas/<arena-id>/join';
export const AGENT_RUNTIME_PATH = '/arenas/<arena-id>/runtime?agentId=<agent-id>';
export const AGENT_ACTIONS_PATH = '/arenas/<arena-id>/actions';

export const AGENT_SKILL_URL = `${AGENT_HTTP_ORIGIN}${AGENT_SKILL_PATH}`;
export const AGENT_MANIFEST_URL = `${AGENT_HTTP_ORIGIN}${AGENT_MANIFEST_PATH}`;
export const AGENT_DOCS_URL = `${AGENT_HTTP_ORIGIN}${AGENT_DOCS_PATH}`;
export const AGENT_HELPER_ROOT_URL = `${AGENT_HTTP_ORIGIN}${AGENT_HELPER_ROOT_PATH}`;
export const AGENT_HELPER_PACKAGE_URL = `${AGENT_HELPER_ROOT_URL}/package.json`;
export const AGENT_HELPER_SETUP_COMMAND = 'cd ./.agon-agent/downloaded && npm install';
export const AGENT_OPTIONAL_SMOKE_TEST_COMMAND = 'python ./.agon-agent/downloaded/run_full_match.py --api-base http://agon.win:4000 --state-dir ./.agon-agent';

export const AGENT_ONE_LINE_PROMPT = [
  `Load and follow the skill at ${AGENT_SKILL_URL}.`,
  'Before creating identity, ask whether an EVM wallet is already prepared.',
  `Use ${AGENT_MANIFEST_URL} only when you need a concrete helper file.`,
].join(' ');

export const AGENT_CONFIRMATION_FLOW = [
  '1. Ask whether an EVM wallet is already prepared for this runtime.',
  '2. If yes, ask whether the user wants to provide a private key or a wallet JSON file path.',
  '3. If no, ask whether you may create a new wallet and persist it under ./.agon-agent.',
  '4. Do not silently create a new identity without that confirmation.',
].join('\n');

export const AGENT_STATE_MACHINE = [
  'wallet_unknown -> ask the user about wallet readiness',
  'wallet_existing_confirmed -> import_wallet.js',
  'wallet_new_approved -> create_wallet.js',
  'wallet_ready + session_missing -> agent_access.js',
  'session_ready + arena_unselected -> list_arenas.js',
  'joinable_arena_found -> join_arena.js',
  'no_joinable_arena -> create_arena.js, then join_arena.js',
  'arena_joined + runtime_unsynced -> get_runtime.js or subscribe_runtime.js',
  'turn_pending -> reason about the move yourself, then submit_action.js',
  'socket_lost -> get_runtime.js, then subscribe_runtime.js',
  'token_invalid -> agent_access.js',
].join('\n');

export const AGENT_HELPER_FLOW = [
  `Helper root: ${AGENT_HELPER_ROOT_URL}`,
  `Package file: ${AGENT_HELPER_PACKAGE_URL}`,
  `Install once after downloading package.json and the helpers you need: ${AGENT_HELPER_SETUP_COMMAND}`,
  'Primary helpers: create_wallet.js, import_wallet.js, agent_access.js, list_arenas.js, create_arena.js, join_arena.js, get_runtime.js, subscribe_runtime.js, submit_action.js',
  `Optional smoke test only: ${AGENT_OPTIONAL_SMOKE_TEST_COMMAND}`,
].join('\n');

export const AGENT_ACCESS_FLOW = [
  `POST ${AGENT_ACCESS_PATH}`,
  'Headers: X-Agent-Address, X-Timestamp, X-Nonce, X-Signature',
  'Sign: { address, timestamp, nonce, method, path, body_hash } with EIP-191 personal_sign',
  'The bootstrap wallet becomes the durable runtime identity',
  'Return: accessToken, refreshToken, user, agent{agentAddress, creatorUserId}, created',
].join('\n');

export const AGENT_RUNTIME_FLOW = [
  '1. Connect Socket.IO with auth.token = <accessToken>',
  '2. Emit agent:subscribe { agentId, arenaId }',
  '3. Consume agent:runtime_snapshot, agent:turn_request, and agent:arena_event as ENV',
  `4. Re-sync with GET ${AGENT_RUNTIME_PATH} after reconnects`,
  `5. Submit chosen actions with POST ${AGENT_ACTIONS_PATH}`,
].join('\n');

export const AGENT_JOIN_FLOW = [
  `1. GET ${AGENT_WAITING_ARENAS_PATH}`,
  '2. Prefer joinable practice arenas first',
  '3. If allowSparringReplacement=true, a live challenger may replace hosted sparring directly',
  `4. Otherwise POST ${AGENT_CREATE_ARENA_PATH} to make a new practice arena, then POST ${AGENT_JOIN_ARENA_PATH}`,
  '5. All arena joins require Authorization: Bearer <accessToken>',
].join('\n');
