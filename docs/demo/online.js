/* Signaling owns connection setup only. The existing LAN protocol still owns gameplay. */
class KingPongRoom {
  constructor(baseUrl, hooks) {
    this.baseUrl = baseUrl;
    this.hooks = hooks;
    this.attempt = -1;
    this.queue = Promise.resolve();
    this.candidates = [];
    this.closed = false;
    this.connected = false;
  }

  open(role, code = '') {
    this.role = role;
    let url;
    try {
      url = new URL(this.baseUrl);
      if (url.username || url.password || url.search || url.hash ||
          !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = role === 'host' ? '/v1/create' : `/v1/join/${code}`;
      this.socket = new WebSocket(url);
    } catch { this.fail('unavailable'); return; }
    this.hooks.status('Connecting...');
    this.openTimer = setTimeout(() => this.fail('timeout'), 12_000);
    this.socket.onopen = () => {
      this.lastPong = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong > 60_000) this.fail('connection_lost');
        else if (this.socket.readyState === WebSocket.OPEN) this.socket.send('ping');
      }, 20_000);
    };
    this.socket.onmessage = event => {
      if (event.data === 'pong') { this.lastPong = Date.now(); return; }
      // SDP installation is asynchronous; serialize messages so early ICE cannot race it.
      this.queue = this.queue.then(() => {
        if (!this.closed) return this.receive(JSON.parse(event.data));
      }).catch(() => this.fail('negotiation_failed'));
    };
    this.socket.onerror = () => this.fail('connection_lost');
    this.socket.onclose = () => {
      this.queue.then(() => this.fail('connection_lost')).catch(() => this.fail('connection_lost'));
    };
  }

  send(message) {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  async receive(message) {
    if (message.type === 'error') { this.fail(message.code); return; }
    if (message.type === 'welcome') {
      if (message.role !== this.role || !/^[A-HJ-NP-Z2-9]{5}$/.test(message.code)) throw new Error();
      clearTimeout(this.openTimer);
      this.hooks.welcome(message.code);
      this.hooks.status(this.role === 'host' ? 'Waiting for Player 2...' : 'Connecting...');
      return;
    }
    if (message.type === 'start') {
      if (![0, 1].includes(message.attempt) || message.attempt <= this.attempt || !Array.isArray(message.iceServers)) return;
      this.attempt = message.attempt;
      this.relayPending = false;
      this.connected = false;
      this.dropPeer();
      this.candidates = [];
      this.hooks.status(this.attempt ? 'Direct connection unavailable. Trying relay...' : 'Connecting...');
      const peer = this.peer = new RTCPeerConnection({
        iceServers: message.iceServers,
        iceTransportPolicy: this.attempt ? 'relay' : 'all'
      });
      this.hooks.peer(peer);
      const attempt = this.attempt;
      peer.onicecandidate = event => {
        if (event.candidate && this.peer === peer && !this.relayPending) {
          this.send({ type: 'candidate', attempt, candidate: event.candidate.toJSON() });
        }
      };
      peer.onconnectionstatechange = () => {
        if (this.peer !== peer || this.closed) return;
        if (peer.connectionState === 'failed') {
          if (this.connected) this.fail(this.role === 'host' ? 'guest_left' : 'host_left');
          else this.relay();
        } else if (peer.connectionState === 'disconnected') {
          clearTimeout(this.disconnectTimer);
          this.hooks.status('Connection interrupted. Reconnecting...');
          this.hooks.interrupted?.();
          this.disconnectTimer = setTimeout(() => this.fail('connection_lost'), 8000);
        } else if (peer.connectionState === 'connected') {
          clearTimeout(this.disconnectTimer);
          if (this.connected) { this.hooks.status('Connected!'); this.hooks.resumed?.(); }
        }
      };
      if (!this.totalTimer) this.totalTimer = setTimeout(() => this.fail('timeout'), 45_000);
      if (!attempt) this.directTimer = setTimeout(() => this.relay(), 8000);
      if (this.role === 'host') {
        this.wire(peer.createDataChannel('pong-lan-input-v1', { ordered: false, maxRetransmits: 1 }), false, peer);
        this.wire(peer.createDataChannel('pong-control-v1'), true, peer);
        const offer = await peer.createOffer();
        if (this.peer !== peer || this.closed) return;
        await peer.setLocalDescription(offer);
        if (this.peer === peer && !this.closed) this.send({ type: 'description', attempt, description: peer.localDescription.toJSON() });
      } else {
        peer.ondatachannel = event => {
          if (event.channel.label === 'pong-lan-input-v1') this.wire(event.channel, false, peer);
          else if (event.channel.label === 'pong-control-v1') this.wire(event.channel, true, peer);
          else event.channel.close();
        };
      }
      return;
    }
    if (message.attempt !== this.attempt || this.relayPending || !this.peer) return;
    const peer = this.peer;
    if (message.type === 'description') {
      const expected = this.role === 'host' ? 'answer' : 'offer';
      if (message.description?.type !== expected) throw new Error();
      await peer.setRemoteDescription(message.description);
      if (this.peer !== peer || this.closed) return;
      for (const candidate of this.candidates) await peer.addIceCandidate(candidate);
      this.candidates = [];
      if (this.role === 'guest') {
        await peer.setLocalDescription(await peer.createAnswer());
        if (this.peer === peer && !this.closed) this.send({ type: 'description', attempt: this.attempt, description: peer.localDescription.toJSON() });
      }
    } else if (message.type === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
      else if (this.candidates.length < 128) this.candidates.push(message.candidate);
      else throw new Error();
    }
  }

  wire(channel, control, peer) {
    if (this.closed || this.peer !== peer) { channel.close(); return; }
    if (control) this.control = channel;
    else this.data = channel;
    this.hooks.channel(channel, control);
    channel.onmessage = event => {
      if (!this.closed && this.connected && this.peer === peer) this.hooks.message(event.data);
    };
    channel.onopen = () => {
      if (this.closed || this.peer !== peer || this.relayPending || this.connected ||
          this.data?.readyState !== 'open' || this.control?.readyState !== 'open') return;
      this.connected = true;
      clearTimeout(this.directTimer);
      clearTimeout(this.totalTimer);
      this.totalTimer = null;
      this.send({ type: 'connected' });
      this.hooks.connected();
    };
    channel.onclose = () => {
      if (this.closed || this.peer !== peer || this.relayPending) return;
      // A room-expiry message may follow the peer's channel close by a few milliseconds.
      clearTimeout(this.peerLostTimer);
      this.peerLostTimer = setTimeout(() => {
        if (this.peer === peer) this.fail(this.role === 'host' ? 'guest_left' : 'host_left');
      }, 250);
    };
    channel.onerror = () => { if (!this.closed && this.peer === peer && !this.relayPending) this.fail(this.connected ? (this.role === 'host' ? 'guest_left' : 'host_left') : 'negotiation_failed'); };
  }

  relay() {
    if (this.closed || this.connected || this.relayPending) return;
    if (this.attempt === 1) { this.fail('negotiation_failed'); return; }
    this.relayPending = true;
    clearTimeout(this.directTimer);
    this.hooks.status('Direct connection unavailable. Trying relay...');
    this.send({ type: 'relay' });
  }

  dropPeer() {
    clearTimeout(this.directTimer);
    clearTimeout(this.disconnectTimer);
    clearTimeout(this.peerLostTimer);
    const peer = this.peer;
    this.peer = null;
    for (const channel of [this.data, this.control]) {
      if (channel) { channel.onclose = channel.onerror = channel.onopen = channel.onmessage = null; channel.close(); }
    }
    this.data = this.control = null;
    if (peer) { peer.onicecandidate = peer.onconnectionstatechange = peer.ondatachannel = null; peer.close(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.openTimer);
    clearTimeout(this.totalTimer);
    clearInterval(this.heartbeat);
    this.dropPeer();
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
      this.socket.close();
    }
  }

  fail(code) {
    if (this.closed) return;
    this.close();
    this.hooks.error(code);
  }
}

