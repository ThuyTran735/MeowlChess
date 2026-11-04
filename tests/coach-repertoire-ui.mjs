import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'), temp=resolve(tmpdir());
const profilePrefix='MeowlChess-coach-repertoire-test-', bundlePrefix='MeowlChess-coach-repertoire-bundle-';
const profile=await mkdtemp(join(temp,profilePrefix)),bundle=await mkdtemp(join(temp,bundlePrefix)),extension=join(bundle,'extension');
const previewOnly=process.argv.includes('--preview-only'),skipPreview=process.argv.includes('--skip-preview'),runtimeOnly=process.argv.includes('--runtime-only'),signatureOnly=process.argv.includes('--signature-only'),evilPreview=process.argv.includes('--evil-preview');
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess coach repertoire</title><link rel="stylesheet" href="coach-motion.css"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#262722;color:#edece4;font:14px system-ui}main{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}figure{margin:0;padding:12px;background:#30322b;border:1px solid #ffffff16;border-radius:14px;text-align:center;max-width:100%}figure img{width:192px;height:192px;object-fit:contain}figcaption{padding:10px 0;font-weight:600}.coach-companion{display:block}</style><main></main><script type="module" src="repertoire-fixture.js"></script>`;
const script=`
import {createCoachMotion} from './lib/coach-motion.js';
import {coachPortraitUrl,coachPuppetUrl} from './lib/coach-portraits.js';
import {createCoachPuppet,drawCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS as durations} from './lib/coach-puppet.js';
import {COACH_ANIMATION_LABELS as labels} from './lib/coach-repertoire.js';
const ids=['meowl','owl','paws','mellow','scout','evil'],names=['Meowl','Professor Meowl','Captain Paws','Mellow Meowl','Scout Meowl','Evil Meowl'];
const images=[],puppets=[];let motion=createCoachMotion(),enabled=true;
for(const [index,id] of ids.entries()){
 const figure=document.createElement('figure');figure.className='coach-companion';
 const image=new Image();image.id=id;image.alt=names[index];image.src=coachPortraitUrl(id);
 const caption=document.createElement('figcaption');caption.textContent=names[index];figure.append(image,caption);document.querySelector('main').append(figure);images.push(image);
 const source=new Image();source.src=coachPuppetUrl(id);await source.decode();puppets.push(createCoachPuppet(source,document,id));
}
function artwork(ctx,index,kind,progress,variant,x,y,scale){
 ctx.save();ctx.translate(x-626*scale,y-1170*scale);ctx.scale(scale,scale);drawCoachPuppet(ctx,puppets[index],coachPoseAt(kind,durations[kind]*progress,ids[index],variant));ctx.restore();
}
function title(kind){return ({think:'Thinking it through',brilliant:'A brilliant move',celebrate:'A move worth celebrating',idle:'A quiet moment',signature:'A little character'})[kind]||kind;}
function action(kind,id,variant){return labels[kind]?.[id]?.[variant]||title(kind);}
function row(ctx,kind,progress,variant=0,y=0){
 ctx.fillStyle='#24251f';ctx.fillRect(0,y,1718,570);ctx.textAlign='left';ctx.fillStyle='#f3f1e8';ctx.font='600 26px system-ui';ctx.fillText(title(kind),36,y+44);ctx.fillStyle='#b8baad';ctx.font='15px system-ui';ctx.fillText('Six Meowls, six personalities · take '+(variant+1),36,y+71);
 ids.forEach((id,index)=>{const x=36+index*278;ctx.fillStyle='#30322a';ctx.beginPath();ctx.roundRect(x,y+94,260,410,16);ctx.fill();ctx.strokeStyle='#ffffff16';ctx.lineWidth=1;ctx.stroke();artwork(ctx,index,kind,Array.isArray(progress)?progress[index]:progress,variant,x+130,y+414,.225);ctx.textAlign='center';ctx.fillStyle='#f3f1e8';ctx.font='600 16px system-ui';ctx.fillText(names[index],x+130,y+446);ctx.fillStyle='#b8baad';ctx.font='14px system-ui';ctx.fillText(action(kind,id,variant),x+130,y+474,240);});
}
async function record(canvas,draw,seconds){
 const chunks=[],stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:3000000});
 const done=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=resolve;});
 recorder.start();const start=performance.now();await new Promise(resolve=>{function frame(now){const elapsed=now-start;draw(elapsed);if(elapsed<seconds*1000)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());
 const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let binary='';for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));return btoa(binary);
}
function timeline(scenes){let total=0;const segments=scenes.map(scene=>{const start=total;total+=durations[scene.kind]+500;return{...scene,start,end:total};});return{total,at(ms){const local=ms%total,scene=segments.find(scene=>local<scene.end)||segments.at(-1);return{...scene,progress:Math.min(1,(local-scene.start)/durations[scene.kind])};}};}
window.repertoire={
 durations,ids,
 reset(){motion.dispose();enabled=true;motion=createCoachMotion({isEnabled:()=>enabled});document.querySelector('#paired-coach')?.parentElement.remove();},
 react(kind='signature',id='meowl'){return motion.react(images[ids.indexOf(id)],{kind,coachId:id});},
 reactAll(kind='signature'){return images.map((image,index)=>motion.react(image,{kind,coachId:ids[index]}));},
 idle(id='meowl'){return motion.setIdle(images[ids.indexOf(id)],{coachId:id});},
 stop(){motion.stop();},dispose(){motion.dispose();},disable(){enabled=false;},
 hidden(value){Object.defineProperty(document,'visibilityState',{configurable:true,value:value?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));},
 async pair(kind='talk',grade){
  let image=document.querySelector('#paired-coach');if(!image){image=new Image();image.id='paired-coach';image.src=coachPortraitUrl('meowl');image.style.width='32px';image.style.height='32px';await image.decode();const figure=document.createElement('figure');figure.append(image);document.querySelector('main').append(figure);}
  motion.react(images[0],{kind,coachId:'meowl',grade});motion.react(image,{kind,coachId:'meowl',grade});
  return[images[0].parentElement.dataset.variation,image.parentElement.dataset.variation];
 },
 audit(){
  const forbidden=['squash','bodyBend','winkLeft','winkRight','blep','eyeSmile','leftFlop','rightFlop','breathe','rightReach','leftReach','hug'],violations=[],nonfinite=[],rest=[],takes=[],personalities=new Map();
  for(const id of ids)for(const [kind,length] of Object.entries(durations)){
   const fingerprints=[];
   for(let variant=0;variant<labels[kind][id].length;variant++){
    const samples=[];
    for(let frame=0;frame<=32;frame++){
     const pose=coachPoseAt(kind,length*frame/32,id,variant);samples.push(pose);
     for(const key of forbidden)if((pose[key]||0)!==0)violations.push({id,kind,variant,frame,key});
     if(!Object.values(pose).every(Number.isFinite))nonfinite.push({id,kind,variant,frame});
     if((frame===0||frame===32)&&Object.values(pose).some(value=>value!==0))rest.push({id,kind,variant,frame,pose});
    }
    const fingerprint=JSON.stringify(samples);fingerprints.push(fingerprint);const key=kind+':'+variant;if(!personalities.has(key))personalities.set(key,new Set());personalities.get(key).add(fingerprint);
   }
   takes.push({id,kind,count:new Set(fingerprints).size,expected:labels[kind][id].length});
  }
  return{violations,nonfinite,rest,takes,personalities:[...personalities].map(([key,poses])=>({key,count:poses.size}))};
 },
 inspect(signatureOnly=false){
  const size=256,canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
  const paint=(index,kind,progress,variant)=>{ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(size/1254,size/1254);drawCoachPuppet(ctx,puppets[index],coachPoseAt(kind,durations[kind]*progress,ids[index],variant));ctx.restore();return ctx.getImageData(0,0,size,size).data;};
  const results=[];
  ids.forEach((id,index)=>{const neutral=paint(index,'signature',0,0);for(const kind of (signatureOnly?['signature']:Object.keys(durations)))for(let variant=0;variant<labels[kind][id].length;variant++){
   const clips=[];let maxChange=0,unsettled=0;
   for(let frame=1;frame<=11;frame++){
    const progress=frame/12,pixels=paint(index,kind,progress,variant);let changed=0,edge=0;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const offset=(y*size+x)*4;if([0,1,2,3].some(channel=>Math.abs(pixels[offset+channel]-neutral[offset+channel])>16))changed++;if((x<2||x>=size-2||y<2||y>=size-2)&&pixels[offset+3]>32)edge++;}
    maxChange=Math.max(maxChange,changed);if(edge)clips.push({progress,edge});
   }
   const end=paint(index,kind,1,variant);for(let offset=0;offset<end.length;offset+=4)if([0,1,2,3].some(channel=>Math.abs(end[offset+channel]-neutral[offset+channel])>16))unsettled++;
   results.push({id,kind,variant,maxChange,clips,unsettled});
  }});return results;
 },
 async evilPreview(){
  const canvas=document.createElement('canvas');canvas.width=480;canvas.height=560;const ctx=canvas.getContext('2d'),index=ids.indexOf('evil');
  const scenes=timeline([{kind:'signature',variant:0},{kind:'signature',variant:1},{kind:'brilliant',variant:0},{kind:'idle',variant:7}]);
  const draw=scene=>{ctx.fillStyle='#24251f';ctx.fillRect(0,0,480,560);ctx.fillStyle='#f3f1e8';ctx.textAlign='center';ctx.font='600 22px system-ui';ctx.fillText('Evil Meowl',240,37);ctx.fillStyle='#b8baad';ctx.font='15px system-ui';ctx.fillText(action(scene.kind,'evil',scene.variant),240,64,440);artwork(ctx,index,scene.kind,scene.progress,scene.variant,240,511,.355);};
  draw({kind:'signature',variant:0,progress:.5});const poster=canvas.toDataURL('image/png').split(',')[1];
  const video=await record(canvas,elapsed=>draw(scenes.at(elapsed)),scenes.total/1000);return{poster,video};
 },
 async preview(){
  const result={},canvas=document.createElement('canvas');canvas.width=1718;canvas.height=570;const ctx=canvas.getContext('2d');
  for(const kind of ['think','brilliant','idle','signature']){
   const contact=document.createElement('canvas');contact.width=1718;contact.height=1710;const cc=contact.getContext('2d');
   for(let variant=0;variant<3;variant++){row(ctx,kind,.5,variant);cc.drawImage(canvas,0,variant*570);}result[kind+'Contact']=contact.toDataURL('image/png').split(',')[1];
  }
  const scenes=timeline([{kind:'think',variant:1},{kind:'brilliant',variant:2},{kind:'idle',variant:0},{kind:'idle',variant:1},{kind:'idle',variant:2}]);
  result.video=await record(canvas,elapsed=>{const scene=scenes.at(elapsed);row(ctx,scene.kind,scene.progress,scene.variant);},scenes.total/1000);
  const idle=timeline([0,1,2].map(variant=>({kind:'idle',variant})));
  result.idle=await record(canvas,elapsed=>{const scene=idle.at(elapsed);row(ctx,scene.kind,scene.progress,scene.variant);},idle.total/1000);
  const close=document.createElement('canvas');close.width=560;close.height=650;const cc=close.getContext('2d');
  const story=timeline(ids.flatMap((id,index)=>[{kind:'idle',variant:1,index},{kind:index===1||index===4?'think':'brilliant',variant:2,index}]));
  function drawClose(scene){cc.fillStyle='#24251f';cc.fillRect(0,0,560,650);cc.textAlign='left';cc.fillStyle='#f3f1e8';cc.font='600 25px system-ui';cc.fillText(names[scene.index],28,39);cc.fillStyle='#b8baad';cc.font='16px system-ui';cc.fillText(action(scene.kind,ids[scene.index],scene.variant),28,67);cc.fillStyle='#30322a';cc.beginPath();cc.roundRect(28,88,504,530,18);cc.fill();artwork(cc,scene.index,scene.kind,scene.progress,scene.variant,280,560,.4);}
  const large=document.createElement('canvas');large.width=1680;large.height=1300;const lc=large.getContext('2d');
  for(let index=0;index<ids.length;index++){drawClose({index,kind:'signature',variant:1,progress:.5});lc.drawImage(close,index%3*560,Math.floor(index/3)*650);}result.mobileContact=large.toDataURL('image/png').split(',')[1];
  result.mobile=await record(close,elapsed=>drawClose(story.at(elapsed)),story.total/1000);
  return result;
 }
};
await Promise.all(images.map(image=>image.decode()));window.fixtureReady=true;
`;

