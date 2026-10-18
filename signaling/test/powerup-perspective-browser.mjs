import assert from 'node:assert/strict';
import {builds} from '../../tests/helpers/game-source.mjs';
import {polishFixture} from './polish-fixture.mjs';
const f=await polishFixture();
try {
  for(const [platform,path] of Object.entries(builds)) {
    const p=await f.page(path,{},p=>p.addInitScript(()=>{window.requestAnimationFrame=()=>0;}));
    const results=await p.evaluate(async()=>{
      canvas.width=W;canvas.height=H;
      const results=[];
      for(const type of ['split','rush','guard']) {
        const sprite=royalPickupSprite(type);await sprite.decode();
        const view={guards:{left:0,right:0},pickup:{type,x:217,y:209}};
        const state=JSON.stringify([left,right,ball,saveData,view]);
        const drawIcon=(role,online=false,campaign=false)=>{
          mode=campaign?1:2;lanRole=role;lanConnected=!campaign;lanChannel={readyState:'open'};
          onlineSession=online?{role}:null;
          ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);ctx.save();applyArenaPerspective();drawRoyalEffects(view);ctx.restore();
          const size=ROYAL_PICKUP_RENDER_SIZE,x=twoPlayerViewMirrored()?W-view.pickup.x:view.pickup.x;
          return Array.from(ctx.getImageData(x-size/2,view.pickup.y-size/2,size,size).data);
        };
        const host=drawIcon('host'),guestLan=drawIcon('guest'),guestOnline=drawIcon('guest',true),campaign=drawIcon('none',false,true);
        // Compare at the same pixel position to avoid nearest-neighbour ties
        // choosing different source pixels at different translations.
        view.pickup.x=W-view.pickup.x;const expectedGuest=drawIcon('none',false,true);view.pickup.x=W-view.pickup.x;
        results.push({type,visible:host.some((n,i)=>i%4!==3&&n>0),
          same:host.every((n,i)=>n===campaign[i])&&expectedGuest.every((n,i)=>n===guestLan[i]&&n===guestOnline[i]),
          unchanged:state===JSON.stringify([left,right,ball,saveData,view])});
      }
      return results;
    });
    for(const r of results){assert.equal(r.visible,true);assert.equal(r.same,true,platform+' '+r.type+' orientation at reflected location');assert.equal(r.unchanged,true);}
    console.log('PASS',platform,'all three sprites: campaign, host, LAN guest, online guest; state unchanged');await p.close();
  }
  assert.deepEqual(f.errors,[]);
}finally{await f.close();}
