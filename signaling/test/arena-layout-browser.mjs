import assert from 'node:assert/strict';
import {polishFixture} from './polish-fixture.mjs';
const f=await polishFixture();
try {
  for(const [width,height,dpr] of [[1920,1080,1],[2560,1440,1],[3840,2160,1],[1280,720,3],[1537,733,1.25],[960,600,1],[640,360,2],[390,844,3],[320,568,1],[844,390,3]]) {
    const p=await f.page(undefined,{viewport:{width,height},deviceScaleFactor:dpr});
    await p.locator('#titleCampaignButton').click();
    await p.evaluate(()=>{royalRotateDismissed=true;syncRoyalUi(true);});
    for(const fullscreen of [false,true,false]) {
      if(fullscreen!==await p.evaluate(()=>!!document.fullscreenElement))await p.locator('#browserFullscreen').click();
      await p.waitForFunction(expected=>Boolean(document.fullscreenElement)===expected,fullscreen);
      await p.locator('#titleScreen').waitFor({state:'hidden'});
      await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const result=await p.evaluate(()=>{
        const root=document.documentElement,body=document.body,game=byId('game'),bar=byId('matchBar');
        const box=game.getBoundingClientRect(),style=getComputedStyle(body);
        const buttons=[...bar.querySelectorAll('button:not([hidden])'),byId('browserFullscreen')].map(e=>e.getBoundingClientRect().toJSON());
        const scrollable=[...document.querySelectorAll('*')].filter(e=>{
          const r=e.getBoundingClientRect(),s=getComputedStyle(e);
          return r.width>0&&s.visibility==='visible'&&s.opacity!=='0'&&/auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+1;
        }).map(e=>e.id||e.className);
        return {rootFits:root.scrollHeight<=root.clientHeight&&root.scrollWidth<=root.clientWidth,
          bodyFits:body.scrollHeight<=body.clientHeight&&body.scrollWidth<=body.clientWidth,
          arenaFits:box.top>=parseFloat(style.paddingTop)-1&&box.bottom<=innerHeight-parseFloat(style.paddingBottom)+1&&box.left>=-1&&box.right<=innerWidth+1,
          buttons,scrollable,viewport:[innerWidth,innerHeight]};
      });
      assert.ok(result.rootFits&&result.bodyFits&&result.arenaFits,JSON.stringify(result));
      assert.deepEqual(result.scrollable,[],'arena has no active overflowing scroll container');
      for(let i=0;i<result.buttons.length;i++)for(let j=i+1;j<result.buttons.length;j++){
        const a=result.buttons[i],b=result.buttons[j];
        assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'toolbar and fullscreen hit areas do not overlap');
      }
    }
    // Legitimate settings scrolling stays enabled and moves when needed.
    await p.setViewportSize({width:390,height:360});
    await p.evaluate(()=>{setMenusVisible(true);byId('matchSettings').open=true;byId('matchHelp').open=true;syncRoyalUi(true);});
    assert.equal(await p.locator('#matchMenu > .match-card').evaluate(e=>{e.scrollTop=100;return getComputedStyle(e).overflowY==='auto'&&e.scrollTop>0;}),true);
    await p.close();console.log(`PASS arena bounds and settings scrolling ${width}x${height} DPR${dpr}`);
  }
  assert.deepEqual(f.errors,[]);
}finally{await f.close();}
