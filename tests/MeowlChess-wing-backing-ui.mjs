import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const extension = process.env.MEOWLCHESS_ART_SOURCE || join(root, 'extension');
const prefix = 'MeowlChess-wing-backing-';
const profile = await mkdtemp(join(tmpdir(), prefix));
const baseline = process.argv.includes('--baseline');
const frames = process.argv.includes('--frames');
const output = join(root, 'test-results', 'MeowlChess-wing-backing');
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1560, height: 1320 }, args: ['--mute-audio'],
  });
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://meowlchess-wing.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>MeowlChess wing backing</title><style>body{margin:0;background:#202320}canvas{display:block}</style>' });
    const file = resolve(extension, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(resolve(extension) + sep)) return route.abort();
    try { return await route.fulfill({ body: await readFile(file), contentType: { '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(file)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://meowlchess-wing.test/');
  const result = await page.evaluate(async () => {
    const { createCoachPuppet, drawCoachPuppet, coachPoseAt, COACH_REACTION_DURATIONS: durations } = await import('/lib/coach-puppet.js');
    const { coachPuppetUrl } = await import('/lib/coach-portraits.js');
    const ids = ['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil'];
    const puppets = [], images = [];
    const canvas = (width = 1254, height = width) => { const value = document.createElement('canvas'); value.width = width; value.height = height; return value; };
    for (const id of ids) {
      const image = new Image(); image.src = coachPuppetUrl(id); await image.decode(); images.push(image);
      puppets.push(createCoachPuppet(image, document, id));
    }
    const paint = (index, pose = {}, bodyOnly = false) => {
      const value = canvas(), ctx = value.getContext('2d', { willReadFrequently: true });
      if (bodyOnly) { const part = puppets[index].rigid.body; ctx.drawImage(part.canvas, part.x, part.y); }
      else drawCoachPuppet(ctx, puppets[index], pose);
      return value;
    };
    // Probe the anatomical interior, not the moving wing or its clipping mask.
    const ranges = [[620,470,790],[660,458,805],[700,458,807],[740,460,807],[780,465,805],[820,470,800],[860,480,792],[900,494,780],[940,515,758]];
    function holes(value, pose = {}) {
      const pixels = value.getContext('2d').getImageData(0, 0, 1254, 1254).data, bad = [];
      const angle = pose.tilt || 0;
      for (const [y,left,right] of ranges) for (let x=left; x<=right; x+=4) {
        const dx=x-626,dy=y-1150;
        const px=Math.round(626+dx*Math.cos(angle)-dy*Math.sin(angle)+(pose.bodyX||0));
        const py=Math.round(1150+dx*Math.sin(angle)+dy*Math.cos(angle)+(pose.lift||0));
        const alpha=pixels[(py*1254+px)*4+3]; if(alpha<245) bad.push({x,y,alpha});
      }
      return bad;
    }
    const checks=[];
    for(let index=0;index<ids.length;index++) {
      checks.push({id:ids[index],pose:'body only',holes:holes(paint(index,{},true))});
      for(const [name,pose] of [['raised',{leftWing:1.25,rightWing:1.25}],['left fold',{leftWing:.18,leftElbow:1.6,rightWing:.7}],['right fold',{rightWing:.18,rightElbow:1.6,leftWing:.7}]]) checks.push({id:ids[index],pose:name,holes:holes(paint(index,pose),pose)});
      for(const kind of ['greeting','brilliant','great','signature']) for(let variation=0;variation<3;variation++) for(const fraction of [.2,.4,.6,.8]) {
        const pose=coachPoseAt(kind,durations[kind]*fraction,ids[index],variation);
        checks.push({id:ids[index],pose:`${kind} ${variation} ${fraction}`,holes:holes(paint(index,pose),pose)});
      }
    }
    // A bare torso must have recognisable feather ink, not just many nearly
    // identical tan pixels. These flank interiors are exposed by a raised wing.
    const body=paint(0,{},true).getContext('2d').getImageData(0,0,1254,1254).data;
    const feathers=[];
    for(const [side,left,right] of [['left',462,492],['right',768,802]]) for(const [top,bottom] of [[650,720],[730,800],[810,880]]) {
      let ink=0,opaque=0,low=255,high=0;
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++) {
        const i=(y*1254+x)*4;if(body[i+3]<245)continue;
        const light=body[i]*.2126+body[i+1]*.7152+body[i+2]*.0722;
        opaque++;if(light<115)ink++;low=Math.min(low,light);high=Math.max(high,light);
      }
      feathers.push({side,top,ink,opaque,contrast:high-low});
    }
    // Clothing must cover the full flank above its hem, including the outer
    // strip missed by the old narrow coat. Folds may shade the fabric, but its
    // hue must still match the costume: gold and charcoal fur are also opaque.
    const shirtColors={owl:[101,125,145],paws:[63,76,101],mellow:[157,137,159],scout:[115,133,104],evil:[133,45,58]};
    const shirtPoints=[['left',455,740],['left',460,810],['left',467,875],['left',472,900],['right',823,780],['right',825,830],['right',825,875],['right',823,900]];
    const shirts=[];
    for(let index=1;index<ids.length;index++) {
      const pixels=paint(index,{},true).getContext('2d').getImageData(0,0,1254,1254).data;
      const expected=shirtColors[ids[index]];
      for(const [side,x,y]of shirtPoints) {
        let mismatch=0,maxDifference=0;
        for(let py=y-2;py<=y+2;py++)for(let px=x-2;px<=x+2;px++) {
          const at=(py*1254+px)*4,actual=[...pixels.subarray(at,at+3)];
          const shade=actual.reduce((sum,value,c)=>sum+value*expected[c],0)/expected.reduce((sum,value)=>sum+value*value,0);
          const difference=Math.max(...expected.map((value,c)=>Math.abs(value*shade-actual[c])));
          const sameHue=expected.every((value,c)=>expected.every((other,d)=>Math.abs(value-other)<12||Math.sign(value-other)*(actual[c]-actual[d])>=Math.abs(value-other)*.45));
          maxDifference=Math.max(maxDifference,difference);
          if(pixels[at+3]<245||shade<.68||shade>1.2||difference>10||!sameHue)mismatch++;
        }
        shirts.push({id:ids[index],side,x,y,mismatch,maxDifference});
      }
    }
    // The torso and intact thighs should meet in one continuous silhouette.
    // A large one-row jump catches the old rectangular wing-cut notch.
    const contours=[];
    for(let index=0;index<ids.length;index++) {
      const pixels=paint(index,{},true).getContext('2d').getImageData(0,0,1254,1254).data;
      for(const side of ['left','right']) {
        const edges=[];
        for(let y=900;y<=1030;y++) {
          let x=side==='left'?360:900;const step=side==='left'?1:-1;
          while(x>350&&x<915&&pixels[(y*1254+x)*4+3]<245)x+=step;
          edges.push(x);
        }
        const jumps=edges.slice(1).map((x,i)=>Math.abs(x-edges[i]));
        const outward=edges.map(x=>side==='right'?x:-x);let narrow=outward[0],notch=0;
        for(const x of outward){narrow=Math.min(narrow,x);notch=Math.max(notch,x-narrow);}
        contours.push({id:ids[index],side,maxRowJump:Math.max(...jumps),atY:901+jumps.indexOf(Math.max(...jumps)),outwardNotch:notch});
      }
    }
    const resting=[];
    for(let index=0;index<5;index++) {
      const reference=canvas(),rc=reference.getContext('2d');rc.drawImage(images[index],0,0);
      const original=rc.getImageData(0,0,1254,1254).data;
      const rendered=paint(index).getContext('2d').getImageData(0,0,1254,1254).data;
      let differences=0;
      for(let y=580;y<1035;y++)for(let x=350;x<915;x++) {const at=(y*1254+x)*4;if([0,1,2,3].some(c=>Math.abs(original[at+c]-rendered[at+c])>8))differences++;}
      resting.push({id:ids[index],differences});
    }
    const sheet=canvas(1560,1320),ctx=sheet.getContext('2d');
    ctx.fillStyle='#202320';ctx.fillRect(0,0,sheet.width,sheet.height);
    for(let index=0;index<6;index++) {
      const x=index*260;
      ctx.fillStyle='#efeee7';ctx.font='600 18px Arial';ctx.fillText(ids[index],x+16,28);
      ctx.font='13px Arial';ctx.fillStyle='#aba99e';ctx.fillText('Raised wings',x+16,51);
      ctx.drawImage(paint(index,{leftWing:1.25,rightWing:1.25}),280,60,720,1160,x+5,60,250,403);
      ctx.fillText('Body beneath the wings',x+16,489);
      ctx.drawImage(paint(index,{},true),420,530,420,580,x+25,505,210,290);
      ctx.fillText('Signature gesture',x+16,830);
      ctx.drawImage(paint(index,coachPoseAt('signature',durations.signature*.45,ids[index],0)),280,60,720,1160,x+5,847,250,403);
    }
    document.body.append(sheet);
    const motion=canvas(900,900),mc=motion.getContext('2d');
    const names=['Meowl','Professor Meowl','Captain Paws','Mellow Meowl','Scout Meowl','Evil Meowl'];
    window.previewFrame = frame => {
      mc.fillStyle='#202320';mc.fillRect(0,0,900,900);
      const time=frame/15,segment=time<2.4?'greeting':'signature';
      const progress=segment==='greeting'?time/2.4:(time-2.4)/3.2;
      for(let index=0;index<6;index++) {
        const x=(index%3)*300,y=Math.floor(index/3)*450;
        mc.fillStyle='#eeede6';mc.font='600 16px Arial';mc.fillText(names[index],x+18,y+25);
        const pose=coachPoseAt(segment,durations[segment]*Math.min(1,progress),ids[index],0);
        mc.drawImage(paint(index,pose),180,60,900,1160,x,y+43,300,387);
      }
      return motion.toDataURL('image/png').split(',')[1];
    };
    return {checks,feathers,shirts,contours,resting};
  });
  await mkdir(output,{recursive:true});
  const tag=baseline?'before':'after';
  await page.screenshot({path:join(output,`MeowlChess-wing-backing-${tag}.png`)});
  await writeFile(join(output,`MeowlChess-wing-backing-${tag}.json`),JSON.stringify(result,null,2));
  if(frames) {
    const frameDirectory=join(output,`${tag}-frames`);await mkdir(frameDirectory,{recursive:true});
    for(let frame=0;frame<84;frame++)await writeFile(join(frameDirectory,`MeowlChess-frame-${String(frame).padStart(3,'0')}.png`),Buffer.from(await page.evaluate(frame=>window.previewFrame(frame),frame),'base64'));
  }
  console.log(JSON.stringify({cases:result.checks.length,holes:result.checks.filter(x=>x.holes.length),feathers:result.feathers,shirts:result.shirts,contours:result.contours,resting:result.resting}));
  if(!baseline) {
    for(const check of result.checks)assert.equal(check.holes.length,0,`${check.id} ${check.pose} exposes missing body pixels`);
    for(const side of ['left','right']) {
      const samples=result.feathers.filter(item=>item.side===side);
      assert(samples.filter(item=>item.ink>=30&&item.contrast>50).length>=2,`${side} flank needs visible feather markings across its height, not a flat fill`);
      for(const sample of samples)assert(sample.ink/sample.opaque<.45,`${side} flank at y=${sample.top} is overpainted with dark ink instead of separate feather markings`);
    }
    for(const check of result.resting)assert.equal(check.differences,0,`${check.id} resting torso must keep the approved illustration`);
    for(const check of result.shirts)assert.equal(check.mismatch,0,`${check.id} ${check.side} flank at ${check.x},${check.y} must show shirt material under the lifted wing`);
    for(const check of result.contours) {
      assert(check.maxRowJump<14,`${check.id} ${check.side} hip has a sharp cut-out step at y=${check.atY}`);
      assert(check.outwardNotch<=6,`${check.id} ${check.side} hip narrows then abruptly widens beneath the wing cut`);
    }
  }
  assert.deepEqual(errors,[]);
} finally { await closeTestContext(context,profile,prefix); }
