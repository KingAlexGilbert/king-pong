import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {root} from '../../tests/helpers/game-source.mjs';
const asset=await readFile(new URL('docs/audio/secret-boss-v1.ogg',root));
const server=createServer(async(req,res)=>{try{const f=new URL('.'+new URL(req.url,'http://local').pathname,root);if(!f.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',f.pathname.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--no-sandbox']});const errors=[];let downloads=0;
async function page(path='docs/demo/index.html',setup){
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://kingalexgilbert.github.io/king-pong/audio/secret-boss-v1.ogg',async r=>{downloads++;await r.fulfill({status:200,body:asset,contentType:'audio/ogg',headers:{'Access-Control-Allow-Origin':'*'}});});
 if(setup)await setup(p);await p.goto(origin+'/'+path);await p.mouse.click(3,3);return p;
}
async function enter(p){await p.evaluate(()=>{mode=4;hideTitleScreen();waitingForServe=false;paused=false;creditsActive=false;setMusicEnabled(true);syncRoyalUi(true);});}
async function playing(p){await p.waitForFunction(()=>bossAudio.active&&bossAudio.element?.currentTime>.15);}
try{
 const p=await page();assert.equal(downloads,0);
 await p.evaluate(()=>{savePlayerPreference('originalBossMusic',false);mode=4;hideTitleScreen();syncRoyalUi(true);});await p.waitForTimeout(200);assert.equal(downloads,0);
 await p.evaluate(()=>{setMusicEnabled(false);savePlayerPreference('originalBossMusic',true);syncRoyalUi(true);});await p.waitForTimeout(200);assert.equal(downloads,0);
 await enter(p);await playing(p);assert.equal(downloads,1);
 const t=await p.evaluate(()=>bossAudio.element.currentTime);await p.waitForTimeout(250);assert.ok(await p.evaluate(()=>bossAudio.element.currentTime)>t);
 assert.equal(await p.evaluate(()=>bossAudioOverridesMusic()),true);
 await p.evaluate(()=>setGameMuteAll(true));assert.equal(await p.evaluate(()=>bossAudio.element.paused),true);
 await p.evaluate(()=>setGameMuteAll(false));await playing(p);
 const volume=await p.evaluate(()=>bossAudio.element.volume);await p.evaluate(()=>{paused=true;syncRoyalUi(true);});assert.ok(await p.evaluate(()=>bossAudio.element.volume)<volume);
 await p.evaluate(()=>{paused=false;setMusicVolume(25);});assert.equal(await p.evaluate(()=>bossAudio.element.volume),.09);
 await p.evaluate(()=>{window.KingPongBackgrounded=true;document.dispatchEvent(new Event('kingpong-background'));});assert.equal(await p.evaluate(()=>bossAudio.element.paused),true);
 await p.evaluate(()=>{window.KingPongBackgrounded=false;syncBossAudio();});await playing(p);
 await p.evaluate(()=>{bossAudio.element.currentTime=bossAudio.element.duration-.15;});await p.waitForFunction(()=>bossAudio.element.currentTime<1);
 await p.evaluate(()=>showTitleScreen());assert.equal(await p.evaluate(()=>bossAudio.element),null);assert.equal(await p.evaluate(()=>bossAudioOverridesMusic()),false);
 console.log('PASS actual playback, looping, volume, mute, pause ducking, background/resume, exit');
 await p.reload();await p.mouse.click(3,3);await p.route('https://kingalexgilbert.github.io/**',r=>r.abort());await enter(p);await playing(p);assert.equal(downloads,1);await p.close();
 console.log('PASS persistent browser cache plays after offline reload');
 const native=await page('android/app/src/main/assets/index.html',async p=>{
  await p.exposeFunction('loadNativeTrack',id=>p.evaluate(({id,data})=>KingPongBossAudioReceive(id,data),{id,data:asset.toString('base64')}));
  await p.addInitScript(()=>{window.KingPongBossAudio={load(id){window.loadNativeTrack(id);}};});
 });await enter(native);await playing(native);assert.equal(downloads,1);await native.close();console.log('PASS native cached bytes play in packaged HTML');
 const offline=await page(undefined,async p=>{await p.route('https://kingalexgilbert.github.io/**',r=>r.abort());});await enter(offline);await offline.waitForFunction(()=>bossAudio.failed);assert.equal(await offline.evaluate(()=>bossAudioOverridesMusic()),false);assert.equal(await offline.evaluate(()=>!!musicTimer),true);await offline.close();
 let release;const delayed=await page(undefined,async p=>{await p.route('https://kingalexgilbert.github.io/**',async r=>{await new Promise(resolve=>release=resolve);await r.fulfill({status:200,body:asset,contentType:'audio/ogg',headers:{'Access-Control-Allow-Origin':'*'}});});});
 await enter(delayed);await delayed.waitForFunction(()=>!!bossAudio.loading);await delayed.evaluate(()=>showTitleScreen());for(let i=0;!release&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);release();await delayed.waitForFunction(()=>bossAudio.bytes!==null);assert.equal(await delayed.evaluate(()=>bossAudio.element),null);await delayed.close();
 const rejected=await page(undefined,async p=>{await p.addInitScript(()=>{window.playAttempts=0;HTMLMediaElement.prototype.play=function(){window.playAttempts++;return Promise.reject(Error('denied'));};});});await enter(rejected);await rejected.waitForFunction(()=>bossAudio.failed);await rejected.waitForTimeout(300);assert.equal(await rejected.evaluate(()=>window.playAttempts),1);await rejected.close();
 const before=downloads;const unsupported=await page(undefined,async p=>{await p.addInitScript(()=>{HTMLMediaElement.prototype.canPlayType=()=>'';});});await enter(unsupported);await unsupported.waitForFunction(()=>bossAudio.failed);assert.equal(downloads,before);await unsupported.close();
 console.log('PASS unavailable/unsupported/refused playback and late completion fall back safely');assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
