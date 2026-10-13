// Optional online wire format 1. JSON tuples remove field names, not state.
// Every snapshot is independently decodable: no delta baseline, quantized physics,
// indexed paddle IDs, or dependency on delivery order across the two channels.
const ONLINE_WIRE_VERSION = 1;
const ONLINE_WIRE_FIELDS = Object.freeze({
  selection: ['arena', 'left', 'right'], rules: ['id', 'revision'],
  ball: ['x', 'y', 'vx', 'vy', 'lastScored', 'rallyLaunchFramesRemaining',
    'rallyLaunchTargetSpeed', 'rallySpawnPulseX', 'rallySpawnPulseY'],
  split: ['x', 'y', 'vx', 'vy', 'rush'], pickup: ['type', 'x', 'y', 'ttl'],
  hit: ['seq', 'y', 'ttl'], pulse: ['x', 'y', 'remaining'], cue: ['seq', 'kind', 'type', 'age'],
  hazard: ['id', 'x', 'y', 'hitFlash']
});

function encodeOnlineWire(m) {
  const pack = (kind, value) => value === null ? null : ONLINE_WIRE_FIELDS[kind].map(k => value[k]);
  const head = ['kp', ONLINE_WIRE_VERSION, m.type === 'input' ? 'i' : 's', m.room, m.seq];
  if (m.type === 'input') return [...head, m.axis, m.targetY];
  if (m.type !== 'state') return m;
  const r = m.royal;
  return [...head, m.tick, m.inputSeq, pack('selection', m.selection), pack('rules', m.rules),
    [m.activeCampaign, m.levelIndex, m.leftY, m.rightY, m.leftScore, m.rightScore], pack('ball', m.ball),
    [m.paused, m.waitingForServe, m.gameOver, m.levelCleared, m.campaignCleared], m.resumeCountdownMs,
    [r.rally, r.rush, pack('split', r.split), pack('pickup', r.pickup), [r.guards.left, r.guards.right],
      [pack('hit', r.guardHits.left), pack('hit', r.guardHits.right)], pack('pulse', r.powerupPulse),
      r.cueSeq, r.cues.map(c => pack('cue', c))],
    m.hazards.map(h => pack('hazard', h)), m.endMessage];
}

function decodeOnlineWire(a) {
  const tuple = (v, n) => Array.isArray(v) && v.length === n;
  if (!Array.isArray(a) || a[0] !== 'kp' || a[1] !== ONLINE_WIRE_VERSION) return null;
  const m = {v: LAN_SIGNAL_VERSION, gameplay: 'royal', matchRules: 'presets', room: a[3], seq: a[4]};
  if (a[2] === 'i' && tuple(a, 7)) return {...m, type: 'input', axis: a[5], targetY: a[6]};
  if (a[2] !== 's' || !tuple(a, 16) || !tuple(a[9], 6) || !tuple(a[11], 5) ||
      !tuple(a[13], 9) || !tuple(a[13][4], 2) || !tuple(a[13][5], 2) ||
      !Array.isArray(a[13][8]) || a[13][8].length > 16 || !Array.isArray(a[14]) || a[14].length > 128) return null;
  // Shape errors are rejected here; the existing gameplay validators then enforce
  // types, ranges, rules, arena consistency, sequence order and host authority.
  let valid = true;
  const unpack = (kind, value, nullable = false) => {
    if (nullable && value === null) return null;
    const fields = ONLINE_WIRE_FIELDS[kind];
    if (!tuple(value, fields.length)) { valid = false; return null; }
    return Object.fromEntries(fields.map((k, i) => [k, value[i]]));
  };
  const p = a[9], flags = a[11], r = a[13];
  Object.assign(m, {type: 'state', tick: a[5], inputSeq: a[6], selection: unpack('selection', a[7]),
    rules: unpack('rules', a[8]), activeCampaign: p[0], levelIndex: p[1], leftY: p[2], rightY: p[3],
    leftScore: p[4], rightScore: p[5], ball: unpack('ball', a[10]), paused: flags[0],
    waitingForServe: flags[1], gameOver: flags[2], levelCleared: flags[3], campaignCleared: flags[4],
    resumeCountdownMs: a[12], royal: {rally: r[0], rush: r[1], split: unpack('split', r[2], true),
      pickup: unpack('pickup', r[3], true), guards: {left: r[4][0], right: r[4][1]},
      guardHits: {left: unpack('hit', r[5][0], true), right: unpack('hit', r[5][1], true)},
      powerupPulse: unpack('pulse', r[6], true), cueSeq: r[7], cues: r[8].map(c => unpack('cue', c))},
    hazards: a[14].map(h => unpack('hazard', h)), endMessage: a[15]});
  return valid ? m : null;
}

let onlineWireReady = false;
let onlineWireAttempts = 0;
let onlineWireHelloAt = -Infinity;
let onlineLastInput = null;
let onlineInputAck = -1;

function resetOnlineWire() {
  onlineWireReady = false;
  onlineWireAttempts = 0;
  onlineWireHelloAt = -Infinity;
  onlineLastInput = null;
  onlineInputAck = -1;
}

function sendOnlineWireHello(ack = false) {
  return onlineLanSend({v: LAN_SIGNAL_VERSION, type: 'net-format', room: lanRoomCode,
    format: ONLINE_WIRE_VERSION, ack});
}

function negotiateOnlineWire() {
  // A peer may open its channels a little later. Retry without adding timers.
  // Older clients ignore the extension and continue using validated legacy JSON.
  if (onlineWireReady || onlineWireAttempts >= 4 || performance.now() - onlineWireHelloAt < 500) return;
  if (sendOnlineWireHello()) { onlineWireAttempts++; onlineWireHelloAt = performance.now(); }
}

function receiveOnlineWireHello(m) {
  if (!onlineSession || !lanRoomCode || m.v !== LAN_SIGNAL_VERSION || m.room !== lanRoomCode ||
      m.gameplay !== 'royal' || m.matchRules !== 'presets' || m.format !== ONLINE_WIRE_VERSION ||
      typeof m.ack !== 'boolean') return;
  if (m.ack) onlineWireReady = true;
  else sendOnlineWireHello(true);
}
