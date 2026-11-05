import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = resolve(tmpdir());
const prefix = 'MeowlChess-all-mouth-', bundlePrefix = 'MeowlChess-all-mouth-source-';
const profile = await mkdtemp(join(temporary, prefix)), bundle = await mkdtemp(join(temporary, bundlePrefix));
const extension = join(bundle, 'extension');
const recorder = String.raw`
export {createCoachPuppet,coachPoseAt,COACH_REACTION_DURATIONS} from './coach-puppet.js';
import {drawCoachPuppet as draw} from './coach-puppet.js';
export function drawCoachPuppet(context,puppet,pose){
 draw(context,puppet,pose);
 if(!window.frames)return;
 let pixels=null;
 if((pose.mouth||0)>.04&&!window.mouthPixels){
  const other=document.createElement('canvas');other.width=context.canvas.width;other.height=context.canvas.height;
  const alternate=other.getContext('2d');alternate.setTransform(context.getTransform());draw(alternate,puppet,{...pose,mouth:0});
  const a=context.getImageData(0,0,other.width,other.height).data,b=alternate.getImageData(0,0,other.width,other.height).data;
  pixels=0;for(let i=0;i<a.length;i+=4)if([0,1,2,3].some(c=>Math.abs(a[i+c]-b[i+c])>12))pixels++;
  window.mouthPixels=Math.max(window.mouthPixels||0,pixels);
 }
 window.frames.push({at:performance.now(),coach:puppet.coachId,mouth:pose.mouth||0,expected:window.expectedMouth,
  playing:window.latestPlayback?.isPlaying()||false,kind:context.canvas.parentElement?.dataset.reaction,pixels});
}
`;
const fixture = String.raw`
import {createCoachMotion} from './lib/coach-motion-probe.js';
import {createCoachSounds} from './lib/coach-sounds.js';
import {createCoachMouthEnvelope} from './lib/coach-mouth-envelope.js';
import {COACH_MEOW_CLIPS} from './lib/coach-audio-clips.js';
import {coachPortraitUrl,coachPuppetUrl} from './lib/coach-portraits.js';
import {createCoachPuppet,drawCoachPuppet} from './lib/coach-puppet.js';
const image=document.querySelector('img'),motion=createCoachMotion();let sounds;
const surface=()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1254;return canvas;};
const difference=(a,b)=>{const x=a.getContext('2d').getImageData(0,0,1254,1254).data,y=b.getContext('2d').getImageData(0,0,1254,1254).data;let total=0;for(let i=0;i<x.length;i+=4)if([0,1,2,3].some(c=>Math.abs(x[i+c]-y[i+c])>12))total++;return total;};
window.fixture={
 async envelopes(){
  const audio=new AudioContext(),puppets={},results=[];
  try{
   for(const id of ['meowl','baby','owl','paws','mellow','scout','evil']){const source=new Image();source.src=coachPuppetUrl(id);await source.decode();puppets[id]=createCoachPuppet(source,document,id);}
   for(const clip of COACH_MEOW_CLIPS){
    const response=await fetch(new URL('./sounds/coaches/'+clip.file,import.meta.url));if(!response.ok)throw Error('Missing '+clip.file);
    const buffer=await audio.decodeAudioData(await response.arrayBuffer()),envelope=createCoachMouthEnvelope(buffer,clip.sound),samples=[];
    let peak=0,peakTime=0,quiet=0,quietFailures=0;
    for(let time=.005;time<buffer.duration;time+=.005){const mouth=envelope(time);samples.push(mouth);if(mouth>peak){peak=mouth;peakTime=time;}}
    const data=buffer.getChannelData(0);
    for(let time=.15;time<buffer.duration-.03;time+=.02){
     let energy=0;const start=Math.floor((time-.12)*buffer.sampleRate),end=Math.floor((time+.02)*buffer.sampleRate);
     for(let i=start;i<end;i++)energy+=data[i]*data[i];
     if(Math.sqrt(energy/(end-start))<.002){quiet++;if(envelope(time)>.03)quietFailures++;}
    }
    const coach=clip.coaches?.find(id=>puppets[id])||'meowl',closed=surface(),open=surface();
    drawCoachPuppet(closed.getContext('2d'),puppets[coach],{mouth:0});drawCoachPuppet(open.getContext('2d'),puppets[coach],{mouth:peak});
    results.push({id:clip.id,file:clip.file,sound:clip.sound||'meow',coach,duration:buffer.duration,peak,peakTime,
     finite:samples.every(value=>Number.isFinite(value)&&value>=0&&value<=.9),quiet,quietFailures,pixels:difference(closed,open),
     closedOutside:[-.1,0,buffer.duration,buffer.duration+.1].every(time=>envelope(time)===0)});
   }
   return results;
  }finally{await audio.close();}
 },
 async play(coach,id,kind='greeting'){
  sounds?.dispose();motion.stop();window.frames=[];window.expectedMouth=undefined;window.latestPlayback=null;window.mouthPixels=0;
  image.src=coachPortraitUrl(coach);await image.decode();
  const clip=COACH_MEOW_CLIPS.find(clip=>clip.id===id);if(!clip)throw Error('Unknown '+id);
  sounds=createCoachSounds({isEnabled:()=>true,clips:[clip]});
  if(!motion.react(image,{kind,coachId:coach,waitForVoice:true}))throw Error('Gesture rejected');
  await new Promise((resolve,reject)=>{const start=performance.now();const ready=()=>document.querySelector('canvas')?resolve():performance.now()-start>5000?reject(Error('No rendered canvas')):requestAnimationFrame(ready);ready();});
  await new Promise(resolve=>setTimeout(resolve,120));
  return sounds.play({coach,kind,onStart(playback){
   window.latestPlayback=playback;
   if(!motion.setVoice(image,{...playback,coachId:coach,getMouth(){window.expectedMouth=playback.getMouth();return window.expectedMouth;}}))throw Error('Voice overlay rejected');
  }});
 },
 stop(){sounds.stop();},
 dispose(){motion.dispose();sounds?.dispose();},
};window.fixtureReady=true;
`;
const coldSounds = String.raw`
import {createCoachSounds as create} from './coach-sounds.js';
import {COACH_MEOW_CLIPS} from './coach-audio-clips.js';
export function createCoachSounds(options){
 const sounds=create({...options,clips:[COACH_MEOW_CLIPS.find(clip=>clip.id==='meow-11')]});
 return{...sounds,play(args={}){return sounds.play({...args,onStart(playback){
  window.latestPlayback=playback;window.startedAt=performance.now();
  args.onStart?.({...playback,getMouth(){window.expectedMouth=playback.getMouth();return window.expectedMouth;}});
 }});}};
}
`;
const coldFixture = String.raw`
import {parseGame} from './lib/review.js';
import {createCoachView} from './lib/coach-view-mouth-probe.js';
window.frames=[];window.expectedMouth=undefined;window.latestPlayback=null;window.mouthPixels=0;window.artDelayMs=800;
const pgn='[White "Cat"]\n[Black "Owl"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 1/2-1/2',game=parseGame(pgn);
const positions=game.positions.map((fen,index)=>{const move=game.moves[index],bestMove=move?move.from+move.to:null;return{cp:0,mate:null,depth:16,bestMove,pv:bestMove?[bestMove]:[]};});
const moves=game.moves.map((move,index)=>({...move,ply:index+1,label:'Best',probabilityLoss:0,loss:0,accuracy:100,evalAfter:positions[index+1]}));
const view=createCoachView(document.querySelector('#coach-root'));view.setContext({game:{pgn},result:{game,positions,moves,summary:{w:{accuracy:100},b:{accuracy:100}}},ply:1,active:true});
window.fixture={dispose(){view.dispose();}};window.fixtureReady=true;
`;
let context, page, stage = 'launch';
const errors = [], external = [];
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const motion = await readFile(join(extension, 'lib/coach-motion.js'), 'utf8');
  await writeFile(join(extension, 'lib/coach-motion-probe.js'), motion.replace("from './coach-puppet.js'", "from './coach-puppet-mouth-probe.js'")
    .replace('image.onload = async () => {', 'image.onload = async () => { if(window.artDelayMs) await new Promise(resolve=>setTimeout(resolve,window.artDelayMs));'));
  await writeFile(join(extension, 'lib/coach-puppet-mouth-probe.js'), recorder);
  const view = await readFile(join(extension, 'lib/coach-view.js'), 'utf8');
  await writeFile(join(extension, 'lib/coach-view-mouth-probe.js'), view.replace("from './coach-motion.js'", "from './coach-motion-probe.js'").replace("from './coach-sounds.js'", "from './coach-cold-sounds-probe.js'"));
  await writeFile(join(extension, 'lib/coach-cold-sounds-probe.js'), coldSounds);
  await writeFile(join(extension, 'MeowlChess-all-mouth.js'), fixture);
  await writeFile(join(extension, 'MeowlChess-cold-mouth.js'), coldFixture);
  const head = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><style>body{background:#272820;padding:20px}body>img{width:320px;height:320px}main{max-width:600px;margin:auto}</style>';
  await writeFile(join(extension, 'MeowlChess-all-mouth.html'), head + '<img><script type="module" src="MeowlChess-all-mouth.js"></script>');
  await writeFile(join(extension, 'MeowlChess-cold-mouth.html'), head + '<main id="coach-root"></main><script type="module" src="MeowlChess-cold-mouth.js"></script>');
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, reducedMotion: 'no-preference', viewport: { width: 1000, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ coachPreferences: { coach: 'meowl', motion: true, sounds: true, commentary: false } }));
  const origin = 'chrome-extension://' + new URL(worker.url()).hostname;
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/MeowlChess-all-mouth.html'); await page.waitForFunction(() => window.fixtureReady);
  stage = 'all bundled recordings and rendered mouth pixels';
  const envelopes = await page.evaluate(() => fixture.envelopes());
  const output = join(root, 'test-results'); await mkdir(output, { recursive: true });
  await writeFile(join(output, 'MeowlChess-all-mouth-envelopes.json'), JSON.stringify(envelopes, null, 2));
  assert(envelopes.length >= 45);
  for (const clip of envelopes) {
    assert(clip.finite && clip.closedOutside, clip.id + ' has a bounded envelope that closes at silence/end');
    assert(clip.peak > .08 && clip.pixels > 10, clip.id + ' visibly opens its coach mouth');
    assert.equal(clip.quietFailures, 0, clip.id + ' closes through sustained quiet samples');
    if (clip.sound.includes('purr')) assert(clip.peak <= .42, clip.id + ' purr motion stays subtle');
  }
  console.log('All45 recorded envelopes produce visible mouth pixels; quiet samples and purr ranges pass.');
  stage = 'real playback on all seven coaches';
  const cases = [['meowl', 'meow-01'], ['owl', 'meow-11'], ['paws', 'meow-16'], ['scout', 'meow-24'], ['evil', 'meow-23'],
    ['baby', 'meow-36'], ['baby', 'meow-37'], ['baby', 'meow-38'], ['baby', 'meow-44'], ['mellow', 'meow-39'], ['mellow', 'meow-40']];
  const playback = [];
  for (const [coach, clip] of cases) {
    assert.equal(await page.evaluate(({ coach, clip }) => fixture.play(coach, clip), { coach, clip }), true);
    await page.waitForFunction(() => !document.querySelector('canvas'), null, { timeout: 8000 });
    const result = await page.evaluate(() => ({ frames, pixels: mouthPixels }));
    playback.push({ coach, clip, ...result });
    const frames = result.frames;
    assert(frames.filter(frame => frame.expected === undefined).every(frame => frame.mouth === 0), coach + ' stays closed while audio loads');
    assert(frames.some(frame => frame.playing && frame.mouth > .04), coach + '/' + clip + ' opens during real playback');
    assert(result.pixels > 0, coach + '/' + clip + ' changes actual rendered mouth pixels');
    assert(frames.filter(frame => frame.playing && frame.expected !== undefined).every(frame => Math.abs(frame.mouth - frame.expected) < .001), coach + ' follows the recorded envelope');
    const ended = frames.findIndex((frame, index) => index > 0 && frames[index - 1].playing && !frame.playing);
    assert(ended >= 0 && frames.slice(ended).every(frame => frame.mouth === 0), coach + ' mouth closes after its sound ends');
  }
  await page.evaluate(() => fixture.play('mellow', 'meow-40'));
  await page.waitForFunction(() => frames.some(frame => frame.playing && frame.mouth > .08));
  await page.evaluate(() => fixture.stop());
  await page.waitForFunction(() => !document.querySelector('canvas'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => frames.at(-1).mouth), 0, 'Stopping a purr closes the rendered mouth.');
  await writeFile(join(output, 'MeowlChess-all-mouth-playback.json'), JSON.stringify(playback, null, 2));
  console.log('Seven coaches and11representative recordings follow real audio and close on end/stop.');
  await page.evaluate(() => fixture.dispose()); await page.close();

  stage = 'cold artwork and short real chirp through production view';
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/MeowlChess-cold-mouth.html'); await page.waitForFunction(() => window.fixtureReady);
  await page.locator('.coach-settings-summary').click();
  await page.waitForFunction(() => !document.querySelector('.coach-sound-preview').disabled);
  await page.locator('.coach-sound-preview').click();
  await page.waitForFunction(() => window.latestPlayback);
  await page.waitForFunction(() => frames.length > 0 && !document.querySelector('canvas'), null, { timeout: 8000 });
  const cold = await page.evaluate(() => ({ frames, pixels: mouthPixels, startedAt }));
  await writeFile(join(output, 'MeowlChess-cold-mouth.json'), JSON.stringify(cold, null, 2));
  assert(cold.frames.some(frame => frame.playing && frame.mouth > .04) && cold.pixels > 0,
    'A first-use500ms chirp must visibly move the mouth even when artwork loads for800ms.');
  await page.evaluate(() => fixture.dispose());
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ recordings: envelopes.length, liveCases: cases.length, coaches: new Set(cases.map(([coach]) => coach)).size, coldMouthPixels: cold.pixels }));
} catch (error) {
  console.error('All-coach mouth stage:', stage); throw error;
} finally {
  await closeTestContext(context, profile, prefix);
  if (dirname(bundle) === temporary && basename(bundle).startsWith(bundlePrefix)) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
