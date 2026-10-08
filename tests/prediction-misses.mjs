import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/royal-harness.mjs';
import { builds, source, functionSource } from './helpers/game-source.mjs';

// The pre-optimization reference deliberately enters the existing collision solvers
// for every hazard. Compare full forecasts, not just the new rejection predicate.
const reference = `function referenceHazardStep(sim, h) {
  const save = {
    x: ball.x, y: ball.y, prevX: ball.prevX, prevY: ball.prevY, vx: ball.vx, vy: ball.vy
  };
  ball.x = sim.x; ball.y = sim.y;
  ball.prevX = sim.prevX; ball.prevY = sim.prevY;
  ball.vx = sim.vx; ball.vy = sim.vy;
  const hit = h.type === 'circle' ? resolveCircleCollision(h, true) : resolveRectCollision(h, true);
  sim.x = ball.x; sim.y = ball.y; sim.vx = ball.vx; sim.vy = ball.vy;
  ball.x = save.x; ball.y = save.y;
  ball.prevX = save.prevX; ball.prevY = save.prevY;
  ball.vx = save.vx; ball.vy = save.vy;
  return hit;
}`;

function cpuHarness(platform) {
  const h = harness(platform), html = source(platform);
  h.run(`
    let customCpuIntel=100, customCpuMaxMove=4.4;
    ${['getCpuConfig', 'predictWithSimpleBounds', 'predictBallCenterForCPU',
      'simulateHazardStep', 'rectsOverlapRaw'].map(name => functionSource(html, name)).join('\n')}
    ${reference}
    const optimizedHazardStep=simulateHazardStep;
  `);
  return h;
}

for (const platform of Object.keys(builds)) {
  test(`${platform}: prediction misses avoid collision helpers and leave the live ball untouched`, () => {
    const h = cpuHarness(platform);
    h.run(`
      let solverCalls=0, writes=0;
      const rectSolver=resolveRectCollision, circleSolver=resolveCircleCollision;
      resolveRectCollision=(...args)=>{solverCalls++;return rectSolver(...args)};
      resolveCircleCollision=(...args)=>{solverCalls++;return circleSolver(...args)};
      const liveBall=ball;
      ball=new Proxy(liveBall,{set(target,key,value){writes++;target[key]=value;return true}});
      const miss={x:100,y:200,prevX:95,prevY:198,vx:5,vy:2};
      const before=JSON.stringify([ball,miss]);
      const results=[simulateHazardStep(miss,{type:'rect',x:400,y:200,w:20,h:50}),
        simulateHazardStep(miss,{type:'circle',x:400,y:200,r:30})];
    `);
    assert.deepEqual(h.json('results'), [false, false]);
    assert.equal(h.run('solverCalls'), 0);
    assert.equal(h.run('writes'), 0);
    assert.equal(h.run('JSON.stringify([ball,miss])'), h.run('before'));
  });

  test(`${platform}: prediction contacts and tangencies match the original solvers exactly`, () => {
    const h = cpuHarness(platform);
    const results = h.json(`(() => {
      const errors=[];
      const obstacles=[{type:'rect',x:300,y:200,w:18,h:72,vy:1.15,bounce:.25},
        {type:'circle',x:320,y:240,r:28,vx:.7,vy:-.3,boost:.35}];
      const offsets=[-1e-9,0,1e-9,-.5,.5,-8,8];
      for(const obstacle of obstacles) for(const offset of offsets)
        for(const axis of ['x','y']) for(const side of [-1,1]) {
          const x=obstacle.type==='rect'?obstacle.x:obstacle.x-BALL_HALF;
          const y=obstacle.type==='rect'?obstacle.y:obstacle.y-BALL_HALF;
          const sim={x,y,prevX:x-9,prevY:y-3,vx:9,vy:3};
          if(axis==='x') sim.x += obstacle.type==='circle'?side*(obstacle.r+BALL_HALF)+offset:
            (side<0?-BALL_SIZE:obstacle.w)+offset;
          else sim.y += obstacle.type==='circle'?side*(obstacle.r+BALL_HALF)+offset:
            (side<0?-BALL_SIZE:obstacle.h)+offset;
          const a={...sim},b={...sim},state=JSON.stringify([ball,obstacle]);
          const oldHit=referenceHazardStep(a,obstacle),newHit=optimizedHazardStep(b,obstacle);
          if(oldHit!==newHit||JSON.stringify(a)!==JSON.stringify(b)||
              state!==JSON.stringify([ball,obstacle])) errors.push({obstacle,sim,a,b,oldHit,newHit});
        }
      return errors;
    })()`);
    assert.deepEqual(results, []);
  });

  test(`${platform}: CPU forecasts, arrivals and Split targets stay identical across every campaign arena`, () => {
    const h = cpuHarness(platform);
    // Exercise the real campaign horizon and maximum custom horizon, moving/circular
    // obstacles, speed-scaled duplicates, Rush and both travel directions.
    const result = h.json(`(() => {
      const errors=[];let comparisons=0;
      for(let arena=0;arena<TOTAL_LEVELS;arena++) for(const gameMode of [1,3]) {
        activeCampaign=Math.floor(arena/6);levelIndex=arena%6;mode=gameMode;matchArenaId=arena;
        hazards=currentLevel().hazards.map((h,id)=>({...h,id,hitFlash:0}));
        const cfg=getCpuConfig();
        for(let i=0;i<80;i++) {
          Object.assign(ball,{x:60+i*71%520,y:10+i*37%450,prevX:80,prevY:30,
            vx:(i%8===0?-1:1)*(2.1+i%7*1.05),vy:(i%9-4)*1.2,rush:i%4===0});
          royalSplitBall=i%2?{...ball,id:99,x:100+i*97%460,vx:ball.vx*.7,vy:-ball.vy*.7}:null;
          royalCpuTarget=ball;
          const before=JSON.stringify([ball,royalSplitBall,hazards]);
          simulateHazardStep=referenceHazardStep;
          const a=royalCpuAim(cfg), expected={center:a.center,frames:a.frames,split:a.target===royalSplitBall};
          royalCpuTarget=ball;simulateHazardStep=optimizedHazardStep;
          const b=royalCpuAim(cfg), actual={center:b.center,frames:b.frames,split:b.target===royalSplitBall};
          if(JSON.stringify(expected)!==JSON.stringify(actual)||before!==JSON.stringify([ball,royalSplitBall,hazards]))
            errors.push({arena,gameMode,i,expected,actual});
          comparisons++;
        }
      }
      return {errors,comparisons};
    })()`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.comparisons, 2880);
  });
}
