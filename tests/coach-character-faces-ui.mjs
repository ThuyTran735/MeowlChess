import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),temporary=resolve(tmpdir());
const prefix='MeowlChess-character-faces-',bundlePrefix='MeowlChess-face-bundle-';
const profile=await mkdtemp(join(temporary,prefix)),bundle=await mkdtemp(join(temporary,bundlePrefix));
const extension=join(bundle,'extension');
const fixture=`
import {createCoachPuppet,drawCoachPuppet} from './lib/coach-puppet.js';
import {coachPuppetUrl,coachPortraitUrl} from './lib/coach-portraits.js';
import {createCoachEyes,drawCoachEyes} from './lib/coach-eye-renderer.js';
const ids=['meowl','owl','paws','mellow','scout','evil'];
const canvas=document.createElement('canvas');canvas.width=canvas.height=1254;
const context=canvas.getContext('2d',{willReadFrequently:true});
const small=document.createElement('canvas');small.width=small.height=256;
const smallContext=small.getContext('2d',{willReadFrequently:true});
const results=[],mobileFaces=[],referenceEyes=[];
const eyeCanvas=document.createElement('canvas');eyeCanvas.width=eyeCanvas.height=1254;
const eyeContext=eyeCanvas.getContext('2d',{willReadFrequently:true});
const eyeStates=[{}, {blink:.5}, {blink:1}, {lookX:-1}, {lookX:1}, {lookY:-1}, {lookY:1}, {blink:.6,lookX:.8,lookY:-.8}];
function eyeInk(cx,cy){
 const width=96,height=88,ink=eyeContext.getImageData(cx-48,cy-44,width,height).data;
 // An oval around the eye includes all its ink while excluding eyebrow tips
 // outside the eye (Captain's thicker brow reaches the rectangle's corner).
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(((x-48)/40)**2+((y-44)/42)**2>1)ink.fill(0,(y*width+x)*4,(y*width+x)*4+4);
 return Array.from(ink);
}
const pixels=(x,y,w,h)=>Array.from(context.getImageData(x,y,w,h).data);
function changed(a,b,tolerance=16){let n=0;for(let i=0;i<a.length;i+=4)if([0,1,2,3].some(c=>Math.abs(a[i+c]-b[i+c])>tolerance))n++;return n;}
function centerInk(cx,cy){const p=pixels(cx-12,cy-14,24,17);let n=0;for(let i=0;i<p.length;i+=4)if(p[i+3]>240&&p[i]<80&&p[i+1]<75&&p[i+2]<70)n++;return n;}
for(const id of ids){
 const image=new Image();image.src=coachPuppetUrl(id);await image.decode();
 const portrait=new Image();portrait.src=coachPortraitUrl(id);await portrait.decode();
 const puppet=createCoachPuppet(image,document,id);
 const sharedEyes=[];
 for(const [index,pose]of eyeStates.entries()){
  eyeContext.clearRect(0,0,1254,1254);drawCoachEyes(eyeContext,createCoachEyes(image,document,id),pose.blink,pose.lookX,pose.lookY);
  // Sample only the inked eyes; brows, glasses and cheek markings remain free
  // to express each personality while eye shapes, colors and gaze must match.
  const eyes=[...eyeInk(528,345),...eyeInk(706,348)];
  if(id==='meowl')referenceEyes[index]=eyes;
  sharedEyes.push({pose,differentPixels:changed(referenceEyes[index],eyes,0)});
 }
 function draw(pose){context.clearRect(0,0,1254,1254);drawCoachPuppet(context,puppet,pose);}
 context.clearRect(0,0,1254,1254);context.drawImage(portrait,0,0);
 const staticFace=pixels(465,270,310,215);
 draw({});const neutral=pixels(0,0,1254,1254),face=pixels(465,270,310,215),brows=pixels(475,265,280,37);
 const openCenters=[centerInk(528,345),centerInk(706,348)];
 smallContext.clearRect(0,0,256,256);smallContext.drawImage(canvas,0,0,256,256);
 mobileFaces.push(Array.from(smallContext.getImageData(95,55,64,45).data));
 const actions=[];
 for(const pose of [{blink:1},{blink:.5},{lookX:-1},{lookX:1},{lookY:-1},{lookY:1},{mouth:.9},{blink:.6,lookX:.8,lookY:-.8,mouth:.6}]){
  draw(pose);
  actions.push({pose,changedFace:changed(face,pixels(465,270,310,215)),changedBrows:changed(brows,pixels(475,265,280,37)),centers:pose.blink===1?[centerInk(528,345),centerInk(706,348)]:undefined});
 }
 draw({});const restored=pixels(0,0,1254,1254);
 results.push({id,staticDifference:changed(staticFace,face),neutralDifference:changed(neutral,restored),openCenters,actions,sharedEyes});
}
const pairs=[];for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)pairs.push({a:ids[a],b:ids[b],pixels:changed(mobileFaces[a],mobileFaces[b],24)});
window.faceResult={results,pairs};window.fixtureReady=true;
`;
let context;
try {
 await cp(join(root,'extension'),extension,{recursive:true});
 await writeFile(join(extension,'character-faces.html'),'<!doctype html><meta charset="utf-8"><script type="module" src="character-faces.js"></script>');
 await writeFile(join(extension,'character-faces.js'),fixture);
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//,route=>route.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/character-faces.html');
 await page.waitForFunction(()=>window.fixtureReady);
 const result=await page.evaluate(()=>window.faceResult);
 await mkdir(join(root,'test-results'),{recursive:true});
 await writeFile(join(root,'test-results/MeowlChess-character-face-results.json'),JSON.stringify(result,null,2));
 assert.deepEqual(errors,[]);
 for(const face of result.results){
  assert.ok(face.staticDifference<1000,`${face.id}: animated face differs from its static portrait (${face.staticDifference} pixels)`);
  assert.equal(face.neutralDifference,0,`${face.id}: returning to rest changed the artwork`);
  assert.ok(face.openCenters.every(n=>n>30),`${face.id}: the open eyes are missing their pupils`);
  for(const eyes of face.sharedEyes)assert.equal(eyes.differentPixels,0,`${face.id}: eyes differ from normal Meowl for ${JSON.stringify(eyes.pose)}`);
  for(const action of face.actions){
   assert.ok(action.changedFace>45,`${face.id}: ${JSON.stringify(action.pose)} did not visibly animate`);
   assert.equal(action.changedBrows,0,`${face.id}: an eye or mouth action erased or shifted its forehead markings`);
   if(action.centers)assert.ok(action.centers.every(n=>n<8),`${face.id}: a fully closed eye left old pupil ink (${action.centers})`);
  }
 }
 console.log(JSON.stringify({coaches:result.results.length,sharedEyeStates:result.results.reduce((n,face)=>n+face.sharedEyes.length,0),maxEyeDifference:Math.max(...result.results.flatMap(face=>face.sharedEyes.map(eyes=>eyes.differentPixels))),maxStaticDifference:Math.max(...result.results.map(r=>r.staticDifference))}));
} finally {
 await closeTestContext(context,profile,prefix);
 if(dirname(bundle)===temporary&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
