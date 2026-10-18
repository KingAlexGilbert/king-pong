// Optional human comparison of one encrypted WebRTC channel. Nothing identifying is saved.
async function pairingHash(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
}
function pairingFingerprint(sdp) {
  const values=[...new Set(Array.from(String(sdp).matchAll(/^a=fingerprint:sha-256 ([A-Fa-f0-9:]+)\r?$/gm),m=>m[1].replaceAll(':','').toLowerCase()))];
  if(values.length!==1 || !/^[a-f0-9]{64}$/.test(values[0]))throw Error('certificate unavailable');
  return values[0];
}
function pairingBinding(peer,role,room) {
  const local=pairingFingerprint(peer.localDescription?.sdp),remote=pairingFingerprint(peer.remoteDescription?.sdp);
  return JSON.stringify(['King Pong pairing v1',room,...(role==='host'?[local,remote]:[remote,local])]);
}
class KingPongPairing {
  constructor({role,binding,send,pin,accepted,failed}) {
    this.role=role;this.binding=binding;this.send=send;this.onPin=pin;this.onAccepted=accepted;this.onFailed=failed;
    this.closed=false;this.remoteCommit=null;this.remoteNonce=null;this.remoteShown=false;this.pin=null;this.count=0;
    this.queue=Promise.resolve();this.timer=setTimeout(()=>this.fail(),60000);
    this.ready=this.start().catch(()=>this.fail());
  }
  async start() {
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    this.nonce=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    this.commit=await this.commitment(this.role,this.nonce);
    if(!this.closed)this.send({kind:'commit',value:this.commit});
  }
  commitment(role,nonce){return pairingHash(JSON.stringify(['King Pong commitment v1',this.binding,role,nonce]));}
  receive(message) {
    this.queue=this.queue.then(async()=>{
      await this.ready;if(this.closed)return;if(++this.count>12)throw Error('rate');
      const other=this.role==='host'?'guest':'host';
      if(message.kind==='commit') {
        if(!/^[a-f0-9]{64}$/.test(message.value||'') || this.remoteCommit && this.remoteCommit!==message.value)throw Error('commit');
        if(this.remoteCommit)return;
        this.remoteCommit=message.value;this.send({kind:'reveal',value:this.nonce});
      } else if(message.kind==='reveal') {
        if(!this.remoteCommit || this.remoteNonce || !/^[a-f0-9]{32}$/.test(message.value||''))throw Error('reveal');
        if(await this.commitment(other,message.value)!==this.remoteCommit)throw Error('commit mismatch');
        if(this.closed)return;this.remoteNonce=message.value;
        const nonces=this.role==='host'?[this.nonce,this.remoteNonce]:[this.remoteNonce,this.nonce];
        const digest=await pairingHash(JSON.stringify([this.binding,...nonces]));if(this.closed)return;
        this.pin=String(parseInt(digest.slice(0,8),16)%1000000).padStart(6,'0');
        this.onPin(this.pin,false);this.send({kind:'shown'});
      } else if(message.kind==='shown') {
        if(!this.pin)throw Error('not ready');this.remoteShown=true;this.onPin(this.pin,true);
      } else if(message.kind==='accept' && this.role==='guest' && this.pin && this.remoteShown) this.finish();
      else throw Error('unexpected');
    }).catch(()=>this.fail());
  }
  accept(){if(this.closed || this.role!=='host' || !this.pin || !this.remoteShown)return false;this.send({kind:'accept'});this.finish();return true;}
  finish(){if(this.closed)return;this.close();this.onAccepted();}
  fail(){if(this.closed)return;this.close();this.onFailed();}
  close(){this.closed=true;clearTimeout(this.timer);this.nonce=this.remoteNonce=this.pin=null;}
}
function pairingDescription(session,description) {
  return session.pairingRequired && session.role==='host' && description.type==='offer' ?
    {...description,sdp:description.sdp+'\r\na=x-kingpong-pairing:1\r\n'} : description;
}
function receivePairingFrame(session,raw) {
  if(session.assignment || typeof raw!=='string' || !raw.startsWith('{"kpPair":1,'))return false;
  if(!session.pairingRequired)return true;
  if(raw.length>512){session.fail('negotiation_failed');return true;}
  try {const message=JSON.parse(raw);if(session.pairing)session.pairing.receive(message);
    else if((session.pairingEarly||=[]).length<4)session.pairingEarly.push(message);
    else session.fail('negotiation_failed');
  }catch{session.fail('negotiation_failed');}return true;
}
function closePairingUi(session) {
  clearTimeout(session.pairingTimer);session.pairing?.close();session.pairing=null;session.pairingEarly=[];
  const panel=byId('pairingDialog');if(panel?.session!==session)return;
  panel.hidden=true;panel.session=null;byId('pairingPin').textContent='';syncRoyalFocus();
}
function rejectPairing(session) {
  closePairingUi(session);if(session.closed)return;
  if(session.managed && session.role==='host')session.kickGuest();else session.fail('rejected');
}
function beginPairingVerification(session) {
  const panel=byId('pairingDialog');panel.session=session;panel.hidden=false;
  byId('pairingAccept').hidden=session.role!=='host';byId('pairingAccept').disabled=true;
  byId('pairingPin').textContent='';setLocalizedText(byId('pairingNote'),'Compare this PIN on both devices before accepting.');syncRoyalFocus();
  try {
    if(!crypto?.subtle)throw Error('unsupported');
    const peer=session.peer;
    session.pairing=new KingPongPairing({role:session.role,binding:pairingBinding(peer,session.role,lanRoomCode),
      send:message=>{if(!session.closed && session.peer===peer)session.control.send(JSON.stringify({kpPair:1,...message}));},
      pin:(pin,ready)=>{if(panel.session!==session)return;byId('pairingPin').textContent=pin.slice(0,3)+' '+pin.slice(3);byId('pairingAccept').disabled=!ready;},
      accepted:()=>{if(session.closed || session.peer!==peer)return;session.pairingAccepted=true;closePairingUi(session);session.hooks.connected();},
      failed:()=>{if(!session.closed && session.peer===peer){setLanStatus('Pairing verification failed or expired.');rejectPairing(session);}}
    });
    for(const message of session.pairingEarly||[])session.pairing.receive(message);session.pairingEarly=[];
  }catch{
    setLocalizedText(byId('pairingNote'),'Verification unavailable. Cancel and reconnect with verification off.');
    session.pairingTimer=setTimeout(()=>rejectPairing(session),60000);
  }
}
function installPairingUi(privateRooms) {
  // Offline LAN retains its optional connection-bound verification.
  const parent=byId('classicLanDialog').firstElementChild;
  const label=document.createElement('label');label.className='lan-check';
  const input=document.createElement('input');input.type='checkbox';input.id='localPairing';
  input.checked=playerPreference('verifyPairing');
  const text=document.createElement('span');setLocalizedText(text,'Verify pairing PIN (host)');
  label.append(input,text);parent.append(label);
  input.addEventListener('change',()=>savePlayerPreference('verifyPairing',input.checked));
  const card=royalDialog('pairingDialog','Verify pairing'),panel=byId('pairingDialog');
  const note=document.createElement('p');note.id='pairingNote';note.className='match-note';
  const pin=document.createElement('output');pin.id='pairingPin';pin.setAttribute('aria-live','polite');
  card.append(note,pin,royalButton('pairingAccept','PINs match — Accept',()=>panel.session?.pairing?.accept()),
    royalButton('pairingReject','Reject / Cancel',()=>{if(panel.session)rejectPairing(panel.session);}));
}
