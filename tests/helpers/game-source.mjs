import {functionRange} from '../../game/ui-integration.mjs';
import {
  readFileSync
} from 'node:fs';

export const builds = {
  Browser: 'docs/demo/index.html',
  Windows: 'windows/webview-2/index.html',
  Linux: 'Linux/assets/index.html',
  Android: 'android/app/src/main/assets/index.html'
};
export const root = new URL('../../', import.meta.url);
// Cache immutable text only; each harness owns a fresh VM and state.
const sources = new Map();
export const source = platform => {
  if (!sources.has(platform)) sources.set(platform, readFileSync(new URL(builds[platform], root), 'utf8'));
  return sources.get(platform);
};

// Share the synchronization scanner instead of maintaining another parser.
export function functionSource(html, name) {
  const [start, end] = functionRange(html, name);
  return html.slice(start, end);
}

export function constantSource(html, name) {
  const match = new RegExp('\\bconst\\s+' + name + '\\s*=').exec(html);
  if (!match) throw new Error('Missing constant: ' + name);
  const start = match.index;
  return html.slice(start, html.indexOf(';', start) + 1);
}
