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

test('every platform retains exactly two persistent Wall balls, adaptive shapes, health scoring and resets',()=>{
 for(const platform of Object.keys(builds)){
  const h=bossSimulation(platform);h.run('setupBoss(1009)');
  assert.equal(h.run('bossBalls.length'),2);
  for(const frames of [0,599,600,3000])for(const health of [10,4,1]){
   h.run(`bossRallyFrames=${frames};bossEnemyHealth=${health}`);assert.equal(h.run('desiredBossBallCount()'),2);
  }
  h.run('setupBoss(1009);const oldIds=bossBalls.map(b=>b.id);royalSplitBall={...ball};resetRoyalRally();');
  assert.deepEqual(h.json('bossBalls.map(b=>b.id)'),h.json('oldIds'),'Royal Split reset cannot remove boss balls');
  h.run('bossBalls[0].x=W+10;bossBalls[0].vx=4;updateBossBalls();');
  assert.equal(h.run('bossEnemyHealth'),9);assert.equal(h.run('bossBalls.length'),2);
  assert.notEqual(h.run('bossBalls[0].id'),h.run('oldIds[0]'));assert.equal(h.run('bossBalls[1].id'),h.run('oldIds[1]'));
  h.run('bossBalls[0].x=-30;bossBalls[0].vx=-4;updateBossBalls();');assert.equal(h.run('bossPlayerHealth'),12);
  const shapes=h.json(`(()=>{const seen=new Set();
   for(let y=30;y<450;y+=15)for(const vy of [-4,0,4]){
    const b={id:y+vy,x:560,y:y-4,vx:5,vy};frame+=6;selectBossAdaptiveProfile(b);seen.add(bossAdaptiveProfile.name);
   }return [...seen];})()`);
  assert.ok(shapes.length>3);assert.ok(shapes.every(s=>h.json('BOSS_ADAPTIVE_PROFILES.map(p=>p.name)').includes(s)));
  h.run(`setupBoss(1009);Object.assign(bossBalls[0],{x:400,y:50,vx:4,vy:0});
    Object.assign(bossBalls[1],{x:560,y:300,vx:4,vy:0});`);
  assert.equal(h.run('bossThreatBall()===bossBalls[1]'),true,'the earlier of two incoming threats remains the target');
  h.run('selectBossAdaptiveProfile(bossBalls[1]);const decisionAt=bossAdaptiveDecisionFrame;frame+=5;selectBossAdaptiveProfile(bossBalls[1]);');
  assert.equal(h.run('bossAdaptiveDecisionFrame'),h.run('decisionAt'),'same-ball adaptation keeps its existing six-tick limit');
  h.run('frame++;selectBossAdaptiveProfile(bossBalls[1]);');assert.equal(h.run('bossAdaptiveDecisionFrame'),h.run('frame'));
  for(let shape=0;shape<9;shape++){
   h.run(`bossAdaptiveProfile=BOSS_ADAPTIVE_PROFILES[${shape}];right.y=208;
    Object.assign(bossBalls[0],{y:236,vx:5,vy:0});
    bossBalls[0].x=paddleSurfaceX(right,-1,bossAdaptiveProfile,240)-BALL_SIZE+.1;
    bossBalls[0].prevX=bossBalls[0].x-5;`);
   assert.equal(h.run('paddleIntersectsBall(bossBalls[0],right,-1,bossAdaptiveProfile)'),true);
   h.run('hitBossPaddle(bossBalls[0],right,-1)');assert.ok(h.run('bossBalls[0].vx')<0);
   h.run('bossBalls[0].y=right.y-PADDLE_H');
   assert.equal(h.run('paddleIntersectsBall(bossBalls[0],right,-1,bossAdaptiveProfile)'),false,'the wall remains vulnerable outside its physical paddle');
  }
  h.run('setupBoss(1009);right.y=400;const yBefore=right.y;updateBossCPU();');
  assert.ok(Math.abs(h.run('right.y-yBefore'))<=h.run('getCpuConfig().maxMove'));
  h.run('royalRallyTick=179;updateRoyalPowerups()');assert.equal(h.run('royalPickup'),null);
 }
});
