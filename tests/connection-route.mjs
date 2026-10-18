import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const route=vm.runInNewContext(readFileSync(new URL('../game/network-common.js',import.meta.url),'utf8')+'\nkingPongRoute');
function stats(local,remote){return new Map([
  ['transport',{type:'transport',selectedCandidatePairId:'selected'}],
  ['selected',{type:'candidate-pair',state:'succeeded',localCandidateId:'local',remoteCandidateId:'remote'}],
  ['unused',{type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'relay',remoteCandidateId:'remote'}],
  ['relay',{candidateType:'relay'}],['local',local],['remote',remote]
]);}
test('route uses the selected pair, never an unused relay or inferred mDNS proximity',()=>{
  assert.equal(route(stats({candidateType:'host',address:'192.168.1.2'},{candidateType:'host',address:'192.168.1.3'})),'Direct (Local)');
  assert.equal(route(stats({candidateType:'srflx'},{candidateType:'host',address:'redacted.local'})),'Direct (Internet)');
  assert.equal(route(stats({candidateType:'host'},{candidateType:'relay'})),'TURN Relay');
  for(const address of [undefined,'private.local','127.0.0.1','0.0.0.0'])assert.equal(route(stats({candidateType:'host',address},{candidateType:'host',address})),'Unknown');
  assert.equal(route(new Map()),'Unknown');
});
test('only an unambiguous nominated succeeded pair is usable without transport stats',()=>{
  const s=stats({candidateType:'host',address:'10.1.1.2'},{candidateType:'host',address:'10.1.1.3'});
  s.delete('transport');s.get('selected').nominated=true;assert.equal(route(s),'Unknown');
  s.delete('unused');assert.equal(route(s),'Direct (Local)');s.get('selected').state='in-progress';assert.equal(route(s),'Unknown');
});