let context,page,stage='launch';const errors=[],external=[];
try{
 await cp(join(root,'extension'),extension,{recursive:true});await writeFile(join(extension,'repertoire-fixture.html'),html);await writeFile(join(extension,'repertoire-fixture.js'),script);
 context=await chromium.launchPersistentContext(profile,{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'}),headless:true,viewport:{width:1200,height:350},reducedMotion:'no-preference',ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.setDefaultTimeout(10000);context.on('page',item=>item.on('pageerror',error=>errors.push(error.message)));await context.route(/^https?:\/\//,route=>{external.push(route.request().url());return route.abort();});
 const worker=context.serviceWorkers().find(item=>item.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker'),origin=`chrome-extension://${new URL(worker.url()).hostname}`;
 page=await context.newPage();await page.goto(`${origin}/repertoire-fixture.html`);await page.waitForFunction(()=>window.fixtureReady);await mkdir(join(root,'test-results'),{recursive:true});
 if(evilPreview){stage='recording Evil Meowl';const preview=await page.evaluate(()=>window.repertoire.evilPreview());for(const[key,name]of[['video','MeowlChess-coach-evil.webm'],['poster','MeowlChess-coach-evil.png']])await writeFile(join(root,'test-results',name),Buffer.from(preview[key],'base64'));}
 else if(!skipPreview&&!runtimeOnly){stage='recording repertoire';const preview=await page.evaluate(()=>window.repertoire.preview());for(const[key,name]of[['video','MeowlChess-coach-repertoire.webm'],['idle','MeowlChess-coach-idle.webm'],['mobile','MeowlChess-coach-personalities.webm'],['mobileContact','MeowlChess-coach-repertoire-mobile.png'],...['think','brilliant','idle','signature'].map(kind=>[kind+'Contact','MeowlChess-coach-repertoire-'+kind+'.png'])])await writeFile(join(root,'test-results',name),Buffer.from(preview[key],'base64'));}
 if(!previewOnly){
  if(!runtimeOnly){stage='all routines keep fixed proportions';const audit=await page.evaluate(()=>window.repertoire.audit());
  await writeFile(join(root,'test-results/MeowlChess-coach-repertoire-poses.json'),JSON.stringify(audit,null,2));
  assert.deepEqual(audit.violations,[]);assert.deepEqual(audit.nonfinite,[]);assert.deepEqual(audit.rest,[]);
  for(const take of audit.takes)assert.equal(take.count,take.expected,`${take.id} ${take.kind} has distinct routines for every take.`);
  for(const personality of audit.personalities)assert.equal(personality.count,6,`${personality.key} has six different character performances.`);
  stage='every selected kind and take renders within the portrait';const frames=await page.evaluate(signatureOnly=>window.repertoire.inspect(signatureOnly),signatureOnly);await writeFile(join(root,signatureOnly?'test-results/MeowlChess-coach-repertoire-signature-pixels.json':'test-results/MeowlChess-coach-repertoire-pixels.json'),JSON.stringify(frames,null,2));
  for(const frame of frames){assert.deepEqual(frame.clips,[],`${frame.id} ${frame.kind} take${frame.variant} is not clipped.`);assert.equal(frame.unsettled,0,`${frame.id} ${frame.kind} take${frame.variant} settles exactly.`);assert(frame.maxChange>25,`${frame.id} ${frame.kind} take${frame.variant} actually animates.`);}}
  if(!signatureOnly){stage='mobile, replacement and reduced motion';await page.setViewportSize({width:320,height:700});
  await page.evaluate(()=>{window.repertoire.react('signature');window.repertoire.react('think','owl');window.repertoire.react('brilliant');});await page.waitForFunction(()=>document.querySelectorAll('.coach-reaction-puppet').length===2);assert.equal(await page.locator('#meowl').evaluate(image=>image.parentElement.dataset.reaction),'brilliant');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!document.querySelector('.coach-reaction-puppet'));assert(await page.locator('.coach-actor>img').evaluateAll(images=>images.every(image=>getComputedStyle(image).visibility==='visible')));assert.equal(await page.evaluate(()=>window.repertoire.idle()),false);await page.evaluate(()=>window.repertoire.dispose());
  stage='real scheduled idle and paired view cycling';await page.close();page=await context.newPage();await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1200,height:350});const epoch=new Date('2030-01-01T00:00:00Z');await page.clock.install({time:epoch});await page.clock.pauseAt(new Date(epoch.valueOf()+1000));await page.goto(`${origin}/repertoire-fixture.html`);await page.waitForFunction(()=>window.fixtureReady,{},{polling:100});
  await page.evaluate(()=>window.repertoire.reset());
  const durations=await page.evaluate(()=>window.repertoire.durations);
  for(const [kind,grade]of [['talk',null],['celebrate','Great'],['celebrate','Best']])for(const expected of ['0','1','2','0']){assert.deepEqual(await page.evaluate(([kind,grade])=>window.repertoire.pair(kind,grade),[kind,grade]),[expected,expected],kind+' '+grade+' cycles separately in both views.');await page.clock.runFor(durations[kind]+120);assert.equal(await page.locator('.coach-actor[data-reaction],.coach-reaction-puppet').count(),0);}
  await page.evaluate(()=>{Math.random=()=>.5;window.repertoire.reset();});assert(await page.evaluate(()=>window.repertoire.idle()));await page.clock.runFor(5999);assert.equal(await page.locator('.coach-actor[data-reaction="idle"]').count(),0,'Idle must not interrupt the opening six seconds.');await page.clock.runFor(51);
  const idleTakes=new Set();
  for(let index=0;index<5;index++){
   if(index)await page.clock.runFor(9000+durations.idle);
   assert.equal(await page.locator('#meowl').evaluate(image=>image.parentElement.dataset.reaction),'idle','The runtime itself schedules idle.');const take=await page.locator('#meowl').evaluate(image=>Number(image.parentElement.dataset.variation));assert(take>=0&&take<40);assert(!idleTakes.has(take),'Scheduled idle must not wrap back to the old three-action loop.');idleTakes.add(take);assert.equal(await page.locator('.coach-reaction-puppet').count(),1);
  }
  stage='hidden, disabled, detached and disposed idle stays quiet';await page.evaluate(()=>window.repertoire.hidden(true));assert.equal(await page.locator('.coach-actor[data-reaction],.coach-reaction-puppet').count(),0);await page.clock.runFor(20000);assert.equal(await page.locator('.coach-actor[data-reaction]').count(),0);await page.evaluate(()=>window.repertoire.hidden(false));
  await page.evaluate(()=>{window.repertoire.reset();window.repertoire.idle();window.repertoire.disable();});await page.clock.runFor(20000);assert.equal(await page.locator('.coach-actor[data-reaction]').count(),0);
  await page.evaluate(()=>{window.repertoire.reset();window.repertoire.idle();document.querySelector('#meowl').closest('figure').remove();});await page.clock.runFor(20000);assert.equal(await page.locator('.coach-actor[data-reaction]').count(),0);
  await page.evaluate(()=>{window.repertoire.reset();window.repertoire.idle('owl');window.repertoire.dispose();});await page.clock.runFor(20000);assert.equal(await page.locator('.coach-actor[data-reaction],.coach-reaction-puppet').count(),0);}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(previewOnly?'Repertoire previews recorded.':signatureOnly?'Repertoire pose audit and signature frame checks passed.':runtimeOnly?'Repertoire three-take playback, scheduled idle, paired views and motion controls passed.':'Repertoire frames, three-take playback, scheduled idle, paired views and motion controls passed.');
}catch(error){await mkdir(join(root,'test-results'),{recursive:true});if(page)await page.screenshot({path:join(root,'test-results/MeowlChess-coach-repertoire-failure.png'),fullPage:true}).catch(()=>{});throw new Error(`Coach repertoire stage: ${stage}`,{cause:error});}
finally{await closeTestContext(context,profile,profilePrefix);if(dirname(bundle)===temp&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});}
