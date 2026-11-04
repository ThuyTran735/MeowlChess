import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), prefix = 'MeowlChess-coach-loading-';
const profile = await mkdtemp(join(tmpdir(), prefix));
const fixture = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/coach-motion.css"><style>img{width:180px;height:180px}</style><img id="coach" alt="Meowl"><script type="module">
import {createCoachMotion} from '/lib/coach-motion.js';
import {coachPortraitUrl} from '/lib/coach-portraits.js';
let enabled=true, visible=true;
const canvases=[],create=document.createElement.bind(document);
document.createElement=function(tag,...args){const node=create(tag,...args);if(tag==='canvas')canvases.push(node);return node;};
const nativeFrame=requestAnimationFrame.bind(window),nativeCancel=cancelAnimationFrame.bind(window),frames=new Set();
window.requestAnimationFrame=callback=>{const id=nativeFrame(time=>{frames.delete(id);callback(time);});frames.add(id);return id;};
window.cancelAnimationFrame=id=>{frames.delete(id);nativeCancel(id);};
const motion=createCoachMotion({isEnabled:()=>enabled,isVisible:()=>visible});
const image=document.querySelector('img');
window.fixture={
  async select(id){image.src=coachPortraitUrl(id);await image.decode();return motion.setIdle(image,{coachId:id});},
  react(id){return motion.react(image,{kind:'greeting',coachId:id});},
  voice(id){const started=performance.now();return motion.setVoice(image,{coachId:id,durationMs:250,getMouth:()=>.6,isPlaying:()=>performance.now()-started<250});},
  flags(a,b){enabled=a;visible=b;},
  stats(){return {bases:performance.getEntriesByType('resource').filter(entry=>/coach-[a-z]+-base\\.svg/.test(entry.name)).map(entry=>entry.name.split('/').at(-1)),canvases:canvases.length,allocatedCanvasPixels:canvases.reduce((sum,node)=>sum+node.width*node.height,0),frames:frames.size};},
  stop(){motion.stop();},dispose(){motion.dispose();}
};window.ready=true;
</script>`;
let context;
try {
  context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:500,height:500},...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'})});
  await context.route('http://meowl.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/fixture.html')return route.fulfill({contentType:'text/html',body:fixture});
    const file=resolve(root,'extension',`.${path}`);
    if(!file.startsWith(resolve(root,'extension')+sep))return route.abort();
    const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    try{return route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.abort();}
  });
  const page=await context.newPage();
  async function fresh(reducedMotion='no-preference') {
    await page.emulateMedia({reducedMotion});await page.goto('http://meowl.test/fixture.html');
    await page.waitForFunction(()=>window.ready);await page.waitForLoadState('networkidle');
  }
  await fresh();
  const unselected=await page.evaluate(()=>fixture.stats());
  console.log('Coach startup allocations:',JSON.stringify(unselected));
  if(process.env.COACH_LOADING_BASELINE!=='1') {
    assert.deepEqual(unselected.bases,[],'Constructing a coach controller does not decode unselected artwork.');
    assert.equal(unselected.canvases,0,'No offscreen puppet layers are allocated before selecting an active coach.');
    await page.evaluate(()=>fixture.flags(false,true));
    assert.equal(await page.evaluate(()=>fixture.select('meowl')),false);
    await page.waitForLoadState('networkidle');
    assert.deepEqual((await page.evaluate(()=>fixture.stats())).bases,[],'Disabled animation does not warm a puppet.');
    await page.evaluate(()=>fixture.flags(true,false));
    assert.equal(await page.evaluate(()=>fixture.select('owl')),false);
    await page.waitForLoadState('networkidle');
    assert.deepEqual((await page.evaluate(()=>fixture.stats())).bases,[],'Hidden coach does not warm a puppet.');
    await page.evaluate(()=>fixture.flags(true,true));
    assert.equal(await page.evaluate(()=>fixture.select('mellow')),true);
    await page.waitForFunction(()=>fixture.stats().bases.length===1&&fixture.stats().canvases>0);
    const selected=await page.evaluate(()=>fixture.stats());
    assert.deepEqual(selected.bases,['MeowlChess-coach-mellow-base.svg']);
    console.log('Selected coach allocations:',JSON.stringify(selected));
    await page.evaluate(()=>fixture.select('mellow'));
    assert.equal(await page.evaluate(()=>fixture.react('mellow')),true);
    await page.waitForFunction(()=>document.querySelector('.coach-actor[data-sprite-active="true"] canvas'));
    assert.equal((await page.evaluate(()=>fixture.stats())).bases.length,1,'Repeating an action reuses the selected puppet.');
    await page.evaluate(()=>fixture.stop());
    assert.equal(await page.evaluate(()=>fixture.voice('mellow')),true);
    await page.waitForFunction(()=>document.querySelector('.coach-actor[data-reaction="voice"] canvas'));
    await page.waitForFunction(()=>!document.querySelector('.coach-actor[data-reaction]'));
    assert.equal((await page.evaluate(()=>fixture.stats())).bases.length,1,'Voice-only playback reuses the warm puppet.');
    assert.equal(await page.evaluate(()=>fixture.select('evil')),true);
    await page.waitForFunction(()=>fixture.stats().bases.length===2);
    assert.equal(await page.evaluate(()=>fixture.react('evil')),true);
    await page.waitForFunction(()=>document.querySelector('.coach-actor[data-coach="evil"][data-sprite-active="true"] canvas'));
    assert.deepEqual((await page.evaluate(()=>fixture.stats())).bases.sort(),['MeowlChess-coach-evil-base.svg','MeowlChess-coach-mellow-base.svg']);
    await page.evaluate(()=>fixture.flags(false,true));
    await page.waitForFunction(()=>!document.querySelector('.coach-actor[data-reaction]'));
    assert.equal((await page.evaluate(()=>fixture.stats())).frames,0);
    await page.evaluate(()=>fixture.dispose());
    await fresh('reduce');
    assert.equal(await page.evaluate(()=>fixture.select('owl')),false);
    assert.equal(await page.evaluate(()=>fixture.react('owl')),true,'Reduced motion still supports static feedback.');
    await page.waitForLoadState('networkidle');
    const reduced=await page.evaluate(()=>fixture.stats());
    assert.deepEqual(reduced.bases,[]);assert.equal(reduced.canvases,0);assert.equal(reduced.frames,0);
    await page.evaluate(()=>fixture.dispose());
    console.log('Selected artwork warming, disabled/hidden/reduced motion, cached reactions, voice and coach switching passed.');
  }
} finally { await closeTestContext(context,profile,prefix); }
