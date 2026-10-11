// Controlled test-only curves rendered by the production game canvas.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {root} from '../../tests/helpers/game-source.mjs';
const out=process.env.KING_PONG_TEST_ARTIFACTS;
if(!out) throw new Error('Set KING_PONG_TEST_ARTIFACTS to the comparison output directory.');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  try{const f=new URL('.'+new URL(req.url,'http://localhost').pathname,root);if(!f.href.startsWith(root.href))throw new Error();
    res.setHeader('Content-Type',f.pathname.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(f));}
  catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
const variants=[{id:'baseline',start:.2,ticks:60,smooth:true},{id:'a',start:.4,ticks:24,smooth:false},{id:'b',start:.5,ticks:18,smooth:true}];
const results=[];
try{
  for(const trajectory of ['horizontal','vertical','diagonal'])for(const variant of variants){
    const p=await browser.newPage({viewport:{width:1280,height:900}});
    await p.addInitScript(()=>{window.requestAnimationFrame=()=>1;Math.random=()=>.5;
      Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>'',set:()=>{}});});
    await p.goto(`http://127.0.0.1:${server.address().port}/docs/demo/index.html`);
    await p.evaluate(({trajectory,variant})=>{
      hideTitleScreen();mode=2;lanRole='none';lanConnected=false;activeCampaign=0;levelIndex=0;matchArenaId=0;
      cloneHazards();resetPaddles();resetBall(1,false);saveData.muteAll=true;
      paused=waitingForServe=gameOver=levelCleared=campaignCleared=menusVisible=false;gameWindowFocused=true;
      Object.assign(ball,{x:100,y:100,vx:trajectory==='vertical'?0:trajectory==='diagonal'?4.4/Math.SQRT2:4.4,
        vy:trajectory==='horizontal'?0:trajectory==='diagonal'?4.4/Math.SQRT2:4.4});
      rallyLaunchTargetSpeed=Math.hypot(ball.vx,ball.vy);rallyLaunchFramesRemaining=60;
      rallySpawnPulseX=ball.x+BALL_HALF;rallySpawnPulseY=ball.y+BALL_HALF;
      ball.vx*=variant.start;ball.vy*=variant.start;
      updateRallyLaunchRamp=()=>{
        if(rallyLaunchFramesRemaining<=0)return;
        const elapsed=60-rallyLaunchFramesRemaining+1;
        const t=Math.min(1,elapsed/variant.ticks),factor=variant.smooth?t*t*(3-2*t):t;
        if(elapsed<=variant.ticks){const desired=rallyLaunchTargetSpeed*(variant.start+(1-variant.start)*factor);
          const current=Math.hypot(ball.vx,ball.vy);ball.vx*=desired/current;ball.vy*=desired/current;}
        if(--rallyLaunchFramesRemaining<=0)clearRallyLaunchRamp();
      };
      resetFrameClock();syncRoyalUi(true);renderScale=1;canvas.width=W;canvas.height=H;
      ctx.setTransform(1,0,0,1,0,0);cachedStaticBackground=null;
      const actualDraw=draw;window.views=[];
      draw=view=>{actualDraw(view);window.views.push({x:view.ball.x,y:view.ball.y});};
    },{trajectory,variant});
    const directory=out+'/'+trajectory+'-'+variant.id;await mkdir(directory,{recursive:true});
    const tape=[];
    for(let i=0;i<=120;i++){
      const frame=await p.evaluate(i=>{loop(i*1000/60);return {png:canvas.toDataURL('image/png'),x:ball.x,y:ball.y,
        vx:ball.vx,vy:ball.vy,speed:Math.hypot(ball.vx,ball.vy),view:window.views.at(-1),remaining:rallyLaunchFramesRemaining};},i);
      await writeFile(directory+'/'+String(i).padStart(3,'0')+'.png',Buffer.from(frame.png.split(',')[1],'base64'));
      delete frame.png;tape.push(frame);
    }
    results.push({trajectory,...variant,tape});
    await p.close();console.log('RENDERED: '+trajectory+' '+variant.id);
  }
  const probe=await browser.newPage();await probe.addInitScript(()=>{window.requestAnimationFrame=()=>1;Math.random=()=>.5;});
  await probe.goto(`http://127.0.0.1:${server.address().port}/docs/demo/index.html`);
  const collisions=await probe.evaluate(()=>{
    mode=2;lanRole='none';lanConnected=false;activeCampaign=0;levelIndex=0;matchArenaId=0;cloneHazards();resetPaddles();
    paused=waitingForServe=gameOver=levelCleared=campaignCleared=false;saveData.muteAll=true;
    resetRoyalRally();Object.assign(ball,{x:left.x+PADDLE_W+.1,y:left.y+PADDLE_H/2-BALL_HALF,vx:-4.4,vy:0});
    beginRallyLaunchRamp();updateSingleBall();const atHit={vx:ball.vx,vy:ball.vy,speed:ballSpeed(),remaining:rallyLaunchFramesRemaining};
    updateSingleBall();return {atHit,next:{vx:ball.vx,vy:ball.vy,speed:ballSpeed(),remaining:rallyLaunchFramesRemaining},
      levels:CAMPAIGNS.flatMap(c=>c.levels.map(l=>({name:l.name,speed:l.ballSpeed,max:l.maxSpeed}))),
      spawnDistance:RALLY_PLAYER_SPAWN_DISTANCE,minSpawnDistance:RALLY_PLAYER_SPAWN_MIN_DISTANCE};
  });
  await writeFile(out+'/comparison.json',JSON.stringify({results,collisions},null,2));
  console.log('COLLISION PROBE: '+JSON.stringify(collisions));
}finally{await browser.close();await new Promise(r=>server.close(r));}
