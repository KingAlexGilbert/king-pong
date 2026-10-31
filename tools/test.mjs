// King Pong test orchestration: bounded dependency-aware parallel scheduler.
// The canonical suite list remains tools/test-suites.mjs; no tests are dropped.
import {spawn} from 'node:child_process';
import {availableParallelism, constants as osConstants, tmpdir} from 'node:os';
import {createWriteStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserSuites, extendedSuites} from './test-suites.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const group = args[0] && !args[0].startsWith('--') ? args[0] : 'standard';
const flags = args.slice(args[0] === group ? 1 : 0);
const permitted = new Set(['list', 'plan', 'live', 'quiet', 'fail-fast']);
const options = new Set(['report', 'only', 'logs', 'history', 'jobs', 'browser-jobs', 'timeout-ms', 'heartbeat-ms']);
const value = name => {
  const matches = flags.filter(flag => flag.startsWith('--' + name + '='));
  if (matches.length > 1) throw new Error('Duplicate --' + name);
  return matches[0]?.slice(name.length + 3);
};
for (const flag of flags) {
  if (!flag.startsWith('--') || !((!flag.includes('=') && permitted.has(flag.slice(2))) ||
        (flag.includes('=') && options.has(flag.slice(2, flag.indexOf('='))))))
    throw new Error('Unknown option: ' + flag);
}
const integer = (name, fallback, minimum, maximum) => {
  const raw = value(name);
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum)
    throw new Error('--' + name + ' must be an integer between ' + minimum + ' and ' + maximum);
  return Number(raw);
};
const jobs = integer('jobs', Math.min(4, Math.max(1, availableParallelism())), 1, 32);
// One browser by default until real repository's fixtures pass concurrent runs.
// Enable independent presentation scripts with --browser-jobs=2 after validation.
const browserJobs = integer('browser-jobs', 1, 1, 16);
const timeoutMs = integer('timeout-ms', 900000, 100, 3600000);
const heartbeatMs = integer('heartbeat-ms', 20000, 100, 120000);
const reportFile = value('report');
const logOption = value('logs');
const historyFile = value('history');
const historicalDurations = new Map();
if (historyFile) {
  const previous = JSON.parse(readFileSync(resolve(historyFile), 'utf8'));
  if (!Array.isArray(previous.results)) throw new Error('--history report must contain results array');
  for (const row of previous.results)
    if (typeof row.id === 'string' && typeof row.seconds === 'number' && Number.isFinite(row.seconds))
      historicalDurations.set(row.id, row.seconds);
}
const only = value('only')?.split(',');
if (only?.some(id => !id)) throw new Error('--only requires comma-separated suite IDs');
// Preserve the original runner's live child output: reporting regression tests
// rely on READY_TO_STOP reaching their parent before triggering cancellation.
// Suite logs remain the authoritative complete output for parallel runs.
const live = flags.includes('--live') || !flags.includes('--quiet');
const failFast = flags.includes('--fail-fast');
const node = process.execPath;
const testFiles = (dir, suffix) => readdirSync(resolve(root, dir)).filter(file => file.endsWith(suffix))
  .sort().map(file => dir + '/' + file);
