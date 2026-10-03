export { MeteredTurn } from './metered-turn.js';

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
    if (!origins.includes(request.headers.get('Origin'))) return new Response('Forbidden', { status: 403 });
    if (!(await env.ROOM_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) {
      return socketError('rate_limited');
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
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  sockets() {
    return this.ctx.getWebSockets().filter(socket => !socket.deserializeAttachment()?.closed);
  }

  async fetch(request) {
    // Admission must be atomic even when two guests arrive during a storage await.
    return this.ctx.blockConcurrencyWhile(async () => {
      const [, action, code] = new URL(request.url).pathname.split('/');
      let room = await this.ctx.storage.get('room');
      if (room && room.expiresAt <= Date.now()) {
        await this.end('expired');
        room = null;
      }
      const sockets = this.sockets();
      if (action === 'create') {
        if (room || sockets.length) return new Response(null, { status: 409 });
        room = { code, expiresAt: Date.now() + WAIT_MS, relay: false };
      } else {
        if (!room || !sockets.some(s => s.deserializeAttachment().role === 'host')) return socketError('not_found');
        if (sockets.length >= 2) return socketError('full');
        room.maxAt = Date.now() + SESSION_MS;
        room.expiresAt = Date.now() + 60_000;
      }
      const role = action === 'create' ? 'host' : 'guest';
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role, joinedAt: Date.now(), count: 0, windowAt: Date.now(), connected: false });
      await this.ctx.storage.put('room', room);
      await this.ctx.storage.setAlarm(Math.min(room.expiresAt, Date.now() + 60_000));
      send(server, { type: 'welcome', role, code });
      if (role === 'guest') {
        for (const socket of this.sockets()) send(socket, { type: 'start', attempt: 0, iceServers: STUN });
      }
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  async webSocketMessage(socket, raw) {
    const attachment = socket.deserializeAttachment();
    if (!attachment || attachment.closed) return;
    if (typeof raw !== 'string' || raw.length > 65_536) return this.end('negotiation_failed');
    if (Date.now() - attachment.windowAt > 10_000) {
      attachment.windowAt = Date.now();
      attachment.count = 0;
    }
    if (++attachment.count > 160) return this.end('rate_limited');
    socket.serializeAttachment(attachment);
    let message;
    try { message = JSON.parse(raw); } catch { return this.end('negotiation_failed'); }
    if (!message || typeof message !== 'object') return this.end('negotiation_failed');
    const room = await this.ctx.storage.get('room');
    if (!room || room.expiresAt <= Date.now()) return this.end('expired');
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
    const attachment = socket.deserializeAttachment();
    if (!attachment || attachment.closed) return;
    socket.serializeAttachment({ ...attachment, closed: true });
    try { socket.close(1000, 'Room ended'); } catch { /* Already closed. */ }
    await this.end(attachment.role === 'host' ? 'host_left' : 'guest_left');
  }

  async webSocketError(socket) { await this.webSocketClose(socket); }

  async alarm() {
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
