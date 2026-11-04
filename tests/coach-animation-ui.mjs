import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-animation-test-', bundlePrefix = 'MeowlChess-coach-animation-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const fixtureHtml = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess coach animation</title><link rel="stylesheet" href="coach-motion.css"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#262722;color:#edece4;font:14px system-ui}main{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}figure{margin:0;padding:12px;background:#30322b;border:1px solid #ffffff16;border-radius:14px;text-align:center;max-width:100%}figure img{width:192px;height:192px;object-fit:contain}figcaption{padding:10px 0;font-weight:600}.coach-companion{display:block}</style><main></main><script type="module" src="animation-fixture.js"></script>`;
const fixtureScript = `
import { createCoachMotion } from './lib/coach-motion.js';
import { coachPortraitUrl, coachPuppetUrl } from './lib/coach-portraits.js';
import { createCoachPuppet, drawCoachPuppet, coachPoseAt } from './lib/coach-puppet.js';
const ids = ['meowl','owl','paws','mellow','scout'];
const names = ['Meowl','Professor Meowl','Captain Paws','Mellow Meowl','Scout Meowl'];
const images = [];
let hidden = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
const scheduledFrames = new Set(), nativeRequest = requestAnimationFrame.bind(window), nativeCancel = cancelAnimationFrame.bind(window);
window.requestAnimationFrame = callback => { const id = nativeRequest(time => { scheduledFrames.delete(id); callback(time); }); scheduledFrames.add(id); return id; };
window.cancelAnimationFrame = id => { scheduledFrames.delete(id); nativeCancel(id); };
const motion = createCoachMotion();
for (const [index,id] of ids.entries()) {
  const figure = document.createElement('figure'); figure.className = 'coach-companion';
  const image = new Image(); image.id = id; image.alt = names[index]; image.src = coachPortraitUrl(id);
  const caption = document.createElement('figcaption'); caption.textContent = names[index];
  figure.append(image,caption); document.querySelector('main').append(figure); images.push(image);
}
window.animationFixture = {
  reactAll(options) { return images.map((image,index) => motion.react(image,{ ...options,coachId:ids[index] })); },
  reactFirst(options) { return motion.react(images[0],options); },
  rapidSwitch() { for (let index=0;index<26;index++) { const id=ids[index%ids.length]; images[0].src=coachPortraitUrl(id); motion.react(images[0],{kind:'greeting',coachId:id}); } },
  stop() { motion.stop(); },
  hide(value) { hidden=value;document.dispatchEvent(new Event('visibilitychange')); },
  detach() { motion.setIdle(images[0],{coachId:'meowl'});images[0].closest('figure').remove(); },
  dispose() { motion.dispose(); },
  pendingFrames() { return scheduledFrames.size; },
  async preview() {
    const portraits = await Promise.all(ids.map(async id => { const image = new Image();image.src=coachPuppetUrl(id);await image.decode();return createCoachPuppet(image,document,id); }));
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=500;
    const ctx=canvas.getContext('2d'), chunks=[];
    const stream=canvas.captureStream(30), recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:2000000});
    const complete=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=resolve;});
    const start=performance.now();let peak='';
    recorder.start();
    await new Promise(resolve=>{
      function draw(now) {
        const elapsed=now-start, kind=elapsed<2600?'talk':elapsed<4600?'brilliant':'greeting';
        const time=kind==='talk'?elapsed%1250:kind==='brilliant'?Math.min(1800,elapsed-2600):Math.min(1600,elapsed-4600);
        ctx.fillStyle='#24251f';ctx.fillRect(0,0,1440,500);
        ctx.textAlign='left';ctx.fillStyle='#f3f1e8';ctx.font='600 26px system-ui';ctx.fillText('Meet your Meowl coaches',36,44);
        ctx.fillStyle='#b8baad';ctx.font='15px system-ui';ctx.fillText(kind==='talk'?'A different rhythm for every personality':kind==='brilliant'?'A little celebration for a brilliant move':'Their own way to say hello',36,71);
        ids.forEach((id,index)=>{
          const x=36+index*278;
          ctx.fillStyle='#30322a';ctx.beginPath();ctx.roundRect(x,94,260,375,16);ctx.fill();
          ctx.strokeStyle='#ffffff16';ctx.lineWidth=1;ctx.stroke();
          ctx.save();ctx.translate(x+130-626*.29,416-1170*.29);ctx.scale(.29,.29);drawCoachPuppet(ctx,portraits[index],coachPoseAt(kind,time,id));ctx.restore();
          ctx.fillStyle='#f3f1e8';ctx.font='600 16px system-ui';ctx.textAlign='center';ctx.fillText(names[index],x+130,445);
        });
        if(kind==='brilliant'&&time>450&&time<650&&!peak)peak=canvas.toDataURL('image/png').split(',')[1];
        if(elapsed<6200)nativeRequest(draw);else resolve();
      }
      nativeRequest(draw);
    });
    recorder.stop();await complete;stream.getTracks().forEach(track=>track.stop());
    const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());
    let binary='';for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
    return {video:btoa(binary),peak};
  },
};
window.fixtureReady = true;
`;
let context, page, stage = 'launch';
const errors = [], external = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'animation-fixture.html'), fixtureHtml);
  await writeFile(join(extension, 'animation-fixture.js'), fixtureScript);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1200, height: 330 }, reducedMotion: 'no-preference',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(6000);
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/animation-fixture.html`);
  await page.waitForFunction(() => window.fixtureReady && [...document.querySelectorAll('figure img')].every(image => image.complete && image.naturalWidth === 1254));
  stage = 'recording the animation preview';
  const preview = await page.evaluate(() => window.animationFixture.preview());
  await mkdir(join(root,'test-results'),{recursive:true});
  await writeFile(join(root,'test-results/MeowlChess-coach-animations.webm'),Buffer.from(preview.video,'base64'));
  if(preview.peak)await writeFile(join(root,'test-results/MeowlChess-coach-animation-peak.png'),Buffer.from(preview.peak,'base64'));
  const reactAll = options => page.evaluate(options => window.animationFixture.reactAll(options), options);
  const stopped = async () => {
    await page.waitForFunction(() => !document.querySelector('.coach-actor[data-reaction],.coach-reaction-puppet') && window.animationFixture.pendingFrames() === 0);
    assert.equal(await page.locator('.coach-reaction-badge,.coach-reaction-stars,.coach-reaction-thought,.coach-reaction-ring,.coach-reaction-bubble').count(), 0, 'Finished reactions leave no decorations.');
  };
  const moving = async (count = 5) => {
    await page.waitForFunction(expected => document.querySelectorAll('.coach-reaction-puppet').length === expected, count);
    await page.evaluate(() => {
      window.frameSamples = [...document.querySelectorAll('.coach-reaction-puppet')].map(canvas => ({
        canvas, pixels: canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,
      }));
    });
    await page.waitForFunction(() => window.frameSamples.every(({canvas,pixels}) => {
      if (!canvas.isConnected) return false;
      const next = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let changed = 0;
      for (let index=0;index<next.length;index+=4) if (Math.abs(next[index]-pixels[index])+Math.abs(next[index+1]-pixels[index+1])+Math.abs(next[index+2]-pixels[index+2])+Math.abs(next[index+3]-pixels[index+3])>30) changed++;
      return changed > 15;
    }), null, { timeout: 1500 });
    await page.evaluate(() => { delete window.frameSamples; });
  };

  stage = 'extended talking paints real frames and finishes';
  assert((await reactAll({ kind:'talk',durationMs:2600 })).every(Boolean));
  await moving();
  await delay(1400);
  assert.equal(await page.locator('.coach-actor[data-reaction="talk"]').count(), 5, 'Long replies keep talking beyond the original 1.25 second burst.');
  await stopped();

  stage = 'new reactions render and clean up for every coach';
  for (const kind of ['think','approve','encourage']) {
    assert((await reactAll({ kind,grade:kind==='approve'?'Excellent':kind==='encourage'?'Mistake':undefined })).every(Boolean), `${kind} is supported.`);
    await moving();
    await stopped();
  }

  stage = 'rapid replacement never paints a stale coach or stacked canvas';
  await page.evaluate(() => window.animationFixture.rapidSwitch());
  await moving(1);
  assert.equal(await page.locator('.coach-actor[data-reaction]').count(), 1);
  assert.equal(await page.locator('.coach-actor[data-reaction]').getAttribute('data-coach'), 'meowl');
  await delay(150);
  assert.equal(await page.locator('.coach-reaction-puppet').count(), 1);
  await page.evaluate(() => window.animationFixture.stop()); await stopped();

  stage = 'hiding immediately cancels rendering and rejects new reactions';
  await reactAll({kind:'brilliant',grade:'Brilliant'}); await moving();
  await page.evaluate(() => window.animationFixture.hide(true)); await stopped();
  assert((await reactAll({kind:'greeting'})).every(value=>value===false));
  await page.evaluate(() => window.animationFixture.hide(false));

  stage = 'reduced motion changes during speech retain visible still portraits';
  await reactAll({kind:'talk',durationMs:5000}); await moving();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => !document.querySelector('.coach-reaction-puppet') && document.querySelectorAll('.coach-actor[data-reduced-motion]').length===5);
  assert.equal(await page.locator('.coach-actor[data-reduced-motion]').count(), 5);
  assert(await page.locator('.coach-actor>img').evaluateAll(images=>images.every(image=>getComputedStyle(image).visibility==='visible')));
  assert.equal(await page.evaluate(()=>window.animationFixture.pendingFrames()),0);
  await reactAll({kind:'brilliant',grade:'Brilliant'});
  assert.equal(await page.locator('.coach-reaction-puppet').count(),0);
  assert(await page.locator('.coach-reaction-badge').evaluateAll(badges=>badges.length===5&&badges.every(badge=>getComputedStyle(badge).animationName==='none')));
  await page.evaluate(() => window.animationFixture.stop()); await stopped();
  await page.emulateMedia({reducedMotion:'no-preference'});

  stage = 'mobile rendering stays within the viewport';
  await page.setViewportSize({width:320,height:700});
  await reactAll({kind:'great',grade:'Great'}); await moving();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert(await page.locator('figure').evaluateAll(figures=>figures.every(figure=>{const box=figure.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;})));
  await page.evaluate(() => window.animationFixture.stop()); await stopped();

  stage = 'detachment and disposal cancel pending loads and animation frames';
  await page.evaluate(() => { window.animationFixture.reactFirst({kind:'talk',durationMs:5000});window.animationFixture.detach(); });
  await stopped();
  await page.evaluate(() => { window.animationFixture.reactAll({kind:'brilliant',grade:'Brilliant'});window.animationFixture.dispose(); });
  await stopped(); await delay(100);
  assert.equal(await page.locator('.coach-reaction-puppet').count(),0);
  assert((await reactAll({kind:'greeting'})).every(value=>value===false));
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  console.log('Coach motion remains finite through extended replies, profile changes, hidden tabs, reduced motion, mobile, detachment, and disposal.');
} catch (error) {
  await mkdir(join(root,'test-results'),{recursive:true});
  if (page) await page.screenshot({path:join(root,'test-results/MeowlChess-coach-animation-failure.png'),fullPage:true}).catch(()=>{});
  throw new Error(`Coach animation stage: ${stage}`, {cause:error});
} finally {
  await closeTestContext(context,profile,profilePrefix);
  if (dirname(bundle)===temporaryRoot&&basename(bundle).startsWith(bundlePrefix)) await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
