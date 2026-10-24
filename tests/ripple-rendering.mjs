import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './helpers/royal-harness.mjs';
import {source,functionSource} from './helpers/game-source.mjs';
const platform = 'Browser';
 test(`${platform}: spawn rings preserve geometry/fade without shadow filters or gameplay mutation`,()=>{
  const h=harness(platform),strokes=[],arcs=[],blur=[];
  let state={globalAlpha:1,lineWidth:1,strokeStyle:'white',shadowBlur:7};const stack=[];
  h.context.ctx=new Proxy({save(){stack.push({...state})},restore(){state=stack.pop()},beginPath(){},
    arc(x,y,r){arcs.push([x,y,r])},stroke(){strokes.push({...state})}},
    {set(target,key,value){if(key==='shadowBlur')blur.push(value);state[key]=value;return true},get(target,key){return target[key]??state[key]}});
  h.run('let renderScale=1;const canvas={height:480};const RALLY_SPAWN_PULSE_START_RADIUS=10,RALLY_SPAWN_PULSE_END_RADIUS=38;');
  const before=h.json('captureVisualState()');
  for(const scale of [.5,1,2,3,6])for(const remaining of [60,37.5,.25]) {
    arcs.length=strokes.length=blur.length=0;
    h.run(`renderScale=${scale};canvas.height=480*renderScale;drawSpawnRipple({x:310,y:203,remaining:${remaining}},'#bd7aff')`);
    assert.deepEqual(arcs,[[310,203,10+28*(1-remaining/60)],[310,203,(10+28*(1-remaining/60))*.58]]);
    assert.equal(strokes.length,8);assert.ok(blur.every(n=>n===0));
    assert.equal(strokes[3].lineWidth,2);assert.equal(strokes[7].lineWidth,1);
    assert.ok(Math.abs(strokes[3].globalAlpha-remaining/60*.82)<1e-12);
    assert.ok(Math.abs(strokes[7].globalAlpha-remaining/60*.82*.42)<1e-12);
    assert.equal(state.shadowBlur,7,'caller state restored');
  }
  assert.deepEqual(h.json('captureVisualState()'),before);
  strokes.length=0;h.run("drawSpawnRippleAt(100,100,0,'red')");assert.equal(strokes.length,0);
 });
 test(`${platform}: boss spawn pulses share the same renderer without allocating pulse objects`,()=>{
  const h=harness(platform);h.run(functionSource(source(platform),'drawBossRallySpawnPulses'));
  h.run("const calls=[];drawSpawnRippleAt=(...args)=>calls.push(args);bossBalls=[{rallySpawnPulseX:90,rallySpawnPulseY:130,rallyLaunchFramesRemaining:30}];drawBossRallySpawnPulses()");
  assert.deepEqual(h.json('calls[0].slice(0,3)'),[90,130,30]);
 });
