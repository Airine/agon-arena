const fs = require('node:fs');
const path = require('node:path');
const {
  CLI_COMMANDS,
  DEFAULT_API_BASE,
  DEFAULT_SOCKET_ORIGIN,
  MANIFEST_URL,
  PACKAGE_ROOT,
  PUBLIC_AGENT_ROOT,
  RAW_INSTALL_URL,
  REPO_URL,
  SKILL_URL,
} = require('../lib/constants');

const DEFAULT_TARGET_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', 'apps', 'web', 'public');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(sourceDir, targetDir) {
  let entries;
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  ensureDir(targetDir);
  for (const entry of entries) {
    const fromPath = path.join(sourceDir, entry.name);
    const toPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(fromPath, toPath);
    } else {
      ensureDir(path.dirname(toPath));
      fs.copyFileSync(fromPath, toPath);
    }
  }
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s+/, '');
}

function relativePublicUrl(...parts) {
  return `${PUBLIC_AGENT_ROOT}/${parts.join('/')}`;
}

function listFiles(relativeDir) {
  const absoluteDir = path.join(PACKAGE_ROOT, 'skill', relativeDir);
  let entries;
  try {
    entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      url: relativePublicUrl(relativeDir, entry.name),
    }));
}

function buildManifest() {
  const references = listFiles('references');
  const assets = listFiles('assets');
  const legacyHelpers = [
    'create_wallet.js',
    'import_wallet.js',
    'agent_access.js',
    'list_arenas.js',
    'create_arena.js',
    'join_arena.js',
    'get_runtime.js',
    'subscribe_runtime.js',
    'submit_action.js',
  ].map((file) => ({
    file,
    url: `${PUBLIC_AGENT_ROOT}/scripts/${file}`,
  }));

  return {
    version: '4',
    format: 'markdown-skill',
    skillUrl: SKILL_URL,
    manifestUrl: MANIFEST_URL,
    repo: {
      url: REPO_URL,
      branch: 'master',
    },
    install: {
      scriptUrl: RAW_INSTALL_URL,
      command: `curl -fsSL ${RAW_INSTALL_URL} | bash`,
    },
    cli: {
      bin: 'agon-agent',
      commands: CLI_COMMANDS,
    },
    apiBase: DEFAULT_API_BASE,
    socketOrigin: DEFAULT_SOCKET_ORIGIN,
    references,
    assets,
    legacyHelpers,
  };
}

async function syncPublicBundle({
  targetRoot = DEFAULT_TARGET_ROOT,
  clean = false,
} = {}) {
  const publicRoot = path.resolve(targetRoot);
  const wellKnownRoot = path.join(publicRoot, '.well-known');
  const agentRoot = path.join(wellKnownRoot, 'agon-agent');
  const referencesTarget = path.join(agentRoot, 'references');
  const assetsTarget = path.join(agentRoot, 'assets');
  const skillTxtPath = path.join(wellKnownRoot, 'agon-agent-skill.txt');
  const manifestPath = path.join(agentRoot, 'manifest.json');

  ensureDir(wellKnownRoot);
  ensureDir(agentRoot);

  if (clean) {
    fs.rmSync(referencesTarget, { recursive: true, force: true });
    fs.rmSync(assetsTarget, { recursive: true, force: true });
  }

  copyDir(path.join(PACKAGE_ROOT, 'skill', 'references'), referencesTarget);
  copyDir(path.join(PACKAGE_ROOT, 'skill', 'assets'), assetsTarget);

  const skillMarkdown = fs.readFileSync(path.join(PACKAGE_ROOT, 'skill', 'SKILL.md'), 'utf8');
  fs.writeFileSync(skillTxtPath, stripFrontmatter(skillMarkdown), 'utf8');
  fs.writeFileSync(manifestPath, `${JSON.stringify(buildManifest(), null, 2)}\n`, 'utf8');

  return {
    skillTxtPath,
    manifestPath,
  };
}

if (require.main === module) {
  syncPublicBundle().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildManifest,
  syncPublicBundle,
};
