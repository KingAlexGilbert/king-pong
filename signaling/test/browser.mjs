import assert from 'node:assert/strict';
import {
  createServer
} from 'node:http';
import {
  readFile
} from 'node:fs/promises';
import {
  fileURLToPath
} from 'node:url';
import {
  Miniflare,
  convertV4MiniflareOptions
} from 'miniflare';
import {
  chromium
} from 'playwright';

const forceRelay = Boolean(process.env.KING_PONG_TEST_TURN_URL);
const root = new URL('../../docs/', import.meta.url);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path.includes('..')) throw new Error();
    const file = new URL('.' + path + (path.endsWith('/') ? 'index.html' : ''), root);
    const data = await readFile(file);
    response.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : file.pathname.endsWith(
      '.html') ? 'text/html' : 'application/octet-stream');
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: ['./worker-fixture.mjs', '../src/worker.js', '../src/metered-turn.js', '../src/matchmaking.js', '../src/matchmaking-contract.js', '../src/native-bridge.js', '../src/party-room.js'].map(path => ({
    type: 'ESModule',
    path: fileURLToPath(new URL(path, import.meta.url))
  })),
  modulesRoot: fileURLToPath(new URL('../', import.meta.url)),
  compatibilityDate: '2025-09-06',
  durableObjects: {
    MATCHMAKING: {className: 'MatchmakingQueue', useSQLite: true},
    ROOMS: {
      className: 'PongRoom',
      useSQLite: true
    },
    TURN_CREDENTIALS: {
      className: 'MeteredTurn',
      useSQLite: true
    }
  },
  bindings: {
    ALLOWED_ORIGINS: origin,
    METERED_APP_NAME: 'king-pong-test',
    METERED_SECRET_KEY: 'local-test'
  },
  outboundService: async request => {
    if (!forceRelay) return new Response('', {
      status: 503
    });
    if (request.method === 'POST') return Response.json({
      apiKey: 'expiring-test-key',
      expiryInSeconds: 172800
    });
    return Response.json([{
      urls: process.env.KING_PONG_TEST_TURN_URL,
      username: process.env.KING_PONG_TEST_TURN_USERNAME,
      credential: process.env.KING_PONG_TEST_TURN_PASSWORD
    }]);
  },
  ratelimits: {
    ROOM_LIMITER: {
      namespace_id: '2',
      simple: {
        limit: 100,
        period: 60
      }
    }
  }
}));
const signaling = (await mf.ready).origin;
if (forceRelay) {
  const response = await mf.dispatchFetch(signaling + '/v1/turn/ready');
  assert.equal(response.status, 503);
  const namespace = await mf.getDurableObjectNamespace('TURN_CREDENTIALS');
  const ready = await namespace.get(namespace.idFromName('metered')).fetch('https://turn/test-propagated');
  assert.equal(ready.status, 200);
}
const browser = await chromium.launch({
  headless: true,
  args: ['--allow-loopback-in-peer-connection', '--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
});
const errors = [];
async function page(locale = 'en-US') {
  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 900
    },
    locale
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    errors.push('Unexpected dialog: ' + dialog.type());
    await dialog.dismiss();
  });
  await page.route('**/online-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.KING_PONG_SIGNALING_URL = ${JSON.stringify(signaling)};`
  }));
  if (forceRelay) await page.addInitScript(() => {
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(config) {
        super(config.iceTransportPolicy === 'all' ? {
          iceServers: [],
          iceTransportPolicy: 'relay'
        } : config);
      }
    };
  });
  await page.goto(origin + '/demo/');
  await page.locator('#titleLanButton').click();
  return page;
}
async function waitFor(page, expression) {
  try {
    await page.waitForFunction(expression, null, {
      timeout: 15_000
    });
  } catch (error) {
    console.log('DEBUG', expression, await page.evaluate(() => ({
      status: lanStatus.textContent,
      role: lanRole,
      connected: lanConnected,
      blocked: onlineGameBlocked,
      paused,
      rightY: right.y,
      receivedInputSeq: lanLastInputSeq,
      appliedInputSeq: onlineAppliedInputSeq,
      remoteInput: lanRemoteInput,
      compactWire: onlineWireReady,
      inputIntent: onlineIntentReady
    })), errors);
    throw error;
  }
}
try {
  const host = await page();
  await host.locator('#lanHostButton').click();
  await waitFor(host, "lanRoomCode.length === 6");
  const code = await host.locator('#onlineRoomCode').textContent();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(await host.locator('#lanStatus').textContent(), 'Waiting for Player 2...');
  await host.screenshot({
    path: '/tmp/king-pong-host-room.png'
  });
  const guest = await page();
  await guest.locator('#lanJoinButton').click();
  await guest.locator('#lanRoomCodeInput').fill('OOOOO');
  await guest.locator('#onlineJoinSubmit').click();
  assert.match(await guest.locator('#lanStatus').textContent(), /valid five- or six-character room code/);
  await guest.locator('#lanRoomCodeInput').fill(code.toLowerCase());
  await guest.locator('#onlineJoinSubmit').click();
  await host.locator('#saveConfirmAccept').click();
  await Promise.all([waitFor(host, 'lanConnected'), waitFor(guest, 'lanConnected && onlineHasState')]);
  await Promise.all([waitFor(host, "onlineMatchFlow?.phase === 'ready'"), waitFor(guest, "onlineMatchFlow?.phase === 'ready'")]);
  await host.locator('#onlineReadyButton').click();
  await guest.locator('#onlineReadyButton').click();
  await Promise.all([waitFor(host, "onlineMatchFlow?.phase === 'playing'"), waitFor(guest, "onlineMatchFlow?.phase === 'playing'")]);
  assert.equal(await host.locator('#lanStatus').textContent(), 'Connected!');
  assert.equal(await guest.evaluate(() => onlineControlChannel.ordered), true);
  assert.equal(await host.evaluate(() => lanChannel.ordered), false);
  assert.equal(await guest.evaluate(() => onlineSession.attempt), forceRelay ? 1 : 0);
  if (forceRelay) {
    const type = await guest.evaluate(async () => {
      const stats = await lanPeer.getStats();
      const transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
      const pair = stats.get(transport.selectedCandidatePairId);
      return stats.get(pair.localCandidateId).candidateType;
    });
    assert.equal(type, 'relay');
    console.log('PASS: failed direct connection automatically falls back to a real TURN relay candidate');
  }
  console.log('PASS: UI Create Room → six-character code → Join Room → two real WebRTC peers');

  // Delay outgoing gameplay traffic, with periodic stale state delivery and loss.
  for (const p of [host, guest]) await p.evaluate(() => {
    const original = lanChannel.send.bind(lanChannel);
    let count = 0;
    lanChannel.send = payload => {
      count++;
      if (count % 13 === 0) return;
      setTimeout(() => {
        if (lanChannel?.readyState === 'open') original(payload);
      }, count % 7 === 0 ? 220 : 90);
    };
  });
  await host.evaluate(() => {
    gameWindowFocused = true;
    paused = false;
    waitingForServe = true;
  });
  await waitFor(guest, '!paused');
  const before = await guest.evaluate(() => right.y);
  await guest.evaluate(() => {
    gameWindowFocused = true;
    keys.add('ArrowDown');
  });
  await waitFor(guest, `right.y > ${before + 10}`);
  // Keep the key held until its movement reaches the authoritative host.
  // Guest prediction can cross 10px before the deliberately delayed/lossy
  // packets arrive, making an immediate release an unrealistically short tap.
  await waitFor(host, `right.y > ${before + 10}`);
  // Do not compare positions after an arbitrary delay: the network shim can
  // reorder or drop the final release. First require authoritative acknowledgment
  // of the *release* input, then verify positions actually settle.
  const releaseSeq = await guest.evaluate(() => {
    keys.clear();
    sendLanInput(null, true);
    return lanInputSeq;
  });
  const convergenceDeadline = Date.now() + 5000;
  let observed;
  let matchingSamples = 0;
  do {
    const hostState = await host.evaluate(() => ({
      y: right.y, receivedSeq: lanLastInputSeq, appliedSeq: onlineAppliedInputSeq,
      remoteInput: {axis: lanRemoteInput.axis, targetY: lanRemoteInput.targetY},
      paused, blocked: onlineGameBlocked
    }));
    const guestState = await guest.evaluate(() => ({
      y: right.y, ack: onlineInputAck, sentSeq: lanInputSeq,
      pending: onlineInputs.size, lastInput: onlineLastInput && {
        axis: onlineLastInput.axis, targetY: onlineLastInput.targetY,
        proofSeq: onlineLastInput.proofSeq
      },
      lastStateSeq: lanLastStateSeq, intent: onlineIntentReady,
      paused, blocked: onlineGameBlocked
    }));
    observed = {host: hostState, guest: guestState, releaseSeq};
    if (guestState.ack >= releaseSeq && Math.abs(hostState.y - guestState.y) < 2) {
      if (++matchingSamples >= 2) break;
    } else matchingSamples = 0;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < convergenceDeadline);
  assert.ok(matchingSamples >= 2,
    'paddles failed to converge after release acknowledgment: ' + JSON.stringify(observed));
  console.log(
    'PASS: responsive guest paddle and convergence with 180 ms RTT, jitter, reordering and ~8% snapshot/input loss');

  await guest.evaluate(() => requestServeOrContinue());
  await waitFor(host, '!waitingForServe');
  await host.evaluate(() => {
    left.score = 4;
    right.score = 2;
    sendLanState(true);
  });
  await waitFor(guest, 'left.score === 4 && right.score === 2');
  await guest.waitForTimeout(200);
  await guest.evaluate(() => requestTogglePause());
  await waitFor(host, 'paused');
  await waitFor(guest, 'paused');
  console.log('PASS: reliable guest serve/pause, host-owned scoring and snapshots');

  const third = await page();
  await third.locator('#lanJoinButton').click();
  await third.locator('#lanRoomCodeInput').fill(code);
  await third.locator('#onlineJoinSubmit').click();
  await waitFor(third, "lanStatus.textContent.includes('already full')");
  await third.close();
  await guest.close();
  // Private rooms deliberately retain the host's signaling socket and room
  // code after a guest leaves so another guest can join the same room.
  await waitFor(host, "lanStatus.textContent.includes('Waiting for Player 2')");
  assert.equal(await host.evaluate(() => onlineGameBlocked && paused && !lanPeer && !lanChannel), true);
  assert.equal(await host.locator('#onlineRoomCode').textContent(), code);
  console.log('PASS: room full and guest disconnect leave a paused host room with the same code');

  const secondGuest = await page();
  await secondGuest.locator('#lanJoinButton').click();
  await secondGuest.locator('#lanRoomCodeInput').fill(code);
  await secondGuest.locator('#onlineJoinSubmit').click();
  await host.locator('#saveConfirmAccept').click();
  await Promise.all([waitFor(host, 'lanConnected'), waitFor(secondGuest, 'lanConnected && onlineHasState')]);
  await Promise.all([waitFor(host, "onlineMatchFlow?.phase === 'ready'"),
    waitFor(secondGuest, "onlineMatchFlow?.phase === 'ready'")]);
  console.log('PASS: replacement guest joins the retained private room and reaches Ready');
  // The RTC channel can close before the signaling server sends 'host_left'.
  // Keep private-room signaling alive so the guest receives that reason.
  await secondGuest.evaluate(() => onlineControlChannel.onclose());
  assert.equal(await secondGuest.evaluate(() => onlineSession && !onlineSession.closed && onlineGameBlocked && paused), true);
  await host.keyboard.press('Escape');
  await waitFor(secondGuest, "lanStatus.textContent.includes('Host disconnected')");
  assert.equal(await secondGuest.evaluate(() => onlineGameBlocked && paused), true);
  await secondGuest.close();
  console.log('PASS: leaving for the title screen closes the room and stops the guest');

  const localized = await page('es-ES');
  assert.equal(await localized.locator('#lanHostButton').textContent(), 'Crear sala');
  await localized.locator('#lanJoinButton').click();
  await localized.locator('#lanRoomCodeInput').fill('OOOOO');
  await localized.locator('#onlineJoinSubmit').click();
  assert.match(await localized.locator('#lanStatus').textContent(), /código válido/);
  await localized.close();

  await host.evaluate(() => showTitleScreen());
  await host.locator('#titleCampaignButton').click();
  assert.equal(await host.evaluate(() => mode), 1);
  await host.evaluate(() => {
    gameWindowFocused = true;
    paused = false;
    requestServeOrContinue();
  });
  const x = await host.evaluate(() => ball.x);
  await waitFor(host, `ball.x !== ${x}`);
  await host.evaluate(() => {
    loadSaveSlot(1);
    saveData.completedLevels[0] = true;
    saveData.highestUnlockedLevel = 1;
    setMusicVolume(37);
    setMusicEnabled(false);
  });
  assert.equal(await host.evaluate(() => musicVolumeLevel), 0.37);
  assert.equal(await host.evaluate(() => musicEnabled), false);
  await host.reload();
  assert.equal(await host.evaluate(() => activeSaveSlot), 1);
  assert.equal(await host.evaluate(() => saveData.completedLevels[0]), true);
  assert.equal(await host.evaluate(() => saveData.highestUnlockedLevel), 1);
  assert.equal(await host.evaluate(() => musicVolumeLevel), 0.37);
  assert.equal(await host.evaluate(() => musicEnabled), false);
  await host.bringToFront();
  await host.locator('#titleLocalButton').click();
  await host.locator('#matchSetup').waitFor({
    state: 'visible'
  });
  assert.equal(await host.locator('#royalGallery').isVisible(), false);
  assert.equal(await host.evaluate(() => mode === 2 && !onlineGameBlocked && !isLanActive()), true);
  assert.equal(await host.evaluate(() => waitingForServe), true);
  assert.equal(await host.locator('#matchServe').isEnabled(), true);
  await host.locator('#matchServe').click();
  await host.locator('#matchSetup').waitFor({
    state: 'hidden'
  });
  await waitFor(host, '!waitingForServe && !paused');
  const localX = await host.evaluate(() => ball.x);
  await waitFor(host, `ball.x !== ${localX}`);
  const paddles = await host.evaluate(() => ({
    left: left.y,
    right: right.y
  }));
  await host.keyboard.down('w');
  await host.keyboard.down('ArrowDown');
  try {
    await waitFor(host, `left.y < ${paddles.left} && right.y > ${paddles.right}`);
  } finally {
    await host.keyboard.up('w');
    await host.keyboard.up('ArrowDown');
  }
  console.log(
    'PASS: Spanish UI, campaign physics, campaign/slot persistence and music controls, and local two-player controls');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await mf.dispose();
  await new Promise(resolve => server.close(resolve));
}
