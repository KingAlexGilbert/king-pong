import assert from 'node:assert/strict';
import {automaticServeChecks} from './automatic-serve-cases.mjs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {root} from '../../tests/helpers/game-source.mjs';
const server=createServer(async(req,res)=>{try{const file=new URL('.'+new URL(req.url,'http://local').pathname,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',file.pathname.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--no-sandbox']});
const children=[],errors=[],internet=[],sockets=[],pages=[],eventsSeen=[];let exiting=false; const controlled=process.argv.includes('--controlled-channels'); let deliveries=Promise.resolve();
async function page(path){
 const p=await browser.newPage({viewport:{width:1280,height:900}});pages.push(p);p.on('pageerror',e=>errors.push(e.message));p.on('websocket',s=>sockets.push(s.url()));
 await p.route('**/*',route=>{if(!route.request().url().startsWith(origin)){internet.push(route.request().url());return route.abort();}return route.continue();});
 const child=spawn('python3',[fileURLToPath(new URL('tests/fixtures/lan-driver.py',root))]);children.push(child);
 child.stderr.on('data',d=>errors.push(d.toString()));let events=Promise.resolve();
 createInterface({input:child.stdout}).on('line',line=>{eventsSeen.push(JSON.parse(line));events=events.then(async()=>{if(!exiting&&!p.isClosed())await p.evaluate(m=>window.KingPongLanReceive(m),JSON.parse(line));}).catch(e=>{if(!exiting)errors.push(e.message);});});
 await p.exposeFunction('nativeLanTest',text=>child.stdin.write(text+'\n'));
 await p.addInitScript(()=>{window.KingPongNativeLan=true;window.chrome={webview:{postMessage(text){if(text.startsWith('kingpong:lan:'))window.nativeLanTest(text.slice(13));}}};});
 if(controlled) await controlledChannels(p);
 await p.goto(origin+'/'+path);await p.evaluate(()=>openOfflineLanSetup(true));return p;
}
async function controlledChannels(p){
 // Capture routing at send time, avoiding an extra browser RPC per packet that
 // can make this controlled channel slower than the production snapshot rate.
 await p.exposeFunction('deliverLocalTest',(raw,state)=>{deliveries=deliveries.then(async()=>{
  if(exiting||p.isClosed())return;
  for(const other of pages)if(other!==p&&!other.isClosed())await other.evaluate(({raw,state})=>{if(onlineSession&&lanRoomCode===state.room&&lanRole!==state.role)onlineSession.control?.onmessage?.({data:raw});},{raw,state});
 }).catch(e=>{if(!exiting)errors.push(e.message);});});
 await p.addInitScript(()=>{window.RTCPeerConnection=class{
  connectionState='new';iceGatheringState='complete';channels=[];
  constructor(config){this.config=config;}getConfiguration(){return this.config;}
  createDataChannel(label){const c={label,readyState:'connecting',bufferedAmount:0,send(raw){window.deliverLocalTest(raw,{room:lanRoomCode,role:lanRole});},close(){this.readyState='closed';}};this.channels.push(c);return c;}
  async createOffer(){return{type:'offer',sdp:'v=0\r\na=fingerprint:sha-256 '+Array(32).fill('AA').join(':')+'\r\n'}}async createAnswer(){return{type:'answer',sdp:'v=0\r\na=fingerprint:sha-256 '+Array(32).fill('BB').join(':')+'\r\n'}}
  async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};if(d.type==='answer')this.open();}
  async setRemoteDescription(d){this.remoteDescription=d;if(d.type==='offer')for(const label of ['pong-lan-input-v1','pong-control-v1'])this.ondatachannel({channel:this.createDataChannel(label)});else this.open();}
  open(){setTimeout(()=>{if(this.connectionState==='closed')return;this.connectionState='connected';for(const c of this.channels){c.readyState='open';c.onopen?.();}this.onconnectionstatechange?.();},30);}
  async addIceCandidate(){}async getStats(){return new Map();}close(){this.connectionState='closed';}
 };});
}
const verify=process.argv.includes('--verify-pairing');
try{
 console.log(controlled?'MODE: real TCP/UDP with controlled RTC':'MODE: real TCP/UDP and WebRTC');
 const host=await page('Linux/assets/index.html'),guest=await page('docs/demo/index.html');
 if(verify)await host.locator('#localPairing').check();
 await host.locator('#localLanHost').click();await host.waitForFunction(()=>onlineSession?.code);
 const code=await host.evaluate(()=>onlineSession.code);
 await guest.locator('#localLanScan').click();await guest.waitForFunction(()=>localLanRooms.length>0);
 assert.ok((await guest.locator('#localLanRooms option').allTextContents()).includes(await host.locator('#localLanHint').innerText()),'host and guest share an anonymous temporary room label');
 await guest.locator('#localLanCode').fill(code);await guest.locator('#localLanJoin').click();
 await host.locator('#saveConfirmAccept').waitFor({state:'visible'});
 assert.equal(await host.evaluate(()=>lanPeer),null,'RTC does not start before approval');
 await host.locator('#saveConfirmAccept').click();
 if(verify){
  await host.waitForFunction(()=>onlineSession?.pairing?.remoteShown);await guest.waitForFunction(()=>onlineSession?.pairing?.remoteShown);
  assert.equal(await host.locator('#pairingPin').innerText(),await guest.locator('#pairingPin').innerText());
  for(const p of [host,guest])assert.deepEqual(await p.evaluate(()=>[lanConnected,onlineGameBlocked]),[false,true]);
  await host.locator('#pairingAccept').click();console.log('PASS optional PIN comparison blocks gameplay until accepted');
 }
 await Promise.all([host.waitForFunction(()=>lanConnected,{},{timeout:20000}),guest.waitForFunction(()=>lanConnected,{},{timeout:20000})]);
 assert.deepEqual(await host.evaluate(()=>lanPeer.getConfiguration().iceServers),[]);
 assert.deepEqual(await guest.evaluate(()=>lanPeer.getConfiguration().iceServers),[]);
 await Promise.all([host.waitForFunction(()=>onlineMatchFlow?.phase==='ready'),guest.waitForFunction(()=>onlineMatchFlow?.phase==='ready')]);
 await host.evaluate(()=>confirmOnlineMatchReady());await guest.evaluate(()=>confirmOnlineMatchReady());
 await host.waitForFunction(()=>!onlineMatchFlowBlocksPlay(),{},{timeout:12000});
 await guest.waitForFunction(()=>!onlineMatchFlowBlocksPlay(),{},{timeout:12000});
 console.log('PASS local signaling, approval, ready/countdown; '+(controlled?'controlled RTC':'actual WebRTC'));
 await automaticServeChecks(host,guest,'offline LAN');
 await host.evaluate(()=>onlineSession.kickGuest());await host.waitForFunction(()=>!lanConnected&&onlineSession?.code);
 await guest.waitForFunction(()=>!onlineSession);assert.equal(await host.evaluate(()=>onlineSession.code),code);
 console.log('PASS kick retains host room; guest stops');
 await host.evaluate(()=>showTitleScreen());assert.equal(await host.evaluate(()=>onlineSession),null);
 assert.deepEqual(internet,[]);assert.deepEqual(sockets,[]);assert.deepEqual(errors,[]);
 console.log('PASS no HTTP/WebSocket request to any internet endpoint in LAN mode');
}catch(e){console.log('DIAGNOSTIC',JSON.stringify({errors,events:eventsSeen.map(e=>({...e,message:e.message?{type:e.message.type}:undefined}))}));for(const p of pages)console.log(await p.evaluate(()=>({role:lanRole,status:lanLastStatus,connection:lanPeer?.connectionState,ice:lanPeer?.iceConnectionState,gathering:lanPeer?.iceGatheringState,candidates:(lanPeer?.localDescription?.sdp.match(/a=candidate/g)||[]).length,remote:!!lanPeer?.remoteDescription,flow:onlineMatchFlow?.phase})));throw e;}finally{exiting=true;for(const c of children)c.stdin.end();await browser.close();server.close();}
