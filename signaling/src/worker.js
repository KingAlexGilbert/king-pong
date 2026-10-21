import { SecureRoomTransport } from './secure-relay.js';
import { PartyRoom, partyRequest } from './party-room.js';
export { MeteredTurn } from './metered-turn.js';
export { MatchmakingQueue } from './matchmaking.js';
import { MATCHMAKING_CONTRACT } from './matchmaking-contract.js';
import { signalingBridge } from './native-bridge.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const WAIT_MS = 10 * 60_000;
const SESSION_MS = 2 * 60 * 60_000;
const LEASE_MS = 75_000;

function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), byte => ALPHABET[byte % 32]).join('');
}

function send(socket, message) {
  try { socket.send(JSON.stringify(message)); } catch { /* Close events perform cleanup. */ }
}

function socketError(code) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  send(server, { type: 'error', code });
  server.close(1000, 'Room unavailable');
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/v1/native-bridge' && !url.search) {
      return signalingBridge(url);
    }
    if (request.method === 'GET' && url.pathname === '/v1/turn/ready' && !url.search) {
      if (!(await env.ROOM_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) {
        return Response.json({ ready: false }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
      }
      try {
        return await env.TURN_CREDENTIALS.get(env.TURN_CREDENTIALS.idFromName('metered')).fetch('https://turn/ready');
      } catch {
        return Response.json({ ready: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('King Pong signaling', { status: 426 });
    }
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    // The packaged file:// game uses our narrowly scoped HTTPS signaling bridge.
    // Never allow the opaque "null" origin on signaling endpoints.
    if (!origins.includes(request.headers.get('Origin')) && request.headers.get('Origin') !== url.origin) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!(await env.ROOM_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) {
      return socketError('rate_limited');
    }
    if (url.pathname.startsWith('/v1/party/')) return partyRequest(url, env);
    if (!url.search && url.pathname.startsWith('/v1/queue/')) {
      if (url.pathname !== '/v1/queue/' + MATCHMAKING_CONTRACT.protocol) return socketError('incompatible');
      try {
        const ip = request.headers.get('CF-Connecting-IP') || 'local';
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
        const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        const response = await env.MATCHMAKING.get(env.MATCHMAKING.idFromName('shared'))
          .fetch('https://queue/connect', { headers: { Upgrade: 'websocket', 'X-Queue-IP': key } });
        return response.status === 429 ? socketError('rate_limited') : response;
      } catch { return socketError('unavailable'); }
    }
    const assigned = !url.search && url.pathname.match(/^\/v1\/match\/([a-f0-9-]{36})\/([a-f0-9-]{36})(\/secure1)?$/);
    if (assigned) {
      try {
        return await env.ROOMS.get(env.ROOMS.idFromName('match:' + assigned[1]))
          .fetch('https://room/claim/' + assigned[2] + (assigned[3] || ''), { headers: { Upgrade: 'websocket' } });
      } catch { return socketError('unavailable'); }
    }
    if (url.search || !/^\/v1\/(create|join\/[A-Z0-9]{1,16})$/.test(url.pathname)) {
      return socketError('invalid_code');
    }
    const create = url.pathname === '/v1/create';
    const suppliedCode = url.pathname.split('/').pop();
    if (!create && !CODE.test(suppliedCode)) return socketError('invalid_code');
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = create ? roomCode() : suppliedCode;
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const response = await room.fetch(new Request(`https://room/${create ? 'create' : 'join'}/${code}`, {
          headers: { Upgrade: 'websocket' }
        }));
        if (create && response.status === 409) continue;
        return response;
      }
    } catch { /* Do not forward provider errors or credentials to clients. */ }
    return socketError('unavailable');
  }
};

export class PongRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.party = new PartyRoom(ctx, env);
    this.secure = new SecureRoomTransport(ctx,env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  sockets() {
    return this.ctx.getWebSockets().filter(socket => !socket.deserializeAttachment()?.closed);
  }

  async fetch(request) {
    if (new URL(request.url).pathname.startsWith('/party/')) return this.party.fetch(request);
    // Admission must be atomic even when two guests arrive during a storage await.
    return this.ctx.blockConcurrencyWhile(async () => {
      const [, action, code] = new URL(request.url).pathname.split('/');
      let room = await this.ctx.storage.get('room');
      if (action === 'abort' && request.method === 'POST') {
        if (room?.match && !room.playing) await this.end('opponent_left');
        return new Response(null, { status: 204 });
      }
      if (action === 'reserve' && request.method === 'POST') {
        if (room || this.sockets().length) return new Response(null, { status: 409 });
        const { match, tokens } = await request.json();
        if (match?.protocol !== MATCHMAKING_CONTRACT.protocol || !MATCHMAKING_CONTRACT.arenas.includes(match.arena) ||
            match.rules !== MATCHMAKING_CONTRACT.rules || !tokens?.host || !tokens?.guest) {
          return new Response(null, { status: 400 });
        }
        room = { code: roomCode(), match, tokens, expiresAt: Date.now() + 60_000, relay: false };
        await this.ctx.storage.put('room', room);
        await this.ctx.storage.setAlarm(room.expiresAt);
        return new Response(null, { status: 201 });
      }
      if (room && room.expiresAt <= Date.now()) {
        await this.end('expired');
        room = null;
      }
      const sockets = this.sockets();
      let role;
      if (action === 'claim') {
        if (!room?.match) return socketError('not_found');
        role = code === room.tokens.host ? 'host' : code === room.tokens.guest ? 'guest' : null;
        if (!role) return socketError('not_found');
        if (sockets.some(s => s.deserializeAttachment().role === role)) return socketError('full');
        room.maxAt = Date.now() + SESSION_MS;
      } else if (action === 'create') {
        if (room || sockets.length) return new Response(null, { status: 409 });
        room = { code, expiresAt: Date.now() + WAIT_MS, relay: false };
        role = 'host';
      } else {
        if (action !== 'join' || room?.match) return socketError('not_found');
        if (!room || !sockets.some(s => s.deserializeAttachment().role === 'host')) return socketError('not_found');
        if (sockets.length >= 2) return socketError('full');
        room.maxAt = Date.now() + SESSION_MS;
        room.expiresAt = Date.now() + 60_000;
        role = 'guest';
      }
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role, secureCapable: new URL(request.url).pathname.endsWith('/secure1'), joinedAt: Date.now(), count: 0, windowAt: Date.now(), connected: false });
      await this.ctx.storage.put('room', room);
      await this.ctx.storage.setAlarm(Math.min(room.expiresAt, Date.now() + 60_000));
      send(server, { type: 'welcome', role, code: room.code, transportVersion:1, ...(room.match ? { match: room.match } : {}) });
      if (this.sockets().length === 2) {
        const peers=this.sockets().sort((a,b)=>a.deserializeAttachment().role==='host'?-1:1);
        if(peers.every(s=>s.deserializeAttachment().secureCapable)) await this.secure.begin(peers,async state=>{room.secure=state;await this.ctx.storage.put('room',room);});
        else for (const socket of peers) send(socket, { type: 'start', attempt: 0, iceServers: STUN });
      }
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  webSocketMessage(socket, raw) {
    // No await: membership, epoch, replay budget and forwarding are one atomic
    // turn of this single-threaded object. Rare state changes still close the
    // input gate below, so no frame can interleave with a kick or activation.
    if (typeof raw === 'string' && raw.length <= 24000 && /^\{"type":"secure-(frame|credit)"/.test(raw)) {
      if (socket.deserializeAttachment()?.closed) return;
      let packet, reason = 'unauthorized';
      try { packet = JSON.parse(raw); } catch { reason = 'negotiation_failed'; }
      if (packet && this.secure.frame(socket, packet)) return;
      return this.ctx.blockConcurrencyWhile(async () => {
        if (socket.deserializeAttachment()?.party) {
          const room = await this.ctx.storage.get('party-room');
          if (room) await this.party.remove(socket, room, reason);
        } else await this.end(reason);
      });
    }
    return this.ctx.blockConcurrencyWhile(()=>this.receive(socket,raw));
  }

  async receive(socket, raw) {
    if (socket.deserializeAttachment()?.party) return this.party.receive(socket, raw);
    const attachment = socket.deserializeAttachment();
    if (!attachment || attachment.closed) return;
    if (typeof raw === 'string' && raw.length<=24000 && /^\{"type":"secure-(frame|credit)"/.test(raw)) {
      let packet;try{packet=JSON.parse(raw);}catch{return this.end('negotiation_failed');}
      if(this.secure.frame(socket,packet))return;
      return this.end('unauthorized');
    }
    if (typeof raw !== 'string' || raw.length > 65_536) return this.end('negotiation_failed');
    if (Date.now() - attachment.windowAt > 10_000) {
      attachment.windowAt = Date.now();
      attachment.count = 0;
    }
    if (++attachment.count > (attachment.secure ? 480 : 160)) return this.end('rate_limited');
    socket.serializeAttachment(attachment);
    let message;
    try { message = JSON.parse(raw); } catch { return this.end('negotiation_failed'); }
    if (!message || typeof message !== 'object') return this.end('negotiation_failed');
    const room = await this.ctx.storage.get('room');
    if (!room || room.expiresAt <= Date.now()) return this.end('expired');
    if(message.type==='secure')return this.secure.control(socket,message,room.secure,async state=>{room.secure=state;await this.ctx.storage.put('room',room);},
      reason=>this.end(reason),async()=>{room.playing=true;room.expiresAt=room.maxAt;await this.ctx.storage.put('room',room);});
    if(room.secure)return this.end('incompatible');
    const other = this.sockets().find(s => s !== socket);
    if (message.type === 'relay') {
      if (!other || room.relay || room.playing) return;
      // Persist the one-attempt guard before awaiting the external credential service.
      room.relay = true;
      for (const s of this.sockets()) s.serializeAttachment({ ...s.deserializeAttachment(), connected: false });
      await this.ctx.storage.put('room', room);
      try {
        const sockets = this.sockets();
        const iceServers = await this.turnServers();
        const current = await this.ctx.storage.get('room');
        if (!current || !sockets.every(s => this.sockets().includes(s))) return;
        sockets.forEach(s => send(s, { type: 'start', attempt: 1, iceServers }));
      } catch { await this.end('relay_unavailable'); }
      return;
    }
    if (message.type === 'connected') {
      if (!other) return;
      attachment.connected = true;
      socket.serializeAttachment(attachment);
      if (other.deserializeAttachment().connected) {
        room.expiresAt = room.maxAt;
        room.playing = true;
        await this.ctx.storage.put('room', room);
        await this.ctx.storage.setAlarm(Math.min(room.expiresAt, Date.now() + 60_000));
      }
      return;
    }
    if (!other || message.attempt !== (room.relay ? 1 : 0)) return;
    if (message.type === 'description') {
      const desc = message.description;
      const type = attachment.role === 'host' ? 'offer' : 'answer';
      if (!desc || desc.type !== type || typeof desc.sdp !== 'string' || desc.sdp.length > 49_152) return this.end('negotiation_failed');
      send(other, { type: 'description', attempt: message.attempt, description: { type, sdp: desc.sdp } });
    } else if (message.type === 'candidate') {
      const c = message.candidate;
      if (!c || typeof c.candidate !== 'string' || c.candidate.length > 2048 ||
          !(c.sdpMid === null || typeof c.sdpMid === 'string' && c.sdpMid.length <= 256) ||
          !(c.sdpMLineIndex === null || Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 16)) {
        return this.end('negotiation_failed');
      }
      send(other, { type: 'candidate', attempt: message.attempt, candidate: {
        candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex
      } });
    } else {
      await this.end('negotiation_failed');
    }
  }

  async turnServers() {
    const response = await this.env.TURN_CREDENTIALS.get(this.env.TURN_CREDENTIALS.idFromName('metered')).fetch('https://turn/ice');
    if (!response.ok) throw new Error('TURN unavailable');
    return response.json();
  }

  async end(code) {
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment();
      socket.serializeAttachment({ ...attachment, closed: true });
      send(socket, { type: 'error', code });
      try { socket.close(1000, 'Room ended'); } catch { /* Already closed. */ }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async webSocketClose(socket) {
    if (socket.deserializeAttachment()?.party) return this.party.close(socket);
    return this.ctx.blockConcurrencyWhile(() => this.closeSocket(socket));
  }

  async closeSocket(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment || attachment.closed) return;
    socket.serializeAttachment({ ...attachment, closed: true });
    try { socket.close(1000, 'Room ended'); } catch { /* Already closed. */ }
    await this.end(attachment.role === 'host' ? 'host_left' : 'guest_left');
  }

  async webSocketError(socket) { await this.webSocketClose(socket); }

  async alarm() {
    return this.ctx.blockConcurrencyWhile(() => this.expire());
  }

  async expire() {
    if ((await this.ctx.storage.get('party-room'))?.capacity) return this.party.alarm();
    const room = await this.ctx.storage.get('room');
    if (!room || room.expiresAt <= Date.now()) return this.end('expired');
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment();
      const lastSeen = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() || attachment.joinedAt;
      if (Date.now() - lastSeen > LEASE_MS) return this.end(attachment.role === 'host' ? 'host_left' : 'guest_left');
    }
    await this.ctx.storage.setAlarm(Math.min(room.expiresAt, Date.now() + 60_000));
  }
}
