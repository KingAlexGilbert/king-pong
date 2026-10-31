function kingPongSignalingSocket(url) {
  if (typeof location === 'undefined' || location.protocol !== 'file:') return new WebSocket(url);
  return new PackagedSignalingSocket(url);
}

class PackagedSignalingSocket {
  constructor(url) {
    this.readyState = 0;
    this.queuedBytes = 0;
    this.socketBuffered = 0;
    const target = new URL(url);
    target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
    const path = target.pathname;
    const kind = path.startsWith('/v1/queue/') ? 'matchmaking' :
      path.startsWith('/v1/party/') ? 'private room' :
      path.startsWith('/v1/match/') ? 'matched room' : 'other';
    const trace = (step, detail = '') => {
      if (window.KingPongDebugOnline) console.info(`[King Pong ${kind} bridge] ${step}`, detail);
    };
    trace('creating iframe signaling bridge');
    target.pathname = '/v1/native-bridge';
    const frame = this.frame = document.createElement('iframe');
    frame.hidden = true;
    frame.name = 'king-pong-signaling';
    frame.title = 'King Pong signaling';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'no-referrer';
    frame.src = target.href;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = event => {
      if (this.readyState === 3) return;
      const m = event.data;
      trace('message from bridge', m?.type || 'unknown');
      if (m.type === 'open') { this.readyState = 1; this.onopen?.(); }
      else if (m.type === 'message') this.onmessage?.({data: m.data});
      else if (m.type === 'error') this.onerror?.();
      else if (m.type === 'buffer') {
        this.queuedBytes = Math.max(0,this.queuedBytes - (m.accepted || 0));
        this.socketBuffered = m.buffered || 0;
      }
      else if (m.type === 'close') { this.close(); this.onclose?.(); }
    };
    frame.onload = () => {
      trace('iframe loaded');
      if (this.readyState === 3) return;
      try {
        frame.contentWindow.postMessage({type: 'king-pong-signaling', path}, target.origin, [channel.port2]);
        trace('MessagePort transferred to iframe');
      } catch (error) {
        trace('MessagePort transfer failed', error?.message || String(error));
        throw error;
      }
    };
    frame.onerror = () => { trace('iframe load failed'); this.onerror?.(); };
    document.body.append(frame);
    trace('iframe appended');
  }

  send(data) {
    if (this.readyState !== 1 || typeof data !== 'string' || data.length > 65536 || this.bufferedAmount > 131072) throw Error('Socket unavailable');
    this.queuedBytes += new TextEncoder().encode(data).length;
    this.port.postMessage({type: 'send', data});
  }

  get bufferedAmount() { return this.queuedBytes + this.socketBuffered; }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.port.postMessage({type: 'close'});
    this.port.close();
    this.frame.remove();
  }
}
