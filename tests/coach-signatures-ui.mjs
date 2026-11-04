import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-signatures-test-', bundlePrefix = 'MeowlChess-coach-signatures-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const previewOnly = process.argv.includes('--preview-only');
const fixtureHtml = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess signature gestures</title><link rel="stylesheet" href="coach-motion.css"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#262722;color:#edece4;font:14px system-ui}main{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}figure{margin:0;padding:12px;background:#30322b;border:1px solid #ffffff16;border-radius:14px;text-align:center;max-width:100%}figure img{width:192px;height:192px;object-fit:contain}figcaption{padding:10px 0;font-weight:600}.coach-companion{display:block}</style><main></main><script type="module" src="signatures-fixture.js"></script>`;
const fixtureScript = `
import { createCoachMotion } from './lib/coach-motion.js';
import { coachPortraitUrl, coachPuppetUrl } from './lib/coach-portraits.js';
import { createCoachPuppet, drawCoachPuppet, coachPoseAt, COACH_REACTION_DURATIONS } from './lib/coach-puppet.js';
const ids=['meowl','owl','paws','mellow','scout'];
const names=['Meowl','Professor Meowl','Captain Paws','Mellow Meowl','Scout Meowl'];
const actions=['Groom & wink','Glasses & book','Captain’s salute','Cozy wing hug','Lookout scan'];
const duration=COACH_REACTION_DURATIONS.signature;
const peaks=[812,1820,896,1568,924].map(time=>time*duration/2800);
const images=[],motion=createCoachMotion();
for(const [index,id] of ids.entries()){
 const figure=document.createElement('figure');figure.className='coach-companion';
 const image=new Image();image.id=id;image.alt=names[index];image.src=coachPortraitUrl(id);
 const caption=document.createElement('figcaption');caption.textContent=names[index];
 figure.append(image,caption);document.querySelector('main').append(figure);images.push(image);
}
const puppets=Promise.all(ids.map(async id=>{
 const image=new Image();image.src=coachPuppetUrl(id);
 await image.decode();return createCoachPuppet(image,document,id);
}));
function artwork(ctx,puppet,id,time,x,y,scale,variant=0){
 ctx.save();ctx.translate(x-626*scale,y-1170*scale);ctx.scale(scale,scale);
 drawCoachPuppet(ctx,puppet,coachPoseAt('signature',time,id,variant));ctx.restore();
}
function sheet(ctx,portraits,times,height=540,variant=0){
 ctx.fillStyle='#24251f';ctx.fillRect(0,0,1440,height);
 ctx.fillStyle='#f3f1e8';ctx.font='600 26px system-ui';ctx.textAlign='left';ctx.fillText('Signature moves',36,44);
 ctx.fillStyle='#b8baad';ctx.font='15px system-ui';ctx.fillText('Five Meowls. Five different little routines.',36,71);
 ids.forEach((id,index)=>{
  const x=36+index*278;ctx.fillStyle='#30322a';ctx.beginPath();ctx.roundRect(x,94,260,410,16);ctx.fill();ctx.strokeStyle='#ffffff16';ctx.lineWidth=1;ctx.stroke();
  artwork(ctx,portraits[index],id,times[index],x+130,414,.29,variant);
  ctx.textAlign='center';ctx.fillStyle='#f3f1e8';ctx.font='600 16px system-ui';ctx.fillText(names[index],x+130,446);
  ctx.fillStyle='#b8baad';ctx.font='14px system-ui';ctx.fillText(actions[index],x+130,474);
 });
}
window.signaturesFixture={
 reactAll(){return images.map((image,index)=>motion.react(image,{kind:'signature',coachId:ids[index]}));},
 stop(){motion.stop();},
 dispose(){motion.dispose();},
 async inspect(){
  const portraits=await puppets,canvas=document.createElement('canvas');canvas.width=canvas.height=320;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
  const paint=(index,time,variant=0)=>{ctx.clearRect(0,0,320,320);ctx.save();ctx.scale(320/1254,320/1254);drawCoachPuppet(ctx,portraits[index],coachPoseAt('signature',time,ids[index],variant));ctx.restore();return ctx.getImageData(0,0,320,320).data;};
  return ids.map((id,index)=>{
   const neutral=paint(index,0),samples=[];let maxChange=0,edgePixels=0;
   for(const variant of [0,1])for(const time of [280,560,840,1120,1400,1680,1960,2240,2520].map(value=>value*duration/2800)){
    const pixels=paint(index,time,variant);let changed=0;
    for(let y=0;y<320;y++)for(let x=0;x<320;x++){
     const offset=(y*320+x)*4;
     if(Math.abs(pixels[offset]-neutral[offset])+Math.abs(pixels[offset+1]-neutral[offset+1])+Math.abs(pixels[offset+2]-neutral[offset+2])+Math.abs(pixels[offset+3]-neutral[offset+3])>40)changed++;
     if((x===0||x===319||y===0||y===319)&&pixels[offset+3]>16)edgePixels++;
    }
    maxChange=Math.max(maxChange,changed);samples.push(changed);
   }
   let unsettled=0;
   // Brave adds tiny privacy noise to canvas reads; visible changes exceed it.
   for(const variant of [0,1]){const settled=paint(index,duration,variant);for(let offset=0;offset<settled.length;offset+=4)if([0,1,2,3].some(channel=>Math.abs(settled[offset+channel]-neutral[offset+channel])>16))unsettled++;}
   return{id,maxChange,samples,edgePixels,unsettled,endpoints:[0,1].flatMap(variant=>[coachPoseAt('signature',0,id,variant),coachPoseAt('signature',duration,id,variant)])};
  });
 },
 async preview(){
  const portraits=await puppets,canvas=document.createElement('canvas');canvas.width=1440;canvas.height=540;const ctx=canvas.getContext('2d');
  sheet(ctx,portraits,ids.map(()=>0));const neutral=canvas.toDataURL('image/png').split(',')[1];
  sheet(ctx,portraits,peaks);const peak=canvas.toDataURL('image/png').split(',')[1];
  const contact=document.createElement('canvas');contact.width=1440;contact.height=1620;const contactCtx=contact.getContext('2d');
  for(const [row,time] of [700,1400,2100].map(value=>value*duration/2800).entries()){sheet(ctx,portraits,ids.map(()=>time));contactCtx.drawImage(canvas,0,row*540);}
  const contactSheet=contact.toDataURL('image/png').split(',')[1];
  const chunks=[],stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:2400000});
  const done=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=resolve;});
  recorder.start();const start=performance.now(),cycleLength=duration+400;
  await new Promise(resolve=>{
   function frame(now){const elapsed=now-start,cycle=Math.floor(elapsed/cycleLength),time=Math.min(duration,elapsed%cycleLength);sheet(ctx,portraits,ids.map(()=>time),540,cycle%2);if(elapsed<cycleLength*2)requestAnimationFrame(frame);else resolve();}
   requestAnimationFrame(frame);
  });
  recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());
  const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let binary='';
  for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
  return{neutral,peak,contactSheet,video:btoa(binary)};
 }
};
await puppets;window.fixtureReady=true;
`;
let context, page, stage='launch';
const errors=[],external=[];

