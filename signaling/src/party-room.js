// Private two/four-player rooms share the existing ROOMS Durable Object binding.
// Classic /v1 rooms and the two-player matchmaking queue are untouched.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STUN = [{urls: 'stun:stun.cloudflare.com:3478'}];
const LEASE = 75_000, LIFE = 2 * 60 * 60_000;
const SLOT = n => Number.isInteger(n) && n >= 0 && n < 4;
const send = (socket, value) => { try { socket.send(JSON.stringify(value)); } catch {} };
function error(code) {
  const {0: client, 1: server} = new WebSocketPair(); server.accept();
  send(server, {type: 'error', code}); server.close(1000, 'Room unavailable');
  return new Response(null, {status: 101, webSocket: client});
}
function code() { return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => ALPHABET[n % 32]).join(''); }
export async function partyRequest(url, env) {
  const create = url.pathname.match(/^\/v1\/party\/create\/([24])\/([01])\/([a-f0-9-]{36})$/);
  const join = url.pathname.match(/^\/v1\/party\/join\/([24])\/([A-HJ-NP-Z2-9]{6})\/([a-f0-9-]{36})$/);
  if (url.search || (!create && !join)) return error('incompatible');
  try {
    for (let i = 0; i < 5; i++) {
      const roomCode = create ? code() : join[2], capacity = Number((create || join)[1]);
      const token = (create || join)[3];
      const path = `/party/${create ? 'create' : 'join'}/${roomCode}/${capacity}/${create ? create[2] : '0'}/${token}`;
      const response = await env.ROOMS.get(env.ROOMS.idFromName('party:' + roomCode))
        .fetch('https://room' + path, {headers: {Upgrade: 'websocket'}});
      if (create && response.status === 409) continue;
      return response;
    }
  } catch {}
  return error('unavailable');
}