let onlineSession = null;
let onlineControlChannel = null;
let onlineGameBlocked = false;
let onlineHasState = false;
const onlineInputs = new Map();
const ONLINE_ERRORS = {
  invalid_code: 'Enter a valid five-character room code.',
  not_found: 'Room not found. Check the code or ask for a new room.',
  full: 'Room already full. Ask for a new room.',
  timeout: 'Connection timed out. Please create or join a new room.',
  relay_unavailable: 'Relay connection unavailable. Please try again later.',
  host_left: 'Host disconnected. Join a new room to play again.',
  guest_left: 'Player 2 disconnected. Create a new room to play again.',
  expired: 'Room expired. Please create or join a new room.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  negotiation_failed: 'Could not connect the players. Please try a new room.',
  connection_lost: 'Connection lost. Please create or join a new room.',
  unavailable: 'Online multiplayer is unavailable. Please try again later.'
};

function sanitizeRoomCode(value) {
  return String(value || '').toUpperCase().replace(/\s/g, '').slice(0, 5);
}

function setOnlineControls(busy, joining = false) {
  lanHostButton.hidden = busy;
  lanJoinButton.hidden = busy || joining;
  lanDisconnectButton.hidden = !busy;
  byId('onlineJoinForm').hidden = busy || !joining;
  byId('onlineCodeDisplay').hidden = !busy || !lanRoomCode;
  if (!busy) byId('onlineRoomCode').textContent = '';
}

