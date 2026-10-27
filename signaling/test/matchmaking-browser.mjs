import {presenceBrowserChecks} from './presence-browser-checks.mjs';
import assert from 'node:assert/strict';
import {automaticServeChecks} from './automatic-serve-cases.mjs';
import {rematchBackChecks} from './rematch-cases.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {chromium} from 'playwright';

// The explicit signaling-only mode still exchanges real offers/answers. It does
// not claim that a data channel connected. Default mode attempts real RTC and
// permits the production fallback; --websocket-fallback blocks RTC explicitly.
const signalingOnly = process.argv.includes('--signaling-only');
const websocketFallback = process.argv.includes('--websocket-fallback');
const root = new URL('../../', import.meta.url);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = new URL('.' + path + (path.endsWith('/') ? 'index.html' : ''), root);
    if (!file.href.startsWith(root.href)) throw new Error();
    res.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: ['worker.js','metered-turn.js','matchmaking.js','matchmaking-contract.js','native-bridge.js','party-room.js','secure-relay.js']
    .map(f => ({type:'ESModule',path:fileURLToPath(new URL('../src/'+f,import.meta.url))})),
  modulesRoot:fileURLToPath(new URL('../src/',import.meta.url)),
  compatibilityDate:'2025-09-06',
  durableObjects:{ROOMS:{className:'PongRoom',useSQLite:true},TURN_CREDENTIALS:{className:'MeteredTurn',useSQLite:true},
    MATCHMAKING:{className:'MatchmakingQueue',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:origin},
  ratelimits:{ROOM_LIMITER:{namespace_id:'11',simple:{limit:200,period:60}}}
}));
const signaling = (await mf.ready).origin;
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-background-timer-throttling',
  '--disable-renderer-backgrounding','--allow-loopback-in-peer-connection']});
