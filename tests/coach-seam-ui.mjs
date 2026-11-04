import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),temporaryRoot=resolve(tmpdir());
const profilePrefix='MeowlChess-coach-seam-test-',bundlePrefix='MeowlChess-coach-seam-bundle-';
const profile=await mkdtemp(join(temporaryRoot,profilePrefix)),bundle=await mkdtemp(join(temporaryRoot,bundlePrefix)),extension=join(bundle,'extension');
const html='<!doctype html><meta charset="utf-8"><title>MeowlChess coach forehead</title><script type="module" src="seam-fixture.js"></script>';
const script=`
import {createCoachPuppet,drawCoachPuppet} from './lib/coach-puppet.js';
import {coachPuppetUrl,coachPortraitUrl} from './lib/coach-portraits.js';
const ids=['meowl','owl','paws','mellow','scout','evil'],images=[],originals=[],puppets=[],oldPuppets=[];
async function image(url){const value=new Image();value.src=url;await value.decode();return value;}
for(const id of ids){
 const url=coachPuppetUrl(id),source=await(await fetch(url)).text();
 const oldSource=source.replace('<rect y="250" width="1254" height="1004"/>','<rect y="282" width="1254" height="972"/>');
 const old=await image('data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(oldSource))));
 const current=await image(url);images.push(current);originals.push(old);puppets.push(createCoachPuppet(current,document,id));oldPuppets.push(createCoachPuppet(old,document,id));
}
const poses=[{}, {headTilt:.1,headNod:8}, {headTilt:-.1,headNod:-8}, {leftEar:.18,rightEar:-.18}, {headTilt:.07,leftEar:-.18,rightEar:.18}, {mouth:.8,blink:.55,lookX:.8}];
function canvas(size){const value=document.createElement('canvas');value.width=value.height=size;return value;}
function render(index,size,pose,old=false,direct=false){
 const value=canvas(size),ctx=value.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
 if(direct)ctx.drawImage((old?originals:images)[index],.23,.17,size-.46,size-.34);
 else{ctx.translate(.23,.17);ctx.scale((size-.46)/1254,(size-.34)/1254);drawCoachPuppet(ctx,(old?oldPuppets:puppets)[index],pose);}
 return value;
}
function minimumBand(canvas,pose={}){
 const ctx=canvas.getContext('2d'),values=[],s=(canvas.width-.46)/1254,sy=(canvas.height-.34)/1254;
 // At 32px a sample beside an ear covers its moving outer silhouette too.
 // Keep the regression inside the brow, where the reported line crosses fur.
 for(let x=560;x<=700;x+=10){
  const tilt=pose.headTilt||0,nod=pose.headNod||0,dx=x-626,dy=282-535;
  const px=Math.round(.23+(626+dx*Math.cos(tilt)-dy*Math.sin(tilt))*s),py=Math.floor(.17+(535+nod+dx*Math.sin(tilt)+dy*Math.cos(tilt))*sy);
  values.push(ctx.getImageData(px,py,1,1).data[3]);
 }
 return Math.min(...values);
}
window.seam={
 inspect(){
  const cases=[];for(let index=0;index<5;index++)for(const size of [32,64,128,192,260,560])for(const [poseIndex,pose]of poses.entries()){
   const value=render(index,size,pose),old=render(index,size,pose,true),current=minimumBand(value,pose),before=minimumBand(old,pose);
   cases.push({id:ids[index],size,pose:poseIndex,current,before});
  }
  const staticCases=[];for(let index=0;index<5;index++)for(const size of [32,64,128,192,260,560])staticCases.push({id:ids[index],size,current:minimumBand(render(index,size,{},false,true)),before:minimumBand(render(index,size,{},true,true))});
  return{cases,staticCases};
 },
 crown(){const value=render(0,1254,{}),ctx=value.getContext('2d');return[[610,145],[630,185],[670,175]].map(([x,y])=>ctx.getImageData(x,y,1,1).data[3]);},
 contact(){
  const sheet=document.createElement('canvas');sheet.width=1500;sheet.height=1140;const ctx=sheet.getContext('2d');ctx.fillStyle='#24231f';ctx.fillRect(0,0,1500,1140);
  for(let row=0;row<4;row++)for(let index=0;index<5;index++){
   const old=row<2,pose=poses[row%2?4:0],rendered=render(index,260,pose,old,row%2===0),x=index*300,y=row*285;
   ctx.fillStyle='#f1eee5';ctx.font='600 16px system-ui';ctx.fillText(ids[index]+' · '+(old?'before':'fixed')+(row%2?' moving':' still'),x+12,y+24);
   ctx.drawImage(rendered,390*260/1254,65*260/1254,480*260/1254,405*260/1254,x+14,y+42,272,230);
  }
  return sheet.toDataURL('image/png').split(',')[1];
 }
};window.fixtureReady=true;
`;
let context,page;
try{
 await cp(join(root,'extension'),extension,{recursive:true});await writeFile(join(extension,'seam-fixture.html'),html);await writeFile(join(extension,'seam-fixture.js'),script);
 context=await chromium.launchPersistentContext(profile,{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'}),headless:true,viewport:{width:1200,height:600},ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const errors=[];await context.route(/^https?:\/\//,route=>route.abort());const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/seam-fixture.html');await page.waitForFunction(()=>window.fixtureReady);
 const result=await page.evaluate(()=>window.seam.inspect());await mkdir(join(root,'test-results'),{recursive:true});await writeFile(join(root,'test-results/MeowlChess-coach-forehead-checks.json'),JSON.stringify(result,null,2));await writeFile(join(root,'test-results/MeowlChess-coach-forehead-before-after.png'),Buffer.from(await page.evaluate(()=>window.seam.contact()),'base64'));
 console.log(JSON.stringify({motionMin:Math.min(...result.cases.map(x=>x.current)),oldMotionMin:Math.min(...result.cases.map(x=>x.before)),staticMin:Math.min(...result.staticCases.map(x=>x.current)),oldStaticMin:Math.min(...result.staticCases.map(x=>x.before))}));
 for(const item of [...result.cases,...result.staticCases])assert(item.current>=245,`${item.id} at${item.size}px, pose${item.pose??'static'} has an opaque forehead: ${item.current}`);
 assert(result.staticCases.some(item=>item.before<230),'The regression reproduces the old clip seam.');assert((await page.evaluate(()=>window.seam.crown())).every(alpha=>alpha===0),'The regular Meowl remains uncrowned.');assert.deepEqual(errors,[]);console.log('Coach forehead stays opaque across six characters, six sizes, and head/ear movements.');
}finally{await closeTestContext(context,profile,profilePrefix);if(dirname(bundle)===temporaryRoot&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});}