try {
  await cp(join(root,'extension'),extension,{recursive:true});
  await writeFile(join(extension,'signatures-fixture.html'),fixtureHtml);
  await writeFile(join(extension,'signatures-fixture.js'),fixtureScript);
  context=await chromium.launchPersistentContext(profile,{
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'}),
    headless:true,viewport:{width:1200,height:350},reducedMotion:'no-preference',
    ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  context.setDefaultTimeout(8000);
  await context.route(/^https?:\/\//,route=>{external.push(route.request().url());return route.abort();});
  const worker=context.serviceWorkers().find(item=>item.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker');
  const origin=`chrome-extension://${new URL(worker.url()).hostname}`;
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/signatures-fixture.html`);
  await page.waitForFunction(()=>window.fixtureReady&&[...document.querySelectorAll('figure img')].every(image=>image.complete&&image.naturalWidth===1254));
  stage='recording distinct signatures';
  const preview=await page.evaluate(()=>window.signaturesFixture.preview());
  await mkdir(join(root,'test-results'),{recursive:true});
  await writeFile(join(root,'test-results/MeowlChess-coach-signatures.webm'),Buffer.from(preview.video,'base64'));
  await writeFile(join(root,'test-results/MeowlChess-coach-signatures-neutral.png'),Buffer.from(preview.neutral,'base64'));
  await writeFile(join(root,'test-results/MeowlChess-coach-signatures-peak.png'),Buffer.from(preview.peak,'base64'));
  await writeFile(join(root,'test-results/MeowlChess-coach-signatures-contact.png'),Buffer.from(preview.contactSheet,'base64'));
  if(!previewOnly){
    stage='finite drawn gestures with no cropped limbs or props';
    for(const result of await page.evaluate(()=>window.signaturesFixture.inspect())){
      assert(result.maxChange>200,`${result.id} visibly changes its drawn pose.`);
      assert.equal(result.edgePixels,0,`${result.id} never clips a limb or prop against the portrait canvas.`);
      assert(result.endpoints.every(pose=>Object.values(pose).every(value=>value===0)),`${result.id} starts and ends at rest in both variants.`);
      assert.equal(result.unsettled,0,`${result.id} returns visibly to the same neutral drawing.`);
      assert(result.samples.filter(count=>count>100).length>=4,`${result.id} has a sustained, readable gesture.`);
    }
    stage='runtime signature rendering';
    assert((await page.evaluate(()=>window.signaturesFixture.reactAll())).every(Boolean));
    await page.waitForFunction(()=>document.querySelectorAll('.coach-reaction-puppet').length===5);
    assert.equal(await page.locator('.coach-actor[data-reaction="signature"]').count(),5);
    assert.deepEqual(await page.locator('.coach-actor[data-reaction="signature"]').evaluateAll(actors=>actors.map(actor=>actor.dataset.variation)),['0','0','0','0','0']);
    await page.waitForFunction(()=>!document.querySelector('.coach-actor[data-reaction],.coach-reaction-puppet'));
    assert.equal(await page.locator('.coach-actor[data-variation]').count(),0);
    assert((await page.evaluate(()=>window.signaturesFixture.reactAll())).every(Boolean));
    await page.waitForFunction(()=>document.querySelectorAll('.coach-reaction-puppet').length===5);
    assert.deepEqual(await page.locator('.coach-actor[data-reaction="signature"]').evaluateAll(actors=>actors.map(actor=>actor.dataset.variation)),['1','1','1','1','1'],'Replaying gives every coach its alternate routine.');
    await page.waitForFunction(()=>!document.querySelector('.coach-actor[data-reaction],.coach-reaction-puppet'));
    assert.equal(await page.locator('.coach-actor[data-variation]').count(),0);
    stage='mobile bounds';
    await page.setViewportSize({width:320,height:700});
    assert((await page.evaluate(()=>window.signaturesFixture.reactAll())).every(Boolean));
    await page.waitForFunction(()=>document.querySelectorAll('.coach-reaction-puppet').length===5);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.evaluate(()=>window.signaturesFixture.stop());
    stage='reduced-motion signature remains still';
    await page.emulateMedia({reducedMotion:'reduce'});
    assert((await page.evaluate(()=>window.signaturesFixture.reactAll())).every(Boolean));
    assert.equal(await page.locator('.coach-reaction-puppet').count(),0);
    assert(await page.locator('.coach-actor>img').evaluateAll(images=>images.every(image=>getComputedStyle(image).visibility==='visible')));
    await page.evaluate(()=>window.signaturesFixture.dispose());
    assert.equal(await page.locator('.coach-actor[data-reaction],.coach-reaction-puppet').count(),0);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Distinct coach signatures render fully, return to rest, and preserve motion controls and mobile bounds.');
}catch(error){
  await mkdir(join(root,'test-results'),{recursive:true});
  if(page)await page.screenshot({path:join(root,'test-results/MeowlChess-coach-signatures-failure.png'),fullPage:true}).catch(()=>{});
  throw new Error(`Signature stage: ${stage}`,{cause:error});
}finally{
  await closeTestContext(context,profile,profilePrefix);
  if(dirname(bundle)===temporaryRoot&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
