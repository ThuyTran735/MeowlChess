import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-playful-test-', bundlePrefix = 'MeowlChess-coach-playful-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const baselineRoot = process.env.MEOWLCHESS_BASELINE_DIR ? resolve(process.env.MEOWLCHESS_BASELINE_DIR) : null;
const previewOnly = process.argv.includes('--preview-only');
const skipPreview = process.argv.includes('--skip-preview');
const fixtureHtml = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess playful animation</title><link rel="stylesheet" href="coach-motion.css"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#262722;color:#edece4;font:14px system-ui}main{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}figure{margin:0;padding:12px;background:#30322b;border:1px solid #ffffff16;border-radius:14px;text-align:center;max-width:100%}figure img{width:192px;height:192px;object-fit:contain}figcaption{padding:10px 0;font-weight:600}.coach-companion{display:block}</style><main></main><script type="module" src="playful-fixture.js"></script>`;
const fixtureScript = `
import { createCoachMotion } from './lib/coach-motion.js';
import { coachPortraitUrl, coachPuppetUrl } from './lib/coach-portraits.js';
import * as current from './lib/coach-puppet.js';
const previous=${Boolean(baselineRoot)}?await import('./baseline/lib/coach-puppet.js'):null;
const previousPortraits=previous?await import('./baseline/lib/coach-portraits.js'):null;
const ids=['meowl','owl','paws','mellow','scout'];
const names=['Meowl','Professor Meowl','Captain Paws','Mellow Meowl','Scout Meowl'];
const actions=['Wiggle & blep','Aha! wobble','Wobbly salute','Sleepy stretch','Double take'];
const images=[],motion=createCoachMotion(),duration=current.COACH_REACTION_DURATIONS.signature;
let pending=null,pendingSerial=0;
for(const [index,id] of ids.entries()){
 const figure=document.createElement('figure');figure.className='coach-companion';
 const image=new Image();image.id=id;image.alt=names[index];image.src=coachPortraitUrl(id);
 const caption=document.createElement('figcaption');caption.textContent=names[index];
 figure.append(image,caption);document.querySelector('main').append(figure);images.push(image);
}
async function loadPuppets(renderer,urlFor){return Promise.all(ids.map(async id=>{const image=new Image();image.src=urlFor(id);await image.decode();return renderer.createCoachPuppet(image,document,id);}));}
const puppets=loadPuppets(current,coachPuppetUrl), oldPuppets=previous?loadPuppets(previous,previousPortraits.coachPuppetUrl):null;
function artwork(ctx,renderer,puppet,id,progress,x,y,scale,variant=0){
 ctx.save();ctx.translate(x-626*scale,y-1170*scale);ctx.scale(scale,scale);
 renderer.drawCoachPuppet(ctx,puppet,renderer.coachPoseAt('signature',renderer.COACH_REACTION_DURATIONS.signature*progress,id,variant));ctx.restore();
}
function row(ctx,renderer,portraits,progress,variant=0,y=0,title='Little Meowl mischief',subtitle='A little wobble, a little curiosity, a lot more character.'){
 ctx.fillStyle='#24251f';ctx.fillRect(0,y,1440,570);
 ctx.fillStyle='#f3f1e8';ctx.font='600 26px system-ui';ctx.textAlign='left';ctx.fillText(title,36,y+44);
 ctx.fillStyle='#b8baad';ctx.font='15px system-ui';ctx.fillText(subtitle,36,y+71);
 ids.forEach((id,index)=>{
  const x=36+index*278;ctx.fillStyle='#30322a';ctx.beginPath();ctx.roundRect(x,y+94,260,410,16);ctx.fill();ctx.strokeStyle='#ffffff16';ctx.lineWidth=1;ctx.stroke();
  artwork(ctx,renderer,portraits[index],id,Array.isArray(progress)?progress[index]:progress,x+130,y+414,.225,variant);
  ctx.textAlign='center';ctx.fillStyle='#f3f1e8';ctx.font='600 16px system-ui';ctx.fillText(names[index],x+130,y+446);
  ctx.fillStyle='#b8baad';ctx.font='14px system-ui';ctx.fillText(actions[index],x+130,y+474);
 });
}
function silhouette(pixels){
 let top=320,bottom=-1,left=320,right=-1,footX=0,footY=0,footCount=0;
 for(let y=0;y<320;y++)for(let x=0;x<320;x++)if(pixels[(y*320+x)*4+3]>128){
  top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);
  if(y>260){footX+=x;footY+=y;footCount++;}
 }
 return{top,bottom,left,right,height:bottom-top,footX:footCount?footX/footCount:0,footY:footCount?footY/footCount:0};
}
async function inspectSet(renderer,source){
 const portraits=await source,canvas=document.createElement('canvas');canvas.width=canvas.height=320;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
 const paint=(index,progress,variant=0)=>{ctx.clearRect(0,0,320,320);ctx.save();ctx.scale(320/1254,320/1254);renderer.drawCoachPuppet(ctx,portraits[index],renderer.coachPoseAt('signature',renderer.COACH_REACTION_DURATIONS.signature*progress,ids[index],variant));ctx.restore();return ctx.getImageData(0,0,320,320).data;};
 return ids.map((id,index)=>{
  const neutral=paint(index,0),samples=[],boxes=[],clips=[];let maxChange=0,unsettled=0;
  for(const variant of [0,1])for(let sample=1;sample<=15;sample++){
   const progress=sample/16,pixels=paint(index,progress,variant);let changed=0,edgePixels=0;
   for(let y=0;y<320;y++)for(let x=0;x<320;x++){
    const offset=(y*320+x)*4;
    if([0,1,2,3].some(channel=>Math.abs(pixels[offset+channel]-neutral[offset+channel])>16))changed++;
    if((x<2||x>317||y<2||y>317)&&pixels[offset+3]>32)edgePixels++;
   }
   if(edgePixels)clips.push({variant,progress,edgePixels});
   maxChange=Math.max(maxChange,changed);samples.push(changed);boxes.push(silhouette(pixels));
  }
  for(const variant of [0,1]){
   const settled=paint(index,1,variant);
   for(let offset=0;offset<settled.length;offset+=4)if([0,1,2,3].some(channel=>Math.abs(settled[offset+channel]-neutral[offset+channel])>16))unsettled++;
  }
  const range=key=>Math.max(...boxes.map(box=>box[key]))-Math.min(...boxes.map(box=>box[key]));
  return{id,maxChange,samples,clips,unsettled,heightRange:range('height'),footXRange:range('footX'),footYRange:range('footY'),headTopRange:range('top'),endpoints:[0,1].flatMap(variant=>[renderer.coachPoseAt('signature',0,id,variant),renderer.coachPoseAt('signature',renderer.COACH_REACTION_DURATIONS.signature,id,variant)])};
 });
}
async function record(canvas,draw,seconds){
 const chunks=[],stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:3000000});
 const done=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=resolve;});
 recorder.start();const start=performance.now();
 await new Promise(resolve=>{function frame(now){const elapsed=now-start;draw(elapsed);if(elapsed<seconds*1000)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
 recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());
 const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let binary='';
 for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
 return btoa(binary);
}
window.playfulFixture={
 reactAll(){return images.map((image,index)=>motion.react(image,{kind:'signature',coachId:ids[index]}));},
 stop(){motion.stop();},dispose(){motion.dispose();},
 async cadence(count=1){
  motion.stop();const samples=new Map();
  const observer=new MutationObserver(records=>{
   const time=performance.now();
   for(const {target} of records){
    if(!target.classList.contains('coach-reaction-puppet'))continue;
    const id=target.parentElement.dataset.coach;
    if(!samples.has(id))samples.set(id,[]);samples.get(id).push(time);
   }
  });
  observer.observe(document.querySelector('main'),{subtree:true,attributes:true,attributeFilter:['data-frame']});
  for(let index=0;index<count;index++)motion.react(images[index],{kind:'signature',coachId:ids[index]});
  await new Promise(resolve=>setTimeout(resolve,1600));observer.disconnect();motion.stop();
  return [...samples].map(([id,times])=>{
   const gaps=times.slice(1).map((time,index)=>time-times[index]).sort((a,b)=>a-b);
   return{id,characters:count,frames:times.length,fps:(times.length-1)*1000/(times.at(-1)-times[0]),medianGap:gaps[Math.floor(gaps.length*.5)],p95Gap:gaps[Math.floor(gaps.length*.95)],largestGap:gaps.at(-1)};
  });
 },
 async pendingStart(kind='talk'){
  pending?.motion.dispose();pending?.figure.remove();
  const runtime=await import('./lib/coach-motion.js?deferred-'+(++pendingSerial));
  const NativeImage=window.Image,target=new NativeImage();target.id='pending-coach';target.src=coachPortraitUrl('meowl');await target.decode();
  const figure=document.createElement('figure');figure.className='coach-companion';figure.append(target);document.querySelector('main').append(figure);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  class DeferredImage extends NativeImage{async decode(){await super.decode();await gate;}}
  let instance;window.Image=DeferredImage;
  try{instance=runtime.createCoachMotion();}finally{window.Image=NativeImage;}
  pending={motion:instance,figure,release};
  return instance.react(target,{kind,coachId:'meowl'});
 },
 releasePending(){pending?.release();},
 disposePending(){pending?.motion.dispose();pending?.figure.remove();},
 async inspect(){return{current:await inspectSet(current,puppets),previous:previous?await inspectSet(previous,oldPuppets):null};},
 async preview(){
  const portraits=await puppets,older=oldPuppets?await oldPuppets:null;
  const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=570;const ctx=canvas.getContext('2d');
  row(ctx,current,portraits,0);const neutral=canvas.toDataURL('image/png').split(',')[1];
  row(ctx,current,portraits,[.48,.42,.32,.5,.52]);const peak=canvas.toDataURL('image/png').split(',')[1];
  const contact=document.createElement('canvas');contact.width=1440;contact.height=2280;const contactCtx=contact.getContext('2d');
  for(const [index,progress] of [.18,.36,.58,.8].entries()){row(ctx,current,portraits,progress);contactCtx.drawImage(canvas,0,index*570);}
  const contactSheet=contact.toDataURL('image/png').split(',')[1];
  const cycle=duration+400,seconds=cycle*2/1000;
  const video=await record(canvas,elapsed=>row(ctx,current,portraits,Math.min(1,(elapsed%cycle)/duration),Math.floor(elapsed/cycle)%2),seconds);
  let comparison=null;
  if(older){
   canvas.height=1140;const compareCtx=canvas.getContext('2d');
   comparison=await record(canvas,elapsed=>{
    const progress=Math.min(1,(elapsed%cycle)/duration),oldProgress=Math.min(1,(elapsed%cycle)/previous.COACH_REACTION_DURATIONS.signature),variant=Math.floor(elapsed/cycle)%2;
    row(compareCtx,previous,older,oldProgress,variant,0,'Previous animation','The previous routine at its original pace.');
    row(compareCtx,current,portraits,progress,variant,570,'Playful animation','Body movement, follow-through, and little surprises.');
   },seconds);
  }
  const closeCanvas=document.createElement('canvas');closeCanvas.width=560;closeCanvas.height=650;const closeCtx=closeCanvas.getContext('2d');
  const closeup=await record(closeCanvas,elapsed=>{
   const progress=Math.min(1,(elapsed%cycle)/duration),variant=Math.floor(elapsed/cycle)%2;
   closeCtx.fillStyle='#24251f';closeCtx.fillRect(0,0,560,650);
   closeCtx.fillStyle='#f3f1e8';closeCtx.font='600 25px system-ui';closeCtx.textAlign='left';closeCtx.fillText('Meowl being Meowl',28,39);
   closeCtx.fillStyle='#b8baad';closeCtx.font='16px system-ui';closeCtx.fillText('A little wiggle. A tiny pounce. A blep.',28,67);
   closeCtx.fillStyle='#30322a';closeCtx.beginPath();closeCtx.roundRect(28,88,504,530,18);closeCtx.fill();
   artwork(closeCtx,current,portraits[0],'meowl',progress,280,560,.4,variant);
  },seconds);
  return{neutral,peak,contactSheet,video,comparison,closeup};
 }
};
await puppets;if(oldPuppets)await oldPuppets;window.fixtureReady=true;
`;
let context,page,stage='launch';
const errors=[],external=[];

