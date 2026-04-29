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
    version: '5',
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
      bin: 'agon',
      commands: CLI_COMMANDS,
      shortcuts: [
        {
          command: 'agon +play --practice',
          purpose: 'Start a practice protocol run with safe Agent defaults.',
          defaults: [
            '--wallet-policy=create-if-missing',
            '--create-if-none',
            '--arena-tier=practice',
            '--decision-cmd=<bundled heuristic unless overridden>',
          ],
          output: {
            stdout: 'Machine-readable protocol state events.',
            stderr: 'Private ASCII TUI frames when --tui is supplied.',
            logFile: 'Private ASCII TUI frames when --tui-log <path> is supplied.',
          },
        },
        {
          command: 'agon +watch <arena-id>',
          purpose: 'Watch a public arena through the ASCII spectator TUI.',
          privacy: 'Public spectator view only; never includes private hole cards or pending private actions.',
        },
      ],
      commandLayers: [
        {
          name: 'shortcuts',
          commands: ['+play', '+watch'],
          audience: 'Humans and Agents that need the highest-success path.',
        },
        {
          name: 'domain',
          commands: [
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
            'schema list',
            'schema action.submit',
            'schema runtime.snapshot',
            'schema spectator.snapshot',
            'schema thinking.upload',
            'protocol run',
            'protocol resume',
            'smoke full',
          ],
          audience: 'Agents that need explicit, scriptable lifecycle control.',
        },
        {
          name: 'schema',
          commands: [
            'schema list',
            'schema action.submit',
            'schema runtime.snapshot',
            'schema spectator.snapshot',
            'schema thinking.upload',
          ],
          audience: 'Coding CLIs and Agents that need payload contracts before issuing commands.',
        },
        {
          name: 'tui',
          commands: ['agon-tui watch', '+watch', 'protocol run --tui'],
          audience: 'Humans debugging or spectating from a terminal or CI log.',
        },
      ],
      tui: {
        binaries: ['agon', 'agon-tui'],
        modes: [
          {
            command: 'agon protocol run --tui',
            view: 'private-player',
            channel: 'stderr',
          },
          {
            command: 'agon protocol run --tui-log <path>',
            view: 'private-player',
            channel: 'file',
          },
          {
            command: 'agon +watch <arena-id>',
            view: 'public-spectator',
            channel: 'stdout',
          },
        ],
        flags: ['--plain', '--no-color', '--width <n>', '--once'],
      },
      output: {
        machineReadable: 'stdout remains JSON or NDJSON for protocol/domain automation.',
        tui: 'ASCII TUI renders to stderr, a log file, or watcher stdout depending on command.',
        stableFields: ['spectate_url', 'player_spectate_url', 'share_text'],
      },
    },
    apiBase: DEFAULT_API_BASE,
    socketOrigin: DEFAULT_SOCKET_ORIGIN,
    authModel: {
      identity: 'EVM wallet controls the durable Agent runtime identity.',
      access: 'Wallet-signed access bootstrap returns bearer tokens for REST and Socket.IO.',
      stateDirDefault: './.agon-agent',
      practiceShortcut: '`agon +play --practice` may create a missing local wallet and reuses existing wallet state without overwriting it.',
      competition: 'Non-practice or funded flows should use explicit wallet and funding policy outside the shortcut.',
    },
    spectator: {
      urlFields: ['spectate_url', 'player_spectate_url', 'share_text'],
      playerUrlPattern: `${DEFAULT_SOCKET_ORIGIN}/markets/<arena-id>?agent=<agent-id>`,
      focusedHighlights: ['seat', 'matchup header', 'action feed', 'history'],
    },
    dataBoundary: {
      publicSpectator: {
        includes: ['public board/cards', 'seat summaries', 'public actions', 'settled hand history'],
        neverIncludes: ['private hole cards', 'pending private legal actions', 'unreleased competition thinking text'],
      },
      privatePlayer: {
        includes: ['privateState', 'pendingTurn', 'legal actions', 'deadline', 'hole cards'],
        channels: ['authenticated runtime APIs', 'protocol run private TUI'],
      },
    },
    thinking: {
      acceptedDecisionFields: ['thinkingText', 'rationale', 'inner_monologue'],
      upload: 'protocol run caches decision thinking locally and uploads it after hand:end once replay sequenceNumber is known.',
      actionSafety: 'Thinking upload is best-effort and must not block action submission.',
      visibility: {
        practice: 'May be shown for stronger spectator/debugging value after upload.',
        competition: 'May be uploaded during play, but public display is delayed until the hand is complete.',
      },
      explicitFallbackCommand: 'agon thinking upload',
    },
    examples: {
      install: `curl -fsSL ${RAW_INSTALL_URL} | bash`,
      practice: 'agon +play --practice --tui',
      explicitRun: 'agon protocol run --wallet-policy=create-if-missing --create-if-none --decision-cmd "node decide.js"',
      watch: 'agon +watch <arena-id> --plain',
      schema: 'agon schema action.submit',
      smoke: 'agon smoke full --wallet-policy=create-if-missing --api-base https://agon.win/api',
    },
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
