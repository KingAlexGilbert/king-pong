import {spawn} from 'node:child_process';
import {readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserSuites, extendedSuites} from './test-suites.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), group = args[0] || 'standard';
const report = args.find(arg => arg.startsWith('--report='))?.slice(9);
const only = args.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const node = process.execPath;
const testFiles = (dir, suffix) => readdirSync(resolve(root, dir)).filter(f => f.endsWith(suffix))
  .sort().map(f => dir + '/' + f);
const fast = [
  {id: 'sync', command: [node, 'tools/sync-gameplay.mjs', '--check']},
  {id: 'javascript', command: [node, '--test', ...testFiles('tests', '.mjs')]}
];
const core = [...fast,
  {id: 'python', command: [process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v']},
  {id: 'signaling', command: [node, '--test', ...testFiles('signaling/test', '.test.mjs')]},
  {id: 'worker-build', command: [node, 'node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run'], cwd: 'signaling'}
];
const browsers = rows => rows.map(([id, script = id, ...flags]) =>
  ({id, command: [node, 'test/' + script + '.mjs', ...flags], cwd: 'signaling'}));
const browser = browsers(browserSuites), extended = browsers(extendedSuites);
const groups = {fast, core, browser, extended, standard: [...core, ...browser], release: [...core, ...browser, ...extended]};
if (!groups[group] || args.slice(1).some(arg => arg !== '--list' && !arg.startsWith('--report=') && !arg.startsWith('--only='))) {
  throw new Error('Usage: node tools/test.mjs [fast|core|browser|extended|standard|release] [--list] [--only=id,id] [--report=path.json]');
}
let suites = groups[group];
if (only) {
  for (const id of only) if (!suites.some(s => s.id === id)) throw new Error('Unknown suite in ' + group + ': ' + id);
  suites = suites.filter(s => only.includes(s.id));
}
if (args.includes('--list')) {
  for (const suite of suites) console.log(suite.id + ': ' + suite.command.slice(1).join(' '));
} else {
  const results = [];
  let child, interrupted = false;
  const stop = () => { interrupted = true; child?.kill('SIGINT'); };
  process.once('SIGINT', stop);
  for (const suite of suites) {
    if (interrupted) break;
    console.log('\nRUN ' + suite.id);
    const start = performance.now();
    const exit = await new Promise(resolveExit => {
      child = spawn(suite.command[0], suite.command.slice(1), {
        cwd: resolve(root, suite.cwd || '.'), stdio: 'inherit',
        env: {...process.env, WRANGLER_SEND_METRICS: 'false'}
      });
      child.once('error', error => { console.error(error.message); resolveExit(1); });
      child.once('exit', (code, signal) => resolveExit(code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
    const row = {id: suite.id, exit, seconds: Number(((performance.now() - start) / 1000).toFixed(3))};
    results.push(row);
    console.log((exit === 0 ? 'PASS ' : 'FAIL ') + JSON.stringify(row));
    if (report) {
      mkdirSync(dirname(resolve(report)), {recursive: true});
      writeFileSync(resolve(report), JSON.stringify({group, results}, null, 2) + '\n');
    }
  }
  process.removeListener('SIGINT', stop);
  console.log(`${results.length} commands completed; ${results.filter(r => r.exit !== 0).length} failed. Native skips remain explicit in Python output.`);
const failed = results.filter(r => r.exit !== 0);

if (failed.length > 0) {
  console.error('\n========== FAILED COMMANDS ==========');
  for (const result of failed) {
    console.error(JSON.stringify(result, null, 2));
  }
  console.error('=====================================\n');
} else if (!interrupted) {
  console.log('\nAll test commands passed.');
}
// Print a summary after every test run.
const failures = results.filter(r => r.exit !== 0);
const passed = results.length - failures.length;

console.log('\n========== TEST SUMMARY ==========');
console.log(`Commands completed: ${results.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failures.length}`);

if (failures.length > 0) {
  console.error('\nFAILED COMMANDS:');

  for (const failure of failures) {
    const name = failure.id ?? failure.name ?? failure.command ?? 'Unknown';

    console.error(`- ${name} (exit code ${failure.exit})`);

    if (failure.command) {
      console.error(`  Command: ${failure.command}`);
    }
  }
}

if (interrupted) {
  console.warn('\nTest run interrupted.');
}

console.log('==================================\n');
  process.exitCode = interrupted ? 130 : results.some(r => r.exit !== 0) ? 1 : 0;
}
