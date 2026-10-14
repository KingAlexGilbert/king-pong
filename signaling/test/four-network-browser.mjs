import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {builds, root} from '../../tests/helpers/game-source.mjs';
// Real worker/WebSocket + production HTML and data-channel handlers. Only ICE and
// channel delivery are controlled here. This does not measure an actual network route.
const mfOptions = {
  modules: ['party-fixture.mjs', '../src/worker.js', '../src/party-room.js', '../src/metered-turn.js', '../src/matchmaking.js', '../src/matchmaking-contract.js', '../src/native-bridge.js'].map(path => ({type: 'ESModule', path: fileURLToPath(new URL(path, import.meta.url))})),
  modulesRoot: fileURLToPath(new URL('../', import.meta.url)), compatibilityDate: '2025-09-06', host: '127.0.0.1', port: 0,
  durableObjects: {ROOMS: {className: 'TestPongRoom', useSQLite: true}, MATCHMAKING: {className: 'MatchmakingQueue', useSQLite: true}, TURN_CREDENTIALS: {className: 'TestTurn', useSQLite: true}},
  bindings: {ALLOWED_ORIGINS: ''}, ratelimits: {ROOM_LIMITER: {namespace_id: 'four-browser', simple: {limit: 1000, period: 60}}}
};
const server = createServer(async (req, res) => {
  try { const file = new URL('.' + new URL(req.url, 'http://localhost').pathname, root); if (!file.href.startsWith(root.href)) throw Error();
    res.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
mfOptions.bindings.ALLOWED_ORIGINS = origin;
const mf = new Miniflare(convertV4MiniflareOptions(mfOptions));
const workerUrl = (await mf.ready).origin;
const browser = await chromium.launch({headless: true});
const pages = [], errors = [], pending = new Set(), bytes = [0, 0, 0, 0];
let faults = false, blackout = false, packet = 0, enabled = true;
async function deliver(index, to, raw, reliable) {
  if (!enabled) return;
  const target = pages[to]; if (!target) return;
  bytes[index] += Buffer.byteLength(raw);
  if (blackout || faults && !reliable && ++packet % 7 === 0) return;
  const delay = faults ? 18 + packet % 9 * 4 : 0;
  const job = new Promise(r => setTimeout(r, delay)).then(() => target.evaluate(({index, raw, reliable}) => {
    const link = fourView.session?.transport.peers.get(index);
    (reliable ? link?.control : link?.data)?.onmessage?.({data: raw});
  }, {index, raw, reliable})).catch(e => { if (enabled) errors.push(e.message); }).finally(() => pending.delete(job));
  pending.add(job);
}
async function pump() { for (let i = 0; i < 10 && pending.size; i++) await Promise.all([...pending]); }
const check = label => console.log('PASS: ' + label);
try {
  for (const [index, [platform, file]] of Object.entries(builds).entries()) {
    const p = await browser.newPage({viewport: {width: index === 3 ? 844 : 1280, height: index === 3 ? 390 : 800}}); pages.push(p);
    const wait = p.waitForFunction.bind(p); p.waitForFunction = (fn, arg, options = {}) => wait(fn, arg, {polling: 50, ...options});
    p.on('pageerror', e => errors.push(platform + ': ' + e.message));
    await p.exposeBinding('testDeliver', (source, {to, raw, reliable}) => { deliver(index, to, raw, reliable); });
    await p.addInitScript(({workerUrl}) => {
      window.requestAnimationFrame = () => 1; window.testNow = 5000; performance.now = () => testNow;
      Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => workerUrl, set() {}});
      window.addEventListener('blur', e => e.stopImmediatePropagation(), true);
    }, {workerUrl});
    await p.goto(origin + '/' + file);
    await p.evaluate(() => {
      document.documentElement.requestFullscreen = async () => { throw Error('Test viewport'); };
      gameWindowFocused = true; saveData.muteAll = true;
      const receive = KingPongRoom.prototype.receive;
      KingPongRoom.prototype.receive = async function (m) {
        if (m.type !== 'start') return receive.call(this, m);
        this.attempt = m.attempt;
        const peer = this.peer = {connectionState: 'connected', close() { this.connectionState = 'closed'; }, getStats: async () => new Map()};
        for (const reliable of [false, true]) {
          const owner = this;
          this.wire({readyState: 'open', bufferedAmount: 0, close() { this.readyState = 'closed'; }, send(raw) {
            const to = [...fourView.session.transport.peers].find(([, link]) => link === owner)?.[0];
            if (to !== undefined) window.testDeliver({to, raw, reliable});
          }}, reliable, peer);
        }
        this.maybeConnected(peer);
      };
    });
    await p.locator('.primary-online').click(); await p.locator('#onlineFourPlayers').click();
  }
  const [host, ...guests] = pages;
  await host.locator('#fourApproval').check(); await host.locator('#fourFillBots').check(); await host.locator('#fourHost').click();
  await host.waitForFunction(() => fourView.session?.lobby?.config, null, {timeout: 5000}).catch(async e => { console.log('DEBUG', await host.evaluate(() => ({status: fourView.networkStatus.textContent, closed: fourView.session?.closed, lobby: fourView.session?.lobby, url: window.KING_PONG_SIGNALING_URL})), errors); throw e; });
  const code = await host.locator('#fourRoomCode').textContent(); assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  for (let i = 0; i < guests.length; i++) {
    const g = guests[i]; await g.locator('#fourCodeInput').fill(code); await g.locator('#fourJoin').click();
    await host.waitForFunction(() => fourView.session.lobby.pending.length === 1);
    assert.equal(await g.evaluate(() => fourView.session.transport.peers.size), 0);
    await host.locator('#fourRoster button').filter({hasText: 'Accept'}).click();
    await g.waitForFunction(() => fourView.session.hellos.has(0)); await host.waitForFunction(i => fourView.session.hellos.has(i + 1), i);
    await g.waitForFunction(() => !byId('fourReady').disabled); await g.locator('#fourReady').click();
  }
  await host.waitForFunction(() => fourView.session.lobby.players.slice(1).every(p => p.ready));
  check('real worker approval assigns slots; pending guests cannot open gameplay channels');
  await host.locator('#fourWait').click();
  for (const p of pages) await p.waitForFunction(() => fourView.active, null, {timeout: 6000}).catch(async e => { console.log('START DEBUG', await Promise.all(pages.map(page => page.evaluate(() => ({side: fourView.side, active: fourView.active, closed: fourView.session?.closed, status: fourView.networkStatus.textContent, lobby: fourView.session?.lobby, serial: fourView.session?.matchSerial, hellos: [...fourView.session.hellos], drops: fourView.session.stats.dropped, pending: Boolean(fourView.session.pendingInit)})))), errors); throw e; });
  for (const p of pages) assert.deepEqual(await p.evaluate(() => fourView.state.config.bots), [false, false, false, false]);
  check('four ready humans start immediately with zero bots, even when optional bot fill is on');
  await pump();
  for (const p of pages) await p.evaluate(() => { fourView.state.countdown = 0; fourView.previousAt = null; });
  faults = true;
  const started = performance.now();
  for (let frame = 0; frame < 180; frame++) {
    for (const [i, p] of pages.entries()) await p.evaluate(({frame, i}) => {
      gameWindowFocused = true; testNow += 1000 / 60;
      const session = fourView.session, axis = frame < 60 ? (i % 2 ? 1 : -1) : 0;
      session.tick({axis, target: null}, performance.now());
      fourView.current = KingPongFour.unpack(KingPongFour.pack(fourView.state), fourView.state.config); fourView.previous = fourView.current;
      fourView.paint(session.visual(performance.now())); fourView.syncScores();
    }, {frame, i});
  }
  await pump(); faults = false;
  await host.evaluate(() => fourView.session.snapshot(true)); await pump();
  const authoritative = await host.evaluate(() => KingPongFour.pack(fourView.state));
  for (const p of guests) assert.deepEqual(await p.evaluate(() => KingPongFour.pack(fourView.state)), authoritative);
  check('four production clients converge after simulated latency, jitter and 1-in-7 packet loss');
  const report = {transport: 'controlled channels; real Worker signaling',harnessElapsedMs: performance.now() - started, simulatedSeconds: 3, applicationBytesSent: bytes.slice(),
    stats: await Promise.all(pages.map(p => p.evaluate(() => fourView.session.stats)))};
  const before = await host.evaluate(() => fourView.state.paddles[1].pos);
  await guests[0].evaluate(() => {
    const s = fourView.session; s.transport.data(0, ['k4', 1, s.match, 'i', 9999, 100, 99999]);
    s.transport.data(0, ['k4', 1, s.match, 's', 99999, -1, KingPongFour.pack(fourView.state)]);
  }); await pump();
  assert.equal(await host.evaluate(() => fourView.state.paddles[1].pos), before);
  check('forged positions and snapshots cannot move the host paddle or overwrite scores');
  await guests[1].evaluate(() => fourView.action('pause')); await pump();
  for (const p of pages) assert.equal(await p.evaluate(() => fourView.state.paused), true);
  await host.locator('#fourCloseMenu').click(); assert.equal(await host.evaluate(() => fourView.state.paused && fourView.menu.hidden), true);
  await host.evaluate(() => fourView.action('resume')); await pump();
  for (const p of pages) assert.equal(await p.evaluate(() => fourView.state.countdown), 180);
  check('guest pause, closed-menu PAUSED and host-controlled three-second resume synchronize');
  blackout = true;
  await host.evaluate(() => { fourView.state.countdown = 0; for (let i = 0; i < 60; i++) fourView.session.tick({axis: 0, target: null}, performance.now()); });
  blackout = false; await host.evaluate(() => fourView.session.snapshot(true)); await pump();
  const recovered = await host.evaluate(() => KingPongFour.pack(fourView.state));
  for (const p of guests) assert.deepEqual(await p.evaluate(() => KingPongFour.pack(fourView.state)), recovered);
  check('self-contained snapshot restores every guest after a simulated blackout');
  await host.evaluate(() => fourView.action('rematch')); await pump();
  for (const p of pages) assert.equal(await p.evaluate(() => fourView.state.tick), 0);
  check('reliable rematch uses a new match token and generation');
  await host.evaluate(() => { fourView.action('pause'); }); await pump();
  await host.locator('#fourGameKick1').click();
  await guests[0].waitForFunction(() => fourView.session.closed && !!fourView.disconnectedMessage);
  assert.match(await guests[0].evaluate(() => fourView.disconnectedMessage), /removed/);
  check('host kick displays a clear reason and terminates the affected match safely');
  assert.deepEqual(errors, []);
  if (process.env.KING_PONG_TEST_ARTIFACTS) { await mkdir(process.env.KING_PONG_TEST_ARTIFACTS, {recursive: true}); await writeFile(process.env.KING_PONG_TEST_ARTIFACTS + '/four-network.json', JSON.stringify(report, null, 2)); }
  console.log('MEASUREMENTS: ' + JSON.stringify(report));
  console.log('RESULT: simulated network conditions, actual browser/Worker execution; no physical route or TURN bandwidth measurement.');
} finally {
  enabled = false; await pump(); await browser.close(); await mf.dispose(); await new Promise(r => server.close(r));
}
