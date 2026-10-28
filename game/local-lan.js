// Native sockets exchange signaling only. KingPongRoom still owns both WebRTC
// channels, input validation, prediction, reliable commands and snapshots.
let onlineLocalLanSelected = false;
let localLanGeneration = 0;
let localLanScan = 0;
let localLanScanTimer = null;
const localLanClosures = new Map();
let localLanRooms = [];
function hasNativeLan() { return Boolean(window.KingPongLan?.postMessage || window.KingPongNativeLan); }
function nativeLanCommand(op, generation, fields = {}) {
  const message = JSON.stringify({op, generation, ...fields});
  if (window.KingPongLan?.postMessage) window.KingPongLan.postMessage(message, window.KingPongLanToken);
  else window.chrome?.webview?.postMessage('kingpong:lan:' + message);
}
class KingPongLocalRoom extends KingPongRoom {
  open(role, target) {
    this.role = role; this.managed = true; this.generation = ++localLanGeneration;
    this.hooks.status('Connecting...');
    if (role === 'host') nativeLanCommand('host', this.generation);
    else nativeLanCommand('join', this.generation, {...target, token: kingPongClientToken().replaceAll('-', '')});
    this.openTimer = setTimeout(() => this.fail('timeout'), 12000);
  }
  async localEvent(event) {
    if (this.closed) return;
    if (event.type === 'hosting' || event.type === 'joined') {
      clearTimeout(this.openTimer); this.code = event.code;
      this.hooks.welcome(this.code);
      this.hooks.status(this.role === 'host' ? 'Waiting for Player 2...' : 'Waiting for host approval...');
      byId('localLanRoomCode').textContent = event.code;
      const address = byId('localLanAddress');
      if (this.role === 'host' && address) {
        address.textContent = (event.addresses || []).map(ip => localLanInvitation(ip, event.port, event.room, event.code)).join('\n');
        byId('localLanHint').textContent = `${localizeText('Local room')} ${event.room.slice(0, 4).toUpperCase()}`;
        refreshLanQr();
      }
      if (this.role === 'host' && !event.discovery) setLocalizedText(byId('localLanHint'), 'Discovery unavailable. Paste an invitation, or use manual pairing.');
    } else if (event.type === 'peer') {
      this.pendingRequests = [{request: event.request}];
      if (this.requireApproval) syncClassicApproval({pending: this.pendingRequests});
      else this.send({type: 'approve', request: event.request});
    } else if (event.type === 'admitted') {
      this.pendingRequests = []; syncClassicApproval({pending: []});
      const start = {type: 'start', attempt: 0, iceServers: []};
      nativeLanCommand('send', this.generation, {message: start});
      await this.receive(start);
      clearTimeout(this.directTimer); // No internet relay in LAN mode.
    } else if (event.type === 'signal') {
      await this.receive(event.message);
      clearTimeout(this.directTimer);
    } else if (event.type === 'departed') {
      this.pendingRequests = []; syncClassicApproval({pending: []});
      await this.receive({type: 'departed'});
      if (this.closed) return;
      byId('classicLanDialog').hidden = false; syncRoyalFocus();
    } else if (event.type === 'error') this.fail(event.code === 'room_full' ? 'full' : event.code);
  }
  send(message) {
    if (this.closed) return;
    if (message.type === 'approve' || message.type === 'reject') {
      nativeLanCommand('approve', this.generation, {request: message.request, accept: message.type === 'approve'});
    } else if (['description', 'candidate', 'connected'].includes(message.type)) nativeLanCommand('send', this.generation, {message});
  }
  kickGuest() { if (this.role === 'host' && !this.closed) { this.kickedGuest = true; nativeLanCommand('release', this.generation, {block: true}); } }
  waitForGuestDeparture() {
    if (this.role !== 'host' || this.closed) return false;
    nativeLanCommand('release', this.generation); return true;
  }
  relay() { // RTC failures never contact the online signaling/relay service.
    if (this.closed) return;
    if (this.role === 'host') nativeLanCommand('release', this.generation);
    else this.fail('timeout');
  }
  close() {
    if (this.closed) return this.networkClosed;
    this.networkClosed = new Promise(resolve => localLanClosures.set(this.generation, resolve));
    this.networkClosed.retry = () => {
      if (!localLanClosures.has(this.generation)) return;
      try { nativeLanCommand('close', this.generation); } catch { /* Unconfirmed native shutdown. */ }
    };
    this.networkClosed.release = () => localLanClosures.delete(this.generation);
    super.close();
    clearTimeout(localLanScanTimer); localLanScan = 0;
    byId('localLanScan').disabled = false;
    this.networkClosed.retry();
    clearLanQr(); byId('localLanAddress').textContent = ''; byId('localLanRoomCode').textContent = '';
    return this.networkClosed;
  }
}
window.KingPongLanReceive = event => {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'closed') {
    const finish = localLanClosures.get(event.generation);
    localLanClosures.delete(event.generation); finish?.(); return;
  }
  if (event.type === 'rooms' && event.generation === localLanScan && !byId('classicLanDialog')?.hidden) {
    localLanRooms = Array.isArray(event.rooms) ? event.rooms.slice(0, 32) : [];
    const select = byId('localLanRooms'); select.replaceChildren();
    for (const room of localLanRooms) {
      const option = document.createElement('option'); option.value = String(select.children.length);
      option.textContent = `${localizeText('Local room')} ${room.room.slice(0, 4).toUpperCase()}${room.full ? ' · ' + localizeText('Room full') : ''}`;
      option.disabled = Boolean(room.full); select.append(option);
    }
    const first = localLanRooms.findIndex(room => !room.full); select.value = String(first);
    setLocalizedText(byId('localLanHint'), localLanRooms.length ? 'Enter the code shown on the host.' : 'No local rooms found. Paste an invitation, or use manual pairing.');
    byId('localLanScan').disabled = false;
  }
  const session = onlineSession;
  if (session instanceof KingPongLocalRoom && event.generation === session.generation) {
    session.queue = session.queue.then(() => session.localEvent(event)).catch(() => session.fail('negotiation_failed'));
  }
};
function scanLocalLan() {
  if (!hasNativeLan() || byId('localLanScan').disabled) return;
  localLanScan = ++localLanGeneration; byId('localLanScan').disabled = true;
  nativeLanCommand('discover', localLanScan);
  setLocalizedText(byId('localLanHint'), 'Searching local network...');
  const generation = localLanScan;
  localLanScanTimer = setTimeout(() => { if (localLanScan === generation) byId('localLanScan').disabled = false; }, 4000);
}
function joinLocalLan() {
  const raw = byId('localLanCode').value.trim();
  const text = raw.toUpperCase();
  const direct = parseLocalLanInvitation(raw);
  const room = localLanRooms[Number(byId('localLanRooms').value)];
  const target = direct || (room && /^[A-HJ-NP-Z2-9]{6}$/.test(text) ? {...room, code: text} : null);
  if (!target) { setLocalizedText(byId('localLanHint'), 'Select a room and enter its code, or paste an invitation.'); return; }
  onlineManualLanSelected = onlineLocalLanSelected = true;
  openOnlineRoom('guest', target);
}
function installLocalLanUi(classic) {
  const auto = document.createElement('section'); auto.id = 'localLanSetup'; auto.hidden = !hasNativeLan();
  const actions = document.createElement('div'); actions.className = 'match-actions';
  actions.append(royalButton('localLanHost', 'Host LAN', () => { onlineManualLanSelected = onlineLocalLanSelected = true; openOnlineRoom('host'); }),
    royalButton('localLanScan', 'Join LAN / Search', scanLocalLan));
  const hint = document.createElement('p'); hint.id = 'localLanHint'; hint.className = 'match-note';
  setLocalizedText(hint, 'Enter the code shown on the host.');
  const label = document.createElement('label'); setLocalizedText(label, 'Local rooms');
  const rooms = document.createElement('select'); rooms.id = 'localLanRooms'; label.htmlFor = rooms.id;
  const code = document.createElement('input'); code.id = 'localLanCode'; code.maxLength = 64; code.autocomplete = 'off'; code.spellcheck = false;
  code.setAttribute('aria-label', localizeText('Room code or invitation'));
  const output = document.createElement('output'); output.id = 'localLanAddress'; output.style.whiteSpace = 'pre-wrap'; output.style.userSelect = 'text';
  const approvalLabel = document.createElement('label'); approvalLabel.className = 'lan-check';
  const approval = document.createElement('input'); approval.id='localLanApproval'; approval.type='checkbox'; approval.checked=playerPreference('hostApprovalRequired');
  const approvalText=document.createElement('span');setLocalizedText(approvalText,'Host approval required');
  approval.addEventListener('change',()=>{byId('onlineRequireApproval').checked=approval.checked;savePlayerPreference('hostApprovalRequired',approval.checked);});
  approvalLabel.append(approval,approvalText);
  auto.append(actions,approvalLabel,hint,label,rooms,code,royalButton('localLanJoin','Join',joinLocalLan),output,
    royalButton('localLanClose','Close room',()=>{closeLanConnection(false);output.textContent='';}));
  const roomCode = document.createElement('output'); roomCode.id='localLanRoomCode'; roomCode.setAttribute('aria-label',localizeText('Room Code')); auto.prepend(roomCode);
  classic.append(auto);
  installLanQrUi(classic);
  const manual = royalDisclosure('Manual pairing', 'manualLanPairing'); manual.open = !hasNativeLan(); classic.append(manual);
  return manual;
}
async function copyLanText() {
  const output = byId('classicLanOutput'); output.focus(); output.select();
  try { await navigator.clipboard.writeText(output.value); }
  catch { try { document.execCommand('copy'); } catch {} }
}
// Availability and bounded recovery are shared with online sessions.

// Compact direct fallback; the UI never displays addresses or device names.
function localLanInvitation(address, port, room, code) {
  const bytes = [...address.split('.').map(Number), port >> 8, port & 255,
    ...room.match(/../g).map(n => parseInt(n, 16)), ...Array.from(code, c => c.charCodeAt(0))];
  return 'KP1-' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function parseLocalLanInvitation(text) {
  if (!/^KP1-[A-Za-z0-9_-]{38}$/.test(text)) return null;
  try {
    const bytes = Uint8Array.from(atob(text.slice(4).replaceAll('-', '+').replaceAll('_', '/')+'=='), c => c.charCodeAt(0));
    const code = String.fromCharCode(...bytes.slice(22));
    if (bytes.length !== 28 || !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return null;
    const [a, b] = bytes, port = bytes[4] * 256 + bytes[5];
    if (!(a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a === 127) || !port) return null;
    return {address: [...bytes.slice(0, 4)].join('.'), port,
      room: [...bytes.slice(6,22)].map(n=>n.toString(16).padStart(2,'0')).join(''), code};
  } catch { return null; }
}
