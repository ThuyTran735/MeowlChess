import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {chromium} from 'playwright-core';
import {closeTestContext} from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),output=join(root,'test-results');
const temporary=resolve(tmpdir()),prefix='MeowlChess-catalog-ui-',bundlePrefix='MeowlChess-catalog-source-';
const profile=await mkdtemp(join(temporary,prefix)),bundle=await mkdtemp(join(temporary,bundlePrefix)),extension=join(bundle,'extension');
const phase=process.env.MEOWLCHESS_PREVIEW_PHASE||'complete';
const fixture=`
import {createCoachPuppet,drawCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS as durations} from './lib/coach-puppet.js';
import {coachPuppetUrl} from './lib/coach-portraits.js';
import {COACH_ANIMATION_LABELS as labels,coachAnimationTakeCount} from './lib/coach-repertoire.js';
const ids=['meowl','owl','paws','mellow','scout','evil'],names=['Meowl','Professor','Captain','Mellow','Scout','Evil Meowl'],puppets=[];
for(const id of ids){const image=new Image();image.src=coachPuppetUrl(id);await image.decode();puppets.push(createCoachPuppet(image,document,id));}
const catalog=[];for(const coach of ids)for(const[kind,duration]of Object.entries(durations))for(let take=0;take<coachAnimationTakeCount(kind,coach);take++)catalog.push({id:coach+':'+kind+':'+take,coach,kind,take,label:labels[kind][coach][take],duration});
const canvas=document.createElement('canvas');canvas.width=canvas.height=1254;const ctx=canvas.getContext('2d',{willReadFrequently:true});
const forbidden=['squash','bodyBend','winkLeft','winkRight','blep','eyeSmile','leftFlop','rightFlop','breathe','rightReach','leftReach','hug'];
function draw(id,pose){ctx.clearRect(0,0,1254,1254);drawCoachPuppet(ctx,puppets[ids.indexOf(id)],pose);}
function edgePixels(){let count=0;for(const[x,y,w,h]of[[0,0,1254,2],[0,1252,1254,2],[0,2,2,1250],[1252,2,2,1250]]){const data=ctx.getImageData(x,y,w,h).data;for(let i=3;i<data.length;i+=4)if(data[i]>20)count++;}return count;}
function png(c){return c.toDataURL('image/png').split(',')[1];}
function sheet(width,height){const c=document.createElement('canvas');c.width=width;c.height=height;const t=c.getContext('2d');t.fillStyle='#25271f';t.fillRect(0,0,width,height);return[c,t];}
window.catalogFixture={catalog,
 initial(){const[c,t]=sheet(1800,1050);const poses=[{}, {leftWing:1.15,rightWing:1.15},{leftWing:.5,rightWing:.5,headTilt:.1,leftEar:.18,rightEar:-.18,leftStep:28,leftFoot:.3,rightFoot:-.3}];for(let r=0;r<poses.length;r++)for(let i=0;i<6;i++){draw(ids[i],poses[r]);const x=i*300,y=r*350;t.fillStyle='#f2eee4';t.font='600 17px system-ui';t.fillText(names[i]+' · '+['Rest','Raised','Head + legs'][r],x+12,y+28);t.drawImage(canvas,x+8,y+43,284,284);}return png(c);},
 parts(){const[c,t]=sheet(1920,1120),keys=['body','head','leftEar','rightEar','leftFoot','rightFoot','leftWing','rightWing'];for(let row=0;row<2;row++){const index=row?5:0,p=puppets[index],parts={...p.rigid,leftWing:{canvas:p.left.painted,x:p.left.x,y:p.left.y},rightWing:{canvas:p.right.painted,x:p.right.x,y:p.right.y}};for(let k=0;k<keys.length;k++){const x=(k%5)*384,y=row*560+Math.floor(k/5)*280,part=parts[keys[k]];t.fillStyle='#f2eee4';t.font='600 17px system-ui';t.fillText(names[index]+' · '+keys[k],x+12,y+28);if(part){t.save();t.translate(x+60,y+40);t.scale(240/1254,240/1254);t.drawImage(part.canvas,part.x,part.y);t.restore();}}}return png(c);},
 check(coach){const items=catalog.filter(a=>a.coach===coach),failures=[];let frames=0;const neutral=()=>{draw(coach,{});return ctx.getImageData(0,0,1254,1254).data;};const rest=neutral();
  for(const item of items){for(const u of[0,.12,.28,.44,.6,.78,.92,1]){const pose=coachPoseAt(item.kind,item.duration*u,coach,item.take);for(const[key,value]of Object.entries(pose))if(!Number.isFinite(value))failures.push({id:item.id,u,reason:'nonfinite '+key});for(const key of forbidden)if(pose[key])failures.push({id:item.id,u,reason:'deformation '+key});draw(coach,pose);const edge=edgePixels();if(edge)failures.push({id:item.id,u,reason:'clipped outer edge',pixels:edge});frames++;}
   const finish=ctx.getImageData(0,0,1254,1254).data;let changed=0;for(let p=0;p<rest.length;p+=4)if([0,1,2,3].some(c=>Math.abs(rest[p+c]-finish[p+c])>18))changed++;if(changed>100)failures.push({id:item.id,reason:'did not settle',pixels:changed});}
  return {coach,takes:items.length,frames,failures};},
 contact(coach,section){const items=catalog.filter(a=>a.coach===coach).slice(section*18,section*18+18),[c,t]=sheet(1440,Math.ceil(items.length/6)*294);for(let i=0;i<items.length;i++){const item=items[i],x=(i%6)*240,y=Math.floor(i/6)*294;const poses=[.23,.44,.65,.82].map(u=>coachPoseAt(item.kind,item.duration*u,coach,item.take));const weights=p=>Object.entries(p).reduce((s,[key,v])=>s+Math.abs(v)*(/Wing|Elbow|book|mug|pennant|magnifier|feather$/.test(key)?20:1),0);const pose=poses.reduce((a,b)=>weights(a)>weights(b)?a:b);draw(coach,pose);t.fillStyle='#f2eee4';t.font='600 14px system-ui';t.fillText(item.label.slice(0,31),x+8,y+22);t.fillStyle='#aeb5a0';t.font='12px system-ui';t.fillText(item.kind+' · take '+(item.take+1),x+8,y+42);t.drawImage(canvas,x+2,y+48,236,236);}return png(c);}
};window.fixtureReady=true;`;

