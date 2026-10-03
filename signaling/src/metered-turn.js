const LIFETIME_SECONDS = 48 * 60 * 60;
const ROTATE_MS = 24 * 60 * 60_000;
const PROPAGATION_MS = 2 * 60_000;
const RETRY_MS = 15 * 60_000;
const MIN_VALID_MS = (2 * 60 * 60 + 300) * 1000;

function usable(credential) {
  // Metered expiry cuts off active relays, so reserve a full match plus a margin.
  return Boolean(credential?.iceServers?.length && credential.expiresAt > Date.now() + MIN_VALID_MS);
}

export class MeteredTurn {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async api(path, key, value, body) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(this.env.METERED_APP_NAME || '') || !value) {
      throw new Error('TURN not configured');
    }
    const url = new URL(`https://${this.env.METERED_APP_NAME}.metered.live/api/v1/turn/${path}`);
    url.searchParams.set(key, value);
    if (!body) url.searchParams.set('region', 'standard');
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('TURN unavailable');
    return response.json();
  }

  async refresh() {
    // One shared rotation prevents simultaneous rooms from exhausting the credential cap.
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get('turn') || {};
      const now = Date.now();
      if (state.current?.expiresAt <= now) delete state.current;
      if (state.pending?.expiresAt <= now + MIN_VALID_MS) delete state.pending;
      try {
        if ((state.retryAt || 0) <= now) {
          if (state.pending && state.pending.readyAt <= now) {
            state.retryAt = now + RETRY_MS;
            await this.ctx.storage.put('turn', state);
            const result = await this.api('credentials', 'apiKey', state.pending.apiKey);
            const iceServers = (Array.isArray(result) ? result : []).flatMap(server => {
              const urls = (Array.isArray(server?.urls) ? server.urls : [server?.urls]).filter(url =>
                typeof url === 'string' && /^turns?:/.test(url) && !/:53(?:\?|$)/.test(url));
              if (!urls.length || typeof server.username !== 'string' || !server.username ||
                  typeof server.credential !== 'string' || !server.credential) return [];
              return [{ urls, username: server.username, credential: server.credential }];
            });
            if (!iceServers.length) throw new Error('TURN unavailable');
            state.current = { iceServers, createdAt: state.pending.createdAt, expiresAt: state.pending.expiresAt };
            delete state.pending;
            state.retryAt = 0;
          }
          if (!state.pending && (!state.current || state.current.createdAt + ROTATE_MS <= now)) {
            state.retryAt = now + RETRY_MS;
            await this.ctx.storage.put('turn', state);
            const startedAt = Date.now();
            const result = await this.api('credential', 'secretKey', this.env.METERED_SECRET_KEY, {
              expiryInSeconds: LIFETIME_SECONDS, label: 'king-pong-rotating'
            });
            if (typeof result?.apiKey !== 'string' || !result.apiKey || result.expiryInSeconds !== LIFETIME_SECONDS) {
              throw new Error('TURN unavailable');
            }
            const createdAt = Date.now();
            state.pending = {
              apiKey: result.apiKey, createdAt, readyAt: createdAt + PROPAGATION_MS,
              expiresAt: startedAt + LIFETIME_SECONDS * 1000
            };
            state.retryAt = 0;
          }
        }
      } catch { /* Keep the previous credential usable; never log API URLs containing keys. */ }
      await this.ctx.storage.put('turn', state);
      const next = state.pending?.readyAt ?? (state.current ? state.current.createdAt + ROTATE_MS : now);
      await this.ctx.storage.setAlarm(Math.max(next, state.retryAt || 0, Date.now() + 1000));
      return state.current;
    });
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/ready') {
      const ready = usable(await this.refresh());
      return Response.json({ ready }, { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const { current } = await this.ctx.storage.get('turn') || {};
    // Room setup only reads a pre-propagated credential. It never creates one.
    return usable(current)
      ? Response.json(current.iceServers, { headers: { 'Cache-Control': 'no-store' } })
      : new Response(null, { status: 503 });
  }

  async alarm() { await this.refresh(); }
}
