import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignSimulation} from './helpers/campaign-simulation.mjs';
import {bossSimulation} from './helpers/boss-simulation.mjs';
import {builds} from './helpers/game-source.mjs';

function tactics() {
 const h=campaignSimulation();h.run(`mode=3;customCpuIntel=100;customCpuMaxMove=4.4;waitingForServe=false;
   left.y=10;right.y=208;hazards=[];royalGuards={left:0,right:0};royalSplitBall=null;
   Object.assign(ball,{x:400,y:236,vx:5,vy:0});
   const aim={target:ball,center:240,frames:40};`);return h;
}
test('Custom intelligence changes tactical choices independently of speed and campaign restrictions',()=>{
 const h=tactics();
 const rows=h.json(`(()=>{
  const rows=[];
  for(const intelligence of [1,20,50,80,100]){
   customCpuIntel=intelligence;let choices=0,pickups=0;
   for(let sample=0;sample<300;sample++){
    left.y=sample%2?10:400;royalPickup={type:['split','rush','guard'][sample%3],x:320,y:100+sample%9*35,ttl:480};
    const choice=planCpuContact(getCpuConfig(),aim,240,sample);
    if(choice.offset)choices++;if(choice.offset&&choice.pickup)pickups++;
   }
   rows.push({choices,pickups});
  }return rows;
 })()`);
 for(let i=1;i<rows.length;i++)assert.ok(rows[i].choices>rows[i-1].choices);
 assert.ok(rows[4].choices<300&&rows[4].pickups>0,'maximum still overlooks opportunities, but can collect deliberately');
 for(const speed of [1,4.4,20]){
  h.run(`customCpuIntel=100;customCpuMaxMove=${speed};activeCampaign=0;levelIndex=0;`);
  assert.equal(h.run('cpuTacticalIntelligence(getCpuConfig())'),1);
 }
 h.run('mode=1;left.score=right.score=0');
 const first=h.run('cpuTacticalIntelligence(getCpuConfig())');
 h.run('activeCampaign=2;levelIndex=5');assert.ok(h.run('cpuTacticalIntelligence(getCpuConfig())')>first);
 h.run('right.score=3');assert.ok(h.run('cpuTacticalIntelligence(getCpuConfig())')<0.5,'existing score assist constrains new tactics too');
});
test('powerup value reflects the actual Split, Rush, Guard and expiration mechanics',()=>{
 const h=tactics();h.run("royalPickup={type:'guard',x:320,y:240,ttl:480};const cfg=getCpuConfig();");
 assert.ok(h.run("cpuPickupValue('guard',aim,cfg,1,5,.7,0,40)")>0);
 h.run('royalGuards.right=500');assert.equal(h.run("cpuPickupValue('guard',aim,cfg,1,5,.7,0,40)"),0);
 h.run('royalPickup.ttl=50');assert.equal(h.run("cpuPickupValue('split',aim,cfg,1,5,.7,0,40)"),0);
 h.run('royalPickup.ttl=480;royalSplitBall={...ball}');assert.equal(h.run("cpuPickupValue('split',aim,cfg,1,5,.7,0,40)"),0);
 h.run('royalSplitBall=null');assert.ok(h.run("cpuPickupValue('split',aim,cfg,1,5,.7,0,40)")>0);
 assert.equal(h.run("cpuPickupValue('rush',aim,{...cfg,maxMove:1},1,12,.1,1,40)"),0);
 assert.ok(h.run("cpuPickupValue('rush',aim,cfg,1,4,.9,0,40)")>0);
 const collected=h.run(`(()=>{let hits=0;
  for(let sample=0;sample<100;sample++){
   royalGuards={left:0,right:0};royalPickup={type:'guard',x:320,y:100+sample%9*35,ttl:480};
   right.y=208;Object.assign(ball,{x:592,y:236,prevX:590,prevY:236,vx:5,vy:0,lastHit:'left'});
   const choice=planCpuContact(cfg,aim,240,sample);if(!choice.offset||!choice.pickup)continue;
   right.y=208+choice.offset;hitPaddle(right,-1);
   for(let tick=0;tick<100&&royalPickup;tick++)updateSingleBall();
   if(royalGuards.right>0)hits++;
  }return hits;})()`);
 assert.ok(collected>0,'deliberate contact positions collect Guard through the actual paddle and ball physics');
});
test('short-match risk, expiring shields, hazards and legal wall rebounds affect contact evaluation',()=>{
 const h=tactics();h.run('const cfg=getCpuConfig();');
 const risks=h.json(`[[4,1],[4,4],[1,4]].map(([cpu,human])=>{right.score=cpu;left.score=human;return cpuMatchRisk(1,40)})`);
 assert.ok(risks[0]<risks[2]&&risks[1]<risks[2]);
 h.run('left.score=right.score=0;royalGuards.right=600');const protectedRisk=h.run('cpuMatchRisk(1,40)');
 h.run('royalGuards.right=20');assert.ok(h.run('cpuMatchRisk(1,40)')<protectedRisk);
 h.run('royalGuards.left=600');assert.equal(h.run('evaluateCpuContact(cfg,aim,240,0,1,.4).guarded'),true);
 h.run('royalGuards.left=30');assert.equal(h.run('evaluateCpuContact(cfg,aim,240,0,1,.4).guarded'),false);
 const shieldChoices=h.json(`[0,30,600].map(shield=>{royalGuards.left=shield;let offensive=0;
  for(let sample=0;sample<100;sample++)if(planCpuContact(cfg,aim,240,sample).offset)offensive++;
  return offensive;})`);
 assert.ok(shieldChoices[2]<shieldChoices[0],'a lasting human shield suppresses ineffective offensive angles');
 assert.equal(shieldChoices[1],shieldChoices[0],'normal attacks resume when the shield will expire before arrival');
 h.run("hazards=[{type:'rect',x:300,y:200,w:20,h:80,vy:.5}]");
 assert.ok(h.run('cpuShotHazardRisk(240,0,5)')>0);assert.equal(h.run('cpuShotHazardRisk(90,0,5)'),0);
 h.run('hazards=[]');const shot=h.json('evaluateCpuContact(cfg,aim,240,-20,1,.7)');
 assert.equal(shot.rebound,true);assert.ok(Math.abs(shot.angle)<=1.16);
 assert.ok(h.run('cpuShotHeight(240,.9,560)')>=4&&h.run('cpuShotHeight(240,.9,560)')<=476);
});
test('multiple-ball decisions prefer a reachable threat without raising movement or reaction limits',()=>{
 const h=tactics();
 const counts=h.json(`(()=>{let low=0,high=0;
 const lost={target:ball,center:0,frames:1},safe={target:{...ball},center:240,frames:3};
 for(let i=0;i<40;i++){royalRallyId=i;customCpuIntel=1;
  if(chooseCpuTacticalThreat(getCpuConfig(),lost,safe,lost)===safe)low++;
  customCpuIntel=100;if(chooseCpuTacticalThreat(getCpuConfig(),lost,safe,lost)===safe)high++;
 }return {low,high};})()`);
 assert.equal(counts.low,0);assert.ok(counts.high>0&&counts.high<40);
 h.run('customCpuMaxMove=1;right.y=400;cpuErrorOffset=0;frame=0;');
 for(let i=0;i<60;i++){
  const before=h.run('right.y');h.run('frame++;updateCPU()');
  assert.ok(Math.abs(h.run('right.y')-before)<=1+1e-9);assert.ok(h.run('right.y')>=0&&h.run('right.y')<=416);
 }
});
test('hypothetical aiming preserves physics RNG and ball state; plans have a bounded evaluation cadence',()=>{
 const h=tactics();h.run(`const saved=JSON.stringify(ball);const rng=simulationSeed;
  planCpuContact(getCpuConfig(),aim,240,17);`);
 assert.equal(h.run('JSON.stringify(ball)'),h.run('saved'));assert.equal(h.run('simulationSeed'),h.run('rng'));
 h.run(`let plans=0;const originalPlan=planCpuContact;planCpuContact=(...args)=>{plans++;return originalPlan(...args)};
 resetCpuTactics();for(frame=0;frame<120;frame++)cpuTacticalTarget(getCpuConfig(),aim,240);`);
 assert.equal(h.run('plans'),10);
 h.run('mode=4');assert.equal(h.run('cpuTacticalTarget(getCpuConfig(),aim,240)'),240);
});

