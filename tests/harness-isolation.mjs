import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './helpers/royal-harness.mjs';

test('compiled fixtures isolate saves, entities, collections and random state', () => {
  const first = harness(), second = harness();
  const pristine = second.json('({saveData,ball,left,royalGuards,random:Math.random.toString()})');
  first.run('saveData.completedLevels.fill(true);ball.x=0;left.score=99;royalGuards.left=600;Math.random=()=>.123;const fixtureOnly=true;');
  assert.deepEqual(second.json('({saveData,ball,left,royalGuards,random:Math.random.toString()})'), pristine);
  assert.equal(second.run('typeof fixtureOnly'), 'undefined');
  assert.deepEqual(harness().json('({saveData,ball,left,royalGuards,random:Math.random.toString()})'), pristine);
});
