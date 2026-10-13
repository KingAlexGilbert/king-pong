// Developer rendering investigation; timings are browser measurements, not physical refresh-rate validation.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {functionSource} from '../../tests/helpers/game-source.mjs';
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const root=resolve(option('--source',fileURLToPath(new URL('../../',import.meta.url))));
const out=option('--output',null);
const baselineRoot=option('--baseline',null);
const baselineRipple=baselineRoot?functionSource(await readFile(resolve(baselineRoot,'game/royal-gameplay.js'),'utf8'),'drawSpawnRipple'):null;
const server=createServer(async(req,res)=>{try {
 const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+sep))throw Error();
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(path));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results=[];
try {
 for(const scale of [1,2,3,4]) {
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.profileRAF=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>1;Math.random=()=>.5;
    Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>'',set:()=>{}});});
  await page.goto(`http://127.0.0.1:${server.address().port}/docs/demo/index.html`);
  const result=await page.evaluate(async ({scale,baselineRipple})=>{
    hideTitleScreen();mode=2;lanRole='none';lanConnected=false;activeCampaign=0;levelIndex=0;matchArenaId=0;
    cloneHazards();resetPaddles();resetBall(1,false);setMenusVisible(false);saveData.muteAll=true;
    paused=waitingForServe=gameOver=levelCleared=campaignCleared=false;gameWindowFocused=true;
    renderScale=scale;canvas.width=W*scale;canvas.height=H*scale;cachedStaticBackground=null;
    const view=captureVisualState();view.launch.remaining=0;view.powerupPulse=null;
    const oldRipple=drawSpawnRipple,oldSound=playRoyalPowerupSound;
    const comparisonRipple=baselineRipple?eval('('+baselineRipple+')'):null;
    const stats=values=>{values.sort((a,b)=>a-b);return{n:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,
      p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],p99:values[Math.floor(values.length*.99)],max:values.at(-1)}};
    const timings={};
    // Readback makes queued raster work observable. Same readback in every variant;
    // this isolates raster cost but is not ordinary presentation FPS.
    for(const variant of comparisonRipple?['off','baseline','ripple','no-shadow','ripple','baseline','off']:['off','ripple','no-shadow','off','no-shadow','ripple']) {
      if(variant==='no-shadow')drawSpawnRipple=(pulse,color)=>{
        const progress=1-pulse.remaining/60,radius=10+28*progress,alpha=(1-progress)*.82;
        ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.shadowBlur=0;
        ctx.beginPath();ctx.arc(pulse.x,pulse.y,radius,0,Math.PI*2);ctx.stroke();
        ctx.globalAlpha=alpha*.42;ctx.lineWidth=1;ctx.beginPath();ctx.arc(pulse.x,pulse.y,radius*.58,0,Math.PI*2);ctx.stroke();ctx.restore();
      };else drawSpawnRipple=variant==='baseline'?comparisonRipple:oldRipple;
      const samples=[];
      for(let i=0;i<90;i++) {
        view.powerupPulse=variant==='off'?null:{x:320,y:240,remaining:60-(i%59)};
        view.ball.x=100+(i%70)*6;view.ball.y=100;
        const start=performance.now();draw(view);ctx.getImageData(0,0,1,1);
        if(i>=15)samples.push(performance.now()-start);
      }
      (timings[variant] ||= []).push(...samples);
    }
    drawSpawnRipple=oldRipple;
    const initialization={};
    for(const type of ['split','rush','guard']) {
      const samples=[];for(let i=0;i<200;i++){royalPickupIndex=i;const start=performance.now();findRoyalPickupSpot(type);samples.push(performance.now()-start);}
      initialization[type]=stats(samples);
    }
    saveData.muteAll=false;saveData.soundEffectsEnabled=true;ensureAudioContext();if(audioCtx?.state==='suspended')await audioCtx.resume();
    const audio=[];for(let i=0;i<30;i++){stopRoyalPowerupSound();const start=performance.now();oldSound('spawn');audio.push(performance.now()-start);}stopRoyalPowerupSound();
    const audioResult={state:audioCtx?.state,setup:stats(audio)};
    const placement=[];
    if(scale===1)for(const arena of arenaCatalog){matchArenaId=arena.id;hazards=arena.level.hazards.map(h=>({...h}));
      const samples=[];for(let phase=0;phase<12;phase++){
        for(let i=0;i<30;i++)updateHazards();
        for(let i=0;i<8;i++){royalPickupIndex=(phase*8+i)*3;royalRallyId=phase;royalRallyTick=180+royalPickupIndex*480;
          const t=performance.now();findRoyalPickupSpot('split');samples.push(performance.now()-t);}
      }placement.push({arena:arena.id,...stats(samples)});
    }
    let presentation=null;
    if(comparisonRipple&&scale===4) {
      const trials=[];
      for(const variant of ['baseline','ripple','off','off','ripple','baseline']) {
        const intervals=[];let last=null,start=null;
        drawSpawnRipple=variant==='baseline'?comparisonRipple:variant==='off'?()=>{}:oldRipple;
        await new Promise(resolve=>{
          const present=timestamp=>{
            if(start===null)start=timestamp;
            if(last!==null)intervals.push(timestamp-last);last=timestamp;
            const elapsed=timestamp-start;
            view.powerupPulse={x:320,y:240,remaining:Math.max(0,60-elapsed*.06)};
            view.ball.x=100+(elapsed*.42)%400;view.ball.y=100;
            draw(view);
            if(elapsed<1200)profileRAF(present);else resolve();
          };profileRAF(present);
        });
        trials.push({variant,intervals:stats(intervals),over25ms:intervals.filter(n=>n>25).length});
      }
      presentation={scope:'Actual headless requestAnimationFrame presentation, approximately 60 Hz; no readback during frames',trials};
      drawSpawnRipple=oldRipple;
    }
    let comparisonPng=null;
    if(comparisonRipple&&scale===2) {
      ctx.setTransform(2,0,0,2,0,0);ctx.fillStyle='#080a12';ctx.fillRect(0,0,W,H);
      ctx.textAlign='center';ctx.font='13px monospace';
      for(let i=0;i<3;i++)for(let phase=0;phase<2;phase++){
        const y=100+i*145,x=phase?395:75,color=['#bd7aff','#ffd469','#59baff'][i];
        ctx.fillStyle='#fff';ctx.fillText('Before',x,y-55);ctx.fillText('After',x+150,y-55);
        comparisonRipple({x,y,remaining:phase?30:60},color);oldRipple({x:x+150,y,remaining:phase?30:60},color);
      }comparisonPng=canvas.toDataURL('image/png');
    }
    return {presentation,comparisonPng,placement,scale,canvas:[canvas.width,canvas.height],timings:Object.fromEntries(Object.entries(timings).map(([k,v])=>[k,stats(v)])),initialization,audio:audioResult};
  },{scale,baselineRipple});
  if(errors.length)throw Error(errors.join('\n'));
  if(result.comparisonPng&&out)await writeFile(out.replace(/\.json$/,'.png'),Buffer.from(result.comparisonPng.split(',')[1],'base64'));
  delete result.comparisonPng;results.push(result);console.log(JSON.stringify(result));await page.close();
 }
 if(out)await writeFile(out,JSON.stringify({scope:'Production full-scene canvas, synchronous raster/readback comparison; isolated headless Chromium',results},null,2)+'\n');
}finally{await browser.close();await new Promise(r=>server.close(r));}
