import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const helper = await readFile(join(root, 'extension', 'site-panel.js'), 'utf8');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-panel-test-'));
let context;
const key = 'siteReviewPanelPosition:chesscom';
const sizeKey = 'siteReviewPanelSize:chesscom';
const fixture = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#302e2b;height:1800px}</style><body>
<script>
window.chrome ??= {};
chrome.storage = {local:{get:async key=>({[key]:JSON.parse(localStorage.getItem(key)||'null')}),set:async values=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,JSON.stringify(value));}}};
</script><script src="/site-panel.js"></script><script>
const host = document.createElement('div');host.id='panel';host.style.cssText='position:fixed;top:76px;right:16px;width:min(360px,calc(100vw - 24px));';
const shadow=host.attachShadow({mode:'closed'});shadow.innerHTML='<style>:host{font:13px Arial;color:#eee}.head{display:flex;align-items:center;gap:7px;padding:9px 10px;background:#292b26}.brand{flex:1;font-weight:bold}button{width:28px;height:28px}.body{background:#383d30;height:160px;max-height:calc(100vh - 140px);overflow:auto;scrollbar-gutter:stable}.text{padding:12px}.icon{display:block;width:24px;height:24px;margin:8px}input,textarea,summary,a,[role=button]{margin:8px;display:block}.long{height:500px}</style><section class="panel"><div class="head"><span class="brand">MeowlChess</span><button title="Collapse">⌃</button></div><div class="body"><div class="text">Completed game summary</div><img class="icon" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect width=%2224%22 height=%2224%22 fill=%22green%22/%3E%3C/svg%3E"><input aria-label="Name"><textarea aria-label="PGN"></textarea><details><summary>Import options</summary>Choose a game</details><a href="#test">Link</a><div role="button" tabindex="0">Action</div><div class="long">Scroll content</div></div></section>';
document.body.append(host);const handle=shadow.querySelector('.brand'),body=shadow.querySelector('.body'),button=shadow.querySelector('button'),surface=shadow.querySelector('.panel');
let clicks=0;button.onclick=()=>{clicks++;body.hidden=!body.hidden;};
const ends=[];
const sizeStyle=document.createElement('style');sizeStyle.textContent='.panel{position:relative;box-sizing:border-box;display:flex;flex-direction:column;height:var(--meowl-panel-height,auto)}.head{flex:none}.body{flex:none;min-height:0}:host([data-resized=true]) .body{flex:1;height:auto!important;max-height:none}:host([data-collapsed=true]) .panel{height:auto}:host([data-collapsed=true]) .resize-grip{display:none}.resize-grip{position:absolute;right:0;bottom:0;width:20px;height:20px;padding:0;margin:0}';shadow.append(sizeStyle);
const edgeStyle=document.createElement('style');edgeStyle.textContent='.resize-grip{border:0;z-index:2;opacity:.7}.resize-n,.resize-s{left:12px;right:12px;width:auto;height:6px}.resize-n{top:-5px;bottom:auto}.resize-s{bottom:-5px}.resize-e,.resize-w{top:12px;bottom:12px;height:auto;width:6px}.resize-e{right:-5px}.resize-w{left:-5px;right:auto}.resize-ne,.resize-nw,.resize-se,.resize-sw{width:12px;height:12px}.resize-ne{top:-5px;right:-5px;bottom:auto}.resize-nw{top:-5px;left:-5px;right:auto;bottom:auto}.resize-se{right:-5px;bottom:-5px}.resize-sw{left:-5px;right:auto;bottom:-5px}';shadow.append(edgeStyle);
const resizeHandles=['se','n','s','e','w','ne','nw','sw'].map(direction=>{const grip=document.createElement('button');grip.className='resize-grip resize-'+direction;grip.dataset.noDrag='';grip.dataset.resizeDirection=direction;grip.textContent=direction==='se'?'◢':'';shadow.append(grip);return grip;});
const resizeHandle=resizeHandles[0];
button.onclick=()=>{clicks++;body.hidden=!body.hidden;host.dataset.collapsed=String(body.hidden);};
const mover=__meowlChessCreatePanelMover({host,handle,surface,resizeHandle,resizeHandles,source:'chesscom',onFrameDragEnd:value=>ends.push(value)});
window.testPanel={host,handle,body,button,surface,shadow,resizeHandle,resizeHandles,mover,ends,clicks:()=>clicks};
</script>`;

try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, hasTouch: true, viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce'
  });
  const page = context.pages()[0] || await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await context.route('http://meowlchess.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('/site-panel.js') ? 'application/javascript' : 'text/html', body: route.request().url().endsWith('/site-panel.js') ? helper : fixture }));
  const box = () => page.locator('#panel').boundingBox();
  const handlePoint = () => page.evaluate(() => { const r=testPanel.handle.getBoundingClientRect();return {x:r.x+30,y:r.y+r.height/2}; });
  const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const near = (actual, expected) => assert(Math.abs(actual-expected)<2, `Expected ${actual} near ${expected}`);
  await page.goto('http://meowlchess.test/'); await settle();
  const initial = await box(); near(initial.x,824); near(initial.y,76);

  // Real pointer capture keeps dragging when the pointer leaves the header.
  let point=await handlePoint();
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x-540,point.y+290,{steps:8});await page.mouse.up();
  let moved=await box();near(moved.x,284);near(moved.y,366);assert.deepEqual(await stored(),{left:284,top:366});
  await page.reload();await page.waitForFunction(() => document.querySelector('#panel').style.left==='284px');
  moved=await box();near(moved.y,366);

  // Controls remain clickable and do not move the panel.
  const button=await page.evaluate(() => {const r=testPanel.button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(button.x,button.y);await settle();
  assert.equal(await page.evaluate(() => testPanel.clicks()),1);near((await box()).x,284);near((await box()).y,366);
  await page.mouse.click(button.x,button.y);await settle();

  // Keyboard placement, quick movement, and reset are available on the handle.
  await page.evaluate(() => testPanel.handle.focus());
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowUp');
  near((await box()).x,274);near((await box()).y,326);
  await page.keyboard.press('Home');near((await box()).x,824);near((await box()).y,76);

  // Dragging cannot move the panel outside the viewport.
  point=await handlePoint();await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(0,0);await page.mouse.up();
  near((await box()).x,8);near((await box()).y,8);
  point=await handlePoint();await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(1199,899);await page.mouse.up();
  moved=await box();assert(moved.x+moved.width<=1192);assert(moved.y+moved.height<=892);

  // Summary expansion and viewport changes keep the complete panel reachable.
  await page.evaluate(() => testPanel.body.style.height='610px');await settle();
  moved=await box();assert(moved.y+moved.height<=892);
  await page.setViewportSize({width:390,height:450});await settle();
  moved=await box();assert(moved.x>=8&&moved.x+moved.width<=382);assert(moved.y>=8&&moved.y+moved.height<=442);
  await page.setViewportSize({width:1200,height:900});
  await page.evaluate(() => {testPanel.body.style.height='160px';testPanel.handle.focus();});await page.keyboard.press('Home');await settle();

  // Real touch input uses the same handle without scrolling the chess page.
  const cdp=await context.newCDPSession(page);point=await handlePoint();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-400,y:point.y+160,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
  near((await box()).x,424);near((await box()).y,236);assert.equal(await page.evaluate(()=>scrollY),0);

  // Escape rolls an in-progress drag back instead of saving its temporary place.
  const beforeCancel=await box();point=await handlePoint();
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+100,point.y+80);
  await page.keyboard.press('Escape');await page.mouse.up();near((await box()).x,beforeCancel.x);near((await box()).y,beforeCancel.y);

  // Background text and images are also genuine drag surfaces.
  const targetPoint = selector => page.evaluate(selector => {const element=testPanel.shadow.querySelector(selector);element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:r.x+Math.min(30,r.width/2),y:r.y+r.height/2};},selector);
  for (const selector of ['.text','.icon']) {
    const before=await box();point=await targetPoint(selector);
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x-65,point.y-35,{steps:5});await page.mouse.up();
    near((await box()).x,before.x-65);near((await box()).y,before.y-35);
  }

  // Interactive elements keep focus/click behavior, including text selection.
  for (const selector of ['input','textarea','summary','a','[role="button"]']) {
    point=await targetPoint(selector);const before=await box();
    await page.mouse.click(point.x,point.y);near((await box()).x,before.x);near((await box()).y,before.y);
    assert.equal(await page.evaluate(()=>testPanel.host.dataset.dragging),undefined);
  }
  point=await targetPoint('input');await page.mouse.click(point.x,point.y);await page.keyboard.insertText('Alice');
  assert.equal(await page.evaluate(()=>testPanel.shadow.querySelector('input').value),'Alice');
  assert.equal(await page.evaluate(()=>testPanel.shadow.querySelector('details').open),true);

  // Wheel and native scrollbar gestures scroll the panel instead of moving it.
  await page.evaluate(()=>testPanel.body.scrollTop=0);point=await targetPoint('.text');const beforeScroll=await box();
  await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,140);
  await page.waitForFunction(()=>testPanel.body.scrollTop>0);
  near((await box()).x,beforeScroll.x);near((await box()).y,beforeScroll.y);
  const scrollbar=await page.evaluate(()=>{const r=testPanel.body.getBoundingClientRect();return {x:r.right-3,y:r.top+15};});
  await page.mouse.move(scrollbar.x,scrollbar.y);await page.mouse.down();await page.mouse.move(scrollbar.x,scrollbar.y+35);await page.mouse.up();
  near((await box()).x,beforeScroll.x);near((await box()).y,beforeScroll.y);

  // The validated frame bridge uses stable screen deltas and one owned pointer.
  await page.evaluate(()=>{testPanel.body.scrollTop=0;testPanel.handle.focus();});await page.keyboard.press('Home');
  const sendDrag = data => page.evaluate(data=>testPanel.mover.frameDrag(data),data);
  const start={phase:'start',pointerId:17,screenX:900,screenY:400};
  assert.equal(await sendDrag({...start,screenX:Infinity}),false);
  assert.equal(await sendDrag(start),true);
  assert.equal(await sendDrag({...start,pointerId:18}),false);
  assert.equal(await sendDrag({...start,phase:'move',pointerId:18,screenX:700}),false);
  assert.equal(await sendDrag({...start,phase:'move',screenX:600,screenY:500}),true);
  near((await box()).x,524);near((await box()).y,176);
  await sendDrag({...start,phase:'end',screenX:600,screenY:500});
  assert.deepEqual(await stored(),{left:524,top:176});
  await sendDrag(start);await sendDrag({...start,phase:'move',screenX:800,screenY:450});
  await sendDrag({...start,phase:'cancel',screenX:800,screenY:450});near((await box()).x,524);near((await box()).y,176);
  await sendDrag(start);await sendDrag({...start,phase:'move',screenX:800,screenY:450});
  await page.keyboard.press('Escape');near((await box()).x,524);near((await box()).y,176);
  assert.equal(await sendDrag({...start,phase:'move'}),false);

  // A parent-owned shield receives genuine movement outside the originating
  // frame, uses parent client coordinates, and releases without focus changes.
  await page.evaluate(()=>testPanel.handle.focus());await page.keyboard.press('Home');
  await page.mouse.move(500,500);await page.mouse.down();
  const parentStart={phase:'start',pointerId:1,screenX:9999,screenY:8888,parentX:500,parentY:500};
  const focusBefore=await page.evaluate(()=>testPanel.shadow.activeElement?.className);
  assert.equal(await sendDrag(parentStart),true);
  assert.equal(await page.locator('#meowlchess-drag-shield').count(),1);
  assert.equal(await page.evaluate(()=>testPanel.shadow.activeElement?.className),focusBefore);
  await page.mouse.move(300,580,{steps:5});near((await box()).x,624);near((await box()).y,156);
  await page.mouse.move(400,550,{steps:5});near((await box()).x,724);near((await box()).y,126);
  await page.mouse.up();assert.equal(await page.locator('#meowlchess-drag-shield').count(),0);
  assert.deepEqual(await page.evaluate(()=>testPanel.ends.at(-1)),{pointerId:1,canceled:false});
  assert.deepEqual(await stored(),{left:724,top:126});
  await sendDrag(parentStart);await sendDrag({...parentStart,phase:'move',parentX:450,parentY:550});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#meowlchess-drag-shield').count(),0);
  near((await box()).x,724);near((await box()).y,126);
  assert.deepEqual(await page.evaluate(()=>testPanel.ends.at(-1)),{pointerId:1,canceled:true});
  await sendDrag(parentStart);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('#meowlchess-drag-shield').count(),0);

  // The bottom-right grip changes expanded dimensions and remembers them apart
  // from position. Resizing near an edge shifts only enough to stay on screen.
  const gripPoint = () => page.evaluate(()=>{const r=testPanel.resizeHandle.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  const storedSize = () => page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),sizeKey);
  await page.evaluate(()=>testPanel.handle.focus());await page.keyboard.press('Home');
  point=await handlePoint();await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x-300,point.y+40);await page.mouse.up();
  const natural=await box();point=await gripPoint();
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  assert.equal(await page.locator('#meowlchess-resize-shield').count(),1);
  await page.mouse.move(point.x+100,point.y+110,{steps:6});await page.mouse.up();
  assert.equal(await page.locator('#meowlchess-resize-shield').count(),0);
  const resized=await box();near(resized.width,natural.width+100);near(resized.height,natural.height+110);
  assert(resized.x+resized.width<=1192);near(resized.y,natural.y);
  assert.deepEqual(await storedSize(),{width:Math.round(resized.width),height:Math.round(resized.height)});
  assert.equal(await page.evaluate(()=>testPanel.host.dataset.resized),'true');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#panel').dataset.resized==='true');await settle();
  near((await box()).width,resized.width);near((await box()).height,resized.height);
  await page.evaluate(()=>testPanel.button.click());await settle();assert((await box()).height<100);
  await page.evaluate(()=>testPanel.button.click());await settle();near((await box()).height,resized.height);
  const beforeResizeCancel=await box();point=await gripPoint();
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x-90,point.y-80,{steps:4});
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.locator('#meowlchess-resize-shield').count(),0);
  near((await box()).width,beforeResizeCancel.width);near((await box()).height,beforeResizeCancel.height);
  point=await gripPoint();await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x-60,point.y-30);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();
  assert.equal(await page.locator('#meowlchess-resize-shield').count(),0);
  near((await box()).width,beforeResizeCancel.width);near((await box()).height,beforeResizeCancel.height);
  await page.evaluate(()=>testPanel.resizeHandle.focus());await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');
  near((await box()).width,beforeResizeCancel.width+10);near((await box()).height,beforeResizeCancel.height+40);
  await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>testPanel.host.dataset.resized),undefined);
  near((await box()).width,360);assert.equal(await storedSize(),null);
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');
  point=await gripPoint();await page.mouse.dblclick(point.x,point.y);await settle();
  assert.equal(await page.evaluate(()=>testPanel.host.dataset.resized),undefined);assert.equal(await storedSize(),null);
  await page.evaluate(()=>testPanel.resizeHandle.focus());await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');
  await page.setViewportSize({width:250,height:210});await settle();
  const small=await box();assert(small.width<=234&&small.height<=194&&small.x>=8&&small.y>=8);
  await page.setViewportSize({width:1200,height:900});await settle();await page.keyboard.press('Home');

  // Every side/corner moves only the chosen edges, preserving opposite anchors.
  const edgePoint = direction => page.evaluate(direction=>{const r=testPanel.resizeHandles.find(grip=>grip.dataset.resizeDirection===direction).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},direction);
  const resetEdgeFixture = async () => {
    await page.evaluate(({key,sizeKey})=>{localStorage.setItem(key,JSON.stringify({left:350,top:250}));localStorage.setItem(sizeKey,JSON.stringify({width:400,height:360}));},{key,sizeKey});
    await page.reload();await page.waitForFunction(()=>document.querySelector('#panel').style.left==='350px'&&document.querySelector('#panel').dataset.resized==='true');await settle();
  };
  const edgeDrag = async (direction,dx,dy) => {
    point=await edgePoint(direction);await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+dx,point.y+dy,{steps:5});await page.mouse.up();return box();
  };
  for (const direction of ['n','s','e','w','ne','nw','se','sw']) {
    await resetEdgeFixture();
    const before=await box(),dx=direction.includes('w')?-55:55,dy=direction.includes('n')?-45:45;
    const after=await edgeDrag(direction,dx,dy);
    near(after.width,400+(/[we]/.test(direction)?55:0));near(after.height,360+(/[ns]/.test(direction)?45:0));
    near(after.x,direction.includes('w')?295:350);near(after.y,direction.includes('n')?205:250);
    if (direction.includes('w')) near(after.x+after.width,before.x+before.width);
    if (direction.includes('n')) near(after.y+after.height,before.y+before.height);
  }
  assert.deepEqual(await page.evaluate(()=>testPanel.resizeHandles.map(grip=>[grip.dataset.resizeDirection,grip.tabIndex])),[['se',0],['n',-1],['s',-1],['e',-1],['w',-1],['ne',-1],['nw',-1],['sw',-1]]);
  await resetEdgeFixture();let edgeBox=await edgeDrag('nw',1000,1000);
  near(edgeBox.width,280);near(edgeBox.height,220);near(edgeBox.x+edgeBox.width,750);near(edgeBox.y+edgeBox.height,610);
  await resetEdgeFixture();edgeBox=await edgeDrag('nw',-1000,-1000);
  near(edgeBox.x,8);near(edgeBox.y,8);near(edgeBox.x+edgeBox.width,750);near(edgeBox.y+edgeBox.height,610);
  await resetEdgeFixture();edgeBox=await edgeDrag('se',1000,1000);
  near(edgeBox.x,350);near(edgeBox.y,250);near(edgeBox.x+edgeBox.width,1192);near(edgeBox.y+edgeBox.height,892);
  await resetEdgeFixture();await page.evaluate(()=>testPanel.resizeHandles.find(grip=>grip.dataset.resizeDirection==='w').focus());await page.keyboard.press('ArrowRight');
  edgeBox=await box();near(edgeBox.x,360);near(edgeBox.width,390);near(edgeBox.y,250);near(edgeBox.height,360);
  await page.evaluate(()=>testPanel.resizeHandles.find(grip=>grip.dataset.resizeDirection==='n').focus());await page.keyboard.press('Shift+ArrowDown');
  edgeBox=await box();near(edgeBox.y,290);near(edgeBox.height,320);near(edgeBox.x,360);near(edgeBox.width,390);
  await resetEdgeFixture();const edgeBefore=await box();point=await edgePoint('nw');
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x-50,point.y-40);await page.keyboard.press('Escape');await page.mouse.up();
  edgeBox=await box();near(edgeBox.x,edgeBefore.x);near(edgeBox.y,edgeBefore.y);near(edgeBox.width,edgeBefore.width);near(edgeBox.height,edgeBefore.height);
  await edgeDrag('nw',-55,-45);await page.reload();await page.waitForFunction(()=>document.querySelector('#panel').style.left==='295px');
  edgeBox=await box();near(edgeBox.x,295);near(edgeBox.y,205);near(edgeBox.width,455);near(edgeBox.height,405);

  // Bad storage data is ignored, and teardown removes all movement behavior.
  await page.evaluate(({key,sizeKey})=>{localStorage.setItem(key,JSON.stringify({left:'bad',top:1e15}));localStorage.setItem(sizeKey,JSON.stringify({width:-50,height:'bad'}));},{key,sizeKey});await page.reload();await settle();
  near((await box()).x,824);near((await box()).y,76);
  await sendDrag(parentStart);
  await page.evaluate(()=>{testPanel.mover.destroy();testPanel.handle.tabIndex=0;testPanel.handle.focus();});
  assert.equal(await page.locator('#meowlchess-drag-shield').count(),0);
  await page.keyboard.press('ArrowLeft');near((await box()).x,824);
  assert.deepEqual(errors,[]);
  assert.equal(await sendDrag(start),false);
  console.log('Movable panel passed: header/body/text/image drag, mouse/touch, controls, wheel/scrollbar, frame bridge ownership/cancel, saved placement, keyboard/reset, bounds, resize, growth, invalid storage, and cleanup.');
} finally {
  await closeTestContext(context,profile,'meowlchess-panel-test-');
}
