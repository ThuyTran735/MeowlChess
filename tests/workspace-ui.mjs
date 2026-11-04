import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {closeLibrary,openLibrary,openImport,closeTestContext} from './ui-helpers.mjs';
const root=resolve(import.meta.dirname,'..'),extension=join(root,'extension'),prefix='MeowlChess-workspace-controls-',profile=await mkdtemp(join(tmpdir(),prefix));let context;
try {
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH,headless:true,viewport:{width:1440,height:900},reducedMotion:'reduce',ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//,route=>route.abort());const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/review.html');
 await openImport(page);await page.locator('#pgn-text').fill('[Event "Workspace review"]\n[White "Player"]\n[Black "Opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1');await page.locator('#import-button').click();await closeLibrary(page);
 await page.locator('#review-settings > summary').click();await page.locator('#depth').selectOption('50');await page.locator('#smart-analysis').uncheck();await page.locator('#close-settings').click();await page.locator('#analyze-button').click();await page.locator('#coach-companion').waitFor({state:'visible',timeout:60000});
 const target=join(root,'test-results/MeowlChess-responsive');await mkdir(target,{recursive:true});const findings=[];
 for(const [width,height]of[[1440,900],[1366,768],[375,812],[320,740]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));await page.locator('#review-settings > summary').click();await page.locator('#settings-content').waitFor({state:'visible'});
  await page.locator('.settings-scroll').evaluate(el=>el.scrollTop=0);await page.screenshot({path:join(target,width+'-settings.png')});
  const bounds=await page.locator('#settings-content').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,viewportW:innerWidth,viewportH:innerHeight};});assert(bounds.x>=0&&bounds.right<=width&&bounds.y>=0&&bounds.bottom<=height);
  const scroll=page.locator('.settings-scroll');await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);await page.locator('#site-lichess-username').fill('WorkspaceTester');await page.screenshot({path:join(target,width+'-settings-bottom.png')});assert.equal(await page.locator('#site-lichess-username').inputValue(),'WorkspaceTester');
  const bottom=await page.locator('#site-lichess-username').boundingBox();assert(bottom.y>=bounds.y&&bottom.y+bottom.height<=bounds.bottom,'The bottom settings field must remain reachable inside the scrolling panel');
  assert(await page.locator('#review-settings').evaluate(el=>el.open));await page.keyboard.press('Escape');assert(!await page.locator('#review-settings').evaluate(el=>el.open));assert.equal(await page.evaluate(()=>document.activeElement?.parentElement?.id),'review-settings');
  await page.locator('#review-settings > summary').click();await page.locator('#close-settings').click();assert(!await page.locator('#review-settings').evaluate(el=>el.open));
  await page.locator('#review-settings > summary').click();await page.locator('#library-toggle').focus();assert(!await page.locator('#review-settings').evaluate(el=>el.open),'Keyboard focus leaving Settings dismisses the disclosure');
  await page.locator('#review-settings > summary').click();await page.mouse.click(4,4);assert(!await page.locator('#review-settings').evaluate(el=>el.open),'Pointer click outside Settings dismisses the disclosure');
  const order=await page.evaluate(()=>{const at=s=>document.querySelector(s).getBoundingClientRect();const b=at('.board-column'),i=at('.insights-column'),c=at('#coach-companion');return{boardBottom:b.bottom,insightsTop:i.top,insightsBottom:i.bottom,companionTop:c.top};});
  if(width<400){assert(order.insightsTop>=order.boardBottom,'Mobile review content follows the board');assert(order.companionTop>=order.insightsBottom,'Mobile review content precedes the companion');}
  await openLibrary(page);await page.locator('[data-library-jump="import-panel"]').click();assert(await page.locator('#import-panel').evaluate(el=>el.open));await page.screenshot({path:join(target,width+'-import-shortcut.png')});
  await page.locator('[data-library-jump="saved-panel"]').click();assert(await page.locator('#saved-panel').evaluate(el=>el.open));await page.locator('[data-library-jump="online-games"]').click();assert.equal(await page.evaluate(()=>document.activeElement?.id),'game-source');
  findings.push({width,height,settings:bounds});await closeLibrary(page);
 }
 assert.deepEqual(errors,[]);await writeFile(join(target,'MeowlChess-controls-findings.json'),JSON.stringify({findings,errors},null,2));console.log(JSON.stringify({viewports:findings.length,errors}));
}finally{await closeTestContext(context,profile,prefix);}
