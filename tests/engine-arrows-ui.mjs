import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { Chess } from '../extension/vendor/chess.js';
import { openLibrary, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),extension=join(root,'extension'),baseline=process.argv.includes('--baseline');
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.mp3':'audio/mpeg'};
const server=createServer(async(req,res)=>{try{const path=resolve(extension,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(extension+sep))throw Error('Invalid path');const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':manifest.content_security_policy.extension_pages});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const prefix='MeowlChess-engine-arrows-',profile=await mkdtemp(join(tmpdir(),prefix));let context;
try{
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,reducedMotion:'reduce',viewport:{width:1440,height:1000}});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Review page error:',error.message);});
 await context.route(/^https?:\/\//,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/review.html`);
 await page.waitForFunction(()=>document.querySelectorAll('#board .square').length===64);
 await closeLibrary(page);
 const option=(id,value)=>page.evaluate(({id,value})=>{const control=document.getElementById(id);if(typeof value==='boolean')control.checked=value;else control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 await option('smart-analysis',false);await option('depth','150');await option('multipv','3');await option('show-arrows',true);await option('arrow-mode','best');
 await openLibrary(page);await page.locator('#demo-button').click();
 assert.equal(await page.locator('#board .engine-arrow').count(),0,'An unreviewed game cannot reuse old engine arrows.');
 await page.locator('#analyze-button').click();
 await page.waitForFunction(()=>!document.querySelector('#summary').hidden&&!document.querySelector('#analyze-button').disabled,{}, {timeout:60000});
 const evidence={tab:await page.locator('[role=tab][aria-selected=true]').getAttribute('id'),enabled:await page.locator('#show-arrows').isChecked(),candidates:await page.locator('.engine-line').count(),arrows:await page.locator('.engine-arrow').count()};
 assert.equal(evidence.tab,'summary-tab');assert(evidence.candidates>0);assert.equal(evidence.enabled,true);
 await mkdir(join(root,'test-results'),{recursive:true});
 await writeFile(join(root,`test-results/MeowlChess-engine-arrows-${baseline?'before':'after'}.json`),JSON.stringify(evidence,null,2));
 await page.screenshot({path:join(root,`test-results/MeowlChess-engine-arrows-${baseline?'before':'after'}.png`),fullPage:true});
 if(baseline){assert.equal(evidence.arrows,0);console.log('Reproduced: real completed Stockfish review has candidates and enabled arrows, but Summary suppresses the overlay.');}
 else{
  assert.equal(evidence.arrows,1,'The completed review opens with its enabled best-move arrow on Summary.');
  async function legalArrowCount(expected){
   const fen=(await page.locator('#board').getAttribute('aria-label')).split('FEN: ')[1];
   const arrows=await page.locator('#board .engine-arrow').evaluateAll(paths=>paths.map(path=>({uci:path.dataset.uci,d:path.getAttribute('d'),stroke:path.getAttribute('stroke')})));
   assert.equal(arrows.length,expected);
   for(const arrow of arrows){const chess=new Chess(fen);assert(chess.move({from:arrow.uci.slice(0,2),to:arrow.uci.slice(2,4),promotion:arrow.uci[4]}));assert(arrow.d&&arrow.stroke);}
   if(expected)assert(await page.locator('.engine-overlay').evaluate(svg=>{const box=svg.getBoundingClientRect(),style=getComputedStyle(svg);return box.width>100&&box.height>100&&style.display!=='none'&&style.visibility!=='hidden';}));
  }
  for(const tab of ['summary','coach','practice','moves']){await page.locator(`#${tab}-tab`).click();await legalArrowCount(1);}
  await page.locator('#coach-tab').click();await page.locator('#next-button').click();
  assert.equal(await page.locator('#coach-tab').getAttribute('aria-selected'),'true');await legalArrowCount(1);
  await page.locator('#first-button').click();
  for(const tab of ['summary','coach','moves']){
   await page.locator(`#${tab}-tab`).click();await option('show-arrows',false);await legalArrowCount(0);
   await option('show-arrows',true);await legalArrowCount(1);
   await option('arrow-mode','all');await legalArrowCount(evidence.candidates);
   await option('arrow-mode','best');await legalArrowCount(1);
  }
  await page.locator('#coach-tab').click();const original=await page.locator('.engine-arrow').getAttribute('d');
  await page.locator('#flip-button').click();assert.notEqual(await page.locator('.engine-arrow').getAttribute('d'),original);await legalArrowCount(1);
  await page.locator('#flip-button').click();assert.equal(await page.locator('.engine-arrow').getAttribute('d'),original);
  await page.locator('#moves-tab').click();await page.locator('#next-button').click();await page.locator('#next-button').click();await page.locator('#next-button').click();
  await page.locator('#retry-move').click();await legalArrowCount(0);assert.equal(await page.locator('#retry-panel').isVisible(),true);
  await page.locator('#retry-reveal').click();await legalArrowCount(1);await page.locator('#retry-exit').click();
  await page.locator('#last-button').click();
  for(const tab of ['moves','summary','coach']){await page.locator(`#${tab}-tab`).click();await legalArrowCount(0);}
  await openLibrary(page);await page.locator('#demo-button').click();await legalArrowCount(0);
  assert.deepEqual(errors,[]);
  console.log('Engine arrows pass on Summary/Coach/Moves/Notebook, coach navigation, toggles, multipv, flipping, retry concealment, terminal positions and game reset.');
 }
}finally{await closeTestContext(context,profile,prefix);await new Promise(resolve=>server.close(resolve));}
