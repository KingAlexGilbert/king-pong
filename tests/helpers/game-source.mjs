import { readFileSync } from 'node:fs';

export const builds = {
  Browser: 'docs/demo/index.html',
  Windows: 'windows/webview-2/index.html',
  Linux: 'Linux/assets/index.html',
  Android: 'android/app/src/main/assets/index.html'
};
export const root = new URL('../../', import.meta.url);
export const source = platform => readFileSync(new URL(builds[platform], root), 'utf8');

// Extract complete production functions, including nested blocks, without a build dependency.
export function functionSource(html, name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Missing function: ' + name);
  let cursor = html.indexOf('{', start) + 1;
  let depth = 1, quote = '', comment = '';
  while (depth && cursor < html.length) {
    const c = html[cursor], next = html[cursor + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; cursor++; }
    } else if (quote) {
      if (c === '\\') cursor++;
      else if (c === quote) quote = '';
    } else if (c === '/' && next === '/') { comment = 'line'; cursor++; }
    else if (c === '/' && next === '*') { comment = 'block'; cursor++; }
    else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    cursor++;
  }
  if (depth) throw new Error('Unclosed function: ' + name);
  return html.slice(start, cursor);
}

export function constantSource(html, name) {
  const start = html.indexOf('const ' + name + '=');
  if (start < 0) throw new Error('Missing constant: ' + name);
  return html.slice(start, html.indexOf(';', start) + 1);
}
