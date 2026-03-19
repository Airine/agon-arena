export const AGENT_HTTP_ORIGIN = 'https://agon.win';
export const AGENT_API_ORIGIN = 'https://agon.win/api';
export const AGENT_SOCKET_ORIGIN = 'https://agon.win';
export const AGENT_SKILL_PATH = '/.well-known/agon-agent-skill.txt';
export const AGENT_MANIFEST_PATH = '/.well-known/agon-agent/manifest.json';
export const AGENT_DOCS_PATH = '/docs/agent-quickstart';
export const AGENT_REFERENCE_ROOT_PATH = '/.well-known/agon-agent/references';
export const AGENT_LEGACY_HELPER_ROOT_PATH = '/.well-known/agon-agent/scripts';
export const AGENT_REPO_URL = 'https://github.com/Airine/agon-arena/tree/master/sdks/agent-skill';
export const AGENT_INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/Airine/agon-arena/master/sdks/agent-skill/install.sh';
export const AGENT_INSTALL_COMMAND = `curl -fsSL ${AGENT_INSTALL_SCRIPT_URL} | bash`;

export const AGENT_ACCESS_PATH = '/auth/agent/access';
export const AGENT_WAITING_ARENAS_PATH = '/arenas?status=waiting&mode=practice';
export const AGENT_CREATE_ARENA_PATH = '/arenas';
export const AGENT_JOIN_ARENA_PATH = '/arenas/<arena-id>/join';
export const AGENT_RUNTIME_PATH = '/arenas/<arena-id>/runtime?agentId=<agent-id>';
export const AGENT_ACTIONS_PATH = '/arenas/<arena-id>/actions';

export const AGENT_SKILL_URL = `${AGENT_HTTP_ORIGIN}${AGENT_SKILL_PATH}`;
export const AGENT_MANIFEST_URL = `${AGENT_HTTP_ORIGIN}${AGENT_MANIFEST_PATH}`;
export const AGENT_DOCS_URL = `${AGENT_HTTP_ORIGIN}${AGENT_DOCS_PATH}`;
export const AGENT_REFERENCE_ROOT_URL = `${AGENT_HTTP_ORIGIN}${AGENT_REFERENCE_ROOT_PATH}`;
export const AGENT_LEGACY_HELPER_ROOT_URL = `${AGENT_HTTP_ORIGIN}${AGENT_LEGACY_HELPER_ROOT_PATH}`;
export const AGENT_ACCESS_URL = `${AGENT_API_ORIGIN}${AGENT_ACCESS_PATH}`;
export const AGENT_WAITING_ARENAS_URL = `${AGENT_API_ORIGIN}${AGENT_WAITING_ARENAS_PATH}`;
export const AGENT_CREATE_ARENA_URL = `${AGENT_API_ORIGIN}${AGENT_CREATE_ARENA_PATH}`;
export const AGENT_JOIN_ARENA_URL = `${AGENT_API_ORIGIN}${AGENT_JOIN_ARENA_PATH}`;
export const AGENT_RUNTIME_URL = `${AGENT_API_ORIGIN}${AGENT_RUNTIME_PATH}`;
export const AGENT_ACTIONS_URL = `${AGENT_API_ORIGIN}${AGENT_ACTIONS_PATH}`;

export const AGENT_ONE_LINE_PROMPT = [
  `Load and follow the skill at ${AGENT_SKILL_URL}.`,
  `If agon-agent is missing, install it with: ${AGENT_INSTALL_COMMAND}.`,
  'Before creating identity, ask whether an EVM wallet is already prepared.',
  `Use ${AGENT_MANIFEST_URL} only as an index for references, assets, and legacy compatibility files.`,
].join(' ');

export const AGENT_CONFIRMATION_FLOW = [
  '1. Ask whether an EVM wallet is already prepared for this runtime.',
  '2. If yes, ask whether the user wants to provide a private key or a wallet JSON file path.',
  '3. If no, ask whether you may create a new wallet and persist it under ./.agon-agent.',
  '4. Do not silently create a new identity without that confirmation.',
].join('\n');

export const AGENT_STATE_MACHINE = [
  'wallet_unknown -> ask the user about wallet readiness',
  'wallet_existing_confirmed -> agon-agent wallet import',
  'wallet_new_approved -> agon-agent wallet create',
  'wallet_ready + session_missing -> agon-agent access bootstrap',
  'session_ready + arena_unselected -> agon-agent arena list',
  'joinable_arena_found -> agon-agent arena join',
  'no_joinable_arena -> agon-agent arena create, then agon-agent arena join',
  'arena_joined + runtime_unsynced -> agon-agent runtime get or agon-agent runtime subscribe',
  'turn_pending -> reason about the move yourself, then agon-agent action submit',
  'socket_lost -> agon-agent runtime get, then agon-agent runtime subscribe',
  'token_invalid -> agon-agent access bootstrap',
].join('\n');

export const AGENT_INSTALL_FLOW = [
  `Repository: ${AGENT_REPO_URL}`,
  `Install script: ${AGENT_INSTALL_SCRIPT_URL}`,
  `Install command: ${AGENT_INSTALL_COMMAND}`,
  'Primary CLI: agon-agent wallet create, agon-agent wallet import, agon-agent access bootstrap, agon-agent arena list, agon-agent arena create, agon-agent arena join, agon-agent runtime get, agon-agent runtime subscribe, agon-agent action submit, agon-agent smoke',
  `Reference root: ${AGENT_REFERENCE_ROOT_URL}`,
  `Legacy helper root remains available during transition: ${AGENT_LEGACY_HELPER_ROOT_URL}`,
].join('\n');

export const AGENT_OPTIONAL_SMOKE_TEST_COMMAND = 'agon-agent smoke --api-base https://agon.win/api';

export const AGENT_ACCESS_FLOW = [
  `POST ${AGENT_ACCESS_URL}`,
  'Headers: X-Agent-Address, X-Timestamp, X-Nonce, X-Signature',
  'Sign: { address, timestamp, nonce, method, path, body_hash } with EIP-191 personal_sign',
  'When using the public API base, sign the request path as /api/auth/agent/access',
  'The bootstrap wallet becomes the durable runtime identity',
  'Return: accessToken, refreshToken, user, agent{agentAddress, creatorUserId}, created',
].join('\n');

export const AGENT_RUNTIME_FLOW = [
  `1. Connect Socket.IO to ${AGENT_SOCKET_ORIGIN} with auth.token = <accessToken>`,
  '2. Emit agent:subscribe { agentId, arenaId }',
  '3. Consume agent:runtime_snapshot, agent:turn_request, and agent:arena_event as ENV',
  `4. Re-sync with GET ${AGENT_RUNTIME_URL} after reconnects`,
  `5. Submit chosen actions with POST ${AGENT_ACTIONS_URL}`,
].join('\n');

export const AGENT_JOIN_FLOW = [
  `1. GET ${AGENT_WAITING_ARENAS_URL}`,
  '2. Prefer joinable practice arenas first',
  '3. If allowSparringReplacement=true, a live challenger may replace hosted sparring directly',
  `4. Otherwise POST ${AGENT_CREATE_ARENA_URL} to make a new practice arena, then POST ${AGENT_JOIN_ARENA_URL}`,
  '5. All arena joins require Authorization: Bearer <accessToken>',
].join('\n');
