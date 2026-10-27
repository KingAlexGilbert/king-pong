import assert from 'node:assert/strict';

// Real DOM/input, simulated sessions. Live peer cancellation is also exercised
// in presence-browser-checks across private, matchmaking and native-LAN fixtures.
export async function multiplayerNavigationChecks({page, pass, bounds}) {
  for (const platform of ['Browser','Windows','Linux','Android']) {
    const p=await page(platform,{viewport:{width:844,height:390},hasTouch:true,isMobile:true});
    await p.evaluate(()=>{startCampaignFromSave();waitingForServe=false;paused=false;setMenusVisible(false)});
    await p.locator('#matchPause').tap();
    assert.equal(await p.evaluate(()=>paused&&byId('matchMenu').hidden),true,platform+' direct touch pause');
    await p.locator('#matchPause').tap();
    assert.equal(await p.evaluate(()=>hasResumeCountdown()&&byId('matchMenu').hidden),true);
    await p.locator('#menuToggle').tap();assert.equal(await p.locator('#matchMenu').isVisible(),true);
    await p.locator('#matchMenuClose').tap();
    for (const origin of ['matchmaking','private','lan']) for(const role of ['host','guest']) {
      await p.evaluate(({origin,role})=>{
        closeOnlineConnection(false);startTwoPlayerFromTitle();waitingForServe=false;paused=false;gameOver=false;
        onlineMatchFlow=null;lanRole=role;lanConnected=true;lanRoomCode='ABCDEF';onlineGameBlocked=false;
        onlineSession={multiplayerOrigin:origin,close(){window.navClosed++}};
        window.navSession=onlineSession;window.navClosed=0;
        setMenusVisible(false);syncRoyalUi(true);
      },{origin,role});
      await p.keyboard.press('Escape');
      await bounds(p,'#multiplayerLeave .match-card');
      assert.equal(await p.evaluate(()=>onlineSession===window.navSession&&!paused&&navClosed===0),true);
      assert.equal(await p.evaluate(()=>document.activeElement.id),'multiplayerStay');
      await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'multiplayerLeaveConfirm');
      await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'multiplayerStay');
      await p.keyboard.press('p');await p.keyboard.press('2');await p.keyboard.press('m');
      assert.equal(await p.evaluate(()=>!paused&&mode===2&&onlineSession===window.navSession),true);
      assert.equal(await p.evaluate(()=>{byId('matchPause').click();return !paused}),true,'underlying synthetic clicks blocked too');
      assert.equal(await p.evaluate(()=>readLocalLanInput().axis),0);
      await p.locator('#multiplayerStay').tap();
      assert.equal(await p.evaluate(()=>!multiplayerLeaveRequest&&!byId('matchBar').inert&&!canvas.inert&&navClosed===0),true);
      // Native Back entry, repeated navigation, and terminal cleanup are idempotent.
      await p.evaluate(()=>{KingPongMatchNavigation.back();showTitleScreen();});
      await p.locator('#multiplayerLeaveConfirm').tap();
      assert.equal(await p.evaluate(()=>!onlineSession&&navClosed===1&&!multiplayerLeaveRequest),true);
      assert.equal(await p.locator(origin==='lan'?'#classicLanDialog':'#matchSetup').isVisible(),true);
      await p.evaluate(()=>{byId('classicLanDialog').hidden=true;syncRoyalFocus()});
    }
    // A result can be left immediately; a new active round restores protection.
    await p.evaluate(()=>{
      closeOnlineConnection(false);startTwoPlayerFromTitle();waitingForServe=false;paused=false;
      lanConnected=true;lanRole='host';onlineSession={close(){}};gameOver=true;
      window.resultGuard=guardMultiplayerLeave(()=>{});gameOver=false;
      window.rematchGuard=guardMultiplayerLeave(()=>{});
    });
    assert.deepEqual(await p.evaluate(()=>[window.resultGuard,window.rematchGuard]),[false,true]);
    await p.evaluate(()=>{
      const original=getConnectedGamepads;
      const pad={index:0,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false}))};
      window.getConnectedGamepads=()=>[pad];gamepadButtonState.clear();
      pad.buttons[GAMEPAD_BUTTONS.B].pressed=true;pollRoyalUiGamepad(performance.now()+100);
      window.getConnectedGamepads=original;
    });
    assert.equal(await p.locator('#multiplayerLeave').isVisible(),false,'controller Back chooses Stay');
    await p.evaluate(()=>{guardMultiplayerLeave(()=>{});closeOnlineConnection(false)});
    assert.equal(await p.locator('#multiplayerLeave').isVisible(),false,'automatic cleanup never waits on confirmation');
    await p.context().close();pass(platform+' touch pause, separate Menu, both roles/all origins leave protection and result exception');
  }
}
