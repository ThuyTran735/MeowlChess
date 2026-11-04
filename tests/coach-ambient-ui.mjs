import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), extension = join(root, 'extension');
const prefix = 'MeowlChess-ambient-test-', profile = await mkdtemp(join(tmpdir(), prefix));
const html = '<!doctype html><link rel="stylesheet" href="/coach-motion.css"><style>img{width:230px;height:230px}</style><main><img id="coach"></main><script type="module" src="/fixture.js"></script>';
const fixture = `
import {createCoachMotion} from '/lib/coach-motion.js';
import {coachPortraitUrl} from '/lib/coach-portraits.js';
import {COACH_REACTION_DURATIONS as durations} from '/lib/coach-puppet.js';
import {COACH_ANIMATION_LABELS as labels} from '/lib/coach-repertoire.js';
const image=document.querySelector('#coach');image.src=coachPortraitUrl('meowl');await image.decode();
Math.random=()=>.5;let enabled=true,visible=true,hidden=false,motion,playing=false,mouth=0;
Object.defineProperty(document,'visibilityState',{get:()=>hidden?'hidden':'visible'});
const pending=new Set(),request=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);
window.requestAnimationFrame=callback=>{const id=request(time=>{pending.delete(id);callback(time)});pending.add(id);return id};
window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id)};
window.motionProbe=[];
window.fixture={
 reset(){motion?.dispose();enabled=true;visible=true;hidden=false;playing=false;mouth=0;image.style.display='';if(!image.isConnected)document.querySelector('main').append(image);window.motionProbe=[];motion=createCoachMotion({isEnabled:()=>enabled,isVisible:()=>visible});},
 idle(coachId='meowl'){return motion.setIdle(image,{coachId});},
 react(kind='talk',coachId='meowl'){return motion.react(image,{kind,coachId});},
 voice(durationMs=3200,coachId='meowl'){playing=true;return motion.setVoice(image,{coachId,durationMs,getMouth:()=>{if(mouth==='throw')throw Error('stopped');return mouth==='nan'?NaN:mouth;},isPlaying:()=>playing});},
 audio(value,active=true){mouth=value;playing=active;},
 stop(options){motion.stop(options);},dispose(){motion.dispose();},
 gate(name){if(name==='enabled')enabled=false;else if(name==='visible')visible=false;else if(name==='hidden'){hidden=true;document.dispatchEvent(new Event('visibilitychange'));}else if(name==='detached')image.remove();else if(name==='display')image.style.display='none';},
 state(){return{reaction:image.parentElement?.dataset.reaction||null,variation:image.parentElement?.dataset.variation||null,canvas:document.querySelectorAll('canvas').length,pending:pending.size,frames:window.motionProbe.length,decorations:document.querySelectorAll('.coach-reaction-bubble,.coach-reaction-badge,.coach-reaction-stars,.coach-reaction-thought').length};},
 catalog(){return{durationKinds:Object.keys(durations),idleCount:labels.idle.meowl.length};},
};fixture.reset();window.fixtureReady=true;
`;
let context, page;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, reducedMotion: 'no-preference', args: ['--mute-audio'],
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://meowlchess-ambient.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    if (url.pathname === '/fixture.js') return route.fulfill({ body: fixture, contentType: 'text/javascript' });
    const file = resolve(extension, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(extension + sep)) return route.abort();
    try {
      let body = await readFile(file);
      if (url.pathname === '/lib/coach-motion.js') body = body.toString().replace('drawCoachPuppet(context, puppet, pose);', 'window.motionProbe.push({at:now(),kind:reaction.kind,pose:{...pose}});drawCoachPuppet(context, puppet, pose);');
      return route.fulfill({ body, contentType: { '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css' }[extname(file)] || 'application/octet-stream' });
    } catch { return route.abort(); }
  });
  page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const epoch = new Date('2030-01-01T00:00:00Z');
  await page.clock.install({ time: epoch }); await page.clock.pauseAt(new Date(epoch.valueOf() + 1000));
  await page.goto('http://meowlchess-ambient.test/');
  await page.waitForFunction(() => window.fixtureReady, {}, { polling: 100 });
  // Decode the real puppet once before advancing the synthetic wall clock.
  await page.evaluate(() => fixture.react());
  await page.waitForFunction(() => document.querySelector('canvas'), {}, { polling: 100 });
  await page.clock.runFor(1600);
  const reset = () => page.evaluate(() => fixture.reset());
  const state = () => page.evaluate(() => fixture.state());
  const quiet = async () => {
    assert.deepEqual(await state(), { reaction: null, variation: null, canvas: 0, pending: 0, frames: (await state()).frames, decorations: 0 });
  };
  const baselineCatalog = await page.evaluate(() => fixture.catalog());
  assert.equal(baselineCatalog.durationKinds.length, 11); assert.equal(baselineCatalog.idleCount, 40);
  assert(!baselineCatalog.durationKinds.includes('ambient'));

  await reset(); const registeredAt = await page.evaluate(() => { fixture.idle(); return performance.now(); });
  await page.clock.runFor(2799); await quiet();
  await page.clock.runFor(201);
  assert.equal((await state()).reaction, 'ambient'); assert.equal((await state()).variation, null);
  assert.equal((await state()).decorations, 0);
  await page.clock.runFor(1000); await quiet();
  const firstFrames = await page.evaluate(() => motionProbe.filter(frame => frame.kind === 'ambient'));
  assert(firstFrames.some(frame => frame.pose.blink === 1), 'A paired blink must fully close briefly.');
  assert(Object.values(firstFrames[0].pose).every(value => value === 0));
  assert(Object.values(firstFrames.at(-1).pose).every(value => value === 0));
  assert(firstFrames.length <= 37, 'The finite face event paints at30fps, not continuously.');
  for (const { pose } of firstFrames) {
    assert(Object.values(pose).every(Number.isFinite));
    assert(Object.keys(pose).every(key => ['blink', 'lookX', 'lookY'].includes(key)));
    assert((pose.blink || 0) >= 0 && (pose.blink || 0) <= 1);
    assert(Math.abs(pose.lookX || 0) <= .18 && Math.abs(pose.lookY || 0) <= .07);
  }
  const framesBeforePause = (await state()).frames;
  await page.clock.runFor(1900); await quiet();
  assert.equal((await state()).frames, framesBeforePause, 'No background render loop runs between events.');
  await page.clock.runFor(150);
  assert.equal((await state()).reaction, 'idle');
  const firstIdle = await page.evaluate(() => motionProbe.find(frame => frame.kind === 'idle').at);
  assert(Math.abs(firstIdle - registeredAt - 6000) < 20, 'The first full gesture keeps its original6s deadline.');
  await page.clock.runFor(11400);
  const groups = await page.evaluate(() => { const starts=[];let previous=null;for(const frame of motionProbe){if(frame.kind!==previous)starts.push({kind:frame.kind,at:frame.at});previous=frame.kind;}return starts; });
  const idleStarts = groups.filter(group => group.kind === 'idle');
  assert.equal(idleStarts.length, 2);
  assert(Math.abs(idleStarts[1].at - idleStarts[0].at - 11400) < 40, 'Ambient blinks cannot postpone the next full-body idle.');
  assert(await page.evaluate(() => motionProbe.some(frame => frame.kind === 'ambient' && Math.abs(frame.pose.lookX) > .1)), 'Later face-only events include a small glance.');

  await reset(); await page.evaluate(() => fixture.idle()); await page.clock.runFor(3030);
  assert.equal((await state()).reaction, 'ambient');
  assert(await page.evaluate(() => fixture.react('talk')));
  assert.equal((await state()).reaction, 'talk'); assert.equal((await state()).variation, '0');
  assert.equal((await state()).canvas, 1, 'A real reaction takes over the same canvas.');
  const interruptionAt = await page.evaluate(() => performance.now());
  await page.clock.runFor(1700); await quiet();
  assert(!await page.evaluate(at => motionProbe.some(frame => frame.at > at && frame.kind === 'ambient'), interruptionAt));
  assert(await page.evaluate(() => fixture.react('talk'))); assert.equal((await state()).variation, '1');

  for (const gate of ['enabled', 'visible', 'hidden', 'detached', 'display']) {
    for (const time of [1000, 3020]) {
      await reset(); await page.evaluate(() => fixture.idle()); await page.clock.runFor(time);
      await page.evaluate(name => fixture.gate(name), gate); await page.clock.runFor(18000); await quiet();
    }
  }
  for (const time of [1000, 3020]) {
    await reset(); await page.evaluate(() => fixture.idle()); await page.clock.runFor(time);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.runFor(16000); await quiet();
    assert.equal(await page.evaluate(() => fixture.idle()), false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.clock.runFor(100); // Let the real media-query change event reach the runtime.
  }
  for (const action of ['stop', 'dispose']) {
    await reset(); await page.evaluate(() => fixture.idle()); await page.clock.runFor(3020);
    await page.evaluate(action => fixture[action](), action); await page.clock.runFor(18000); await quiet();
  }
  await reset(); await page.evaluate(() => fixture.idle()); await page.clock.runFor(3020);
  await page.evaluate(() => fixture.stop({settle:true}));
  assert.equal((await state()).canvas, 1, 'A stopped face event keeps the existing finite settle.');
  await page.clock.runFor(240); await quiet();
  for (const coachId of ['owl', 'paws', 'mellow', 'scout', 'evil']) {
    // Each coach now loads on selection. Let the real SVG decode finish before
    // advancing a synthetic four seconds in the idle-cadence checks below.
    await reset(); await page.evaluate(id => fixture.react('talk',id), coachId);
    await page.waitForFunction(() => document.querySelector('canvas'), {}, { polling: 100 });
    await page.clock.runFor(1600);
    await reset(); assert(await page.evaluate(id => fixture.idle(id), coachId)); await page.clock.runFor(4000); await quiet();
    const poses = await page.evaluate(() => motionProbe.map(frame => frame.pose));
    assert(poses.some(pose => pose.blink === 1), coachId + ' closes both eyes completely.');
    assert(poses.every(pose => Object.values(pose).every(Number.isFinite)));
  }

  // The mouth samples an external playback clock while the gesture retains its
  // existing timing, variation, props and canvas. It never starts the audio.
  await reset(); assert(await page.evaluate(() => fixture.react('signature')));
  await page.clock.runFor(450);
  const bodyBeforeVoice = await page.evaluate(() => ({pose:motionProbe.at(-1).pose,variation:fixture.state().variation}));
  await page.evaluate(() => {window.sameVoiceCanvas=document.querySelector('canvas');fixture.audio(.65);fixture.voice(1000);});
  await page.clock.runFor(50);
  let lastPose = await page.evaluate(() => motionProbe.at(-1).pose);
  assert.equal(lastPose.mouth, .65); assert(lastPose.feather > 0 && lastPose.rightWing > 0);
  assert.equal((await state()).reaction, 'signature'); assert.equal((await state()).variation, bodyBeforeVoice.variation);
  assert(await page.evaluate(() => document.querySelector('canvas')===window.sameVoiceCanvas));
  for (const [sample,expected] of [[2,1],[-1,0],['nan',0],['throw',0],[.34,.34]]) {
    await page.evaluate(value => fixture.audio(value), sample); await page.clock.runFor(40);
    assert.equal(await page.evaluate(() => motionProbe.at(-1).pose.mouth), expected);
  }
  await page.evaluate(() => fixture.audio(.8,false)); await page.clock.runFor(35);
  assert.equal(await page.evaluate(() => motionProbe.at(-1).pose.mouth), 0);
  const closedAt = await page.evaluate(() => performance.now());
  await page.clock.runFor(900);
  assert(await page.evaluate(at => motionProbe.filter(frame=>frame.at>at).every(frame=>frame.pose.mouth===0), closedAt), 'Authored talking cannot reopen the mouth after this recording stops.');

  await reset(); await page.evaluate(() => {fixture.idle();fixture.react('talk');fixture.audio(.5);fixture.voice(3500);});
  await page.clock.runFor(500); await page.evaluate(() => {window.sameVoiceCanvas=document.querySelector('canvas');});
  await page.clock.runFor(850);
  assert.equal((await state()).reaction, 'voice'); assert.equal((await state()).variation, null);
  assert.equal(await page.evaluate(() => motionProbe.at(-1).pose.mouth), .5);
  assert(await page.evaluate(() => document.querySelector('canvas')===window.sameVoiceCanvas), 'The voice continuation cannot flash the resting portrait.');
  assert(await page.evaluate(() => motionProbe.filter(frame=>frame.kind==='voice').every(frame=>Object.keys(frame.pose).every(key=>key==='mouth'))));
  await page.clock.runFor(1500);
  assert.equal((await state()).reaction, 'voice');
  assert(!await page.evaluate(() => motionProbe.some(frame=>frame.kind==='ambient')), 'Ambient activity cannot start over the playing voice.');
  await page.evaluate(() => fixture.audio(0,false)); await page.clock.runFor(50); await quiet();
  await page.clock.runFor(2850); assert.equal((await state()).reaction, 'ambient', 'The quiet idle schedule resumes after audio.');

  await reset(); await page.evaluate(() => fixture.idle()); await page.clock.runFor(3000);
  await page.evaluate(() => {fixture.audio(.5);fixture.voice(300);}); await page.clock.runFor(150);
  await page.evaluate(() => fixture.audio(0,false)); await page.clock.runFor(900); await quiet();
  await page.clock.runFor(2750);
  assert.equal((await state()).reaction, 'ambient', 'A short recording during a face event must restore the full idle schedule.');

  await reset(); await page.evaluate(() => {fixture.audio(.4);fixture.voice(1e9);});
  await page.clock.runFor(15100); await quiet();
  assert.equal(await page.evaluate(() => fixture.voice(0)), false);
  assert.equal(await page.evaluate(() => fixture.voice(-1)), false);
  for (const gate of ['enabled','visible','hidden','detached','display']) {
    await reset(); await page.evaluate(() => {fixture.audio(.6);fixture.voice();}); await page.clock.runFor(100);
    await page.evaluate(name => fixture.gate(name), gate); await page.clock.runFor(18000); await quiet();
  }
  await reset(); await page.evaluate(() => {fixture.audio(.6);fixture.voice();}); await page.clock.runFor(100);
  await page.emulateMedia({reducedMotion:'reduce'}); await page.clock.runFor(18000); await quiet();
  assert.equal(await page.evaluate(() => fixture.voice()), false);
  await page.emulateMedia({reducedMotion:'no-preference'}); await page.clock.runFor(100);
  for (const action of ['stop','dispose']) {
    await reset(); await page.evaluate(() => {fixture.audio(.6);fixture.voice();}); await page.clock.runFor(100);
    await page.evaluate(name => fixture[name](), action); await page.clock.runFor(18000); await quiet();
  }
  assert.deepEqual(await page.evaluate(() => fixture.catalog()), baselineCatalog);
  assert.deepEqual(errors, []);
  console.log('Ambient paired blink/glance, exact idle deadlines, voice overlays/continuation, finite playback and all lifecycle gates passed.');
} finally { await closeTestContext(context, profile, prefix); }