try {
  await cp(join(root,'extension'),extension,{recursive:true});
  if(baselineRoot){
    const baseline=join(extension,'baseline');await mkdir(baseline,{recursive:true});
    await cp(join(baselineRoot,'lib'),join(baseline,'lib'),{recursive:true});
    await mkdir(join(baseline,'icons'),{recursive:true});
    await cp(join(baselineRoot,'icons','coaches'),join(baseline,'icons','coaches'),{recursive:true});
  }
  await writeFile(join(extension,'playful-fixture.html'),fixtureHtml);
  await writeFile(join(extension,'playful-fixture.js'),fixtureScript);
  context=await chromium.launchPersistentContext(profile,{
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'}),
    headless:true,viewport:{width:1200,height:350},reducedMotion:'no-preference',
    ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  await context.route(/^https?:\/\//,route=>{external.push(route.request().url());return route.abort();});
  const worker=context.serviceWorkers().find(item=>item.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker');
  const origin=`chrome-extension://${new URL(worker.url()).hostname}`;
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/playful-fixture.html`);
  await page.waitForFunction(()=>window.fixtureReady&&[...document.querySelectorAll('figure img')].every(image=>image.complete&&image.naturalWidth===1254));
  await mkdir(join(root,'test-results'),{recursive:true});
  if(!skipPreview){
    stage='recording playful movement';
    const preview=await page.evaluate(()=>window.playfulFixture.preview());
    for(const [key,name] of [['video','MeowlChess-coach-playful.webm'],['comparison','MeowlChess-coach-playful-comparison.webm'],['closeup','MeowlChess-Meowl-playful.webm'],['neutral','MeowlChess-coach-playful-neutral.png'],['peak','MeowlChess-coach-playful-peak.png'],['contactSheet','MeowlChess-coach-playful-contact.png']])if(preview[key])await writeFile(join(root,'test-results',name),Buffer.from(preview[key],'base64'));
  }
  if(!previewOnly){
    stage='drawn movement, clipping, and settling';
    const inspected=await page.evaluate(()=>window.playfulFixture.inspect());
    await writeFile(join(root,'test-results/MeowlChess-coach-playful-measurements.json'),JSON.stringify(inspected,null,2));
    for(const result of inspected.current){
      assert(result.maxChange>500,`${result.id} visibly changes its pose.`);
      assert.deepEqual(result.clips,[],`${result.id} has no clipped limbs or body at any sampled pose.`);
      assert(result.endpoints.every(pose=>Object.values(pose).every(value=>value===0)),`${result.id} starts and ends at rest in both variants.`);
      assert.equal(result.unsettled,0,`${result.id} returns visibly to the same neutral drawing.`);
      assert(result.samples.filter(count=>count>100).length>=10,`${result.id} has readable movement through both routines.`);
    }
    stage='runtime alternate routines';
    for(const variant of ['0','1']){
      assert((await page.evaluate(()=>window.playfulFixture.reactAll())).every(Boolean));
      await page.waitForFunction(()=>document.querySelectorAll('.coach-reaction-puppet').length===5);
      assert.deepEqual(await page.locator('.coach-actor[data-reaction="signature"]').evaluateAll(actors=>actors.map(actor=>actor.dataset.variation)),[variant,variant,variant,variant,variant]);
      await page.waitForFunction(()=>!document.querySelector('.coach-actor[data-reaction],.coach-reaction-puppet'));
      assert.equal(await page.locator('.coach-actor[data-variation]').count(),0);
    }
    stage='actual companion frame cadence';
    const cadence={single:await page.evaluate(()=>window.playfulFixture.cadence(1)),five:await page.evaluate(()=>window.playfulFixture.cadence(5))};
    await writeFile(join(root,'test-results/MeowlChess-coach-playful-cadence.json'),JSON.stringify(cadence,null,2));
    stage='mobile and motion controls';
    await page.setViewportSize({width:320,height:700});
    await page.evaluate(()=>window.playfulFixture.reactAll());
    await page.waitForFunction(()=>document.querySelectorAll('.coach-reaction-puppet').length===5);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>!document.querySelector('.coach-reaction-puppet')&&document.querySelectorAll('.coach-actor[data-reduced-motion]').length===5);
    assert(await page.locator('.coach-actor>img').evaluateAll(images=>images.every(image=>getComputedStyle(image).visibility==='visible')));
    await page.evaluate(()=>window.playfulFixture.dispose());
    assert.equal(await page.locator('.coach-actor[data-reaction],.coach-reaction-puppet').count(),0);
    stage='late artwork decoding preserves the full gesture';
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert(await page.evaluate(()=>window.playfulFixture.pendingStart()));
    await page.waitForTimeout(1600);
    assert.equal(await page.locator('#pending-coach').evaluate(image=>image.parentElement.dataset.reaction),'talk','A pending decode does not consume the gesture duration.');
    assert.equal(await page.locator('.coach-reaction-puppet').count(),0);
    await page.evaluate(()=>window.playfulFixture.releasePending());
    await page.locator('#pending-coach').evaluate(image=>image.scrollIntoView());
    await page.waitForFunction(()=>document.querySelector('#pending-coach')?.parentElement.querySelector('.coach-reaction-puppet'));
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#pending-coach').evaluate(image=>image.parentElement.dataset.reaction),'talk','The reply retains its speaking time after decoding.');
    await page.waitForFunction(()=>!document.querySelector('#pending-coach')?.parentElement.dataset.reaction);
    await page.evaluate(()=>window.playfulFixture.disposePending());
    stage='pending decode respects reduced motion and disposal';
    assert(await page.evaluate(()=>window.playfulFixture.pendingStart('signature')));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>window.playfulFixture.releasePending());
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.coach-reaction-puppet').count(),0);
    assert(await page.locator('#pending-coach').evaluate(image=>getComputedStyle(image).visibility==='visible'));
    await page.evaluate(()=>window.playfulFixture.disposePending());
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert(await page.evaluate(()=>window.playfulFixture.pendingStart('signature')));
    await page.evaluate(()=>{window.playfulFixture.disposePending();window.playfulFixture.releasePending();});
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.coach-actor[data-reaction],.coach-reaction-puppet').count(),0,'Disposed pending artwork cannot paint a late frame.');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Playful coach gestures render fully, alternate on replay, settle, and respect mobile and reduced-motion controls.');
}catch(error){
  await mkdir(join(root,'test-results'),{recursive:true});
  if(page)await page.screenshot({path:join(root,'test-results/MeowlChess-coach-playful-failure.png'),fullPage:true}).catch(()=>{});
  throw new Error(`Playful animation stage: ${stage}`,{cause:error});
}finally{
  await closeTestContext(context,profile,profilePrefix);
  if(dirname(bundle)===temporaryRoot&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
