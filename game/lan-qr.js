// QR is a local transfer method for existing invitations, never a new protocol
// or evidence of authentication. Joining still uses approval and optional PINs.
let lanQrStream = null, lanQrEpoch = 0, lanQrTimer = 0, lanQrPendingHost = false;
const LAN_QR_LIMIT = 2200;

function validateLanQr(raw) {
  if (typeof raw !== 'string' || raw.length > LAN_QR_LIMIT) return null;
  const text = raw.trim();
  if (parseLocalLanInvitation(text)) return {kind: 'native', text};
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  for (const kind of ['offer', 'answer']) {
    try { KingPongManualRoom.prototype.decode(text, kind); return {kind, text}; } catch {}
  }
  return null;
}
function lanQrStatus(message) { setLocalizedText(byId('lanQrStatus'), message); }
function refreshLanQr() {
  if (byId('lanQr')?.open && (lanQrPendingHost || !byId('lanQrDisplay').hidden)) {
    lanQrPendingHost = false;
    showLanQr(false);
  }
}
function createLanQr() {
  const existing = (byId('localLanAddress')?.textContent || '').split('\n').find(text => parseLocalLanInvitation(text)) ||
    byId('classicLanOutput')?.value || '';
  if (onlineSession && !onlineSession.closed) {
    if (validateLanQr(existing)) { lanQrPendingHost = false; showLanQr(); return; }
    lanQrStatus('Close the current LAN connection before creating another room.'); return;
  }
  // Native builds host offline TCP signaling; browsers create the existing
  // offer/answer invitation. Neither path contacts the online signaling Worker.
  onlineManualLanSelected = true;
  onlineLocalLanSelected = hasNativeLan();
  openOnlineRoom('host');
  if (!onlineSession || onlineSession.closed) return;
  lanQrPendingHost = true;
  lanQrStatus('Creating a room and QR code...');
}
function showLanQr(scroll = true) {
  stopLanQrCamera();
  const display = byId('lanQrDisplay'), choice = byId('lanQrChoice');
  const invitations = (byId('localLanAddress')?.textContent || '').split('\n').filter(text => parseLocalLanInvitation(text));
  const selected = Number(choice.value) || 0;
  choice.replaceChildren();
  invitations.forEach((text, i) => {
    const option = document.createElement('option'); option.value = String(i);
    option.textContent = localizeText('Invitation') + ' ' + (i + 1); choice.append(option);
  });
  choice.hidden = invitations.length < 2;
  choice.value = String(Math.min(selected, Math.max(0, invitations.length - 1)));
  const raw = invitations[Number(choice.value)] || byId('classicLanOutput')?.value || '';
  const invitation = validateLanQr(raw);
  display.replaceChildren(); display.hidden = true;
  if (!invitation) {
    lanQrStatus(raw.length > LAN_QR_LIMIT ? 'This invitation is too large for one QR code. Use Copy and manual pairing.' :
      'Host a room or create a manual invitation, then show its QR code.'); return;
  }
  const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', localizeText('LAN invitation QR code'));
  QrCreator.render({text: invitation.text, radius: 0, ecLevel: 'M', fill: '#000000', background: '#ffffff',
    quiet: 4, size: invitation.kind === 'native' ? 296 : 740}, canvas);
  display.append(canvas); display.hidden = false;
  lanQrStatus(invitation.kind === 'native' ? 'Scan in King Pong, then Join. Host approval and optional PIN verification still apply.' :
    'Manual pairing needs two QR codes: invitation to guest, then answer back to host. Use Copy if the code is too dense.');
  if (scroll) canvas.scrollIntoView({block: 'center'});
}
function acceptLanQr(raw) {
  const invitation = validateLanQr(raw);
  if (!invitation) { lanQrStatus('Invalid King Pong invitation. Scan another code or use manual entry.'); return false; }
  stopLanQrCamera();
  if (invitation.kind === 'native') {
    if (!hasNativeLan()) {
      lanQrStatus('This local invitation requires the native King Pong app. Browser players can use manual pairing.'); return true;
    }
    byId('localLanCode').value = invitation.text;
    lanQrStatus('Invitation scanned. Select Join to request host approval.'); byId('localLanJoin').focus();
  } else {
    byId('classicLanInput').value = invitation.text; byId('manualLanPairing').open = true;
    lanQrStatus(invitation.kind === 'offer' ? 'Invitation scanned. Create an answer, then show its QR code to the host.' :
      'Answer scanned. Select Accept answer on the host.');
  }
  return true;
}
function stopLanQrCamera() {
  lanQrEpoch++; clearTimeout(lanQrTimer); lanQrTimer = 0;
  for (const track of lanQrStream?.getTracks() || []) track.stop();
  lanQrStream = null;
  const video = byId('lanQrVideo');
  if (video) { video.pause(); video.srcObject = null; video.hidden = true; }
  if (byId('lanQrStop')) byId('lanQrStop').hidden = true;
  if (byId('lanQrScan')) byId('lanQrScan').disabled = false;
  window.KingPongCamera?.cancel(window.KingPongLanToken);
}
window.KingPongQrStop = stopLanQrCamera;
async function startLanQrCamera() {
  stopLanQrCamera();
  if (!navigator.mediaDevices?.getUserMedia) { lanQrStatus('Camera scanning is unavailable here. Use a secure browser or manual entry.'); return; }
  const epoch = lanQrEpoch, video = byId('lanQrVideo');
  byId('lanQrScan').disabled = true; byId('lanQrStop').hidden = false; byId('lanQrDisplay').hidden = true;
  lanQrStatus('Point the camera at a King Pong QR code.');
  try {
    window.KingPongCamera?.arm(window.KingPongLanToken);
    const stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {
      facingMode: {ideal: 'environment'}, width: {ideal: 640}, height: {ideal: 480}
    }});
    if (epoch !== lanQrEpoch || document.hidden || byId('classicLanDialog').hidden || !byId('lanQr').open) {
      stream.getTracks().forEach(track => track.stop()); return;
    }
    lanQrStream = stream; video.srcObject = stream; video.hidden = false; await video.play();
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', {willReadFrequently: true});
    const scan = () => {
      if (epoch !== lanQrEpoch) return;
      if (document.hidden || byId('classicLanDialog').hidden || !byId('lanQr').open) { stopLanQrCamera(); return; }
      try {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(pixels.data, pixels.width, pixels.height, {inversionAttempts: 'dontInvert'});
          if (result && acceptLanQr(result.data)) return;
        }
        lanQrTimer = setTimeout(scan, 160);
      } catch { stopLanQrCamera(); lanQrStatus('Camera scanning is unavailable here. Use a secure browser or manual entry.'); }
    };
    scan();
  } catch {
    if (epoch === lanQrEpoch) { stopLanQrCamera(); lanQrStatus('Camera access was unavailable or denied. You can still use manual entry.'); }
  }
}
function clearLanQr() {
  stopLanQrCamera(); lanQrPendingHost = false; if (!byId('lanQr')) return;
  byId('lanQrDisplay').replaceChildren(); byId('lanQrDisplay').hidden = true;
  byId('lanQrChoice').replaceChildren(); byId('lanQrChoice').hidden = true;
  lanQrStatus('Show or scan a QR code at any time. No internet required.');
}
function installLanQrUi(classic) {
  const qr = royalDisclosure('QR pairing', 'lanQr'), actions = document.createElement('div');
  actions.className = 'match-actions';
  actions.append(royalButton('lanQrShow', 'Create QR code', createLanQr),
    royalButton('lanQrScan', 'Scan QR code', startLanQrCamera), royalButton('lanQrStop', 'Stop camera', stopLanQrCamera));
  const status = document.createElement('p'); status.id = 'lanQrStatus'; status.className = 'match-note'; status.setAttribute('role', 'status');
  const choice = document.createElement('select'); choice.id = 'lanQrChoice'; choice.hidden = true;
  choice.setAttribute('aria-label', localizeText('Invitation')); choice.addEventListener('change', () => showLanQr());
  const display = document.createElement('div'); display.id = 'lanQrDisplay'; display.hidden = true;
  const video = document.createElement('video'); video.id = 'lanQrVideo'; video.hidden = true; video.muted = true; video.playsInline = true;
  video.setAttribute('aria-label', localizeText('QR camera preview'));
  qr.append(actions, status, choice, display, video); classic.append(qr);
  qr.addEventListener('toggle', () => { if (!qr.open) stopLanQrCamera(); }); clearLanQr();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLanQrCamera(); });
document.addEventListener('kingpong-background', stopLanQrCamera);
window.addEventListener('pagehide', clearLanQr);
