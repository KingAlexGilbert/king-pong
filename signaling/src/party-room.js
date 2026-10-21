import { SecureRoomTransport } from './secure-relay.js';
// Private two-player rooms share the existing ROOMS Durable Object binding.
// Classic /v1 rooms and the two-player matchmaking queue are untouched.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STUN = [{urls: 'stun:stun.cloudflare.com:3478'}];
const LEASE = 75_000, LIFE = 2 * 60 * 60_000;
const SLOT = n => n === 0 || n === 1;
const send = (socket, value) => { try { socket.send(JSON.stringify(value)); } catch {} };
function error(code) {
  const {0: client, 1: server} = new WebSocketPair(); server.accept();
  send(server, {type: 'error', code}); server.close(1000, 'Room unavailable');
  return new Response(null, {status: 101, webSocket: client});
}
function code() { return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => ALPHABET[n % 32]).join(''); }
export async function partyRequest(url, env) {
  const create = url.pathname.match(/^\/v1\/party\/create\/(2)\/([01])\/([a-f0-9-]{36})(?:\/(sas[12]))?$/);
  const join = url.pathname.match(/^\/v1\/party\/join\/(2)\/([A-HJ-NP-Z2-9]{6})\/([a-f0-9-]{36})(?:\/(sas[12]))?$/);
  if (url.search || (!create && !join)) return error('incompatible');
  try {
    for (let i = 0; i < 5; i++) {
      const roomCode = create ? code() : join[2], capacity = Number((create || join)[1]);
      const token = (create || join)[3];
      const path = `/party/${create ? 'create' : 'join'}/${roomCode}/${capacity}/${create ? create[2] : '0'}/${token}/${(create || join)[4] || ''}`;
      const response = await env.ROOMS.get(env.ROOMS.idFromName('party:' + roomCode))
        .fetch('https://room' + path, {headers: {Upgrade: 'websocket'}});
      if (create && response.status === 409) continue;
      return response;
    }
  } catch {}
  return error('unavailable');
}