export class PartyRoom {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  sockets() { return this.ctx.getWebSockets().filter(s => { const a = s.deserializeAttachment(); return a?.party && !a.closed; }); }
  approved() { return this.sockets().filter(s => s.deserializeAttachment().slot >= 0); }
  at(slot) { return this.approved().find(s => s.deserializeAttachment().slot === slot); }
  async save(room) { await this.ctx.storage.put('party-room', room); }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const [, , action, code, capacityText, approval, token] = new URL(request.url).pathname.split('/');
      const capacity = Number(capacityText);
      if (!['create', 'join'].includes(action) || ![2, 4].includes(capacity) || !/^[a-f0-9-]{36}$/.test(token || '')) return error('incompatible');
      let room = await this.ctx.storage.get('party-room');
      if (room && room.expiresAt <= Date.now()) { await this.end('expired'); room = null; }
      let slot = 0;
      if (action === 'create') {
        if (room || this.sockets().length) return new Response(null, {status: 409});
        room = {code, capacity, approval: approval === '1', expiresAt: Date.now() + LIFE,
          blocked: [], peers: {}, started: false, fill: false, waitAt: null, config: null};
      } else {
        if (!room || !this.at(0)) return error('not_found');
        if (room.capacity !== capacity) return error('wrong_mode');
        if (room.blocked.includes(token)) return error('blocked');
        if (room.started || this.approved().length >= room.capacity || this.sockets().length >= room.capacity + 4) return error('full');
        if (this.sockets().some(s => s.deserializeAttachment().token === token)) return error('full');
        slot = room.approval ? -1 : this.freeSlot(room);
      }
      const {0: client, 1: server} = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({party: true, token, slot, request: crypto.randomUUID(), joinedAt: Date.now(),
        count: 0, windowAt: Date.now(), connected: slot === 0, ready: false, consent: false});
      await this.save(room);
      await this.ctx.storage.setAlarm(Math.min(room.expiresAt, Date.now() + 30_000));
      send(server, {type: 'welcome', role: slot === 0 ? 'host' : 'guest', code, capacity, slot, pending: slot < 0, protocol: 'kp-party-1'});
      if (slot > 0) await this.connect(room, slot);
      this.roster(room);
      return new Response(null, {status: 101, webSocket: client});
    });
  }
  freeSlot(room) {
    for (let i = 1; i < room.capacity; i++) if (!this.at(i)) return i;
    return -1;
  }
  roster(room) {
    const players = this.approved().map(s => {
      const a = s.deserializeAttachment(); return {slot: a.slot, ready: a.ready, connected: a.connected, consent: a.consent};
    }).sort((a, b) => a.slot - b.slot);
    const pending = this.sockets().filter(s => s.deserializeAttachment().slot < 0)
      .map(s => ({request: s.deserializeAttachment().request}));
    for (const s of this.sockets()) {
      const a = s.deserializeAttachment();
      send(s, {type: 'lobby', players, capacity: room.capacity, fill: room.fill, waitAt: room.waitAt,
        botAfter: 180000, config: room.config, started: room.started, ...(a.slot === 0 ? {pending} : {})});
    }
  }
  async connect(room, slot) {
    room.peers[slot] = {attempt: 0, host: false, guest: false};
    await this.save(room);
    const guest = this.at(slot), host = this.at(0);
    if (!guest || !host) return;
    send(host, {type: 'start', from: slot, attempt: 0, iceServers: STUN});
    send(guest, {type: 'start', from: 0, attempt: 0, iceServers: STUN});
  }
  message(socket, raw) {
    return this.ctx.blockConcurrencyWhile(() => this.receive(socket, raw));
  }
  async receive(socket, raw) {
    const a = socket.deserializeAttachment();
    if (!a || a.closed) return;
    const room = await this.ctx.storage.get('party-room');
    if (!room || room.expiresAt <= Date.now()) return this.end('expired');
    if (typeof raw !== 'string' || raw.length > 65536) return this.remove(socket, room, 'negotiation_failed');
    if (Date.now() - a.windowAt > 10000) { a.windowAt = Date.now(); a.count = 0; }
    // Host negotiates three peers. Gameplay never crosses this WebSocket.
    if (++a.count > (a.slot === 0 ? 480 : 160)) return this.remove(socket, room, 'rate_limited');
    socket.serializeAttachment(a);
    let m;
    try { m = JSON.parse(raw); } catch { return this.remove(socket, room, 'negotiation_failed'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return this.remove(socket, room, 'negotiation_failed');
    if (a.slot < 0) return this.remove(socket, room, 'unapproved');
    if (m.type === 'approve' || m.type === 'reject' || m.type === 'kick') {
      if (a.slot !== 0) return this.remove(socket, room, 'unauthorized');
      const target = m.type === 'kick' ? SLOT(m.slot) && m.slot !== 0 && this.at(m.slot) :
        this.sockets().find(s => s.deserializeAttachment().slot < 0 && s.deserializeAttachment().request === m.request);
      if (!target) return;
      if (m.type !== 'approve') return this.remove(target, room, m.type === 'kick' ? 'kicked' : 'rejected', true);
      if (room.started) return this.remove(target, room, 'full');
      const slot = this.freeSlot(room);
      if (slot < 0) return this.remove(target, room, 'full');
      target.serializeAttachment({...target.deserializeAttachment(), slot});
      send(target, {type: 'approved', slot});
      await this.connect(room, slot); this.roster(room); return;
    }
    if (m.type === 'configure') {
      if (a.slot !== 0 || room.started || room.capacity !== 4 || !validRoomConfig(m.config) || typeof m.fill !== 'boolean') return;
      room.config = {variant: m.config.variant, lives: m.config.lives, goal: m.config.goal, difficulty: m.config.difficulty,
        powerups: m.config.powerups, hiddenWall: m.config.hiddenWall};
      room.fill = m.fill; room.waitAt = null;
      for (const s of this.approved()) s.serializeAttachment({...s.deserializeAttachment(), ready: false, consent: false});
      await this.save(room); this.roster(room); return;
    }
    if (m.type === 'ready' && !room.started && typeof m.ready === 'boolean' && typeof m.consent === 'boolean') {
      socket.serializeAttachment({...a, ready: m.ready, consent: m.consent}); this.roster(room); return;
    }
    if (m.type === 'wait' && a.slot === 0 && !room.started && room.config) {
      room.waitAt ??= Date.now();
      socket.serializeAttachment({...a, ready: true, consent: room.fill});
      await this.save(room); this.roster(room); return;
    }
    if (m.type === 'lock' && a.slot === 0 && !room.started && room.config && room.waitAt !== null) {
      const players = this.approved().map(s => s.deserializeAttachment());
      if (!players.every(p => p.connected && p.ready)) return;
      if (players.length < 4 && !(room.fill && Date.now() - room.waitAt >= 180000 && players.every(p => p.consent))) return;
      room.started = true; await this.save(room);
      for (const pending of this.sockets().filter(s => s.deserializeAttachment().slot < 0)) await this.remove(pending, room, 'full');
      const config = {...room.config, bots: Array.from({length: 4}, (_, i) => !players.some(p => p.slot === i))};
      for (const s of this.approved()) send(s, {type: 'locked', config});
      this.roster(room); return;
    }
    if (!['description', 'candidate', 'relay', 'connected'].includes(m.type) || !SLOT(m.to) || m.to === a.slot ||
        (a.slot !== 0 && m.to !== 0)) return this.remove(socket, room, 'unauthorized');
    const other = this.at(m.to), slot = a.slot === 0 ? m.to : a.slot, pair = room.peers[slot];
    if (!other || !pair) return;
    if (m.type === 'relay') {
      if (pair.attempt || room.started || (pair.host && pair.guest)) return;
      pair.attempt = 1; pair.host = pair.guest = false; await this.save(room);
      try {
        const response = await this.env.TURN_CREDENTIALS.get(this.env.TURN_CREDENTIALS.idFromName('metered')).fetch('https://turn/ice');
        if (!response.ok) throw Error();
        const iceServers = await response.json();
        const host = this.at(0), guest = this.at(slot);
        if (!host || !guest) return;
        send(host, {type: 'start', from: slot, attempt: 1, iceServers});
        send(guest, {type: 'start', from: 0, attempt: 1, iceServers});
      } catch { const guest = this.at(slot); if (guest) await this.remove(guest, room, 'relay_unavailable'); }
      return;
    }
    if (m.attempt !== pair.attempt) return;
    if (m.type === 'connected') {
      pair[a.slot === 0 ? 'host' : 'guest'] = true;
      if (pair.host && pair.guest) {
        const guest = this.at(slot); guest.serializeAttachment({...guest.deserializeAttachment(), connected: true});
        if (room.capacity === 2) room.started = true;
      }
      await this.save(room); this.roster(room); return;
    }
    if (m.type === 'description') {
      const d = m.description, type = a.slot === 0 ? 'offer' : 'answer';
      if (!d || d.type !== type || typeof d.sdp !== 'string' || d.sdp.length > 49152) return this.remove(socket, room, 'negotiation_failed');
      send(other, {type: 'description', from: a.slot, attempt: pair.attempt, description: {type, sdp: d.sdp}});
    } else {
      const c = m.candidate;
      if (!c || typeof c.candidate !== 'string' || c.candidate.length > 2048 ||
          !(c.sdpMid === null || typeof c.sdpMid === 'string' && c.sdpMid.length <= 256) ||
          !(c.sdpMLineIndex === null || Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 16))
        return this.remove(socket, room, 'negotiation_failed');
      send(other, {type: 'candidate', from: a.slot, attempt: pair.attempt,
        candidate: {candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex}});
    }
  }
  async remove(socket, room, reason, block = false) {
    const a = socket.deserializeAttachment();
    if (!a || a.closed) return;
    if (a.slot === 0) return this.end(reason === 'kicked' ? 'host_left' : reason);
    if (block && room.blocked.length < 128 && !room.blocked.includes(a.token)) room.blocked.push(a.token);
    socket.serializeAttachment({...a, closed: true});
    send(socket, {type: 'error', code: reason});
    try { socket.close(1000, 'Room membership ended'); } catch {}
    if (a.slot >= 0) {
      delete room.peers[a.slot];
      for (const s of this.approved()) send(s, {type: 'departed', slot: a.slot, reason});
    }
    await this.save(room); this.roster(room);
  }
  async close(socket) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const a = socket.deserializeAttachment();
      if (!a || a.closed) return;
      const room = await this.ctx.storage.get('party-room');
      if (!room) return;
      if (a.slot === 0) await this.end('host_left');
      else await this.remove(socket, room, 'guest_left');
    });
  }
  async end(reason) {
    for (const s of this.sockets()) {
      s.serializeAttachment({...s.deserializeAttachment(), closed: true});
      send(s, {type: 'error', code: reason}); try { s.close(1000, 'Room ended'); } catch {}
    }
    await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll();
  }
  async alarm() {
    const room = await this.ctx.storage.get('party-room');
    if (!room || room.expiresAt <= Date.now()) return this.end('expired');
    for (const s of this.sockets()) {
      const a = s.deserializeAttachment();
      const seen = this.ctx.getWebSocketAutoResponseTimestamp(s)?.getTime() || a.joinedAt;
      if (Date.now() - seen > LEASE || a.slot < 0 && Date.now() - a.joinedAt > LEASE) {
        if (a.slot === 0) return this.end('host_left');
        await this.remove(s, room, a.slot < 0 ? 'approval_timeout' : 'guest_left');
      }
    }
    await this.ctx.storage.setAlarm(Math.min(room.expiresAt, Date.now() + 30_000));
  }
}
function validRoomConfig(c) {
  return !!c && ['ffa', 'teams'].includes(c.variant) && [3, 5, 10].includes(c.lives) && [5, 10, 20].includes(c.goal) &&
    ['easy', 'normal', 'hard'].includes(c.difficulty) && typeof c.powerups === 'boolean' && typeof c.hiddenWall === 'boolean';
}
