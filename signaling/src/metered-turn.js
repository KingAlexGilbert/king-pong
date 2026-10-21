const LIFETIME_SECONDS = 48 * 60 * 60;
const ROTATE_MS = 24 * 60 * 60_000;
const PROPAGATION_MS = 2 * 60_000;
const RETRY_MS = 15 * 60_000;
const MIN_VALID_MS = (2 * 60 * 60 + 300) * 1000;
const APP = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const token = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[\x21-\x7e]+$/.test(s);

export function validateTurnServers(result) {
  if (!Array.isArray(result) || result.length > 16) return [];
  return result.flatMap(server => {
    const urls = (Array.isArray(server?.urls) ? server.urls : [server?.urls]);
    if (urls.length > 8 || !token(server?.username, 512) || !token(server?.credential, 1024) ||
        server.credentialType !== undefined && server.credentialType !== 'password') return [];
    const safe = urls.filter(url => {
      if (typeof url !== 'string' || url.length > 256) return false;
      const m = /^(turn|turns):([a-z0-9.-]+):(80|443|3478|5349)(?:\?transport=(udp|tcp))?$/.exec(url);
      return m && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+metered\.(ca|live)$/.test(m[2]) && !(m[1] === 'turns' && m[4] === 'udp');
    });
    return safe.length ? [{urls: [...new Set(safe)], username: server.username, credential: server.credential}] : [];
  });
}
function usable(credential) {
  // Expiry cuts off active relays, so reserve a full match plus a margin.
  return Boolean(credential?.iceServers?.length && credential.expiresAt > Date.now() + MIN_VALID_MS);
}

export class MeteredTurn {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.app = env.METERED_APP_NAME;
    this.secret = env.METERED_SECRET_KEY;
    this.configured = typeof this.app === 'string' && APP.test(this.app) && token(this.secret, 4096);
  }

  async api(path, key, value, body) {
    if (!this.configured || !token(value, 4096)) throw new Error('TURN not configured');
    const url = new URL(`https://${this.app}.metered.live/api/v1/turn/${path}`);
    url.searchParams.set(key, value);
    if (path === 'credentials') url.searchParams.set('region', 'standard');
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('TURN unavailable');
    // Provider endpoints are fixed and trusted; still bound unexpected responses.
    const reader = response.body.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
    try {
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 65536) throw new Error('TURN response limit');
        text += decoder.decode(value, {stream:true});
      }
      return JSON.parse(text + decoder.decode());
    } finally { await reader.cancel(); }
  }

  async refresh() {
    // Single writer; cached /ice reads do not wait on an external HTTP request.
    if (!this.refreshing) this.refreshing = this.rotate().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async rotate() {
    if (!this.configured) return null;
    const state = await this.ctx.storage.get('turn') || {}, now = Date.now();
    if (state.current?.expiresAt <= now) delete state.current;
    if (state.pending?.expiresAt <= now + MIN_VALID_MS) delete state.pending;
    if ((state.quotaRetryAt || 0) <= now) {
      state.quotaRetryAt = now + RETRY_MS;
      await this.ctx.storage.put('turn', state);
      try {
        const usage = await this.api('current_usage', 'secretKey', this.secret);
        if (![usage?.quotaInGB, usage?.usageInGB].every(n => Number.isFinite(n) && n >= 0)) throw new Error('TURN usage unavailable');
        state.quota = {exhausted: usage.usageInGB >= usage.quotaInGB, checkedAt: now};
      } catch { /* Unknown is not evidence of exhaustion; retain the last confirmed result. */ }
    }
    try {
      if (!state.quota?.exhausted && (state.retryAt || 0) <= now) {
        if (state.pending && state.pending.readyAt <= now) {
          state.retryAt = now + RETRY_MS;
          await this.ctx.storage.put('turn', state);
          const iceServers = validateTurnServers(await this.api('credentials', 'apiKey', state.pending.apiKey));
          if (!iceServers.length) throw new Error('TURN unavailable');
          state.current = {iceServers, createdAt: state.pending.createdAt, expiresAt: state.pending.expiresAt};
          delete state.pending;
          state.retryAt = 0;
        }
        if (!state.pending && (!state.current || state.current.createdAt + ROTATE_MS <= now)) {
          state.retryAt = now + RETRY_MS;
          await this.ctx.storage.put('turn', state);
          const startedAt = Date.now();
          const result = await this.api('credential', 'secretKey', this.secret, {
            expiryInSeconds: LIFETIME_SECONDS, label: 'king-pong-rotating'
          });
          if (!token(result?.apiKey, 4096) || result.expiryInSeconds !== LIFETIME_SECONDS) throw new Error('TURN unavailable');
          const createdAt = Date.now();
          state.pending = {apiKey: result.apiKey, createdAt, readyAt: createdAt + PROPAGATION_MS,
            expiresAt: startedAt + LIFETIME_SECONDS * 1000};
          state.retryAt = 0;
        }
      }
    } catch { /* Keep previous usable credentials; never log secret-bearing URLs. */ }
    await this.ctx.storage.put('turn', state);
    const next = state.quota?.exhausted ? state.quotaRetryAt : Math.max(
      state.pending?.readyAt ?? (state.current ? state.current.createdAt + ROTATE_MS : now), state.retryAt || 0);
    await this.ctx.storage.setAlarm(Math.max(Math.min(next, state.quotaRetryAt), Date.now() + 1000));
    return state.quota?.exhausted ? null : state.current;
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/ready') {
      const ready = usable(await this.refresh());
      return Response.json({ready}, {status: ready ? 200 : 503, headers: {'Cache-Control': 'no-store'}});
    }
    const {current, quota} = await this.ctx.storage.get('turn') || {};
    // Only the authoritative provider response can label this quota exhaustion.
    if (quota?.exhausted) return Response.json({reason:'quota_exhausted'}, {status:503});
    return this.configured && usable(current)
      ? Response.json(current.iceServers, {headers: {'Cache-Control': 'no-store'}})
      : Response.json({reason:'unavailable'}, {status:503});
  }

  async alarm() { await this.refresh(); }
}
