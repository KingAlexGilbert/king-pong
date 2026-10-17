import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const root=new URL('../../',import.meta.url);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;const file=new URL('.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--no-sandbox']});
const url=`http://127.0.0.1:${server.address().port}/docs/demo/index.html`;
const errors=[];
try {
 for(const scenario of ['real','rejected','unsupported','plain']) {
  const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
  if(scenario==='rejected')await p.addInitScript(()=>{window.fullscreenCalls=0;Element.prototype.requestFullscreen=function(){fullscreenCalls++;return Promise.reject(Error('denied'));};});
  if(scenario==='unsupported')await p.addInitScript(()=>{Element.prototype.requestFullscreen=undefined;});
  await p.goto(url+(scenario==='plain'?'':'?kingpong_fullscreen=1'));
  assert.equal(await p.evaluate(()=>!!document.fullscreenElement),false);
  await p.locator('.primary-online').click();
  if(scenario==='real') {
   await p.waitForFunction(()=>!!document.fullscreenElement);
   // The fullscreen Escape must not invoke the game's title/reset path.
   await p.evaluate(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
   assert.equal(await p.evaluate(()=>document.body.classList.contains('title-active')),false);
   await p.evaluate(()=>document.exitFullscreen());
   await p.locator('#setupMenuButton').click();
   await p.locator('.primary-online').click();
   assert.equal(await p.evaluate(()=>!!document.fullscreenElement),false);
   await p.locator('#browserFullscreen').click();await p.waitForFunction(()=>!!document.fullscreenElement);
   await p.evaluate(()=>openRoyalGallery('paddle'));
   assert.equal(await p.locator('#browserFullscreen').isVisible(),false,'gallery Close is not covered');
   await p.locator('#royalGalleryClose').click();
   assert.equal(await p.locator('#browserFullscreen').isVisible(),true);
   await p.locator('#browserFullscreen').click();await p.waitForFunction(()=>!document.fullscreenElement);
  } else if(scenario==='rejected') {
   await p.locator('#setupMenuButton').click();await p.locator('.primary-online').click();
   assert.equal(await p.evaluate(()=>fullscreenCalls),1);
   await p.locator('#browserFullscreen').click();assert.equal(await p.evaluate(()=>fullscreenCalls),2);
  } else if(scenario==='unsupported') assert.equal(await p.locator('#browserFullscreen').count(),0);
  else assert.equal(await p.evaluate(()=>!!document.fullscreenElement),false);
  await p.close();console.log('PASS fullscreen '+scenario);
 }
 for(const path of ['windows/webview-2/index.html','Linux/assets/index.html','android/app/src/main/assets/index.html']){
  const p=await browser.newPage();await p.goto(url.replace('docs/demo/index.html',path)+'?kingpong_fullscreen=1');assert.equal(await p.locator('#browserFullscreen').count(),0);await p.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
