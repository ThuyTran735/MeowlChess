import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-unlock-test-', bundlePrefix = 'MeowlChess-coach-unlock-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix)), bundle = await mkdtemp(join(temporaryRoot, bundlePrefix));
const extension = join(bundle, 'extension'), errors = [], external = [];
let context, page, stage = 'launch';
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><style>:root{--text:#f1f0e9;--muted:#aba99e}body{margin:0;padding:12px;background:#24231f;color:var(--text);font:14px Arial}#coach{max-width:340px;margin:auto;background:#2c2b27}.coach-companion{max-width:316px;margin:0 auto 14px}</style><aside class="coach-companion"><figure class="coach-companion-figure"><button type="button" class="coach-companion-greet"><img class="coach-avatar" alt=""></button><figcaption></figcaption></figure><div class="coach-companion-bubble"><strong></strong><p></p></div></aside><div id="coach"></div><script type="module" src="unlock-fixture.js"></script>`;
const script = `
import {Chess} from './vendor/chess.js';
import {analyzeGame,ANALYSIS_VERSION} from './lib/review.js';
import {createReviewLibrary} from './lib/library.js';
import {createCoachView} from './lib/coach-view.js';
import {getCoachUnlockProgress} from './lib/coach-unlocks.js';
const library=createReviewLibrary({analysisVersion:ANALYSIS_VERSION}), fixtures=new Map();
const settings={engineId:'stockfish',engineName:'Stockfish 18',moveTimeMs:50,multiPV:1,smartAnalysis:false,analysisVersion:ANALYSIS_VERSION};
async function fixture(index){
 if(fixtures.has(index))return fixtures.get(index);
 const pgn='[Event "Unlock fixture '+index+'"]\\n[White "Cat'+index+'"]\\n[Black "Owl"]\\n[Result "1-0"]\\n\\n1. e4 e5 2. Nf3 1-0';
 const result=await analyzeGame(pgn,{smartAnalysis:false,moveTimeMs:50,multiPV:1,engineFactory:()=>({async init(){},dispose(){},async evaluate(fen){const move=new Chess(fen).moves({verbose:true})[0],uci=move?move.from+move.to+(move.promotion||''):null;return{cp:0,mate:null,bestMove:uci,pv:uci?[uci]:[],candidates:[],depth:8}}})});
 const value={game:{pgn,white:{username:'Cat'+index},black:{username:'Owl'}},result};fixtures.set(index,value);return value;
}
async function save(index){const data=await fixture(index);return library.saveReview(data.game,data.result,settings);}
if(!location.search.includes('watch'))for(let index=1;index<=7;index++)await save(index);
if(!(await chrome.storage.local.get('coachPreferences')).coachPreferences)await chrome.storage.local.set({coachPreferences:{coach:'evil',motion:false,commentary:false}});
const data=await fixture(1),root=document.querySelector('#coach'),container=document.querySelector('.coach-companion');
const state={...data,ply:0,active:true,moveReactionsActive:false,blockedReason:''};
const view=createCoachView(root,{onOpen(){root.hidden=false;view.setContext(state)},companionTarget:{container,image:container.querySelector('img'),name:container.querySelector('figcaption'),bubble:container.querySelector('.coach-companion-bubble'),heading:container.querySelector('strong'),text:container.querySelector('p')}});
view.setContext(state);
window.unlockFixture={save,progress:getCoachUnlockProgress,async deleteAll(){for(const item of await library.listReviews())await library.deleteReview(item.id)},async dispose(){view.dispose();await library.close()}};window.fixtureReady=true;
`;
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'unlock-fixture.html'), html); await writeFile(join(extension, 'unlock-fixture.js'), script);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 900, height: 1100 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000); context.on('page', target => target.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage(); await page.goto(`${origin}/unlock-fixture.html`); await page.waitForFunction(() => window.fixtureReady);
  const current = () => page.locator('#coach').getAttribute('data-coach');
  const count = value => page.waitForFunction(value => document.querySelector('.coach-unlock-count').textContent === value, `${value}/10 games reviewed`);
  const evil = page.locator('.coach-choice[data-coach="evil"]');
  await count(7);
  stage = 'locked coach is visible and rejects saved, mouse and native-select requests';
  assert.equal(await page.locator('.coach-choice').count(), 7); assert.equal(await current(), 'meowl');
  assert.equal(await evil.getAttribute('aria-disabled'), 'true');
  assert(await page.locator('.coach-companion-choice option[value="evil"]').isDisabled());
  const lockedBounds = await evil.boundingBox();
  // aria-disabled blocks selection; the real pointer can still open its explanation.
  await page.mouse.click(lockedBounds.x+lockedBounds.width/2, lockedBounds.y+lockedBounds.height/2);
  assert.equal(await current(), 'meowl');
  assert(await page.locator('.coach-unlock').evaluate(element => element.open));
  assert.match(await page.locator('.coach-unlock-explanation').textContent(), /10 different completed games/);
  await page.locator('.coach-select').evaluate(select => { select.value='evil';select.dispatchEvent(new Event('change',{bubbles:true})); });
  assert.equal(await current(), 'meowl');
  await worker.evaluate(() => chrome.storage.local.set({coachPreferences:{coach:'evil',motion:false,commentary:false}}));
  await page.waitForTimeout(100); assert.equal(await current(), 'meowl');
  stage = 'keyboard keeps existing coaches usable and exposes lock information';
  await page.locator('.coach-choice[data-coach="meowl"]').focus(); await page.keyboard.press('End');
  assert.equal(await current(), 'scout');
  await page.keyboard.press('Tab'); assert(await evil.evaluate(button => button===document.activeElement));
  await page.keyboard.press('Enter'); assert.equal(await current(), 'scout');
  assert(await page.locator('.coach-unlock-summary').evaluate(summary => summary===document.activeElement));
  stage = 'progress updates after local and cross-tab saves without counting a re-review twice';
  await page.evaluate(() => unlockFixture.save(7)); await count(7);
  await page.evaluate(() => unlockFixture.save(8)); await count(8);
  const other = await context.newPage(); await other.goto(`${origin}/unlock-fixture.html?watch`); await other.waitForFunction(() => window.fixtureReady);
  await other.evaluate(() => unlockFixture.save(9)); await count(9);
  await page.setViewportSize({width:320,height:1100});
  assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1));
  assert(await evil.isVisible());
  await mkdir(join(root,'test-results'),{recursive:true});
  await page.screenshot({path:join(root,'test-results/MeowlChess-evil-locked-mobile.png'),fullPage:true});
  stage = 'the tenth distinct review unlocks automatically and persists after deletion and reload';
  await other.evaluate(() => unlockFixture.save(10));
  await page.waitForFunction(() => document.querySelector('.coach-choice[data-coach="evil"]').getAttribute('aria-disabled')==='false');
  assert.equal(await page.locator('.coach-unlock').isVisible(), false);
  assert.match(await page.locator('.coach-unlock-status').textContent(), /unlocked/);
  assert.equal(await page.locator('.coach-companion-choice option[value="evil"]').isDisabled(), false);
  await evil.click(); assert.equal(await current(), 'evil');
  assert((await page.locator('.coach-companion-avatar,.coach-companion .coach-avatar').getAttribute('src')).endsWith('/MeowlChess-coach-evil.svg'));
  await page.waitForFunction(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences.coach==='evil');
  await other.evaluate(() => unlockFixture.deleteAll());
  assert.equal((await page.evaluate(() => unlockFixture.progress())).unlocked, true);
  await page.reload(); await page.waitForFunction(() => window.fixtureReady && document.querySelector('#coach').dataset.coach==='evil');
  assert.equal(await page.locator('.coach-choice[data-coach="evil"]').getAttribute('aria-disabled'), 'false');
  assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:join(root,'test-results/MeowlChess-evil-unlocked-mobile.png'),fullPage:true});
  await page.evaluate(() => unlockFixture.dispose()); await other.evaluate(() => unlockFixture.dispose());
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: visible locked coach, keyboard info, saved-preference gating, live7→10 progress, cross-tab unlock, permanence and320px layout.');
} catch (error) {
  if(errors.length)console.error(errors);
  await mkdir(join(root,'test-results'),{recursive:true});
  if(page)await page.screenshot({path:join(root,'test-results/MeowlChess-coach-unlock-failure.png'),fullPage:true}).catch(()=>{});
  throw new Error(`Coach unlock stage: ${stage}`,{cause:error});
} finally {
  await closeTestContext(context,profile,profilePrefix);
  if(dirname(bundle)===temporaryRoot&&basename(bundle).startsWith(bundlePrefix))await rm(bundle,{recursive:true,force:true,maxRetries:3});
}
