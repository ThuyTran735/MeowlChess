import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-portraits-test-', bundlePrefix = 'MeowlChess-coach-portraits-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
let context;
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'portraits-fixture.html'), `<!doctype html><meta charset="utf-8"><title>MeowlChess coach outfits</title><link rel="stylesheet" href="coach-motion.css"><style>body{margin:0;padding:30px;background:#262722;color:#edece4;font:14px system-ui}main{display:flex;justify-content:center;gap:18px}figure{margin:0;text-align:center;min-width:0;background:#30322b;border:1px solid #ffffff16;border-radius:16px;padding:12px}img{width:220px;height:220px;object-fit:contain}figcaption{padding:12px;font-weight:600}.coach-companion{display:block}</style><main></main><script type="module" src="portraits-fixture.js"></script>`);
  await writeFile(join(extension, 'portraits-fixture.js'), `import {coachPortraitUrl} from './lib/coach-portraits.js';import {createCoachMotion} from './lib/coach-motion.js';const motion=createCoachMotion();for(const [id,name] of [['meowl','Meowl'],['owl','Professor Meowl'],['paws','Captain Paws'],['mellow','Mellow Meowl'],['scout','Scout Meowl']]){const figure=document.createElement('figure');figure.className='coach-companion';const img=new Image();img.id=id;img.src=coachPortraitUrl(id);img.alt=name;const caption=document.createElement('figcaption');caption.textContent=name;figure.append(img,caption);document.querySelector('main').append(figure);}window.react=()=>{for(const img of document.querySelectorAll('figure>img,figure>.coach-actor>img'))motion.react(img,{kind:'celebrate',grade:'Great',coachId:img.id});};window.stop=()=>motion.stop();`);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1440, height: 380 }, reducedMotion: 'no-preference',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [];
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/portraits-fixture.html`);
  await page.waitForFunction(() => [...document.images].length === 5 && [...document.images].every(image => image.complete && image.naturalWidth === 1254));
  assert(await page.locator('#meowl').evaluate(image => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1254;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return [[610,145],[630,185],[670,175]].every(([x,y]) => ctx.getImageData(x,y,1,1).data[3] === 0);
  }), 'The regular Meowl has no visible crown above its forehead.');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results/MeowlChess-coach-outfits.png'), fullPage: true });
  await page.evaluate(() => window.react());
  await page.waitForFunction(() => document.querySelectorAll('.coach-reaction-puppet').length === 5);
  assert(await page.evaluate(() => [...document.querySelectorAll('.coach-reaction-puppet')].every(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  })), 'All outfits render safely into animated canvases under extension CSP.');
  await page.screenshot({ path: join(root, 'test-results/MeowlChess-coach-outfits-animated.png'), fullPage: true });
  await page.evaluate(() => window.stop());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.react());
  assert.equal(await page.locator('.coach-reaction-puppet').count(), 0);
  assert.equal(await page.locator('.coach-actor[data-reduced-motion]').count(), 5);
  assert.deepEqual(errors, []);
  console.log('Distinct coach outfits render as static images and animated canvases; reduced motion retains static portraits.');
} finally {
  await closeTestContext(context, profile, profilePrefix);
  if (dirname(bundle) === temporaryRoot && basename(bundle).startsWith(bundlePrefix)) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
