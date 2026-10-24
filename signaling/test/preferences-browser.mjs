import assert from 'node:assert/strict';
import {staticServer, closeStaticServer} from './static-server.mjs';
import {
  mkdir
} from 'node:fs/promises';
import {
  chromium
} from 'playwright';
import {
  builds
} from '../../tests/helpers/game-source.mjs';

// These deterministic browser checks exercise real game/UI code. The peer bridge below
// deliberately tests gameplay messages separately from the real WebRTC test in browser.mjs.
const server = await staticServer();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox']
});
const errors = [];
let checks = 0;
const pass = label => {
  checks++;
  console.log('PASS: ' + label);
};
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {
  recursive: true
});
async function page(platform = 'Browser', options = {}) {
  const context = await browser.newContext({
    viewport: {
      width: 1100,
      height: 800
    },
    ...options
  });
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(`${platform}: ${error.message}`));
  p.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  await p.addInitScript(() => {
    // UI fixtures stay local; real signaling has its own integration test.
    Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => '', set: () => {}, configurable: true});
    // Advancing the real loop explicitly makes collision/packet/UI assertions reproducible.
    window.requestAnimationFrame = callback => {
      window.nextGameFrame = callback;
      return 1;
    };
  });
  await p.goto(origin + '/' + builds[platform]);
  return p;
}
try {
  for (const platform of Object.keys(builds)) {
    const p = await page(platform);
    await p.evaluate(() => {
      savePlayerPreference('hostApprovalRequired',false);
      savePlayerPreference('showConnectionType',true);
      togglePlayInfo();
      startTwoPlayerMode(true,false);
      setMatchRule('endless'); setMatchPowerups(false);
      savePlayerPreference('multiplayerPaddle','boss-8');
      savePlayerPreference('multiplayerPaddle2','enemy-15');
      saveData.royalArena=12; saveProgressNow();
      setMusicVolume(31); setMusicEnabled(false); setSoundEffectsEnabled(false); setGameMuteAll(true);
    });
    const before=await p.evaluate(()=>JSON.parse(localStorage.getItem(saveSlotKey(0))));
    await p.reload();
    const expected=[false,true,false,'endless',false,'boss-8','enemy-15'];
    const settings=()=>[playerPreference('hostApprovalRequired'),playerPreference('showConnectionType'),playInfoVisible,
      matchRuleId,matchPowerupsEnabled,multiplayerPaddleChoices.left,multiplayerPaddleChoices.right];
    assert.deepEqual(await p.evaluate(settings),expected,platform+' restart');
    assert.deepEqual(await p.evaluate(()=>[saveData.muteAll,saveData.soundEffectsEnabled,musicEnabled,musicVolumeLevel]),[true,false,false,.31]);
    await p.evaluate(()=>{loadSaveSlot(1);});
    assert.deepEqual(await p.evaluate(settings),[true,false,true,'classic',true,null,null],platform+' fresh slot defaults');
    await p.evaluate(()=>loadSaveSlot(0));
    assert.deepEqual(await p.evaluate(settings),expected);
    assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem(saveSlotKey(0)))),before,platform+' loading does not write');
    const backup=await p.evaluate(()=>makeSaveBackup());
    await p.evaluate(backup=>{
      localStorage.clear(); loadSaveSlot(0);
      applyImportedSaveBackup(parseSaveBackup(backup));
    },backup);
    await p.evaluate(()=>loadSaveSlot(0));
    assert.deepEqual(await p.evaluate(settings),expected,platform+' import/export');
    await p.evaluate(()=>{startCampaignFromSave();});
    assert.equal(await p.evaluate(()=>playInfoVisible),false,platform+' campaign does not reset display preference');
    await p.evaluate(()=>{
      closeLanConnection(false); startOnlineSetup();
      onlineMatchAssignment={id:'test',rules:'classic',arena:0};applyMatchmakingSettings();
      setMusicVolume(43); closeOnlineConnection(false);
    });
    assert.deepEqual(await p.evaluate(()=>[matchRuleId,matchPowerupsEnabled]),['endless',false]);
    assert.deepEqual(await p.evaluate(()=>[saveData.matchRuleId,saveData.royalPowerupsEnabled]),['endless',false]);
    // Host settings received by a guest cannot overwrite locally saved choices.
    await p.evaluate(()=>{
      lanRole='guest';lanConnected=true;mode=2;lanChannel={readyState:'open'};
      applyMatchRuleState({id:'quick',revision:2,powerups:true});setMusicVolume(44);
      lanChannel=null; closeOnlineConnection(false);
    });
    assert.deepEqual(await p.evaluate(()=>[matchRuleId,matchPowerupsEnabled]),['endless',false]);
    assert.equal(await p.evaluate(()=>JSON.stringify(makeSaveBackup()).includes('room-token')),false);
    await p.evaluate(()=>startTwoPlayerFromTitle());
    assert.deepEqual(await p.evaluate(()=>[matchPowerupsEnabled,saveData.royalPowerupsEnabled]),[true,false],
      'private powerup preference does not alter same-device rules');
    pass(platform+': preferences survive restart, slots, backup import/export and temporary host/matchmaking overrides');
    await p.context().close();
  }
  for (const platform of Object.keys(builds)) {
  const p=await page(platform);
  const frames=await p.evaluate(()=>{
    startTwoPlayerMode(true,false);hideTitleScreen();setMenusVisible(false);gameWindowFocused=true;
    mode=2;waitingForServe=false;paused=false;lanConnected=true;lanChannel={readyState:'open'};
    left.y=70;right.y=285;left.score=12;right.score=34;
    royalGuards={left:600,right:300};royalGuardHits={left:{seq:1,y:120,ttl:8},right:null};
    royalPickup={type:'split',x:220,y:55,ttl:100};royalPowerupPulse={x:220,y:55,remaining:30};
    ball.x=130.5;ball.y=230;ball.vx=4;ball.vy=1;
    const view=captureVisualState();
    const originalPaddle=drawPaddleShape,originalBall=drawRoyalBall,originalScore=drawMultiplayerScore,originalEffects=drawRoyalEffects,originalHazards=drawHazards;
    let records=[];
    drawPaddleShape=(p,...args)=>{const t=ctx.getTransform();records.push(['paddle',p===view.left?'host':'guest',t.a*p.x+t.e,t.a,t.d]);originalPaddle(p,...args)};
    drawRoyalBall=(b,...args)=>{if(b){const t=ctx.getTransform();records.push(['ball',t.a*b.x+t.e,t.a,t.d])}originalBall(b,...args)};
    drawMultiplayerScore=(score,...args)=>{records.push(['score',score,ctx.getTransform().a]);originalScore(score,...args)};
    drawRoyalEffects=v=>{records.push(['effects',ctx.getTransform().a]);originalEffects(v)};
    drawHazards=v=>{records.push(['hazards',ctx.getTransform().a]);originalHazards(v)};
    const result={};
    const physics=JSON.stringify([left,right,ball,royalPickup,royalGuards,hazards]);
    for(const role of ['host','guest','none']) {
      lanRole=role;records=[];draw(view);result[role]=records;
      if(physics!==JSON.stringify([left,right,ball,royalPickup,royalGuards,hazards]))throw Error('Rendering changed world state');
    }
    // Present the exact same interpolated world frame at each requested cadence.
    // Mirroring never feeds coordinates back into snapshots or interpolation.
    const after=structuredClone(view);after.ball.x+=4;after.ball.y+=1;
    for(const hz of [60,120,144,165,240])for(let i=0;i<Math.ceil(hz/60)+1;i++) {
      const sample=interpolateVisualState(view,after,(i*60/hz)%1), positions=[];
      for(const role of ['host','guest']) {
        lanRole=role;records=[];draw(sample);positions.push(records.find(r=>r[0]==='ball')[1]);
      }
      // Canvas stores some matrix components at float32 precision (< .0001 px here).
      if(Math.abs(positions[0]+positions[1]-W*renderScale)>1e-4)throw Error('Divergent mirrored interpolation at '+hz+' Hz: '+JSON.stringify({positions,width:W*renderScale,role:lanRole}));
    }
    drawPaddleShape=originalPaddle;drawRoyalBall=originalBall;drawMultiplayerScore=originalScore;drawRoyalEffects=originalEffects;drawHazards=originalHazards;
    lanRole='guest';
    result.messages=[arenaResultMessage('Left player wins the match. Space to play again.'),arenaResultMessage('Right player wins the match. Space to play again.')];
    const before=right.y;keys.add('ArrowDown');onlineUpdatePlayerPaddles([]);keys.clear();result.keyboard=right.y>before;
    touchPaddleTargets.right=100;onlineUpdatePlayerPaddles([]);result.touch=right.y===100;touchPaddleTargets.right=null;
    const y=right.y;onlineUpdatePlayerPaddles([{axes:[0,1],buttons:[]}]);result.controller=right.y>y;
    const rect=canvas.getBoundingClientRect(),leftBefore=left.y,rightBefore=right.y;
    const pointer={pointerType:'touch',pointerId:7,clientX:rect.x+rect.width*.15,clientY:rect.y+rect.height*.4,preventDefault(){}};
    handleCanvasPointerDown(pointer);handleCanvasPointerMove({...pointer,clientY:pointer.clientY+30});
    updatePlayerPaddles([]);result.drag=right.y>rightBefore&&left.y===leftBefore;
    handleCanvasPointerCancel(pointer);
    result.perspectives=[];
    for(const online of [false,true]) {
      onlineSession=online?{close(){}}:null;
      for(const role of ['guest','host','none','guest']){lanRole=role;result.perspectives.push(twoPlayerViewMirrored());}
    }
    onlineSession=null;lanConnected=false;result.disconnected=twoPlayerViewMirrored();lanConnected=true;
    for(const m of [1,3,4]){mode=m;result.perspectives.push(twoPlayerViewMirrored());}
    mode=2;lanRole='host';waitingForServe=false;left.score=right.score=0;pointForPlayer();
    result.goal=[left.score,right.score];lanRole='guest';pointForCpu();result.guestGoal=[left.score,right.score];
    lanChannel=null;lanConnected=false;
    result.scale=renderScale;return result;
  });
  assert.deepEqual(frames.host.filter(r=>r[0]==='score').map(r=>r[1]),[12,34]);
  assert.deepEqual(frames.guest.filter(r=>r[0]==='score').map(r=>r[1]),[34,12]);
  assert.deepEqual(frames.none,frames.host);
  const paddles=frames.guest.filter(r=>r[0]==='paddle');
  assert.ok(paddles.find(r=>r[1]==='guest')[2]<paddles.find(r=>r[1]==='host')[2]);
  assert.ok(paddles.every(r=>r[3]<0&&r[4]>0));
  assert.ok(frames.guest.findIndex(r=>r[0]==='effects')>frames.guest.findLastIndex(r=>r[0]==='score'));
  assert.ok(frames.guest.filter(r=>['hazards','effects','ball'].includes(r[0])).every(r=>r[0]==='ball'?r[2]<0:r[1]<0));
  assert.ok(frames.keyboard&&frames.touch&&frames.controller&&frames.drag);
  assert.deepEqual(frames.perspectives,[true,false,false,true,true,false,false,true,false,false,false]);
  assert.equal(frames.disconnected,false);
  assert.deepEqual(frames.goal,[1,0]);assert.deepEqual(frames.guestGoal,[1,0]);
  assert.deepEqual(frames.messages,['Right player wins the match. Space to play again.','Left player wins the match. Space to play again.']);
  pass(platform+': actual Canvas perspective, 60/120/144/165/240 Hz interpolation, scores, goals, effects, touch/keyboard/controller, LAN/online assignments and solo isolation');
  await p.context().close();
  }
  const p=await page();
  for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:844,height:390}]) {
    await p.setViewportSize(viewport);
    for(const start of ['startOnlineSetup','startTwoPlayerFromTitle']) {
      await p.evaluate(start=>{lanChannel=null;closeLanConnection(false);showTitleScreen();window[start](true);syncRoyalUi(true)},start);
      const button=p.locator(start==='startOnlineSetup'?'#setupMenuButton':'#setupBackButton');
      const box=await button.boundingBox(),title=await p.locator('#matchSetupTitle').boundingBox();
      assert.ok(box&&title&&box.y+box.height<=title.y+1&&box.x>=0&&box.y>=0);
    }
  }
  if (artifacts) await p.screenshot({path:artifacts+'/back-landscape.png'});
  pass('top Back buttons at desktop, portrait and landscape sizes');
  assert.deepEqual(errors,[]);
} finally { await browser.close(); await closeStaticServer(server); }
