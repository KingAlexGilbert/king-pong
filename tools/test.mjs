import {spawn} from 'node:child_process';
import {constants as osConstants} from 'node:os';
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
  const results = [], runStart = performance.now();
  let child, interruption = null, killTimer;
  const stop = signal => {
    interruption = signal;
    child?.kill(signal);
    // A stuck child must not leave an interrupted runner waiting forever.
    killTimer = setTimeout(() => child?.kill('SIGKILL'), 2000);
    killTimer.unref();
  };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const signalExit = signal => 128 + (osConstants.signals[signal] || 1);
  const displayCommand = command => command.map(arg => /^[\w./:=\\-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(' ');
  for (const suite of suites) {
    if (interruption) break;
    console.log('\nRUN ' + suite.id);
    const start = performance.now();
    const tails = {stdout: '', stderr: ''};
    let launchError = null;
    // Bound each stream even for newline-free output. Keep stderr separately so
    // a delayed stdout drain cannot erase the actual error from the summary.
    const capture = (data, stream = 'stderr') => {
      const maxBytes = stream === 'stderr' ? 65536 : 8192;
      tails[stream] = (tails[stream] + data).slice(-maxBytes);
    };
    const outcome = await new Promise(resolveExit => {
      try {
        child = spawn(suite.command[0], suite.command.slice(1), {
          cwd: resolve(root, suite.cwd || '.'), stdio: ['inherit', 'pipe', 'pipe'],
          env: {...process.env, WRANGLER_SEND_METRICS: 'false'}
        });
      } catch (error) {
        launchError = error.message;
        console.error(launchError); capture(launchError);
        resolveExit({exit: 1, signal: null}); return;
      }
      for (const [name, destination] of [['stdout', process.stdout], ['stderr', process.stderr]]) {
        const stream = child[name];
        stream.setEncoding('utf8');
        stream.pipe(destination, {end: false});
        stream.on('data', data => capture(data, name));
      }
      child.once('error', error => {
        launchError = error.message;
        console.error(launchError); capture('\n' + launchError + '\n');
      });
      // close, unlike exit, follows the final stdout/stderr data events.
      child.once('close', (code, signal) => resolveExit({exit: launchError ? 1 : code ?? signalExit(signal), signal}));
    });
    clearTimeout(killTimer);
    child = null;
    // The AssertionError header and source location often precede the last few stderr lines.
    // Keep enough stderr context to diagnose failures directly from the CI summary.
    const lines = (stream, count) => tails[stream].replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .split(/[\r\n]+/).filter(line => line.trim()).slice(-count).map(line => line.slice(0, 2000));
    const outputTail = [...lines('stdout', 8),
      ...lines('stderr', 60).map(line => '[stderr] ' + line)];
    const row = {id: suite.id, exit: outcome.exit,
      seconds: Number(((performance.now() - start) / 1000).toFixed(3)),
      command: displayCommand(suite.command), argv: suite.command, cwd: resolve(root, suite.cwd || '.'),
      ...(outcome.signal ? {signal: outcome.signal} : {}), ...(launchError ? {launchError} : {}),
      ...(outcome.exit !== 0 ? {outputTail} : {})};
    results.push(row);
    console.log((row.exit === 0 ? 'PASS ' : 'FAIL ') + JSON.stringify({id: row.id, exit: row.exit, seconds: row.seconds}));
    if (report) {
      mkdirSync(dirname(resolve(report)), {recursive: true});
      writeFileSync(resolve(report), JSON.stringify({group, results}, null, 2) + '\n');
    }
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  clearTimeout(killTimer);
  const failed = results.filter(row => row.exit !== 0);
  console.log('\n========== TEST SUMMARY ==========');
  console.log(`Commands completed: ${results.length}`);
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Total duration: ${((performance.now() - runStart) / 1000).toFixed(3)}s`);
  for (const row of failed) {
    console.log(`\nFAILED: ${row.id}\nCommand: ${row.command}\nDirectory: ${row.cwd}`);
    console.log(row.launchError ? `Launch error: ${row.launchError}` :
      `Exit code: ${row.exit}${row.signal ? ' (signal ' + row.signal + ')' : ''}`);
    console.log(`Duration: ${row.seconds.toFixed(3)}s\nRecent output:`);
    console.log(row.outputTail.length ? row.outputTail.map(line => '  ' + line).join('\n') : '  (no output)');
  }
  if (interruption) console.log('\nTest run interrupted: ' + interruption);
  console.log('Native skips remain explicit in Python output.');
  console.log('==================================');
  process.exitCode = interruption ? signalExit(interruption) : failed.length ? 1 : 0;
}
