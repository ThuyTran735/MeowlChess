import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = resolve(tmpdir());
const prefix = 'MeowlChess-audio-sync-', bundlePrefix = 'MeowlChess-audio-sync-source-';
const profile = await mkdtemp(join(temporary, prefix)), bundle = await mkdtemp(join(temporary, bundlePrefix));
const extension = join(bundle, 'extension');
const fixture = `
import {createCoachMotion} from './lib/coach-motion-probe.js';
import {createCoachSounds} from './lib/coach-sounds.js';
import {coachPortraitUrl} from './lib/coach-portraits.js';
const image=document.querySelector('img'); image.src=coachPortraitUrl('meowl'); await image.decode();
window.frames=[];window.expectedMouth=undefined;window.playing=false;
const motion=createCoachMotion();
const sounds=createCoachSounds({isEnabled:()=>true,clips:[{id:'real-call',file:'MeowlChess-meow-16.wav',kinds:['talk']} ]});
window.fixture={
 motion,sounds,
 async play(kind){
  window.frames=[];window.expectedMouth=undefined;window.playing=false;
  if(!motion.react(image,{kind,coachId:'meowl',waitForVoice:true}))throw Error('Gesture rejected');
  await new Promise((resolve,reject)=>{const start=performance.now();const wait=()=>document.querySelector('canvas')?resolve():performance.now()-start>4000?reject(Error('No rendered canvas')):requestAnimationFrame(wait);wait();});
  await new Promise(resolve=>setTimeout(resolve,120));
  return sounds.play({onStart(playback){
   window.playing=true;
   const accepted=motion.setVoice(image,{...playback,coachId:'meowl',
    getMouth(){window.expectedMouth=playback.getMouth();return window.expectedMouth;},
    isPlaying(){window.playing=playback.isPlaying();return window.playing;}});
   if(!accepted)throw Error('Voice overlay rejected');
  }});
 },
 stop(){sounds.stop();},
 dispose(){motion.dispose();sounds.dispose();},
};window.fixtureReady=true;`;
let context;
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const runtime = await readFile(join(extension, 'lib/coach-motion.js'), 'utf8');
  await writeFile(join(extension, 'lib/coach-motion-probe.js'), runtime.replace("from './coach-puppet.js'", "from './coach-puppet-probe.js'"));
  await writeFile(join(extension, 'lib/coach-puppet-probe.js'), `export {createCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS} from './coach-puppet.js';import {drawCoachPuppet as draw} from './coach-puppet.js';export function drawCoachPuppet(ctx,puppet,pose){window.frames?.push({at:performance.now(),mouth:pose.mouth||0,expected:window.expectedMouth,playing:window.playing,kind:ctx.canvas.parentElement?.dataset.reaction});draw(ctx,puppet,pose);}`);
  await writeFile(join(extension, 'audio-sync.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="coach-motion.css"><style>body{background:#272820}img{width:320px;height:320px}</style><img><script type="module" src="audio-sync.js"></script>');
  await writeFile(join(extension, 'audio-sync.js'), fixture);
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH, headless: true, reducedMotion: 'no-preference',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route(/^https?:\/\//, route => route.abort());
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('chrome-extension://' + new URL(worker.url()).hostname + '/audio-sync.html');
  await page.waitForFunction(() => window.fixtureReady);
  console.log('Ready; starting recorded greeting.');
  assert.equal(await page.evaluate(() => fixture.play('greeting')), true);
  await page.waitForFunction(() => !document.querySelector('canvas'), { timeout: 6000 });
  const first = await page.evaluate(() => frames);
  console.log('Greeting complete; checking audio frames.');
  assert(first.filter(frame => frame.expected === undefined).every(frame => frame.mouth === 0), 'The mouth stays closed while a recording is loading.');
  assert(first.some(frame => frame.playing && frame.mouth > .3), 'Real decoded audio opens the rendered mouth.');
  assert(first.filter(frame => frame.playing && frame.expected !== undefined).every(frame => Math.abs(frame.mouth - frame.expected) < .001), 'The renderer follows the actual audio envelope, not authored syllables.');
  const ended = first.findIndex((frame, index) => index > 0 && first[index - 1].playing && !frame.playing);
  assert(ended >= 0 && first.slice(ended).every(frame => frame.mouth === 0), 'The gesture keeps its mouth closed after the recording ends.');
  assert.equal(await page.evaluate(() => fixture.play('think')), true);
  await page.waitForFunction(() => !document.querySelector('canvas'), { timeout: 6000 });
  const second = await page.evaluate(() => frames);
  assert(second.some(frame => frame.kind === 'voice' && frame.playing), 'A longer real recording continues through the end of a body gesture.');
  assert.equal(second.at(-1).mouth, 0);
  await page.evaluate(() => fixture.play('greeting'));
  await page.waitForFunction(() => frames.some(frame => frame.playing && frame.mouth > .2));
  await page.evaluate(() => fixture.stop());
  await page.waitForFunction(() => !document.querySelector('canvas'), { timeout: 6000 });
  assert.equal(await page.evaluate(() => frames.at(-1).mouth), 0);
  await page.evaluate(() => fixture.dispose()); assert.deepEqual(errors, []);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(join(root, 'test-results/MeowlChess-audio-sync.json'), JSON.stringify({ greeting: first, continuation: second }, null, 2));
  console.log('PASS: real bundled recording drives the mouth, ends in silence, and outlasts short gestures without changing their body take.');
} finally {
  await closeTestContext(context, profile, prefix);
  if (dirname(bundle) === temporary && basename(bundle).startsWith(bundlePrefix)) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
