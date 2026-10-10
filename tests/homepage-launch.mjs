import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const homepage = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');

test('homepage is a static launcher with no embedded game or fullscreen handlers', () => {
  assert.doesNotMatch(homepage, /<(?:iframe|embed|object|canvas|script)\b/i);
  assert.doesNotMatch(homepage, /allowfullscreen|requestFullscreen|window\.open|\bon(?:click|touchstart|keydown)\s*=/i);
});

test('preview and dedicated browser link share a repository-relative standalone destination', () => {
  const links = [...homepage.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  const preview = links.find(link => /class="game-demo-container"/.test(link[1]));
  const dedicated = links.find(link => link[2].includes('Open Browser Demo in a New Tab'));
  for (const link of [preview, dedicated]) {
    assert.ok(link);
    assert.match(link[1], /href="demo\/"/);
    assert.match(link[1], /target="_blank"/);
    assert.match(link[1], /rel="noopener noreferrer"/);
  }
  assert.match(preview[1], /aria-label="Play King Pong — opens in a new tab"/);
  assert.match(homepage, /\.game-demo-container:focus-visible\s*\{\s*outline:/);
});

test('preview reuses the existing gameplay screenshot without changing its proportions', () => {
  assert.match(homepage, /class="game-demo-image" src="images\/gameplay\.png"/);
  const image = readFileSync(new URL('../docs/images/gameplay.png', import.meta.url));
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.match(homepage, /object-fit:\s*contain/);
  assert.match(homepage, /aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(homepage, /alt="King Pong gameplay[^\"]+"/);
});
