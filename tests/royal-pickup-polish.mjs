import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {harness} from './helpers/royal-harness.mjs';
import {builds, source, functionSource} from './helpers/game-source.mjs';

for (const platform of Object.keys(builds)) {
  test(`${platform}: Split stays in the center band across every arena, moving hazards and cropped viewports`, () => {
    const h = harness(platform);
    h.run(functionSource(source(platform), 'updateHazards'));
    const samples = h.json(`(() => {
      const out = [];
      for (const bounds of [{top: 0, bottom: H}, {top: 70, bottom: 410}]) {
        visiblePlayfieldBounds = () => bounds;
        for (const arena of arenaCatalog) {
          matchArenaId = arena.id;
          hazards = arena.level.hazards.map(h => ({...h, hitFlash: 0}));
          for (let phase = 0; phase < 12; phase++) {
            for (let tick = 0; tick < 30; tick++) updateHazards();
            for (let i = 0; i < 6; i++) {
              royalPickupIndex = (phase * 6 + i) * 3;
              royalRallyId = phase;
              royalRallyTick = 180 + royalPickupIndex * 480;
              const spot = findRoyalPickupSpot();
              if (!spot) throw new Error('No center spawn: arena ' + arena.id + ', phase ' + phase);
              if (!royalPickupSpotSafe(spot.x, spot.y)) throw new Error('Unsafe spawn');
              out.push({arena: arena.id, spot, bounds, hazards: hazards.map(h => ({...h}))});
            }
          }
        }
      }
      return out;
    })()`);
    assert.equal(new Set(samples.map(s => s.arena)).size, 19);
    assert.ok(new Set(samples.map(s => s.spot.x)).size > 80, 'Split retains horizontal variety');
    assert.ok(new Set(samples.map(s => s.spot.y)).size > 250, 'Split retains vertical variety');
    for (const {spot: p, bounds, hazards} of samples) {
      assert.ok(p.x >= 256 && p.x <= 384);
      assert.ok(p.y >= bounds.top + 32 && p.y <= bounds.bottom - 32);
      // Independently check the enlarged 30px drawing against current geometry.
      assert.ok(p.x - 15 > 40 && p.x + 15 < 600, 'clear of both paddles');
      for (const hazard of hazards) {
        const dx = Math.max(hazard.x - p.x, 0, p.x - (hazard.x + (hazard.w || 0)));
        const dy = Math.max(hazard.y - p.y, 0, p.y - (hazard.y + (hazard.h || 0)));
        const clearance = hazard.type === 'circle' ?
          Math.hypot(p.x - hazard.x, p.y - hazard.y) - hazard.r : Math.hypot(dx, dy);
        assert.ok(clearance >= 32, 'existing safety margin exceeds the artwork radius');
      }
    }
  });

  test(`${platform}: Rush and Guard retain their exact pre-change spawn sequences`, () => {
    const h = harness(platform);
    const spots = h.json(`(() => {
      const out = [];
      for (const arena of arenaCatalog) {
        matchArenaId = arena.id;
        hazards = arena.level.hazards.map(h => ({...h}));
        for (let i = 0; i < 120; i++) {
          if (i % 3 === 0) continue;
          royalPickupIndex = i;
          royalRallyId = i % 7;
          royalRallyTick = 180 + i * 480;
          out.push([arena.id, i, findRoyalPickupSpot()]);
        }
      }
      return out;
    })()`);
    // Recorded from main 2f8c753 before changing the spawn code: 1,520 positions/nulls.
    assert.equal(createHash('sha256').update(JSON.stringify(spots)).digest('hex'),
      '42d4f9348702e5ba16abfd67453f89db5ed9bf70baa31bddd2ce42a596935107');
    for (const typeIndex of [1, 2]) {
      const x = spots.filter(s => s[1] % 3 === typeIndex && s[2]).map(s => s[2].x);
      assert.ok(Math.min(...x) < 160 && Math.max(...x) > 480);
    }
  });

  test(`${platform}: selection order, cadence, lifetime and host authority are unchanged`, () => {
    const h = harness(platform);
    const spawns = h.json(`(() => {
      const out = [];
      lanRole = 'host';
      for (let tick = 1; tick <= 180 + 89 * 480; tick++) {
        updateRoyalPowerups();
        if (royalPickup?.ttl === 480) out.push({tick, ...royalPickup});
      }
      return out;
    })()`);
    assert.equal(spawns.length, 90);
    for (const [i, p] of spawns.entries()) {
      assert.equal(p.tick, 180 + i * 480);
      assert.equal(p.type, ['split', 'rush', 'guard'][i % 3]);
      assert.equal(p.ttl, 480);
      if (p.type === 'split') assert.ok(p.x >= 256 && p.x <= 384);
    }
    h.run(`royalPickupIndex=0;royalPickup=null;royalRallyTick=179;updateRoyalPowerups();
      const packed=packRoyalState();lanRole='guest';royalPickup=null;royalRallyTick=179;
      for(let tick=0;tick<2000;tick++)updateRoyalPowerups();`);
    assert.equal(h.run('royalPickup'), null);
    assert.equal(h.run("findRoyalPickupSpot('split')"), null);
    assert.equal(h.run('royalRallyTick'), 179);
    h.run('applyRoyalState(packed);');
    assert.deepEqual(h.json('royalPickup'), h.json('packed.pickup'), 'guest keeps the host position exactly');
    h.run("lanRole='host';const before=JSON.stringify(royalPickup);handleLanHostMessage({type:'pickup',x:600,y:240});");
    assert.equal(h.run('JSON.stringify(royalPickup)'), h.run('before'));
    h.run('mode=4;royalPickup=null;royalRallyTick=179;updateRoyalPowerups();');
    assert.equal(h.run('royalPickup'), null, 'the secret boss still disables powerups');
  });
}