test('every platform restores staged permanent Wall balls, scoring, resets and legal adaptive geometry',()=>{
 for(const platform of Object.keys(builds)){
  const h=bossSimulation(platform);h.run('setupBoss(1009)');
  assert.equal(h.run('bossBalls.length'),1);assert.ok(h.run('bossBalls[0].vx')<0);
  for(const [frames,health,count] of [[0,10,1],[599,4,1],[600,4,2],[600,3,3],[0,3,3],[3000,1,3]]){
   h.run(`bossRallyFrames=${frames};bossEnemyHealth=${health}`);assert.equal(h.run('desiredBossBallCount()'),count);
  }
  h.run('setupBoss(1009);bossRallyFrames=598;updateBossBalls()');assert.equal(h.run('bossBalls.length'),1);
  h.run('updateBossBalls();const initialIds=bossBalls.map(b=>b.id)');assert.equal(h.run('bossBalls.length'),2);
  assert.ok(h.run('bossBalls[1].vx')>0,'timed addition preserves its original boss-directed spawn');
  h.run('bossEnemyHealth=3;updateBossBalls();const oldIds=bossBalls.map(b=>b.id)');assert.equal(h.run('bossBalls.length'),3);
  assert.deepEqual(h.json('bossBalls.slice(0,2).map(b=>b.id)'),h.json('initialIds'));
  h.run('royalSplitBall={...ball};resetRoyalRally();');
  assert.deepEqual(h.json('bossBalls.map(b=>b.id)'),h.json('oldIds'),'Royal Split reset cannot remove permanent balls');
  h.run('bossBalls[0].x=W+10;bossBalls[0].vx=4;updateBossBalls();');
  assert.equal(h.run('bossEnemyHealth'),2);assert.equal(h.run('bossBalls.length'),3);
  assert.notEqual(h.run('bossBalls[0].id'),h.run('oldIds[0]'));assert.equal(h.run('bossBalls[1].id'),h.run('oldIds[1]'));
  h.run('bossBalls[0].x=-30;bossBalls[0].vx=-4;updateBossBalls();');assert.equal(h.run('bossPlayerHealth'),12);
  assert.ok(h.run('bossBalls[0].vx')>0,'original receiver-side respawn direction is preserved');
  h.run('setupBoss(1009);bossEnemyHealth=3;updateBossBalls()');assert.equal(h.run('bossBalls.length'),3,'early threshold fills both missing slots');
  h.run('for(let i=0;i<10;i++)updateBossBalls()');assert.equal(h.run('bossBalls.length'),3);
  for(let shape=0;shape<9;shape++){
   h.run(`bossAdaptiveProfile=BOSS_ADAPTIVE_PROFILES[${shape}];right.y=208;
    Object.assign(bossBalls[0],{y:236,vx:5,vy:0});
    bossBalls[0].x=paddleSurfaceX(right,-1,bossAdaptiveProfile,240)-BALL_SIZE+.1;
    bossBalls[0].prevX=bossBalls[0].x-5;`);
   assert.equal(h.run('paddleIntersectsBall(bossBalls[0],right,-1,bossAdaptiveProfile)'),true);
   h.run('hitBossPaddle(bossBalls[0],right,-1)');assert.ok(h.run('bossBalls[0].vx')<0);
   h.run('bossBalls[0].y=right.y-PADDLE_H');
   assert.equal(h.run('paddleIntersectsBall(bossBalls[0],right,-1,bossAdaptiveProfile)'),false);
  }
  h.run('setupBoss(1009);right.y=400;const yBefore=right.y;updateBossCPU();');
  assert.ok(Math.abs(h.run('right.y-yBefore'))<=h.run('getCpuConfig().maxMove'));
  assert.equal(h.run('bossBalls.length'),1);assert.equal(h.run('bossRallyFrames'),0);
 }
});

