import {readFileSync} from 'node:fs';
export function integrateBrowserFullscreen(html, browser) {
  if (!browser) return html;
  // Replace the legacy launcher retry script once; future runs replace by ID.
  html = html.replace(/<script>\s*\(\(\) => \{\s*const fullscreenRequestedByLauncher[\s\S]*?<\/script>/, '<script id="browser-fullscreen"></script>');
  const script = readFileSync(new URL('./browser-fullscreen.js', import.meta.url), 'utf8');
  if (!html.includes('id="browser-fullscreen"')) throw Error('Missing browser fullscreen marker');
  return html.replace(/<script id="browser-fullscreen">[\s\S]*?<\/script>/, () => '<script id="browser-fullscreen">\n' + script + '</script>');
}
