function kingPongSignalingSocket(url) {
  if (typeof location === 'undefined' || location.protocol !== 'file:') return new WebSocket(url);
  return new PackagedSignalingSocket(url);
}

class PackagedSignalingSocket {
  constructor(url) {
    this.readyState = 0;
    const target = new URL(url);
    target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
    const path = target.pathname;
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
      if (m.type === 'open') { this.readyState = 1; this.onopen?.(); }
      else if (m.type === 'message') this.onmessage?.({data: m.data});
      else if (m.type === 'error') this.onerror?.();
      else if (m.type === 'close') { this.close(); this.onclose?.(); }
    };
    frame.onload = () => {
      if (this.readyState === 3) return;
      frame.contentWindow.postMessage({type: 'king-pong-signaling', path}, target.origin, [channel.port2]);
    };
    frame.onerror = () => this.onerror?.();
    document.body.append(frame);
  }

  send(data) {
    if (this.readyState === 1) this.port.postMessage({type: 'send', data});
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.port.postMessage({type: 'close'});
    this.port.close();
    this.frame.remove();
  }
}
