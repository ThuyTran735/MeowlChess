import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'..'),browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--mute-audio']});
try{
 const page=await browser.newPage();await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='meowlchess.test')return route.abort();
  const file=resolve(root,'extension','.'+decodeURIComponent(url.pathname));if(!file.startsWith(resolve(root,'extension')+'\\'))return route.abort();
  try{await route.fulfill({body:await readFile(file),contentType:{'.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'text/html'});}catch{await route.fulfill({body:'<!doctype html>',contentType:'text/html'});}
 });await page.goto('http://meowlchess.test/props.html');
 const result=await page.evaluate(async()=>{
  const {createCoachPuppet,drawCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS:durations}=await import('./lib/coach-puppet.js');
  const {coachPuppetUrl}=await import('./lib/coach-portraits.js');
  const {COACH_ANIMATION_LABELS:labels}=await import('./lib/coach-repertoire.js');
  const {resolveCoachWingPose,coachWingGrip}=await import('./lib/coach-wing-kinematics.js');
  const {resolveEvilPitchforkPose,coachPitchforkTransform}=await import('./lib/coach-pitchfork.js');
  const canvas=(w=1254,h=1254)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const visible=canvas(),behind=canvas(),front=visible.getContext('2d',{willReadFrequently:true}),back=behind.getContext('2d',{willReadFrequently:true}),results=[],sourceAnchors=[];
  const world=(point,pose)=>{const x=point[0]-626,y=point[1]-1150,a=pose.tilt||0;return[x*Math.cos(a)-y*Math.sin(a)+626+(pose.bodyX||0),x*Math.sin(a)+y*Math.cos(a)+1150+(pose.lift||0)];};
  for(const [id,prop,sides]of[['owl','book',['left','right']],['mellow','mug',['left','right']],['paws','pennant',['left']],['scout','magnifier',['right']],['evil',null,['left']]]){
   const image=new Image();image.src=coachPuppetUrl(id);await image.decode();const puppet=createCoachPuppet(image,document,id);
   const noForeground={...puppet,left:{...puppet.left,grip:canvas(puppet.left.width,puppet.left.height)},right:{...puppet.right,grip:canvas(puppet.right.width,puppet.right.height)}};
   if(id!=='evil')for(const side of sides){const anchor=coachWingGrip({},side),part=puppet[side],pixel=part.grip.getContext('2d').getImageData(Math.round(anchor[0]-part.x),Math.round(anchor[1]-part.y),1,1).data;sourceAnchors.push({id,side,alpha:pixel[3]});}
   for(const [kind,byCoach]of Object.entries(labels))for(let take=0;take<byCoach[id].length;take++){
    const frames=[];
    for(let n=0;n<=100;n++){const time=n*durations[kind]/100,raw=coachPoseAt(kind,time,id,take);if(!prop||raw[prop]>.98)frames.push({time,raw});}
    if(!frames.length)continue;
    for(const frame of [frames[Math.floor(frames.length*.3)],frames[Math.floor(frames.length*.7)]]){
     const {raw,time}=frame;let pose=resolveCoachWingPose(raw,id);if(id==='evil')pose=resolveEvilPitchforkPose(pose);
     front.clearRect(0,0,1254,1254);back.clearRect(0,0,1254,1254);drawCoachPuppet(front,puppet,raw);drawCoachPuppet(back,noForeground,raw);
     for(const side of sides){const hold=id==='evil'?coachPitchforkTransform(pose):null,point=world(hold?[hold.x,hold.y]:coachWingGrip(pose,side),pose),x=Math.round(point[0])-10,y=Math.round(point[1])-10,a=front.getImageData(x,y,21,21).data,b=back.getImageData(x,y,21,21).data;let changed=0,covered=0;
      for(let p=0;p<a.length;p+=4){if(a[p+3]>240)covered++;if(Math.max(...[0,1,2].map(c=>Math.abs(a[p+c]-b[p+c])))>16)changed++;}
      results.push({id,kind,take,time,side,grip:pose[side+'Grip'],changed,covered});
     }
    }
   }
  }
  return {sourceAnchors,results};
 });
 await mkdir(join(root,'test-results'),{recursive:true});await writeFile(join(root,'test-results/MeowlChess-prop-grip-results.json'),JSON.stringify(result,null,2));
 for(const anchor of result.sourceAnchors)assert(anchor.alpha>240,`${anchor.id}/${anchor.side}: grip must use opaque painted feathers, not an empty geometric endpoint.`);
 for(const frame of result.results){assert(frame.grip>.95,JSON.stringify(frame)+' has no foreground grip.');assert(frame.changed>=12,JSON.stringify(frame)+' does not visibly cover its held prop.');assert(frame.covered>=150,JSON.stringify(frame)+' has no connected painted grip.');}
 assert(new Set(result.results.map(r=>r.id)).size===5);console.log(JSON.stringify({coaches:5,renderedContacts:result.results.length,minOverlap:Math.min(...result.results.map(r=>r.changed)),sourceAnchorMinimumAlpha:Math.min(...result.sourceAnchors.map(a=>a.alpha))}));
}finally{await browser.close();}
