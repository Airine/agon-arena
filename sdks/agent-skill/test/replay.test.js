'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '../bin/agon.js');
const { eventsFromApiPayload, parseNdjson, summarizeEvents } = require('../commands/replay');

test('replay parses saved protocol NDJSON and summarizes states/actions', () => {
  const events = parseNdjson([
    JSON.stringify({ ok: true, state: 'arena_joined', data: { arenaId: 'arena-1' } }),
    JSON.stringify({ ok: true, state: 'action_submitted', data: { arenaId: 'arena-1', turnId: 'turn-1', action: 'fold' } }),
    JSON.stringify({ ok: true, state: 'thinking_uploaded', data: { arenaId: 'arena-1', handNumber: 1, uploaded: 1 } }),
    JSON.stringify({ ok: true, state: 'arena_finished', data: { arenaId: 'arena-1' } }),
  ].join('\n'), 'fixture.ndjson');

  const summary = summarizeEvents(events, { type: 'file', path: 'fixture.ndjson' });

  assert.equal(summary.state, 'replay_loaded');
  assert.equal(summary.data.totalEvents, 4);
  assert.deepEqual(summary.data.arenaIds, ['arena-1']);
  assert.equal(summary.data.stateCounts.action_submitted, 1);
  assert.equal(summary.data.actions[0].turnId, 'turn-1');
  assert.equal(summary.data.thinkingUploads[0].uploaded, 1);
  assert.equal(summary.data.finished, true);
});


test('replay accepts hand replay API steps payloads', () => {
  const steps = eventsFromApiPayload({
    arenaId: 'arena-api',
    handNumber: 1,
    steps: [
      { sequenceNumber: 7, stage: 'flop', actorAgentId: 'ag1', action: { type: 'call' } },
    ],
  });
  const summary = summarizeEvents(steps, { type: 'api', arenaId: 'arena-api', handNumber: 1 });

  assert.equal(summary.data.stateCounts.replay_step, 1);
  assert.equal(summary.data.actions[0].sequenceNumber, 7);
  assert.equal(summary.data.actions[0].handNumber, 1);
  assert.equal(summary.data.actions[0].actorAgentId, 'ag1');
  assert.deepEqual(summary.data.arenaIds, ['arena-api']);
});

test('agon replay <file.ndjson> prints machine-readable replay summary', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-replay-'));
  const file = path.join(tmpDir, 'run.ndjson');
  fs.writeFileSync(file, [
    JSON.stringify({ ok: true, state: 'wallet_resolved', data: {} }),
    JSON.stringify({ ok: true, state: 'arena_joined', data: { arenaId: 'arena-file' } }),
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'replay', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.state, 'replay_loaded');
    assert.deepEqual(payload.data.arenaIds, ['arena-file']);
    assert.equal(payload.data.totalEvents, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agon replay --arena-id fetches replay events from API', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/arenas/arena-api/hands/1/replay');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      arenaId: 'arena-api',
      handNumber: 1,
      steps: [
        { sequenceNumber: 1, stage: 'pre_flop', actorAgentId: 'ag1', action: { type: 'fold' } },
      ],
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}`;

  try {
    const { stdout, stderr, exitCode } = await new Promise((resolve) => {
      const proc = spawn(process.execPath, [
        CLI_PATH,
        'replay',
        '--arena-id=arena-api',
        '--hand-number=1',
        `--api-base=${apiBase}`,
      ]);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk; });
      proc.stderr.on('data', (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ stdout, stderr, exitCode: 1 });
      }, 10_000);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code });
      });
    });
    assert.equal(exitCode, 0, stderr);
    const payload = JSON.parse(stdout);
    assert.equal(payload.data.source.type, 'api');
    assert.equal(payload.data.source.handNumber, 1);
    assert.deepEqual(payload.data.arenaIds, ['arena-api']);
    assert.equal(payload.data.stateCounts.replay_step, 1);
    assert.equal(payload.data.actions[0].action, 'fold');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
