'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '../bin/agon-tui.js');

test('agon-tui watch --help lists width and plain rendering options', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, 'watch', '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--width/);
  assert.match(result.stdout, /--plain/);
});
