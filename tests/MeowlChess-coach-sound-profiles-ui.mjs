import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = resolve(tmpdir());
const prefix = 'MeowlChess-sound-profile-', bundlePrefix = 'MeowlChess-sound-profile-source-';
const profile = await mkdtemp(join(temporary, prefix)), bundle = await mkdtemp(join(temporary, bundlePrefix));
const extension = join(bundle, 'extension');
const fixture = String.raw`
import {parseGame} from './lib/review.js';
import {createCoachView} from './lib/coach-view-probe.js';
import {createIndexedDBReviewStore} from './lib/library.js';
import {mergeCoachMilestone} from './lib/coach-unlocks.js';
import {COACH_MEOW_CLIPS} from './lib/coach-audio-clips.js';
import {coachSoundBank,getCoachSoundProfile} from './lib/coach-sound-profiles.js';
const store=createIndexedDBReviewStore();
await store.transact(()=>({coachProgress:mergeCoachMilestone(null,Array.from({length:10},(_,i)=>'chesscom:live:'+(9900000+i)))}));await store.close();
const pgn='[White "Cat"]\n[Black "Owl"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';
const game=parseGame(pgn),positions=game.positions.map((fen,index)=>{const move=game.moves[index],bestMove=move?move.from+move.to:null;return{cp:0,mate:null,depth:16,bestMove,pv:bestMove?[bestMove]:[]};});
const moves=game.moves.map((move,index)=>({...move,ply:index+1,label:index===2?'Great':index===3?'Mistake':'Best',probabilityLoss:index===3?.15:0,loss:0,accuracy:100,evalAfter:positions[index+1]}));
const state={game:{pgn},result:{game,positions,moves,summary:{w:{accuracy:90},b:{accuracy:90}}},ply:3,active:true};
const view=createCoachView(document.querySelector('#coach-root'));view.setContext(state);
window.fixture={
 setActive(active){state.active=active;view.setContext(state);},
 hide(hidden){window.fixtureHidden=hidden;document.dispatchEvent(new Event('visibilitychange'));},
 profile(id){return getCoachSoundProfile(id).description;},
 pool(id,kind){return coachSoundBank(COACH_MEOW_CLIPS,id,kind).map(clip=>clip.file);},
 async decodeBank(){
  const audio=new AudioContext(),decoded=[];
  try{for(const clip of COACH_MEOW_CLIPS){
   const response=await fetch(new URL('./sounds/coaches/'+clip.file,import.meta.url));
   if(!response.ok)throw Error('Missing coach recording: '+clip.file);
   const buffer=await audio.decodeAudioData(await response.arrayBuffer());
   decoded.push({file:clip.file,duration:buffer.duration,channels:buffer.numberOfChannels,length:buffer.length});
  }return decoded;}finally{await audio.close();}
 },
 dispose(){view.dispose();},
};window.fixtureReady=true;
`;
// Record actual locally decoded buffers and source starts without replacing
// playback, volume ramps, cancellation, or the real mouth envelope.
const probe = String.raw`
import {createCoachSounds as create} from './coach-sounds.js';
export function createCoachSounds(options){
 const byteFiles=new WeakMap(),bufferFiles=new WeakMap();let lastSource=null;
 const sounds=create({...options,
  async fetchAudio(url,settings){const response=await fetch(url,settings);return{ok:response.ok,async arrayBuffer(){const bytes=await response.arrayBuffer();byteFiles.set(bytes,new URL(url).pathname.split('/').pop());return bytes;}};},
  createContext(){
   const audio=new AudioContext(),decode=audio.decodeAudioData.bind(audio),makeSource=audio.createBufferSource.bind(audio),makeGain=audio.createGain.bind(audio);let gainValues=[];
   audio.decodeAudioData=async bytes=>{const buffer=await decode(bytes);bufferFiles.set(buffer,byteFiles.get(bytes));return buffer;};
   audio.createGain=()=>{const gain=makeGain(),ramp=gain.gain.linearRampToValueAtTime.bind(gain.gain);gainValues=[];gain.gain.linearRampToValueAtTime=(value,time)=>{gainValues.push(value);return ramp(value,time);};return gain;};
   audio.createBufferSource=()=>{const source=makeSource(),start=source.start.bind(source);source.start=(...args)=>{lastSource={file:bufferFiles.get(source.buffer),rate:source.playbackRate.value,duration:source.buffer.duration,peakGain:Math.max(...gainValues)};window.nativeSources.push(lastSource);return start(...args);};return source;};
   return audio;
  },
 });
 return{...sounds,play(args={}){
  const call={coach:args.coach,kind:args.kind,volume:options.getVolume(),started:false};window.soundCalls.push(call);
  return sounds.play({...args,onStart(playback){call.started=true;call.source=lastSource;window.latestPlayback=playback;window.playbacks.push(call);args.onStart?.(playback);}});
 }};
}
`;
let context, page, stage = 'launch';
const errors = [], external = [], roster = ['meowl', 'baby', 'owl', 'paws', 'mellow', 'scout', 'evil'];
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const view = await readFile(join(extension, 'lib/coach-view.js'), 'utf8');
  await writeFile(join(extension, 'lib/coach-view-probe.js'), view.replace("from './coach-sounds.js'", "from './coach-sounds-probe.js'"));
  await writeFile(join(extension, 'lib/coach-sounds-probe.js'), probe);
  await writeFile(join(extension, 'MeowlChess-sound-profiles.js'), fixture);
  await writeFile(join(extension, 'MeowlChess-sound-profiles.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><style>body{padding:16px}main{max-width:650px;margin:auto}</style><main id="coach-root"></main><script type="module" src="MeowlChess-sound-profiles.js"></script>');
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, viewport: { width: 1000, height: 1100 }, reducedMotion: 'no-preference',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.soundCalls = []; window.nativeSources = []; window.playbacks = []; window.fixtureHidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.fixtureHidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.fixtureHidden ? 'hidden' : 'visible' });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ coachPreferences: { coach: 'meowl', sounds: false, motion: true, commentary: false, volume: .65 } }));
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('chrome-extension://' + new URL(worker.url()).hostname + '/MeowlChess-sound-profiles.html');
  await page.waitForFunction(() => window.fixtureReady);
  await page.waitForFunction(() => !document.querySelector('.coach-select option[value="evil"]').disabled);
  await page.locator('.coach-settings-summary').click();
  const choose = async id => {
    if (!await page.locator('.coach-picker').evaluate(details => details.open)) await page.locator('.coach-picker-summary').click();
    await page.locator(`.coach-choice[data-coach="${id}"]`).click();
    await page.waitForFunction(id => document.querySelector('.coach-select').value === id, id);
  };
  const volume = async value => page.locator('.coach-volume').evaluate((slider, value) => {
    slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  const playAnimation = async kind => {
    const count = await page.evaluate(() => playbacks.length);
    await page.locator('.coach-animation-choice').selectOption(kind); await page.locator('.coach-animation-preview').click();
    await page.waitForFunction(count => playbacks.length > count, count);
    return page.evaluate(() => playbacks.at(-1));
  };
  const validSource = async call => {
    const bank = await page.evaluate(({ coach, kind }) => fixture.pool(coach, kind), call);
    assert(bank.includes(call.source.file), `${call.coach}/${call.kind} must use its own real recording bank`);
    assert.equal(call.source.rate, 1, 'Character voices preserve the recording pitch and speed.');
    assert(call.source.duration > .05 && call.source.duration < 5);
    assert(Math.abs(call.source.peakGain - .65 * .65) < .00001, 'Every coach uses the selected volume.');
  };
  stage = 'opt-in and distinct coach voices';
  assert.equal(await page.locator('.coach-sound-toggle').isChecked(), false);
  assert.equal(await page.locator('.coach-sound-preview').isDisabled(), true);
  assert.equal(await page.evaluate(() => nativeSources.length), 0);
  await page.locator('.coach-sound-toggle').check(); await volume(65);
  const descriptions = new Set();
  for (const id of roster) {
    await choose(id);
    const description = await page.locator('.coach-sound-profile').innerText();
    assert.equal(description, await page.evaluate(id => fixture.profile(id), id)); descriptions.add(description);
    assert.match(await page.locator('.coach-sound-preview').getAttribute('aria-label'), /Preview .+'s voice at this volume/);
    const call = await playAnimation('greeting'); assert.equal(call.coach, id); await validSource(call);
  }
  assert.equal(descriptions.size, roster.length, 'Every coach explains its distinct voice.');

  stage = 'Great and encouragement keep their reaction banks';
  for (const id of ['paws', 'baby']) {
    await choose(id);
    for (const kind of ['great', 'encourage']) {
      const call = await playAnimation(kind); assert.equal(call.kind, kind); assert.equal(call.coach, id); await validSource(call);
    }
  }
  stage = 'mute, zero volume, hidden, inactive, and idle cancellation';
  await page.locator('.coach-sound-toggle').uncheck();
  assert.equal(await page.evaluate(() => latestPlayback.isPlaying()), false);
  assert.equal(await page.evaluate(() => latestPlayback.getMouth()), 0);
  let count = await page.evaluate(() => nativeSources.length);
  await page.locator('.coach-animation-choice').selectOption('great'); await page.locator('.coach-animation-preview').click();
  await page.waitForTimeout(200); assert.equal(await page.evaluate(() => nativeSources.length), count);
  await page.locator('.coach-sound-toggle').check(); await volume(0);
  assert.equal(await page.locator('.coach-sound-preview').isDisabled(), true);
  await page.locator('.coach-animation-preview').click(); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => nativeSources.length), count);
  await volume(65); await playAnimation('talk');
  count = await page.evaluate(() => nativeSources.length);
  await page.locator('.coach-animation-choice').selectOption('idle'); await page.locator('.coach-animation-preview').click();
  await page.waitForTimeout(200); assert.equal(await page.evaluate(() => nativeSources.length), count);
  assert.equal(await page.evaluate(() => latestPlayback.getMouth()), 0);
  await playAnimation('greeting'); await page.evaluate(() => fixture.hide(true));
  assert.equal(await page.evaluate(() => latestPlayback.isPlaying()), false);
  assert.equal(await page.evaluate(() => latestPlayback.getMouth()), 0);
  count = await page.evaluate(() => nativeSources.length);
  await page.locator('.coach-animation-preview').evaluate(button => button.click());
  await page.waitForTimeout(200); assert.equal(await page.evaluate(() => nativeSources.length), count);
  await page.evaluate(() => fixture.hide(false)); await playAnimation('greeting');
  await page.evaluate(() => fixture.setActive(false));
  assert.equal(await page.evaluate(() => latestPlayback.getMouth()), 0);
  assert.equal(await page.locator('.coach-sound-preview').isDisabled(), true);
  await page.evaluate(() => fixture.setActive(true));

  stage = 'small-screen voice settings';
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const output = join(root, 'test-results'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'MeowlChess-coach-sound-profiles-mobile.png'), fullPage: true });
  const decoded = await page.evaluate(() => fixture.decodeBank());
  assert(decoded.length >= 35, 'The complete bundled voice catalog is decoded by the browser.');
  assert(decoded.every(clip => clip.duration > .05 && clip.duration < 5 && clip.channels > 0 && clip.length > 0));
  const results = { ...await page.evaluate(() => ({ calls: soundCalls, sources: nativeSources, playbacks })), decoded };
  await writeFile(join(output, 'MeowlChess-coach-sound-profiles-ui.json'), JSON.stringify(results, null, 2));
  await page.evaluate(() => fixture.dispose());
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ coaches: roster.length, realPlaybacks: results.playbacks.length, nativeSources: results.sources.length, decoded: decoded.length, descriptionCount: descriptions.size, silence: ['off', 'zero', 'hidden', 'inactive', 'idle'] }));
} catch (error) {
  console.error('Coach sound profile stage:', stage); throw error;
} finally {
  await closeTestContext(context, profile, prefix);
  if (dirname(bundle) === temporary && basename(bundle).startsWith(bundlePrefix)) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
