// Local workerd + real TCP WebSockets; no admission or encryption cost is timed.
// Usage: node test/relay-benchmark.mjs [source-directory] [seconds=8] [warmup=2]
// Run different versions sequentially with relay-benchmark-pairs.mjs.
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';

const src=resolve(process.argv[2] || fileURLToPath(new URL('../src',import.meta.url)));
const duration=1000*Number(process.argv[3]||8), warmup=1000*Number(process.argv[4]??2);
assert.ok(duration>=1000 && duration<=60000 && warmup>=0 && warmup<=30000,'invalid benchmark duration');
const entry=`import {PongRoom} from './worker.js';
export class BenchRoom extends PongRoom {
 messages=0;
 webSocketMessage(socket,raw){this.messages++;return super.webSocketMessage(socket,raw);}
 async fetch(request) {
  const url=new URL(request.url);
  if(url.searchParams.has('stats')) {
   if(url.searchParams.has('reset'))this.messages=0;
   return Response.json({messages:this.messages,sockets:this.ctx.getWebSockets().map(s=>{const a=s.deserializeAttachment();return {slots:a.secure.out.length,bytes:a.secure.outBytes,high:a.secure.high};})});
  }
  const p=new WebSocketPair(),s=p[1],role=this.ctx.getWebSockets().length?'guest':'host';this.ctx.acceptWebSocket(s);
  s.serializeAttachment({role,joinedAt:Date.now(),windowAt:Date.now(),count:0,secure:{id:'bench',role,epoch:2,mode:'ws',active:true,high:0,out:[],outBytes:0,ticket:0,windowAt:Date.now(),count:0,bytes:0}});
  return new Response(null,{status:101,webSocket:p[0]});
 }
}
export default {fetch(r,e){return e.BENCH.get(e.BENCH.idFromName(new URL(r.url).searchParams.get('room'))).fetch(r);}};`;
const mf=new Miniflare(convertV4MiniflareOptions({modulesRoot:src,modules:[
  {type:'ESModule',path:resolve(src,'benchmark-entry.mjs'),contents:entry},
  ...readdirSync(src).filter(f=>f.endsWith('.js')).map(f=>({type:'ESModule',path:resolve(src,f)}))
],compatibilityDate:'2025-09-06',durableObjects:{BENCH:{className:'BenchRoom',useSQLite:true}}}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const rounded=n=>+n.toFixed(3);
const percentiles=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const at=p=>sorted.length?rounded(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]):null;
  return {p50:at(.5),p95:at(.95),p99:at(.99)};
};
// Optional Linux process accounting. Only sampled at phase boundaries; this
// includes the benchmark/runtime, not isolated Cloudflare request CPU time.
const ticks=process.platform==='linux'?Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'})):0;
function runtimeUsage(pid=process.pid,result={}) {
  if(!ticks)return result;
  try {
    // Miniflare can spawn workerd from a Node worker thread.
    const children=new Set(readdirSync(`/proc/${pid}/task`).flatMap(tid=>readFileSync(`/proc/${pid}/task/${tid}/children`,'utf8').trim().split(/\s+/).filter(Boolean)));
    for(const child of children) {
      const stat=readFileSync(`/proc/${child}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
      const rss=readFileSync(`/proc/${child}/status`,'utf8').match(/^VmRSS:\s+(\d+) kB/m);
      if(stat.includes('(workerd)'))result[child]={cpuUs:(Number(fields[11])+Number(fields[12]))*1e6/ticks,rssBytes:Number(rss?.[1]||0)*1024};
      runtimeUsage(child,result);
    }
  } catch { /* Unavailable/exited process is reported as missing, not zero CPU. */ }
  return result;
}
function throttleUsage() {
  try{return Object.fromEntries(readFileSync('/sys/fs/cgroup/cpu.stat','utf8').trim().split('\n').map(s=>{const [k,v]=s.split(' ');return [k,Number(v)];}));}catch{return null;}
}

async function runCase(url,config) {
  const address=new URL(url);address.searchParams.set('room',config.name);
  const statsUrl=address.href+'&stats=1';address.protocol='ws:';
  const clients=[];
  for(let i=0;i<2;i++) {
    const s=new WebSocket(address);clients.push(s);
    await new Promise((r,j)=>{s.addEventListener('open',r,{once:true});s.addEventListener('error',j,{once:true});});
  }
  const seq=[0,0];let error=null,phase;
  clients.forEach((s,i)=>{
    s.onclose=()=>{error ||= Error('unexpected socket closure');};
    s.onerror=()=>{error ||= Error('unexpected socket error');};
    s.onmessage=event=>{
      const m=JSON.parse(event.data),p=phase,item=p?.sent[1-i].get(m.seq);
      if(m.type!=='secure-frame'||!item){error ||= Error('unexpected relay response');return;}
      p.forwarded++;if(item.lane==='d')p.forwardedData++;
      p.latency.push(performance.now()-item.stamp);
      const delay=config.delay+(config.name==='jitter'?((m.seq*17)%61):0);
      const timer=setTimeout(()=>{
        if(item.lane==='c'&&p.controls[1-i].has(item.id)){
          p.controlDelay.push(performance.now()-p.controls[1-i].get(item.id).start);p.controls[1-i].delete(item.id);
        }
        p.credits[i]=Math.max(p.credits[i],m.ticket);p.timers.delete(timer);
      },delay);p.timers.add(timer);
    };
  });
  async function runPhase(milliseconds) {
    const before=await (await fetch(statsUrl+'&reset=1')).json();
    const p=phase={sent:[new Map(),new Map()],credits:[0,0],credited:[0,0],controls:[new Map(),new Map()],timers:new Set(),
      latency:[],controlDelay:[],frames:0,data:0,forwarded:0,forwardedData:0,creditCount:0,retries:0,skipped:0,maxBuffered:0,maxSlots:0,maxBytes:0};
    const loop=monitorEventLoopDelay({resolution:10});loop.enable();
    const cpu=process.cpuUsage(),rssStart=process.memoryUsage().rss,workerStart=runtimeUsage(),throttleStart=throttleUsage();
    const start=performance.now(),due=[start,start],controlDue=[start+250,start+750];let controlId=0,sampling=null;
    const send=(i,lane,id)=>{
      const n=++seq[i];p.sent[i].set(n,{stamp:performance.now(),lane,id});
      clients[i].send(JSON.stringify({type:'secure-frame',session:'bench',epoch:2,lane,seq:n,body:'A'.repeat(lane==='d'?320:64)}));
      p.frames++;if(lane==='d')p.data++;
      p.maxBuffered=Math.max(p.maxBuffered,clients[i].bufferedAmount);
    };
    const retry=now=>{for(let i=0;i<2;i++)for(const [id,c] of p.controls[i])if(now-c.last>=500){send(i,'c',id);c.last=now;p.retries++;}};
    const credit=()=>clients.forEach((s,i)=>{if(p.credits[i]>p.credited[i]){
      p.credited[i]=p.credits[i];s.send(JSON.stringify({type:'secure-credit',session:'bench',epoch:2,ticket:p.credits[i]}));p.creditCount++;
    }});
    const creditTimer=setInterval(credit,50);
    // Sampling may observe but must never pace the sender. At most one request
    // is in flight, with the same sampling overhead on both source versions.
    const sampleTimer=setInterval(()=>{
      if(sampling)return;
      sampling=fetch(statsUrl).then(r=>r.json()).then(stats=>{for(const s of stats.sockets){p.maxSlots=Math.max(p.maxSlots,s.slots);p.maxBytes=Math.max(p.maxBytes,s.bytes);}})
        .catch(e=>{error ||= e;}).finally(()=>{sampling=null;});
    },200);
    let now;
    try {
      while((now=performance.now())-start<milliseconds) {
        if(error)throw error;
        for(let i=0;i<2;i++) {
          if(now>=due[i]) {
            const batch=config.batch||1,interval=batch*1000/config.rates[i];
            const missed=Math.floor((now-due[i])/interval);p.skipped+=missed*batch;
            for(let n=0;n<batch;n++)send(i,'d');
            due[i]+=(missed+1)*interval; // No drift and no catch-up flood.
          }
          if(now>=controlDue[i]){const id=++controlId;p.controls[i].set(id,{start:now,last:now});send(i,'c',id);controlDue[i]=now+1000;}
        }
        retry(now);await wait(2);
      }
      const sendingMs=performance.now()-start;
      clearInterval(sampleTimer);if(sampling)await sampling;
      // Drain measurement traffic and keep retrying controls. The old harness
      // could stop before delayed controls/credits completed and miscount drops.
      await wait(config.delay+150);
      const deadline=performance.now()+3000;
      while(p.controls.some(c=>c.size)||p.timers.size||clients.some(s=>s.bufferedAmount)) {
        if(error)throw error;
        if(performance.now()>deadline)throw Error('benchmark drain timed out');
        retry(performance.now());await wait(10);
      }
      credit();await wait(50);clearInterval(creditTimer);
      const final=await (await fetch(statsUrl)).json(),totalMs=performance.now()-start;
      if(error)throw error;
      assert.equal(final.messages,p.frames+p.creditCount,'all incoming frames/credits were processed');
      assert.equal(final.sockets.reduce((n,s)=>n+s.high,0)-before.sockets.reduce((n,s)=>n+s.high,0),p.frames,'all frame sequences processed');
      loop.disable();const nodeCpu=process.cpuUsage(cpu),workerEnd=runtimeUsage(),throttleEnd=throttleUsage();
      const workers=Object.keys(workerStart).filter(pid=>workerEnd[pid]);
      return {case:config.name,sendingSeconds:rounded(sendingMs/1000),totalSeconds:rounded(totalMs/1000),
        incoming:final.messages,incomingPerSecond:rounded(final.messages*1000/totalMs),frames:p.frames,offeredDataPerSecond:rounded(p.data*1000/sendingMs),
        forwarded:p.forwarded,droppedData:p.data-p.forwardedData,skippedGenerationSlots:p.skipped,
        forwardMs:percentiles(p.latency),controlMs:percentiles(p.controlDelay),controlsDelivered:p.controlDelay.length,controlsPending:p.controls.reduce((n,c)=>n+c.size,0),controlRetries:p.retries,
        nodeEventLoopMs:{p50:rounded(loop.percentile(50)/1e6),p95:rounded(loop.percentile(95)/1e6),p99:rounded(loop.percentile(99)/1e6),max:rounded(loop.max/1e6)},
        maxSenderBufferedBytes:p.maxBuffered,maxObservedInFlightSlots:p.maxSlots,maxObservedInFlightBytes:p.maxBytes,
        resources:{nodeCpuMs:rounded((nodeCpu.user+nodeCpu.system)/1000),nodeRssStartBytes:rssStart,nodeRssEndBytes:process.memoryUsage().rss,
          workerdCpuMs:workers.length?rounded(workers.reduce((n,pid)=>n+workerEnd[pid].cpuUs-workerStart[pid].cpuUs,0)/1000):null,
          workerdRssStartBytes:workers.length?workers.reduce((n,pid)=>n+workerStart[pid].rssBytes,0):null,
          workerdRssEndBytes:workers.length?workers.reduce((n,pid)=>n+workerEnd[pid].rssBytes,0):null,
          cgroupThrottledMs:throttleEnd&&throttleStart?rounded((throttleEnd.throttled_usec-throttleStart.throttled_usec)/1000):null}};
    } finally {clearInterval(creditTimer);clearInterval(sampleTimer);for(const t of p.timers)clearTimeout(t);loop.disable();}
  }
  try {if(warmup)await runPhase(warmup);return await runPhase(duration);}
  finally {for(const s of clients){s.onmessage=s.onclose=s.onerror=null;s.close();}}
}
try {
  const url=await mf.ready,results=[];
  for(const config of [{name:'normal',rates:[20,30],delay:0},{name:'jitter',rates:[20,30],delay:40},
    {name:'burst',rates:[120,120],batch:6,delay:0},{name:'slow',rates:[120,120],batch:6,delay:400}])results.push(await runCase(url,config));
  console.log(JSON.stringify({source:src,node:process.version,requestedSeconds:duration/1000,warmupSeconds:warmup/1000,
    runtime:'localhost workerd + Node native TCP WebSockets; combined dispatch/forwarding latency; synthetic ciphertext-shaped payloads',
    method:'warm-up excluded; independent HTTP sampling; observed elapsed throughput includes drain; no concurrent suite; resource samples at phase boundaries',results},null,2));
} finally {await mf.dispose();}
