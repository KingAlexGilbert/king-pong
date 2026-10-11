import test from 'node:test';
import assert from 'node:assert/strict';
import {audioHarness} from './helpers/audio-harness.mjs';
import {harness} from './helpers/royal-harness.mjs';
import {builds, source, functionSource} from './helpers/game-source.mjs';

for(const platform of Object.keys(builds)) {
  test(`${platform}: Mute All displays effective audio and preserves all four combinations of saved preferences`,()=>{
    for(const music of [false,true])for(const sfx of [false,true]){
      const h=audioHarness(platform);
      h.run(`const controls=Object.fromEntries(['musicButton','muteAllButton','soundEffectsButton'].map(id=>[id,{attrs:{},setAttribute(k,v){this.attrs[k]=v;}}]));
        document.getElementById=id=>controls[id];
        saveData=createDefaultSaveData();setMusicEnabled(${music});setSoundEffectsEnabled(${sfx});setGameMuteAll(true);`);
      for(const id of ['musicButton','soundEffectsButton']){
        assert.equal(h.run(`controls.${id}.textContent`),'Muted by Mute All');
        assert.equal(h.run(`controls.${id}.disabled`),true);
        assert.equal(h.run(`controls.${id}.attrs['aria-pressed']`),'false');
      }
      assert.equal(h.run("controls.muteAllButton.attrs['aria-pressed']"),'true');
      h.run(functionSource(source(platform),'toggleMusic'));
      h.run(`toggleMusic();setSoundEffectsEnabled(${!sfx});playRoyalPowerupSound('spawn');playRoyalPowerupSound('pickup');`);
      assert.deepEqual(h.json('[saveData.musicEnabled,saveData.soundEffectsEnabled]'),[music,sfx]);
      for(let i=0;i<6;i++)h.run(`setGameMuteAll(${i%2===0?'false':'true'});`);
      h.run('setGameMuteAll(false);');
      assert.deepEqual(h.json('[musicEnabled,saveData.soundEffectsEnabled]'),[music,sfx]);
      assert.equal(h.run('controls.musicButton.textContent'),music?'ON':'OFF');
      assert.equal(h.run('controls.soundEffectsButton.textContent'),sfx?'ON':'OFF');
    }
  });

  test(`${platform}: slot reload restores muted UI without overwriting music and SFX preferences`,()=>{
    const h=audioHarness(platform);
    h.run(`const controls=Object.fromEntries(['musicButton','muteAllButton','soundEffectsButton'].map(id=>[id,{setAttribute(){}}]));
      document.getElementById=id=>controls[id];loadSaveSlot(0);setMusicEnabled(true);setSoundEffectsEnabled(false);setGameMuteAll(true);
      loadSaveSlot(1);setMusicEnabled(false);setSoundEffectsEnabled(true);loadSaveSlot(0);`);
    assert.deepEqual(h.json('[saveData.muteAll,musicEnabled,saveData.soundEffectsEnabled]'),[true,true,false]);
    assert.equal(h.run('controls.musicButton.textContent'),'Muted by Mute All');
    h.run('setGameMuteAll(false);');assert.equal(h.run('controls.soundEffectsButton.textContent'),'OFF');
    const reload=audioHarness(platform,h.data);reload.run('loadSaveSlot(0);');
    assert.deepEqual(reload.json('[saveData.muteAll,musicEnabled,saveData.soundEffectsEnabled]'),[false,true,false]);
  });

  test(`${platform}: powerup cues use bounded envelopes, no timers, and never queue while muted or suspended`,()=>{
    const h=audioHarness(platform);h.run('saveData=createDefaultSaveData();ensureAudioContext();');
    const timers=h.timers.size;
    h.run("playRoyalPowerupSound('spawn');playRoyalPowerupSound('pickup');");
    assert.equal(h.oscillators.length,2);assert.equal(h.timers.size,timers);
    for(const gain of h.gains.filter(g=>g.gain.events.length)){
      assert.ok(gain.gain.events.every(e=>e[1]>=0&&e[1]<=.035));
    }
    assert.ok(h.oscillators[0].stopAt<=1.004);
    h.run("setGameMuteAll(true);playRoyalPowerupSound('spawn');playRoyalPowerupSound('pickup');");
    assert.equal(h.oscillators.length,2);
    h.run("setGameMuteAll(false);setSoundEffectsEnabled(false);playRoyalPowerupSound('pickup');");
    assert.equal(h.oscillators.length,2);
    h.run("setSoundEffectsEnabled(true);audioCtx.state='suspended';playRoyalPowerupSound('spawn');audioCtx.state='running';");
    assert.equal(h.oscillators.length,2);
    h.run("playRoyalPowerupSound('pickup');stopRoyalPowerupSound();");
    assert.equal(h.oscillators.length,3);assert.equal(h.oscillators[2].stopped,true);
  });
}

test('all three authoritative spawns/pickups emit one cue, and snapshots cannot replay them',()=>{
  const h=harness();
  h.run("const cues=[];function playRoyalPowerupSound(kind){cues.push(kind)}");
  for(let i=0;i<3;i++){
    h.run(`resetRoyalRally();royalPickupIndex=${i};royalRallyTick=179;updateRoyalPowerups();
      ball.prevX=ball.x=royalPickup.x-BALL_HALF;ball.prevY=ball.y=royalPickup.y-BALL_HALF;ball.lastHit='left';
      collectRoyalPickup();collectRoyalPickup();`);
    assert.equal(h.run('royalPowerupPulse.remaining'),60);
  }
  assert.deepEqual(h.json('cues'),['spawn','pickup','spawn','pickup','spawn','pickup']);
  h.run(`cues.length=0;guestPowerupCueSequence=-1;receiveRoyalPowerupCues({cueSeq:0,cues:[]});
    const snapshot={cueSeq:2,cues:[{seq:1,kind:'spawn',type:'split',age:2},{seq:2,kind:'pickup',type:'split',age:0}]};
    receiveRoyalPowerupCues(snapshot);receiveRoyalPowerupCues(snapshot);`);
  assert.deepEqual(h.json('cues'),['spawn','pickup']);
  h.run(`paused=true;const suppressed={cueSeq:3,cues:[{seq:3,kind:'pickup',type:'guard',age:0}]};
    receiveRoyalPowerupCues(suppressed);paused=false;receiveRoyalPowerupCues(suppressed);`);
  assert.equal(h.run('cues.length'),2);
  h.run('resetMatchConnectionState();receiveRoyalPowerupCues(snapshot);');assert.equal(h.run('cues.length'),2);
  h.run('resetRoyalRally();');assert.equal(h.run('royalPowerupPulse'),null);
});

test('powerup pulse interpolates without advancing physics or changing pause duration',()=>{
  const h=harness();
  h.run(`royalRallyTick=179;updateRoyalPowerups();const before=captureVisualState();updateRoyalPowerups();const after=captureVisualState();`);
  assert.equal(h.run('interpolateVisualState(before,after,.5).powerupPulse.remaining'),59.5);
  h.run('paused=true;for(let i=0;i<100;i++)updateRoyalPowerups();');assert.equal(h.run('royalPowerupPulse.remaining'),59);
});
