// Optional Pages asset: never embed this recording in generated HTML/installers.
const BOSS_AUDIO_ASSET = Object.freeze({url:'https://kingalexgilbert.github.io/king-pong/audio/secret-boss-v1.ogg',bytes:684920,
  sha256:'2e88685119d386d9597cf62930a9335a4e894f599f4d580770cad7b4e2734167'});
const bossAudio = {element:null,url:null,bytes:null,loading:null,failed:false,entered:false,active:false,pending:false,epoch:0,nativeRequest:null};
function bossAudioEligible() {
  return (mode===4 || bossIntroActive) && !creditsActive && !document.body.classList.contains('title-active') && playerPreference('originalBossMusic');
}
function bossAudioAudible() { return bossAudioEligible() && gameAudioEnabled('music') && !document.hidden && !window.KingPongBackgrounded; }
function bossAudioOverridesMusic() { return bossAudio.active && bossAudioAudible(); }
async function verifyBossAudio(bytes) {
  if(bytes.byteLength!==BOSS_AUDIO_ASSET.bytes)throw Error('audio size');
  if(window.crypto?.subtle) {
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    if(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')!==BOSS_AUDIO_ASSET.sha256)throw Error('audio hash');
  }
  return bytes;
}
window.KingPongBossAudioReceive=(id,base64)=>{
  const request=bossAudio.nativeRequest;if(!request || request.id!==id)return;
  bossAudio.nativeRequest=null;clearTimeout(request.timer);
  try {
    if(typeof base64!=='string' || base64.length>Math.ceil(BOSS_AUDIO_ASSET.bytes/3)*4)throw Error('audio unavailable');
    request.resolve(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer);
  }catch(error){request.reject(error);}
};
async function loadBossAudio() {
  if(window.KingPongNativeBossAudio || window.KingPongBossAudio?.load) {
    const bytes=await new Promise((resolve,reject)=>{
      const id='boss-'+bossAudio.epoch;
      const timer=setTimeout(()=>{bossAudio.nativeRequest=null;reject(Error('audio timeout'));},15000);
      bossAudio.nativeRequest={id,resolve,reject,timer};
      if(window.KingPongBossAudio?.load)window.KingPongBossAudio.load(id,window.KingPongLanToken);
      else window.chrome.webview.postMessage('kingpong:boss-audio:'+id);
    });return verifyBossAudio(bytes);
  }
  let cache;
  try {
    cache=await caches.open('king-pong-optional-audio-v1');const hit=await cache.match(BOSS_AUDIO_ASSET.url);
    if(hit){try{return await verifyBossAudio(await hit.arrayBuffer());}catch{await cache.delete(BOSS_AUDIO_ASSET.url);}}
  }catch{} // Denied/evicted storage does not prevent playback.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(BOSS_AUDIO_ASSET.url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw Error('audio unavailable');
    const reader=response.body.getReader(),chunks=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
      if(length>BOSS_AUDIO_ASSET.bytes){await reader.cancel();throw Error('audio size');}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    await verifyBossAudio(bytes.buffer);
    try{await cache?.put(BOSS_AUDIO_ASSET.url,new Response(bytes,{headers:{'Content-Type':'audio/ogg'}}));}catch{}
    return bytes.buffer;
  }finally{clearTimeout(timer);}
}
function stopBossAudio() {
  bossAudio.epoch++;bossAudio.active=bossAudio.pending=false;
  if(bossAudio.element){bossAudio.element.pause();bossAudio.element.removeAttribute('src');bossAudio.element.load();bossAudio.element=null;}
  if(bossAudio.url)URL.revokeObjectURL(bossAudio.url);bossAudio.url=null;
}
function syncBossAudio() {
  if(!bossAudioEligible()){if(bossAudio.entered)stopBossAudio();bossAudio.entered=false;return;}
  if(!bossAudio.entered){bossAudio.entered=true;bossAudio.failed=false;bossAudio.epoch++;}
  if(!bossAudioAudible()){bossAudio.element?.pause();bossAudio.active=false;return;}
  if(bossAudio.failed)return;
  if(!bossAudio.bytes){
    if(!bossAudio.loading){
      if(!document.createElement('audio').canPlayType('audio/ogg; codecs="opus"')){bossAudio.failed=true;return;}
      // One attempt per entry. Completion only fills the cache; current game
      // and preference state always determines whether playback can begin.
      bossAudio.loading=loadBossAudio().then(bytes=>{bossAudio.bytes=bytes;}).catch(()=>{bossAudio.failed=true;}).finally(()=>{bossAudio.loading=null;});
    }return;
  }
  if(!bossAudio.element){
    const element=new Audio();element.loop=true;element.preload='auto';
    bossAudio.url=URL.createObjectURL(new Blob([bossAudio.bytes],{type:'audio/ogg'}));element.src=bossAudio.url;bossAudio.element=element;
    element.addEventListener('error',()=>{if(bossAudio.element!==element)return;bossAudio.failed=true;stopBossAudio();});
    element.addEventListener('playing',()=>{if(bossAudio.element!==element || !bossAudioAudible()){element.pause();return;}stopActiveMusicTones();bossAudio.active=true;});
    element.addEventListener('waiting',()=>{bossAudio.active=false;});
  }
  const element=bossAudio.element;
  // Existing procedural music ducks, rather than stops, under pause/serve/results.
  element.volume=Math.max(0,Math.min(1,musicVolumeLevel*.36*(paused||waitingForServe||gameOver||levelCleared||campaignCleared ? 0.37 : 1)));
  if(element.paused && !bossAudio.pending){
    const epoch=bossAudio.epoch;bossAudio.pending=true;
    Promise.resolve(element.play()).catch(()=>{if(epoch===bossAudio.epoch){bossAudio.failed=true;bossAudio.active=false;}}).finally(()=>{
      if(epoch===bossAudio.epoch)bossAudio.pending=false;
      if(bossAudio.element!==element || !bossAudioAudible())element.pause();
    });
  }
}
function toggleOriginalBossMusic(){savePlayerPreference('originalBossMusic',!playerPreference('originalBossMusic'));syncBossAudio();updateAudioControls();}
document.addEventListener('visibilitychange',syncBossAudio);
document.addEventListener('kingpong-background',()=>{bossAudio.element?.pause();bossAudio.active=false;});
window.addEventListener('pagehide',stopBossAudio);
