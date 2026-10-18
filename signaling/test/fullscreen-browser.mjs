import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium, firefox} from 'playwright';
const root=new URL('../../',import.meta.url);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;const file=new URL('.'+path,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const engine=process.env.KING_PONG_BROWSER==='firefox'?firefox:chromium;
const browser=await engine.launch({args:engine===chromium?['--no-sandbox']:[]});
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
 // Browser chrome keys cannot be driven reliably by DOM keyboard automation.
 // Exercise both exposed F11 state APIs without pretending these are physical F11 tests.
 for(const signal of ['firefox-property','display-mode']) {
  const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(signal=>{
   window.browserMode=true;window.fullscreenCalls=0;
   const request=Element.prototype.requestFullscreen;
   Element.prototype.requestFullscreen=function(...args){fullscreenCalls++;return request.apply(this,args);};
   if(signal==='firefox-property')Object.defineProperty(window,'fullScreen',{get:()=>browserMode});
   else {const match=window.matchMedia.bind(window);window.matchMedia=query=>query==='(display-mode: fullscreen)'?{get matches(){return browserMode},addEventListener(){}}:match(query);}
  },signal);
  await p.goto(url+'?kingpong_fullscreen=1');
  await p.locator('#browserFullscreen').click();
  assert.equal(await p.locator('#browserFullscreen').getAttribute('data-fullscreen-mode'),'browser');
  assert.equal(await p.locator('#browserFullscreenHint').isVisible(),true);
  assert.equal(await p.evaluate(()=>fullscreenCalls),0,'never nests element fullscreen inside browser fullscreen');
  await p.locator('.primary-online').click();
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>document.body.classList.contains('title-active')),false,'browser fullscreen Escape does not reset the game');
  for(let i=0;i<3;i++){
   await p.evaluate(()=>{browserMode=false;dispatchEvent(new Event('resize'));});
   await p.locator('#browserFullscreen').click();await p.waitForFunction(()=>!!document.fullscreenElement);
   await p.locator('#browserFullscreen').click();await p.waitForFunction(()=>!document.fullscreenElement);
   await p.evaluate(()=>{browserMode=true;dispatchEvent(new Event('resize'));});
   await p.locator('#browserFullscreen').click();
  }
  assert.equal(await p.evaluate(()=>fullscreenCalls),3);
  await p.close();console.log('PASS fullscreen '+signal);
 }
 for(const path of ['windows/webview-2/index.html','Linux/assets/index.html','android/app/src/main/assets/index.html']){
  const p=await browser.newPage();await p.goto(url.replace('docs/demo/index.html',path)+'?kingpong_fullscreen=1');assert.equal(await p.locator('#browserFullscreen').count(),0);await p.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
