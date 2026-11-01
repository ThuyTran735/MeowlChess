import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), extension = join(root, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-share-test-'));
const fixture = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/summary-share.css"><style>body{margin:0;background:#211f1d;color:#eee}#open{margin:20px;padding:12px}</style></head><body><button id="open">Share summary</button><script type="module">
import {createSummaryShare,renderSummaryImage} from '/lib/summary-share.js';
import {parseGame,MOVE_LABELS} from '/lib/review.js';
import {importPgn} from '/lib/pgn.js';
const pgn='[White "White player"]\\n[Black "Black player"]\\n[Result "1/2-1/2"]\\n\\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 11. Qf3 Be7 12. Rfe1 Be6 13. Rad1 Qc7 14. Kh1 Kh8 15. Re2 Rfe8 1/2-1/2';
const parsed=parseGame(pgn), game=importPgn(pgn);
game.end_time=Date.UTC(2026,9,30)/1000;game.white.username='A very long player name that should wrap without crossing into the other card';game.black.username='Melonpi Cat';
const moves=parsed.moves.map((move,i)=>({...move,ply:i+1,label:MOVE_LABELS[i%MOVE_LABELS.length],probabilityLoss:.01}));
const summary=Object.fromEntries(['w','b'].map(color=>[color,{accuracy:color==='w'?88.4:91.2,counts:Object.fromEntries(MOVE_LABELS.map(label=>[label,moves.filter(move=>move.color===color&&move.label===label).length]))}]));
window.snapshot={game,result:{game:parsed,moves,positions:parsed.positions.map(()=>({cp:0})),summary,opening:{eco:'C45',name:'Scotch Game'}},analysis:{engineId:'stockfish',engineName:'Stockfish 18',moveTimeMs:50}};
window.share=createSummaryShare({getSummary:()=>window.snapshot});window.renderSummaryImage=renderSummaryImage;
document.querySelector('#open').onclick=()=>void share.open();
window.drawnText=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,x,y,...rest){const width=this.measureText(value).width;window.drawnText.push({value:String(value),x,y,width,align:this.textAlign});return fill.call(this,value,x,y,...rest);};
window.ready=true;
</script></body></html>`;
let context;
try {
  context = await chromium.launchPersistentContext(profile, { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless:true, viewport:{width:1000,height:950}, reducedMotion:'reduce', acceptDownloads:true });
  const external=[], errors=[];
  await context.route('**/*', async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://meowlchess.test'){external.push(url.href);return route.abort();}
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fixture});
    const file=resolve(extension,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(extension+sep))return route.abort();
    const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    try{return route.fulfill({contentType:types[extname(file)]||'text/plain',body:await readFile(file)});}catch{return route.fulfill({status:404,body:'Not found'});}
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://meowlchess.test/');await page.waitForFunction(()=>window.ready);
  await page.locator('#open').click();
  const dialog=page.locator('#meowl-summary-share'),save=dialog.locator('[data-share-save]'),copy=dialog.locator('[data-share-copy]');
  await page.waitForFunction(()=>!document.querySelector('[data-share-save]').disabled);
  assert.equal(await dialog.getAttribute('data-no-drag'),'');
  const text=await page.evaluate(()=>drawnText);
  assert(text.some(row=>row.value==='88.4'));assert(text.some(row=>row.value==='91.2'));
  assert(text.some(row=>row.value==='1–0 · White won')===false);
  assert(text.some(row=>row.value.startsWith('½–½ · Draw')));
  assert(text.some(row=>row.value==='Brilliant'));assert(text.some(row=>row.value==='Blunder'));
  assert(text.some(row=>row.value.includes('not account Elo')));
  for(const row of text){const left=row.x-(row.align==='center'?row.width/2:row.align==='right'?row.width:0);assert(left>=52&&left+row.width<=1148,`Text overflow: ${row.value}`);}
  await mkdir(join(root,'test-results'),{recursive:true});
  await page.screenshot({path:join(root,'test-results','share-dialog-desktop.png')});
  const downloadEvent=page.waitForEvent('download');await save.click();const download=await downloadEvent;
  assert.match(download.suggestedFilename(),/^MeowlChess-[\w-]+\.png$/);
  const png=await readFile(await download.path());assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),1200);
  await writeFile(join(root,'test-results','share-summary-preview.png'),png);
  // Clipboard calls are isolated from the user's system clipboard.
  await page.evaluate(()=>{window.ClipboardItem=class{constructor(items){this.items=items}};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{throw new Error('Denied')}}});});
  await copy.click();await page.waitForFunction(()=>document.querySelector('.summary-share-status').textContent.includes('Use Save image instead'));
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{window.copied={type:items[0].items['image/png'].type,size:items[0].items['image/png'].size};}}}));
  await copy.click();await page.waitForFunction(()=>document.querySelector('.summary-share-status').textContent.includes('Image copied'));
  assert.equal((await page.evaluate(()=>window.copied)).type,'image/png');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('#open').evaluate(el=>el===document.activeElement),true);
  assert.equal(await dialog.locator('img').getAttribute('src'),null);
  await page.setViewportSize({width:250,height:320});await page.locator('#open').click();await page.waitForFunction(()=>!document.querySelector('[data-share-save]').disabled);
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await save.scrollIntoViewIfNeeded();await page.screenshot({path:join(root,'test-results','share-dialog-small.png')});
  assert(await save.isVisible());const rect=await save.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=250&&rect.y>=0&&rect.y+rect.height<=320);
  await dialog.locator('.summary-share-close').click();await dialog.waitFor({state:'hidden'});
  // Closing while assets/rendering are pending cannot repopulate a stale preview.
  await page.evaluate(()=>{void share.open();share.close();});await page.waitForTimeout(100);
  assert.equal(await dialog.evaluate(el=>el.open),false);assert.equal(await dialog.locator('img').getAttribute('src'),null);
  await page.evaluate(()=>{window.snapshot.result.game.headers.Result='*';});await page.locator('#open').click();
  await page.waitForFunction(()=>document.querySelector('.summary-share-status').textContent.includes('Complete a game review'));
  assert.equal(await save.isDisabled(),true);
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Summary sharing: local PNG contents/dimensions, download, clipboard success/fallback, small dialog, focus, and canceled generation passed.');
} finally {await closeTestContext(context,profile,'meowlchess-share-test-');}
