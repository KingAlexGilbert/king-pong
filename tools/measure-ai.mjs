// Optional deterministic diagnostic; not a new release gate or a win-rate target.
// JSON goes to stdout only. --baseline=<ref> substitutes the old CPU decisions
// and Wall policy into the same physics harness for this focused comparison.
import {execFileSync} from 'node:child_process';
import {campaignSimulation} from '../tests/helpers/campaign-simulation.mjs';
import {bossSimulation} from '../tests/helpers/boss-simulation.mjs';
import {functionSource} from '../tests/helpers/game-source.mjs';

const args = process.argv.slice(2);
const baseline = args.find(a => a.startsWith('--baseline='))?.slice(11);
const matches = Number(args.find(a => a.startsWith('--matches='))?.slice(10) || 20);
if (!Number.isSafeInteger(matches) || matches < 1 || matches > 200 || args.some(a =>
  !['--effects', '--matches-only'].includes(a) && !a.startsWith('--baseline=') && !a.startsWith('--matches='))) {
  throw new Error('Usage: node tools/measure-ai.mjs [--baseline=git-ref] [--matches=1..200] [--effects] [--matches-only]');
}
const previous = baseline ? execFileSync('git', ['show', baseline + ':docs/demo/index.html'],
  {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}) : null;
const h = campaignSimulation();
if (previous) h.run(['getCpuConfig', 'updateCPU', 'royalCpuAim'].map(n => functionSource(previous, n)).join('\n'));
const rows = [];
for (let level = 1; level <= 18; level++) {
  const start = performance.now();
  const shots = args.includes('--matches-only') ? undefined : h.json(`simulateShots(${level})`);
  const results = h.json(`simulateMatches(${level},${matches},'tracking',{},${args.includes('--effects')})`);
  rows.push({level, shots, matches: results, seconds: (performance.now() - start) / 1000});
  console.error('Measured level ' + level);
}
const boss = bossSimulation('Browser', previous);
const start = performance.now();
const bossResults = boss.json(`simulateBossMatches(${matches})`);
console.log(JSON.stringify({baseline: baseline || 'working tree', effects: args.includes('--effects'), rows,
  boss: {...bossResults, seconds: (performance.now() - start) / 1000}, heapUsed: process.memoryUsage().heapUsed}, null, 2));
