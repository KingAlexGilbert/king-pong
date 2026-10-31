#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const source = path.join(__dirname, 'test.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpong-parallel-selftest-'));
const put = (rel, content, executable = false) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
  if (executable) fs.chmodSync(file, 0o755);
  return file;
};
const script = `import fs from 'node:fs';
const id=process.argv[1].split('/').at(-1)+' '+process.argv.slice(2).join(' ');
fs.appendFileSync(process.env.KINGPONG_EVENTS,JSON.stringify({event:'start',id,at:Date.now()})+'\\n');
await new Promise(r=>setTimeout(r,Number(process.env.KINGPONG_DELAY||300)));
fs.appendFileSync(process.env.KINGPONG_EVENTS,JSON.stringify({event:'end',id,at:Date.now()})+'\\n');
if (process.env.KINGPONG_FAIL && id.includes(process.env.KINGPONG_FAIL)) {
  for (let i = 0; i < 45; i++) console.error('diagnostic stack line ' + i);
  process.exit(7);
}
`;
const run = (flags, delay=200, fail='') => {
  const events = path.join(root,'events.jsonl');
  fs.writeFileSync(events, '');
  const result = spawnSync(process.execPath, [path.join(root,'tools/test.mjs'), ...flags], {
    cwd:root, encoding:'utf8', timeout:30000,
    env:{...process.env, PYTHON:path.join(root,'mock-python'), KINGPONG_EVENTS:events, KINGPONG_DELAY:String(delay), KINGPONG_FAIL:fail}
  });
  const rows = fs.readFileSync(events,'utf8').trim().split(/\n/).filter(Boolean).map(x=>JSON.parse(x));
  const intervals = new Map();
  for (const row of rows) {
    const prev=intervals.get(row.id)||{};
    prev[row.event]=row.at;
    intervals.set(row.id,prev);
  }
  return {result, intervals, stdout:result.stdout+result.stderr};
};
const overlaps = (a,b) => a.start < b.end && b.start < a.end;
const ids = values => [...values.keys()];
const find = (intervals,part) => [...intervals].find(([name])=>name.includes(part))?.[1];
try {
  put('tools/test.mjs',fs.readFileSync(source));
  put('tools/package.json','{"type":"module"}');
  put('tools/test-suites.mjs', `export const browserSuites=[['ui-browser'],['gameplay-browser'],['private-room-browser'],['private-controlled','private-room-browser','--controlled-channels'],['other-new-suite']];
export const extendedSuites=[['local-lan-browser']];`);
  put('tools/sync-gameplay.mjs',script);
  put('tests/unit.mjs',`import test from 'node:test';test('unit',async()=>await new Promise(r=>setTimeout(r,200)));`);
  put('signaling/test/sig.test.mjs',`import test from 'node:test';test('signal',async()=>await new Promise(r=>setTimeout(r,200)));`);
  put('signaling/node_modules/wrangler/bin/wrangler.js',script);
  for (const file of ['ui-browser','gameplay-browser','private-room-browser','other-new-suite','local-lan-browser'])
    put('signaling/test/'+file+'.mjs',script);
  put('mock-python',`#!/bin/sh
sleep .2
`,true);
  const planned = run(['release','--plan']);
  assert.equal(planned.result.status,0,planned.stdout);
  assert.match(planned.stdout,/other-new-suite:.*network-browser/);
  const outFile=path.join(root,'report.json');
  const full = run(['release','--jobs=4','--browser-jobs=2','--report='+outFile,'--logs='+path.join(root,'logs'),'--heartbeat-ms=100']);
  assert.equal(full.result.status,0,full.stdout);
  const report=JSON.parse(fs.readFileSync(outFile,'utf8'));
  assert.deepEqual(report.results.map(x=>x.id),
    ['sync','javascript','python','signaling','worker-build','ui-browser','gameplay-browser','private-room-browser','private-controlled','other-new-suite','local-lan-browser']);
  assert.equal(report.results.every(row=>fs.existsSync(row.logFile)),true);
  const sync=find(full.intervals,'sync-gameplay.mjs');
  for (const [id,span] of full.intervals) if (!id.includes('sync-gameplay.mjs')) assert.ok(sync.end<=span.start,'sync must finish before '+id);
  const ui=find(full.intervals,'ui-browser.mjs');
  const gameplay=find(full.intervals,'gameplay-browser.mjs');
  assert.ok(ui&&gameplay,'both presentation browser suites run');
  // Verify no two suites which use the same underlying browser script overlap.
  const privateSpans=[...full.intervals].filter(([id])=>id.includes('private-room-browser.mjs')).map(([,span])=>span);
  assert.equal(privateSpans.length,2);
  assert.equal(overlaps(privateSpans[0],privateSpans[1]),false,'same script variants must serialize');
  // Network suites and build/test signaling workspace must not overlap.
  const dangerous=[...full.intervals].filter(([id])=>/private-room-browser|other-new-suite|local-lan-browser|wrangler/.test(id));
  for (let i=0;i<dangerous.length;i++) for (let j=0;j<i;j++)
    assert.equal(overlaps(dangerous[i][1],dangerous[j][1]),false,
      `${dangerous[i][0]} conflicts with ${dangerous[j][0]}`);
  const serial=run(['release','--jobs=1','--browser-jobs=1'],70);
  assert.equal(serial.result.status,0,serial.stdout);
  const spans=[...serial.intervals.values()];
  for(let i=0;i<spans.length;i++)for(let j=0;j<i;j++)
    assert.equal(overlaps(spans[i],spans[j]),false,'--jobs=1 must serialize all suites');
  const subset=run(['release','--only=sync,ui-browser,gameplay-browser','--jobs=2','--browser-jobs=2'],200);
  assert.equal(subset.result.status,0,subset.stdout);
  assert.ok(overlaps(find(subset.intervals,'ui-browser.mjs'),find(subset.intervals,'gameplay-browser.mjs')),
    'two independently classified presentation scripts should actually overlap');
  const failure=run(['browser','--only=ui-browser'],50,'ui-browser.mjs');
  assert.equal(failure.result.status,1,failure.stdout);
  assert.match(failure.stdout,/diagnostic stack line 0/, 'expanded stderr context must survive');
  assert.match(failure.stdout,/diagnostic stack line 44/, 'recent stderr context must survive');
  const timed=run(['release','--only=ui-browser','--timeout-ms=100'],500);
  assert.equal(timed.result.status,1,timed.stdout);
  assert.match(timed.stdout,/TIMEOUT/);
  const missing=run(['fast','--only=not-a-suite']);
  assert.notEqual(missing.result.status,0);
  assert.match(missing.stdout,/Unknown suite/);
  // A failed synchronization prerequisite must prevent *every* downstream test.
  put('tools/sync-gameplay.mjs', "console.error('stale generated output'); process.exit(4);");
  const failedSync=run(['release','--only=sync,javascript,ui-browser','--jobs=4'],50);
  assert.equal(failedSync.result.status,1,failedSync.stdout);
  assert.match(failedSync.stdout,/Source synchronization failed/);
  assert.ok(!find(failedSync.intervals,'ui-browser.mjs'),'browser test must not start after failed sync');
  put('tools/sync-gameplay.mjs',script);
  const history=path.join(root,'history.json');
  fs.writeFileSync(history,JSON.stringify({results:[{id:'gameplay-browser',seconds:99},{id:'ui-browser',seconds:1}]}));
  const sorted=run(['release','--only=gameplay-browser,ui-browser','--jobs=1','--history='+history],80);
  assert.equal(sorted.result.status,0,sorted.stdout);
  assert.ok(find(sorted.intervals,'gameplay-browser.mjs').start <= find(sorted.intervals,'ui-browser.mjs').start,
    'longest expected suite should be scheduled first');
  assert.match(full.stdout,/\[progress\]|TEST SUMMARY/);
  assert.ok(full.stdout.includes('concurrency factor'));
  console.log('PASS: suite discovery, dependency barrier, true browser overlap, locks, variant serialization, diagnostics, unknown-suite protection, serial mode, timeout, reports, logs, options.');
} finally {fs.rmSync(root,{recursive:true,force:true});}
