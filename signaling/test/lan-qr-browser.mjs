import assert from 'node:assert/strict';
import {builds} from '../../tests/helpers/game-source.mjs';
import {polishFixture} from './polish-fixture.mjs';
const f = await polishFixture();
try {
  for (const [platform, path] of Object.entries(builds)) {
    let internet = 0;
    const p = await f.page(path, {}, async p => {
      await p.addInitScript(() => { window.KingPongNativeLan = true; });
      await p.route('https://**', route => { internet++; return route.abort(); });
    });
    p.setDefaultTimeout(8000);
    assert.equal((await p.locator('#lanQrShow').textContent()).trim(), 'Create QR code');
    assert.equal(await p.locator('#lanQrManual').count(), 0, 'manual pairing appears only once');
    await p.evaluate(() => {
      openOfflineLanSetup(true); byId('lanQr').open = true;
      window.invitation = localLanInvitation('192.168.1.12', 45873, 'a'.repeat(32), 'ABCD23');
      byId('localLanAddress').textContent = invitation;
      window.cameraCalls = 0; window.tracks = [];
      // Controlled camera frames, not a claim of physical-camera testing.
      const video = byId('lanQrVideo'), frame = document.createElement('canvas');
      frame.id = video.id; frame.pause = () => {}; frame.play = async () => {};
      frame.readyState = 2; frame.videoWidth = frame.videoHeight = 480;
      QrCreator.render({text: invitation, size: 480, ecLevel: 'M', quiet: 4, radius: 0, fill: '#000000', background: '#ffffff'}, frame); video.replaceWith(frame);
      navigator.mediaDevices.getUserMedia = async constraints => {
        cameraCalls++; window.cameraConstraints = constraints;
        const track = {readyState: 'live', stop() { this.readyState = 'ended'; }}; tracks.push(track);
        return {getTracks: () => [track]};
      };
    });
    assert.equal(await p.evaluate(() => cameraCalls), 0);
    for (const [width, height] of [[1920,1080], [390,844], [844,390]]) {
      await p.setViewportSize({width, height}); await p.evaluate(() => showLanQr());
      assert.equal(await p.evaluate(() => {
        const c = byId('lanQrDisplay').firstChild, ctx = c.getContext('2d');
        const pixels = ctx.getImageData(0,0,c.width,c.height);
        return jsQR(pixels.data,c.width,c.height)?.data;
      }), await p.evaluate(() => invitation));
      const box = await p.locator('#lanQrDisplay canvas').boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height, 'complete QR visible, including landscape');
      await f.shot(p, `${platform}-qr-${width}x${height}`);
    }
    await p.locator('#lanQrScan').click();
    await p.waitForFunction(() => byId('localLanCode').value === invitation);
    assert.equal(await p.evaluate(() => cameraConstraints.audio), false);
    assert.equal(await p.evaluate(() => tracks.every(t => t.readyState === 'ended')), true);
    assert.equal(await p.evaluate(() => onlineSession), null, 'scanning cannot bypass Join or approval');
    assert.equal(await p.evaluate(() => JSON.stringify(localStorage).includes('KP1-')), false);
    await p.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw Error('denied'); }; });
    await p.locator('#lanQrScan').click();
    await p.waitForFunction(() => byId('lanQrStatus').textContent.includes('denied'));
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(resolve => window.resolveCamera = resolve);
      startLanQrCamera(); stopLanQrCamera();
      const track = {readyState: 'live', stop() { this.readyState = 'ended'; }}; tracks.push(track);
      resolveCamera({getTracks: () => [track]});
    });
    await p.waitForFunction(() => tracks.every(t => t.readyState === 'ended'));
    assert.equal(await p.evaluate(() => acceptLanQr('https://example.com')), false);
    await p.evaluate(() => showTitleScreen());
    assert.equal(await p.locator('#lanQrDisplay canvas').count(), 0);
    await p.evaluate(() => {
      window.lanCommands = [];
      window.KingPongLan = {postMessage: message => lanCommands.push(JSON.parse(message))};
      openOfflineLanSetup(true); byId('lanQr').open = true;
    });
    await p.locator('#lanQrShow').click();
    await p.waitForFunction(() => lanCommands.some(command => command.op === 'host'));
    assert.equal(await p.evaluate(() => onlineSession instanceof KingPongLocalRoom), true);
    await p.evaluate(() => {
      KingPongLanReceive({type: 'hosting', generation: onlineSession.generation, code: 'ABCD23',
        port: 45873, room: 'a'.repeat(32), addresses: ['192.168.1.12'], discovery: true});
    });
    await p.waitForFunction(() => byId('lanQrDisplay').querySelector('canvas'));
    assert.equal(await p.evaluate(() => {
      const c = byId('lanQrDisplay').firstChild;
      const p = c.getContext('2d').getImageData(0,0,c.width,c.height);
      return jsQR(p.data,c.width,c.height)?.data;
    }), await p.evaluate(() => localLanInvitation('192.168.1.12',45873,'a'.repeat(32),'ABCD23')));
    await p.locator('#lanQrShow').click();
    assert.equal(await p.evaluate(() => lanCommands.filter(command => command.op === 'host').length), 1,
      'creating QR again reuses the existing room');
    assert.equal(internet, 0); await p.close(); console.log(`PASS ${platform} QR generation/scanning/validation/permission races`);
  }
  const p = await f.page();
  await p.evaluate(() => { openOfflineLanSetup(true); byId('lanQr').open = true; });
  await p.locator('#lanQrShow').click();
  await p.waitForFunction(() => byId('classicLanOutput').value.length > 0, {timeout: 8000});
  assert.equal(await p.evaluate(() => onlineSession instanceof KingPongManualRoom), true,
    'the browser creates an offline manual WebRTC room automatically');
  assert.equal(await p.evaluate(() => validateLanQr(byId('classicLanOutput').value)?.kind), 'offer');
  assert.equal(await p.locator('#lanQrDisplay canvas').count(), 1,
    'browser QR appears automatically when the offline offer is ready');
  await p.evaluate(() => closeLanConnection(false));
  for (const type of ['offer', 'answer']) {
    const result = await p.evaluate(type => {
      const text = btoa(JSON.stringify({protocol:'kp-lan-two-1',room:'ABCDE',nonce:'a'.repeat(36),description:{type,sdp:'v=0\r\n'+'a=example\r\n'.repeat(80)}}));
      byId('classicLanOutput').value = text; showLanQr();
      const c = byId('lanQrDisplay').firstChild, pixels = c.getContext('2d').getImageData(0,0,c.width,c.height);
      const decoded = jsQR(pixels.data,c.width,c.height)?.data;
      return {matches: decoded === text, accepted: acceptLanQr(decoded), populated: byId('classicLanInput').value === text};
    }, type);
    assert.deepEqual(result, {matches:true,accepted:true,populated:true});
  }
  await p.evaluate(() => acceptLanQr(localLanInvitation('192.168.1.12',45873,'a'.repeat(32),'ABCD23')));
  assert.match(await p.locator('#lanQrStatus').textContent(), /native King Pong app/);
  await p.close(); assert.deepEqual(f.errors, []);
  console.log('PASS browser manual invitation and response QR; native-only invitation guidance');
} finally { await f.close(); }