export class PartyRoom {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.secure = new SecureRoomTransport(ctx,env); }
  sockets() { return this.ctx.getWebSockets().filter(s => { const a = s.deserializeAttachment(); return a?.party && !a.closed; }); }
  approved() { return this.sockets().filter(s => s.deserializeAttachment().slot >= 0); }
  at(slot) { return this.approved().find(s => s.deserializeAttachment().slot === slot); }
  async save(room) { await this.ctx.storage.put('party-room', room); }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const [, , action, code, capacityText, approval, token, verification] = new URL(request.url).pathname.split('/');
      const capacity = Number(capacityText);
      if (!['create', 'join'].includes(action) || capacity !== 2 || !/^[a-f0-9-]{36}$/.test(token || '')) return error('incompatible');
      let room = await this.ctx.storage.get('party-room');
      if (room && room.expiresAt <= Date.now()) { await this.end('expired'); room = null; }
      let slot = 0;
      if (action === 'create') {
        if (room || this.sockets().length) return new Response(null, {status: 409});
        room = {code, capacity, approval: approval === '1', verification: approval === '1' && /^sas[12]$/.test(verification), expiresAt: Date.now() + LIFE,
          blocked: [], peers: {}, started: false};
      } else {
        if (!room || !this.at(0)) return error('not_found');
        if (room.capacity !== capacity) return error('wrong_mode');
        if (room.verification && !/^sas[12]$/.test(verification)) return error('incompatible');
        if (room.blocked.length >= 128) return error('full');
        if (room.blocked.includes(token)) return error('blocked');
        if (room.started || this.approved().length >= room.capacity || this.sockets().length >= room.capacity + 3) return error('full');
        if (this.sockets().some(s => s.deserializeAttachment().token === token)) return error('full');
        slot = room.approval ? -1 : this.freeSlot(room);
      }
      const {0: client, 1: server} = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({party: true, secureCapable: verification === 'sas2', token, slot, request: crypto.randomUUID(), joinedAt: Date.now(),
        count: 0, windowAt: Date.now(), connected: slot === 0});
      await this.save(room);
      await this.ctx.storage.setAlarm(Math.min(room.expiresAt, Date.now() + 30_000));
      send(server, {type: 'welcome', role: slot === 0 ? 'host' : 'guest', code, capacity, slot, pending: slot < 0, approval: room.approval, verification: room.verification ? 'sas1' : null, request: slot < 0 ? server.deserializeAttachment().request : undefined, transportVersion:1, protocol: 'kp-party-1'});
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
      const a = s.deserializeAttachment(); return {slot: a.slot, connected: a.connected};
    }).sort((a, b) => a.slot - b.slot);
    const pending = this.sockets().filter(s => s.deserializeAttachment().slot < 0)
      .map(s => ({request: s.deserializeAttachment().request}));
    for (const s of this.sockets()) {
      const a = s.deserializeAttachment();
      send(s, {type: 'lobby', players, capacity: 2, started: room.started, ...(a.slot === 0 ? {pending} : {})});
    }
  }
  async connect(room, slot) {
    room.peers[slot] = {attempt: 0, host: false, guest: false, request: this.at(slot)?.deserializeAttachment().request};
    await this.save(room);
    const guest = this.at(slot), host = this.at(0);
    if (!guest || !host) return;
    if (host.deserializeAttachment().secureCapable && guest.deserializeAttachment().secureCapable) {
      await this.secure.begin([host,guest], async state=>{room.peers[slot].secure=state; await this.save(room);}); return;
    }
    send(host, {type: 'start', from: slot, attempt: 0, iceServers: STUN, ...(room.verification ? {verification:'sas1',request:room.peers[slot].request} : {})});
    send(guest, {type: 'start', from: 0, attempt: 0, iceServers: STUN, ...(room.verification ? {verification:'sas1',request:room.peers[slot].request} : {})});
  }
  message(socket, raw) {
    return this.ctx.blockConcurrencyWhile(() => this.receive(socket, raw));
  }
  async receive(socket, raw) {
    const a = socket.deserializeAttachment();
    if (!a || a.closed) return;
    if (typeof raw === 'string' && raw.length <= 24000 && /^\{"type":"secure-(frame|credit)"/.test(raw)) {
      let packet; try { packet=JSON.parse(raw); } catch {
        const room=await this.ctx.storage.get('party-room');
        if(room)await this.remove(socket,room,'negotiation_failed');return;
      }
      if (this.secure.frame(socket,packet)) return;
      const room=await this.ctx.storage.get('party-room'); if(room) await this.remove(socket,room,'unauthorized'); return;
    }
    const room = await this.ctx.storage.get('party-room');
    if (!room || room.expiresAt <= Date.now()) return this.end('expired');
    if (typeof raw !== 'string' || raw.length > 65536) return this.remove(socket, room, 'negotiation_failed');
    if (Date.now() - a.windowAt > 10000) { a.windowAt = Date.now(); a.count = 0; }
    // Signaling has its own budget; encrypted gameplay uses the bounded fast path above.
    if (++a.count > (a.slot === 0 || a.secure ? 480 : 160)) return this.remove(socket, room, 'rate_limited');
    socket.serializeAttachment(a);
    let m;
    try { m = JSON.parse(raw); } catch { return this.remove(socket, room, 'negotiation_failed'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return this.remove(socket, room, 'negotiation_failed');
    if (m.type === 'approval-pair') return this.approvalMessage(socket, a, room, m);
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
      const pending = target.deserializeAttachment();
      if (Date.now() - pending.joinedAt > LEASE) return this.remove(target, room, 'approval_timeout');
      if (room.verification && (!pending.verification?.hostReady || !pending.verification?.guestReady)) return;
      target.serializeAttachment({...pending, slot, verification: null});
      const approved = {type:'approved', slot, request:pending.request};
      send(target, approved); if (room.verification) send(this.at(0), approved);
      for (const other of this.sockets()) if (other.deserializeAttachment().slot < 0) await this.remove(other, room, 'full');
      await this.connect(room, slot); this.roster(room); return;
    }
    if (m.type === 'secure') {
      const pair=room.peers[1];
      return this.secure.control(socket,m,pair?.secure,async state=>{pair.secure=state;await this.save(room);},
        reason=>this.remove(socket,room,reason),async()=>{room.started=true;const guest=this.at(1);if(guest)guest.serializeAttachment({...guest.deserializeAttachment(),connected:true});await this.save(room);this.roster(room);});
    }
    if (room.peers[1]?.secure) return this.remove(socket,room,'incompatible');
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
        send(host, {type: 'start', from: slot, attempt: 1, iceServers, ...(room.verification ? {verification:'sas1',request:pair.request} : {})});
        send(guest, {type: 'start', from: 0, attempt: 1, iceServers, ...(room.verification ? {verification:'sas1',request:pair.request} : {})});
      } catch { const guest = this.at(slot); if (guest) await this.remove(guest, room, 'relay_unavailable'); }
      return;
    }
    if (m.attempt !== pair.attempt) return;
    if (m.type === 'connected') {
      pair[a.slot === 0 ? 'host' : 'guest'] = true;
      if (pair.host && pair.guest) {
        const guest = this.at(slot); guest.serializeAttachment({...guest.deserializeAttachment(), connected: true});
        room.started = true;
      }
      await this.save(room); this.roster(room); return;
    }
    if (m.type === 'description') {
      const d = m.description, type = a.slot === 0 ? 'offer' : 'answer';
      if (!d || d.type !== type || typeof d.sdp !== 'string' || d.sdp.length > 49152) return this.remove(socket, room, 'negotiation_failed');
      if (room.verification && !/^[a-f0-9]{64}$/.test(d.approvalMac || '')) return this.remove(socket, room, 'negotiation_failed');
      send(other, {type: 'description', from: a.slot, attempt: pair.attempt, description: {type, sdp: d.sdp, ...(room.verification ? {approvalMac:d.approvalMac} : {})}});
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
  async approvalMessage(socket, a, room, m) {
    if (!room.verification || room.started || !/^[a-f0-9-]{36}$/.test(m.request || '') ||
        Object.keys(m).some(k => !['type','request','kind','value'].includes(k))) return this.remove(socket, room, 'unapproved');
    const target = a.slot === 0 ? this.sockets().find(s => {
      const t = s.deserializeAttachment(); return t.slot < 0 && t.request === m.request;
    }) : a.slot < 0 && a.request === m.request ? socket : null;
    if (!target) { if (a.slot !== 0) await this.remove(socket, room, 'unapproved'); return; }
    const t = target.deserializeAttachment();
    if (Date.now() - t.joinedAt > LEASE) return this.remove(target, room, 'approval_timeout');
    const state = t.verification || {}, role = a.slot === 0 ? 'host' : 'guest';
    const fail = () => this.remove(a.slot === 0 ? target : socket, room, 'negotiation_failed');
    state.count = (state.count || 0) + 1; if (state.count > 16) return fail();
    if (m.kind === 'commit') {
      if (!/^[a-f0-9]{64}$/.test(m.value || '') || state[role + 'Commit'] && state[role + 'Commit'] !== m.value) return fail();
      state[role + 'Commit'] = m.value;
    } else if (m.kind === 'reveal') {
      if (!state.hostCommit || !state.guestCommit || state[role + 'Reveal'] ||
          !m.value || !/^04[a-f0-9]{128}$/.test(m.value.key || '') || !/^[a-f0-9]{32}$/.test(m.value.nonce || '') ||
          Object.keys(m.value).length !== 2) return fail();
      state[role + 'Reveal'] = true;
    } else if (m.kind === 'ready') {
      if (!state.hostReveal || !state.guestReveal || m.value !== undefined) return fail();
      state[role + 'Ready'] = true;
    } else return fail();
    target.serializeAttachment({...t, verification:state});
    const other = a.slot === 0 ? target : this.at(0);
    if (other) send(other, {type:'approval-pair',request:m.request,kind:m.kind,...(m.value === undefined ? {} : {value:m.value})});
  }
  async remove(socket, room, reason, block = false) {
    const a = socket.deserializeAttachment();
    if (!a || a.closed) return;
    if (a.slot === 0) return this.end(reason === 'kicked' ? 'host_left' : reason);
    if (block && room.blocked.length < 128 && !room.blocked.includes(a.token)) room.blocked.push(a.token);
    socket.serializeAttachment({...a, closed: true, verification: null});
    send(socket, {type: 'error', code: reason});
    try { socket.close(1000, 'Room membership ended'); } catch {}
    if (a.slot >= 0) {
      const host=this.at(0);if(host){const h=host.deserializeAttachment();host.serializeAttachment({...h,retiredSecureId:h.secure?.id,secure:null});}
      delete room.peers[a.slot];
      room.started = false;
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
      s.serializeAttachment({...s.deserializeAttachment(), closed: true, verification: null});
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
