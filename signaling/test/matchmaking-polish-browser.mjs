import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds, root} from '../../tests/helpers/game-source.mjs';
const server = createServer(async(req,res)=>{
  try {
    const file=new URL('.'+new URL(req.url,'http://localhost').pathname,root);
    if(!file.href.startsWith(root.href)) throw new Error();
    res.setHeader('Content-Type',file.pathname.endsWith('.js')?'text/javascript':'text/html');
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const errors=[], audioMetrics=[];
const artifacts=process.env.KING_PONG_TEST_ARTIFACTS;
if(artifacts) await mkdir(artifacts,{recursive:true});
async function page(platform='Browser',options={}) {
  const p=await browser.newPage({viewport:{width:1280,height:900},...options});
  p.on('pageerror',e=>errors.push(platform+': '+e.message));
  await p.addInitScript(()=>{
    window.requestAnimationFrame=()=>1;
    Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>'',set:()=>{}});
  });
  await p.goto(origin+'/'+builds[platform]);
  return p;
}
async function snap(p,name){if(artifacts) await p.screenshot({path:artifacts+'/'+name+'.png',animations:'disabled'});}
async function tiles(p){
  const rects=await p.locator('.title-primary-modes button').evaluateAll(nodes=>nodes.map(n=>{
    const r=n.getBoundingClientRect(),s=getComputedStyle(n);
    return {width:r.width,height:r.height,color:s.borderTopColor,overflow:n.scrollWidth>n.clientWidth+1};
  }));
  assert.equal(rects.length,2);
  assert.ok(Math.abs(rects[0].width-rects[1].width)<.1, 'equal grid columns, allowing CSS subpixel rounding');
  assert.equal(rects[0].height,rects[1].height);
  assert.deepEqual(rects.map(r=>r.color),['rgb(113, 202, 255)','rgb(255, 212, 105)']);
  assert.equal(rects.some(r=>r.overflow),false);
}
async function mute(p){
  await p.locator('#menuToggle').click();
  await p.locator('#matchSettings summary').click();
  await p.locator('#soundEffectsButton').click();
  await p.locator('#muteAllButton').click();
  for(const id of ['musicButton','soundEffectsButton']) {
    assert.equal(await p.locator('#'+id).isDisabled(),true);
    assert.equal(await p.locator('#'+id).getAttribute('aria-pressed'),'false');
    assert.equal(await p.locator('#'+id).innerText(),'Muted by Mute All');
  }
  assert.deepEqual(await p.evaluate(()=>[musicEnabled,saveData.soundEffectsEnabled]),[true,false]);
  await snap(p,'muted-'+await p.evaluate(()=>innerWidth));
  await p.locator('#muteAllButton').focus();
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(()=>document.activeElement.disabled),false);
  await p.locator('#muteAllButton').click();
  assert.equal(await p.locator('#musicButton').innerText(),'ON');
  assert.equal(await p.locator('#soundEffectsButton').innerText(),'OFF');
  await p.locator('#matchSettings summary').click();
  await p.locator('#matchHelp summary').click();
  await p.locator('#helpPowerups').scrollIntoViewIfNeeded();
  await p.waitForFunction(()=>[...document.querySelectorAll('#helpPowerups img')].every(i=>i.complete&&i.naturalWidth));
  const icons=await p.locator('#helpPowerups img').evaluateAll(nodes=>nodes.map(i=>{
    const c=document.createElement('canvas');c.width=c.height=96;
    const ctx=c.getContext('2d');ctx.drawImage(i,0,0);
    return {src:i.src,alpha:ctx.getImageData(0,0,1,1).data[3],width:i.getBoundingClientRect().width,render:getComputedStyle(i).imageRendering};
  }));
  assert.equal(new Set(icons.map(i=>i.src)).size,3);
  assert.ok(icons.every(i=>i.alpha===0&&i.width===40&&i.render==='pixelated'));
  await snap(p,'help-'+await p.evaluate(()=>innerWidth));
}
try {
  for(const platform of Object.keys(builds)) {
    const p=await page(platform);
    await tiles(p);
    await mute(p);
    await p.bringToFront();
    const audio=await p.evaluate(async()=>{
      setMusicEnabled(false);stopGameSounds();
      const original=audioCtx;
      async function render(kind,{muted=false,sfx=true,burst=1,suspended=false,stop=false}={}) {
        const context=new OfflineAudioContext(1,14400,48000);
        // Offline contexts start suspended; expose the running state only for
        // waveform measurement. The suspended case exercises the real guard.
        if(!suspended) Object.defineProperty(context,'state',{get:()=> 'running'});
        audioCtx=context;saveData.muteAll=muted;saveData.soundEffectsEnabled=sfx;
        for(let i=0;i<burst;i++) playRoyalPowerupSound(kind);
        if(stop) stopRoyalPowerupSound();
        const data=(await context.startRendering()).getChannelData(0);
        return {peak:Math.max(...data.map(Math.abs)),energy:data.reduce((sum,v)=>sum+v*v,0),tail:Math.max(...data.slice(10080).map(Math.abs))};
      }
      try {
        return {spawn:await render('spawn'),pickup:await render('pickup'),burst:await render('pickup',{burst:100}),
          muted:await render('pickup',{muted:true}),sfxOff:await render('spawn',{sfx:false}),
          suspended:await render('pickup',{suspended:true}),stopped:await render('pickup',{stop:true})};
      } finally {audioCtx=original;saveData.muteAll=false;saveData.soundEffectsEnabled=true;stopGameSounds();}
    });
    assert.ok(audio.spawn.peak>.01 && audio.spawn.peak<=.026,JSON.stringify(audio));
    assert.ok(audio.pickup.peak>audio.spawn.peak && audio.pickup.peak<=.036,JSON.stringify(audio));
    assert.deepEqual(audio.burst,audio.pickup,'100 coincident requests cannot stack volume');
    for(const k of ['muted','sfxOff','suspended','stopped']) assert.equal(audio[k].energy,0,k);
    for(const k of ['spawn','pickup','burst']) assert.equal(audio[k].tail,0,k+' has no lingering cue');
    audioMetrics.push({platform,...audio});
    await p.close();
    console.log('PASS: '+platform+' equal primary modes, accessible mute override, approved help icons and real Web Audio envelopes');
  }
  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:360,height:640}]) {
    const p=await page('Browser',{viewport,hasTouch:true,isMobile:true});
    await tiles(p);await snap(p,'title-'+viewport.width+'x'+viewport.height);
    await p.locator('.primary-online').tap();
    assert.equal(await p.locator('#matchmakingPanel').isVisible(),true);
    assert.equal(await p.locator('#onlinePrivateRooms').isVisible(),true);
    await snap(p,'online-'+viewport.width+'x'+viewport.height);
    await p.evaluate(()=>showTitleScreen());
    await mute(p);
    await p.evaluate(()=>{showTitleScreen();startTwoPlayerFromTitle();waitingForServe=false;paused=false;setMenusVisible(false);syncRoyalUi(true);});
    if(await p.locator('#rotateDevice').isVisible()) await p.locator('#rotateDismiss').click();
    for(const [index,type] of ['split','rush','guard'].entries()) {
      await p.evaluate(({index,type})=>{
        setLevelByAbsoluteIndex(index*6,true);waitingForServe=false;paused=false;
        royalPickup={x:W/2,y:H/2,type,ttl:480};royalPowerupPulse={x:W/2,y:H/2,remaining:42};
        setMenusVisible(false);syncRoyalUi(true);draw(captureVisualState());
      },{index,type});
      await snap(p,'pickup-'+type+'-'+viewport.width+'x'+viewport.height);
    }
    await p.close();
    console.log('PASS: '+viewport.width+'x'+viewport.height+' touch title, online/private sections, mute and all three actual-size pickups');
  }
  for(const locale of ['es','fr','de','pt','it','nl','ja','ko','zh']) {
    const p=await page('Browser',{locale,viewport:{width:390,height:844}});
    assert.notEqual(await p.locator('.primary-online span').innerText(),'Challenge real players');
    assert.notEqual(await p.locator('.primary-campaign span').innerText(),'Single Player — Battle Computer Opponents');
    await p.locator('.primary-online').click();
    assert.notEqual(await p.locator('#findMatchButton').innerText(),'Find Match');
    assert.equal(await p.locator('#matchArenaPreference').count(),0);
    assert.notEqual(await p.locator('.matchmaking-rules').innerText(),'First to 10');
    await p.evaluate(()=>{showTitleScreen();setGameMuteAll(true);});
    await p.locator('#menuToggle').click();await p.locator('#matchSettings summary').click();
    const text=await p.locator('#soundEffectsButton').innerText();
    assert.ok(text && text!=='Muted by Mute All' && text!=='ON');
    assert.equal(await p.locator('#soundEffectsButton').isDisabled(),true);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await p.close();
  }
  console.log('PASS: all nine translations cover the primary modes, matchmaking controls and suppressed audio');
  if(artifacts) await writeFile(artifacts+'/audio-metrics.json',JSON.stringify(audioMetrics,null,2));
  assert.deepEqual(errors,[]);
  console.log('RESULT: 8 new presentation/audio browser groups passed; no page exceptions');
} finally {await browser.close();await new Promise(r=>server.close(r));}
