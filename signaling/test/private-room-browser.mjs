import {presenceBrowserChecks} from './presence-browser-checks.mjs';
import assert from 'node:assert/strict';
import {automaticServeChecks} from './automatic-serve-cases.mjs';
import {rematchBackChecks} from './rematch-cases.mjs';
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
  chromium, firefox
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
  modules: ['./worker-fixture.mjs', '../src/worker.js', '../src/metered-turn.js', '../src/matchmaking.js', '../src/matchmaking-contract.js', '../src/native-bridge.js', '../src/party-room.js', '../src/secure-relay.js'].map(path => ({
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
const browser = await (process.argv.includes('--firefox') ? firefox : chromium).launch({
  headless: true,
  args: process.argv.includes('--firefox') ? [] : ['--allow-loopback-in-peer-connection', '--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
});
const errors = [], queueTraffic = [];
// This explicit fallback keeps real Worker/WebSocket admission and real pages,
// but replaces RTC channels. The default mode attempts actual WebRTC before permitting fallback.
const failFallback = process.argv.includes('--fallback-disconnect');
const websocketFallback = process.argv.includes('--websocket-fallback') || failFallback;
const controlledChannels = process.argv.includes('--controlled-channels');
const testEndpoints = new Map();
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {recursive:true});
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
  if(failFallback)await page.addInitScript(()=>{
    const Native=window.WebSocket;
    window.WebSocket=class extends Native {
      send(raw){
        const m=typeof raw==='string'&&raw.startsWith('{')?JSON.parse(raw):null;
        if(window.failFallbackSession&&m?.type==='secure'&&m.kind==='ready'&&m.mode==='ws'){this.close();return;}
        super.send(raw);
      }
    };
  });
  if (process.argv.includes('--transport-faults')) await page.addInitScript(()=>{
    const Native=window.WebSocket;
    window.WebSocket=class extends Native {
      get bufferedAmount(){return super.bufferedAmount+(this.testQueued||0)+(window.testBackpressure||0);}
      send(raw){
        const frame=typeof raw==='string' && raw.startsWith('{') ? JSON.parse(raw):null;
        if(frame?.type!=='secure-frame'){super.send(raw);return;}
        if(frame.lane==='a' && window.dropReliableAck)return;
        const delay=40+(frame.seq%3)*15;this.testQueued=(this.testQueued||0)+raw.length;
        this.faultFrames ||= [];this.faultFrames.push({raw,due:Date.now()+delay});
        if(this.faultFrames.length===1)this.drainFaultFrames();
      }
      drainFaultFrames(){const item=this.faultFrames[0];if(!item)return;setTimeout(()=>{this.testQueued-=item.raw.length;if(this.readyState===1)super.send(item.raw);this.faultFrames.shift();this.drainFaultFrames();},Math.max(0,item.due-Date.now()));}
    };
  });
  if (forceRelay) await page.addInitScript(() => {
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(config) {
        super({...config,iceTransportPolicy:'relay'});
      }
    };
  });
  if (controlledChannels) await installControlledChannels(page);
  if(websocketFallback)await page.addInitScript(()=>{window.RTCPeerConnection=class{constructor(){throw Error('WebRTC blocked by test');}};});
  await page.goto(origin + '/demo/');
  if(process.env.KING_PONG_DEBUG_TRANSPORT) {
    page.on('console',m=>{if(m.text().startsWith('TRANSPORT'))console.log(m.text());});
    await page.evaluate(()=>{
      const receive=KingPongRoom.prototype.receive;KingPongRoom.prototype.receive=async function(m){if(m.type==='secure')console.log('TRANSPORT',this.role,m.kind,m.epoch);try{return await receive.call(this,m);}catch(e){console.log('TRANSPORT receive error',e.stack);throw e;}};
      const roomFail=KingPongRoom.prototype.fail;KingPongRoom.prototype.fail=function(code){console.log('TRANSPORT room failure',this.role,code,this.secure?.phase);return roomFail.call(this,code);};
      const fail=KingPongSecureTransport.prototype.fail;KingPongSecureTransport.prototype.fail=function(){console.log('TRANSPORT fail',this.owner.role,this.mode,this.epoch,new Error().stack);return fail.call(this);};
    });
  }
  await page.locator('#titleLanButton').click();
  return page;
}
async function installControlledChannels(page) {
  let deliveries = Promise.resolve();
  await page.exposeFunction('registerTestChannel', state => { testEndpoints.set(page,state); });
  page.on('close',()=>testEndpoints.delete(page));
  await page.exposeFunction('deliverTestChannel', (raw,state) => {
    testEndpoints.set(page,state);
    deliveries = deliveries.then(async () => {
      if (browserClosing || page.isClosed()) return;
      // Route only to the paired endpoint. Visiting every old test page per
      // packet creates an artificial, unbounded Playwright RPC backlog.
      for (const [target, endpoint] of testEndpoints) {
        if (target === page || target.isClosed() || endpoint.room!==state.room || endpoint.role===state.role || endpoint.session!==state.session) continue;
        await target.evaluate(({raw,state}) => {
          if (typeof onlineSession !== 'undefined' && onlineSession && lanRoomCode === state.room && lanRole !== state.role) (onlineSession.secure?.rtcControl || onlineSession.control)?.onmessage?.({data:raw});
        }, {raw,state}).catch(error => {
          // Navigation discards the old controlled endpoint, just like closing RTC.
          if (!target.isClosed() && !error.message.includes('Execution context was destroyed')) throw error;
        });
      }
    }).catch(error => { if (!browserClosing) errors.push(error.message); });
    return deliveries;
  });
  await page.addInitScript(() => {
    window.RTCPeerConnection = class {
      connectionState='new'; channels=[];
      constructor(config) { this.config=config; this.iceGatheringState='complete'; }
      createDataChannel(label) {
        const c={label,readyState:'connecting',bufferedAmount:0,ordered:label!=='pong-lan-input-v1',
          send(raw){if(window.dropReliableAck && JSON.parse(raw).lane==='a')return;this.bufferedAmount+=raw.length;window.deliverTestChannel(raw,{room:lanRoomCode,role:lanRole,session:onlineSession?.secure?.id}).finally(()=>this.bufferedAmount-=raw.length)},close(){this.readyState='closed'}};
        this.channels.push(c); return c;
      }
      setConfiguration(config){this.config=config;}
      async createOffer(options){if(options?.iceRestart && this.restartBlocked)throw Error('restart blocked by fixture');return {type:'offer',sdp:'v=0\r\na=fingerprint:sha-256 '+Array(32).fill('AA').join(':')+'\r\n'}}
      async createAnswer(){return {type:'answer',sdp:'v=0\r\na=fingerprint:sha-256 '+Array(32).fill('BB').join(':')+'\r\n'}}
      async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};if(d.type==='answer')this.openChannels()}
      async setRemoteDescription(d){
        this.remoteDescription=d;
        if(d.type==='offer'&&!this.channels.length)for(const label of ['pong-lan-input-v1','pong-control-v1'])this.ondatachannel({channel:this.createDataChannel(label)});
        else this.openChannels();
      }
      openChannels(){setTimeout(async()=>{if(this.connectionState==='closed')return;await window.registerTestChannel({room:lanRoomCode,role:lanRole,session:onlineSession?.secure?.id});if(this.connectionState==='closed')return;this.connectionState='connected';for(const c of this.channels){c.readyState='open';c.onopen?.()}this.onconnectionstatechange?.()},30)}
      async addIceCandidate(){}
      async getStats(){const url=this.config?.iceServers?.flatMap(s=>s.urls).find(u=>u.startsWith('turn:'));return url?new Map([
        ['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{type:'candidate-pair',state:'succeeded',localCandidateId:'l',remoteCandidateId:'r'}],
        ['l',{candidateType:'relay',relayProtocol:'udp',url}],['r',{candidateType:'host'}]
      ]):new Map();}
      close(){this.connectionState='closed'}
    };
  });
}
async function waitFor(page, expression) {
  try {
    await page.waitForFunction(expression, null, {
      timeout: 60_000
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
      secure:onlineSession?.secure && {mode:onlineSession.secure.mode,phase:onlineSession.secure.phase,keyReady:onlineSession.secure.keyReady,epoch:onlineSession.secure.epoch}, peerState: lanPeer?.connectionState, iceState: lanPeer?.iceConnectionState
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
  if(failFallback) {
    const host=await page();await host.locator('#onlineRequireApproval').uncheck();
    await host.locator('#lanHostButton').click();await waitFor(host,'lanRoomCode.length === 6');
    const code=await host.evaluate(()=>lanRoomCode),guest=await page();
    await guest.evaluate(code=>{window.failFallbackSession=true;openOnlineRoom('guest',code);},code);
    await waitFor(guest,'onlineSession === null && onlineGameBlocked && paused');
    await waitFor(host,"lanLastStatus === 'Waiting for Player 2...'");
    assert.equal(await host.evaluate(()=>lanRoomCode),code);
    assert.deepEqual(await host.evaluate(()=>[lanConnected,left.score,right.score]),[false,0,0]);
    assert.equal(await guest.evaluate(()=>lanLastStatus),await guest.evaluate(()=>ONLINE_ERRORS.connection_lost));
    assert.deepEqual(errors,[]);
    console.log('PASS actual WebSocket closes during fallback agreement: no gameplay or points, friendly guest error, host room retained');
  } else if(process.argv.includes('--public-powerups'))await publicPowerupCases({page,waitFor,queueTraffic,errors});
  else {
  console.log(websocketFallback ? 'MODE real encrypted WebSocket fallback, WebRTC intentionally unavailable' : controlledChannels ? 'MODE controlled RTC channels, real Worker and WebSockets' : 'MODE normal WebRTC negotiation with production fallback');
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
  await guest.context().close();

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
  if(websocketFallback || controlledChannels)assert.equal(await host.evaluate(()=>onlineSession.secure.mode),websocketFallback?'ws':'rtc');
  if(process.argv.includes('--transport-faults') || process.argv.includes('--transport-recovery')) {
    await host.evaluate(()=>{
      window.testActionCount=0;const receive=onlineSession.hooks.message;
      onlineSession.hooks.message=raw=>{const m=JSON.parse(raw);if(m.type==='action'&&m.action==='pause')window.testActionCount++;receive(raw);};
      window.dropReliableAck=true;
      // Layout checks above leave a live rally running. Seed a fresh non-final
      // point so this assertion cannot depend on the previous rally's score.
      startLevel();waitingForServe=false;gameWindowFocused=true;pointForPlayer();
    });
    await peer.evaluate(()=>sendLanAction('pause'));
    await waitFor(host,'window.testActionCount === 1');
    const scores=await host.evaluate(()=>[left.score,right.score]);
    const flow=await host.evaluate(()=>onlineMatchFlow.id);
    const serveRemaining=await host.evaluate(()=>pointServeSnapshotMs());
    assert.ok(serveRemaining>0);
    if(process.argv.includes('--transport-recovery')) {
      await host.evaluate(()=>{onlineSession.secure.peer.restartBlocked=true;onlineSession.secure.rtcFailed();});
      await Promise.all([waitFor(host,"onlineSession?.secure?.mode==='ws' && onlineSession.secure.phase==='active'"),waitFor(peer,"onlineSession?.secure?.mode==='ws' && onlineSession.secure.phase==='active'")]);
      assert.equal(await host.evaluate(()=>onlineMatchFlow.id),flow);
      assert.deepEqual(await host.evaluate(()=>[left.score,right.score]),scores);
      assert.equal(await host.evaluate(()=>pointServeSnapshotMs()),serveRemaining,'recovery freezes the point countdown');
    }
    await host.waitForTimeout(650); // Force a reliable retry before allowing its acknowledgement.
    assert.equal(await host.evaluate(()=>window.testActionCount),1,'pause must not execute twice');
    await host.evaluate(()=>window.dropReliableAck=false);
    await waitFor(peer,'onlineSession.secure.pending.size === 0');
    if(process.argv.includes('--transport-faults')) {
      await host.evaluate(()=>{window.testBackpressure=49152;for(let i=0;i<40;i++)sendLanState(true);});
      assert.ok(await host.evaluate(()=>Boolean(onlineSession.secure.latest)));
      assert.ok(await host.evaluate(()=>onlineSession.secure.pending.size<=32));
      await host.evaluate(()=>window.testBackpressure=0);
      await waitFor(peer,'onlineHasState');
    }
    const forged=await host.evaluate(()=>{const original=window.lanSend;let packet;window.lanSend=m=>packet=m;sendLanState(true);window.lanSend=original;packet.leftScore=1;packet.rightScore=1;return packet;});
    await peer.evaluate(packet=>onlineLanSend(packet),forged);
    await host.waitForTimeout(200);
    assert.deepEqual(await host.evaluate(()=>[left.score,right.score]),scores,'guest must never author scoring');
    await host.evaluate(()=>setMenusVisible(false));await peer.evaluate(()=>setMenusVisible(false));
    console.log('PASS encrypted lag/buffering, reliable command deduplication, transport continuity and host-only scores');
  }

  await presenceBrowserChecks(host,peer,await host.evaluate(()=>onlineSession.secure.mode));
  await automaticServeChecks(host,peer,await host.evaluate(()=>onlineSession.secure.mode));

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
  await peer.context().close();

  // Another approved participant can use the retained room; cancellation during
  // countdown cannot leave a queued serve or old powerup state in that room.
  const replacement=await page();await join(replacement);await pendingPin(host,replacement);await host.locator('#saveConfirmAccept').click();
  await Promise.all([waitFor(host,"onlineMatchFlow?.phase === 'ready'"),waitFor(replacement,"onlineMatchFlow?.phase === 'ready'")]);
  await host.locator('#onlineReadyButton').click();await replacement.locator('#onlineReadyButton').click();
  await waitFor(replacement,"onlineMatchFlow?.phase === 'countdown'");
  await replacement.locator('#onlineFlowBack').click();
  assert.equal(await replacement.evaluate(()=>lanConnected),true);
  await replacement.locator('#multiplayerLeaveConfirm').click();
  await waitFor(host,"onlineMatchFlow === null && !lanConnected");
  assert.deepEqual(await host.evaluate(()=>[waitingForServe,paused,resumeCountdownEndAt,royalPickup,royalSplitBall]),[true,true,0,null,null]);
  assert.equal(await host.evaluate(()=>lanRoomCode),code);
  console.log('PASS retained-room replacement, new initialization and countdown-disconnect cleanup');
  await replacement.context().close();

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
  await rematchBackChecks(host,next);
  await next.context().close();await host.context().close();

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
  const departureTransport=await closingGuest.evaluate(()=>onlineSession.secure.mode);
  assert.ok(['rtc','ws'].includes(departureTransport));
  if(departureTransport==='rtc'){
    await closingGuest.evaluate(()=>(onlineSession.secure?.rtcControl || onlineControlChannel).onclose());
    assert.equal(await closingGuest.evaluate(()=>Boolean(onlineSession&&!onlineSession.closed&&onlineGameBlocked&&paused)),true);
  }
  await closingHost.evaluate(()=>showTitleScreen());
  await waitFor(closingGuest,'lanLastStatus === ONLINE_ERRORS.host_left');
  console.log('PASS '+departureTransport+' private guest receives authoritative host departure');
  assert.deepEqual(errors, []);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  browserClosing = true; await browser.close(); await mf.dispose(); await new Promise(resolve => server.close(resolve));
}
