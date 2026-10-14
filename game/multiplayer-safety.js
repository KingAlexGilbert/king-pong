let onlineManualLanSelected = false;
async function gatherClassicLanDescription(room) {
  const peer = room.peer;
  if (!peer) throw Error('connection_lost');
  if (peer.iceGatheringState !== 'complete') await new Promise(resolve => {
    const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', change); resolve(); };
    const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, 4000); peer.addEventListener('icegatheringstatechange', change);
  });
  clearTimeout(room.directTimer); clearTimeout(room.totalTimer); room.totalTimer = null;
  if (room.role === 'guest') room.totalTimer = setTimeout(() => room.fail('timeout'), 300000);
  if (room.closed || !peer.localDescription) throw Error('connection_lost');
  return peer.localDescription.toJSON();
}
class KingPongManualRoom extends KingPongRoom {
  async open(role, invitation = '') {
    this.role = role;
    try {
      if (role === 'host') {
        this.manualNonce = crypto.randomUUID(); this.code = this.manualNonce.slice(0, 5).toUpperCase();
        this.hooks.welcome(this.code);
        await this.receive({type: 'start', attempt: 0, iceServers: []});
        this.manualAt = Date.now();
        const description = await gatherClassicLanDescription(this);
        byId('classicLanOutput').value = btoa(JSON.stringify({protocol: 'kp-lan-two-1', room: this.code, nonce: this.manualNonce, description}));
      } else {
        const m = this.decode(invitation, 'offer'); this.code = m.room; this.manualNonce = m.nonce;
        this.hooks.welcome(this.code);
        await this.receive({type: 'start', attempt: 0, iceServers: []});
        await this.receive({type: 'description', attempt: 0, description: m.description});
        const description = await gatherClassicLanDescription(this);
        byId('classicLanOutput').value = btoa(JSON.stringify({...m, description}));
      }
      this.hooks.status('Exchange this text with the other device.');
    } catch { this.fail('negotiation_failed'); }
  }
  decode(text, type) {
    if (typeof text !== 'string' || text.length > 90000) throw Error();
    const m = JSON.parse(atob(text.trim()));
    if (m?.protocol !== 'kp-lan-two-1' || !/^[A-F0-9]{5}$/.test(m.room || '') || !/^[a-f0-9-]{36}$/.test(m.nonce || '') ||
        m.description?.type !== type || typeof m.description.sdp !== 'string' || m.description.sdp.length > 49152) throw Error();
    return m;
  }
  async accept(text) {
    try {
      const m = this.decode(text, 'answer');
      if (this.role !== 'host' || m.nonce !== this.manualNonce || m.room !== this.code || Date.now() - this.manualAt > 300000 || this.peer.remoteDescription) throw Error();
      await this.receive({type: 'description', attempt: 0, description: m.description});
      if (!this.connected) this.totalTimer = setTimeout(() => { if (!this.connected) this.fail('timeout'); }, 45000);
    } catch { this.hooks.status('Invalid or expired LAN answer.'); }
  }
  send() {}
  relay() { this.fail('timeout'); }
}
function syncClassicApproval(lobby) {
  const root = byId('classicRoomMembers'); if (!root) return;
  root.replaceChildren();
  if (lanRole !== 'host' || !onlineSession?.managed) return;
  for (const pending of lobby.pending || []) {
    const row = document.createElement('div'); row.className = 'match-row'; setLocalizedText(row, 'Join request');
    row.append(royalButton('', 'Accept', () => onlineSession?.send({type: 'approve', request: pending.request})),
      royalButton('', 'Reject', () => onlineSession?.send({type: 'reject', request: pending.request}))); root.append(row);
  }

}
function installMultiplayerSafety() {
  const privateRooms = byId('onlinePrivateRooms');
  const approvalLabel = document.createElement('label'); approvalLabel.className = 'lan-check';
  const approval = document.createElement('input'); approval.type = 'checkbox'; approval.id = 'onlineRequireApproval';
  const text = document.createElement('span'); setLocalizedText(text, 'Host approval required'); approvalLabel.append(approval, text);
  const members = document.createElement('div'); members.id = 'classicRoomMembers';
  privateRooms.append(approvalLabel, members);
  const kick = royalButton('classicKick', 'Kick', () => {
    if (!isLanHostActive() || onlineMatchAssignment) return;
    if (onlineSession?.managed) { onlineSession.send({type: 'kick', slot: 1}); return; }
    const channel = onlineControlChannel || lanChannel;
    try { channel?.send(JSON.stringify({type: 'room-removed', room: lanRoomCode})); } catch {}
    setTimeout(() => { closeLanConnection(false); paused = true; setMenusVisible(true); setLanStatus('A player disconnected. Return to the lobby for a new match.'); }, 100);
  });
  kick.hidden = true; byId('matchMenu').querySelector('.match-ui-card')?.append(kick);
  if (!kick.isConnected) byId('matchMenu').firstElementChild.append(kick);
  const receive = handleLanMessage;
  window.handleLanMessage = raw => {
    if (typeof raw === 'string' && raw.length < 8192 && isLanGuestActive()) {
      let message; try { message = JSON.parse(raw); } catch {}
      if (message?.type === 'room-removed' && message.room === lanRoomCode) {
        closeLanConnection(false); onlineGameBlocked = true; paused = true; setMenusVisible(true); setLanStatus('The host removed you from this room.'); return;
      }
    }
    receive(raw);
  };
  onlineRoomInput().maxLength = 6;
  const routeLabel = document.createElement('label'); routeLabel.className = 'lan-check';
  const routeBox = document.createElement('input'); routeBox.id = 'twoPlayerRoute'; routeBox.type = 'checkbox';
  const routeText = document.createElement('span'); setLocalizedText(routeText, 'Show connection type'); routeLabel.append(routeBox, routeText); byId('displaySettings').append(routeLabel);
  const route = document.createElement('p'); route.id = 'twoPlayerRouteLabel'; route.className = 'lan-route'; document.body.append(route);
  let statsBusy = false;
  setInterval(async () => {
    kick.hidden = !isLanHostActive() || Boolean(onlineMatchAssignment);
    if (!onlineSession?.managed) members.replaceChildren();
    approval.disabled = Boolean(onlineSession);
    if (!routeBox.checked || !lanPeer || !lanConnected || document.hidden) { route.textContent = ''; return; }
    if (statsBusy) return; statsBusy = true; const peer = lanPeer;
    try { const label = kingPongRoute(await peer.getStats()); if (lanPeer === peer) setLocalizedText(route, label); } catch { setLocalizedText(route, 'Unknown'); }
    finally { statsBusy = false; }
  }, 2000);
  const classic = royalDialog('classicLanDialog', 'LAN Play');
  const note = document.createElement('p'); setLocalizedText(note, 'LAN: create an invitation. Guest returns an answer; host accepts it. Invitations expire after 5 minutes.');
  const input = document.createElement('textarea'); input.id = 'classicLanInput'; input.setAttribute('aria-label', localizeText('Paste LAN invitation or answer'));
  const output = document.createElement('textarea'); output.id = 'classicLanOutput'; output.readOnly = true; output.setAttribute('aria-label', localizeText('Copy LAN invitation or answer'));
  classic.append(note, royalButton('classicLanHost', 'Create invitation', () => { onlineManualLanSelected = true; openOnlineRoom('host'); }),
    input, royalButton('classicLanJoin', 'Create answer', () => { onlineManualLanSelected = true; openOnlineRoom('guest', input.value); }),
    royalButton('classicLanAccept', 'Accept answer', () => onlineSession instanceof KingPongManualRoom && onlineSession.accept(input.value)), output,
    royalButton('classicLanClose', 'Close', () => { byId('classicLanDialog').hidden = true; }));
  classic.classList.add('four-lan-exchange');
  const choices = royalDialog('lanPlayerCount', 'LAN Play');
  choices.append(royalButton('lanTwoPlayers', 'Two Player', () => {
    byId('lanPlayerCount').hidden = true;
    if (onlineNativeTransport) { onlineManualLanSelected = false; startLanTwoPlayerSetup(true); }
    else { onlineManualLanSelected = true; startOnlineSetup(true); byId('classicLanDialog').hidden = false; }
  }), royalButton('lanCountBack', 'Back', () => { byId('lanPlayerCount').hidden = true; }));
  const lanButton = onlineNativeTransport ? titleLanButton : byId('titleNativeLanButton');
  lanButton.addEventListener('click', e => { e.stopImmediatePropagation(); byId('lanPlayerCount').hidden = false; byId('lanTwoPlayers').focus(); }, true);
  document.querySelector('.primary-online').addEventListener('click', () => { onlineManualLanSelected = false; byId('classicLanDialog').hidden = true; }, true);
  // Clamp the result of the existing movement code, only for networked paddles.
  // This also bounds combined keyboard/gamepad input and touch targets for both players.
  const updatePaddles = updatePlayerPaddles;
  window.updatePlayerPaddles = (...args) => {
    const networked = mode === 2 && (isLanHostActive() || isLanGuestActive());
    const previous = [left.y, right.y]; updatePaddles(...args);
    if (networked) {
      left.y = clamp(left.y, previous[0] - PADDLE_SPEED, previous[0] + PADDLE_SPEED);
      right.y = clamp(right.y, previous[1] - PADDLE_SPEED, previous[1] + PADDLE_SPEED);
      clampPaddleToVisiblePlayfield(left); clampPaddleToVisiblePlayfield(right);
    }
  };
  let gate = new KingPongInputGate(), packetGate = new KingPongInputGate(), packetSeq = 0, room = '', actionSeq = -1, sentAction = 0;
  const hostMessage = handleLanHostMessage;
  window.handleLanHostMessage = message => {
    if (room !== lanRoomCode || lanLastInputSeq === -1 && gate.seq !== -1) { room = lanRoomCode; gate = new KingPongInputGate(); packetGate = new KingPongInputGate(); actionSeq = -1; }
    const now = performance.now();
    if (!packetGate.accept(++packetSeq, now)) return;
    if (message.type === 'input') {
      const bounds = visiblePlayfieldBounds();
      if (!Number.isFinite(message.axis) || Math.abs(message.axis) > 1 || message.targetY != null && (!Number.isFinite(message.targetY) || message.targetY < bounds.top || message.targetY > bounds.bottom - PADDLE_H) || !gate.accept(message.seq, now)) return;
    }
    if (message.type === 'action' && onlineSession && onlineIntentReady && message.actionSeq === undefined) return;
    if (message.type === 'action' && message.actionSeq !== undefined) {
      if (!Number.isSafeInteger(message.actionSeq) || message.actionSeq < 0 || message.actionSeq <= actionSeq) return;
      actionSeq = message.actionSeq;
    }
    hostMessage(message);
  };
  const send = lanSend;
  window.lanSend = payload => { if (payload.type === 'action') payload.actionSeq = ++sentAction; return send(payload); };
}
