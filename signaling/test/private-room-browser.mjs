import assert from 'node:assert/strict';
import {publicPowerupCases} from './public-powerups-cases.mjs';
import {
  createServer
} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
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
const errors = [], queueTraffic = [];
// This explicit fallback keeps real Worker/WebSocket admission and real pages,
// but replaces RTC channels. The default mode still requires actual WebRTC.
const controlledChannels = process.argv.includes('--controlled-channels');
const testPages = [];
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {recursive:true});
let deliveries = Promise.resolve();
let browserClosing = false;
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
  page.on('websocket', socket => { if(socket.url().includes('/v1/queue/'))socket.on('framesent',e=>{if(e.payload!=='ping')queueTraffic.push({url:socket.url(),message:JSON.parse(e.payload)});}); });
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
  if (controlledChannels) await installControlledChannels(page);
  testPages.push(page);
  await page.goto(origin + '/demo/');
  await page.locator('#titleLanButton').click();
  return page;
}
async function installControlledChannels(page) {
  await page.exposeFunction('deliverTestChannel', (raw,state) => {
    deliveries = deliveries.then(async () => {
      if (browserClosing || page.isClosed()) return;
      for (const target of testPages) {
        if (target === page || target.isClosed()) continue;
        await target.evaluate(({raw,state}) => {
          if (typeof onlineSession !== 'undefined' && onlineSession && lanRoomCode === state.room && lanRole !== state.role) onlineSession.control?.onmessage?.({data:raw});
        }, {raw,state}).catch(error => {
          // Navigation discards the old controlled endpoint, just like closing RTC.
          if (!target.isClosed() && !error.message.includes('Execution context was destroyed')) throw error;
        });
      }
    }).catch(error => { if (!browserClosing) errors.push(error.message); });
  });
  await page.addInitScript(() => {
    window.RTCPeerConnection = class {
      connectionState='new'; channels=[];
      constructor() { this.iceGatheringState='complete'; }
      createDataChannel(label) {
        const c={label,readyState:'connecting',bufferedAmount:0,ordered:label!=='pong-lan-input-v1',
          send(raw){window.deliverTestChannel(raw,{room:lanRoomCode,role:lanRole})},close(){this.readyState='closed'}};
        this.channels.push(c); return c;
      }
      async createOffer(){return {type:'offer',sdp:'v=0\r\na=fingerprint:sha-256 '+Array(32).fill('AA').join(':')+'\r\n'}}
      async createAnswer(){return {type:'answer',sdp:'v=0\r\na=fingerprint:sha-256 '+Array(32).fill('BB').join(':')+'\r\n'}}
      async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};if(d.type==='answer')this.openChannels()}
      async setRemoteDescription(d){
        this.remoteDescription=d;
        if(d.type==='offer')for(const label of ['pong-lan-input-v1','pong-control-v1'])this.ondatachannel({channel:this.createDataChannel(label)});
        else this.openChannels();
      }
      openChannels(){setTimeout(()=>{if(this.connectionState==='closed')return;this.connectionState='connected';for(const c of this.channels){c.readyState='open';c.onopen?.()}this.onconnectionstatechange?.()},30)}
      async addIceCandidate(){}
      async getStats(){return new Map()}
      close(){this.connectionState='closed'}
    };
  });
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
      inputIntent: onlineIntentReady, flow: onlineMatchFlow,
      peerState: lanPeer?.connectionState, iceState: lanPeer?.iceConnectionState
    })), errors);
    throw error;
  }
}
async function pendingPin(host,guest) {
  await host.locator('#approvalHostPin output').waitFor({state:'visible'});
  await guest.locator('#approvalGuestPin').waitFor({state:'visible'});
  const pin=await host.locator('#approvalHostPin output').innerText();
  assert.match(pin,/^\d{3} \d{3}$/);
  assert.equal(pin,await guest.locator('#approvalGuestPin').innerText());
  assert.equal(await host.locator('#saveConfirmAccept').isEnabled(),true);
  for(const p of [host,guest]) {
    assert.equal(await p.evaluate(()=>onlineSession.peer==null),true,'no RTC peer before approval');
    assert.equal(await p.evaluate(()=>lanConnected),false);
  }
  assert.equal(await host.locator('#privatePairing').count(),0);
  assert.equal(await host.locator('#pairingAccept').isVisible(),false);
}
try {
  if(process.argv.includes('--public-powerups'))await publicPowerupCases({page,waitFor,queueTraffic,errors});
  else {
  console.log(controlledChannels ? 'MODE controlled RTC channels, real Worker and WebSockets' : 'MODE actual WebRTC');
  const host = await page();
  assert.equal(await host.locator('#onlineRequireApproval').locator('..').innerText(),'Host Approval');
  assert.equal(await host.locator('#onlineRequireApproval').isChecked(), true);
  await host.evaluate(() => {
    setMatchRule('quick'); setMatchPowerups(false);saveData.royalArena=7;
    savePlayerPreference('multiplayerPaddle','boss-8');resetMultiplayerPaddleChoices();
  });
  await host.locator('#lanHostButton').click();
  await waitFor(host, 'lanRoomCode.length === 6');
  const code = await host.evaluate(() => lanRoomCode);
  const guest = await page();
  await guest.evaluate(() => { savePlayerPreference('royalPowerupsEnabled', true); savePlayerPreference('matchRuleId', 'endless'); });
  async function join(p) {
    await p.evaluate(code => { openOnlineRoom('guest', code); }, code);
  }
  await join(guest);
  await pendingPin(host,guest);
  if (artifacts) await host.screenshot({path:artifacts+'/private-approval.png'});
  assert.equal(await guest.evaluate(() => lanConnected), false);
  await host.locator('#saveConfirmCancel').click();
  await waitFor(guest, "lanLastStatus === ONLINE_ERRORS.rejected");
  await join(guest);
  await waitFor(guest, "lanLastStatus === ONLINE_ERRORS.blocked");
  assert.equal(await host.evaluate(() => onlineSession.pendingRequests.length), 0);
  console.log('PASS matching preconnection PINs, no RTC before approval, optional comparison, rejection, and same-session rejoin block');


  const peer = await page();
  await peer.evaluate(()=>{
    savePlayerPreference('multiplayerPaddle','enemy-15');resetMultiplayerPaddleChoices();
    savePlayerPreference('royalPowerupsEnabled',true);savePlayerPreference('matchRuleId','endless');
  });
  await join(peer);
  await pendingPin(host,peer);
  await host.locator('#saveConfirmAccept').click();
  await Promise.all([waitFor(host, "onlineMatchFlow?.phase === 'ready'"),waitFor(peer, "onlineMatchFlow?.phase === 'ready'")]);
  for (const p of [host, peer]) {
    assert.equal(await p.locator('#matchSetup').isVisible(), false);
    assert.deepEqual(await p.evaluate(() => [matchRuleId,matchPowerupsEnabled,waitingForServe,paused]), ['quick',false,true,true]);
    assert.deepEqual(await p.evaluate(()=>selectionPayload()),{arena:7,left:'boss-8',right:'enemy-15'});
    assert.equal(await p.evaluate(()=>setMatchPowerups(true)),false,'configuration locked after initialization');
    assert.equal(await p.evaluate(()=>{
      const original=drawOverlay;let calls=0;drawOverlay=()=>calls++;
      draw(captureVisualState());drawOverlay=original;return calls;
    }),0,'ready/countdown flow does not also draw the paused/serve overlay');
  }
  assert.equal(await host.evaluate(() => twoPlayerViewMirrored()), false);
  assert.equal(await peer.evaluate(() => twoPlayerViewMirrored()), true);
  if (artifacts) await peer.screenshot({path:artifacts+'/private-ready.png'});
  await host.locator('#onlineReadyButton').click();
  await host.locator('#onlineReadyButton').click();
  assert.equal(await host.evaluate(() => onlineMatchFlow.localReady), false);
  await peer.locator('#onlineReadyButton').click();
  await waitFor(host, 'onlineMatchFlow.guestReady');
  assert.equal(await host.evaluate(() => onlineMatchFlow.phase), 'ready');
  await host.locator('#onlineReadyButton').click();
  await Promise.all([waitFor(host, "onlineMatchFlow?.phase === 'playing'"),waitFor(peer, "onlineMatchFlow?.phase === 'playing'")]);
  assert.equal(await host.locator('#arenaKick').isVisible(), true);
  assert.equal(await peer.locator('#arenaKick').isVisible(), false);
  assert.equal(await host.evaluate(() => menuToggle.nextElementSibling.id), 'arenaKick');
  await host.evaluate(()=>{paused=true;sendLanState(true);syncRoyalUi(true)});
  for (const viewport of [{width:1280,height:900},{width:390,height:844},{width:844,height:390}]) {
    await host.setViewportSize(viewport);
    await host.evaluate(()=>{handleViewportChange();syncRoyalUi(true);renderFrame(1,performance.now())});
    const menu=await host.locator('#menuToggle').boundingBox(),kick=await host.locator('#arenaKick').boundingBox(),arena=await host.locator('#game').boundingBox();
    assert.ok(kick.x>=menu.x+menu.width && Math.abs(kick.y-menu.y)<2 && kick.x+kick.width<=viewport.width);
    assert.ok(kick.y+kick.height<=arena.y+1, 'moderation controls stay above the playfield');
    if(artifacts) await host.screenshot({path:artifacts+'/private-host-'+viewport.width+'.png'});
  }
  await host.setViewportSize({width:1280,height:900});
  await host.evaluate(() => { gameWindowFocused=true; paused=false; waitingForServe=false; for(let i=0;i<700;i++) updateRoyalPowerups(); });
  assert.equal(await host.evaluate(() => royalPickup), null);
  console.log('PASS private configuration, ready withdrawal, synchronized start, powerups disabled, perspective and kick visibility');

  await host.locator('#arenaKick').click();
  await host.locator('#saveConfirmCancel').click();
  assert.equal(await host.evaluate(() => lanConnected), true);
  await host.locator('#arenaKick').click();
  await host.locator('#saveConfirmAccept').click();
  await waitFor(peer, 'lanLastStatus === ONLINE_ERRORS.kicked');
  assert.deepEqual(await peer.evaluate(()=>[matchRuleId,matchPowerupsEnabled]),['endless',true]);
  await waitFor(host, "!lanConnected && onlineSession?.managed && lanRole === 'host'");
  assert.equal(await host.evaluate(() => lanRoomCode), code);
  await join(peer);
  await waitFor(peer, 'lanLastStatus === ONLINE_ERRORS.blocked');
  console.log('PASS kick confirmation, guest notification, retained host room and reconnect block');

  // Another approved participant can use the retained room; cancellation during
  // countdown cannot leave a queued serve or old powerup state in that room.
  const replacement=await page();await join(replacement);await pendingPin(host,replacement);await host.locator('#saveConfirmAccept').click();
  await Promise.all([waitFor(host,"onlineMatchFlow?.phase === 'ready'"),waitFor(replacement,"onlineMatchFlow?.phase === 'ready'")]);
  await host.locator('#onlineReadyButton').click();await replacement.locator('#onlineReadyButton').click();
  await waitFor(replacement,"onlineMatchFlow?.phase === 'countdown'");
  await replacement.locator('#onlineFlowBack').click();
  await waitFor(host,"onlineMatchFlow === null && !lanConnected");
  assert.deepEqual(await host.evaluate(()=>[waitingForServe,paused,resumeCountdownEndAt,royalPickup,royalSplitBall]),[true,true,0,null,null]);
  assert.equal(await host.evaluate(()=>lanRoomCode),code);
  console.log('PASS retained-room replacement, new initialization and countdown-disconnect cleanup');

  await host.evaluate(() => { closeOnlineConnection(false); startOnlineSetup(); });
  await host.locator('#onlineRequireApproval').uncheck();
  await host.evaluate(() => setMatchPowerups(true));
  await host.reload();
  await host.locator('#titleLanButton').click();
  assert.equal(await host.locator('#onlineRequireApproval').isChecked(), false);
  assert.equal(await host.evaluate(() => matchPowerupsEnabled), true);
  await host.locator('#lanHostButton').click();
  await waitFor(host,'lanRoomCode.length === 6');
  const next = await page();
  await next.evaluate(code => openOnlineRoom('guest',code), await host.evaluate(() => lanRoomCode));

  await Promise.all([waitFor(host, "onlineMatchFlow?.phase === 'ready'"),waitFor(next, "onlineMatchFlow?.phase === 'ready'")]);
  assert.equal(await host.locator('#saveConfirmOverlay').isVisible(), false);
  for(const p of [host,next]) { assert.equal(await p.locator('#approvalGuest').isVisible(),false); assert.equal(await p.evaluate(()=>onlineSession.approvalPairs?.size||0),0); }
  await host.locator('#onlineReadyButton').click(); await next.locator('#onlineReadyButton').click();
  await waitFor(host, "onlineMatchFlow?.phase === 'playing'");
  const spawned=await host.evaluate(() => {
    gameWindowFocused=true; paused=false; waitingForServe=false; royalRallyTick=179; updateRoyalPowerups();
    paused=true;sendLanState(true);return [royalPickup.type,royalPickup.x,royalPickup.y];
  });
  await waitFor(next,'royalPickup !== null');
  assert.deepEqual(await next.evaluate(()=>[royalPickup.type,royalPickup.x,royalPickup.y]),spawned);
  console.log('PASS approval off, reload persistence and peer powerup spawn synchronization');

  // A private guest's RTC channel may close before the host's signaling
  // departure reaches it. The guest must freeze, retain signaling briefly,
  // and report the specific host departure instead of generic opponent loss.
  const closingHost=await page();
  await closingHost.locator('#onlineRequireApproval').uncheck();
  await closingHost.locator('#lanHostButton').click();
  await waitFor(closingHost,'lanRoomCode.length === 6');
  const closingGuest=await page();
  await closingGuest.evaluate(code=>openOnlineRoom('guest',code),await closingHost.evaluate(()=>lanRoomCode));
  await Promise.all([waitFor(closingHost,"onlineMatchFlow?.phase === 'ready'"),waitFor(closingGuest,"onlineMatchFlow?.phase === 'ready'")]);
  await closingGuest.evaluate(()=>onlineControlChannel.onclose());
  assert.equal(await closingGuest.evaluate(()=>Boolean(onlineSession&&!onlineSession.closed&&onlineGameBlocked&&paused)),true);
  await closingHost.evaluate(()=>showTitleScreen());
  await waitFor(closingGuest,'lanLastStatus === ONLINE_ERRORS.host_left');
  console.log('PASS private guest retains signaling until authoritative host departure');
  assert.deepEqual(errors, []);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  browserClosing = true; await browser.close(); await mf.dispose(); await new Promise(resolve => server.close(resolve));
}
