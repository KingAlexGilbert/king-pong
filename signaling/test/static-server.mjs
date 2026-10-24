import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {root as repositoryRoot} from '../../tests/helpers/game-source.mjs';

// Only file serving is shared; browsers, contexts, clocks and network fixtures
// remain owned by each suite, preventing state leakage between scenarios.
export async function staticServer(root = repositoryRoot) {
  const server = createServer(async (req, res) => {
    try {
      const file = new URL('.' + new URL(req.url, 'http://local').pathname, root);
      if (!file.href.startsWith(root.href)) throw new Error('Outside fixture root');
      res.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  // A failed browser launch must not leave a server keeping the test alive.
  server.unref();
  return server;
}
export async function closeStaticServer(server) {
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}