test('boss powerups reuse pickup timing, ownership, Rush, Guard and independent temporary Split lifetime',()=>{
 for(const platform of Object.keys(builds)){
  const h=bossSimulation(platform);h.run('setupBoss(1009)');
  for(let stage=1;stage<=3;stage++) for(const type of ['split','rush','guard']) {
   h.run(`setupBoss(1009);bossRallyFrames=${stage===1?0:600};bossEnemyHealth=${stage===3?3:10};updateBossBalls();
    royalPickupIndex=ROYAL_TYPES.indexOf('${type}');royalRallyTick=179;updateRoyalPowerups();`);
   assert.equal(h.run('royalPickup?.type'),type,'safe spawn for '+type+' in stage '+stage);
   assert.equal(h.run('royalPickup.ttl'),480);
   h.run(`const target${stage}${type}=bossBalls[0];Object.assign(bossBalls[0],{x:royalPickup.x-4,y:royalPickup.y-4,
    prevX:royalPickup.x-4,prevY:royalPickup.y-4,lastHit:'left',vx:4,vy:1,rallyLaunchFramesRemaining:0});
    collectRoyalPickup(bossBalls[0]);`);
   assert.equal(h.run('royalPickup'),null);assert.equal(h.run('bossBalls.length'),stage);
   assert.equal(h.run('royalPowerupCues.at(-1).kind'),'pickup');
   if(type==='split') {
    assert.equal(h.run('royalSplitBall.id'),'royal-split');
    assert.ok(Math.abs(h.run('bossBallSpeed(royalSplitBall)/bossBallSpeed(bossBalls[0])')-.7)<1e-12);
    h.run("var splitBefore=royalSplitBall;awardRoyalPowerup('split',bossBalls[0]);");
    assert.equal(h.run('royalSplitBall===splitBefore'),true,'one temporary slot');
    h.run('hitBossPaddle(royalSplitBall,left,1)');assert.equal(h.run('royalSplitBall'),null);
    assert.equal(h.run('bossBalls.length'),stage);
   }
   if(type==='rush') {
    assert.ok(Math.abs(h.run('bossBalls[0].vx')-5.2)<1e-12);
    h.run('normalizeBossBallVelocity(bossBalls[0]);');assert.equal(h.run('bossBalls[0].rush'),true);
    h.run('hitBossPaddle(bossBalls[0],left,1)');assert.equal(h.run('bossBalls[0].rush'),false);
   }
   if(type==='guard') {
    assert.equal(h.run('royalGuards.left'),600);
    h.run('Object.assign(bossBalls[0],{x:16,prevX:20,vx:-5});collideCastleGuard(bossBalls[0]);');
    assert.ok(h.run('bossBalls[0].vx')>0);assert.equal(h.run('bossPlayerHealth'),13);
    h.run('paused=true;updateRoyalPowerups()');assert.equal(h.run('royalGuards.left'),600);
    h.run('paused=false;for(let i=0;i<600;i++)updateRoyalPowerups()');assert.equal(h.run('royalGuards.left'),0);
   }
  }
  h.run("setupBoss();bossEnemyHealth=3;updateBossBalls();const ids=bossBalls.map(b=>b.id);bossBalls[0].lastHit='right';awardRoyalPowerup('split',bossBalls[0]);Object.assign(royalSplitBall,{x:W+10,vx:5,rallyLaunchFramesRemaining:0});updateBossBalls();");
  assert.equal(h.run('bossEnemyHealth'),2);assert.equal(h.run('royalSplitBall'),null);
  assert.deepEqual(h.json('bossBalls.map(b=>b.id)'),h.json('ids'));
  h.run(`setupBoss();bossBalls[0].lastHit='right';awardRoyalPowerup('guard',bossBalls[0]);
   Object.assign(bossBalls[0],{x:W-24,prevX:W-28,vx:5});collideCastleGuard(bossBalls[0]);`);
  assert.equal(h.run('royalGuards.right'),600);assert.ok(h.run('bossBalls[0].vx')<0);
  assert.equal(h.run('bossEnemyHealth'),10,'a boss-owned shield protects boss health');
  h.run(`setupBoss();bossEnemyHealth=1;bossRallyFrames=600;updateBossBalls();
   let victories=0;bossVictory=()=>{victories++;gameOver=true};
   bossBalls[0].lastHit='left';awardRoyalPowerup('split',bossBalls[0]);
   for(const b of [...bossBalls,royalSplitBall])Object.assign(b,{x:W+10,vx:5,rallyLaunchFramesRemaining:0});updateBossBalls();`);
  assert.equal(h.run('bossEnemyHealth'),0);assert.equal(h.run('victories'),1,'simultaneous permanent/Split exits finish only once');
  h.run('setupBoss();royalRallyTick=179;updateRoyalPowerups();royalRallyTick=0;for(let i=0;i<480;i++)updateRoyalPowerups();');
  assert.equal(h.run('royalPickup'),null,'uncollected pickup expires');
 }
});

