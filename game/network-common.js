// No addresses or credentials are retained by the optional route indicator.
let kingPongVolatileToken = null;
function kingPongClientToken() {
  if (kingPongVolatileToken) return kingPongVolatileToken;
  try {
    const token = sessionStorage.getItem('king-pong-room-token');
    kingPongVolatileToken = /^[a-f0-9-]{36}$/.test(token || '') ? token : crypto.randomUUID();
    if (kingPongVolatileToken !== token) sessionStorage.setItem('king-pong-room-token', kingPongVolatileToken);
    return kingPongVolatileToken;
  } catch { return kingPongVolatileToken ||= crypto.randomUUID(); }
}
function kingPongRoute(stats) {
  const entries = [...stats.values()];
  const transport = entries.find(s => s.type === 'transport' && s.selectedCandidatePairId);
  let pair = transport && stats.get(transport.selectedCandidatePairId);
  if (!pair) {
    const selected = entries.filter(s => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated);
    if (selected.length === 1) pair = selected[0];
  }
  if (!pair || pair.state !== 'succeeded') return 'Unknown';
  const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
  if (!local || !remote) return 'Unknown';
  if ([local, remote].some(c => c.candidateType === 'relay')) return 'TURN Relay';
  if ([local, remote].some(c => ['srflx', 'prflx'].includes(c.candidateType))) return 'Direct (Internet)';
  if (local.candidateType !== 'host' || remote.candidateType !== 'host') return 'Unknown';
  const privateAddress = address => {
    if (typeof address !== 'string') return false;
    const s = address.toLowerCase();
    if (/^(fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/.test(s)) return true;
    const parts = s.split('.').map(Number);
    return /^\d+\.\d+\.\d+\.\d+$/.test(s) && parts.every(n => n >= 0 && n < 256) &&
      (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 169 && parts[1] === 254);
  };
  if (privateAddress(local.address) && privateAddress(remote.address)) return 'Direct (Local)';
  // Redacted/mDNS candidates, VPNs, and loopback cannot establish local-network proximity.
  const publicAddress = a => typeof a === 'string' && (/^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith('127.') && a !== '0.0.0.0' || /^[23][0-9a-f]{3}:/i.test(a));
  return [local, remote].every(c => publicAddress(c.address) && !privateAddress(c.address)) ? 'Direct (Internet)' : 'Unknown';
}
class KingPongInputGate {
  constructor() { this.seq = -1; this.tokens = 240; this.at = null; this.dropped = 0; }
  accept(seq, now) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq <= this.seq || !Number.isFinite(now)) { this.dropped++; return false; }
    if (this.at !== null) this.tokens = Math.min(240, this.tokens + Math.max(0, now - this.at) * .12);
    this.at = now;
    if (this.tokens < 1) { this.dropped++; return false; }
    this.tokens--; this.seq = seq; return true;
  }
}
