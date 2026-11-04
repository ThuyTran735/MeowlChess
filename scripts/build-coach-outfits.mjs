import { readFile, writeFile, mkdtemp, access } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { COACH_GLASSES_SVG } from '../extension/lib/coach-accessories.js';
import { COACH_GARMENT_SVG as outfits, coachGarmentSvg } from '../extension/lib/coach-garment-art.js';
import { coachFaceSvg } from '../extension/lib/coach-face-art.js';
import { DEVIL_HORNS_SVG, evilFurColor } from '../extension/lib/coach-devil-appearance.js';
import { inflateSync, deflateSync } from 'node:zlib';

// The approved PNG supplies fur and feather texture. Remove only the connected
// original eye/mouth ink, reconstructing it from neighbouring fur. This is a
// build step, never per-frame work and never a large oval painted over the face.
function cleanFeature(data, imageWidth, box) {
  const {x,y,width,height}=box, source=new Uint8ClampedArray(width*height*4);
  for(let py=0;py<height;py++)for(let px=0;px<width;px++)source.set(data.subarray(((y+py)*imageWidth+x+px)*4,((y+py)*imageWidth+x+px)*4+4),(py*width+px)*4);
  const mask=new Uint8Array(width*height);
  for(let py=3;py<height-3;py++)for(let px=3;px<width-3;px++){
    const i=py*width+px,p=i*4;
    if(source[p]<box.threshold[0]&&source[p+1]<box.threshold[1]&&source[p+2]<box.threshold[2])mask[i]=1;
  }
  // Fill enclosed catchlights, then cover the anti-aliased painted edges.
  const outside=new Uint8Array(mask.length),queue=[];
  for(let i=0;i<mask.length;i++)if(!mask[i]&&(i<width||i>=mask.length-width||i%width===0||i%width===width-1)){outside[i]=1;queue.push(i);}
  for(let at=0;at<queue.length;at++){const i=queue[at],px=i%width,py=Math.floor(i/width);for(const[nx,ny]of[[px-1,py],[px+1,py],[px,py-1],[px,py+1]]){if(nx<0||nx>=width||ny<0||ny>=height)continue;const n=ny*width+nx;if(!mask[n]&&!outside[n]){outside[n]=1;queue.push(n);}}}
  const cover=new Uint8Array(mask.length),r=box.radius;
  for(let i=0;i<mask.length;i++)if(mask[i]||!outside[i]){const px=i%width,py=Math.floor(i/width);for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const nx=px+dx,ny=py+dy;if(dx*dx+dy*dy<=r*r&&nx>0&&nx<width-1&&ny>0&&ny<height-1)cover[ny*width+nx]=1;}}
  const clean=new Float64Array(source),interior=[];
  for(let px=0;px<width;px++){
    let first=height,last=-1;for(let py=0;py<height;py++)if(cover[py*width+px]){first=Math.min(first,py);last=Math.max(last,py);}
    if(last<0)continue;const top=Math.max(0,first-1),bottom=Math.min(height-1,last+1);
    for(let py=first;py<=last;py++)if(cover[py*width+px]){const p=(py*width+px)*4,t=(py-top)/(bottom-top);interior.push(p);for(let c=0;c<3;c++)clean[p+c]=source[(top*width+px)*4+c]*(1-t)+source[(bottom*width+px)*4+c]*t;}
  }
  for(let pass=0;pass<450;pass++)for(const p of interior)for(let c=0;c<3;c++)clean[p+c]=(clean[p-4+c]+clean[p+4+c]+clean[p-width*4+c]+clean[p+width*4+c])*.25;
  for(const p of interior){const i=p/4,py=Math.floor(i/width),px=i%width,target=((y+py)*imageWidth+x+px)*4;for(let c=0;c<3;c++)data[target+c]=Math.round(clean[p+c]);}
}
function prepareCoachPng(png,{cleanFace=false,charcoal=false}={}){
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  if(png[24]!==8||png[25]!==6||png[28]!==0)throw new Error('Coach source must be an 8-bit RGBA non-interlaced PNG.');
  const chunks=[];for(let at=8;at<png.length;){const length=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8);if(type==='IDAT')chunks.push(png.subarray(at+8,at+8+length));at+=length+12;}
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*4,data=Buffer.alloc(width*height*4);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=4?data[i-4]:0,b=y?data[i-stride]:0,c=y&&x>=4?data[i-stride-4]:0;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):NaN;if(!Number.isFinite(predictor))throw new Error('Invalid PNG filter.');data[i]=(raw[y*(stride+1)+x+1]+predictor)&255;}}
  if(cleanFace){
    cleanFeature(data,width,{x:480,y:299,width:101,height:96,threshold:[115,100,85],radius:4});
    cleanFeature(data,width,{x:651,y:300,width:106,height:97,threshold:[115,100,85],radius:4});
    cleanFeature(data,width,{x:575,y:431,width:62,height:45,threshold:[155,125,95],radius:2});
  }
  if(charcoal)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(y*width+x)*4;if(!data[p+3])continue;
    const [red,green,blue]=data.subarray(p,p+3);
    const pinkNose=x>=578&&x<=634&&y>=405&&y<=434&&red>150&&red-green>15;
    const color=pinkNose?[Math.round(red*.82+15),Math.round(green*.85+8),Math.round(blue*.93+12)]:evilFurColor(red,green,blue);
    for(let c=0;c<3;c++)data[p+c]=color[c];
  }
  const rows=Buffer.alloc(height*(stride+1));for(let y=0;y<height;y++)data.copy(rows,y*(stride+1)+1,y*stride,(y+1)*stride);
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const chunk=(type,bytes)=>{const name=Buffer.from(type),result=Buffer.alloc(bytes.length+12);result.writeUInt32BE(bytes.length);name.copy(result,4);bytes.copy(result,8);let crc=0xffffffff;for(const byte of Buffer.concat([name,bytes]))crc=crcTable[(crc^byte)&255]^(crc>>>8);result.writeUInt32BE((crc^0xffffffff)>>>0,bytes.length+8);return result;};
  return Buffer.concat([png.subarray(0,8),chunk('IHDR',png.subarray(16,29)),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}

// Keep the approved fur and feather drawing aligned with the animation rig.
// Costumes and individual expressions are editable SVG layers. The plain head
// comes from the uncrowned Professor; no crown is in the visible composition.
const directory = resolve(import.meta.dirname, '../extension/icons/coaches');
const sources=Object.fromEntries(await Promise.all(['meowl','owl','paws'].map(async id=>[id,await readFile(resolve(directory,`MeowlChess-coach-${id}.png`))])));
const drawings=Object.fromEntries(Object.entries(sources).map(([id,source])=>[id,(id==='meowl'?prepareCoachPng(source,{cleanFace:true}):source).toString('base64')]));
const devilBody=prepareCoachPng(sources.meowl,{cleanFace:true,charcoal:true}).toString('base64');
const devilHead=prepareCoachPng(sources.owl,{charcoal:true}).toString('base64');
const commonDefs = (body=drawings.meowl,head=drawings.owl)=>`<defs>
  <image id="body" width="1254" height="1254" href="data:image/png;base64,${body}"/>
  <image id="professor" width="1254" height="1254" href="data:image/png;base64,${head}"/>
  <clipPath id="upper-head"><rect width="1254" height="282"/></clipPath>
  <!-- The matching forehead fur continues under the upper image. Adjacent
       clip edges otherwise both anti-alias at small sizes, leaving a dark seam.
       This overlap is below the old crown and above the original glasses. -->
  <clipPath id="lower-body"><rect y="250" width="1254" height="1004"/></clipPath>
  <clipPath id="glasses"><rect x="410" y="282" width="405" height="133"/></clipPath>
</defs>`;
const plain = '<use href="#body" clip-path="url(#lower-body)"/><use href="#professor" clip-path="url(#upper-head)"/>';
const leftWing = 'M350 580 L468 580 L488 648 L501 743 L500 840 L477 929 L467 958 L419 961 L350 880 Z';
const rightWing = 'M777 578 L903 578 L912 918 L844 969 L819 953 L783 906 L759 836 L753 741 L761 668 Z';
const collarWing = 'M791 578 L903 578 L912 918 L844 969 L819 953 L783 906 L759 836 L753 741 L781 693 Q783 700 794 672 C802 650 798 606 791 578 Z';

// Keep the original illustrated SVG portraits. Only Evil's bent holding pose
// needs the native renderer to share its exact wing joint and prop occlusion.
// Editable bases stay unposed and prop-free. Normal npm build is separate.
async function renderHeldEvilPortrait() {
  const { chromium } = await import('playwright-core');
  const { closeTestContext } = await import('../tests/ui-helpers.mjs');
  const extension=resolve(directory,'../..'),prefix='MeowlChess-coach-art-build-';
  const profile=await mkdtemp(join(tmpdir(),prefix));
  let executablePath=process.env.CHROMIUM_PATH;
  if(!executablePath&&process.platform==='win32'){
    for(const candidate of [
      // Prefer a renderer without per-profile canvas privacy noise when making
      // reproducible build assets. This does not affect the extension runtime.
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    ]){try{await access(candidate);executablePath=candidate;break;}catch{}}
  }
  let context;
  try{
    context=await chromium.launchPersistentContext(profile,{...(executablePath?{executablePath}:{}),headless:true,args:['--mute-audio']});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='http://meowlchess-art.test')return route.abort();
      if(url.pathname==='/')return route.fulfill({body:'<!doctype html><meta charset="utf-8">',contentType:'text/html'});
      const file=resolve(extension,`.${decodeURIComponent(url.pathname)}`);
      if(!file.startsWith(extension+sep))return route.abort();
      try{return await route.fulfill({body:await readFile(file),contentType:{'.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'application/octet-stream'});}catch{return route.abort();}
    });
    const page=await context.newPage();await page.goto('http://meowlchess-art.test/');
    return await page.evaluate(async(ids)=>{
      const {createCoachPuppet,drawCoachPuppet}=await import('/lib/coach-action-renderer.js');
      const result={};
      for(const id of ids){
        const image=new Image();image.src=`/icons/coaches/MeowlChess-coach-${id}-base.svg`;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1254;
        drawCoachPuppet(canvas.getContext('2d'),createCoachPuppet(image,document,id),{});
        result[id]=canvas.toDataURL('image/png');
      }
      return result;
    },['evil']);
  }finally{await closeTestContext(context,profile,prefix);}
}

for (const [id, outfit] of Object.entries(outfits)) {
  const captainHead = id === 'paws' ? `<image width="1254" height="1254" href="data:image/png;base64,${drawings.paws}" clip-path="url(#upper-head)"/>` : '';
  const horns=id==='evil'?DEVIL_HORNS_SVG:'';
  // Expanded cloth belongs beneath the untouched painted wings. Restoring the
  // old complete composition only inside their exact masks preserves every
  // original feather, collar overlap and wing color in the static portrait.
  const original = `${plain}${captainHead}${outfit}${horns}`;
  const wingDefs = outfit ? `<defs><g id="original-coach">${original}</g><clipPath id="painted-wings"><path d="${leftWing}"/><path d="${['owl','mellow'].includes(id)?collarWing:rightWing}"/></clipPath>${id==='evil'?`<clipPath id="painted-left-wing"><path d="${leftWing}"/></clipPath>`:''}</defs>` : '';
  const composition = outfit ? `${wingDefs}${plain}${captainHead}${coachGarmentSvg(id)}${horns}<use href="#original-coach" clip-path="url(#painted-wings)"/>` : original;
  const shell = `<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254"><title>${id === 'meowl' ? 'Meowl, the friendly companion' : `${id} Meowl coach`}</title>${id==='evil'?commonDefs(devilBody,devilHead):commonDefs()}${composition}`;
  await writeFile(resolve(directory, `MeowlChess-coach-${id}-base.svg`), `${shell}</svg>\n`);
  if(id!=='evil')await writeFile(resolve(directory,`MeowlChess-coach-${id}.svg`),`${shell}${coachFaceSvg(id)}${id==='owl'?COACH_GLASSES_SVG:''}</svg>\n`);
}
const {evil:portrait}=await renderHeldEvilPortrait();
await writeFile(resolve(directory,'MeowlChess-coach-evil.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254" data-render-source="coach-action-renderer"><title>Evil Meowl holding a pitchfork</title><desc>The original illustrated Meowl with the shared native wing grip. Editable source: MeowlChess-coach-evil-base.svg.</desc><image width="1254" height="1254" href="${portrait}"/></svg>\n`);
