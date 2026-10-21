import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './helpers/royal-harness.mjs';
import {builds, source, functionSource} from './helpers/game-source.mjs';

function game(platform) {
  const h = harness(platform);
  h.run(`let now=1000; performance.now=()=>now;
    function findCenterSafeSpawn(){return {x:316,y:236}}
    function findReceiverSideRallySpawn(){return {x:160,y:236}}
    function setRallyBallVelocity(direction,speed){ball.vx=direction*speed;ball.vy=0}
    function hideFirstStartControls(){} function autoHideMenusForGameplay(){} function syncRoyalUi(){}
    ${['resetBall','serveOrContinue','beginRallyLaunchRamp'].map(n=>functionSource(source(platform),n)).join('\n')}
    lanRole='host';waitingForServe=false;
  `);
  return h;
}

for (const platform of Object.keys(builds)) {
  test(`${platform}: both scoring directions wait two seconds, reject inputs and duplicate scores, then launch once`, () => {
    for (const score of ['pointForPlayer','pointForCpu']) {
      const h=game(platform);
      h.run(`${score}();const spawn=JSON.stringify(ball);`);
      assert.equal(h.run('pointServeDisplayNumber()'),2);
      assert.equal(h.run("sent.find(m=>m.type==='state').pointServeMs"),2000);
      h.run(`${score}();serveOrContinue();handleLanHostMessage({type:'action',action:'serve'});`);
      assert.equal(h.run('left.score+right.score'),1);
      assert.equal(h.run('JSON.stringify(ball)===spawn'),true);
      h.run('now+=1000;tickPointServeCountdown();');
      assert.equal(h.run('pointServeDisplayNumber()'),1);
      h.run('now+=999;tickPointServeCountdown();serveOrContinue();');
      assert.equal(h.run('waitingForServe'),true);
      h.run('now++;tickPointServeCountdown();');
      assert.equal(h.run('waitingForServe'),false);
      assert.equal(h.run('rallyLaunchFramesRemaining'),60);
      assert.equal(h.run('Math.sign(ball.vx)'),score==='pointForPlayer'?1:-1);
      h.run('updateRallyLaunchRamp();const launched=JSON.stringify(ball);now+=3000;tickPointServeCountdown();serveOrContinue();');
      assert.equal(h.run('JSON.stringify(ball)===launched'),true,'late inputs cannot relaunch or rewind');
      assert.equal(h.run('rallyLaunchFramesRemaining'),59);
    }
  });

  test(`${platform}: pause and connection recovery preserve remaining time without catch-up serving`, () => {
    const h=game(platform);
    h.run('pointForPlayer();now+=700;tickPointServeCountdown();paused=true;suspendPointServeCountdown();now+=9000;tickPointServeCountdown();');
    assert.equal(h.run('pointServeSnapshotMs()'),1300);
    h.run('paused=false;tickPointServeCountdown();now+=600;tickPointServeCountdown();onlineGameBlocked=true;suspendPointServeCountdown();now+=10000;tickPointServeCountdown();');
    assert.equal(h.run('pointServeSnapshotMs()'),700);
    h.run('onlineGameBlocked=false;tickPointServeCountdown();now+=699;tickPointServeCountdown();');
    assert.equal(h.run('waitingForServe'),true);
    h.run('now++;tickPointServeCountdown();');
    assert.equal(h.run('waitingForServe'),false);
  });

  test(`${platform}: disconnect, completion and reset prevent a pending automatic serve`, () => {
    const h=game(platform);
    h.run("pointForPlayer();lanRole='none';now+=3000;tickPointServeCountdown();");
    assert.equal(h.run('waitingForServe'),true);
    h.run("clearPointServeCountdown();lanRole='host';waitingForServe=false;left.score=9;pointForPlayer();now+=3000;tickPointServeCountdown();");
    assert.equal(h.run('gameOver'),true);
    assert.equal(h.run('pointServeCountdown'),null);
    h.run('gameOver=false;left.score=0;waitingForServe=false;pointForPlayer();resetBall(1,true);now+=5000;tickPointServeCountdown();');
    assert.equal(h.run('waitingForServe'),true,'fresh match waits for the existing initial serve/Ready');
    assert.equal(h.run('pointServeCountdown'),null);
  });

  test(`${platform}: guests display host state, never authorize a serve, and reject reordered snapshots`, () => {
    const h=game(platform);
    h.run(`pointForPlayer();const pending=sent.find(m=>m.type==='state');
      now+=2000;tickPointServeCountdown();const active=sent.filter(m=>m.type==='state').at(-1);
      lanRole='guest';lanLastStateSeq=guestSnapshotTick=-1;
      applyLanHostState=m=>{waitingForServe=m.waitingForServe;paused=m.paused;gameOver=m.gameOver;applyPointServeSnapshot(m)};
      handleLanGuestMessage(pending);now+=10000;tickPointServeCountdown();serveOrContinue();`);
    assert.equal(h.run('waitingForServe'),true);
    assert.equal(h.run('pointServeDisplayNumber()'),1);
    h.run('handleLanGuestMessage(active);handleLanGuestMessage(pending);handleLanGuestMessage(active);');
    assert.equal(h.run('waitingForServe'),false);
    assert.equal(h.run('pointServeCountdown'),null);
    for(const value of [-1,2001,'2000',NaN]) {
      h.context.bad=value;
      assert.equal(h.run('validLanSnapshot({...pending,pointServeMs:bad})'),false);
    }
  });
}

test('countdown wire extension is negotiated; old peers retain the original tuple and JSON fallback', () => {
  const h=game('Browser');
  h.run(readFileSync(new URL('../game/online-wire.js',import.meta.url),'utf8'));
  h.run('pointForPlayer();const packet=sent.find(m=>m.type===\'state\');');
  assert.equal(h.run('encodeOnlineWire(packet).length'),16);
  h.run('onlinePointServeReady=true;');
  assert.equal(h.run('decodeOnlineWire(encodeOnlineWire(packet)).pointServeMs'),2000);
  assert.equal(h.run('encodeOnlineWire(packet).length'),17);
  h.run('resetOnlineWire();');
  assert.equal(h.run('onlinePointServeReady'),false);
});