test('boss prediction is bounded and side-effect free; reachable permanent and temporary threats take priority',()=>{
 for(const platform of Object.keys(builds)) {
  const h=bossSimulation(platform);h.run(`setupBoss();hazards=[];right.y=380;
   bossBalls=[{id:1,x:580,y:20,vx:8,vy:0},{id:2,x:500,y:390,vx:6,vy:0}];
   const before=JSON.stringify([bossBalls,left,right,bossSeed,royalGuards]);
   const chosen=bossThreatBall();`);
  assert.equal(h.run('chosen===bossBalls[1]'),true,'do not chase an already lost earlier ball');
  assert.equal(h.run('JSON.stringify([bossBalls,left,right,bossSeed,royalGuards])'),h.run('before'));
  h.run('royalSplitBall={...bossBalls[1],id:"royal-split"};bossBalls.length=1;frame+=6;');
  assert.equal(h.run('bossThreatBall()===royalSplitBall'),true,'temporary balls are genuine health threats');
  h.run(`setupBoss();let sounds=0,flashes=0;playImpactSound=()=>sounds++;applyHitFlash=()=>flashes++;
   const probe={id:1,x:350,y:236,vx:5,vy:0};const forecast={};
   const worldBefore=JSON.stringify([bossBalls,left,right,hazards,bossSeed]);forecastBossBall(probe,getCpuConfig(),forecast);`);
  assert.equal(h.run('forecast.frames'),Infinity,'the center bumper turns this trajectory away from the boss');
  assert.deepEqual(h.json('[sounds,flashes]'),[0,0]);
  assert.equal(h.run('JSON.stringify([bossBalls,left,right,hazards,bossSeed])'),h.run('worldBefore'));
  h.run(`hazards=[];Object.assign(probe,{x:500,y:10,vx:5,vy:-4});forecastBossBall(probe,getCpuConfig(),forecast);`);
  assert.ok(h.run('forecast.center')>10,'upper wall rebound is anticipated');
  assert.ok(h.run('forecast.frames')<=h.run('getCpuConfig().horizon'));
  assert.ok(h.run('forecast.vy')>0);
 }
});

