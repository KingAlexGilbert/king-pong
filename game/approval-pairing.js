// Online private-room SAS v1. No RTCPeerConnection, SDP or ICE exists during
// this exchange. PIN comparison is optional; acceptance is permission to connect.
const APPROVAL_PROTOCOL = 'sas1';
const approvalHex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const approvalBytes = hex => Uint8Array.from(hex.match(/../g), b => parseInt(b, 16));
class KingPongApprovalPair {
  constructor({role, room, request, send, ready, failed}) {
    this.role = role; this.room = room; this.request = request; this.send = send;
    this.onReady = ready; this.onFailed = failed; this.queue = Promise.resolve(); this.count = 0;
    this.closed = false; this.timer = setTimeout(() => this.fail(), 60000);
    this.initialized = this.start().catch(() => this.fail());
  }
  transcript(role, value) { return JSON.stringify(['King Pong approval sas1', this.room, this.request, role, value]); }
  async start() {
    const keys = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
    const publicKey = approvalHex(await crypto.subtle.exportKey('raw', keys.publicKey));
    if (this.closed) return;
    this.keys = keys; this.local = {key: publicKey, nonce: approvalHex(crypto.getRandomValues(new Uint8Array(16)))};
    const commit = await pairingHash(this.transcript(this.role, this.local));
    if (!this.closed) this.send({kind:'commit', value:commit});
  }
  receive(message) {
    this.queue = this.queue.then(async () => {
      await this.initialized; if (this.closed) return;
      if (++this.count > 12) throw Error('rate');
      if (message.kind === 'commit') {
        if (!/^[a-f0-9]{64}$/.test(message.value || '') || this.commit && this.commit !== message.value) throw Error('commit');
        if (!this.commit) { this.commit = message.value; this.send({kind:'reveal', value:this.local}); }
      } else if (message.kind === 'reveal') {
        const value = message.value;
        if (!value || !/^04[a-f0-9]{128}$/.test(value.key || '') || !/^[a-f0-9]{32}$/.test(value.nonce || '') ||
            Object.keys(value).length !== 2 || this.remote && JSON.stringify(this.remote) !== JSON.stringify(value)) throw Error('reveal');
        this.remote = {key:value.key, nonce:value.nonce};
      } else if (message.kind === 'ready') this.remoteReady = true;
      else throw Error('message');
      if (this.commit && this.remote && !this.binding) {
        const other = this.role === 'host' ? 'guest' : 'host';
        if (await pairingHash(this.transcript(other, this.remote)) !== this.commit) throw Error('commit mismatch');
        const remoteKey = await crypto.subtle.importKey('raw', approvalBytes(this.remote.key), {name:'ECDH',namedCurve:'P-256'}, false, []);
        const secret = await crypto.subtle.deriveBits({name:'ECDH',public:remoteKey}, this.keys.privateKey, 256);
        const parties = this.role === 'host' ? [this.local, this.remote] : [this.remote, this.local];
        const transcript = JSON.stringify(['King Pong approval sas1',this.room,this.request,...parties]);
        const material = await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
        const derived = await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode(transcript),
          info:new TextEncoder().encode('King Pong approval PIN and SDP binding v1')},material,288);
        const bytes = new Uint8Array(derived);
        const pin = String(new DataView(derived).getUint32(32) % 1000000).padStart(6,'0');
        const key = await crypto.subtle.importKey('raw',bytes.slice(0,32),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
        if (this.closed) return;
        this.binding = {key,request:this.request,room:this.room}; this.pin = pin;
        this.keys = this.local = this.remote = null;
        this.send({kind:'ready'});
      }
      if (this.binding && this.remoteReady && !this.shown) { this.shown = true; this.onReady(this.pin, this.binding); }
    }).catch(() => this.fail());
    return this.queue;
  }
  fail() { if (!this.closed) { this.close(); this.onFailed(); } }
  close() {
    this.closed = true; clearTimeout(this.timer);
    this.keys = this.local = this.remote = this.commit = this.pin = this.binding = null;
  }
}
function approvalDescriptionData(binding, role, attempt, description) {
  return new TextEncoder().encode(JSON.stringify(['King Pong approved SDP v1',binding.room,binding.request,role,attempt,description.type,description.sdp]));
}
async function signApprovedDescription(session, description, attempt) {
  const binding = session.approvalBinding;
  if (!binding) return description;
  const mac = await crypto.subtle.sign('HMAC',binding.key,approvalDescriptionData(binding,session.role,attempt,description));
  return {...description,approvalMac:approvalHex(mac)};
}
async function verifyApprovedDescription(session, description, attempt) {
  const binding = session.approvalBinding;
  if (!binding) return;
  if (!/^[a-f0-9]{64}$/.test(description.approvalMac || '') || !await crypto.subtle.verify('HMAC',binding.key,
      approvalBytes(description.approvalMac),approvalDescriptionData(binding,session.role==='host'?'guest':'host',attempt,description))) throw Error('approval binding');
}
function clearOnlineApproval(session, keepBinding = false) {
  for (const pair of session.approvalPairs?.values() || []) pair.close();
  session.approvalPairs?.clear();
  if (!keepBinding) session.approvalBinding = null;
  if (saveConfirmation?.roomSession === session && saveConfirmation.onlineApproval) finishSaveConfirmation(false);
  const guest = byId('approvalGuest');
  if (guest?.session === session) { guest.hidden = true; guest.session = null; byId('approvalGuestPin').textContent = ''; }
  byId('approvalHostPin')?.remove();
}
function startOnlineApproval(session, request) {
  if (!/^[a-f0-9-]{36}$/.test(request) || session.closed || session.approvalPairs?.has(request)) return;
  session.approvalPairs ||= new Map();
  if (session.approvalPairs.size >= 4) return;
  const pair = new KingPongApprovalPair({role:session.role, room:session.code, request,
    send:message=>{if(!session.closed)session.send({type:'approval-pair',request,...message});},
    ready:(pin)=>{
      if (session.closed) return;
      if (session.role==='host') showOnlineApproval(session);
      else {
        const box=byId('approvalGuest'); box.session=session; box.hidden=false;
        byId('approvalGuestPin').textContent=pin.slice(0,3)+' '+pin.slice(3); syncRoyalFocus();
      }
    },
    failed:()=>{
      if(session.closed)return;
      session.approvalPairs.delete(request);
      if(session.role==='host')session.send({type:'reject',request});else session.fail('approval_timeout');
      clearOnlineApprovalNotice(session,request);
    }
  });
  session.approvalPairs.set(request,pair);
}
function clearOnlineApprovalNotice(session,request) {
  if(saveConfirmation?.roomSession===session&&saveConfirmation.request===request)finishSaveConfirmation(false);
  if(!saveConfirmation)byId('approvalHostPin')?.remove();
}
function showOnlineApproval(session) {
  if (saveConfirmation || session.closed) return;
  const entry = [...session.approvalPairs || []].find(([,pair])=>pair.shown&&!pair.closed);
  if (!entry) return;
  const [request,pair] = entry;
  showSaveConfirmation('Join request','A player wants to join your private room.','Accept',accepted=>{
    byId('approvalHostPin')?.remove();
    if(session.closed||session.approvalPairs.get(request)!==pair)return;
    session.send({type:accepted?'approve':'reject',request});
    if(!accepted){pair.close();session.approvalPairs.delete(request);showOnlineApproval(session);}
  });
  saveConfirmation.roomSession=session;saveConfirmation.request=request;saveConfirmation.onlineApproval=true;
  setLocalizedText(saveConfirmCancel,'Reject');
  const pin=document.createElement('div');pin.id='approvalHostPin';
  const output=document.createElement('output');output.textContent=pair.pin.slice(0,3)+' '+pair.pin.slice(3);
  const note=document.createElement('p');setLocalizedText(note,'You may compare this PIN with the other player. Comparing is optional.');
  pin.append(output,note);saveConfirmMessage.after(pin);
}
function syncOnlineApproval(session,lobby) {
  const pending = new Set((lobby.pending || []).map(p=>p.request));
  for(const [request,pair] of session.approvalPairs || []) if(!pending.has(request)){
    pair.close();session.approvalPairs.delete(request);clearOnlineApprovalNotice(session,request);
  }
  for(const request of pending)startOnlineApproval(session,request);
  showOnlineApproval(session);
}
function acceptOnlineApproval(session,request) {
  const pair=session.approvalPairs?.get(request);
  if(!pair?.binding || !pair.shown)throw Error('approval unavailable');
  session.approvalBinding=pair.binding;
  clearOnlineApproval(session,true);
}
function installOnlineApprovalUi(parent) {
  const box=document.createElement('section');box.id='approvalGuest';box.hidden=true;
  const waiting=document.createElement('p');setLocalizedText(waiting,'Waiting for host approval...');
  const pin=document.createElement('output');pin.id='approvalGuestPin';pin.setAttribute('aria-live','polite');
  const note=document.createElement('p');setLocalizedText(note,'You may compare this PIN with the other player. Comparing is optional.');
  box.append(waiting,pin,note);parent.append(box);
}
