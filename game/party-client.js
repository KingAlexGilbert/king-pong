// One signaling socket, with the existing direct-first WebRTC state machine per guest.
// Gameplay travels over a host-centred star; the signaling worker never sees inputs.
class KingPongParty {
  constructor(baseUrl, hooks) {
    this.baseUrl = baseUrl; this.hooks = hooks; this.peers = new Map(); this.slot = -1;
    this.queue = Promise.resolve(); this.closed = false; this.lan = false;
  }
  open(host, code = '', approval = false) {
    this.host = host;
    try {
      const url = new URL(this.baseUrl);
      if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error();
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = host ? `/v1/party/create/4/${approval ? 1 : 0}/${kingPongClientToken()}` : `/v1/party/join/4/${code}/${kingPongClientToken()}`;
      this.socket = kingPongSignalingSocket(url);
      this.openTimer = setTimeout(() => this.fail('timeout'), 12000);
      this.socket.onopen = () => {
        this.lastPong = Date.now();
        this.heartbeat = setInterval(() => {
          if (Date.now() - this.lastPong > 60000) this.fail('connection_lost');
          else if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('ping');
        }, 20000);
      };
      this.socket.onmessage = e => {
        if (e.data === 'pong') { this.lastPong = Date.now(); return; }
        this.queue = this.queue.then(() => !this.closed && this.receive(JSON.parse(e.data))).catch(() => this.fail('negotiation_failed'));
      };
      this.socket.onclose = this.socket.onerror = () => { this.queue.then(() => this.fail('connection_lost')); };
    } catch { this.fail('unavailable'); }
  }
  send(message) { if (!this.closed && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  link(slot) {
    let link = this.peers.get(slot);
    if (link) return link;
    link = new KingPongRoom(this.baseUrl, {
      status: text => this.hooks.status?.(text, slot), peer() {}, channel() {},
      connected: () => this.hooks.connected?.(slot),
      message: raw => this.hooks.message?.(slot, raw),
      interrupted: () => this.hooks.interrupted?.(slot), resumed: () => this.hooks.resumed?.(slot),
      error: code => this.hooks.peerError?.(slot, code)
    });
    link.role = this.host ? 'host' : 'guest';
    link.send = message => this.send({...message, to: slot, attempt: message.attempt ?? link.attempt});
    link.fail = code => { if (!link.closed) { link.close(); this.hooks.peerError?.(slot, code); } };
    this.peers.set(slot, link); return link;
  }
  async receive(m) {
    if (this.closed) return;
    if (m.type === 'error') return this.fail(m.code);
    if (m.type === 'welcome') {
      if (m.protocol !== 'kp-party-1' || m.capacity !== 4 || m.role !== (this.host ? 'host' : 'guest')) return this.fail('incompatible');
      clearTimeout(this.openTimer); this.code = m.code; this.slot = m.slot; this.hooks.welcome?.(m); return;
    }
    if (m.type === 'approved') { this.slot = m.slot; this.hooks.approved?.(m.slot); return; }
    if (m.type === 'lobby') { this.lobby = m; this.hooks.lobby?.(m); return; }
    if (m.type === 'locked') { this.hooks.locked?.(m.config); return; }
    if (m.type === 'departed') {
      this.peers.get(m.slot)?.close(); this.peers.delete(m.slot); this.hooks.departed?.(m.slot, m.reason); return;
    }
    if (['start', 'description', 'candidate'].includes(m.type) && Number.isInteger(m.from) && m.from >= 0 && m.from < 4 && m.from !== this.slot && (this.host || m.from === 0)) {
      await this.link(m.from).receive(m);
    }
  }
  data(slot, value, reliable = false) {
    const link = this.peers.get(slot), channel = reliable ? link?.control : link?.data;
    if (!link?.connected || channel?.readyState !== 'open' || channel.bufferedAmount > 65536) return false;
    const raw = JSON.stringify(value);
    if (raw.length > 8192) return false;
    try { channel.send(raw); this.sentBytes = (this.sentBytes || 0) + new TextEncoder().encode(raw).length; return true; } catch { return false; }
  }
  broadcast(value, reliable = false) { for (const slot of this.peers.keys()) this.data(slot, value, reliable); }
  close() {
    if (this.closed) return; this.closed = true; clearTimeout(this.openTimer); clearInterval(this.heartbeat);
    for (const link of this.peers.values()) link.close(); this.peers.clear();
    if (this.socket) { this.socket.onclose = this.socket.onerror = this.socket.onopen = this.socket.onmessage = null; this.socket.close(); }
  }
  fail(code) { if (!this.closed) { this.close(); this.hooks.error?.(code); } }
}

// Manual native-style SDP exchange: no server, STUN, TURN, scanning, or permissions.
// Each invitation is a short-lived capability for one host-assigned slot.
class KingPongLanParty extends KingPongParty {
  constructor(hooks) { super('', hooks); this.lan = true; this.pending = new Map(); this.players = []; }
  open(host) {
    this.host = host; this.slot = host ? 0 : -1; this.code = crypto.randomUUID().slice(0, 6).toUpperCase();
    if (host) { this.players = [{slot: 0, ready: false, connected: true, consent: false}]; this.hooks.welcome?.({code: this.code, slot: 0}); this.roster(); }
  }
  send(message) {
    if (['candidate', 'description', 'connected', 'relay'].includes(message.type)) return;
    if (!this.host) { this.data(0, {lanLobby: 1, ...message}, true); return; }
    this.control(this.slot, message);
  }
  link(slot) {
    const link = super.link(slot);
    link.relay = () => link.fail('timeout');
    clearTimeout(link.directTimer);
    return link;
  }
  async gather(link) {
    const peer = link.peer;
    if (peer.iceGatheringState !== 'complete') await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', change); resolve(); };
      const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(finish, 4000); peer.addEventListener('icegatheringstatechange', change);
    });
    clearTimeout(link.directTimer); clearTimeout(link.totalTimer); link.totalTimer = null;
    if (this.host === false || link.role === 'guest') link.totalTimer = setTimeout(() => link.fail('timeout'), 300000);
    if (this.closed || !peer.localDescription) throw Error('connection_lost');
    return peer.localDescription.toJSON();
  }
  encode(value) { return btoa(JSON.stringify(value)); }
  decode(text, type) {
    if (typeof text !== 'string' || text.length > 90000) throw Error('invalid_code');
    let m; try { m = JSON.parse(atob(text.trim())); } catch { throw Error('invalid_code'); }
    if (m?.protocol !== 'kp-lan-four-1' || m.type !== type || !Number.isInteger(m.slot) || m.slot < 1 || m.slot > 3 ||
        !/^[a-f0-9-]{36}$/.test(m.nonce || '') || !/^[A-F0-9]{6}$/.test(m.room || '') || m.description?.type !== (type === 'offer' ? 'offer' : 'answer') ||
        typeof m.description.sdp !== 'string' || m.description.sdp.length > 49152) throw Error('incompatible');
    return m;
  }
  async offer() {
    if (!this.host || this.lobby?.started) throw Error('unauthorized');
    for (const [pendingSlot, invitation] of this.pending) if (Date.now() - invitation.at > 300000) { this.peers.get(pendingSlot)?.close(); this.peers.delete(pendingSlot); this.pending.delete(pendingSlot); }
    const slot = [1, 2, 3].find(s => !this.peers.has(s));
    if (!slot) throw Error('full');
    const nonce = crypto.randomUUID(), link = this.link(slot);
    await link.receive({type: 'start', attempt: 0, iceServers: []});
    const description = await this.gather(link);
    this.pending.set(slot, {nonce, at: Date.now()});
    return this.encode({protocol: 'kp-lan-four-1', type: 'offer', room: this.code, slot, nonce, description});
  }
  async answer(text) {
    if (this.host || this.peers.size) throw Error('unauthorized');
    const m = this.decode(text, 'offer'); this.slot = m.slot; this.code = m.room;
    this.hooks.welcome?.({code: this.code, slot: this.slot});
    const link = this.link(0); await link.receive({type: 'start', attempt: 0, iceServers: []});
    await link.receive({type: 'description', attempt: 0, description: m.description});
    const description = await this.gather(link);
    return this.encode({...m, type: 'answer', description});
  }
  async accept(text) {
    if (!this.host) throw Error('unauthorized');
    const m = this.decode(text, 'answer'), pending = this.pending.get(m.slot), link = this.peers.get(m.slot);
    if (m.room !== this.code || !pending || pending.nonce !== m.nonce || Date.now() - pending.at > 300000 || !link) throw Error('invalid_code');
    this.pending.delete(m.slot);
    await link.receive({type: 'description', attempt: 0, description: m.description});
    if (!link.connected) link.totalTimer = setTimeout(() => { if (!link.connected) link.fail('timeout'); }, 45000);
  }
  joined(slot) {
    if (!this.host) return;
    if (!this.players.some(p => p.slot === slot)) this.players.push({slot, connected: true, ready: false, consent: false});
    this.roster();
  }
  control(slot, m) {
    if (!this.host || !this.players.some(p => p.slot === slot) || this.closed) return;
    const host = slot === 0;
    if (m.type === 'configure' && host && !this.started) {
      this.config = m.config; this.fill = m.fill; this.waitAt = null;
      this.players.forEach(p => { p.ready = p.consent = false; });
    } else if (m.type === 'ready' && !this.started && typeof m.ready === 'boolean' && typeof m.consent === 'boolean') {
      Object.assign(this.players.find(p => p.slot === slot), {ready: m.ready, consent: m.consent});
    } else if (m.type === 'wait' && host && this.config && !this.started) {
      this.waitAt ??= Date.now(); Object.assign(this.players[0], {ready: true, consent: Boolean(this.fill)});
    } else if (m.type === 'lock' && host && !this.started && this.waitAt !== null && this.config && this.players.every(p => p.ready && p.connected) &&
      (this.players.length === 4 || this.fill && Date.now() - this.waitAt >= 180000 && this.players.every(p => p.consent))) {
      this.started = true;
      const config = {...this.config, bots: Array.from({length: 4}, (_, i) => !this.players.some(p => p.slot === i))};
      this.broadcast({lanLobby: 1, type: 'locked', config}, true); this.hooks.locked?.(config);
    } else if (m.type === 'kick' && host && m.slot > 0) { this.drop(m.slot, 'kicked'); return; }
    else return;
    this.roster();
  }
  drop(slot, reason) {
    if (!this.host) { this.fail(reason); return; }
    this.data(slot, {lanLobby: 1, type: 'error', code: reason}, true);
    const link = this.peers.get(slot); this.peers.delete(slot); this.pending.delete(slot);
    this.players = this.players.filter(p => p.slot !== slot);
    // Give the ordered disconnect notice a chance to flush before closing the link.
    setTimeout(() => link?.close(), 100);
    this.broadcast({lanLobby: 1, type: 'departed', slot, reason}, true); this.hooks.departed?.(slot, reason); this.roster();
  }
  roster() {
    this.lobby = {type: 'lobby', players: this.players, capacity: 4, fill: Boolean(this.fill), waitAt: this.waitAt ?? null,
      botAfter: 180000, config: this.config || null, started: Boolean(this.started), pending: []};
    this.broadcast({lanLobby: 1, ...this.lobby}, true); this.hooks.lobby?.(this.lobby);
  }
}
