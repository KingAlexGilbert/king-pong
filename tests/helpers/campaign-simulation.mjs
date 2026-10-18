import {harness} from './royal-harness.mjs';
import {source, functionSource} from './game-source.mjs';

// Production movement, spawn, collision, bounce and scoring. Only presentation
// and save writes are stubbed. Seeded players are measurement fixtures, not AI.
export function campaignSimulation(platform = 'Browser', configSource) {
  const h = harness(platform), html = source(platform);
  const functions = ['getCpuConfig','chooseCpuError','predictWithSimpleBounds','predictBallCenterForCPU',
    'simulateHazardStep','rectsOverlapRaw','updateCPU','ballSpawnInsideVerticalBarrierPocket','ballSpawnIsUnsafe',
    'findCenterSafeSpawn','findReceiverSideRallySpawn','applySpawnEscapeAngle','setRallyBallVelocity',
    'beginRallyLaunchRamp','resetBall'];
  h.run(`
    let cpuErrorOffset=0, customCpuIntel=50, customCpuMaxMove=4.4;
    const RALLY_PLAYER_SPAWN_DISTANCE=236,RALLY_PLAYER_SPAWN_MIN_DISTANCE=180,RALLY_PLAYER_SPAWN_Y_JITTER=32;
    function markCampaignLevelCompleted(){} function triggerBossUnlockSequence(){}
    ${functions.map(n=>n==='getCpuConfig'&&configSource?configSource:functionSource(html,n)).join('\n')}
    const measuredCpuConfig=getCpuConfig;
    let configOverride={};
    getCpuConfig=()=>({...measuredCpuConfig(),...configOverride});
    let simulationSeed=1;
    Math.random=()=>{simulationSeed=(Math.imul(simulationSeed,1664525)+1013904223)>>>0;return simulationSeed/4294967296;};
    let cpuReturns=0,playerReturns=0,rallyReturns=0,longestRally=0;
    const measuredHit=hitPaddle;
    hitPaddle=(p,d)=>{if(d<0)cpuReturns++;else playerReturns++;rallyReturns++;longestRally=Math.max(longestRally,rallyReturns);measuredHit(p,d);};
    const measuredReset=resetBall;
    resetBall=(...args)=>{rallyReturns=0;return measuredReset(...args);};
    function simulateMatches(level,count,player,override={}) {
      configOverride=override;let wins=0,trivial=0,returns=0,misses=0,longRallies=0,frames=0,timeouts=0;
      for(let i=0;i<count;i++){
        simulationSeed=1009+i*997;frame=0;mode=1;activeCampaign=0;levelIndex=level-1;
        paused=waitingForServe=gameOver=levelCleared=campaignCleared=false;
        left.y=right.y=208;left.score=right.score=0;nextCpuModeServeDirection=-1;
        hazards=currentLevel().hazards.map((h,id)=>({...h,id,hitFlash:0}));
        cpuReturns=playerReturns=rallyReturns=longestRally=0;resetBall(1,false);
        // A passive paddle tests easy wins without participation. A modest
        // ball-following paddle measures beginner difficulty, without prediction.
        for(let tick=0;tick<24000&&!gameOver&&!levelCleared;tick++){
          frame++;
          if(player==='tracking'&&ball.vx<0){const target=ball.y+BALL_HALF-PADDLE_H/2;
            left.y=clamp(left.y+clamp((target-left.y)*.1,-4,4),0,H-PADDLE_H);}
          updateCPU();updateBall();frames++;
        }
        if(!gameOver&&!levelCleared)timeouts++;
        if(levelCleared){wins++;if(playerReturns<=1)trivial++;}
        returns+=cpuReturns;misses+=left.score;if(longestRally>=4)longRallies++;
      }
      return {level,player,matches:count,wins,trivialWins:trivial,cpuReturns:returns,cpuMisses:misses,
        returnRate:returns/(returns+misses),shortRallyMatches:longRallies,meanSeconds:frames/count/60,timeouts};
    }
    function simulateShots(level,override={}) {
      configOverride=override;mode=1;activeCampaign=0;levelIndex=level-1;
      let returns=0,misses=0,deflected=0;
      for(const y of [40,120,240,360,440])for(const angle of [-.9,-.6,-.3,0,.3,.6,.9])
        for(const speed of [4.2,6,8])for(let sample=0;sample<12;sample++){
          simulationSeed=sample*997+1009;frame=0;waitingForServe=gameOver=levelCleared=campaignCleared=false;
          left.y=right.y=208;resetRoyalRally();resetHazardTrapGuard();clearRallyLaunchRamp();
          hazards=currentLevel().hazards.map((h,id)=>({...h,id,hitFlash:0}));
          Object.assign(ball,{x:60,y:y-BALL_HALF,prevX:60,prevY:y-BALL_HALF,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed});
          chooseCpuError();cpuReturns=0;
          for(let tick=0;tick<500;tick++){
            frame++;updateCPU();const scored=updateSingleBall();
            if(cpuReturns){returns++;break;}if(scored===1){misses++;break;}
            if(ball.vx<0&&ball.x<100){deflected++;break;}
          }
        }
      return {level,returns,misses,deflected,returnRate:returns/(returns+misses)};
    }
  `);
  return h;
}
