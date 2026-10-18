import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {builds} from './helpers/game-source.mjs';
import {campaignSimulation} from './helpers/campaign-simulation.mjs';
const original = JSON.parse(readFileSync(new URL('./fixtures/campaign-cpu-before.json', import.meta.url)));
for (const platform of Object.keys(builds)) {
  test(`${platform}: only early campaign aim error and prediction change`, () => {
    const h = campaignSimulation(platform);
    for(let level=1;level<=18;level++)for(const deficit of [0,1,2]) {
      const config=h.json(`(()=>{mode=1;activeCampaign=Math.floor((${level}-1)/6);levelIndex=(${level}-1)%6;left.score=0;right.score=${deficit};return getCpuConfig()})()`);
      const expected={...original[level+':'+deficit]};
      if(level<=3){expected.error=[36,32,28][level-1];expected.prediction=[.30,.34,.38][level-1];}
      assert.deepEqual(config,expected);
    }
    for(const mode of [3,4])assert.deepEqual(h.json(`(()=>{mode=${mode};return getCpuConfig()})()`),original['mode:'+mode]);
  });
}
test('opening opponents improve across varied shots but still miss naturally', () => {
  const h=campaignSimulation();let previous=0;
  for(let level=1;level<=3;level++) {
    const before=original[level+':0'];
    const old=h.json(`simulateShots(${level},${JSON.stringify(before)})`);
    const current=h.json(`simulateShots(${level})`);
    assert.ok(current.returnRate>old.returnRate+.04);
    assert.ok(current.returnRate>previous);previous=current.returnRate;
    assert.ok(current.misses>100,'CPU can miss unassisted real trajectories');
  }
});
test('Level 1 sustains short rallies without becoming difficult for a modest tracking player', () => {
  const h=campaignSimulation(), before=original['1:0'];
  const old=h.json(`simulateMatches(1,100,'tracking',${JSON.stringify(before)})`);
  const current=h.json("simulateMatches(1,100,'tracking')");
  assert.ok(current.cpuReturns>old.cpuReturns);
  assert.ok(current.shortRallyMatches>old.shortRallyMatches);
  assert.ok(current.trivialWins<old.trivialWins);
  assert.ok(current.wins>=80 && current.cpuMisses>200,'beginner fixture remains successful; misses are not removed');
  assert.equal(current.timeouts,0);
});
