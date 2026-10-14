const FOUR_ERRORS = {
  ...ONLINE_ERRORS,
  incompatible: 'Four-player protocol mismatch. Update all players.',
  invalid_code: 'Enter a valid six-character room code or LAN invitation.',
  wrong_mode: 'This room uses a different player count. Choose the matching multiplayer menu.',
  kicked: 'The host removed you from this room.',
  rejected: 'The host declined your join request.',
  blocked: 'You cannot rejoin this room. Ask the host for a new room.',
  unapproved: 'Wait for the host to accept your request.',
  approval_timeout: 'Join request expired. Ask the host to try again.',
  unauthorized: 'Room permission denied.',
  guest_left: 'A player disconnected. Return to the lobby for a new match.'
};
function fourConfigValid(c) {
  return !!c && ['ffa', 'teams'].includes(c.variant) && [3, 5, 10].includes(c.lives) && [5, 10, 20].includes(c.goal) &&
    ['easy', 'normal', 'hard'].includes(c.difficulty) && typeof c.powerups === 'boolean' && typeof c.hiddenWall === 'boolean' &&
    Array.isArray(c.bots) && c.bots.length === 4 && c.bots.every(b => typeof b === 'boolean');
}
function fourSameConfig(a, b) { return JSON.stringify(KingPongFour.config(a)) === JSON.stringify(KingPongFour.config(b)); }

