import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { synchronizeHooks } from '../game/ui-integration.mjs';
import { builds, constantSource, root, source } from './helpers/game-source.mjs';

const fixture = `function sample() {
  const untouched = "keep { braces } and spaces";
  /* ROYAL UI */
  oldHook();
  /* END ROYAL UI */
  return {
    /* ROYAL UI */
    oldProperty: true,
    /* END ROYAL UI */
    untouched
  };
}`;
const hooks = {
  sample: [`
    if (ready) {
      newHook();
    }
  `, 'newProperty: true,']
};

test('hook synchronization preserves nesting, surrounding code and readable bodies', () => {
  const updated = synchronizeHooks(fixture, 'UI', hooks);
  assert.equal(updated, fixture
    .replace('  oldHook();', '  if (ready) {\n    newHook();\n  }')
    .replace('    oldProperty: true,', '    newProperty: true,'));
  assert.equal(synchronizeHooks(updated, 'UI', hooks), updated);
});

test('hook synchronization rejects missing functions, missing blocks and extra blocks', () => {
  assert.throws(() => synchronizeHooks('', 'UI', hooks), /Missing UI integration point/);
  assert.throws(() => synchronizeHooks('function sample() {}', 'UI', hooks), /Expected 2.*found 0/);
  assert.throws(() => synchronizeHooks(fixture, 'UI', { sample: ['one();'] }), /Expected 1.*found 2/);
});

test('constant extraction accepts readable spacing and still executes the production initializer', () => {
  assert.equal(constantSource('const ANSWER=42;', 'ANSWER'), 'const ANSWER=42;');
  assert.equal(constantSource('const ANSWER = {\n  value: 42\n};', 'ANSWER'), 'const ANSWER = {\n  value: 42\n};');
  assert.throws(() => constantSource('const WRONG = 42;', 'ANSWER'), /Missing constant/);
});

test('the dynamically inserted title paddle button keeps its original inline spacing beside Exit Game', () => {
  // initRoyalMenus inserts the paddle button immediately after title-actions.
  // A new text node after that div would add a visible gap between the inline buttons.
  for (const platform of ['Browser', 'Windows', 'Linux']) {
    assert.match(source(platform), /<\/div><button\s+type="button"\s+class="exit-game-button"\s+id="exitGameButton"/);
  }
});

test('normal sync propagates readable shared source and hooks to every platform without touching shell code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'king-pong-source-'));
  try {
    for (const entry of ['game', 'tools', ...Object.values(builds)]) {
      cpSync(new URL(entry, root), join(directory, entry), { recursive: true });
    }
    const sharedPath = join(directory, 'game/royal-gameplay.js');
    const shared = readFileSync(sharedPath, 'utf8') + '\n// Readable synchronization fixture.\n';
    writeFileSync(sharedPath, shared);
    const original = new Map();
    for (const file of Object.values(builds)) {
      const path = join(directory, file);
      const html = readFileSync(path, 'utf8');
      original.set(file, html);
      const stale = html.replace(
        '/* ROYAL POLISH */\n  seedVisualHistory();\n  /* END ROYAL POLISH */',
        '/* ROYAL POLISH */\n  outdatedHook();\n  /* END ROYAL POLISH */'
      );
      assert.notEqual(stale, html, file + ': fixture changes a real hook');
      writeFileSync(path, stale);
    }
    execFileSync(process.execPath, ['tools/sync-gameplay.mjs'], { cwd: directory });
    for (const file of Object.values(builds)) {
      const html = readFileSync(join(directory, file), 'utf8');
      assert.ok(html.includes(shared), file + ': shared source remains verbatim');
      assert.equal(html, original.get(file).replace(
        readFileSync(new URL('game/royal-gameplay.js', root), 'utf8'), shared
      ), file + ': only the intended source block changed and the stale hook was repaired');
    }
    execFileSync(process.execPath, ['tools/sync-gameplay.mjs', '--check'], { cwd: directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
