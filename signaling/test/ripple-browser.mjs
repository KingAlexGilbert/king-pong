import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds,root,functionSource} from '../../tests/helpers/game-source.mjs';
const out=process.env.KING_PONG_TEST_ARTIFACTS;
if(out)await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const f=new URL('.'+new URL(req.url,'http://localhost').pathname,root);
 if(!f.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',f.pathname.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(f));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
let runs=0;const results=[],errors=[];
try {
 for(const [platform,file] of Object.entries(builds)) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;Math.random=()=>.5;
    window.addEventListener('blur',e=>e.stopImmediatePropagation(),true);
    Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>'',set:()=>{}});});
  await page.goto(`http://127.0.0.1:${server.address().port}/${file}`);
  for(const scene of ['powerup','serve','score'])for(const hz of [60,120,144,240])for(const irregular of [false,true]) {
    const result=await page.evaluate(({scene,hz,irregular})=>{
      const actualDraw=draw,actualRipple=drawSpawnRipple;
      const originalUpdate=update,originalPaddles=updatePlayerPaddles;
      const run=enabled=>{
        hideTitleScreen();mode=scene==='score'?1:2;lanRole='none';lanConnected=false;onlineSession=null;
        onlineGameBlocked=false;activeCampaign=0;levelIndex=0;matchArenaId=0;matchRuleId='endless';
        cloneHazards();resetPaddles();nextCpuModeServeDirection=-1;royalRallyId=0;royalPickupIndex=0;royalPowerupCueSequence=0;royalGuardHitSequence=0;left.score=right.score=0;
        resetBall(1,false);setMenusVisible(false);saveData.muteAll=true;
        paused=waitingForServe=gameOver=levelCleared=campaignCleared=false;gameWindowFocused=true;
        frame=0;clearRallyLaunchRamp();ball.x=220;ball.y=130;ball.vx=9;ball.vy=3.5;
        ball.lastHit=null;royalRallyTick=scene==='powerup'?179:0;
        if(scene==='serve')beginRallyLaunchRamp();
        drawSpawnRipple=enabled?actualRipple:()=>{};
        // Keep long trajectories on-court using existing paddle collision physics.
        updatePlayerPaddles=()=>{left.y=right.y=clamp(ball.y-PADDLE_H/2,0,H-PADDLE_H);};
        update=()=>{if(scene==='score'&&frame===25)pointForPlayer();originalUpdate();};
        const trace=[];
        draw=view=>{actualDraw(view);trace.push([view.ball.x,view.ball.y,view.epoch,view.key]);};
        renderScale=1;canvas.width=W;canvas.height=H;cachedStaticBackground=null;resetFrameClock();
        loop(0);let t=0,i=0;
        while(t<1200-1e-7){t=Math.min(1200,t+1000/hz*(irregular?[.6,1.5,.8,1.1][i++%4]:1));loop(t);}
        return {trace,frame,ball:[ball.x,ball.y,ball.vx,ball.vy],scores:[left.score,right.score],
          royal:packRoyalState(),remaining:rallyLaunchFramesRemaining};
      };
      const on=run(true),off=run(false);draw=actualDraw;drawSpawnRipple=actualRipple;
      update=originalUpdate;updatePlayerPaddles=originalPaddles;
      // Epoch values are monotonic session counters. Compare transitions relative to the start.
      for(const r of [on,off]){const epoch=r.trace[0][2];for(const sample of r.trace)sample[2]-=epoch;}
      return {on,off};
    },{scene,hz,irregular});
    assert.deepEqual(result.on,result.off,`${platform} ${scene} ${hz} Hz ${irregular}: ripple must not alter motion`);
    assert.equal(result.on.frame,72);
    if(scene==='powerup'){assert.equal(result.on.royal.rally,1);assert.equal(result.on.royal.powerupPulse,null);}
    results.push({platform,scene,hz,irregular,frames:result.on.trace.length,physicsTicks:result.on.frame,ball:result.on.ball});runs+=2;
  }
  console.log(`PASS: ${platform}: powerup/serve/score, fast ball, 60/120/144/240 Hz, regular/irregular, identical ripple-on/off motion`);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 if(out)await writeFile(out+'/render-regressions.json',JSON.stringify({runs,results},null,2)+'\n');
 console.log(`RESULT: ${runs} rendered A/B runs; controlled display timestamps, not physical high-refresh devices.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
