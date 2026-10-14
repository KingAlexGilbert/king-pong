import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

// Repeatable application-byte measurements, not WebRTC transport or TURN billing.
// --source can point to the saved pre-change tree or an ordinary repository checkout.
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const source = resolve(option('--source', fileURLToPath(new URL('../../', import.meta.url))));
const peerSource = resolve(option('--peer-source', source));
const output = option('--output', null);
const quick = process.argv.includes('--quick');
const faults = process.argv.includes('--faults');
const only = option('--scenario',null);
const scenarios = faults ? [['latency-zero',30],['latency-80',30],['jitter-loss',30],['burst-recovery',30]] : [['rally',60],['fast',60],['powerups',60],['score-serve',60],['paused',60],['idle-connected',60],['countdown',12],['long-match',quick?60:1800]];
const server = createServer(async (req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path === '/harness') {
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><body style="margin:0;display:flex;background:black"><iframe id="host" width="640" height="480" src="/docs/demo/index.html"></iframe><iframe id="guest" width="640" height="480" src="/peer/docs/demo/index.html"></iframe>');
      return;
    }
    const selectedRoot=path.startsWith('/peer/')?peerSource:source;
    const file = resolve(selectedRoot, '.'+(path.startsWith('/peer/')?path.slice(5):path));
    if (!file.startsWith(selectedRoot+sep)) throw new Error();
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
const results=[];
try {
  for (const [scenario,seconds] of scenarios.filter(([name])=>!only||name===only)) {
    const page=await browser.newPage({viewport:{width:1280,height:540}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.requestAnimationFrame=()=>1;
      window.benchNow=0; performance.now=()=>benchNow;
      window.addEventListener('blur',e=>e.stopImmediatePropagation(),true);
      Math.random=()=>.5;
      Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>'',set:()=>{}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/harness`);
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(f=>typeof f.contentWindow.update==='function'));
    const result=await page.evaluate(({scenario,seconds})=>{
      const host=document.querySelector('#host').contentWindow, guest=document.querySelector('#guest').contentWindow;
      const bytes=s=>new TextEncoder().encode(s).length;
      const totals={host:{bytes:0,messages:0,reliableBytes:0,types:{},seconds:[],maxMessage:0},
        guest:{bytes:0,messages:0,reliableBytes:0,types:{},seconds:[],maxMessage:0}};
      const queue=[];
      const impaired=['latency-80','jitter-loss','burst-recovery'].includes(scenario);
      const jitter=['jitter-loss','burst-recovery'].includes(scenario);
      let randomSeed=13579,dropped=0,reordered=0,lastState=-1;
      const random=()=>((randomSeed=Math.imul(randomSeed,1664525)+1013904223>>>0)/4294967296);
      const controlDue={host:0,guest:0},events=[],inputProcessing=[];
      const inputSent=new Map();let processedSeq=-1;
      let lastWireSequence={host:-1,guest:-1};
      const inputExperiment=scenario.startsWith('latency-')||jitter;
      const fieldBytes={};
      let now=0, deliveries=0;
      window.benchChannelSend=(role,reliable,raw)=>{
        const n=bytes(raw), m=JSON.parse(raw), type=m.type || m[2] || 'unknown', t=totals[role];
        t.bytes+=n; t.messages++; t.maxMessage=Math.max(t.maxMessage,n);
        if(reliable)t.reliableBytes+=n;
        (t.types[type] ||= {bytes:0,messages:0}).bytes+=n; t.types[type].messages++;
        const second=Math.min(seconds-1,Math.floor(now/1000));
        t.seconds[second]=(t.seconds[second]||0)+n;
        if(role==='host' && m.type==='state') for(const [k,v] of Object.entries(m))
          fieldBytes[k]=(fieldBytes[k]||0)+bytes(JSON.stringify({[k]:v}))-2;
        const seq=m.seq ?? m[4];
        if(role==='guest'&&(type==='input'||type==='i'))inputSent.set(seq,now);
        if(!reliable && impaired && ((scenario==='burst-recovery'&&now>=10000&&now<11000)||(jitter&&random()<.1))) {dropped++;return;}
        let due=now+(impaired?40:0)+(jitter?random()*80-40:0);
        if(reliable){due=Math.max(due,controlDue[role]);controlDue[role]=due;}
        queue.push({to:role==='host'?guest:host,role,raw,seq,due,reliable});
      };
      const init=role=>`
        hideTitleScreen(); startOnlineSetup(false); mode=2; lanRole=${JSON.stringify(role)};
        onlineSession={close(){},fail(code){throw new Error('session failed: '+code);}};
        onlineGameBlocked=false; lanConnected=true; lanRoomCode='ABCDE'; onlineHasState=true;
        onlineMatchFlow=null; gameWindowFocused=true; royalRotateDismissed=true; saveData.muteAll=true;
        matchRuleId='endless'; setLevelByAbsoluteIndex(${scenario==='powerups'?8:0},true);
        matchRuleId='endless'; frame=0; left.score=right.score=0;
        resetMatchConnectionState(); resetPaddles(); resetBall(1,true);
        waitingForServe=true; paused=false; serveOrContinue();
        onlineControlChannel={readyState:'open',bufferedAmount:0,send(raw){parent.benchChannelSend(${JSON.stringify(role)},true,raw);}};
        lanChannel={readyState:'open',bufferedAmount:0,send(raw){parent.benchChannelSend(${JSON.stringify(role)},false,raw);}};
        setMenusVisible(false); syncRoyalUi(true);
        window.benchReceive=raw=>handleLanMessage(raw);
        window.benchStep=(time,config)=>{
          benchNow=time;
          if(lanRole==='host') {
            left.y=clamp(ball.y-PADDLE_H/2,visiblePlayfieldBounds().top,visiblePlayfieldBounds().bottom-PADDLE_H);
            if(config.score) pointForPlayer();
            if(waitingForServe && !paused && !gameOver) serveOrContinue();
            if(config.powerup) {ball.lastHit='left';awardRoyalPowerup(config.powerup);}
          } else if(config.target !== undefined) touchPaddleTargets.right=config.target;
          update();
        };
        window.benchBallY=()=>ball.y-PADDLE_H/2;
        window.benchSummary=()=>({ball:[ball.x,ball.y,ball.vx,ball.vy],scores:[left.score,right.score],
          frame,waiting:waitingForServe,paused,rally:royalRallyId,split:!!royalSplitBall,
          guestSnapshots:guestSnapshots.length,inputs:onlineInputs.size,rightY:right.y,applied:onlineAppliedInputSeq,stateSeq:lanLastStateSeq,renderTime:guestRenderTime});
      `;
      host.eval(init('host')); guest.eval(init('guest'));
      // Menu focus can pause the sibling frame while it initializes. Start both only now.
      for(const w of [host,guest])w.eval('gameWindowFocused=true;paused=false;');
      if(['paused','idle-connected'].includes(scenario)) for(const w of [host,guest])w.eval(`paused=true;waitingForServe=${scenario==='idle-connected'};`);
      if(scenario==='fast')host.eval('clearRallyLaunchRamp();ball.vx=9;ball.vy=2.5;');
      if(scenario==='countdown')host.eval('paused=true;resumeCountdownEndAt=RESUME_COUNTDOWN_MS;');
      const flush=()=>{let limit=100;
        while(--limit){queue.sort((a,b)=>a.due-b.due);if(!queue.length||queue[0].due>now)break;
          const q=queue.shift();q.to.benchNow=now;
          if(!q.reliable&&Number.isSafeInteger(q.seq)){
            if(q.seq<lastWireSequence[q.role])reordered++;
            lastWireSequence[q.role]=Math.max(lastWireSequence[q.role],q.seq);
          }
          q.to.benchReceive(q.raw);deliveries++;
        }if(!limit)throw new Error('message loop');};
      for(let tick=1;tick<=seconds*60;tick++) {
        now=tick*1000/60;
        const idle=['paused','idle-connected'].includes(scenario);
        // Leave time to reach a speed-limited target after the one-second blackout.
        const inputInterval = scenario==='burst-recovery' ? 90 : 45;
        const target=inputExperiment?(Math.floor((tick-1)/inputInterval)%2?310:105):host.benchBallY();
        if(inputExperiment&&(tick-1)%inputInterval===0)events.push({at:now,target,response:null,onset:null,startY:host.benchSummary().rightY,previousY:host.benchSummary().rightY,speed:host.eval('PADDLE_SPEED')});
        flush();guest.benchStep(now,idle?{}:{target});flush();
        host.benchStep(now,{score:scenario==='score-serve' && tick%240===0,
          powerup:scenario==='powerups' && tick%120===0?['split','rush','guard'][Math.floor(tick/120)%3]:null});flush();
        if(inputExperiment){
          const hs=host.benchSummary(),gs=guest.benchSummary(),event=events.at(-1);
          if(event.onset===null && (hs.rightY-event.previousY)*(event.target-event.previousY)>0) event.onset=now-event.at;
          event.previousY=hs.rightY;
          if(event.response===null&&Math.abs(hs.rightY-event.target)<.02)event.response=now-event.at;
          if(hs.applied>processedSeq){
            if(inputSent.has(hs.applied))inputProcessing.push(now-inputSent.get(hs.applied));
            processedSeq=hs.applied;
          }
          if(gs.stateSeq<lastState)throw Error('authoritative state rolled backward');lastState=gs.stateSeq;
          if(gs.guestSnapshots>12||gs.inputs>120)throw Error('unbounded state history');
          for(const w of [host,guest])w.eval('renderFrame(1,performance.now());');
        } else if(tick%60===0)for(const w of [host,guest])w.eval('syncRoyalUi();renderFrame(1,performance.now());');
      }
      for(const t of Object.values(totals)) {
        t.averageKBps=t.bytes/seconds/1000;t.peakOneSecondKBps=Math.max(...t.seconds)/1000;
        t.averageMessageBytes=t.bytes/t.messages;t.messagesPerSecond=t.messages/seconds;
        delete t.seconds;
      }
      const samples=events.filter(e=>e.response!==null).map(e=>e.response).sort((a,b)=>a-b);
      const timing=samples.length?{eventSamples:samples.length,unresolvedEvents:events.length-samples.length,
        meanInputResponseMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95InputResponseMs:samples[Math.floor(samples.length*.95)],
        maxInputResponseMs:samples.at(-1),
        maxMovementOnsetMs:Math.max(...events.filter(e=>e.onset!==null).map(e=>e.onset)),
        maxArrivalOverTravelMs:Math.max(...events.filter(e=>e.response!==null).map(e=>e.response-Math.ceil(Math.abs(e.startY-e.target)/e.speed)*1000/60)),
        meanInputPacketProcessingMs:inputProcessing.reduce((a,b)=>a+b,0)/inputProcessing.length,
        configuredBaseRTT:impaired?80:0,configuredJitterEachWayMs:jitter?40:0,dropped,reordered}:null;
      // Recovery has a fresh self-contained authoritative snapshot, just as reconnect does.
      now+=300;flush();
      const measureSend=window.benchChannelSend;window.benchChannelSend=(role,reliable,raw)=>(role==='host'?guest:host).benchReceive(raw);
      host.eval('sendLanState(true)');window.benchChannelSend=measureSend;
      return {scenario,seconds,timing,host:totals.host,guest:totals.guest,
        hostDownloadKBps:totals.guest.averageKBps,guestDownloadKBps:totals.host.averageKBps,
        averageDownloadPerPlayerKBps:(totals.host.averageKBps+totals.guest.averageKBps)/2,
        deliveries,baselineFieldBytes:fieldBytes,hostState:host.benchSummary(),guestState:guest.benchSummary()};
    },{scenario,seconds});
    if(!['paused','idle-connected'].includes(scenario)) assert.equal(result.hostState.paused,false,scenario+' must run');
    if(faults) {
      assert.equal(result.timing.unresolvedEvents,0,'every input event recovers');
      // Networked touch is now speed limited. Measure the first movement separately
      // from the physically necessary travel time to the requested target.
      assert.ok(result.timing.maxMovementOnsetMs < (scenario==='burst-recovery'?1200:250), JSON.stringify(result.timing));
      assert.ok(result.timing.maxArrivalOverTravelMs < (scenario==='burst-recovery'?1200:250), JSON.stringify(result.timing));
      if(scenario==='jitter-loss') assert.ok(result.timing.dropped>0&&result.timing.reordered>0);
    }
    result.hostState.ball.forEach((n,i)=>assert.ok(Math.abs(n-result.guestState.ball[i])<=.00501,'full state recovery'));
    assert.equal(result.hostState.rally,result.guestState.rally);
    assert.equal(result.hostState.split,result.guestState.split);
    assert.equal(result.hostState.scores[0],result.guestState.scores[0]);
    assert.equal(result.hostState.scores[1],result.guestState.scores[1]);
    results.push(result);
    console.log(`${scenario}: host ${result.host.averageKBps.toFixed(3)} KB/s; guest ${result.guest.averageKBps.toFixed(3)} KB/s; ${result.host.messagesPerSecond.toFixed(2)}/${result.guest.messagesPerSecond.toFixed(2)} messages/s`);
    await page.close();
  }
  assert.deepEqual(errors,[]);
  const report={measurement:'UTF-8 application payload bytes from production send(), controlled two-page delivery',
    decimalUnits:true,transportBytes:null,realRTT:null,turnUsage:null,source,peerSource,results};
  if(output){await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
} finally {await browser.close();await new Promise(r=>server.close(r));}
