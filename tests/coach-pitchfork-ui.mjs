import assert from 'node:assert/strict';
import {cp,mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {chromium} from 'playwright-core';
import {closeTestContext} from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),temporary=resolve(tmpdir());
const prefix='MeowlChess-pitchfork-ui-',bundlePrefix='MeowlChess-pitchfork-bundle-';
const profile=await mkdtemp(join(temporary,prefix)),bundle=await mkdtemp(join(temporary,bundlePrefix)),extension=join(bundle,'extension');
const fixture=`
import {createCoachPuppet,drawCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS as durations} from './lib/coach-puppet.js';
import {coachPuppetUrl,coachPortraitUrl} from './lib/coach-portraits.js';
import {resolveCoachWingPose} from './lib/coach-wing-kinematics.js';
import {resolveEvilPitchforkPose,coachPitchforkTransform,drawCoachPitchfork,EVIL_PITCHFORK_GRIP} from './lib/coach-pitchfork.js';
const base=new Image();base.src=coachPuppetUrl('evil');await base.decode();
const portrait=new Image();portrait.src=coachPortraitUrl('evil');await portrait.decode();
const puppet=createCoachPuppet(base,document,'evil');
const canvas=document.createElement('canvas');canvas.width=canvas.height=1254;
const context=canvas.getContext('2d',{willReadFrequently:true});
const prop=document.createElement('canvas');prop.width=prop.height=1254;
const propContext=prop.getContext('2d',{willReadFrequently:true});
const sourceGrip=puppet.left.grip.getContext('2d').getImageData(EVIL_PITCHFORK_GRIP[0]-puppet.left.x,EVIL_PITCHFORK_GRIP[1]-puppet.left.y,1,1).data[3];
function world(x,y,hold,pose){
 const a=hold.angle,c=Math.cos(a),s=Math.sin(a),px=hold.x+x*c-y*s-626,py=hold.y+x*s+y*c-1150;
 const t=pose.tilt||0;return [px*Math.cos(t)-py*Math.sin(t)+626+(pose.bodyX||0),px*Math.sin(t)+py*Math.cos(t)+1150+(pose.lift||0)];
}
function patch(ctx,x,y){return ctx.getImageData(Math.round(x)-2,Math.round(y)-2,5,5).data;}
function sampleAt(x,y,hold,pose){const point=world(x,y,hold,pose);return [patch(context,...point),patch(propContext,...point)];}
function countMatch(a,b){let n=0;for(let i=0;i<a.length;i+=4)if(a[i+3]>240&&b[i+3]>240&&[0,1,2].every(c=>Math.abs(a[i+c]-b[i+c])<=16))n++;return n;}
function countFeather(a,b){let n=0;for(let i=0;i<a.length;i+=4)if(a[i+3]>240&&Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])<28&&[0,1,2].some(c=>Math.abs(a[i+c]-b[i+c])>22))n++;return n;}
const poses=[{name:'rest',raw:{}}];
for(const kind of ['signature','talk','brilliant','great','think','encourage','idle'])for(const take of [0,1,2])for(const t of [.28,.62]){
 if(durations[kind])poses.push({name:kind+'/'+take+'/'+t,raw:coachPoseAt(kind,durations[kind]*t,'evil',take)});
}
const results=[];
for(const {name,raw} of poses){
 const pose=resolveEvilPitchforkPose(resolveCoachWingPose(raw,'evil')),hold=coachPitchforkTransform(pose);
 context.clearRect(0,0,1254,1254);drawCoachPuppet(context,puppet,raw);
 propContext.clearRect(0,0,1254,1254);propContext.save();propContext.translate(pose.bodyX||0,pose.lift||0);propContext.translate(626,1150);propContext.rotate(pose.tilt||0);propContext.translate(-626,-1150);drawCoachPitchfork(propContext,pose);propContext.restore();
 const covered=countFeather(...sampleAt(0,0,hold,pose));
 const crossing=[-16,16].map(x=>countFeather(...sampleAt(x,0,hold,pose)));
 const shaft=[-240,-70,70,240].map(y=>countMatch(...sampleAt(0,y,hold,pose)));
 results.push({name,covered,crossing,shaft});
}
context.clearRect(0,0,1254,1254);drawCoachPuppet(context,puppet,{});const neutral=context.getImageData(0,0,1254,1254).data;
context.clearRect(0,0,1254,1254);context.drawImage(portrait,0,0);const still=context.getImageData(0,0,1254,1254).data;
let portraitDifference=0;for(let i=0;i<neutral.length;i+=4)if([0,1,2,3].some(c=>Math.abs(neutral[i+c]-still[i+c])>16))portraitDifference++;
window.gripResults={sourceGrip,portraitDifference,results};window.fixtureReady=true;
`;
let context;
try{
 await cp(join(root,'extension'),extension,{recursive:true});
 await writeFile(join(extension,'pitchfork-fixture.html'),'<!doctype html><meta charset="utf-8"><script type="module" src="pitchfork-fixture.js"></script>');
 await writeFile(join(extension,'pitchfork-fixture.js'),fixture);
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//,route=>route.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/pitchfork-fixture.html');
 await page.waitForFunction(()=>window.fixtureReady);
 const result=await page.evaluate(()=>window.gripResults);
 await mkdir(join(root,'test-results'),{recursive:true});await writeFile(join(root,'test-results/MeowlChess-rendered-grip-results.json'),JSON.stringify(result,null,2));
 assert.deepEqual(errors,[]);assert.ok(result.sourceGrip>240,'The grip must be inside opaque original feather artwork.');
 for(const frame of result.results){
  assert.ok(frame.covered>=18,frame.name+': the feather must visibly cover the shaft at the grip.');
  assert.ok(frame.crossing.every(n=>n>=12),frame.name+': the feather must cross both sides of the shaft, rather than lie beside it.');
  assert.ok(frame.shaft.every(n=>n>=18),frame.name+': substantial shaft must remain visible above and below the grip.');
 }
 assert.ok(result.portraitDifference<300,'Static portrait must match the actual neutral carrying pose: '+result.portraitDifference+' pixels differ.');
 console.log(JSON.stringify({poses:result.results.length,portraitDifference:result.portraitDifference,minCovered:Math.min(...result.results.map(r=>r.covered)),minCrossing:Math.min(...result.results.flatMap(r=>r.crossing)),minShaft:Math.min(...result.results.flatMap(r=>r.shaft))}));
}finally{
 await closeTestContext(context,profile,prefix);
 if(dirname(bundle)===temporary&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
