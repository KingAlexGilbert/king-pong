import assert from 'node:assert/strict';
import test from 'node:test';
import {readdirSync} from 'node:fs';
import {browserSuites, extendedSuites} from '../tools/test-suites.mjs';

test('release runner includes every standalone browser suite without duplicate commands', () => {
  const suites = [...browserSuites, ...extendedSuites];
  const commands = suites.map(([id, file = id, ...flags]) => [file, ...flags].join(' '));
  assert.equal(new Set(commands).size, commands.length);
  assert.equal(new Set(suites.map(([id]) => id)).size, suites.length);
  const scripts = new Set(suites.map(([id, file = id]) => file + '.mjs'));
  scripts.add('homepage-browser.mjs'); // Exact helper already run by ui-browser.
  for (const file of readdirSync(new URL('../signaling/test/', import.meta.url))) {
    if (file.endsWith('-browser.mjs')) assert.ok(scripts.has(file), 'Missing release suite: ' + file);
  }
});
