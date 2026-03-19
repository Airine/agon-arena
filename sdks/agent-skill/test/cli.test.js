const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'agon-agent.js');

test('agon-agent --help lists the GitHub-first command groups', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wallet create/);
  assert.match(result.stdout, /access bootstrap/);
  assert.match(result.stdout, /runtime subscribe/);
  assert.match(result.stdout, /curl -fsSL/);
});

test('agon-agent access bootstrap --help uses public API defaults', () => {
  const result = spawnSync(process.execPath, [cliPath, 'access', 'bootstrap', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/agon\.win\/api/);
  assert.doesNotMatch(result.stdout, /agon\.win:4000/);
});
