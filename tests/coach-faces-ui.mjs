import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {closeTestContext} from './ui-helpers.mjs';
const root=resolve(import.meta.dirname,'..'),prefix='MeowlChess-faces-test-',profile=await mkdtemp(join(tmpdir(),prefix));
const ids=['meowl','owl','paws','mellow','scout','evil'],names=['Meowl','Professor','Captain','Mellow','Scout','Evil Meowl'];
let context;
try{
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH,headless:true,viewport:{width:1200,height:760},args:['--mute-audio']});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='meowlchess.test')return route.abort();
    const path=resolve(root,'extension',`.${decodeURIComponent(url.pathname)}`);
    if(!path.startsWith(resolve(root,'extension')+'\\'))return route.abort();
    try{await route.fulfill({body:await readFile(path),contentType:{'.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(path)]||'text/html'});}catch{await route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://meowlchess.test/faces.html');
  const beforeData=process.argv.includes('--compare')?'data:image/svg+xml;base64,'+(await readFile(join(root,'test-results/MeowlChess-coach-evil-before.svg'))).toString('base64'):null;
  const output=await page.evaluate(async({ids,names,beforeData})=>{
    const {createCoachPuppet,drawCoachPuppet}=await import('./lib/coach-action-renderer.js');
    const {coachPuppetUrl,coachPortraitUrl}=await import('./lib/coach-portraits.js');
    const {coachPoseAt,COACH_REACTION_DURATIONS}=await import('./lib/coach-puppet.js');
    const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;});
    const surface=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
    const face=surface(1200,650),full=surface(1200,760),fc=face.getContext('2d'),bc=full.getContext('2d');
    for(const ctx of[fc,bc]){ctx.fillStyle='#24251f';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.fillStyle='#f3ebd9';ctx.font='bold 22px Arial';ctx.textAlign='center';}
    const results=[];window.facePuppets={};
    for(let i=0;i<ids.length;i++){
      const id=ids[i],portrait=await load(coachPortraitUrl(id)),base=await load(coachPuppetUrl(id)),puppet=createCoachPuppet(base,document,id);window.facePuppets[id]=puppet;
      const x=(i%3)*400,y=Math.floor(i/3)*325;fc.fillStyle='#f3ebd9';fc.fillText(names[i],x+200,y+32);fc.drawImage(portrait,415,245,420,280,x+10,y+52,380,253);
      const col=i*200;bc.fillStyle='#f3ebd9';bc.font='bold 18px Arial';bc.fillText(names[i],col+100,31);bc.drawImage(portrait,350,80,570,1120,col,48,200,393);
      const staticCanvas=surface(1254,1254),animated=surface(1254,1254);staticCanvas.getContext('2d').drawImage(portrait,0,0);drawCoachPuppet(animated.getContext('2d'),puppet,{});
      const a=staticCanvas.getContext('2d').getImageData(415,245,420,280).data,b=animated.getContext('2d').getImageData(415,245,420,280).data;
      let different=0,max=0;for(let p=0;p<a.length;p+=4){let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(a[p+c]-b[p+c]));max=Math.max(max,delta);if(delta>18)different++;}
      const neutral=animated.toDataURL();const states=[];
      for(const [index,pose]of[{blink:1},{lookX:-1,lookY:1,mouth:.7},{lookX:1,lookY:-1,mouth:1}].entries()){
        animated.getContext('2d').clearRect(0,0,1254,1254);drawCoachPuppet(animated.getContext('2d'),puppet,pose);
        if(index===2)bc.drawImage(animated,415,245,420,280,col+4,465,192,128);
        states.push(animated.toDataURL());
      }
      results.push({id,different,max,neutral,states});
    }
    window.renderEvilFrame=progress=>{const c=surface(480,560),ctx=c.getContext('2d');ctx.fillStyle='#24251f';ctx.fillRect(0,0,480,560);ctx.fillStyle='#f3ebd9';ctx.font='bold 24px Arial';ctx.textAlign='center';ctx.fillText('Evil Meowl',240,35);const segment=Math.floor(progress/3.2),p=(progress%3.2)/3.2;ctx.save();ctx.translate(-10,60);ctx.scale(.4,.4);drawCoachPuppet(ctx,window.facePuppets.evil,coachPoseAt(segment%2?'talk':'signature',p*COACH_REACTION_DURATIONS[segment%2?'talk':'signature'],'evil',segment%2?0:1));ctx.restore();return c.toDataURL();};
    let comparison=null;
    if(beforeData){
      const sheet=surface(960,550),ctx=sheet.getContext('2d');ctx.fillStyle='#24251f';ctx.fillRect(0,0,960,550);ctx.fillStyle='#f3ebd9';ctx.font='bold 24px Arial';ctx.textAlign='center';
      const images=[await load(beforeData),await load(coachPortraitUrl('evil'))];
      for(let i=0;i<2;i++){ctx.fillText(i?'Refined Evil Meowl':'Previous Evil Meowl',i*480+240,36);ctx.drawImage(images[i],410,100,430,440,i*480+20,70,440,450);}
      comparison=sheet.toDataURL();
    }
    return {faces:face.toDataURL(),full:full.toDataURL(),comparison,results};
  },{ids,names,beforeData});
  const target=join(root,'test-results');await mkdir(target,{recursive:true});
  const write=(name,uri)=>writeFile(join(target,name),Buffer.from(uri.split(',')[1],'base64'));
  await write('MeowlChess-character-faces.png',output.faces);await write('MeowlChess-character-coaches.png',output.full);
  if(output.comparison)await write('MeowlChess-evil-face-comparison.png',output.comparison);
  for(const r of output.results){await write(`MeowlChess-face-${r.id}-neutral.png`,r.neutral);for(let n=0;n<r.states.length;n++)await write(`MeowlChess-face-${r.id}-${n}.png`,r.states[n]);}
  console.log(JSON.stringify(output.results.map(({id,different,max})=>({id,different,max})),null,2));
  if(!process.argv.includes('--preview')){
    for(const r of output.results){assert(r.different<100,`${r.id}: static and animated neutral face diverged (${r.different} pixels)`);assert(new Set([r.neutral,...r.states]).size===4,`${r.id}: blink, gaze and talking must render distinct states`);}
    assert.equal(new Set(output.results.map(r=>r.neutral)).size,6);assert.deepEqual(errors,[]);
  }
  if(process.argv.includes('--gif')){
    const frames=join(target,'MeowlChess-evil-face-frames');await mkdir(frames,{recursive:true});
    for(let n=0;n<96;n++){const uri=await page.evaluate(t=>window.renderEvilFrame(t),n/15);await writeFile(join(frames,`${String(n).padStart(4,'0')}.png`),Buffer.from(uri.split(',')[1],'base64'));}
  }
}finally{await closeTestContext(context,profile,prefix);}