test('boss keeps stable targets and six-tick shape decisions while aiming only through legal geometry',()=>{
 const h=bossSimulation();h.run(`setupBoss();hazards=[];right.y=208;
  bossBalls=[{id:1,x:500,y:230,vx:5,vy:0},{id:2,x:499,y:245,vx:5,vy:0}];
  updateBossCPU();const firstTarget=bossThreatBall();const decisionAt=bossAdaptiveDecisionFrame;
  bossBalls[1].x=501;frame+=5;selectBossAdaptiveProfile(bossBalls[1],true);`);
 assert.equal(h.run('bossAdaptiveDecisionFrame'),h.run('decisionAt'),'even a new ball cannot force a last-second shape change');
 h.run('frame++;updateBossCPU();');assert.equal(h.run('bossThreatBall()===firstTarget'),true,'near ties do not flicker');
 h.run('firstTarget.vx=-5;frame+=6;updateBossCPU();');assert.equal(h.run('bossThreatBall()===bossBalls[1]'),true);
 for(const playerY of [40,400]) {
  h.run(`setupBoss();hazards=[];left.y=${playerY};right.y=208;
   bossBalls=[{id:3,x:520,y:236,vx:6,vy:0}];const oldVelocity${playerY}=[bossBalls[0].vx,bossBalls[0].vy];
   updateBossCPU();var contactAngle=calculatePaddleBounceAngle(bossAdaptiveProfile,right,-1,240,0,false,false);`);
  assert.deepEqual(h.json('[bossBalls[0].vx,bossBalls[0].vy]'),h.json(`oldVelocity${playerY}`),'planning never steers velocity');
  assert.equal(h.run('contactAngle>0'),playerY===40,'safe shapes aim at the exposed half');
 }
 const conflicts=h.json('simulateBossConflicts()');
 assert.equal(conflicts.returns,conflicts.reachableThreats,'retain the savable balls in these overlapping-contact fixtures');
 assert.equal(conflicts.lostBallReturns,0,'the already lost balls remain impossible to save');
 assert.ok(conflicts.maxMove<=5.4+1e-9);
 h.run('setupBoss();bossEnemyHealth=3;bossRallyFrames=600;updateBossBalls();');
 const max=h.run('getCpuConfig().maxMove');
 h.run(`var biggestMove=0;for(let i=0;i<360;i++){
   frame++;const previousY=right.y;updateHazards();updateBossCPU();updateBossBalls();
   biggestMove=Math.max(biggestMove,Math.abs(right.y-previousY));
   if(right.y<0||right.y>H-PADDLE_H)throw Error('Illegal paddle position');
 }`);
 assert.ok(h.run('biggestMove')<=max+1e-12);
});