function closeLanConnection(showMessage = true) {
  resetMatchConnectionState();
  remoteSelectionSequence = -1;
  onlineLastSentAxis = null;
  onlineAppliedInputSeq = -1;
  const session = onlineSession;
  onlineSession = null;
  if (session) session.close();
  lanPeer = lanChannel = onlineControlChannel = null;
  lanConnected = false;
  lanRole = 'none';
  lanRoomCode = '';
  lanLastInputSeq = lanLastStateSeq = -1;
  lanLastActionAt = -Infinity;
  lanRemoteInput = { axis: 0, targetY: null, lastAt: 0 };
  onlineHasState = onlineGameBlocked = false;
  onlineInputs.clear();
  document.body.classList.remove('lan-connected');
  setOnlineControls(false);
  if (showMessage) { paused = true; setLanStatus('Choose Create Room or Join Room.'); }
  updateLanPanelVisibility();
  updateModeControls();
}

function startLanTwoPlayerSetup(fromTitle = false) {
  if (fromTitle) hideTitleScreen();
  if (!onlineSession) {
    startTwoPlayerMode(true, false);
    hideFirstStartControls();
    onlineGameBlocked = true;
    setOnlineControls(false);
    setLanStatus('Choose Create Room or Join Room.');
  }
  setLanPanelOpen(true);
  setMenusVisible(true);
}

function hostLanMatch() { openOnlineRoom('host'); }
function prepareLanJoin() {
  closeLanConnection(false);
  onlineGameBlocked = true;
  setOnlineControls(false, true);
  setLanStatus('Enter Room Code');
  lanRoomCodeInput.value = '';
  lanRoomCodeInput.focus();
}
function joinOnlineRoom() {
  const code = sanitizeRoomCode(lanRoomCodeInput.value);
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) { setLanStatus(ONLINE_ERRORS.invalid_code); return; }
  openOnlineRoom('guest', code);
}

function openOnlineRoom(role, code = '') {
  closeLanConnection(false);
  onlineGameBlocked = true;
  if (!isLanSupported() || typeof WebSocket === 'undefined') { setLanStatus('This browser cannot play online. Try an updated browser.'); return; }
  if (!window.KING_PONG_SIGNALING_URL) { setLanStatus(ONLINE_ERRORS.unavailable); return; }
  lanRole = role;
  startTwoPlayerMode(true, false);
  hideFirstStartControls();
  setLanPanelOpen(true);
  setMenusVisible(true);
  setOnlineControls(true);
  const session = new KingPongRoom(window.KING_PONG_SIGNALING_URL, {
    status: message => { if (onlineSession === session) setLanStatus(message); },
    welcome: code => {
      if (onlineSession !== session) return;
      lanRoomCode = code;
      byId('onlineRoomCode').textContent = code;
      byId('onlineCodeDisplay').hidden = false;
    },
    peer: peer => { lanPeer = peer; lanConnected = false; onlineGameBlocked = true; },
    channel: (channel, control) => { if (control) onlineControlChannel = channel; else lanChannel = channel; },
    message: raw => handleLanMessage(raw),
    interrupted: () => {
      onlineGameBlocked = true;
      paused = true;
      resumeCountdownEndAt = 0;
      lanRemoteInput = { axis: 0, targetY: null, lastAt: 0 };
    },
    resumed: () => {
      onlineGameBlocked = false;
      if (role === 'host') sendLanState(true);
    },
    connected: () => {
      if (onlineSession !== session) return;
      lanConnected = true;
      onlineGameBlocked = false;
      setLanStatus('Connected!');
      updateModeControls();
      setMenusVisible(false);
      if (role === 'host') sendLanState(true);
      else { sendPaddleSelection(); sendLanInput(null, true); }
    },
    error: code => {
      if (onlineSession !== session) return;
      closeLanConnection(false);
      // Keep a disconnected guest from falling through to the local physics loop.
      onlineGameBlocked = true;
      paused = true;
      setLanPanelOpen(true);
      setMenusVisible(true);
      setLanStatus(ONLINE_ERRORS[code] || ONLINE_ERRORS.connection_lost);
    }
  });
  onlineSession = session;
  session.open(role, code);
}

function onlineInput(input, seq) {
  if (onlineSession && onlineHasState && !paused) {
    input = { axis: input.axis, targetY: right.y };
    onlineInputs.set(seq, right.y);
    if (onlineInputs.size > 120) onlineInputs.delete(onlineInputs.keys().next().value);
  }
  return input;
}

let onlineLastSentAxis = null;
let onlineAppliedInputSeq = -1;

function onlinePaddleState(state, levelChanged) {
  const authoritative = finiteNumber(state.rightY, right.y);
  if (!onlineSession) return authoritative;
  let y = right.y;
  if (!onlineHasState || levelChanged || state.paused) {
    y = authoritative;
    onlineInputs.clear();
  } else if (onlineInputs.has(state.inputSeq)) {
    // Reconcile the position the host accepted, keeping motion since that input responsive.
    y += authoritative - onlineInputs.get(state.inputSeq);
  }
  for (const seq of onlineInputs.keys()) if (seq <= state.inputSeq) onlineInputs.delete(seq);
  onlineHasState = true;
  return y;
}

window.addEventListener('pagehide', () => { if (onlineSession) onlineSession.close(); });
