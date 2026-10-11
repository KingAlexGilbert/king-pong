import { MATCHMAKING_CONTRACT } from './matchmaking-contract.js';

const LEASE_MS = 75_000;
const CONNECT_MS = 60_000;
const CAPACITY = 256;

export function chooseArena(a, b, arenas, random = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  const choices = a === null && b === null ? arenas : a === null ? [b] : b === null || a === b ? [a] : [a, b];
  // Rejection sampling avoids modulo bias, including when both players choose Any.
  const ceiling = Math.floor(0x100000000 / choices.length) * choices.length;
  let value;
  do { value = random(); } while (value >= ceiling);
  return choices[value % choices.length];
}

function send(socket, value) {
  try { socket.send(JSON.stringify(value)); } catch { /* Lease/close handlers remove it. */ }
}

export class MatchmakingQueue {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  sockets() {
    return this.ctx.getWebSockets().filter(s => !s.deserializeAttachment()?.closed);
  }

  alive(socket) {
    const a = socket.deserializeAttachment();
    const seen = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() || a.joinedAt;
    return Date.now() - seen <= LEASE_MS;
  }

  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.prune();
      const ip = request.headers.get('X-Queue-IP');
      const sockets = this.sockets();
      if (sockets.length >= CAPACITY || sockets.filter(s => s.deserializeAttachment().ip === ip).length >= 8) {
        return new Response(null, { status: 429 });
      }
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ session: crypto.randomUUID(), ip, joinedAt: Date.now(),
        state: 'watching', preference: null, windowAt: Date.now(), count: 0 });
      send(server, { type: 'queue', state: 'watching', waiting: this.waiting().length });
      await this.schedule();
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  waiting() {
    return this.sockets().filter(s => s.deserializeAttachment().state === 'waiting' && this.alive(s))
      .sort((a, b) => a.deserializeAttachment().queuedAt - b.deserializeAttachment().queuedAt);
  }

  broadcast() {
    const waiting = this.waiting().length;
    for (const socket of this.sockets()) {
      const a = socket.deserializeAttachment();
      send(socket, { type: 'queue', state: a.state, waiting });
    }
  }

  async webSocketMessage(socket, raw) {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.prune();
      const a = socket.deserializeAttachment();
      if (!a || a.closed) return;
      if (Date.now() - a.windowAt >= 10_000) { a.windowAt = Date.now(); a.count = 0; }
      if (++a.count > 20) return this.remove(socket, 'rate_limited');
      socket.serializeAttachment(a);
      let m;
      try {
        if (typeof raw !== 'string' || raw.length > 512) throw new Error();
        m = JSON.parse(raw);
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error();
      } catch { return this.remove(socket, 'negotiation_failed'); }
      if (m.type === 'search') {
        if (m.protocol !== MATCHMAKING_CONTRACT.protocol) return this.remove(socket, 'incompatible');
        if (m.arena !== null && !MATCHMAKING_CONTRACT.arenas.includes(m.arena)) {
          return this.remove(socket, 'negotiation_failed');
        }
        // A duplicate search cannot change a reservation or create another entry.
        if (a.state !== 'watching') { this.broadcast(); return; }
        socket.serializeAttachment({ ...a, state: 'waiting', preference: m.arena, queuedAt: Date.now() });
        await this.pair();
      } else if (m.type === 'cancel') {
        await this.cancel(socket, 'opponent_left');
      } else if (m.type === 'complete' && a.match) {
        socket.serializeAttachment({ ...a, ready: true });
        const peers = this.sockets().filter(s => s.deserializeAttachment().match?.id === a.match.id);
        if (peers.length === 2 && peers.every(s => s.deserializeAttachment().ready)) {
          for (const peer of peers) {
            const p = peer.deserializeAttachment();
            peer.serializeAttachment({ ...p, state: 'watching', match: null, ready: false });
            send(peer, { type: 'complete' });
          }
        }
      } else return this.remove(socket, 'negotiation_failed');
      this.broadcast();
      await this.schedule();
    });
  }

  async pair() {
    const waiting = this.waiting();
    while (waiting.length >= 2) {
      const host = waiting.shift(), guest = waiting.shift();
      const a = host.deserializeAttachment(), b = guest.deserializeAttachment();
      const match = { id: crypto.randomUUID(), protocol: MATCHMAKING_CONTRACT.protocol,
        arena: chooseArena(a.preference, b.preference, MATCHMAKING_CONTRACT.arenas),
        rules: MATCHMAKING_CONTRACT.rules, expiresAt: Date.now() + CONNECT_MS };
      const tokens = { host: crypto.randomUUID(), guest: crypto.randomUUID() };
      const room = this.env.ROOMS.get(this.env.ROOMS.idFromName('match:' + match.id));
      try {
        // One queue object + blockConcurrencyWhile keeps selection and reservation atomic.
        const response = await room.fetch('https://room/reserve', {
          method: 'POST', body: JSON.stringify({ match, tokens })
        });
        if (!response.ok) throw new Error();
        for (const [socket, role] of [[host, 'host'], [guest, 'guest']]) {
          socket.serializeAttachment({ ...socket.deserializeAttachment(), state: 'connecting', match, ready: false });
          send(socket, { type: 'matched', match, role, token: tokens[role] });
        }
      } catch {
        await room.fetch('https://room/abort', { method: 'POST' }).catch(() => {});
        for (const socket of [host, guest]) {
          socket.serializeAttachment({ ...socket.deserializeAttachment(), state: 'watching', match: null });
          send(socket, { type: 'failed', code: 'unavailable' });
        }
      }
    }
  }

  async cancel(socket, code) {
    const a = socket.deserializeAttachment();
    if (a.match) {
      const peers = this.sockets().filter(s => s.deserializeAttachment().match?.id === a.match.id);
      for (const peer of peers) {
        peer.serializeAttachment({ ...peer.deserializeAttachment(), state: 'watching', match: null, ready: false });
        if (peer !== socket) send(peer, { type: 'failed', code });
      }
      await this.env.ROOMS.get(this.env.ROOMS.idFromName('match:' + a.match.id))
        .fetch('https://room/abort', { method: 'POST' });
    }
    socket.serializeAttachment({ ...socket.deserializeAttachment(), state: 'watching', match: null, ready: false });
  }

  async remove(socket, code) {
    await this.cancel(socket, code);
    socket.serializeAttachment({ ...socket.deserializeAttachment(), closed: true });
    send(socket, { type: 'error', code });
    try { socket.close(1000, 'Search ended'); } catch { /* Already closed. */ }
    this.broadcast();
  }

  async prune() {
    for (const socket of this.sockets()) {
      const a = socket.deserializeAttachment();
      if (!this.alive(socket)) await this.remove(socket, 'connection_lost');
      else if (a.match && a.match.expiresAt <= Date.now()) await this.cancel(socket, 'timeout');
    }
  }

  async schedule() {
    if (this.sockets().length) await this.ctx.storage.setAlarm(Date.now() + 30_000);
    else { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); }
  }

  async webSocketClose(socket) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (socket.deserializeAttachment()?.closed) return;
      await this.remove(socket, 'opponent_left');
      await this.schedule();
    });
  }

  async webSocketError(socket) { await this.webSocketClose(socket); }

  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.prune();
      this.broadcast();
      await this.schedule();
    });
  }
}
