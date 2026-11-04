import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root=resolve(import.meta.dirname,'..'),prefix='MeowlChess-garments-test-',profile=await mkdtemp(join(tmpdir(),prefix));
let context;
try {
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--mute-audio']});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='meowlchess.test')return route.abort();
    if(url.pathname==='/coach-garment-art.js')return route.fulfill({body:await readFile(join(root,'extension/lib/coach-garment-art.js')),contentType:'text/javascript'});
    if(/^\/icons\/coaches\/MeowlChess-coach-(owl|paws|mellow|scout|evil)-base\.svg$/.test(url.pathname))return route.fulfill({body:await readFile(join(root,'extension',url.pathname)),contentType:'image/svg+xml'});
    return route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'});
  });
  const page=await context.newPage();await page.goto('http://meowlchess.test/');
  const results=await page.evaluate(async()=>{
    const {COACH_GARMENT_SVG,drawCoachGarment}=await import('/coach-garment-art.js');
    const results=[];
    for(const [id,art]of Object.entries(COACH_GARMENT_SVG)){
      const source=document.createElement('canvas'),extended=document.createElement('canvas');
      source.width=extended.width=1254;source.height=extended.height=1254;
      const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254">${art}</svg>`);await image.decode();
      const ctx=source.getContext('2d'),out=extended.getContext('2d');ctx.drawImage(image,0,0);drawCoachGarment(out,id);
      const a=ctx.getImageData(0,0,1254,1254).data,b=out.getImageData(0,0,1254,1254).data;
      let centralDifferences=0,addedFabric=0;
      for(let y=560;y<1000;y++)for(let x=420;x<840;x++){
        const p=(y*1254+x)*4;
        if(x>=540&&x<720&&y>=650&&y<890){let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(a[p+c]-b[p+c]));if(delta>18)centralDifferences++;}
        if(a[p+3]<20&&b[p+3]>230)addedFabric++;
      }
      let wingDifferences=0,comparedWingPixels=0;
      if(id!=='meowl'){
        const svg=await(await fetch(`/icons/coaches/MeowlChess-coach-${id}-base.svg`)).text();
        const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),element=doc.documentElement;
        for(const child of Array.from(element.children))if(child.tagName!=='defs')child.remove();
        const use=doc.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#original-coach');element.append(use);
        const previous=new Image(),current=new Image();previous.src='data:image/svg+xml,'+encodeURIComponent(new XMLSerializer().serializeToString(doc));current.src='data:image/svg+xml,'+encodeURIComponent(svg);await Promise.all([previous.decode(),current.decode()]);
        ctx.clearRect(0,0,1254,1254);ctx.drawImage(previous,0,0);out.clearRect(0,0,1254,1254);out.drawImage(current,0,0);
        const originalPixels=ctx.getImageData(0,0,1254,1254).data,currentPixels=out.getImageData(0,0,1254,1254).data;
        const mask=document.createElement('canvas');mask.width=mask.height=1254;const mc=mask.getContext('2d');
        for(const node of doc.querySelectorAll('#painted-wings path'))mc.fill(new Path2D(node.getAttribute('d')));
        const painted=mc.getImageData(0,0,1254,1254).data;
        for(let y=580;y<970;y++)for(let x=350;x<915;x++){
          const p=(y*1254+x)*4;
          if(painted[p+3]<255||originalPixels[p+3]<250)continue;
          // Exclude the one-pixel antialiased mask edge, retaining original ink.
          if([p-8,p+8,p-1254*8,p+1254*8].some(n=>painted[n+3]<255))continue;
          comparedWingPixels++;let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(originalPixels[p+c]-currentPixels[p+c]));if(delta>8)wingDifferences++;
        }
      }
      results.push({id,centralDifferences,addedFabric,wingDifferences,comparedWingPixels});
    }
    return results;
  });
  console.log(JSON.stringify(results,null,2));
  for(const result of results){
    assert(result.centralDifferences<100,`${result.id}: original front details changed (${result.centralDifferences} pixels)`);
    if(result.id==='meowl')assert.equal(result.addedFabric,0);
    else {
      assert(result.addedFabric>12000,`${result.id}: fabric must extend behind both wings`);
      assert(result.comparedWingPixels>30000,`${result.id}: preserved wing sample must include both painted wings`);
      assert.equal(result.wingDifferences,0,`${result.id}: original painted wing ink must stay unchanged`);
    }
  }
} finally { await closeTestContext(context,profile,prefix); }
