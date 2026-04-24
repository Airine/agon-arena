const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildPracticePlayArgs } = require('../bin/agon');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'agon.js');

test('agon --help lists the GitHub-first command groups and shortcuts', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wallet create/);
  assert.match(result.stdout, /access bootstrap/);
  assert.match(result.stdout, /runtime subscribe/);
  assert.match(result.stdout, /\+play --practice/);
  assert.match(result.stdout, /\+watch <arena-id>/);
  assert.match(result.stdout, /curl -fsSL/);
});

test('agon +play --help documents practice defaults', () => {
  const result = spawnSync(process.execPath, [cliPath, '+play', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: agon \+play --practice/);
  assert.match(result.stdout, /--wallet-policy=create-if-missing/);
  assert.match(result.stdout, /--create-if-none/);
  assert.match(result.stdout, /does not overwrite/);
});

test('agon +play practice args add safe defaults without overriding explicit options', () => {
  const args = buildPracticePlayArgs([
    '--practice',
    '--wallet-policy=require-existing',
    '--arena-id=arena-123',
    '--decision-cmd=node ./custom.js',
  ]);

  assert.ok(!args.includes('--practice'));
  assert.ok(args.includes('--wallet-policy=require-existing'));
  assert.ok(!args.includes('--wallet-policy=create-if-missing'));
  assert.ok(!args.includes('--create-if-none'));
  assert.ok(args.includes('--arena-tier=practice'));
  assert.ok(args.includes('--decision-cmd=node ./custom.js'));
  assert.equal(args.filter((arg) => arg.startsWith('--decision-cmd=')).length, 1);
});

test('agon +watch --help delegates to the TUI watcher help', () => {
  const result = spawnSync(process.execPath, [cliPath, '+watch', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: agon-tui watch <arena-id>/);
  assert.match(result.stdout, /--plain/);
  assert.match(result.stdout, /--width <n>/);
});

test('agon access bootstrap --help uses public API defaults', () => {
  const result = spawnSync(process.execPath, [cliPath, 'access', 'bootstrap', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/agon\.win\/api/);
  assert.doesNotMatch(result.stdout, /agon\.win:4000/);
});