let context;
try{
 await mkdir(output,{recursive:true});await cp(join(root,'extension'),extension,{recursive:true});
 await writeFile(join(extension,'catalog-fixture.html'),'<!doctype html><meta charset="utf-8"><script type="module" src="catalog-fixture.js"></script>');await writeFile(join(extension,'catalog-fixture.js'),fixture);
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//,route=>route.abort());const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('chrome-extension://'+new URL(worker.url()).hostname+'/catalog-fixture.html');await page.waitForFunction(()=>window.fixtureReady);
 const catalog=await page.evaluate(()=>window.catalogFixture.catalog);assert.equal(catalog.length,420);assert.equal(new Set(catalog.map(a=>a.id)).size,420);
 for(const method of['initial','parts'])await writeFile(join(output,'MeowlChess-'+phase+'-'+method+'.png'),Buffer.from(await page.evaluate(method=>window.catalogFixture[method](),method),'base64'));
 if(!process.argv.includes('--visual-only')){
  const results=[];for(const coach of['meowl','owl','paws','mellow','scout','evil']){const result=await page.evaluate(coach=>window.catalogFixture.check(coach),coach);results.push(result);console.log(JSON.stringify(result));for(let section=0;section<4;section++)await writeFile(join(output,'MeowlChess-catalog-'+coach+'-'+section+'.png'),Buffer.from(await page.evaluate(({coach,section})=>window.catalogFixture.contact(coach,section),{coach,section}),'base64'));}
  await writeFile(join(output,'MeowlChess-catalog-results.json'),JSON.stringify(results,null,2));assert.equal(results.flatMap(r=>r.failures).length,0,JSON.stringify(results.flatMap(r=>r.failures)));
 }
 assert.deepEqual(errors,[]);console.log('Native animation catalog rendered.');
}finally{await closeTestContext(context,profile,prefix);if(dirname(bundle)===temporary&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});}