const errors = [];
async function page(path = 'docs/demo/') {
  const p = await browser.newPage({viewport:{width:1280,height:900}});
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(value => Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>value,set:()=>{}}),signaling);
  if(websocketFallback)await p.addInitScript(()=>{window.RTCPeerConnection=class{constructor(){throw Error('WebRTC blocked by fixture');}};});
  await p.goto(path === 'docs/demo/' ? origin+'/'+path : new URL(path,root).href);
  await p.locator(path === 'docs/demo/' ? '#titleLanButton' : '#titleOnlineButton').click();
  await p.waitForFunction(()=>matchmakingWaiting!==null);
  return p;
}
async function until(p, expression) { await p.waitForFunction(expression, null, {timeout:60000}); }
try {
  const watcher = await page();
  const seeker = await page();
  assert.equal(await watcher.evaluate(()=>matchmakingWaiting),0,'viewing the menu is not waiting');
  await seeker.locator('#findMatchButton').click();
  await until(watcher,()=>matchmakingWaiting===1);
  assert.match(await watcher.locator('#matchmakingAvailability').innerText(), /Opponent available/);
  await seeker.evaluate(()=>{findOnlineMatch();findOnlineMatch();});
  assert.equal(await watcher.evaluate(()=>matchmakingWaiting),1,'repeated clicks never duplicate entries');
  await seeker.locator('#cancelSearchButton').click();
  await until(watcher,()=>matchmakingWaiting===0);
  await seeker.locator('#findMatchButton').click();
  await until(watcher,()=>matchmakingWaiting===1);
  await seeker.evaluate(()=>{window.KingPongBackgrounded=true;document.dispatchEvent(new Event('kingpong-background'));});
  await until(watcher,()=>matchmakingWaiting===0);
  assert.match(await seeker.locator('#lanStatus').innerText(),/background/);
  await seeker.evaluate(()=>{window.KingPongBackgrounded=false;document.dispatchEvent(new Event('kingpong-background'));});
  await seeker.locator('#findMatchButton').click();
  await until(watcher,()=>matchmakingWaiting===1);
  await seeker.close();
  await until(watcher,()=>matchmakingWaiting===0);
  console.log('PASS: real UI observer counts, duplicate clicks, cancellation, background, close and restart');

  for (const native of ['windows/webview-2/index.html','Linux/assets/index.html','android/app/src/main/assets/index.html']) {
    for (const nativeHost of [false,true]) {
      const a = await page(nativeHost ? native : 'docs/demo/');
      const b = await page(nativeHost ? 'docs/demo/' : native);
      for (const p of [a,b]) await p.evaluate(()=>{setMatchRule('quick');});
      for (const p of [a,b]) {
        await p.locator('#chooseArenaButton').click();
        await p.locator('[data-choice-id="2"]').click();
      }
      await a.locator('#findMatchButton').click();
      await until(watcher,()=>matchmakingWaiting===1);
      await b.locator('#findMatchButton').click();
      await Promise.all([a,b].map(p=>until(p,websocketFallback ? ()=>onlineSession?.secure?.keyReady :
        ()=>lanPeer?.localDescription && lanPeer?.remoteDescription)));
      await until(watcher,()=>matchmakingWaiting===0);
      const assignments = await Promise.all([a,b].map(p=>p.evaluate(()=>onlineMatchAssignment)));
      assert.deepEqual(assignments[0],assignments[1]);
      assert.deepEqual(await Promise.all([a,b].map(p=>p.evaluate(()=>[lanRole,matchArenaId,matchRuleId]))),
        [['host',2,'classic'],['guest',2,'classic']]);
      for (const p of [a,b]) {
        assert.equal(await p.locator('#matchSetup').isVisible(),false,'assigned players see the arena');
        assert.equal(await p.locator('#onlineMatchFlow').isVisible(),true);
        assert.equal(await p.evaluate(()=>waitingForServe && paused && onlineGameBlocked),true);
        assert.equal(await p.locator('#chooseArenaButton').isVisible(),false);
        assert.equal(await p.locator('.match-rule-options').isVisible(),false);
        assert.equal(await p.evaluate(()=>setMatchRule('endless')),false);
        await p.evaluate(()=>{applyCustomLevelPickerChoice(5);openRoyalGallery('arena');});
        assert.equal(await p.evaluate(()=>matchArenaId),2);
        assert.equal(await p.locator('#royalGallery').isVisible(),false);
      }
      if (!signalingOnly) {
        await Promise.all([a,b].map(p=>until(p,()=>lanConnected && (lanRole==='host'||onlineHasState))));
        const transport=await a.evaluate(()=>onlineSession.secure.mode==='ws'?{transport:'websocket'}:
          onlineSession.secure.peer.getStats().then(kingPongTransportDetails));
        console.log('TRANSPORT',native,nativeHost?'native host':'browser host',JSON.stringify(transport));
        if(websocketFallback)assert.equal(transport.transport,'websocket');
        for (const p of [a,b]) assert.equal(await p.locator('#cancelSearchButton').isVisible(),false);
        await Promise.all([a,b].map(p=>until(p,()=>onlineMatchFlow?.phase==='ready')));
        await a.locator('#onlineReadyButton').click();
        assert.equal(await a.evaluate(()=>waitingForServe),true);
        await b.locator('#onlineReadyButton').click();
        await until(a,()=>!waitingForServe && !paused);
        await until(b,()=>!waitingForServe && !paused);
        await b.evaluate(()=>{gameWindowFocused=true;keys.add('ArrowDown');});
        await until(a,()=>onlineAppliedInputSeq>0);
        await b.evaluate(()=>keys.clear());
        await presenceBrowserChecks(a,b,native+' matchmaking');
        await automaticServeChecks(a,b,native+' matchmaking');
      }
      if (nativeHost && native.startsWith('windows')) {
        await b.evaluate(()=>validMatchmakingState({type:'rules',rules:{id:'endless'}}));
        await until(a,()=>onlineSession===null);
        assert.match(await b.locator('#onlineFlowNote').innerText(),/latest game/);
      } else {
        if (!signalingOnly) await rematchBackChecks(a,b);
        else await a.evaluate(()=>cancelMatchSearch());
        await until(b,()=>onlineSession===null);
      }
      for (const p of [a,b]) assert.equal(await p.evaluate(()=>matchRuleId),'quick','private preset restored');
      if (signalingOnly || nativeHost && native.startsWith('windows')) {
        assert.equal(await b.locator('#onlineRetryButton').isVisible(),true);
        await b.locator('#onlineFlowBack').click();
      } else {
        assert.equal(await b.locator('#matchSetup').isVisible(),true,'acknowledged departure returns to the online menu');
      }
      assert.equal(await b.locator('#findMatchButton').isVisible(),true);
      await a.close();await b.close();
      console.log(`PASS: ${native} as ${nativeHost?'host':'guest'} shares browser queue, locked settings and failure recovery${signalingOnly?', real SDP only':', encrypted gameplay over the reported transport'}`);
    }
  }
  await watcher.close();
  assert.deepEqual(errors,[]);
  console.log(signalingOnly ? 'RESULT: 7 signaling/UI groups passed. RTC data-channel assertions NOT RUN (--signaling-only).' :
    'RESULT: 7 matchmaking browser groups passed, including six browser-to-file-page gameplay connections.');
} catch (e) {
  for (const p of browser.contexts().flatMap(c=>c.pages())) console.log('STATE',await p.evaluate(()=>({
    status:lanStatus.textContent,queue:matchmakingState,count:matchmakingWaiting,role:lanRole,
    connected:lanConnected,peer:lanPeer?.connectionState,ice:lanPeer?.iceConnectionState,
    candidates:lanPeer?.localDescription?.sdp.match(/a=candidate:/g)?.length || 0
  })).catch(()=>({})),errors);
  throw e;
} finally {await browser.close();await mf.dispose();await new Promise(r=>server.close(r));}