test('Split fallback finds a narrow center gap and never escapes to a paddle when the band is blocked', () => {
  const h = harness();
  h.run(`hazards = [
    {type:'rect',x:0,y:0,w:W,h:208},
    {type:'rect',x:0,y:272,w:W,h:208},
    {type:'rect',x:0,y:0,w:285,h:H},
    {type:'rect',x:349,y:0,w:291,h:H}
  ];`);
  // Exactly one safe integer coordinate remains after the 32-unit hazard margin.
  for (let i = 0; i < 12; i++) {
    h.run(`royalPickupIndex=${i * 3};royalRallyId=${i};`);
    assert.deepEqual(h.json('findRoyalPickupSpot()'), {x: 317, y: 240});
  }
  h.run("hazards=[{type:'rect',x:250,y:0,w:140,h:H}];royalPickupIndex=0;");
  assert.equal(h.run('findRoyalPickupSpot()'), null);
  h.run('royalRallyTick=179;updateRoyalPowerups();');
  assert.equal(h.run('royalPickup'), null);
  assert.equal(h.run('royalPickupIndex'), 1, 'blocked Split still advances the existing selection cycle');
  assert.ok(h.run('findRoyalPickupSpot()'), 'Rush still uses safe side regions');
});

test('all pickup drawings use 30px nearest-neighbor artwork at the same center and keep 24-unit collection', () => {
  const h = harness();
  h.run(`const draws=[];
    document.createElement=()=>({getContext:()=>({fillRect(){}})});
    const ctx={save(){},restore(){},drawImage(sprite,...args){draws.push({args,smoothing:this.imageSmoothingEnabled})}};
    for(const type of ROYAL_TYPES)drawRoyalEffects({guards:{left:0,right:0},pickup:{type,x:320,y:240}});`);
  assert.deepEqual(h.json('draws'), Array(3).fill({args: [305, 225, 30, 30], smoothing: false}));
  for (const [distance, collected] of [[23.99, true], [24, true], [24.01, false], [30, false]]) {
    h.run(`royalPickup={type:'guard',x:320,y:240,ttl:480};ball.lastHit='left';
      ball.prevX=ball.x=316;ball.prevY=ball.y=236+${distance};collectRoyalPickup();`);
    assert.equal(h.run('royalPickup===null'), collected);
  }
});
