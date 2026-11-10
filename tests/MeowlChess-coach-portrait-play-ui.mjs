import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = resolve(tmpdir());
const profilePrefix = 'MeowlChess-portrait-play-test-', bundlePrefix = 'MeowlChess-portrait-play-bundle-';
const profile = await mkdtemp(join(temporary, profilePrefix));
const bundle = await mkdtemp(join(temporary, bundlePrefix)), extension = join(bundle, 'extension');
const fixtureHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess portrait play</title>
<link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css">
<style>body{padding:16px}main{max-width:680px;margin:auto}#coach-root{padding:16px;background:#242920}.coach-companion{position:static;margin-bottom:16px}</style>
<main><aside id="coach-companion" class="coach-companion" aria-label="Your coach" hidden>
<figure class="coach-companion-figure"><button class="coach-companion-greet" type="button"><img id="coach-companion-avatar" class="coach-avatar coach-companion-avatar" width="220" height="220" alt="" draggable="false"></button><figcaption id="coach-companion-name">Meowl</figcaption></figure>
<div id="coach-companion-bubble" class="coach-companion-bubble" role="status" hidden><strong id="coach-companion-heading"></strong><p id="coach-companion-text"></p></div>
</aside><section id="coach-root"></section></main><script type="module" src="MeowlChess-portrait-play-fixture.js"></script></html>`;
const fixtureScript = String.raw`
import { parseGame } from './lib/review.js';
import { createCoachView } from './lib/coach-view.js';
import { createIndexedDBReviewStore } from './lib/library.js';
const store = createIndexedDBReviewStore();
await store.transact(() => ({coachProgress:{id:'coach-review-milestone',version:1,initialized:true,gameKeys:Array.from({length:10},(_,i)=>'chesscom:live:'+String(100+i))}}));
await store.close();
const $ = id => document.getElementById(id);
const standalone = new URL(location.href).searchParams.has('standalone');
if (standalone) $('coach-companion').remove();
const view = createCoachView($('coach-root'), {
 onNavigate({ply}) { go(ply); }, onOpen() { state.active=true; view.setContext(state); },
 companionTarget: standalone ? null : {container:$('coach-companion'),image:$('coach-companion-avatar'),name:$('coach-companion-name'),bubble:$('coach-companion-bubble'),heading:$('coach-companion-heading'),text:$('coach-companion-text')}
});
const pgn='[White "PlayerCat"]\n[Black "OtherOwl"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';
const parsed=parseGame(pgn);
const positions=parsed.positions.map((fen,i)=>{const next=parsed.moves[i],bestMove=next?next.from+next.to:null;return{cp:0,mate:null,depth:16,bestMove,pv:bestMove?[bestMove]:[]};});
const moves=parsed.moves.map((move,i)=>({...move,ply:i+1,label:'Best',probabilityLoss:0,loss:0,accuracy:100,evalAfter:positions[i+1]}));
let state={game:{pgn,source:'chesscom',white:{username:'PlayerCat'},black:{username:'OtherOwl'}},result:{game:parsed,positions,moves,summary:{w:{accuracy:100},b:{accuracy:100}}},ply:0,active:true,moveReactionsActive:true};
function go(ply){state={...state,ply};view.setContext(state);}
view.setContext(state);
window.fixture={go,context(next){state={...state,...next};view.setContext(state);},dispose(){view.dispose();}};
window.fixtureReady=true;
`;
const soundsProbe = String.raw`
import {createCoachSounds as original} from './coach-sounds.js';
export function createCoachSounds(options){
 const sounds=original(options);
 return {...sounds,async play(args){
  const result=await sounds.play({...args,onStart(playback){window.fixturePlayback=playback;window.fixtureSoundStarts=(window.fixtureSoundStarts||0)+1;args.onStart?.(playback);}});
  return result;
 }};
}
`;
let context, page, worker, stage = 'launch';
const errors = [], external = [];
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'MeowlChess-portrait-play-fixture.html'), fixtureHtml);
  await writeFile(join(extension, 'MeowlChess-portrait-play-fixture.js'), fixtureScript);
  await writeFile(join(extension, 'lib', 'MeowlChess-portrait-play-sounds-probe.js'), soundsProbe);
  const viewPath = join(extension, 'lib', 'coach-view.js');
  await writeFile(viewPath, (await readFile(viewPath, 'utf8')).replace("from './coach-sounds.js'", "from './MeowlChess-portrait-play-sounds-probe.js'"));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, hasTouch: true, reducedMotion: 'no-preference', viewport: { width: 1000, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.fixtureAudioContexts=0;window.fixtureAudioStarts=0;window.fixtureSoundStarts=0;
    let hidden=false;
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
    window.fixtureHide=value=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
    const NativeAudio=window.AudioContext;
    window.AudioContext=class extends NativeAudio{constructor(...args){super(...args);window.fixtureAudioContexts++;}};
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){window.fixtureAudioStarts++;return start.apply(this,args);};
  });
  worker = context.serviceWorkers().find(item=>item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin=`chrome-extension://${new URL(worker.url()).hostname}`, url=`${origin}/MeowlChess-portrait-play-fixture.html`;
  await worker.evaluate(()=>chrome.storage.local.set({coachPreferences:{coach:'meowl',perspective:'both',motion:true,sounds:false,volume:.8,commentary:false}}));
  page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);

  const companion=page.locator('#coach-companion'),button=page.locator('.coach-portrait-play'),status=page.locator('.coach-play-status');
  const reaction=page.locator('#coach-companion .coach-actor[data-reaction="play"]');
  const setPreferences=async patch=>{
    await worker.evaluate(async patch=>{
      const {coachPreferences}=await chrome.storage.local.get('coachPreferences');
      await chrome.storage.local.set({coachPreferences:{...coachPreferences,...patch}});
    },patch);
    await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>{
      const selector={motion:'.coach-motion-toggle',sounds:'.coach-sound-toggle',commentary:'.coach-commentary-toggle'}[key];
      return !selector||document.querySelector(selector)?.checked===value;
    }),patch);
  };
  const reset=async()=>page.evaluate(()=>{fixture.go(1);fixture.go(0);});
  const waitIdle=async()=>page.waitForFunction(()=>document.querySelector('.coach-portrait-play')?.getAttribute('aria-busy')!=='true');
  const painted=async()=>{
    const canvas=companion.locator('.coach-reaction-puppet');
    await canvas.waitFor({state:'visible'});
    assert(await canvas.evaluate(canvas=>canvas.width>0&&canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0)));
    const first=await canvas.evaluate(canvas=>canvas.dataset.frame);
    await page.waitForFunction(first=>document.querySelector('#coach-companion .coach-reaction-puppet')?.dataset.frame!==first,first);
  };
  await companion.waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.coach-companion-choice option[value="evil"]').disabled);
  assert.match(await button.getAttribute('aria-label'),/^Play with Meowl$/);
  stage='all seven coaches and repeated clicks';
  const coachIds=['meowl','baby','owl','paws','mellow','scout','evil'], replies=[];
  await mkdir(join(root,'test-results'),{recursive:true});
  for(const coach of coachIds){
    await page.locator('.coach-companion-choice').selectOption(coach);
    await page.waitForFunction(coach=>document.querySelector('#coach-root').dataset.coach===coach,coach);
    await button.click();await reaction.waitFor({state:'visible'});await painted();
    await companion.screenshot({path:join(root,'test-results',`MeowlChess-portrait-play-${coach}.png`)});
    if(coach==='meowl')await page.screenshot({path:join(root,'test-results','MeowlChess-portrait-play-desktop.png'),fullPage:true});
    const first=await status.innerText();assert(first.length>5,coach+' has a playful reply');
    assert.equal(await page.locator('.coach-message').count(),0,'Playing does not insert chat messages.');
    assert.equal(await page.locator('#coach-companion-bubble').isVisible(),false,'Playing does not replace the game tip.');
    assert.equal(await page.locator('.coach-reaction-badge').count(),0,'Play never creates a move-rating badge.');
    await companion.locator('.coach-reaction-puppet').evaluate(canvas=>window.savedPlayCanvas=canvas);
    await button.evaluate(button=>{for(let i=0;i<10;i++)button.click();});
    assert.equal(await status.innerText(),first,'Rapid clicks keep the current response.');
    assert(await page.evaluate(()=>document.querySelector('#coach-companion .coach-reaction-puppet')===window.savedPlayCanvas),'Rapid clicks do not restart the actor.');
    await waitIdle();
    await button.click();await reaction.waitFor({state:'visible'});await painted();
    const second=await status.innerText();assert.notEqual(second,first,coach+' varies repeated play');
    replies.push({coach,first,second});
    await reset();assert.equal(await status.innerText(),'','Changing the move clears play feedback.');
  }
  assert.equal(new Set(replies.map(item=>item.first)).size,coachIds.length,'Each personality has its own play feedback.');
  assert.equal(await page.evaluate(()=>fixtureAudioContexts),0,'Silent play never allocates audio.');
  assert.equal(await page.evaluate(()=>fixtureAudioStarts),0);

  stage='keyboard, touch, narrow screens, and idle return';
  await page.locator('.coach-companion-choice').selectOption('baby');
  await button.focus();await button.press('Enter');await reaction.waitFor({state:'visible'});
  assert.equal(await button.getAttribute('aria-busy'),'true');await waitIdle();
  await button.press('Space');await reaction.waitFor({state:'visible'});await reset();
  await page.setViewportSize({width:375,height:812});await button.tap();await reaction.waitFor({state:'visible'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No narrow-screen overflow.');
  const bounds=await button.boundingBox();assert(bounds&&bounds.width>=44&&bounds.height>=44,'Portrait remains an accessible touch target.');
  await mkdir(join(root,'test-results'),{recursive:true});
  await page.screenshot({path:join(root,'test-results','MeowlChess-portrait-play-mobile.png'),fullPage:true});
  await reset();await page.setViewportSize({width:1000,height:1000});
  await page.waitForFunction(()=>['ambient','idle'].includes(document.querySelector('#coach-companion .coach-actor')?.dataset.reaction),null,{timeout:12000});
  await button.click();await reaction.waitFor({state:'visible'});await reset();

  stage='preferences and reduced motion';
  await setPreferences({motion:false});await button.click();
  assert((await status.innerText()).length>5);assert.equal(await companion.locator('canvas').count(),0,'Disabled animation still offers text play.');
  await reset();await setPreferences({motion:true});await page.emulateMedia({reducedMotion:'reduce'});
  await button.click();assert((await status.innerText()).length>5);assert.equal(await companion.locator('canvas').count(),0);
  await reset();await page.emulateMedia({reducedMotion:'no-preference'});

  stage='game tips and answering take priority';
  await setPreferences({commentary:true});
  await page.evaluate(()=>{fixture.go(2);document.querySelector('.coach-portrait-play').click();});
  assert.equal(await status.innerText(),'','Pending move commentary takes priority.');
  await page.locator('#coach-companion-bubble').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#coach-companion .coach-actor[data-reaction]'),null,{timeout:6000});
  const tip=await page.locator('#coach-companion-bubble').innerText();
  await button.click();await reaction.waitFor({state:'visible'});
  assert.equal(await page.locator('#coach-companion-bubble').innerText(),tip,'Playing preserves the last game tip.');
  await reset();await setPreferences({commentary:false});
  await page.locator('.coach-question').fill('Summarize this game');
  await page.evaluate(()=>{document.querySelector('.coach-form').requestSubmit();document.querySelector('.coach-portrait-play').click();});
  assert.equal(await status.innerText(),'','An answer in progress cannot be interrupted by playing.');
  await page.locator('.coach-message[data-role="coach"]').waitFor({state:'visible'});
  await button.evaluate(button=>button.click());assert.equal(await status.innerText(),'','The answer reaction gets to finish.');
  await reset();

  stage='actual optional sound, blocked context, and visibility cleanup';
  await setPreferences({sounds:true});await button.click();
  await page.waitForFunction(()=>window.fixturePlayback?.isPlaying());
  const soundStarts=await page.evaluate(()=>fixtureSoundStarts);
  await button.evaluate(button=>{button.click();button.click();});
  assert.equal(await page.evaluate(()=>fixtureSoundStarts),soundStarts,'Playing audio cannot overlap with repeated taps.');
  await page.evaluate(()=>fixtureHide(true));
  assert.equal(await status.innerText(),'');assert.equal(await companion.locator('canvas').count(),0);
  assert.equal(await page.evaluate(()=>fixturePlayback?.isPlaying()),false,'Hiding the page ends sound.');
  await button.evaluate(button=>button.click());assert.equal(await status.innerText(),'','Hidden pages cannot play.');
  await page.evaluate(()=>fixtureHide(false));await setPreferences({sounds:false});
  await page.evaluate(()=>fixture.context({blockedReason:'Analysis is running.'}));
  await button.evaluate(button=>button.click());assert.equal(await status.innerText(),'','Analysis blocks portrait play.');
  await page.evaluate(()=>fixture.context({blockedReason:''}));
  await button.click();await reaction.waitFor({state:'visible'});
  await page.locator('.coach-companion-choice').selectOption('scout');
  assert.equal(await status.innerText(),'','Changing coach clears the old play response.');
  await page.evaluate(()=>fixture.dispose());
  assert.equal(await page.locator('canvas').count(),0);assert.equal(await companion.isVisible(),false);

  stage='standalone portrait without a game or a known player';
  await page.goto(url+'?standalone');await page.waitForFunction(()=>window.fixtureReady);
  const standaloneButton=page.locator('.coach-portrait-play');
  await page.evaluate(()=>fixture.context({game:null,result:null,ply:0}));
  await standaloneButton.click();await page.locator('.coach-actor[data-reaction="play"]').waitFor({state:'visible'});
  assert((await page.locator('.coach-play-status').innerText()).length>5,'No reviewed game is needed for cosmetic portrait play.');
  await page.evaluate(()=>fixture.dispose());
  assert.equal(await page.locator('canvas').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: seven playful personalities, varied taps, sound/animation preferences, keyboard/touch, tip priority, lifecycle cleanup, and standalone portrait play.');
} catch(error) {
  error.message=`${stage}: ${error.message}`;
  throw error;
} finally {
  await closeTestContext(context,profile,profilePrefix);
  const target=resolve(bundle);
  if(dirname(target)===temporary&&basename(target).startsWith(bundlePrefix))await rm(target,{recursive:true,force:true,maxRetries:3});
}