const fast = [
  {id: 'sync', command: [node, 'tools/sync-gameplay.mjs', '--check'], kind: 'sync'},
  {id: 'javascript', command: [node, '--test', ...testFiles('tests', '.mjs')], kind: 'unit'}
];
const core = [...fast,
  {id: 'python', command: [process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'], kind: 'unit'},
  {id: 'signaling', command: [node, '--test', ...testFiles('signaling/test', '.test.mjs')], kind: 'network'},
  {id: 'worker-build', command: [node, 'node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run'], cwd: 'signaling', kind: 'worker'}
];
// These scripts are presentation/browser exercises, not the multiplayer transport
// or LAN scenarios. The latter are serialized and locked against signaling build.
// Newly added browser scripts are automatically treated as high-risk network suites.
const presentationScripts = new Set([
  'gameplay-browser', 'ui-browser', 'level-select-browser', 'serve-feedback-browser',
  'engineering-browser', 'serve-browser', 'ripple-browser', 'appearance-browser',
  'arena-layout-browser', 'boss-audio-browser', 'campaign-polish-browser',
  'fullscreen-browser', 'powerup-perspective-browser', 'responsive-polish-browser'
]);
const browsers = rows => rows.map(([id, script = id, ...flags]) => ({
  id, command: [node, 'test/' + script + '.mjs', ...flags], cwd: 'signaling',
  kind: presentationScripts.has(script) ? 'presentation' : 'network-browser', script
}));
const browser = browsers(browserSuites), extended = browsers(extendedSuites);
const groups = {fast, core, browser, extended, standard: [...core, ...browser], release: [...core, ...browser, ...extended]};
if (!groups[group]) throw new Error('Unknown group ' + group + '. Use fast, core, browser, extended, standard, release.');
let suites = groups[group];
if (only) {
  for (const id of only) if (!suites.some(suite => suite.id === id)) throw new Error('Unknown suite in ' + group + ': ' + id);
  suites = suites.filter(suite => only.includes(suite.id));
}
const ids = new Set();
for (const suite of suites) {
  if (ids.has(suite.id)) throw new Error('Duplicate suite ID: ' + suite.id);
  ids.add(suite.id);
}
const resources = suite => {
  if (suite.kind === 'network' || suite.kind === 'worker' || suite.kind === 'network-browser')
    return ['signaling-workspace'];
  // Distinct presentation scripts may overlap; variants of a shared script may not.
  if (suite.kind === 'presentation') return ['script:' + suite.script];
  return [];
};
const isBrowser = suite => suite.kind === 'presentation' || suite.kind === 'network-browser';
const displayCommand = command => command.map(arg => /^[\w./:=\\-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(' ');
if (flags.includes('--list') || flags.includes('--plan')) {
  for (const suite of suites) {
    const locks = resources(suite).join(',') || 'none';
    console.log(suite.id + ': ' + suite.command.slice(1).join(' ') +
      (flags.includes('--plan') ? `  [${suite.kind}; locks=${locks}]` : ''));
  }
} else {
  const begun = performance.now();
  const allResults = [];
  const running = new Map();
  const held = new Set();
  const logDir = logOption ? resolve(logOption) : mkdtempSync(join(tmpdir(), 'kingpong-tests-'));
  mkdirSync(logDir, {recursive: true});
  let interruption = null;
  let failure = false;
  const signalExit = sig => 128 + (osConstants.signals[sig] || 1);
  const stopProcess = (proc, signal = 'SIGTERM') => {
    if (!proc?.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-proc.pid, signal);
      else if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal);
    } catch (error) { if (error.code !== 'ESRCH') console.error(error); }
  };
  const onSignal = signal => {
    if (interruption) return;
    interruption = signal;
    for (const entry of running.values()) entry.terminate(signal);
  };
  const sigint = () => onSignal('SIGINT');
  const sigterm = () => onSignal('SIGTERM');
  process.once('SIGINT', sigint);
  process.once('SIGTERM', sigterm);
  const heartbeat = setInterval(() => {
    if (running.size) console.log(`[progress] ${allResults.length}/${suites.length} complete; running: ` +
      [...running].map(([id, data]) => `${id} ${((performance.now() - data.start) / 1000).toFixed(0)}s`).join(', '));
  }, heartbeatMs);
  heartbeat.unref();
  const ordered = () => [...allResults].sort((a, b) => a.index - b.index).map(({index, ...row}) => row);
  const writeReport = () => {
    if (!reportFile) return;
    const path = resolve(reportFile);
    mkdirSync(dirname(path), {recursive: true});
    const temp = path + '.tmp-' + process.pid;
    writeFileSync(temp, JSON.stringify({group, jobs, browserJobs, logDir, results: ordered()}, null, 2) + '\n');
    renameSync(temp, path);
  };
  const run = async (suite, index) => {
    const start = performance.now();
    const logFile = join(logDir, String(index).padStart(2, '0') + '-' + suite.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.log');
    const logger = createWriteStream(logFile);
    // Retain the current runner's expanded failure diagnostics. Browser/Worker
    // assertion stacks frequently contain a large CSS/DOM diff before the error.
    const tail = {stdout: '', stderr: ''};
    const capture = (name, data) => {
      const maxBytes = name === 'stderr' ? 65536 : 8192;
      tail[name] = (tail[name] + data).slice(-maxBytes);
      logger.write(data);
      // Preserve the original runner's byte-contiguous live stream. Splitting
      // arbitrary data chunks into prefixed lines can break handshake markers
      // and test assertions that deliberately emit very long lines.
      if (live) process[name].write(data);
    };
    let launchError = null, timedOut = false, timer, escalation;
    console.log('RUN ' + suite.id);
    const result = await new Promise(resolveExit => {
      let proc;
      try {
        proc = spawn(suite.command[0], suite.command.slice(1), {
          cwd: resolve(root, suite.cwd || '.'),
          stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
          env: {...process.env, WRANGLER_SEND_METRICS: 'false'}
        });
      } catch (error) {
        launchError = error.message;
        capture('stderr', launchError + '\n');
        resolveExit({exit: 1, signal: null});
        return;
      }
      const terminate = signal => {
        stopProcess(proc, signal);
        if (!escalation) {
          escalation = setTimeout(() => stopProcess(proc, 'SIGKILL'), 3000);
          escalation.unref();
        }
      };
      // Main loop inserts the entry before the child has time to exit.
      const existing = running.get(suite.id);
      if (existing) existing.terminate = terminate;
      for (const name of ['stdout', 'stderr']) {
        proc[name].setEncoding('utf8');
        proc[name].on('data', chunk => capture(name, chunk));
      }
      proc.once('error', error => { launchError = error.message; capture('stderr', launchError + '\n'); });
      timer = setTimeout(() => {
        timedOut = true;
        capture('stderr', `TIMEOUT: exceeded ${timeoutMs}ms\n`);
        terminate('SIGTERM');
      }, timeoutMs);
      proc.once('close', (code, signal) => resolveExit({exit: launchError ? 1 : code ?? signalExit(signal), signal}));
    });
    clearTimeout(timer);
    clearTimeout(escalation);
    await new Promise(resolveLog => logger.end(resolveLog));
    const tailLines = (name, count) => tail[name].replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .split(/[\r\n]+/).filter(line => line.trim()).slice(-count).map(line => line.slice(0, 2000));
    const exit = timedOut ? 124 : result.exit;
    const row = {index, id: suite.id, exit, seconds: Number(((performance.now() - start) / 1000).toFixed(3)),
      command: displayCommand(suite.command), argv: suite.command, cwd: resolve(root, suite.cwd || '.'),
      kind: suite.kind, resources: resources(suite), logFile,
      ...(timedOut ? {timedOut: true, timeoutMs} : {}),
      ...(result.signal ? {signal: result.signal} : {}),
      ...(launchError ? {launchError} : {}),
      ...(exit !== 0 ? {outputTail: [...tailLines('stdout', 8),
        ...tailLines('stderr', 60).map(x => '[stderr] ' + x)]} : {})};
    allResults.push(row);
    if (exit) failure = true;
    console.log(`${exit ? 'FAIL' : 'PASS'} ${suite.id} (${row.seconds.toFixed(2)}s)${timedOut ? ' TIMEOUT' : ''}`);
    writeReport();
    return row;
  };
  // Sync is a dependency barrier, not a parallelizable worker. If it fails,
  // don't flood the user with misleading follow-on failures from stale output.
  const syncIdx = suites.findIndex(suite => suite.kind === 'sync');
  if (syncIdx !== -1) {
    const suite = suites[syncIdx];
    running.set(suite.id, {start: performance.now(), terminate: () => {}});
    const row = await run(suite, syncIdx);
    running.delete(suite.id);
    if (row.exit) console.error('Source synchronization failed; dependent suites were not started.');
  }
  const queue = suites.map((suite, index) => ({suite, index})).filter(x => x.suite.kind !== 'sync');
  if (historicalDurations.size) queue.sort((a, b) =>
    (historicalDurations.get(b.suite.id) || 0) - (historicalDurations.get(a.suite.id) || 0) || a.index - b.index);
  const promises = new Map();
  const browserCount = () => [...running.keys()].filter(id => suites.some(s => s.id === id && isBrowser(s))).length;
  while ((queue.length || promises.size) && !interruption) {
    let launched = false;
    if (!(failure && (syncIdx !== -1 && allResults.some(row => row.id === 'sync' && row.exit) || failFast))) {
      for (let i = 0; i < queue.length && promises.size < jobs;) {
        const {suite, index} = queue[i];
        const locks = resources(suite);
        if (locks.some(lock => held.has(lock)) || (isBrowser(suite) && browserCount() >= browserJobs)) {
          i++; continue;
        }
        queue.splice(i, 1);
        launched = true;
        for (const lock of locks) held.add(lock);
        running.set(suite.id, {start: performance.now(), terminate: () => {}});
        const promise = run(suite, index).finally(() => {
          for (const lock of locks) held.delete(lock);
          running.delete(suite.id);
          promises.delete(suite.id);
        });
        promises.set(suite.id, promise);
      }
    }
    if (!promises.size) {
      if (queue.length && !failure && !interruption) throw new Error('Scheduler resource deadlock: ' + queue.map(x => x.suite.id).join(', '));
      break;
    }
    await Promise.race([...promises.values()]);
  }
  if (interruption) await Promise.allSettled([...promises.values()]);
  clearInterval(heartbeat);
  process.removeListener('SIGINT', sigint);
  process.removeListener('SIGTERM', sigterm);
  const rows = ordered(), failed = rows.filter(row => row.exit !== 0);
  console.log('\n========== TEST SUMMARY ==========');
  console.log(`Commands completed: ${rows.length}`);
  console.log(`Passed: ${rows.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  const wall = (performance.now() - begun) / 1000;
  const work = rows.reduce((sum, row) => sum + row.seconds, 0);
  console.log(`Total duration: ${wall.toFixed(3)}s`);
  console.log(`Not run: ${suites.length - rows.length}`);
  console.log(`Cumulative suite time: ${work.toFixed(3)}s; concurrency factor: ${(work / Math.max(wall, .001)).toFixed(2)}x`);
  console.log(`Logs: ${logDir}`);
  console.log('Slowest suites: ' + [...rows].sort((a, b) => b.seconds - a.seconds).slice(0, 5).map(r => `${r.id} ${r.seconds}s`).join(', '));
  for (const row of failed) {
    console.log(`\nFAILED: ${row.id}\nCommand: ${row.command}\nDirectory: ${row.cwd}`);
    console.log(row.launchError ? `Launch error: ${row.launchError}` :
      `Exit code: ${row.exit}${row.signal ? ' (signal ' + row.signal + ')' : ''}` +
      `${row.timedOut ? ' (TIMEOUT)' : ''}; Log: ${row.logFile}`);
    console.log('Recent output:\n' + (row.outputTail?.length ? row.outputTail.map(line => '  ' + line).join('\n') : '  (no output)'));
  }
  if (interruption) console.log('Test run interrupted: ' + interruption);
  console.log('Native skips and detailed per-test output are retained in the suite logs.');
  console.log('==================================');
  writeReport();
  process.exitCode = interruption ? signalExit(interruption) : failed.length || rows.length !== suites.length ? 1 : 0;
}
