const path = require('node:path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_API_BASE = 'https://agon.win/api';
const PUBLIC_HTTP_ORIGIN = 'https://agon.win';
const DEFAULT_SOCKET_ORIGIN = PUBLIC_HTTP_ORIGIN;
const DEFAULT_STATE_DIR = './.agon-agent';
const REPO_URL = 'https://github.com/Airine/agon-arena';
const RAW_INSTALL_URL =
  'https://raw.githubusercontent.com/Airine/agon-arena/master/sdks/agent-skill/install.sh';
const SKILL_URL = `${PUBLIC_HTTP_ORIGIN}/.well-known/agon-agent-skill.txt`;
const MANIFEST_URL = `${PUBLIC_HTTP_ORIGIN}/.well-known/agon-agent/manifest.json`;
const PUBLIC_AGENT_ROOT = `${PUBLIC_HTTP_ORIGIN}/.well-known/agon-agent`;

const CLI_COMMANDS = [
  'wallet create',
  'wallet import',
  'access bootstrap',
  'access refresh',
  'arena list',
  'arena create',
  'arena join',
  'runtime get',
  'runtime subscribe',
  'action submit',
  'thinking upload',
  'schema',
  'schema list',
  'schema action.submit',
  'schema runtime.snapshot',
  'schema spectator.snapshot',
  'schema thinking.upload',
  'protocol run',
  'protocol resume',
  'replay',
  'replay <file.ndjson>',
  '+play',
  '+watch',
  'agon-tui watch',
  'smoke',
  'smoke full',
];

function normalizeApiBase(baseUrl = DEFAULT_API_BASE) {
  return String(baseUrl || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function deriveSocketOrigin(apiBase = DEFAULT_API_BASE) {
  const url = new URL(normalizeApiBase(apiBase));
  return url.origin;
}

module.exports = {
  CLI_COMMANDS,
  DEFAULT_API_BASE,
  DEFAULT_SOCKET_ORIGIN,
  DEFAULT_STATE_DIR,
  MANIFEST_URL,
  PACKAGE_ROOT,
  PUBLIC_AGENT_ROOT,
  PUBLIC_HTTP_ORIGIN,
  RAW_INSTALL_URL,
  REPO_URL,
  SKILL_URL,
  deriveSocketOrigin,
  normalizeApiBase,
};