class FourNetworkSession {
  constructor(view, host, lan = false) {
    this.view = view; this.host = host; this.closed = false; this.gates = new Map(); this.inputs = new Map(); this.hellos = new Set();
    this.paddles = ['classic', 'classic', 'classic', 'classic']; this.snapshots = []; this.history = new Map(); this.sequence = 0; this.packetGates = new Map(); this.packetSequence = 0;
    this.lastState = -1; this.lastControl = -1; this.controlSequence = 0; this.matchSerial = 0; this.actionAt = new Map(); this.ready = false; this.interruptedPeers = new Set(); this.initializedPeers = new Set();
    this.stats = {sentInputs: 0, receivedInputs: 0, snapshots: 0, dropped: 0, receivedBytes: 0};
    const hooks = {
      welcome: m => { view.side = m.slot; view.networkCode.textContent = m.code; this.status(m.slot < 0 ? 'Waiting for host approval...' : 'Waiting for players...'); this.refresh(); },
      approved: slot => { view.side = slot; this.status('Connecting...'); this.refresh(); },
      status: text => this.status(text), error: code => this.failure(code),
      connected: slot => { this.transport.joined?.(slot); this.hello(slot); this.refresh(); },
      message: (slot, raw) => this.receive(slot, raw),
      peerError: (slot, code) => {
        if (this.transport.lan && this.host) this.transport.drop(slot, code);
        else if (this.host) { this.transport.send({type: 'kick', slot}); this.departed(slot, code); }
        else this.failure(code);
      },
      interrupted: slot => { this.interruptedPeers.add(slot); this.interrupted = true; this.inputs.delete(slot); if (view.active) { KingPongFour.pause(view.state); this.snapshot(true); } this.status('Connection interrupted. Reconnecting...'); },
      resumed: slot => { this.interruptedPeers.delete(slot); this.interrupted = this.interruptedPeers.size > 0; this.snapshot(true); this.status(this.interrupted ? 'Connection interrupted. Reconnecting...' : 'Connected!'); },
      lobby: lobby => { this.lobby = lobby; this.refresh(); if (this.host && !lobby.config) this.configure(); this.maybeStart(); },
      locked: config => {
        if (!fourConfigValid(config)) return this.failure('incompatible');
        this.lockedConfig = config;
        if (this.host) this.begin(config); else if (this.pendingInit) this.initialize(this.pendingInit);
      },
      departed: (slot, reason) => this.departed(slot, reason)
    };
    this.transport = lan ? new KingPongLanParty(hooks) : new KingPongParty(window.KING_PONG_SIGNALING_URL, hooks);
    this.timer = setInterval(() => {
      if (this.closed) return;
      for (const [slot, link] of this.transport.peers) if (link.connected && !this.hellos.has(slot)) this.hello(slot);
      this.maybeStart(); this.refresh(); this.routes();
      if (this.host && this.startPending) {
        if (performance.now() - this.startAt > 8000) { this.failure('connection_lost'); return; }
        for (const slot of this.transport.peers.keys()) if (!this.initializedPeers.has(slot)) this.sendInit(slot);
      }
      // A hidden/frozen host pauses, then keeps control and snapshots alive without running physics.
      if (this.host && view.active && (document.hidden || performance.now() - (this.lastTickAt || 0) > 500)) {
        KingPongFour.pause(view.state); this.snapshot(true);
      }
    }, 500);
  }
  open(code = '') { this.transport.open(this.host, code, this.view.approval.checked); }
  status(text) { setLocalizedText(this.view.networkStatus, text); if (this.view.active) setLocalizedText(this.view.result, text); }
  hello(slot) { this.transport.data(slot, {k4: 1, type: 'hello', slot: this.view.side, paddle: this.view.paddle.value}, true); }
  receive(slot, raw) {
    if (this.closed || typeof raw !== 'string' || raw.length > 8192 || !this.transport.peers.get(slot)?.connected) return;
    const rate = this.packetGates.get(slot) || new KingPongInputGate(); this.packetGates.set(slot, rate);
    if (!rate.accept(++this.packetSequence, performance.now())) { this.stats.dropped++; return; }
    this.stats.receivedBytes += new TextEncoder().encode(raw).length;
    let m; try { m = JSON.parse(raw); } catch { this.stats.dropped++; return; }
    if (this.transport.lan && m?.lanLobby === 1) {
      if (this.host) { if (['ready'].includes(m.type) && this.hellos.has(slot)) this.transport.control(slot, m); }
      else if (slot === 0) {
        if (m.type === 'lobby') { this.transport.lobby = m; this.lobby = m; this.refresh(); }
        else if (m.type === 'locked') this.transport.hooks.locked(m.config);
        else if (m.type === 'departed') this.departed(m.slot, m.reason);
        else if (m.type === 'error') this.failure(m.code);
      }
      return;
    }
    if (m?.k4 === 1 && m.type === 'hello' && m.slot === slot && paddleCatalog.some(p => p.id === m.paddle)) {
      const first = !this.hellos.has(slot); this.hellos.add(slot); this.paddles[slot] = m.paddle;
      if (first) this.hello(slot);
      if (this.host && this.view.active) this.sendInit(slot);
      this.refresh(); return;
    }
    if (!this.hellos.has(slot)) { this.stats.dropped++; return; }
    if (!Array.isArray(m)) {
      if (m?.k4 !== 1) return;
      if (this.host && m.type === 'init-ack' && m.match === this.match && m.serial === this.matchSerial) {
        this.initializedPeers.add(slot);
        if ([...this.transport.peers.keys()].every(peerSlot => this.initializedPeers.has(peerSlot))) { this.startPending = false; this.snapshot(true); }
        return;
      }
      if (!this.host && slot === 0 && m.type === 'init') { this.initialize(m); return; }
      if (m.type === 'action' && this.host && m.match === this.match && ['pause', 'resume', 'rematch'].includes(m.name) &&
          Number.isSafeInteger(m.seq) && m.seq >= 0) {
        const record = this.actionAt.get(slot), now = performance.now();
        if (record && (m.seq <= record.seq || now - record.at < 300)) return;
        this.actionAt.set(slot, {seq: m.seq, at: now});
        // Anyone can pause. Only the host resumes or restarts a private match.
        if (m.name === 'pause') this.action('pause');
      }
      return;
    }
    if (m[0] !== 'k4' || m[1] !== 1 || m[2] !== this.match || !this.view.active) { this.stats.dropped++; return; }
    const now = performance.now(), K = KingPongFour;
    if (this.host && m[3] === 'i' && m.length === 7 && K.validInput({axis: m[5], target: m[6]})) {
      const gate = this.gates.get(slot) || new KingPongInputGate(); this.gates.set(slot, gate);
      if (!gate.accept(m[4], now)) { this.stats.dropped++; return; }
      this.inputs.set(slot, {axis: m[5], target: m[6], at: now, seq: m[4]}); this.stats.receivedInputs++;
    } else if (!this.host && slot === 0 && m[3] === 's' && m.length === 7 && Number.isSafeInteger(m[4]) && m[4] > this.lastState &&
        Number.isSafeInteger(m[5]) && m[5] >= -1 && K.validState(m[6], this.view.state.config)) {
      const next = K.unpack(m[6], this.view.state.config);
      if (next.tick < this.view.state.tick || next.epoch < this.view.state.epoch) return;
      const reset = next.epoch !== this.view.state.epoch || next.paused || next.countdown > 0;
      this.lastState = m[4]; this.inputAck = Math.max(this.inputAck ?? -1, m[5]);
      const position = next.paddles[this.view.side].pos;
      if (reset || this.predicted === undefined) this.predicted = position;
      else if (this.history.has(m[5])) this.predicted = K.clamp(this.predicted + position - this.history.get(m[5]), 0, K.SIZE - K.PADDLE);
      for (const seq of this.history.keys()) if (seq <= m[5]) this.history.delete(seq);
      if (reset) { this.snapshots = []; this.history.clear(); }
      this.view.state = next; this.snapshots.push({at: now, state: next}); this.snapshots = this.snapshots.slice(-12); this.lastReceive = now;
      this.stats.snapshots++;
      if (!next.paused) this.view.menu.hidden = true;
    } else this.stats.dropped++;
  }
  initialize(m) {
    if (!this.lockedConfig) { this.pendingInit = m; return; }
    if (m.match === this.match && m.serial === this.matchSerial) {
      this.transport.data(0, {k4: 1, type: 'init-ack', match: this.match, serial: this.matchSerial}, true); return;
    }
    if (this.host || !Number.isSafeInteger(m.serial) || m.serial < 1 || m.serial <= this.matchSerial ||
        typeof m.match !== 'string' || !/^[a-f0-9-]{36}$/.test(m.match) || !fourConfigValid(m.config) || !fourSameConfig(m.config, this.lockedConfig) ||
        !KingPongFour.validState(m.state, m.config) || !Array.isArray(m.paddles) || m.paddles.length !== 4 || !m.paddles.every(id => paddleCatalog.some(p => p.id === id))) return;
    this.match = m.match; this.matchSerial = m.serial; this.sequence = 0; this.lastState = -1; this.history.clear(); this.snapshots = [];
    this.lastInput = null; this.inputAck = -1; this.paddles = m.paddles; this.lastReceive = performance.now(); this.pendingInit = null;
    this.view.start(m.config, KingPongFour.unpack(m.state, m.config)); this.predicted = this.view.state.paddles[this.view.side].pos;
    this.transport.data(0, {k4: 1, type: 'init-ack', match: this.match, serial: this.matchSerial}, true); this.refresh();
  }
  begin(config) {
    if (!this.host || this.closed) return;
    this.match = crypto.randomUUID(); this.matchSerial++; this.sequence = 0; this.gates.clear(); this.inputs.clear(); this.actionAt.clear();
    this.initializedPeers.clear(); this.startPending = this.transport.peers.size > 0; this.startAt = performance.now();
    this.paddles[0] = this.view.paddle.value;
    this.view.start(config); for (const slot of this.transport.peers.keys()) this.sendInit(slot); this.refresh();
  }
  sendInit(slot) { this.transport.data(slot, {k4: 1, type: 'init', match: this.match, serial: this.matchSerial, config: this.view.state.config, state: KingPongFour.pack(this.view.state), paddles: this.paddles}, true); }
  tick(input, now) {
    if (this.closed) return;
    this.lastTickAt = now;
    const K = KingPongFour, s = this.view.state;
    if (this.host) {
      if (this.startPending) return;
      const inputs = [input];
      for (let side = 1; side < 4; side++) { const record = this.inputs.get(side); inputs[side] = record && now - record.at < 1200 ? record : {axis: 0, target: null}; }
      K.step(s, inputs); if (s.tick % (s.paused ? 15 : 3) === 0) this.snapshot();
    } else {
      if (now - this.lastReceive > 1500) { s.paused = true; this.view.menu.hidden = false; this.status('Connection interrupted. Reconnecting...'); }
      if (now - this.lastReceive > 8000) { this.failure('connection_lost'); return; }
      if (!s.paused && !s.countdown && s.winner < 0 && s.paddles[this.view.side].alive) {
        const delta = input.target === null ? input.axis * K.SPEED : K.clamp(input.target - this.predicted, -K.SPEED, K.SPEED);
        this.predicted = K.clamp(this.predicted + delta, 0, K.SIZE - K.PADDLE);
      }
      const changed = !this.lastInput || input.axis !== this.lastInput.axis || input.target !== this.lastInput.target;
      const acked = this.lastInput && this.inputAck >= this.lastInput.proof;
      const delay = input.axis === 0 && acked && !changed ? 250 : 1000 / 30;
      if (changed || now - (this.lastInput?.at ?? -Infinity) >= delay) {
        const seq = ++this.sequence;
        if (this.transport.data(0, ['k4', 1, this.match, 'i', seq, input.axis, input.target])) {
          this.history.set(seq, this.predicted); if (this.history.size > 120) this.history.delete(this.history.keys().next().value);
          this.lastInput = {...input, at: now, proof: changed ? seq : this.lastInput.proof}; this.stats.sentInputs++;
        }
      }
    }
  }
  snapshot(reliable = false) {
    if (!this.host || !this.view.active || !this.match || this.closed) return;
    const seq = ++this.sequence, state = KingPongFour.pack(this.view.state);
    for (const slot of this.transport.peers.keys()) this.transport.data(slot, ['k4', 1, this.match, 's', seq, this.inputs.get(slot)?.seq ?? -1, state], reliable);
  }
  visual(now) {
    const K = KingPongFour;
    if (this.host) return K.interpolate(this.view.previous, this.view.current, this.view.accumulator / (1000 / 60));
    let state = this.view.state;
    if (this.snapshots.length && !state.paused && !state.countdown) {
      const target = now - 70;
      let a = this.snapshots[0], b = a;
      for (const item of this.snapshots) { if (item.at <= target) a = item; if (item.at >= target) { b = item; break; } b = item; }
      state = K.interpolate(a.state, b.state, b.at > a.at ? K.clamp((target - a.at) / (b.at - a.at), 0, 1) : 1);
    } else state = K.unpack(K.pack(state), state.config);
    if (Number.isFinite(this.predicted)) return {...state, paddles: state.paddles.map((p, side) => side === this.view.side ? {...p, pos: this.predicted} : p)};
    return state;
  }
  action(name) {
    if (this.closed) return;
    this.view.target = null; clearHeldInput();
    if (!this.host) {
      if (name === 'pause') { this.transport.data(0, {k4: 1, type: 'action', match: this.match, seq: ++this.controlSequence, name}, true); this.view.menu.hidden = false; }
      return;
    }
    if (name === 'pause') { KingPongFour.pause(this.view.state); this.view.menu.hidden = false; }
    if (name === 'resume' && !this.interrupted && !this.startPending) { KingPongFour.resume(this.view.state); this.view.menu.hidden = true; }
    if (name === 'rematch' && !this.interrupted && !this.startPending) this.begin(this.view.state.config);
    this.snapshot(true);
  }
  configure() {
    if (this.host && !this.view.active) this.transport.send({type: 'configure', config: this.view.options(), fill: this.view.fill.checked});
  }
  wait() { if (this.host) this.transport.send({type: 'wait'}); }
  readyUp() {
    if (this.host || !this.hellos.has(0) || !this.lobby?.config) return;
    this.ready = !this.ready; this.transport.send({type: 'ready', ready: this.ready, consent: this.view.consent.checked});
  }
  maybeStart() {
    const l = this.lobby;
    if (!this.host || this.interrupted || !l || l.started || l.waitAt === null || !l.config || !l.players.every(p => p.connected && p.ready && (p.slot === 0 || this.hellos.has(p.slot)))) return;
    if (l.players.length === 4 || l.fill && Date.now() - l.waitAt >= 180000 && l.players.every(p => p.consent)) this.transport.send({type: 'lock'});
  }
  refresh() {
    const v = this.view, l = this.lobby;
    for (const input of [v.variant, v.lives, v.goal, v.difficulty, v.powerups, v.hiddenWall, v.fill]) input.disabled = !this.host || v.active || input === v.hiddenWall && !isBossUnlocked();
    v.paddle.disabled = this.hellos.size > 0 || v.active;
    v.hostButton.hidden = v.joinButton.hidden = true; v.disconnectButton.hidden = false;
    v.waitButton.hidden = !this.host || v.active; v.readyButton.hidden = this.host || v.active;
    v.readyButton.disabled = !this.hellos.has(0) || !l?.config;
    v.consent.parentElement.hidden = this.host || !l?.fill;
    v.waitButton.disabled = !l?.config || l?.waitAt !== null && l?.waitAt !== undefined;
    v.approval.disabled = true; v.practiceButton.disabled = true;
    byId('fourResume').disabled = !this.host || this.interrupted || this.startPending;
    byId('fourRematch').disabled = !this.host || this.interrupted || this.startPending;
    if (l?.config && !this.host) {
      v.variant.value = l.config.variant; v.lives.value = String(l.config.lives); v.goal.value = String(l.config.goal); v.difficulty.value = l.config.difficulty;
      v.powerups.checked = l.config.powerups; v.hiddenWall.checked = l.config.hiddenWall; v.fill.checked = l.fill; v.syncSettings();
      const self = l.players.find(p => p.slot === v.side); this.ready = Boolean(self?.ready);
    }
    setLocalizedText(v.readyButton, this.ready ? 'Not ready' : 'Ready');
    const key = JSON.stringify([l?.players, l?.pending, l?.waitAt, l?.fill, [...this.hellos], v.active]);
    if (key !== this.rosterKey) {
      this.rosterKey = key; v.roster.replaceChildren(); v.kicks.replaceChildren();
      for (let i = 0; i < 4; i++) {
        const player = l?.players.find(p => p.slot === i), row = document.createElement('div'); row.className = 'four-slot';
        row.textContent = 'P' + (i + 1) + ' · ' + localizeText(player ? player.connected && (i === 0 || this.hellos.has(this.host ? i : 0)) ? player.ready ? 'Ready' : 'Connected!' : 'Connecting...' : 'Open slot');
        if (this.host && player && i > 0) {
          const kick = () => this.transport.send({type: 'kick', slot: i});
          row.append(v.button('fourKick' + i, 'Kick', kick));
          const inGame = v.button('fourGameKick' + i, 'Kick', kick); inGame.setAttribute('aria-label', localizeText('Kick') + ' P' + (i + 1));
          const label = document.createElement('span'); label.textContent = 'P' + (i + 1) + ' '; label.append(inGame); v.kicks.append(label);
        }
        v.roster.append(row);
      }
      for (const pending of l?.pending || []) {
        const row = document.createElement('div'); row.className = 'four-slot'; setLocalizedText(row, 'Join request');
        row.append(v.button('', 'Accept', () => this.transport.send({type: 'approve', request: pending.request})),
          v.button('', 'Reject', () => this.transport.send({type: 'reject', request: pending.request}))); v.roster.append(row);
      }
    }
    v.waitTime.textContent = l?.waitAt !== null && l?.waitAt !== undefined && !l.started ? localizeText('Waiting for ready players') + (l.fill ? ' · ' + Math.max(0, Math.ceil((180000 - (Date.now() - l.waitAt)) / 1000)) + ' s' : '') : '';
  }
  async routes() {
    const v = this.view;
    if (!v.showRoute.checked || this.routesBusy || performance.now() - (this.lastRoutesAt || 0) < 2000) { if (!v.showRoute.checked) v.route.textContent = ''; return; }
    this.routesBusy = true; this.lastRoutesAt = performance.now();
    try {
      const labels = await Promise.all([...this.transport.peers].map(async ([slot, link]) => {
        let label = 'Unknown'; try { if (link.peer) label = kingPongRoute(await link.peer.getStats()); } catch {}
        return 'P' + (slot + 1) + ': ' + localizeText(label);
      }));
      if (!this.closed) v.route.textContent = labels.join(' · ');
    } finally { this.routesBusy = false; }
  }
  departed(slot, reason) {
    this.interruptedPeers.delete(slot); this.interrupted = this.interruptedPeers.size > 0;
    this.hellos.delete(slot); this.inputs.delete(slot); this.gates.delete(slot);
    if (this.view.active) this.failure(reason === 'kicked' ? 'guest_left' : reason);
    else { this.status(FOUR_ERRORS[reason] || FOUR_ERRORS.guest_left); this.refresh(); }
  }
  failure(code) {
    if (this.closed) return;
    const message = FOUR_ERRORS[code] || FOUR_ERRORS.connection_lost;
    if (this.view.active) { KingPongFour.pause(this.view.state); this.view.menu.hidden = false; }
    this.close(); this.status(message);
    byId('fourResume').disabled = byId('fourRematch').disabled = true;
    this.view.networkStatus.hidden = false;
    // Keep the final paused frame visible; exiting opens a fresh setup without stale peers.
    if (this.view.active) { this.view.result.textContent = localizeText(message); this.view.disconnectedMessage = message; }
  }
  close() { if (this.closed) return; this.closed = true; clearInterval(this.timer); this.transport.close(); }
}

