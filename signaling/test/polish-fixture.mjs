import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium, firefox} from 'playwright';
import {root} from '../../tests/helpers/game-source.mjs';

export async function polishFixture() {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL('.' + new URL(req.url, 'http://local').pathname, root);
      if (!path.href.startsWith(root.href)) throw Error();
      res.setHeader('Content-Type', path.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const engine = process.env.KING_PONG_BROWSER === 'firefox' ? firefox : chromium;
  const browser = await engine.launch({args: engine === chromium ? ['--no-sandbox'] : []});
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  async function page(path = 'docs/demo/index.html', options = {}, setup) {
    const p = await browser.newPage(options);
    p.on('pageerror', error => errors.push(error.message));
    await p.addInitScript(() => Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => '', set: () => {}}));
    if (setup) await setup(p);
    await p.goto(origin + '/' + path);
    return p;
  }
  async function shot(p, name) {
    if (!process.env.KING_PONG_SCREENSHOTS) return;
    await mkdir(process.env.KING_PONG_SCREENSHOTS, {recursive: true});
    await p.screenshot({path: process.env.KING_PONG_SCREENSHOTS + '/' + name + '.png'});
  }
  return {browser, origin, errors, page, shot, close: async () => { await browser.close(); server.close(); }};
}
