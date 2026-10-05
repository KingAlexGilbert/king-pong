import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { builds, root, source, functionSource } from './helpers/game-source.mjs';
import { harness } from './helpers/royal-harness.mjs';
import { audioHarness } from './helpers/audio-harness.mjs';
import { integrateRoyalPolish } from '../game/polish-integration.mjs';

for (const platform of Object.keys(builds)) {
  test(`${platform}: split launches at 70%, leaves the primary unchanged, and preserves its speed scale on contacts`, () => {
    const h = harness(platform);
    h.run("let primaryBefore;");
    for (const [vx, vy] of [[6, 0], [-4, 3], [2, -5]]) {
      h.run(`resetRoyalRally();ball.vx=${vx};ball.vy=${vy};ball.lastHit='left';primaryBefore=JSON.stringify(ball);awardRoyalPowerup('split');`);
      assert.equal(h.run('JSON.stringify(ball)'), h.run('primaryBefore'));
      assert.ok(Math.abs(h.run('Math.hypot(royalSplitBall.vx,royalSplitBall.vy)/ballSpeed()') - .7) < 1e-10);
    }
    h.run('ball.vx=6;ball.vy=0;ball.x=590;ball.y=230;hitPaddle(right,-1);const fullSpeed=ballSpeed();ball=royalSplitBall;ball.vx=4.2;ball.vy=0;ball.x=590;ball.y=230;hitPaddle(right,-1);');
    assert.ok(Math.abs(h.run('ballSpeed()/fullSpeed') - .7) < 1e-10);
    h.run('ball.vx=.01;ball.vy=.01;normalizeBallVelocity(4,10);');
    assert.ok(Math.abs(h.run('ballSpeed()') - 2.8) < 1e-10);
    h.run('ball.vx=20;ball.vy=20;normalizeBallVelocity(4,10);');
    assert.ok(Math.abs(h.run('ballSpeed()') - 7) < 1e-10);
    h.run('ball.rush=true;normalizeBallVelocity(10,10);');
    assert.ok(Math.abs(h.run('ballSpeed()') - 9.1) < 1e-10, 'intentional Rush still multiplies the reduced speed');
    assert.equal(integrateRoyalPolish(source(platform)), source(platform));
  });

  test(`${platform}: forgiving pickup radius remains swept, finite, and requires a last hitter`, () => {
    const h = harness(platform);
    for (const [distance, collected] of [[20, true], [24, true], [25, false]]) {
      h.run(`royalPickup={type:'guard',x:320,y:240,ttl:480};royalGuards.left=0;ball.lastHit='left';ball.prevX=0;ball.x=630;ball.prevY=ball.y=240+${distance}-BALL_HALF;collectRoyalPickup();`);
      assert.equal(h.run('royalPickup===null'), collected);
      assert.equal(h.run('royalGuards.left'), collected ? 600 : 0);
    }
    h.run("ball.lastHit=null;ball.y=ball.prevY=236;collectRoyalPickup();");
    assert.ok(h.run('royalPickup'));
  });

  test(`${platform}: bounded varied spawns avoid all original geometry and have no guest placement path`, () => {
    const h = harness(platform);
    const spots = h.json(`(()=>{const out=[];for(const arena of arenaCatalog){matchArenaId=arena.id;hazards=(arena.level.hazards||[]).map(h=>({...h}));
      for(let i=0;i<20;i++){royalPickupIndex=i;royalRallyTick=180+i*480;const p=findRoyalPickupSpot();if(p){if(!royalPickupSpotSafe(p.x,p.y))throw new Error('unsafe');out.push(p)}}}return out})()`);
    assert.ok(spots.length > 200);
    assert.ok(new Set(spots.map(p => p.x + ':' + p.y)).size > 150);
    assert.ok(Math.max(...spots.map(p => p.x)) - Math.min(...spots.map(p => p.x)) > 300);
    assert.ok(Math.max(...spots.map(p => p.y)) - Math.min(...spots.map(p => p.y)) > 300);
    h.run('hazards=[];royalPickupIndex=4;const firstSpot=JSON.stringify(findRoyalPickupSpot());');
    assert.equal(h.run('JSON.stringify(findRoyalPickupSpot())'), h.run('firstSpot'), 'placement is reproducible for the same authoritative state');
    for (const [x,y] of [[0,240],[90,240],[620,200],[300,8],[300,472]]) assert.equal(h.run(`royalPickupSpotSafe(${x},${y})`),false);
    h.run("hazards=[{type:'circle',x:300,y:240,r:20}];");
    assert.equal(h.run('royalPickupSpotSafe(349,240)'),false);
    h.run("hazards=[{type:'rect',x:200,y:100,w:20,h:100,vx:2}];");
    assert.equal(h.run('royalPickupSpotSafe(290,150)'),false,'includes the near-future sweep of moving walls');
    h.run("hazards=[{type:'rect',x:0,y:0,w:W,h:H}];");
    assert.equal(h.run('findRoyalPickupSpot()'),null,'crowded arenas skip safely');
    h.run("hazards=[];lanRole='host';royalRallyTick=179;royalPickup=null;updateRoyalPowerups();const packed=packRoyalState();");
    assert.equal(h.run('validRoyalState(packed)'),true);
    h.run("const before=JSON.stringify(royalPickup);handleLanHostMessage({type:'state',royal:{pickup:{x:0,y:0}}});handleLanHostMessage({type:'pickup',x:9,y:9});");
    assert.equal(h.run('JSON.stringify(royalPickup)'),h.run('before'));
    h.run("lanRole='guest';royalPickup=null;royalRallyTick=179;updateRoyalPowerups();");
    assert.equal(h.run('royalPickup'),null); assert.equal(h.run('findRoyalPickupSpot()'),null);
    h.run('applyRoyalState(packed);'); assert.deepEqual(h.json('royalPickup'),h.json('packed.pickup'));
    assert.equal(h.run('validRoyalState({...packed,pickup:{...packed.pickup,x:0}})'),false);
  });

  test(`${platform}: Quick, Classic, Win by Two and Endless use only multiplayer scoring`, () => {
    for (const [id, own, other, wins] of [['quick',3,0,false],['quick',4,4,true],['classic',8,0,false],['classic',9,9,true],
      ['winTwo',9,9,false],['winTwo',9,8,true],['winTwo',10,10,false],['winTwo',11,10,true],['endless',99,0,false],['endless',999999,1,false]]) {
      for (const side of ['left','right']) {
        const h=harness(platform);
        h.run(`matchRuleId=${JSON.stringify(id)};${side}.score=${own};${side==='left'?'right':'left'}.score=${other};${side==='left'?'pointForPlayer':'pointForCpu'}();`);
        assert.equal(h.run('gameOver'),wins,`${id} ${own+1}:${other} ${side}`);
        assert.equal(h.run(`${side}.score`),own+1);
      }
    }
    const h=harness(platform);
    h.run("mode=1;matchRuleId='quick';right.score=currentLevel().goal-2;pointForCpu();");
    assert.equal(h.run('gameOver'),false,'Campaign keeps its original arena goal');
    h.run("mode=3;matchRuleId='endless';right.score=currentLevel().goal-1;pointForCpu();");
    assert.equal(h.run('gameOver'),true,'Custom retains the original arena goal');
    h.run("mode=2;lanRole='guest';const before=JSON.stringify([left,right]);pointForPlayer();pointForCpu();");
    assert.equal(h.run('JSON.stringify([left,right])'),h.run('before'));
    assert.equal(h.run('nextMatchScore(Number.MAX_SAFE_INTEGER)'),Number.MAX_SAFE_INTEGER);
  });

  test(`${platform}: host rules are reliable, bounded, immutable during play and reject stale/conflicting snapshots`, () => {
    const h=harness(platform);
    h.run("lanRole='host';waitingForServe=true;setMatchRule('quick');sendLanState(true);");
    assert.equal(h.run('sent[0].type'),'rules'); assert.equal(h.run('sent.at(-1).rules.id'),'quick');
    h.run("handleLanHostMessage({type:'rules',rules:{id:'endless',revision:999},leftScore:999});");
    assert.equal(h.run('matchRuleId'),'quick'); assert.equal(h.run('left.score'),0);
    h.run("waitingForServe=false;");assert.equal(h.run("setMatchRule('endless')"),false);
    h.run("lanRole='guest';waitingForServe=true;resetMatchRuleConnection();");
    assert.equal(h.run("setMatchRule('endless')"),false);
    assert.equal(h.run("receiveMatchRules({id:'winTwo',revision:3})"),true);
    for(const value of [{id:'quick',revision:2},{id:'quick',revision:3},{id:'bad',revision:4},{id:'__proto__',revision:4},{id:{toString:null},revision:4},{id:'endless',revision:-1},{id:'endless',revision:1e30}])
      assert.equal(h.run(`receiveMatchRules(${JSON.stringify(value)})`),false);
    h.run(`handleLanGuestMessage({type:'state',seq:10,tick:10,rules:{id:'winTwo',revision:3},leftScore:110,rightScore:109});
      handleLanGuestMessage({type:'state',seq:9,tick:9,rules:{id:'endless',revision:4},leftScore:0,rightScore:0});
      handleLanGuestMessage({type:'state',seq:11,tick:11,rules:{id:'endless',revision:4},leftScore:1e30,rightScore:0});
      handleLanGuestMessage({type:'state',seq:11,tick:11,rules:{id:'endless',revision:4},leftScore:0,rightScore:0,royal:{}});
      handleLanGuestMessage({type:'state',seq:11,tick:11,leftScore:0,rightScore:0});`);
    assert.deepEqual(h.json('applied'),[10]); assert.equal(h.run('matchRuleId'),'winTwo');
    h.run("receiveMatchRules({id:'classic',revision:Number.MAX_SAFE_INTEGER});resetMatchRuleConnection();lanRole='none';");
    assert.equal(h.run("setMatchRule('endless')"),true,'a previous connection cannot exhaust local revisions');
    const c=vm.createContext({});
    vm.runInContext(`let sends=[];const lanChannel={readyState:'open',bufferedAmount:0,send:p=>sends.push(['state',JSON.parse(p)])},onlineControlChannel={readyState:'open',bufferedAmount:0,send:p=>sends.push(['control',JSON.parse(p)])};
      ${functionSource(source(platform),'lanSend')}lanSend({type:'rules',rules:{id:'classic',revision:1}});`,c);
    assert.equal(vm.runInContext('sends[0][0]',c),platform==='Browser'?'control':'state','native LAN already uses its reliable channel');
    assert.equal(vm.runInContext('sends[0][1].matchRules',c),'presets');
  });

  test(`${platform}: audio buses mute immediately, preserve separate preferences and cancel queued SFX`, () => {
    const h=audioHarness(platform);h.run('loadSaveSlot(0);setSoundEffectsEnabled(false);setMusicEnabled(true);setMusicVolume(37);setGameMuteAll(true);');
    assert.deepEqual(h.json('[saveData.muteAll,musicEnabled,saveData.soundEffectsEnabled,musicVolumeLevel]'),[true,true,false,.37]);
    const count=h.oscillators.length;h.run('beep(440,.1);playScoreTone(440,0,.1);playMusicTone(440,1,.1,.1);');
    assert.equal(h.oscillators.length,count);
    h.run('setGameMuteAll(false);');
    assert.deepEqual(h.json('[saveData.muteAll,musicEnabled,saveData.soundEffectsEnabled]'),[false,true,false]);
    h.run('playMusicTone(440,1,.1,.1);');assert.equal(h.oscillators.length,count+1);
    h.run('setSoundEffectsEnabled(true);beep(440,.1);playScoreTone(660,250,.1);');
    const delayed=[...h.timers.values()].find(t=>t.delay===250).fn;
    h.run('setGameMuteAll(true);');assert.equal(h.run('gameAudioBuses.get(audioCtx).master.gain.value'),0);
    assert.equal(h.oscillators.at(-1).stopped,true);
    h.run('setGameMuteAll(false);'); const before=h.oscillators.length; delayed(); assert.equal(h.oscillators.length,before);
    h.run('setMusicEnabled(false);beep(440,.1);');assert.equal(h.oscillators.length,before+1,'SFX works with music off');
    h.run('setMusicEnabled(true);setMusicVolume(0);');
    assert.equal(h.run('musicTimer'),null);assert.equal(h.run('gameAudioEnabled("sfx")'),true);
  });

  test(`${platform}: audio preferences survive reloads/slots and old saves retain sensible defaults`, () => {
    const h=audioHarness(platform);h.run('loadSaveSlot(0);setSoundEffectsEnabled(false);setMusicEnabled(true);setGameMuteAll(true);setMusicVolume(37);');
    const reloaded=audioHarness(platform,h.data);reloaded.run('loadSaveSlot(0);');
    assert.deepEqual(reloaded.json('[saveData.muteAll,musicEnabled,saveData.soundEffectsEnabled,musicVolumeLevel]'),[true,true,false,.37]);
    reloaded.run('loadSaveSlot(1);');assert.deepEqual(reloaded.json('[saveData.muteAll,saveData.soundEffectsEnabled]'),[false,true]);
    reloaded.run('loadSaveSlot(0);setGameMuteAll(false);');
    assert.deepEqual(reloaded.json('[musicEnabled,saveData.soundEffectsEnabled,musicVolumeLevel]'),[true,false,.37]);
    const legacy=h.json('createDefaultSaveData()');delete legacy.muteAll;delete legacy.soundEffectsEnabled;legacy.musicEnabled=false;legacy.musicVolumePercent=0;
    const old=audioHarness(platform,new Map([['save_0',JSON.stringify(legacy)]]));old.run('loadSaveSlot(0);');
    assert.deepEqual(old.json('[saveData.muteAll,saveData.soundEffectsEnabled,musicEnabled,musicVolumeLevel]'),[false,true,false,0]);
    assert.equal(old.data.get('save_0'),JSON.stringify(legacy),'loading does not eagerly rewrite old saves');
    if(platform!=='Browser') {
      assert.deepEqual(h.json('checkedSaveSlot(saveData)'),h.json('saveData'));
      assert.throws(()=>h.run('checkedSaveSlot({...saveData,muteAll:"yes"})'));
      assert.throws(()=>h.run('checkedSaveSlot({...saveData,soundEffectsEnabled:1})'));
      const fromOldBackup = h.json(`checkedSaveSlot(${JSON.stringify(legacy)})`);
      assert.equal(fromOldBackup.musicEnabled,false); assert.equal(fromOldBackup.muteAll,undefined);
      if (platform==='Windows'||platform==='Linux') {
        h.run('window.KingPongLinuxWebKitAudioKeepAlive=true;setGameMuteAll(false);setMusicEnabled(true);');
        assert.equal(h.run('musicAudioKeepAliveOscillator!==null'),true);
        h.run('setGameMuteAll(true);');assert.equal(h.run('musicAudioKeepAliveOscillator'),null);
      }
    }
  });
}

