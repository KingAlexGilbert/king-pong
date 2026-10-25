/* Room admission and transport setup. Existing LAN packet handlers own gameplay. */
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

  open(role, code = '', assignment = null) {
    this.assignment = assignment;
    this.managed = !assignment && (role === 'host' || code.length === 6);
    this.role = role;
    let url;
    try {
      url = new URL(this.baseUrl);
      if (url.username || url.password || url.search || url.hash ||
          !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = assignment ? `/v1/match/${assignment.match.id}/${assignment.token}/secure1` :
        this.managed ? (role === 'host' ? `/v1/party/create/2/${this.requireApproval ? 1 : 0}/${kingPongClientToken()}/sas2` : `/v1/party/join/2/${code}/${kingPongClientToken()}/sas2`) :
        role === 'host' ? '/v1/create' : `/v1/join/${code}`;
      this.socket = kingPongSignalingSocket(url);
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
      if (typeof event.data !== 'string' || event.data.length > 65536) { this.fail('negotiation_failed'); return; }
      if (typeof event.data === 'string' && event.data.length <= 24000 && event.data.startsWith('{"type":"secure-frame"')) {
        try { this.secure?.packet(JSON.parse(event.data)); } catch { this.fail('negotiation_failed'); } return;
      }
      // SDP installation is asynchronous; serialize messages so early ICE cannot race it.
      this.signalingQueued = (this.signalingQueued || 0) + 1;
      if (this.signalingQueued > 256) { this.fail('negotiation_failed'); return; }
      this.queue = this.queue.then(() => {
        if (!this.closed) return this.receive(JSON.parse(event.data));
      }).catch(() => this.fail('negotiation_failed')).finally(() => this.signalingQueued--);
    };
    this.socket.onerror = () => this.fail('connection_lost');
    this.socket.onclose = () => {
      this.queue.then(() => this.fail('connection_lost')).catch(() => this.fail('connection_lost'));
    };
  }

  send(message) {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(this.managed && ['description', 'candidate', 'relay', 'connected'].includes(message.type) ?
        {...message, to: this.role === 'host' ? 1 : 0, attempt: message.attempt ?? this.attempt} : message));
    }
  }

  kickGuest() {
    if (!this.managed || this.role !== 'host' || !this.connected || this.removingGuest || this.closed) return;
    this.removingGuest = true;
    this.send({type: 'kick', slot: 1});
    // The guest may close RTC before the server's departed acknowledgement
    // reaches the host. Keep the room socket alive for that acknowledgement.
    this.removalTimer = setTimeout(() => this.fail('timeout'), 8000);
  }

  // In a managed private room the signaling server, not WebRTC, decides when
  // the guest has left. RTC channels often close before its 'departed' event
  // arrives; tearing down the host socket here would lose the reusable code.
  waitForGuestDeparture(peer) {
    if (!this.managed || this.role !== 'host' || !this.connected ||
        this.closed || this.peer !== peer) return false;
    clearTimeout(this.disconnectTimer);
    clearTimeout(this.peerLostTimer);
    this.peerLostTimer = setTimeout(() => {
      if (!this.closed && this.peer === peer) this.fail('connection_lost');
    }, 8000);
    return true;
  }

  async receive(message) {
    if (message.type === 'secure') {
      if (message.kind === 'init') {
        if (this.awaitingApproval || this.secure || !/^[a-f0-9-]{36}$/.test(message.session || '') || message.epoch !== 0 ||
            this.approvalProtocol === APPROVAL_PROTOCOL && !this.approvalBinding) throw Error('session admission');
        this.secure = new KingPongSecureTransport(this,message); return;
      }
      await this.secure?.receive(message); return;
    }
    if (this.managed && message.type === 'lobby') {
      if (this.connected && message.started) clearOnlineApproval(this,true);
      if (typeof syncClassicApproval === 'function') syncClassicApproval(message);
      return;
    }
    if (this.managed && message.type === 'approval-pair') {
      if (this.approvalProtocol !== APPROVAL_PROTOCOL) throw Error('approval protocol');
      await this.approvalPairs?.get(message.request)?.receive(message); return;
    }
    if (this.managed && message.type === 'approved') {
      if (this.approvalProtocol === APPROVAL_PROTOCOL) acceptOnlineApproval(this,message.request);
      this.awaitingApproval = false; this.hooks.status('Connecting...'); return;
    }
    if (this.managed && message.type === 'departed' && this.role === 'host') {
      this.secure?.close(); this.secure=null;
      clearOnlineApproval(this); this.dropPeer(); clearTimeout(this.totalTimer); this.totalTimer = null;
      this.connected = false; this.attempt = -1; this.relayPending = false;
      this.hooks.departed?.(); return;
    }
    if (message.type === 'error') { this.fail((this.managed || this.assignment) && message.code === 'invalid_code' ? 'server_outdated' : message.code); return; }
    if (message.type === 'welcome') {
      if (message.role !== this.role || !(this.managed ? message.protocol === 'kp-party-1' && message.capacity === 2 && /^[A-HJ-NP-Z2-9]{6}$/.test(message.code) : /^[A-HJ-NP-Z2-9]{5}$/.test(message.code))) throw new Error();
      if (this.assignment && (message.match?.id !== this.assignment.match.id ||
          message.match?.arena !== this.assignment.match.arena || message.match?.rules !== this.assignment.match.rules ||
          message.match?.protocol !== KING_PONG_MATCHMAKING.protocol)) throw new Error();
      clearTimeout(this.openTimer);
      this.code = message.code;
      if (this.managed && !this.assignment) {
        const needsApproval = message.pending || this.role === 'host' && this.requireApproval;
        if (needsApproval && message.verification !== APPROVAL_PROTOCOL) { this.fail('server_outdated'); return; }
        this.approvalProtocol = message.verification;
        this.awaitingApproval = Boolean(message.pending);
        if (message.pending) startOnlineApproval(this,message.request);
      }
      this.hooks.welcome(message.code);
      this.hooks.status(message.pending ? 'Waiting for host approval...' : this.role === 'host' ? 'Waiting for Player 2...' : 'Connecting...');
      return;
    }
    if (message.type === 'start') {
      if (this.secure) throw Error('transport downgrade');
      if (this.awaitingApproval || this.approvalProtocol === APPROVAL_PROTOCOL &&
          (!this.approvalBinding || message.verification !== APPROVAL_PROTOCOL || message.request !== this.approvalBinding.request)) throw Error('approval required');
      if (![0, 1].includes(message.attempt) || message.attempt <= this.attempt || !Array.isArray(message.iceServers)) return;
      this.attempt = message.attempt;
      this.relayPending = false;
      this.connected = false;
      this.dropPeer();
      this.candidates = [];
      this.hooks.status(this.attempt ? 'Direct connection unavailable. Trying relay...' : 'Connecting...');
      const peer = this.peer = new RTCPeerConnection({
        iceServers: message.iceServers,
        iceTransportPolicy: 'all' // TURN availability must not exclude a viable direct pair.
      });
      this.hooks.peer(peer);
      const attempt = this.attempt;
      peer.onicecandidate = event => {
        if (event.candidate && this.peer === peer && !this.relayPending) {
          this.send({ type: 'candidate', attempt, candidate: event.candidate.toJSON() });
        }
      };
      // ICE has selected a route. Slow DTLS/data-channel opening must not
      // discard a working direct path at the eight-second deadline.
      peer.oniceconnectionstatechange = () => {
        if (this.peer !== peer || this.closed) return;
        if (['connected', 'completed'].includes(peer.iceConnectionState)) clearTimeout(this.directTimer);
      };
      peer.onconnectionstatechange = () => {
        if (this.peer !== peer || this.closed || this.removingGuest) return;
        if (peer.connectionState === 'failed') {
          if (this.connected) {
            if (this.managed && this.role === 'host') this.hooks.interrupted?.();
            if (!this.closed && this.peer === peer && !this.waitForGuestDeparture(peer))
              this.fail(this.role === 'host' ? 'guest_left' : 'host_left');
          }
          else this.relay();
        } else if (peer.connectionState === 'disconnected') {
          clearTimeout(this.disconnectTimer);
          this.hooks.status('Connection interrupted. Reconnecting...');
          this.hooks.interrupted?.();
          if (this.closed || this.peer !== peer) return;
          this.disconnectTimer = setTimeout(() => this.fail('connection_lost'), 8000);
        } else if (peer.connectionState === 'connected') {
          clearTimeout(this.directTimer);
          clearTimeout(this.disconnectTimer);
          if (this.connected) { this.hooks.status('Connected!'); this.hooks.resumed?.(); }
          else this.maybeConnected(peer);
        }
      };
      if (!this.totalTimer) this.totalTimer = setTimeout(() => this.fail('timeout'), 45_000);
      if (!attempt) this.directTimer = setTimeout(() => {
        if (this.peer === peer && !['connected', 'completed'].includes(peer.iceConnectionState) && peer.connectionState !== 'connected') this.relay();
      }, 8000);
      if (this.role === 'host') {
        this.wire(peer.createDataChannel('pong-lan-input-v1', { ordered: false, maxRetransmits: 1 }), false, peer);
        this.wire(peer.createDataChannel('pong-control-v1'), true, peer);
        const offer = await peer.createOffer();
        if (this.peer !== peer || this.closed) return;
        await peer.setLocalDescription(offer);
        if (this.peer === peer && !this.closed) await this.sendDescription(peer, attempt);
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
      if (peer.remoteDescription) return; // No unsolicited renegotiation after the approved exchange.
      const expected = this.role === 'host' ? 'answer' : 'offer';
      if (message.description?.type !== expected) throw new Error();
      if (!this.assignment && this.role === 'guest') this.pairingRequired = /(?:^|\r?\n)a=x-kingpong-pairing:1(?:\r?\n|$)/.test(message.description.sdp);
      await verifyApprovedDescription(this, message.description, this.attempt);
      await peer.setRemoteDescription(message.description);
      if (this.peer !== peer || this.closed) return;
      for (const candidate of this.candidates) await peer.addIceCandidate(candidate);
      this.candidates = [];
      if (this.role === 'guest') {
        await peer.setLocalDescription(await peer.createAnswer());
        if (this.peer === peer && !this.closed) await this.sendDescription(peer, this.attempt);
      }
    } else if (message.type === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
      else if (this.candidates.length < 128) this.candidates.push(message.candidate);
      else throw new Error();
    }
  }

  async sendDescription(peer, attempt) {
    const description = await signApprovedDescription(this, pairingDescription(this, peer.localDescription.toJSON()), attempt);
    if (this.peer === peer && !this.closed) this.send({type:'description',attempt,description});
  }

  wire(channel, control, peer) {
    if (this.closed || this.peer !== peer) { channel.close(); return; }
    if (control) this.control = channel;
    else this.data = channel;
    this.hooks.channel(channel, control);
    channel.onmessage = event => {
      if (this.closed || this.peer !== peer) return;
      if (control && receivePairingFrame(this, event.data)) return;
      if (this.connected && (!this.pairingRequired || this.pairingAccepted)) this.hooks.message(event.data);
    };
    channel.onopen = () => this.maybeConnected(peer);
    channel.onclose = () => {
      if (this.closed || this.peer !== peer || this.relayPending || this.removingGuest) return;
      // Freeze immediately, especially if the ready countdown is about to end.
      this.hooks.interrupted?.();
      if (this.closed || this.peer !== peer) return;
      if (this.waitForGuestDeparture(peer)) return;
      // A room-expiry message may follow the peer's channel close by a few milliseconds.
      clearTimeout(this.peerLostTimer);
      this.peerLostTimer = setTimeout(() => {
        if (this.peer === peer) this.fail(this.role === 'host' ? 'guest_left' : 'host_left');
      }, 250);
    };
    channel.onerror = () => {
      if (this.closed || this.peer !== peer || this.relayPending || this.removingGuest) return;
      if (this.managed && this.role === 'host' && this.connected) this.hooks.interrupted?.();
      if (!this.closed && this.peer === peer && !this.waitForGuestDeparture(peer))
        this.fail(this.connected ? (this.role === 'host' ? 'guest_left' : 'host_left') : 'negotiation_failed');
    };
  }

  maybeConnected(peer) {
    if (this.closed || this.peer !== peer || this.relayPending || this.connected ||
        peer.connectionState !== 'connected' || this.data?.readyState !== 'open' ||
        this.control?.readyState !== 'open') return;
    this.connected = true;
    clearTimeout(this.directTimer);
    clearTimeout(this.totalTimer);
    this.totalTimer = null;
    this.send({ type: 'connected' });
    if (this.pairingRequired && !this.assignment) beginPairingVerification(this);
    else this.hooks.connected();
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
    closePairingUi(this);
    this.pairingAccepted = false;
    clearTimeout(this.removalTimer);
    this.removingGuest = false;
    clearTimeout(this.directTimer);
    clearTimeout(this.disconnectTimer);
    clearTimeout(this.peerLostTimer);
    const peer = this.peer;
    this.peer = null;
    for (const channel of [this.data, this.control]) {
      if (channel) { channel.onclose = channel.onerror = channel.onopen = channel.onmessage = null; channel.close(); }
    }
    this.data = this.control = null;
    if (peer) { peer.onicecandidate = peer.oniceconnectionstatechange = peer.onconnectionstatechange = peer.ondatachannel = null; peer.close(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.secure?.close();
    clearOnlineApproval(this);
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
    this.lastTransport='Connection failure';
    this.close();
    this.hooks.error(code);
  }
}

let onlineSession = null;
let onlineTransportSelected = false;
let onlineNativeTransport = false;
let onlineMatchAssignment = null;
let matchmakingPreviousRules = null;
let onlineControlChannel = null;
let onlineGameBlocked = false;
let onlineHasState = false;
const onlineInputs = new Map();
const ONLINE_ERRORS = {
  server_outdated: 'The room server is out of date. Please try again later.',
  incompatible: 'Both players must reload the latest game.',
  opponent_left: 'Opponent disconnected. Find another match.',
  invalid_code: 'Enter a valid five- or six-character room code.',
  wrong_mode: 'This room uses a different player count. Choose the matching multiplayer menu.',
  kicked: 'The host removed you from this room.',
  rejected: 'The host declined your join request.',
  blocked: 'You cannot rejoin this room. Ask the host for a new room.',
  unapproved: 'Wait for the host to accept your request.',
  approval_timeout: 'Join request expired. Ask the host to try again.',
  unauthorized: 'Room permission denied.',
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

function sanitizeOnlineRoomCode(value) {
  return String(value || '').toUpperCase().replace(/\s/g, '').slice(0, 6);
}

function setOnlineControls(busy, joining = false) {
  if (!byId('onlineJoinForm')) return;
  onlineHostControl().hidden = busy;
  onlineJoinControl().hidden = busy || joining;
  onlineDisconnectControl().hidden = !busy;
  byId('onlineJoinForm').hidden = busy || !joining;
  byId('onlineCodeDisplay').hidden = !busy || !lanRoomCode || Boolean(onlineMatchAssignment);
  if (byId('matchmakingPanel')) syncMatchmakingUi();
  if (!busy) byId('onlineRoomCode').textContent = '';
}

function closeOnlineConnection(showMessage = true, keepQueue = false) {
  clearPointServeCountdown();
  if (saveConfirmation?.roomSession === onlineSession) finishSaveConfirmation(false);
  resetOnlineMatchFlow();
  resetOnlineWire();
  if (!keepQueue) stopMatchmaking();
  onlineMatchAssignment = null;
  if (matchmakingPreviousRules === null) matchRuleId = playerPreference('matchRuleId');
  matchPowerupsEnabled = playerPreference('royalPowerupsEnabled');
  if (matchmakingPreviousRules !== null) { matchRuleId = matchmakingPreviousRules; matchmakingPreviousRules = null; }
  stopRoyalPowerupSound();
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
  if (showMessage) { paused = true; setLanStatus('Find an opponent or create/join a private room.'); }
  updateLanPanelVisibility();
  updateModeControls();
}

function startOnlineSetup(fromTitle = false, offline = false) {
  if (!offline) { onlineManualLanSelected = false; onlineLocalLanSelected = false; }
  closeLanConnection(false);
  onlineTransportSelected = true;
  if (fromTitle) hideTitleScreen();
  if (!onlineSession) {
    startTwoPlayerMode(true, false);
    if (typeof hideFirstStartControls === 'function') hideFirstStartControls();
    onlineGameBlocked = true;
    setOnlineControls(false);
    setLanStatus('Find an opponent or create/join a private room.');
  }
  setLanPanelOpen(true);
  setMenusVisible(true);
  if (!(typeof onlineManualLanSelected !== 'undefined' && onlineManualLanSelected)) observeMatchmaking();
}

function hostOnlineMatch() { openOnlineRoom('host'); }
function prepareOnlineJoin() {
  closeOnlineConnection(false);
  onlineGameBlocked = true;
  setOnlineControls(false, true);
  setLanStatus('Enter Room Code');
  onlineRoomInput().value = '';
  onlineRoomInput().focus();
}
function joinOnlineRoom() {
  const code = sanitizeOnlineRoomCode(onlineRoomInput().value);
  if (!/^[A-HJ-NP-Z2-9]{5,6}$/.test(code)) { setLanStatus(ONLINE_ERRORS.invalid_code); return; }
  openOnlineRoom('guest', code);
}

function openOnlineRoom(role, code = '', assignment = null) {
  closeLanConnection(false, Boolean(assignment));
  onlineTransportSelected = true;
  onlineMatchAssignment = assignment?.match || null;
  if (assignment) matchmakingPreviousRules = matchRuleId;
  onlineGameBlocked = true;
  if (typeof WebSocket === 'undefined' || !globalThis.crypto?.subtle) { setLanStatus('This browser cannot play online. Try an updated browser.'); return; }
  if (!window.KING_PONG_SIGNALING_URL && !(typeof onlineManualLanSelected !== 'undefined' && onlineManualLanSelected)) { setLanStatus(ONLINE_ERRORS.unavailable); return; }
  lanRole = role;
  startTwoPlayerMode(true, false);
  if (onlineMatchAssignment) applyMatchmakingSettings();
  if (typeof hideFirstStartControls === 'function') hideFirstStartControls();
  setLanPanelOpen(true);
  setMenusVisible(true);
  setOnlineControls(true);
  if (assignment) beginOnlineMatchFlow();
  const RoomClass = typeof onlineLocalLanSelected !== 'undefined' && onlineLocalLanSelected && !assignment ? KingPongLocalRoom : typeof onlineManualLanSelected !== 'undefined' && onlineManualLanSelected && !assignment ? KingPongManualRoom : KingPongRoom;
  const session = new RoomClass(window.KING_PONG_SIGNALING_URL, {
    status: message => { if (onlineSession === session) setLanStatus(message); },
    welcome: code => {
      if (onlineSession !== session) return;
      lanRoomCode = code;
      byId('onlineRoomCode').textContent = code;
      byId('onlineCodeDisplay').hidden = Boolean(onlineMatchAssignment);
    },
    peer: peer => { if (onlineSession === session) {
      lanPeer = peer; lanConnected = false; onlineGameBlocked = true;
      if (!assignment && !(session instanceof KingPongManualRoom)) beginOnlineMatchFlow();
    } },
    peerChanged: peer => { if(onlineSession === session)lanPeer=peer; },
    departed: () => privateGuestDeparted(session),
    channel: (channel, control) => {
      if (onlineSession !== session) return;
      if (control) onlineControlChannel = channel; else lanChannel = channel;
    },
    message: raw => { if (onlineSession === session) handleLanMessage(raw); },
    interrupted: () => {
      if (onlineSession !== session) return;
      suspendPointServeCountdown();
      // Matchmaking leaves a failed setup immediately. Private-room players
      // keep signaling alive long enough to receive the authoritative departure
      // reason (and the host keeps its reusable room code).
      if (onlineMatchFlowBlocksPlay() && !session.managed && !session.secure) {
        session.fail('opponent_left'); return;
      }
      if(session.secure && !session.recoveryPause)session.recoveryPause={at:performance.now(),remaining:resumeCountdownRemainingMs()};
      onlineGameBlocked = true;
      paused = true;
      resumeCountdownEndAt = 0;
      lanRemoteInput = { axis: 0, targetY: null, lastAt: 0 };
    },
    resumed: () => {
      if (onlineSession !== session || session.pairingRequired && !session.pairingAccepted) return;
      if(session.recoveryPause && onlineMatchFlow) {
        const elapsed=performance.now()-session.recoveryPause.at;
        for(const key of ['handshakeDeadline','connectedUntil','goUntil'])if(Number.isFinite(onlineMatchFlow[key]))onlineMatchFlow[key]+=elapsed;
        if(onlineMatchFlow.phase==='countdown')resumeCountdownEndAt=performance.now()+session.recoveryPause.remaining;
      }
      session.recoveryPause=null;
      onlineGameBlocked = onlineMatchFlowBlocksPlay();
      if (role === 'host') sendLanState(true);
    },
    connected: () => {
      if (onlineSession !== session) return;
      session.multiplayerEstablished = true;
      if (typeof onlineManualLanSelected !== 'undefined' && onlineManualLanSelected) byId('classicLanDialog').hidden = true;
      lanConnected = true;
	  syncMatchmakingUi();
      onlineGameBlocked = false;
      if (assignment) matchmakingComplete();
      setLanStatus('Connected!');
      updateModeControls();
      setMenusVisible(false);
      if (onlineMatchFlow) onlineMatchTransportReady();
      if (role === 'host') sendLanState(true);
      else if (!onlineMatchFlow) { sendPaddleSelection(); sendLanInput(null, true); }
    },
    error: code => {
      if (onlineSession !== session) return;
      // A connected but incompatible client still needs the existing setup
      // explanation/Retry UI; terminal departures return directly to the menu.
      if (session.multiplayerEstablished && code !== 'incompatible') {
        leaveMultiplayerSession(ONLINE_ERRORS[code] || ONLINE_ERRORS.connection_lost, false);
        return;
      }
      if (assignment) { failOnlineMatchFlow(code); return; }
      closeOnlineConnection(false);
      // Keep a disconnected guest from falling through to the local physics loop.
      onlineGameBlocked = true;
      paused = true;
      setLanPanelOpen(true);
      setMenusVisible(true);
      setLanStatus(assignment ? matchmakingError(code) : ONLINE_ERRORS[code] || ONLINE_ERRORS.connection_lost);
    }
  });
  session.pairingRequired = role === 'host' && !assignment && onlineManualLanSelected && playerPreference('verifyPairing');
  session.requireApproval = Boolean(byId('onlineRequireApproval')?.checked);
  onlineSession = session;
  session.multiplayerOrigin = onlineManualLanSelected ? 'lan' : assignment ? 'matchmaking' : 'private';
  syncMatchmakingUi();
  session.open(role, code, assignment);
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

window.addEventListener('pagehide', () => { stopMatchmaking(); if (onlineSession) onlineSession.close(); });
