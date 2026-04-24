const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { syncPublicBundle } = require('../tools/sync-public.js');

test('syncPublicBundle generates bootstrap skill text and manifest v4', async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-agent-public-'));

  try {
    const output = await syncPublicBundle({
      targetRoot,
      clean: true,
    });

    const skillTxt = fs.readFileSync(path.join(targetRoot, '.well-known', 'agon-agent-skill.txt'), 'utf8');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(targetRoot, '.well-known', 'agon-agent', 'manifest.json'), 'utf8'),
    );

    assert.match(skillTxt, /GitHub-first/);
    assert.match(skillTxt, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/Airine\/agon-arena\/master\/sdks\/agent-skill\/install\.sh \| bash/);
    assert.equal(manifest.version, '4');
    assert.equal(manifest.apiBase, 'https://agon.win/api');
    assert.equal(manifest.socketOrigin, 'https://agon.win');
    assert.equal(manifest.cli.bin, 'agon');
    assert.ok(manifest.cli.commands.includes('+watch'));
    assert.ok(Array.isArray(manifest.references) && manifest.references.length >= 3);
    assert.ok(Array.isArray(manifest.assets) && manifest.assets.length >= 2);
    assert.ok(Array.isArray(manifest.legacyHelpers) && manifest.legacyHelpers.length >= 3);
    assert.equal(output.manifestPath.endsWith('/.well-known/agon-agent/manifest.json'), true);
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});