test('prediction is a faint pixel cursor and rendering cannot change confirmed position, input or physics', () => {
  const h=harness();
  h.run(`lanRole='guest';const onlineSession={};const marks=[];const ctx={save(){},restore(){},fillRect(...args){marks.push({args,alpha:this.globalAlpha,color:this.fillStyle,blur:this.shadowBlur})}};
    right.y=20;const view=captureVisualState();view.right.y=200;const before=JSON.stringify([ball,right,view]);drawGuestInputPreview(view);`);
  assert.equal(h.run('JSON.stringify([ball,right,view])'),h.run('before'));
  const marks=h.json('marks');assert.equal(marks.length,2);assert.ok(marks.every(m=>m.alpha<=.3&&m.args[3]<=8&&m.blur===0));
});

test('new UI phrases have all nine translations and exact-score rendering stays within each player half', () => {
  const c=vm.createContext({window:{}});vm.runInContext(readFileSync(new URL('game/royal-localization.js',root),'utf8'),c);
  for(const table of Object.values(c.window.KING_PONG_ROYAL_TRANSLATIONS)) for(const key of ['Mute All','Sound Effects','Chapters','Royal Powerups','CHANGE','Match rules','Quick Match — First to 5','Endless — No score limit']) assert.ok(table[key]);
  const h=harness();h.run('const digits=[],texts=[];function drawDigit(d,x,y,scale){digits.push({d,x,scale})}function drawText(...args){texts.push(args)}drawMultiplayerScore(999999,230,34);drawMultiplayerScore(Number.MAX_SAFE_INTEGER,410,34);');
  assert.ok(h.json('digits').every(d=>d.x>=160&&d.x+10*d.scale<=300));
  assert.deepEqual(h.json('texts[0]'),[String(Number.MAX_SAFE_INTEGER),410,60,12]);
});
