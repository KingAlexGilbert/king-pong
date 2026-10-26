import {harness} from './royal-harness.mjs';
import {source,functionSource,constantSource} from './game-source.mjs';
import {readFileSync} from 'node:fs';
export function bossSimulation(platform='Browser', sourceOverride=null) {
 const h=harness(platform),html=sourceOverride || source(platform);
 const constants=['RALLY_PLAYER_SPAWN_DISTANCE','RALLY_PLAYER_SPAWN_MIN_DISTANCE','RALLY_PLAYER_SPAWN_Y_JITTER','BOSS_PLAYER_MAX_HEALTH','BOSS_ENEMY_MAX_HEALTH','BOSS_STARTING_BALLS','BOSS_MAX_BALLS','BOSS_SECOND_BALL_DELAY_FRAMES','BOSS_BALL_COUNT']
  .filter(n=>html.includes('const '+n+' =')).map(n=>constantSource(html,n)).join('\n');
 const functions=['ballSpawnIsUnsafe','ballSpawnInsideVerticalBarrierPocket','findCenterSafeSpawn','rectsOverlapRaw','getCpuConfig','predictWithSimpleBounds','desiredBossBallCount','resetBossBalls','findBossReceiverSideRallySpawn',
  'applyBossSpawnEscapeAngle','beginBossBallLaunchRamp','updateBossBallLaunchRamp','createBossBall','bossBallRect','bossBallSpeed',
  'normalizeBossBallVelocity','reflectBossBallYForBounds','resolveBossRectCollision','resolveBossCircleCollision','resolveBossHazardCollisions',
  'hitBossPaddle','damageBoss','damagePlayer','respawnBossBall','bossThreatBall','predictBossBallCenter','updateBossCPU','updateBossBalls',
  'selectBossAdaptiveProfile','bossDesiredReturnAngle','updateHazards','updateSingleBossBall'].filter(n=>html.includes('function '+n+'('));
 h.run(`
  ${readFileSync(new URL('../../game/boss-tactics.js',import.meta.url),'utf8')}
  ${constants}
  let bossRallyFrames=0,bossPlayerHealth=BOSS_PLAYER_MAX_HEALTH,bossEnemyHealth=BOSS_ENEMY_MAX_HEALTH;
  let bossAdaptiveBallId=null,bossAdaptiveDecisionFrame=-999;
  let customCpuIntel=50,customCpuMaxMove=4.4,bossSeed=1;
  Math.random=()=>{bossSeed=(Math.imul(bossSeed,1664525)+1013904223)>>>0;return bossSeed/4294967296};
  function playPlayerPointJingle(){}function bossVictory(){gameOver=true}function bossDefeat(){gameOver=true}
  ${functions.map(n=>functionSource(html,n)).join('\n')}
  function setupBoss(seed=1){
    bossSeed=seed;frame=bossRallyFrames=0;mode=4;lanRole='none';paused=waitingForServe=gameOver=bossIntroActive=false;
    royalRallyId=0;royalPickupIndex=0;resetRoyalRally();Date.now=()=>1000;
    bossPlayerHealth=BOSS_PLAYER_MAX_HEALTH;bossEnemyHealth=BOSS_ENEMY_MAX_HEALTH;
    left.y=right.y=208;bossAdaptiveProfile=BOSS_ADAPTIVE_PROFILES[0];bossAdaptiveBallId=null;bossAdaptiveDecisionFrame=-999;
    hazards=BOSS_LEVEL.hazards.map((h,id)=>({...h,id,hitFlash:0}));resetBossBalls();
  }
  function simulateBossMatches(count=20,effects=false,player='tracking'){
    let wins=0,frames=0,playerDamage=0,bossDamage=0,timeouts=0,maxBalls=0,maxTemporary=0,shapes=new Set();
    const pickups={split:0,rush:0,guard:0},returns={boss:0,player:0},shapeReturns={};
    const originalHit=hitBossPaddle,originalAward=awardRoyalPowerup;
    hitBossPaddle=(b,p,d)=>{originalHit(b,p,d);returns[p===right?'boss':'player']++;
      if(p===right)shapeReturns[bossAdaptiveProfile.name]=(shapeReturns[bossAdaptiveProfile.name]||0)+1;};
    awardRoyalPowerup=(type,target)=>{const applied=originalAward(type,target);if(applied)pickups[type]++;return applied;};
    try {
    for(let sample=0;sample<count;sample++){
      setupBoss(1009+sample*997);
      royalPickupIndex=sample%3;
      for(let i=0;i<24000&&!gameOver;i++){
        frame++;let target=null,soon=Infinity;
        for(const b of [...bossBalls,...(royalSplitBall?[royalSplitBall]:[])])if(b.vx<0&&(b.x-left.x)/-b.vx<soon){target=b;soon=(b.x-left.x)/-b.vx}
        if(target){
          let center=target.y+BALL_HALF;
          if(player==='anticipating')center=predictWithSimpleBounds(W-target.x-BALL_SIZE,target.y,-target.vx,target.vy,W-left.x-PADDLE_W);
          left.y=clamp(left.y+clamp((center-PADDLE_H/2-left.y)*.1,-4,4),0,H-PADDLE_H);
        }
        updateHazards();if(effects)updateRoyalPowerups();updateBossCPU();updateBossBalls();frames++;
        maxBalls=Math.max(maxBalls,bossBalls.length);shapes.add(bossAdaptiveProfile.name);
        maxTemporary=Math.max(maxTemporary,royalSplitBall?1:0);
      }
      if(!gameOver)timeouts++;if(bossEnemyHealth===0)wins++;
      playerDamage+=BOSS_PLAYER_MAX_HEALTH-bossPlayerHealth;bossDamage+=BOSS_ENEMY_MAX_HEALTH-bossEnemyHealth;
    }
    } finally {hitBossPaddle=originalHit;awardRoyalPowerup=originalAward;}
    return {matches:count,wins,bossVictories:count-wins-timeouts,timeouts,frames,meanSeconds:frames/count/60,
      playerDamage,bossDamage,maxBalls,maxTemporary,returns,pickups,shapeReturns,shapes:[...shapes].sort()};
  }
  function simulateBossDefenceCase(spec, reference=false){
    setupBoss(1009);hazards=[];right.y=spec.paddle;
    bossBalls=[{id:1,x:spec.x,y:spec.y-BALL_HALF,prevX:spec.x,prevY:spec.y-BALL_HALF,vx:6,vy:spec.vy}];
    const originalHit=hitBossPaddle,originalSelect=selectBossAdaptiveProfile;
    let returned=false,maxMove=0;
    hitBossPaddle=(b,p,d)=>{
      if(p===right){
        if(!paddleIntersectsBall(b,p,d,activePaddleProfile(p)))throw Error('Invalid interception');
        returned=true;
      }originalHit(b,p,d);
    };
    if(reference)selectBossAdaptiveProfile=()=>bossAdaptiveProfile=BOSS_ADAPTIVE_PROFILES[0];
    try {
      for(let tick=0;tick<180&&!returned&&bossEnemyHealth===BOSS_ENEMY_MAX_HEALTH;tick++){
        frame++;const previousY=right.y;
        if(reference){
          const b=bossBalls[0],cfg=getCpuConfig();
          const target=clamp(predictWithSimpleBounds(b.x,b.y,b.vx,b.vy,right.x-BALL_HALF)-PADDLE_H/2,0,H-PADDLE_H);
          const delta=target-right.y;if(Math.abs(delta)>cfg.deadZone)right.y+=clamp(delta*cfg.reaction,-cfg.maxMove,cfg.maxMove);
        }else updateBossCPU();
        maxMove=Math.max(maxMove,Math.abs(previousY-right.y));updateBossBalls();
      }
      return {returned,missed:bossEnemyHealth<BOSS_ENEMY_MAX_HEALTH,shape:bossAdaptiveProfile.name,maxMove};
    }finally{hitBossPaddle=originalHit;selectBossAdaptiveProfile=originalSelect;}
  }
  function simulateBossDefence(){
    let cases=0,returns=0,misses=0,reachable=0,avoidableMisses=0,maxMove=0;const shapes={};
    for(const paddle of [70,208,346])for(const x of [450,540,580])for(const y of [16,90,170,240,310,390,456])for(const vy of [-4,0,4]){
      const spec={paddle,x,y,vy},reference=simulateBossDefenceCase(spec,true),result=simulateBossDefenceCase(spec);
      cases++;if(reference.returned)reachable++;if(result.returned)returns++;if(result.missed)misses++;
      if(reference.returned&&result.missed)avoidableMisses++;maxMove=Math.max(maxMove,result.maxMove);
      const shape=shapes[result.shape]||(shapes[result.shape]={returns:0,misses:0});
      if(result.returned)shape.returns++;if(result.missed)shape.misses++;
    }
    return {cases,returns,misses,reachable,avoidableMisses,maxMove,shapes};
  }
  function simulateBossConflicts(){
    let cases=0,threats=0,returns=0,misses=0,lostBallReturns=0,maxMove=0;
    const shapes={};
    for(const center of [110,200,290,380])for(const lostY of [10,470])for(const x of [516,540,564])for(const extra of ['none','permanent','split']){
      setupBoss(1009);hazards=[];right.y=center-PADDLE_H/2;
      bossBalls=[{id:1,x:590,y:lostY-BALL_HALF,vx:8,vy:0},{id:2,x,y:center-BALL_HALF,vx:6,vy:0}];
      const third={id:3,x:x-12,y:center+24-BALL_HALF,vx:6,vy:0};
      if(extra==='permanent')bossBalls.push(third);
      if(extra==='split')royalSplitBall={...third,id:'royal-split',vx:4.2};
      const initial=[...bossBalls,...(royalSplitBall?[royalSplitBall]:[])],done=new Set(),originalHit=hitBossPaddle;
      cases++;threats+=initial.length-1;
      hitBossPaddle=(b,p,d)=>{
        if(p===right&&initial.includes(b)&&!done.has(b)){
          if(!paddleIntersectsBall(b,p,d,activePaddleProfile(p)))throw Error('Invalid interception');
          done.add(b);if(b===initial[0])lostBallReturns++;else returns++;
          shapes[bossAdaptiveProfile.name]=(shapes[bossAdaptiveProfile.name]||0)+1;
        }originalHit(b,p,d);
      };
      try {
        for(let tick=0;tick<120&&done.size<initial.length;tick++){
          frame++;const previousY=right.y;updateBossCPU();
          maxMove=Math.max(maxMove,Math.abs(previousY-right.y));updateBossBalls();
          for(const b of initial)if(!done.has(b)&&!bossBalls.includes(b)&&royalSplitBall!==b){
            done.add(b);if(b!==initial[0])misses++;
          }
        }
      }finally{hitBossPaddle=originalHit;}
    }
    return {cases,reachableThreats:threats,returns,misses,lostBallReturns,maxMove,shapes};
  }
 `);
 return h;
}
