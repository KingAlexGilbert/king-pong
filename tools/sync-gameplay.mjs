import {integrateBossAudio} from '../game/boss-audio-integration.mjs';
import {integrateSharedSections} from './shared-sections.mjs';
import {integrateBrowserFullscreen} from '../game/fullscreen-integration.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { integrateMultiplayerPresentation } from '../game/presentation-integration.mjs';
import { integrateRoyalUi } from '../game/ui-integration.mjs';
import { integrateRoyalPolish } from '../game/polish-integration.mjs';
import { integrateServeMotion } from '../game/serve-integration.mjs';
import { integrateLevelSelect } from '../game/level-select-integration.mjs';
import { integrateSaveTransfer } from '../game/save-transfer-integration.mjs';
import { onlineSources, iconSources, integrateOnline } from './sync-online.mjs';

const root = new URL('../', import.meta.url);
const files = [
  'docs/demo/index.html',
  'windows/webview-2/index.html',
  'Linux/assets/index.html',
  'android/app/src/main/assets/index.html'
];
const nativeOnlineScript = onlineSources(process.argv.includes('--check'));
const script = iconSources() + [
  'royal-gameplay.js',
  'multiplayer-serve.js',
  'level-select.js',
  'royal-rules.js',
  'royal-audio.js',
  'boss-audio.js',
  'player-preferences.js',
  'arena-perspective.js',
  'royal-ui.js',
  'multiplayer-safety.js',
  'local-lan.js',
  'vendor/qr-creator.min.js',
  'vendor/jsqr.min.js',
  'lan-qr.js'
].map(file => {
  const source = readFileSync(new URL('game/' + file, root), 'utf8');
  return file.startsWith('vendor/') ? '(() => {\n' + source + '\n})();' : source;
}).join('\n');
const css = readFileSync(new URL('game/royal-menu.css', root), 'utf8');
const localization = readFileSync(new URL('game/royal-localization.js', root), 'utf8');
const saveTransfer = readFileSync(new URL('game/save-transfer.js', root), 'utf8');

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
    integrateSharedSections(html.replace(/\r\n/g, '\n')),
    '// BEGIN SHARED ROYAL GAMEPLAY',
    '// END SHARED ROYAL GAMEPLAY',
    script + '\n'
  );
  updated = replaceBlock(updated, '<style id="royal-menu-style">', '</style>', css);
  updated = replaceBlock(updated, '<script id="royal-localization">', '</script>', localization);
  updated = integrateMultiplayerPresentation(updated);
  updated = integrateRoyalUi(updated);
  updated = integrateSaveTransfer(updated, saveTransfer);
  updated = integrateRoyalPolish(updated);
  updated = integrateServeMotion(updated);
  updated = integrateLevelSelect(updated);
  updated = integrateOnline(updated, nativeOnlineScript, file !== 'docs/demo/index.html');
  updated = integrateBossAudio(updated);
  updated = integrateBrowserFullscreen(updated, file === 'docs/demo/index.html');
  // Normalize generated content, then preserve the original file's line endings.
  updated = updated.replace(/\r\n/g, '\n');

  if (html.includes('\r\n')) {
    updated = updated.replace(/\n/g, '\r\n');
  }

  if (process.argv.includes('--check')) {
    if (updated !== html) throw new Error(`${file}: run node tools/sync-gameplay.mjs`);
  } else if (updated !== html) {
    writeFileSync(path, updated);
  }
}
