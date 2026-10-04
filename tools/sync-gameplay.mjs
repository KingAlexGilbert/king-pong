import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const files = ['docs/demo/index.html', 'windows/webview-2/index.html', 'Linux/assets/index.html', 'android/app/src/main/assets/index.html'];
const script = readFileSync(new URL('game/royal-gameplay.js', root), 'utf8');
const css = readFileSync(new URL('game/royal-menu.css', root), 'utf8');
const localization = readFileSync(new URL('game/royal-localization.js', root), 'utf8');
const begin = '// BEGIN SHARED ROYAL GAMEPLAY';
const end = '// END SHARED ROYAL GAMEPLAY';
for (const file of files) {
  const path = new URL(file, root);
  const html = readFileSync(path, 'utf8');
  const block = `${begin}\n${script}\n${end}\n`;
  const start = html.indexOf(begin);
  let updated = start < 0 ? html.replace('const FIXED_STEP_MS=', block + 'const FIXED_STEP_MS=') :
    html.slice(0, start) + block + html.slice(html.indexOf(end, start) + end.length).replace(/^\n/, '');
  const style = `<style id="royal-menu-style">\n${css}</style>`;
  updated = updated.includes('<style id="royal-menu-style">') ? updated.replace(/<style id="royal-menu-style">[\s\S]*?<\/style>/, style) : updated.replace('</head>', style + '\n</head>');
  const phrases = `<script id="royal-localization">\n${localization}</script>`;
  updated = updated.includes('<script id="royal-localization">') ? updated.replace(/<script id="royal-localization">[\s\S]*?<\/script>/, phrases) : updated.replace('<script>const LOCALIZATION=', phrases + '\n<script>const LOCALIZATION=');
  const merge = 'Object.entries(window.KING_PONG_ROYAL_TRANSLATIONS||{}).forEach(([code,phrases])=>{if(phraseTranslations[code])Object.assign(phraseTranslations[code],phrases);});';
  if (!updated.includes(merge)) updated = updated.replace('const lang=detectLanguage();', merge + 'const lang=detectLanguage();');
  if (process.argv.includes('--check')) {
    if (updated !== html) throw new Error(`${file}: run node tools/sync-gameplay.mjs`);
  } else writeFileSync(path, updated);
}
