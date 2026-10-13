// Counts production queue messages under a controlled 30-minute idle lease.
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const i=process.argv.indexOf('--source');
const root=i>=0?resolve(process.argv[i+1]):fileURLToPath(new URL('../../',import.meta.url));
const {MatchmakingQueue}=await import(pathToFileURL(resolve(root,'signaling/src/matchmaking.js')));
globalThis.WebSocketRequestResponsePair=class {};
let now=Date.now();const originalNow=Date.now;Date.now=()=>now;
const messages=[];let alarms=0,attachments=0;
const s={a:{joinedAt:now,state:'watching'},deserializeAttachment(){return structuredClone(this.a)},
  serializeAttachment(a){attachments++;this.a=structuredClone(a)},send(raw){messages.push({at:now,bytes:Buffer.byteLength(raw),raw})}};
const ctx={blockConcurrencyWhile:fn=>fn(),setWebSocketAutoResponse(){},getWebSockets:()=>[s],
  getWebSocketAutoResponseTimestamp:()=>new Date(now),storage:{setAlarm:async()=>{},deleteAlarm:async()=>{},deleteAll:async()=>{}}};
try {
  new MatchmakingQueue(ctx,{}).broadcast();
  for(let n=0;n<60;n++){now+=30000;alarms++;await new MatchmakingQueue(ctx,{}).alarm();}
  console.log(JSON.stringify({scope:'Controlled queue notifications, 30 min, one idle watcher with healthy auto-pong lease',
    messages:messages.length,payloadBytes:messages.reduce((n,m)=>n+m.bytes,0),alarms,attachments,
    heartbeatPayloadBytes:90*8,heartbeatIntervalSeconds:20,note:'Heartbeat bytes are calculated, not sent through this mock. Auto-response setup and expiry are covered by Miniflare tests.'},null,2));
} finally {Date.now=originalNow;}
