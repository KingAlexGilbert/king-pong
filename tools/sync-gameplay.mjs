import { readFileSync, writeFileSync } from 'node:fs';
import { integrateRoyalUi } from '../game/ui-integration.mjs';
import { integrateRoyalPolish } from '../game/polish-integration.mjs';

const root = new URL('../', import.meta.url);
const files = [
  'docs/demo/index.html',
  'windows/webview-2/index.html',
  'Linux/assets/index.html',
  'android/app/src/main/assets/index.html'
];
const script = [
  'royal-gameplay.js',
  'royal-rules.js',
  'royal-audio.js',
  'royal-ui.js'
].map(file => readFileSync(new URL('game/' + file, root), 'utf8')).join('\n');
const css = readFileSync(new URL('game/royal-menu.css', root), 'utf8');
const localization = readFileSync(new URL('game/royal-localization.js', root), 'utf8');

// The checked-in HTML also owns the legacy engine and platform glue. Replace only
// explicit shared blocks, preserving their source formatting and everything outside.
// Missing/duplicate source markers are an error, not a reason to guess an insertion point.
function replaceBlock(html, begin, end, content) {
  const start = html.indexOf(begin);
  const finish = html.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0 || html.indexOf(begin, start + begin.length) !== -1) {
    throw new Error('Missing or duplicate shared block: ' + begin);
  }
  return html.slice(0, start) + begin + '\n' + content + end + html.slice(finish + end.length);
}

for (const file of files) {
  const path = new URL(file, root);
  const html = readFileSync(path, 'utf8');
  let updated = replaceBlock(
    html,
    '// BEGIN SHARED ROYAL GAMEPLAY',
    '// END SHARED ROYAL GAMEPLAY',
    script + '\n'
  );
  updated = replaceBlock(updated, '<style id="royal-menu-style">', '</style>', css);
  updated = replaceBlock(updated, '<script id="royal-localization">', '</script>', localization);
  updated = integrateRoyalUi(updated);
  updated = integrateRoyalPolish(updated);

  if (process.argv.includes('--check')) {
    if (updated !== html) throw new Error(`${file}: run node tools/sync-gameplay.mjs`);
  } else {
    writeFileSync(path, updated);
  }
}
