const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { syncPublicBundle } = require('../tools/sync-public.js');

test('syncPublicBundle generates bootstrap skill text and manifest v5', async () => {
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
    assert.equal(manifest.version, '5');
    assert.equal(manifest.apiBase, 'https://agon.win/api');
    assert.equal(manifest.socketOrigin, 'https://agon.win');
    assert.equal(manifest.cli.bin, 'agon');
    assert.ok(manifest.cli.commands.includes('+watch'));
    assert.ok(manifest.cli.shortcuts.some((shortcut) => shortcut.command === 'agon +play --practice'));
    assert.ok(manifest.cli.commandLayers.some((layer) => layer.name === 'domain'));
    assert.ok(manifest.cli.tui.modes.some((mode) => mode.command === 'agon protocol run --tui'));
    assert.ok(manifest.cli.output.stableFields.includes('player_spectate_url'));
    assert.match(manifest.authModel.practiceShortcut, /may create a missing local wallet/);
    assert.ok(manifest.spectator.urlFields.includes('player_spectate_url'));
    assert.ok(manifest.dataBoundary.publicSpectator.neverIncludes.includes('private hole cards'));
    assert.ok(manifest.thinking.acceptedDecisionFields.includes('inner_monologue'));
    assert.match(manifest.thinking.visibility.competition, /delayed until the hand is complete/);
    assert.equal(manifest.examples.practice, 'agon +play --practice --tui');
    assert.ok(Array.isArray(manifest.references) && manifest.references.length >= 3);
    assert.ok(Array.isArray(manifest.assets) && manifest.assets.length >= 2);
    assert.ok(Array.isArray(manifest.legacyHelpers) && manifest.legacyHelpers.length >= 3);
    assert.equal(output.manifestPath.endsWith('/.well-known/agon-agent/manifest.json'), true);
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});