function installFourNetworkUi(v) {
  if (!v.networkBuilt) {
    v.networkBuilt = true;
    const panel = v.networkPanel;
    const check = (id, text) => { const label = document.createElement('label'); label.className = 'four-check'; const box = document.createElement('input'); box.type = 'checkbox'; box.id = id; label.append(box, v.text('span', text)); panel.append(label); return box; };
    v.approval = check('fourApproval', 'Host approval required');
    v.fill = check('fourFillBots', 'Fill empty slots with bots after 3 minutes');
    v.consent = check('fourBotConsent', 'I agree to play with bots');
    v.showRoute = check('fourShowRoute', 'Show connection type');
    v.networkCode = v.text('strong', '', 'four-code'); v.networkCode.id = 'fourRoomCode';
    v.codeInput = document.createElement('input'); v.codeInput.id = 'fourCodeInput'; v.codeInput.maxLength = 6;
    v.codeInput.setAttribute('aria-label', localizeText('Room Code')); v.codeInput.autocomplete = 'off'; v.codeInput.spellcheck = false;
    v.networkStatus = v.text('p', 'Create or join a private four-player room.'); v.networkStatus.id = 'fourNetworkStatus'; v.networkStatus.setAttribute('aria-live', 'polite');
    v.waitTime = v.text('p', '');
    const open = host => {
      if (v.session) v.session.close();
      const code = v.codeInput.value.trim().toUpperCase();
      if (!host && v.transport !== 'lan' && !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { setLocalizedText(v.networkStatus, FOUR_ERRORS.invalid_code); return; }
      v.session = new FourNetworkSession(v, host, v.transport === 'lan'); v.side = host ? 0 : -1; v.session.open(code); v.session.refresh();
      if (v.transport === 'lan') { v.lanExchange.hidden = false; v.lanOffer.hidden = !host; v.lanApply.textContent = localizeText(host ? 'Accept answer' : 'Create answer'); }
    };
    const actions = document.createElement('div'); actions.className = 'four-actions';
    v.hostButton = v.button('fourHost', 'Create Room', () => open(true)); v.joinButton = v.button('fourJoin', 'Join Room', () => open(false));
    v.disconnectButton = v.button('fourDisconnect', 'Disconnect', () => { v.session?.close(); v.session = null; installFourNetworkUi(v); });
    v.waitButton = v.button('fourWait', 'Start waiting', () => v.session?.wait());
    v.readyButton = v.button('fourReady', 'Ready', () => v.session?.readyUp());
    v.consent.addEventListener('change', () => { if (v.session?.ready) { v.session.ready = false; v.session.transport.send({type: 'ready', ready: false, consent: false}); } });
    actions.append(v.hostButton, v.joinButton, v.disconnectButton, v.waitButton, v.readyButton);
    v.roster = document.createElement('div'); v.roster.id = 'fourRoster';
    v.kicks = document.createElement('div'); v.kicks.className = 'four-actions'; v.menu.append(v.kicks);
    v.lanExchange = document.createElement('div'); v.lanExchange.className = 'four-lan-exchange';
    v.lanIn = document.createElement('textarea'); v.lanIn.id = 'fourLanInput'; v.lanIn.setAttribute('aria-label', localizeText('Paste LAN invitation or answer'));
    v.lanOut = document.createElement('textarea'); v.lanOut.id = 'fourLanOutput'; v.lanOut.readOnly = true; v.lanOut.setAttribute('aria-label', localizeText('Copy LAN invitation or answer'));
    const operation = async fn => { v.lanOffer.disabled = v.lanApply.disabled = true;
      try { const result = await fn(); if (result) v.lanOut.value = result; setLocalizedText(v.networkStatus, 'Exchange this text with the other device.'); }
      catch (e) { setLocalizedText(v.networkStatus, FOUR_ERRORS[e.message] || FOUR_ERRORS.negotiation_failed); }
      finally { v.lanOffer.disabled = v.lanApply.disabled = false; } };
    v.lanOffer = v.button('fourLanOffer', 'Create invitation', () => operation(() => v.session.transport.offer()));
    v.lanApply = v.button('fourLanApply', 'Create answer', () => operation(() => v.session.host ? v.session.transport.accept(v.lanIn.value) : v.session.transport.answer(v.lanIn.value)));
    v.lanExchange.append(v.text('p', 'LAN: create one invitation per guest. Guest returns an answer; host accepts it. Invitations expire after 5 minutes.'), v.lanOffer, v.lanIn, v.lanApply, v.lanOut);
    panel.append(v.networkCode, v.codeInput, actions, v.networkStatus, v.waitTime, v.roster, v.lanExchange);
    v.practiceButton = byId('fourPractice');
    for (const input of [v.variant, v.lives, v.goal, v.difficulty, v.powerups, v.hiddenWall, v.fill]) input.addEventListener('change', () => v.session?.configure());
  }
  v.hostButton.hidden = v.joinButton.hidden = false;
  v.disconnectButton.hidden = v.waitButton.hidden = v.readyButton.hidden = v.consent.parentElement.hidden = v.lanExchange.hidden = true;
  v.codeInput.hidden = v.transport === 'lan'; v.codeInput.value = ''; v.networkCode.textContent = ''; v.roster.replaceChildren(); v.kicks.replaceChildren(); v.waitTime.textContent = '';
  v.approval.parentElement.hidden = v.transport === 'lan'; v.approval.disabled = false;
  for (const input of [v.variant, v.lives, v.goal, v.difficulty, v.powerups, v.fill, v.paddle, v.practiceButton]) input.disabled = false;
  byId('fourResume').disabled = byId('fourRematch').disabled = false;
  v.disconnectedMessage = null; v.consent.checked = false; v.lanIn.value = v.lanOut.value = '';
  setLocalizedText(v.networkStatus, v.transport === 'lan' ? 'LAN connections stay on your network. No signaling server is used.' : 'Create or join a private four-player room.');
}
