import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {builds, root, source, functionSource} from './helpers/game-source.mjs';
import {sharedSections, replaceSharedSection, sectionMarkers} from '../tools/shared-sections.mjs';

test('extracted engine sections have one canonical copy in every platform', () => {
  for (const platform of Object.keys(builds)) {
    const html = source(platform).replace(/\r\n/g, '\n');
    for (const name of sharedSections) {
      const content = readFileSync(new URL('game/' + name + '.js', root), 'utf8');
      assert.equal(replaceSharedSection(html, name, content), html, platform + ': ' + name);
      for (const [, fn] of content.matchAll(/\bfunction\s+(\w+)\s*\(/g)) {
        const declarations = html.match(new RegExp('\\bfunction\\s+' + fn + '\\s*\\(', 'g')) || [];
        assert.equal(declarations.length, 1, platform + ': duplicate function ' + fn);
      }
    }
    // Canonical-only ripple unit tests rely on this shell adapter parity gate.
    assert.equal(functionSource(html, 'drawBossRallySpawnPulses'),
      functionSource(source('Browser'), 'drawBossRallySpawnPulses'));
  }
});
test('shared synchronization rejects absent, duplicated and reversed boundaries', () => {
  const [begin, end] = sectionMarkers('cpu-config');
  for (const bad of [begin, end, end + begin, begin + begin + end, begin + end + end]) {
    assert.throws(() => replaceSharedSection(bad, 'cpu-config', 'code\n'), /shared section/);
  }
  const shell = 'before\n' + begin + '\nold\n' + end + '\nafter';
  const updated = replaceSharedSection(shell, 'cpu-config', 'new\n');
  assert.equal(updated, shell.replace('old', 'new'));
  assert.equal(replaceSharedSection(updated, 'cpu-config', 'new\n'), updated);
});
