import {harness} from './royal-harness.mjs';
import {source,functionSource,constantSource} from './game-source.mjs';
export function bossSimulation(platform='Browser', sourceOverride=null) {
 const h=harness(platform),html=sourceOverride || source(platform);
 const constants=['RALLY_PLAYER_SPAWN_DISTANCE','RALLY_PLAYER_SPAWN_MIN_DISTANCE','RALLY_PLAYER_SPAWN_Y_JITTER','BOSS_PLAYER_MAX_HEALTH','BOSS_ENEMY_MAX_HEALTH','BOSS_STARTING_BALLS','BOSS_MAX_BALLS','BOSS_SECOND_BALL_DELAY_FRAMES','BOSS_BALL_COUNT']
  .filter(n=>html.includes('const '+n+' =')).map(n=>constantSource(html,n)).join('\n');
 const functions=['ballSpawnIsUnsafe','ballSpawnInsideVerticalBarrierPocket','findCenterSafeSpawn','rectsOverlapRaw','getCpuConfig','predictWithSimpleBounds','desiredBossBallCount','resetBossBalls','findBossReceiverSideRallySpawn',
  'applyBossSpawnEscapeAngle','beginBossBallLaunchRamp','updateBossBallLaunchRamp','createBossBall','bossBallRect','bossBallSpeed',
  'normalizeBossBallVelocity','reflectBossBallYForBounds','resolveBossRectCollision','resolveBossCircleCollision','resolveBossHazardCollisions',
  'hitBossPaddle','damageBoss','damagePlayer','respawnBossBall','bossThreatBall','predictBossBallCenter','updateBossCPU','updateBossBalls',
  'selectBossAdaptiveProfile','bossDesiredReturnAngle','updateHazards'];
 h.run(`
  ${constants}
  let bossRallyFrames=0,bossPlayerHealth=BOSS_PLAYER_MAX_HEALTH,bossEnemyHealth=BOSS_ENEMY_MAX_HEALTH;
  let bossAdaptiveBallId=null,bossAdaptiveDecisionFrame=-999;
  let customCpuIntel=50,customCpuMaxMove=4.4,bossSeed=1;
  Math.random=()=>{bossSeed=(Math.imul(bossSeed,1664525)+1013904223)>>>0;return bossSeed/4294967296};
  function playPlayerPointJingle(){}function bossVictory(){gameOver=true}function bossDefeat(){gameOver=true}
  ${functions.map(n=>functionSource(html,n)).join('\n')}
  function setupBoss(seed=1){
    bossSeed=seed;frame=bossRallyFrames=0;mode=4;lanRole='none';paused=waitingForServe=gameOver=bossIntroActive=false;
    bossPlayerHealth=BOSS_PLAYER_MAX_HEALTH;bossEnemyHealth=BOSS_ENEMY_MAX_HEALTH;
    left.y=right.y=208;bossAdaptiveProfile=BOSS_ADAPTIVE_PROFILES[0];bossAdaptiveBallId=null;bossAdaptiveDecisionFrame=-999;
    hazards=BOSS_LEVEL.hazards.map((h,id)=>({...h,id,hitFlash:0}));resetBossBalls();
  }
  function simulateBossMatches(count=20){
    let wins=0,frames=0,playerDamage=0,bossDamage=0,timeouts=0,maxBalls=0,shapes=new Set();
    for(let sample=0;sample<count;sample++){
      setupBoss(1009+sample*997);
      for(let i=0;i<24000&&!gameOver;i++){
        frame++;let target=null,soon=Infinity;
        for(const b of bossBalls)if(b.vx<0&&(b.x-left.x)/-b.vx<soon){target=b;soon=(b.x-left.x)/-b.vx}
        if(target)left.y=clamp(left.y+clamp((target.y+BALL_HALF-PADDLE_H/2-left.y)*.1,-4,4),0,H-PADDLE_H);
        updateHazards();updateBossCPU();updateBossBalls();frames++;
        maxBalls=Math.max(maxBalls,bossBalls.length);shapes.add(bossAdaptiveProfile.name);
      }
      if(!gameOver)timeouts++;if(bossEnemyHealth===0)wins++;
      playerDamage+=BOSS_PLAYER_MAX_HEALTH-bossPlayerHealth;bossDamage+=BOSS_ENEMY_MAX_HEALTH-bossEnemyHealth;
    }
    return {matches:count,wins,timeouts,frames,meanSeconds:frames/count/60,playerDamage,bossDamage,maxBalls,shapes:[...shapes].sort()};
  }
 `);
 return h;
}
