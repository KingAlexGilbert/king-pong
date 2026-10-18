import assert from 'node:assert/strict';
import {builds} from '../../tests/helpers/game-source.mjs';
import {polishFixture} from './polish-fixture.mjs';
const f = await polishFixture();
try {
  for (const [platform,path] of Object.entries(builds)) {
    const p = await f.page(path);
    await p.evaluate(() => { savePlayerPreference('originalBossMusic',false); });
    assert.equal(await p.locator('#originalBossMusicRow').isVisible(),false);
    await p.evaluate(() => { saveData.bossUnlocked=true; saveProgressNow(); syncRoyalUi(true); });
    await p.reload();
    await p.evaluate(() => { setMenusVisible(true); byId('matchSettings').open=true; });
    assert.equal(await p.locator('#originalBossMusicRow').isVisible(),true);
    assert.equal(await p.evaluate(() => playerPreference('originalBossMusic')),false);
    for (const [width,height] of [[1920,1080],[1280,720],[844,390],[390,844],[320,568]]) {
      await p.setViewportSize({width,height});
      await p.evaluate(() => { showTitleScreen(); startCampaignFromSave(); royalRotateDismissed=true; syncRoyalUi(true); });
      await p.waitForTimeout(500);
      const toolbar = await p.locator('#matchBar button:not([hidden])').evaluateAll(nodes=>nodes.map(e=>e.getBoundingClientRect().toJSON()));
      assert.ok(toolbar.every(b=>b.x>=0&&b.right<=width), `${platform} ${width} toolbar in viewport`);
      for(let i=0;i<toolbar.length;i++)for(let j=i+1;j<toolbar.length;j++)assert.ok(toolbar[i].right<=toolbar[j].left||toolbar[j].right<=toolbar[i].left||toolbar[i].bottom<=toolbar[j].top||toolbar[j].bottom<=toolbar[i].top,'toolbar buttons never overlap');
      await p.evaluate(() => serveOrContinue());
      const save = await p.evaluate(() => JSON.stringify(saveData));
      await p.locator('#campaignBack').click();
      assert.equal(await p.evaluate(() => document.body.classList.contains('title-active')),true);
      assert.equal(await p.evaluate(() => JSON.stringify(saveData)),save,'leaving awards no progress');
      await p.evaluate(() => { hideTitleScreen(); startBossFight(); royalRotateDismissed=true; syncRoyalUi(true); });
      await p.waitForTimeout(500);
      const hud = await p.evaluate(() => {
        const text=drawText,health=drawHealthBar;let words=[],bars=0;
        try {drawText=(s)=>words.push(s);drawHealthBar=()=>bars++;drawBossHud();}finally{drawText=text;drawHealthBar=health;}
        return {words,bars};
      });
      assert.deepEqual(hud,{words:[],bars:2});
      assert.equal(await p.locator('#matchContext').textContent(),await p.evaluate(()=>BOSS_LEVEL.name));
      const context = await p.locator('#matchContext').boundingBox();
      assert.ok(context && context.width>50 && context.height>0,'outside boss arena information remains visible');
      await f.shot(p,`${platform}-boss-${width}x${height}`);
      const bossSave=await p.evaluate(()=>JSON.stringify(saveData));await p.locator('#campaignBack').click();
      assert.equal(await p.evaluate(()=>JSON.stringify(saveData)),bossSave);
    }
    await p.evaluate(()=>{startOnlineSetup(true);syncRoyalUi(true);});
    assert.equal(await p.locator('#campaignBack').isVisible(),false);
    await p.locator('#onlinePowerups').click();
    if(await p.locator('#onlinePowerups').getAttribute('aria-pressed')!=='true')await p.locator('#onlinePowerups').click();
    await p.mouse.move(0,0);await p.waitForTimeout(200);
    assert.equal(await p.locator('#onlinePowerups').evaluate(e=>getComputedStyle(e).borderColor),'rgb(255, 212, 105)');
    await p.locator('#onlinePowerups').click();await p.mouse.move(0,0);await p.waitForTimeout(200);
    assert.notEqual(await p.locator('#onlinePowerups').evaluate(e=>getComputedStyle(e).borderColor),'rgb(255, 212, 105)');
    await p.reload();assert.equal(await p.evaluate(()=>playerPreference('royalPowerupsEnabled')),false);
    await p.evaluate(()=>{loadSaveSlot(1);setMenusVisible(true);byId('matchSettings').open=true;syncRoyalUi(true);});
    assert.equal(await p.locator('#originalBossMusicRow').isVisible(),false,'new save does not expose boss control');
    await p.close();console.log(`PASS ${platform} unlocked music, powerup style/persistence, Back and boss HUD`);
  }
  assert.deepEqual(f.errors,[]);
}finally{await f.close();}
