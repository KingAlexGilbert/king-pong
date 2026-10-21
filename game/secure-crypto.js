// Ephemeral ECDH P-256 / HKDF-SHA-256 / AES-256-GCM. No custom cipher or identity.
const SECURE_MAX_PLAINTEXT = 16384;
const secureText = value => new TextEncoder().encode(JSON.stringify(value));
const secureBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
function secureUnbase64(value) {
  if (typeof value !== 'string' || value.length > 23000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('encoding');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
class KingPongSessionCrypto {
  constructor(room, session, role, binding) {
    this.room = room; this.session = session; this.role = role; this.binding = binding;
    this.other = role === 'host' ? 'guest' : 'host'; this.tx = 0; this.high = 0; this.seen = new Set();
  }
  keyData(role, value) { return secureText(['King Pong transport key v1',this.room,this.session,role,value.key,value.nonce]); }
  async offer() {
    this.keys = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
    this.local = {key:approvalHex(await crypto.subtle.exportKey('raw',this.keys.publicKey)),nonce:approvalHex(crypto.getRandomValues(new Uint8Array(16)))};
    const result = {...this.local};
    if (this.binding) result.mac = approvalHex(await crypto.subtle.sign('HMAC',this.binding.key,this.keyData(this.role,result)));
    return result;
  }
  async accept(remote) {
    if (this.sendKey || this.remote || !remote || !/^04[a-f0-9]{128}$/.test(remote.key || '') || !/^[a-f0-9]{32}$/.test(remote.nonce || '')) throw Error('key');
    if (this.binding && (!/^[a-f0-9]{64}$/.test(remote.mac || '') || !await crypto.subtle.verify('HMAC',this.binding.key,
      approvalBytes(remote.mac),this.keyData(this.other,remote)))) throw Error('approval binding');
    this.remote = {key:remote.key,nonce:remote.nonce};
    const publicKey = await crypto.subtle.importKey('raw',approvalBytes(remote.key),{name:'ECDH',namedCurve:'P-256'},false,[]);
    const secret = await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},this.keys.privateKey,256);
    const material = await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);
    const parties = this.role === 'host' ? [this.local,this.remote] : [this.remote,this.local];
    this.transcript = secureText(['King Pong encrypted session v1',this.room,this.session,'host','guest',...parties]);
    const derive = (label,algorithm,usage) => crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:this.transcript,
      info:new TextEncoder().encode('King Pong v1 '+label)},material,algorithm,false,usage);
    this.sendKey = await derive(this.role,{name:'AES-GCM',length:256},['encrypt']);
    this.receiveKey = await derive(this.other,{name:'AES-GCM',length:256},['decrypt']);
    this.proofKey = await derive('confirmation',{name:'HMAC',hash:'SHA-256',length:256},['sign','verify']);
    this.keys = this.binding = this.local = this.remote = null;
    return approvalHex(await crypto.subtle.sign('HMAC',this.proofKey,secureText([this.session,this.role,'ready'])));
  }
  async confirm(proof) {
    return /^[a-f0-9]{64}$/.test(proof || '') && await crypto.subtle.verify('HMAC',this.proofKey,
      approvalBytes(proof),secureText([this.session,this.other,'ready']));
  }
  nonce(seq) {
    const iv = new Uint8Array(12), view = new DataView(iv.buffer);
    view.setUint32(4,Math.floor(seq / 4294967296)); view.setUint32(8,seq >>> 0); return iv;
  }
  aad(frame,role) { return secureText(['King Pong frame v1',this.room,this.session,role,frame.epoch,frame.lane,frame.seq]); }
  async seal(epoch,lane,value) {
    const plain = secureText(value);
    if (plain.length > SECURE_MAX_PLAINTEXT || !Number.isSafeInteger(++this.tx)) throw Error('limit');
    const frame = {type:'secure-frame',session:this.session,epoch,lane,seq:this.tx};
    frame.body = secureBase64(await crypto.subtle.encrypt({name:'AES-GCM',iv:this.nonce(frame.seq),additionalData:this.aad(frame,this.role),tagLength:128},this.sendKey,plain));
    return frame;
  }
  async open(frame,epoch) {
    if (frame.session !== this.session || frame.epoch !== epoch || !['d','c','a'].includes(frame.lane) ||
      !Number.isSafeInteger(frame.seq) || frame.seq <= 0 || frame.seq <= this.high - 256 || this.seen.has(frame.seq)) throw Error('replay');
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:this.nonce(frame.seq),additionalData:this.aad(frame,this.other),tagLength:128},this.receiveKey,secureUnbase64(frame.body));
    if (plain.byteLength > SECURE_MAX_PLAINTEXT) throw Error('limit');
    this.high = Math.max(this.high,frame.seq); this.seen.add(frame.seq);
    for (const seq of this.seen) if (seq <= this.high - 256) this.seen.delete(seq);
    return JSON.parse(new TextDecoder().decode(plain));
  }
  close() { this.keys = this.binding = this.sendKey = this.receiveKey = this.proofKey = this.transcript = this.local = this.remote = null; this.seen.clear(); }
}
