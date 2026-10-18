// Only signaling runs in this frame. The game, rendering, WebRTC and saves stay
// in the original packaged page. CSP excludes web-site ancestors, including
// sandboxed opaque-origin frames nested beneath a hostile HTTPS page.
export function signalingBridge(url) {
  const nonce = crypto.randomUUID();
  const wsOrigin = url.origin.replace(/^http/, 'ws');
  const script = `
    'use strict';
    let used = false;
    addEventListener('message', event => {
      if (used || event.source !== parent || event.origin !== 'null' ||
          event.data?.type !== 'king-pong-signaling' || event.ports.length !== 1) return;
      const path = event.data.path;
      if (typeof path !== 'string' || !/^\\/v1\\/(party\\/(?:create\\/2\\/[01]\\/[a-f0-9-]{36}|join\\/2\\/[A-HJ-NP-Z2-9]{6}\\/[a-f0-9-]{36})(?:\\/sas1)?|create|join\\/[A-HJ-NP-Z2-9]{5}|queue\\/[a-z0-9-]{1,80}|match\\/[a-f0-9-]{36}\\/[a-f0-9-]{36})$/.test(path)) return;
      used = true;
      const port = event.ports[0];
      const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + path);
      socket.onopen = () => port.postMessage({type:'open'});
      socket.onmessage = e => { if (typeof e.data === 'string') port.postMessage({type:'message', data:e.data}); };
      socket.onerror = () => port.postMessage({type:'error'});
      socket.onclose = () => { port.postMessage({type:'close'}); port.close(); };
      port.onmessage = e => {
        if (e.data?.type === 'close') { socket.close(); return; }
        if (e.data?.type === 'send' && typeof e.data.data === 'string' && e.data.data.length <= 65536 &&
            socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 131072) socket.send(e.data.data);
      };
      addEventListener('pagehide', () => socket.close(), {once:true});
    });`;
  return new Response(`<!doctype html><meta charset="utf-8"><title>King Pong signaling</title><script nonce="${nonce}">${script}</script>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src ${wsOrigin}; frame-ancestors file:; base-uri 'none'; form-action 'none'` }
  });
}
