import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'king-pong-runner-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const path of ['tools','tests','signaling/test'])mkdirSync(join(root,path),{recursive:true});
 copyFileSync(new URL('../tools/test.mjs',import.meta.url),join(root,'tools/test.mjs'));
 writeFileSync(join(root,'tools/test-suites.mjs'),"export const browserSuites=[['one'],['two']],extendedSuites=[];\n");
 for(const id of ['one','two'])writeFileSync(join(root,'signaling/test',id+'.mjs'),`
   console.log('LIVE ${id}');
   if(process.env.RUNNER_WAIT==='${id}'){
     if(process.env.RUNNER_STUCK)process.on('SIGINT',()=>{});
     console.log('READY_TO_STOP');setInterval(()=>{},1000);
   }else if(process.env.RUNNER_SIGNAL==='${id}')process.kill(process.pid,'SIGTERM');
   else if((process.env.RUNNER_FAILURES||'').split(',').includes('${id}')){
     process.stdout.write('x'.repeat(1000000)+'\\n');
     for(let i=0;i<40;i++)console.log('line '+i);
     process.stderr.write('FINAL ERROR ${id}\\n');process.exitCode=7;
   }
 `);
 return root;
}
function run(root,args=[],env={},stop=false) {
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['tools/test.mjs',...args],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let output='',signaled=false;
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
   output+=chunk;
   if(stop&&!signaled&&output.includes('READY_TO_STOP')){signaled=true;child.kill('SIGINT');}
  });
  child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,output}));
 });
}
const summary=output=>output.slice(output.indexOf('========== TEST SUMMARY'));
test('runner emits one success summary, preserves order and creates no implicit report',async t=>{
 const root=fixture(t),r=await run(root,['browser']);
 assert.equal(r.code,0);assert.equal(r.output.match(/TEST SUMMARY/g).length,1);
 assert.match(r.output,/Commands completed: 2\nPassed: 2\nFailed: 0\nTotal duration: [\d.]+s/);
 assert.ok(r.output.indexOf('LIVE one')<r.output.indexOf('LIVE two'));
 assert.equal(readdirSync(root).some(f=>f.endsWith('.json')),false);
 const list=await run(root,['browser','--only=two','--list']);assert.equal(list.code,0);assert.doesNotMatch(list.output,/RUN |TEST SUMMARY/);
});
test('one or multiple failures retain live output and only bounded relevant tails in summary and JSON',async t=>{
 const root=fixture(t);
 for(const ids of ['one','one,two']){
  const r=await run(root,['browser','--report=report.json'],{RUNNER_FAILURES:ids});
  assert.equal(r.code,1);assert.equal(r.output.match(/TEST SUMMARY/g).length,1);
  assert.match(r.output,/x{100000}/,'large output is forwarded live');
  const report=JSON.parse(readFileSync(join(root,'report.json'))),failed=report.results.filter(r=>r.exit!==0);
  assert.equal(failed.length,ids.split(',').length);assert.equal(report.results.length,2);
  assert.ok(summary(r.output).length<6000);
  for(const row of failed){
   assert.equal(row.exit,7);assert.equal(row.argv[0],process.execPath);assert.match(row.command,/test[/\\](one|two)\.mjs/);
   assert.equal(typeof row.seconds,'number');assert.ok(row.outputTail.length<=15);
   assert.ok(row.outputTail.some(line=>line.includes('FINAL ERROR')));
   assert.ok(row.outputTail.every(line=>line.length<=1000));
  }
 }
});
test('missing PYTHON override is a launch failure with command, duration and optional compatible JSON',async t=>{
 const root=fixture(t),python=join(root,'no-such-python');
 const r=await run(root,['core','--only=python','--report=report.json'],{PYTHON:python});
 assert.equal(r.code,1);assert.match(summary(r.output),/FAILED: python/);assert.match(summary(r.output),/Launch error:.*ENOENT/);
 const row=JSON.parse(readFileSync(join(root,'report.json'))).results[0];
 assert.equal(row.id,'python');assert.equal(row.exit,1);assert.equal(row.argv[0],python);assert.match(row.launchError,/ENOENT/);
});
test('signaled child is reported and later selected commands still execute',{skip:process.platform==='win32'},async t=>{
 const r=await run(fixture(t),['browser'],{RUNNER_SIGNAL:'one'});
 assert.equal(r.code,1);assert.match(r.output,/signal SIGTERM/);assert.match(r.output,/LIVE two/);
});
test('interruption stops later commands, drains output, records signal and terminates an unresponsive child',{skip:process.platform==='win32'},async t=>{
 for(const stuck of ['', '1']){
  const root=fixture(t),r=await run(root,['browser','--report=report.json'],{RUNNER_WAIT:'one',RUNNER_STUCK:stuck},true);
  assert.equal(r.code,130);assert.doesNotMatch(r.output,/LIVE two/);assert.match(r.output,/Test run interrupted: SIGINT/);
  assert.equal(r.output.match(/TEST SUMMARY/g).length,1);
  const row=JSON.parse(readFileSync(join(root,'report.json'))).results[0];
  assert.equal(row.signal,stuck?'SIGKILL':'SIGINT');assert.ok(row.outputTail.includes('READY_TO_STOP'));
 }
});
