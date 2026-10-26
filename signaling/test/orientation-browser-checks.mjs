import assert from 'node:assert/strict';

// Real DOM/input/layout, with explicit platform API mocks. These checks do not
// certify a physical device's ability or permission to rotate its display.
export async function orientationBrowserChecks({page, bounds, pass}) {
  const phone = {viewport:{width:320,height:568},hasTouch:true,isMobile:true};
  const native = await page('Android', phone);
  await native.evaluate(() => {
    window.nativeRotations=0;
    window.KingPongLanToken='rotation-capability';
    window.KingPongNativeOrientation={available:false,landscape:false};
    window.KingPongOrientation={requestLandscape(token){
      if(token!=='rotation-capability')throw Error('Wrong capability');
      window.nativeRotations++;
    }};
    startTwoPlayerFromTitle();
    waitingForServe=false;paused=false;left.score=2;right.score=3;
    lanRole='guest';lanConnected=true;lanRoomCode='rotation-test';onlineGameBlocked=false;
    lanChannel={readyState:'open',send(){}};
    onlineSession={close(){throw Error('Rotation closed the session')}};
    window.rotationSession=onlineSession;window.rotationChannel=lanChannel;
    setMenusVisible(false);
    syncRoyalUi(true);
  });
  const stable = () => native.evaluate(() => JSON.stringify([mode,left,right,ball,saveData,paused,waitingForServe,
    lanRole,lanRoomCode,lanConnected,matchArenaId,matchRuleId,matchPaddles,onlineSession===window.rotationSession,
    lanChannel===window.rotationChannel,{...localStorage}]));
  const before = await stable();
  assert.equal(await native.locator('#rotateDevice').isVisible(),true);
  assert.equal(await native.locator('#rotatePlay').isVisible(),false);
  await native.evaluate(() => {
    window.KingPongNativeOrientation.available=true;
    document.dispatchEvent(new Event('kingpong-orientation'));
  });
  await bounds(native,'#rotateDevice .match-card');
  await native.locator('#rotatePlay').click();
  assert.equal(await native.locator('#rotatePlay').isDisabled(),true);
  assert.equal(await native.locator('#rotateDevice').isVisible(),true);
  assert.equal(await native.evaluate(()=>window.nativeRotations),1);
  await native.setViewportSize({width:568,height:320});
  await native.evaluate(()=>syncRoyalOrientation());
  assert.equal(await native.locator('#rotateDevice').isVisible(),true,'wait for native confirmation');
  await native.evaluate(() => {
    window.KingPongNativeOrientation.landscape=true;
    document.dispatchEvent(new Event('kingpong-orientation'));
  });
  await native.locator('#rotateDevice').waitFor({state:'hidden'});
  assert.equal(await stable(),before,'rotation preserves live session identity and game/settings state');
  await native.setViewportSize(phone.viewport);
  await native.evaluate(() => {
    window.KingPongNativeOrientation.landscape=false;
    window.KingPongOrientation.requestLandscape=()=>{window.nativeRotations++;throw Error('OS refused')};
    syncRoyalOrientation();
  });
  await native.locator('#rotatePlay').click();
  assert.equal(await native.locator('#rotateDevice').isVisible(),true);
  assert.equal(await native.locator('#rotatePlay').isVisible(),false);
  assert.equal(await native.evaluate(()=>document.activeElement.id),'rotateDismiss');
  assert.equal(await stable(),before);
  await native.locator('#rotateDismiss').click();
  assert.equal(await native.locator('#rotateDevice').isVisible(),false);
  assert.equal(await native.evaluate(()=>window.nativeRotations),2);
  assert.equal(await stable(),before);
  await native.context().close();
  pass('mocked Android capability, confirmation, rejection and portrait continuation preserve an active guest session');

  const web = await page('Browser',phone);
  await web.evaluate(() => {
    window.rotationType='portrait-primary';window.webRotations=0;window.rotationFullscreen=[];
    Object.defineProperty(screen.orientation,'type',{configurable:true,get:()=>window.rotationType});
    screen.orientation.lock=async()=>{window.webRotations++};
    screen.orientation.unlock=()=>{};
    window.KingPongFullscreen={enter:async manual=>{
      window.rotationFullscreen.push(manual);
      Object.defineProperty(document,'fullscreenElement',{configurable:true,value:document.documentElement});
      return true;
    }};
    startTwoPlayerFromTitle();
  });
  assert.equal(await web.evaluate(()=>royalLandscapeRoute()),null,'exposed lock API alone remains uncertain');
  await web.locator('#matchServe').click();
  await web.waitForFunction(()=>royalOrientationPending?.ready);
  assert.equal(await web.locator('#rotateDevice').isVisible(),true);
  assert.equal(await web.locator('#rotatePlay').isVisible(),false);
  await web.setViewportSize({width:568,height:320});
  await web.evaluate(()=>{window.rotationType='landscape-primary';screen.orientation.dispatchEvent(new Event('change'))});
  await web.locator('#rotateDevice').waitFor({state:'hidden'});
  await web.evaluate(()=>{
    window.rotationType='portrait-primary';
    Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});
  });
  await web.setViewportSize(phone.viewport);
  await web.locator('#rotatePlay').waitFor({state:'visible'});
  await web.locator('#rotatePlay').click();
  await web.waitForFunction(()=>royalOrientationPending?.ready);
  assert.deepEqual(await web.evaluate(()=>window.rotationFullscreen),[false,true],'manual action explicitly requests fullscreen');
  await web.setViewportSize({width:568,height:320});
  await web.evaluate(()=>{window.rotationType='landscape-secondary';screen.orientation.dispatchEvent(new Event('change'))});
  await web.locator('#rotateDevice').waitFor({state:'hidden'});
  await web.setViewportSize(phone.viewport);
  await web.evaluate(()=>{
    window.rotationType='portrait-primary';
    screen.orientation.lock=async()=>{window.webRotations++;throw Error('Permission changed')};
    syncRoyalOrientation();
  });
  await web.locator('#rotatePlay').click();
  assert.equal(await web.locator('#rotateDevice').isVisible(),true);
  assert.equal(await web.locator('#rotatePlay').isVisible(),false);
  assert.equal(await web.evaluate(()=>window.webRotations),3);
  await web.locator('#rotateDismiss').click();
  assert.equal(await web.locator('#rotateDevice').isVisible(),false);
  await web.context().close();
  pass('mocked browser locks establish capability only after confirmation; explicit fullscreen, rejection and continuation work');
}
