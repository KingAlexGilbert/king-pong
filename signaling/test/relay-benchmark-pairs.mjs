// Alternate AB/BA order, fresh processes, identical harness/configuration.
// node test/relay-benchmark-pairs.mjs BEFORE_SOURCE OUTPUT_DIR [pairs=6] [seconds=8] [warmup=2]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const before=resolve(process.argv[2]||''),out=resolve(process.argv[3]||''),pairs=Number(process.argv[4]||6);
assert.ok(process.argv[2] && process.argv[3] && Number.isInteger(pairs) && pairs>=2 && pairs<=20,'supply baseline, output directory, 2–20 pairs');
const script=fileURLToPath(new URL('./relay-benchmark.mjs',import.meta.url));
const after=fileURLToPath(new URL('../src',import.meta.url));
await mkdir(out,{recursive:true});const runs=[];
for(let pair=1;pair<=pairs;pair++)for(const variant of pair%2?['before','after']:['after','before']) {
  console.error(`Pair ${pair}/${pairs}: ${variant}`);
  const args=[script,variant==='before'?before:after,process.argv[5]||'8',process.argv[6]||'2'];
  let stdout='',stderr='';const started=Date.now();
  const exit=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});child.on('error',reject);child.on('close',resolve);
  });
  const name=`pair-${pair}-${variant}`;
  await writeFile(resolve(out,name+'.json'),stdout);await writeFile(resolve(out,name+'.stderr.log'),stderr);
  runs.push({pair,variant,command:[process.execPath,...args],exit,wallSeconds:(Date.now()-started)/1000,...(exit===0?{data:JSON.parse(stdout)}:{})});
  await writeFile(resolve(out,'runs.json'),JSON.stringify(runs,null,2)+'\n');
  assert.equal(exit,0,`${name} failed; inspect saved stderr`);
}
console.error(`Completed ${pairs} paired runs; all observations saved in ${out}`);
