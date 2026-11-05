import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),temporaryRoot=resolve(tmpdir());
const profilePrefix='MeowlChess-coach-body-test-',bundlePrefix='MeowlChess-coach-body-bundle-';
const profile=await mkdtemp(join(temporaryRoot,profilePrefix)),bundle=await mkdtemp(join(temporaryRoot,bundlePrefix)),extension=join(bundle,'extension');
const baseline=process.argv.includes('--baseline');
const sourceExtension=baseline?join(root,'test-results/MeowlChess-refinement-baseline'):join(root,'extension');
const html='<meta charset="utf-8"><title>MeowlChess body coverage</title><script type="module" src="body-fixture.js"></script>';
const script=`
import {createCoachPuppet,drawCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS as durations} from './lib/coach-puppet.js';
import {coachPuppetUrl} from './lib/coach-portraits.js';
import {createCoachBodyBacking} from './lib/coach-body-backing.js';
const ids=['meowl','owl','paws','mellow','scout','evil'],images=[],puppets=[],creationMs=[];
for(const id of ids){const image=new Image();image.src=coachPuppetUrl(id);await image.decode();images.push(image);const start=performance.now();puppets.push(createCoachPuppet(image,document,id));creationMs.push({id,ms:performance.now()-start});}
function canvas(w=1254,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function paint(index,pose={},bodyOnly=false){const c=canvas(),ctx=c.getContext('2d',{willReadFrequently:true});if(bodyOnly){const body=puppets[index].rigid.body;ctx.drawImage(body.canvas,body.x,body.y);}else drawCoachPuppet(ctx,puppets[index],pose);return c;}
// Material checks distinguish the source clip's antialiased boundary from the
// actual garment surface, and also compare the size displayed in the product.
const leftCut=[[350,580],[468,580],[488,648],[501,743],[500,840],[477,929],[467,958],[419,961],[350,880]],rightCut=[[777,578],[903,578],[912,918],[844,969],[819,953],[783,906],[759,836],[753,741],[761,668]];
const collarCut=[[791,578],...rightCut.slice(1,8),[781,693]];
for(let i=1;i<=24;i++){const t=i/24,s=1-t;collarCut.push([s*s*781+2*s*t*783+t*t*794,s*s*693+2*s*t*700+t*t*672]);}
for(let i=1;i<=24;i++){const t=i/24,s=1-t;collarCut.push([s*s*s*794+3*s*s*t*802+3*s*t*t*798+t*t*t*791,s*s*s*672+3*s*s*t*650+3*s*t*t*606+t*t*t*578]);}
function cutDistance(x,y,id){let best=Infinity;for(const path of [leftCut,['owl','mellow'].includes(id)?collarCut:rightCut])for(let i=0;i<path.length;i++){const a=path[i],b=path[(i+1)%path.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;if(!length)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/length));best=Math.min(best,Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy));}return best;}
function avatarPixels(image){const c=canvas(320),ctx=c.getContext('2d');ctx.fillStyle='#25251f';ctx.fillRect(0,0,320,320);ctx.drawImage(image,0,0,320,320);return ctx.getImageData(0,0,320,320).data;}
// Anatomical interior, independent of wing silhouettes and their erase masks.
const rows=[[600,473,787],[650,456,805],[700,454,811],[750,457,812],[800,462,807],[850,471,799],[900,487,784],[950,511,759]];
function probes(c,pose={}){const ctx=c.getContext('2d'),result=[],a=pose.tilt||0;for(const[y,left,right]of rows)for(let x=left;x<=right;x+=8){const dx=x-626,dy=y-1150,px=Math.round(626+dx*Math.cos(a)-dy*Math.sin(a)+(pose.bodyX||0)),py=Math.round(1150+dx*Math.sin(a)+dy*Math.cos(a)+(pose.lift||0));const alpha=ctx.getImageData(px,py,1,1).data[3];if(alpha<245)result.push({x,y,alpha});}return result;}
const poses=[{leftWing:1.25,rightWing:1.25},{leftWing:1.1,rightElbow:1.55},{rightWing:1.1,leftElbow:1.55},{leftWing:.12,rightWing:.12,leftElbow:1.6,rightElbow:1.6}];
window.bodyCheck={
 materials(){
  const garmentColors={owl:[101,125,145],paws:[63,76,101],mellow:[157,137,159],scout:[115,133,104],evil:[133,45,58]};
  const fabric=[];for(let index=1;index<ids.length;index++){const ctx=paint(index,{},true).getContext('2d');for(const y of [700,760,820])for(const [side,columns]of [['left',[485,490,495,500,505,510]],['right',[750,755,760,765,770,775]]]){
   const expected=garmentColors[ids[index]],samples=columns.map(x=>{const pixel=[...ctx.getImageData(x,y,1,1).data],rgb=pixel.slice(0,3),shade=rgb.reduce((sum,value,c)=>sum+value*expected[c],0)/expected.reduce((sum,value)=>sum+value*value,0),hueDifference=Math.max(...expected.map((value,c)=>Math.abs(value*shade-rgb[c]))),sameHue=expected.every((value,c)=>expected.every((other,d)=>Math.abs(value-other)<12||Math.sign(value-other)*(rgb[c]-rgb[d])>=Math.abs(value-other)*.45));return{distance:cutDistance(x,y,ids[index]),rgb,valid:pixel[3]>=245&&shade>=.68&&shade<=1.2&&hueDifference<=10&&sameHue};});const variation=values=>Math.max(...[0,1,2].map(c=>Math.max(...values.map(p=>p[c]))-Math.min(...values.map(p=>p[c]))));fabric.push({id:ids[index],side,y,spread:variation(samples.map(p=>p.rgb)),interiorSpread:variation(samples.filter(p=>p.distance>2).map(p=>p.rgb)),mismatches:samples.filter(p=>!p.valid).length});
  }}
  const ctx=paint(0,{},true).getContext('2d'),colors=new Set(),rows=[];
  // Check the painted grain separately from the intentional dark feathers.
  // Including their tapered ends mistakes a real feather for a color band.
  for(let y=650;y<=780;y++){const mean=[0,0,0];let count=0;for(let x=462;x<=474;x++){const pixel=[...ctx.getImageData(x,y,1,1).data].slice(0,3);colors.add(pixel.join(','));if(pixel[0]<175||pixel[1]<140)continue;count++;for(let c=0;c<3;c++)mean[c]+=pixel[c];}if(count>=3)rows.push(mean.map(value=>value/count));}
  const largestRowStep=Math.max(...rows.slice(1).map((row,index)=>Math.max(...row.map((value,c)=>Math.abs(value-rows[index][c])))));
  const evilBacking=createCoachBodyBacking(puppets[5].image,document,'evil').getContext('2d'),evilFur=[];
  for(const[x,y]of[[454,700],[460,760],[467,820]])evilFur.push([...evilBacking.getImageData(x,y,1,1).data]);
  return{fabric,furColors:colors.size,largestRowStep,creationMs,evilFur,evilUnderlays:puppets[5].rigid.underlay};
 },
 inspect(){const cases=[],rest=[];
 for(let index=0;index<ids.length;index++){
  cases.push({id:ids[index],kind:'isolated torso',holes:probes(paint(index,{},true))});
  for(const [take,pose]of poses.entries())cases.push({id:ids[index],kind:'wing extent '+take,holes:probes(paint(index,pose),pose)});
  for(let take=0;take<3;take++)for(let frame=1;frame<16;frame++){const pose=coachPoseAt('signature',durations.signature*frame/16,ids[index],take);cases.push({id:ids[index],kind:'signature '+take+' frame '+frame,holes:probes(paint(index,pose),pose)});}
  const originalImage=paint(index),original=originalImage.getContext('2d').getImageData(0,0,1254,1254).data,originalAvatar=avatarPixels(originalImage);
  for(const [label,pose]of [['blink',{blink:.8}],['start',{leftWing:.00011,rightWing:.00011}]]){
   const afterImage=paint(index,pose),after=afterImage.getContext('2d').getImageData(0,0,1254,1254).data,afterAvatar=avatarPixels(afterImage);let opaqueChanges=0,transparentChanges=0,interiorChanges=0,avatarChanges=0,avatarMaxDifference=0;const transparentPixels=[];
   for(let y=580;y<1035;y++)for(let x=340;x<920;x++){const o=(y*1254+x)*4,different=[0,1,2,3].some(k=>Math.abs(original[o+k]-after[o+k])>24);if(different&&original[o+3]===255){opaqueChanges++;if(cutDistance(x,y,ids[index])>4)interiorChanges++;}if(original[o+3]===0&&after[o+3]>24){transparentChanges++;transparentPixels.push([x,y]);}}
   for(let y=Math.ceil(580*320/1254);y<Math.floor(1035*320/1254);y++)for(let x=Math.ceil(340*320/1254);x<Math.floor(920*320/1254);x++){const o=(y*320+x)*4,diff=Math.max(...[0,1,2,3].map(k=>Math.abs(originalAvatar[o+k]-afterAvatar[o+k])));if(diff>24)avatarChanges++;avatarMaxDifference=Math.max(avatarMaxDifference,diff);}
   rest.push({id:ids[index],pose:label,opaqueChanges,transparentChanges,transparentPixels,interiorChanges,avatarChanges,avatarMaxDifference});
  }
 }return{cases,rest};},
 contact(){const c=canvas(1560,1200),ctx=c.getContext('2d');ctx.fillStyle='#343a40';ctx.fillRect(0,0,c.width,c.height);for(let row=0;row<2;row++)for(let index=0;index<6;index++){const x=index*260,y=row*600;ctx.fillStyle='#fff';ctx.font='600 17px system-ui';ctx.fillText(ids[index]+(row?' · raised':' · folded'),x+15,y+28);const pose=row?poses[0]:poses[3];ctx.drawImage(paint(index,pose),330,450,600,680,x+10,y+45,240,272);ctx.fillStyle='#fff';ctx.font='14px system-ui';ctx.fillText('Torso beneath the wings',x+15,y+345);ctx.drawImage(paint(index,{},true),420,550,420,450,x+25,y+363,210,225);}return c.toDataURL('image/png').split(',')[1];}
};window.fixtureReady=true;`;
let context,page;
try{
 await cp(sourceExtension,extension,{recursive:true});await writeFile(join(extension,'body-fixture.html'),html);await writeFile(join(extension,'body-fixture.js'),script);
 context=await chromium.launchPersistentContext(profile,{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'}),headless:true,viewport:{width:1200,height:700},ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const errors=[];await context.route(/^https?:\/\//,route=>route.abort());const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/body-fixture.html');await page.waitForFunction(()=>window.fixtureReady);
 const result=await page.evaluate(()=>window.bodyCheck.inspect()),materials=await page.evaluate(()=>window.bodyCheck.materials());await mkdir(join(root,'test-results'),{recursive:true});const tag=baseline?'before':'after';await writeFile(join(root,'test-results/MeowlChess-coach-body-'+tag+'.json'),JSON.stringify({...result,materials},null,2));await writeFile(join(root,'test-results/MeowlChess-coach-body-'+tag+'.png'),Buffer.from(await page.evaluate(()=>window.bodyCheck.contact()),'base64'));
 console.log(JSON.stringify({cases:result.cases.length,withHoles:result.cases.filter(x=>x.holes.length).length,maxHoles:Math.max(...result.cases.map(x=>x.holes.length)),rest:result.rest}));
 if(!baseline){for(const item of result.cases)assert.deepEqual(item.holes,[],item.id+' '+item.kind+' keeps the complete body covered.');for(const item of result.rest){
  assert.equal(item.transparentChanges,0,JSON.stringify(item)+' must not grow a stationary wing, staff or body outline.');
  // SVG clips and raster extraction differ at their antialiased cut fringe.
  // Permit that narrow source-resolution fringe only: the body interior must
  // match exactly. Allow a small antialiased fringe at the displayed size;
  // different fabric beneath a clipped wing also changes its edge blend.
  assert.equal(item.interiorChanges,0,JSON.stringify(item)+' must not repaint the body interior during a blink.');
  assert(item.opaqueChanges<300,JSON.stringify(item)+' must keep source-edge antialiasing differences bounded.');
  assert(item.avatarChanges<16,JSON.stringify(item)+' must keep displayed body color stable.');
 }}
 console.log(JSON.stringify({materials}));
 // The folds stay clear of these old cutline probes, so their original strict
 // continuity check still applies. Also require matching opaque garment hue:
 // tan or gray fur must fail even if its brightness resembles the fabric.
 if(!baseline){for(const item of materials.fabric){assert(item.spread<=8,JSON.stringify(item)+' may differ only slightly at the antialiased cut edge.');assert.equal(item.interiorSpread,0,JSON.stringify(item)+' must continue the identical garment material across both sides of the old cut.');assert.equal(item.mismatches,0,JSON.stringify(item)+' must continue opaque, matching garment material across the cut.');}assert(materials.furColors>=8,'Hidden fur must keep the source painting variation.');assert(materials.largestRowStep<12,'Hidden fur must not contain horizontal color bands.');
  for(const[r,g,b,a]of materials.evilFur)assert(r>25&&r<195&&b>=r&&Math.abs(r-g)<6&&a>245,'Evil hidden feathers must keep charcoal fur and its darker feather ink.');
  for(const[name,color]of Object.entries(materials.evilUnderlays)){const[r,g,b]=color.match(/\d+/g).map(Number);assert(r>50&&b>=r&&Math.abs(r-g)<6,name+' must keep Evil charcoal/silver colors while a joint moves.');}
 }
 assert.deepEqual(errors,[]);
}finally{await closeTestContext(context,profile,profilePrefix);if(dirname(bundle)===temporaryRoot&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});}
