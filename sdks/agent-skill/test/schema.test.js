const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'agon.js');

function runSchema(name) {
  const result = spawnSync(process.execPath, [cliPath, 'schema', name], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('agon schema --help lists supported schemas', () => {
  const result = spawnSync(process.execPath, [cliPath, 'schema', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /action\.submit/);
  assert.match(result.stdout, /runtime\.snapshot/);
  assert.match(result.stdout, /spectator\.snapshot/);
  assert.match(result.stdout, /thinking\.upload/);
});

test('agon schema list emits schema summaries', () => {
  const result = runSchema('list');

  assert.equal(result.ok, true);
  assert.ok(result.schemas.some((schema) => schema.id === 'action.submit'));
  assert.ok(result.schemas.some((schema) => schema.id === 'thinking.upload'));
});

test('agon schema action.submit describes legal actions and route', () => {
  const result = runSchema('action.submit');

  assert.equal(result.ok, true);
  assert.equal(result.schema.route, '/arenas/<arena-id>/actions');
  assert.deepEqual(result.schema.input.required, ['agentId', 'turnId', 'action']);
  assert.ok(result.schema.input.fields.action.enum.includes('raise'));
});

test('agon schema runtime.snapshot marks private player boundary', () => {
  const result = runSchema('runtime.snapshot');

  assert.equal(result.schema.command, 'agon runtime get');
  assert.match(result.schema.privacy, /Private player view/);
  assert.ok(result.schema.boundary.neverPublishDirectly.includes('hole cards'));
});

test('agon schema spectator.snapshot forbids private cards', () => {
  const result = runSchema('spectator.snapshot');

  assert.equal(result.schema.auth, 'none');
  assert.match(result.schema.privacy, /Public spectator view/);
  assert.ok(result.schema.boundary.neverIncludes.includes('private hole cards'));
});

test('agon schema thinking.upload documents delayed competition visibility', () => {
  const result = runSchema('thinking.upload');

  assert.equal(result.schema.command, 'agon thinking upload');
  assert.match(result.schema.safety.visibility.competition, /delayed until the hand is complete/);
  assert.equal(result.schema.input.fields.steps.items.fields.thinkingText.maxLength, 10000);
});
