import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-transition-test-', bundlePrefix = 'MeowlChess-coach-transition-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix)), bundle = await mkdtemp(join(temporaryRoot, bundlePrefix));
const extension = join(bundle, 'extension'), errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, page, stage = 'launch';
const fixture = `<!doctype html><link rel="stylesheet" href="coach-motion.css"><style>body{background:#282922}img{width:230px;height:230px}.coach-actor{margin:30px}</style><img id="one"><img id="two"><script type="module" src="transition-fixture.js"></script>`;
const script = `
import {createCoachMotion} from './lib/coach-motion-probe.js';
import {coachPortraitUrl} from './lib/coach-portraits.js';
const images=[document.querySelector('#one'),document.querySelector('#two')];
for(const image of images){image.src=coachPortraitUrl('meowl');await image.decode();}
const pending=new Set(),request=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);
window.requestAnimationFrame=callback=>{const id=request(time=>{pending.delete(id);callback(time)});pending.add(id);return id};
window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id)};
let hidden=false;
Object.defineProperty(document,'visibilityState',{get:()=>hidden?'hidden':'visible'});
const motion=createCoachMotion();
window.frames=[];
window.transitionFixture={
 react(options,index=0){return motion.react(images[index],options)},
 stop(options){motion.stop(options)},
 hide(value){hidden=value;document.dispatchEvent(new Event('visibilitychange'))},
 switchCoach(coachId){images[0].src=coachPortraitUrl(coachId);return motion.react(images[0],{kind:'greeting',coachId})},
 pending(){return pending.size},dispose(){motion.dispose()},
 snapshot(){const actor=images[0].parentElement;return{reaction:actor.dataset.reaction,transition:actor.dataset.transition,sprites:document.querySelectorAll('canvas').length,pending:pending.size}},
};window.fixtureReady=true;
`;
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const runtime = await readFile(join(extension, 'lib/coach-motion.js'), 'utf8');
  await writeFile(join(extension, 'lib/coach-motion-probe.js'), runtime.replace("from './coach-puppet.js'", "from './coach-puppet-probe.js'"));
  // Record the exact poses sent to the real renderer; drawing and source artwork
  // are unchanged. This catches neutral flashes invisible to endpoint-only tests.
  await writeFile(join(extension, 'lib/coach-puppet-probe.js'), `export {createCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS} from './coach-puppet.js';import {drawCoachPuppet as draw} from './coach-puppet.js';export function drawCoachPuppet(ctx,puppet,pose){window.frames?.push({at:performance.now(),pose:{...pose},canvas:ctx.canvas,coach:puppet.coachId});draw(ctx,puppet,pose);}`);
  await writeFile(join(extension, 'transition-fixture.html'), fixture);
  await writeFile(join(extension, 'transition-fixture.js'), script);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 800, height: 400 }, reducedMotion: 'no-preference',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/transition-fixture.html`, { timeout: 20000 });
  await page.waitForFunction(() => window.fixtureReady);
  const react = options => page.evaluate(options => transitionFixture.react(options), options);
  const stopped = () => page.waitForFunction(() => !document.querySelector('.coach-actor[data-reaction],canvas') && transitionFixture.pending() === 0);

  stage = 'idle-to-talk retains the existing rendered frame';
  await react({ kind: 'idle' });
  await page.waitForFunction(() => {
    const pose = frames.at(-1)?.pose || {};
    return ['headTilt','headNod','lookX','lookY','leftEar','rightEar','leftWing','rightWing','leftStep','rightStep','leftFoot','rightFoot','bodyX','lift','tilt']
      .reduce((sum,key)=>sum+Math.abs(pose[key]||0),0) > .06;
  });
  const entry = await page.evaluate(() => {
    window.originalCanvas = document.querySelector('canvas'); window.before = frames.at(-1); window.start = performance.now();
    transitionFixture.react({ kind: 'talk', durationMs: 2600 });
    return { same: originalCanvas === document.querySelector('canvas'), connected: originalCanvas.isConnected, transition: transitionFixture.snapshot().transition };
  });
  assert.deepEqual(entry, { same: true, connected: true, transition: 'settle' });
  await delay(75);
  assert(await page.evaluate(() => {
    const joints = ['headTilt','headNod','lookX','lookY','leftEar','rightEar','leftWing','rightWing','leftStep','rightStep','leftFoot','rightFoot','bodyX','lift','tilt'];
    const magnitude = pose => joints.reduce((sum,key)=>sum+Math.abs(pose[key]||0),0);
    return frames.at(-1).canvas === originalCanvas && magnitude(frames.at(-1).pose) < magnitude(before.pose);
  }), 'The current rigid pose settles instead of jumping straight to neutral.');
  await page.waitForFunction(() => !transitionFixture.snapshot().transition && transitionFixture.snapshot().reaction === 'talk');
  assert(await page.evaluate(() => document.querySelector('canvas') === originalCanvas));

  stage = 'rapid comments replace pending animation without extending the settle deadline';
  await delay(300);
  await page.evaluate(() => { window.replacementStart=performance.now(); transitionFixture.react({kind:'great',grade:'Great'}); });
  for (const kind of ['approve','curious','encourage']) { await delay(40); await react({kind}); }
  await page.waitForFunction(() => !transitionFixture.snapshot().transition);
  assert(await page.evaluate(() => performance.now()-replacementStart < 310), 'The first interruption owns the180ms settle deadline.');
  assert.equal((await page.evaluate(() => transitionFixture.snapshot())).reaction, 'encourage');
  assert.equal(await page.locator('canvas').count(), 1);

  stage = 'position-change stop settles once then leaves no old response running';
  await delay(300);
  await page.evaluate(() => transitionFixture.stop({settle:true}));
  await stopped();
  assert(await page.evaluate(() => Object.values(frames.at(-1).pose).every(value=>value===0)));
  await delay(150); assert.equal(await page.evaluate(() => transitionFixture.pending()), 0);

  stage = 'normal completion paints the exact neutral endpoint';
  await react({kind:'talk'}); await stopped();
  assert(await page.evaluate(() => Object.values(frames.at(-1).pose).every(value=>value===0)));

  stage = 'paired portraits still share the same take';
  await page.evaluate(() => { transitionFixture.react({kind:'great'}); transitionFixture.react({kind:'great'},1); });
  assert(await page.locator('.coach-actor').evaluateAll(actors => actors[0].dataset.variation === actors[1].dataset.variation));
  await page.evaluate(() => transitionFixture.stop()); await stopped();

  stage = 'different coach switches immediately without borrowing another coach canvas';
  await react({kind:'greeting'}); await page.waitForFunction(() => document.querySelector('canvas'));
  const switched = await page.evaluate(() => { const old=document.querySelector('canvas');transitionFixture.switchCoach('owl');return {removed:!old.isConnected,transition:transitionFixture.snapshot().transition}; });
  assert.equal(switched.removed, true); assert.equal(switched.transition, undefined);
  await page.waitForFunction(() => frames.at(-1)?.coach==='owl');
  await page.evaluate(() => transitionFixture.stop()); await stopped();

  stage = 'hidden and reduced motion interrupt settling immediately';
  await react({kind:'signature',coachId:'owl'}); await delay(400); await react({kind:'talk',coachId:'owl'});
  await page.evaluate(() => transitionFixture.hide(true)); await stopped();
  assert.equal(await react({kind:'talk'}), false);
  await page.evaluate(() => transitionFixture.hide(false));
  await react({kind:'greeting',coachId:'owl'}); await delay(300); await react({kind:'talk',coachId:'owl'});
  const beforeReduced = await page.evaluate(() => transitionFixture.snapshot());
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => !document.querySelector('canvas') && transitionFixture.pending()===0);
  assert.equal(await page.locator('.coach-actor[data-reduced-motion]').count(), 1, JSON.stringify({beforeReduced,after:await page.evaluate(() => transitionFixture.snapshot())}));
  await page.evaluate(() => transitionFixture.stop()); await stopped();
  await page.emulateMedia({reducedMotion:'no-preference'});

  stage = 'disposal cancels a pending replacement';
  await react({kind:'greeting',coachId:'owl'}); await delay(300); await react({kind:'talk',coachId:'owl'});
  await page.evaluate(() => transitionFixture.dispose()); await stopped(); await delay(250);
  assert.equal(await react({kind:'talk'}), false);
  assert.deepEqual(errors, []);
  console.log('PASS: canvas-preserving handoffs, bounded latest-request settling, exact neutral finishes, paired takes, and immediate cleanup.');
} catch (error) {
  if (errors.length) console.error('Page errors:', errors);
  await mkdir(join(root, 'test-results'), { recursive: true });
  if (page) await page.screenshot({path:join(root,'test-results/MeowlChess-coach-transition-failure.png')}).catch(()=>{});
  throw new Error(`Coach transition stage: ${stage}`, {cause:error});
} finally {
  await closeTestContext(context, profile, profilePrefix);
  if (dirname(bundle) === temporaryRoot && basename(bundle).startsWith(bundlePrefix)) await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
