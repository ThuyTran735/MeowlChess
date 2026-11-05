import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temp = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-polish-test-', bundlePrefix = 'MeowlChess-coach-polish-bundle-';
const profile = await mkdtemp(join(temp, profilePrefix));
const bundle = await mkdtemp(join(temp, bundlePrefix)), extension = join(bundle, 'extension');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess coach polish</title>
<link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css">
<style>:root{--text:#f1f0e9;--muted:#aba99e;--line:#ffffff12}body{margin:0;padding:16px;background:#20201d;color:var(--text);font:13px/1.6 Arial}main{display:flex;align-items:flex-start;justify-content:center;gap:30px}#coach{background:#2c2b27;border-radius:12px;max-width:370px;min-width:0;flex:1}.coach-companion{width:220px;flex:none}@media(max-width:600px){body{padding:10px}main{display:block}.coach-companion{margin:0 auto 18px;max-width:100%;width:300px}#coach{margin:auto}}</style>
<main><aside class="coach-companion" hidden><figure class="coach-companion-figure"><button type="button" class="coach-companion-greet"><img class="coach-avatar" alt=""></button><figcaption></figcaption></figure><div class="coach-companion-bubble" hidden><strong class="coach-walkthrough-heading"></strong><p class="coach-walkthrough-text"></p></div></aside><div id="coach"></div></main><script type="module" src="polish-fixture.js"></script>`;
const script = `
import { Chess } from './vendor/chess.js';
import { analyzeGame } from './lib/review.js';
import { createCoachView } from './lib/coach-view.js';
const pgn = '[Event "Coach presentation"]\\n[Result "1/2-1/2"]\\n\\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';
const game = {pgn}, result = await analyzeGame(pgn, {smartAnalysis:false, moveTimeMs:50, multiPV:1, engineFactory:()=>({async init(){},dispose(){},async evaluate(fen){const move = new Chess(fen).moves({verbose:true})[0]; const uci = move ? move.from+move.to+(move.promotion||'') : null; return {cp:0,mate:null,bestMove:uci,pv:uci?[uci]:[],depth:8,candidates:[]};}})});
// Synthetic grades exercise presentation and navigation; classifier tests cover their assignment.
result.moves.forEach((move,index)=>{move.label=['Book','Good','Great','Mistake','Best','Excellent'][index];});
const root=document.querySelector('#coach'), container=document.querySelector('.coach-companion');
const state={game,result,ply:0,active:true,moveReactionsActive:false,blockedReason:''};
let opens=0;
const view=createCoachView(root,{onOpen(){opens++;state.active=true;root.hidden=false;view.setContext(state);},onNavigate({ply}){state.ply=ply;view.setContext(state);},companionTarget:{container,image:container.querySelector('img'),name:container.querySelector('figcaption'),bubble:container.querySelector('.coach-companion-bubble'),heading:container.querySelector('strong'),text:container.querySelector('p')}});
window.polish={update(patch){Object.assign(state,patch);root.hidden=!state.active;view.setContext(state);},snapshot(){return{...state,opens};}};
view.setContext(state);window.fixtureReady=true;
`;
let context, page, stage = 'launch';
const errors = [], requests = [];
async function poll(read, message, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(message);
}
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'polish-fixture.html'), html);
  await writeFile(join(extension, 'polish-fixture.js'), script);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1100, height: 1000 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage(); await page.goto(`${origin}/polish-fixture.html`);
  await page.waitForFunction(() => window.fixtureReady);
  const update = patch => page.evaluate(patch => window.polish.update(patch), patch);
  const lastAnswer = page.locator('.coach-message[data-role="coach"]').last();
  stage = 'visual choices and keyboard';
  assert.equal(await page.locator('.coach-choice').count(), 7);
  assert.equal(await page.locator('.coach-select').isVisible(), false);
  await poll(() => page.locator('.coach-choice-portrait').evaluateAll(images => images.every(image => image.complete && image.naturalWidth)), 'All seven portraits load');
  assert.equal(new Set(await page.locator('.coach-choice-portrait').evaluateAll(images => images.map(image => image.src))).size, 7);
  await page.locator('.coach-choice[data-coach="meowl"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.coach-choice[aria-pressed="true"]').getAttribute('data-coach'), 'baby');
  await page.keyboard.press('End');
  assert.equal(await page.locator('.coach-choice[aria-pressed="true"]').getAttribute('data-coach'), 'scout');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.coach-choice[aria-pressed="true"]').getAttribute('data-coach'), 'meowl');
  assert.equal(await page.locator('.coach-choice[tabindex="0"]').count(), 2, 'The selected coach and locked unlock-information button are reachable by Tab.');
  await poll(() => page.evaluate(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences?.coach === 'meowl'), 'Choice is remembered');
  stage = 'distinct coaching styles and default prompts';
  const profiles = await page.evaluate(async () => (await import('./lib/coach.js')).COACHES);
  for (const profile of profiles.filter(profile => profile.id !== 'evil')) {
    await page.locator(`.coach-choice[data-coach="${profile.id}"]`).click();
    assert.equal(await page.locator('.coach-companion-personality').innerText(), profile.traits.join(' · '));
    assert.equal(await page.locator('.coach-description').innerText(), profile.description);
    assert.deepEqual(await page.locator('.coach-suggestion').evaluateAll(buttons => buttons.map(button => button.dataset.question)), [...profile.suggestions]);
  }
  await page.locator('.coach-choice[data-coach="meowl"]').click();
  stage = 'quiet preferences and contextual actions';
  assert.equal(await page.locator('.coach-settings').evaluate(element => element.open), false);
  await page.locator('.coach-settings-summary').click();
  assert.equal(await page.locator('.coach-sound-toggle').isChecked(), false);
  assert(await page.locator('.coach-volume').isVisible());
  stage = 'explicit animation preview and disabled motion';
  const beforePreview = await page.evaluate(() => window.polish.snapshot().ply);
  for (const kind of ['signature','greeting','talk','think','brilliant','great','approve','encourage']) {
    await page.locator('.coach-animation-choice').selectOption(kind);
    await page.locator('.coach-animation-preview').click();
    assert.equal(await page.locator(`.coach-companion .coach-actor[data-reaction="${kind}"]`).count(), 1);
  }
  assert.equal(await page.evaluate(() => window.polish.snapshot().ply), beforePreview, 'Preview never changes the board.');
  assert.equal(await page.locator('.coach-message').count(), 0, 'Preview never creates a fictional review comment.');
  await page.locator('.coach-motion-toggle').uncheck();
  assert(await page.locator('.coach-animation-preview').isDisabled());
  assert.equal(await page.locator('.coach-companion .coach-actor[data-reaction]').count(), 0);
  await page.locator('.coach-motion-toggle').check();
  await page.locator('.coach-settings-summary').click();
  await page.locator('.coach-position-action').click();
  assert.match(await lastAnswer.innerText(), /game|White|Black/);
  await update({ ply: 3 });
  assert.match(await page.locator('.coach-context').innerText(), /Nf3/);
  assert(await page.locator('.coach-suggestion[data-question="Next key moment"]').isVisible());
  await page.locator('.coach-suggestion[data-question="Next key moment"]').click();
  await lastAnswer.locator('.coach-jump[data-ply="4"]').click();
  assert.equal(await page.evaluate(() => window.polish.snapshot().ply), 4);
  stage = 'companion action and practice guard';
  await update({ ply: 3, active: false, moveReactionsActive: true });
  await page.locator('.coach-companion-ask').waitFor({ state: 'visible' });
  await page.locator('.coach-companion-ask').click();
  assert.equal(await page.evaluate(() => window.polish.snapshot().opens), 1);
  assert(await page.locator('#coach').isVisible());
  assert.match(await lastAnswer.innerText(), /Nf3|Great|position/i);
  await update({ blockedReason: 'Finish your practice attempt first.', active: false });
  assert.equal(await page.locator('.coach-companion-bubble').isVisible(), false);
  await page.locator('.coach-companion-ask').evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.polish.snapshot().opens), 1, 'A retained action cannot reveal practice hints.');
  await update({ blockedReason: '', active: true });
  stage = 'mobile layout';
  await page.locator('.coach-settings-summary').click();
  await mkdir(join(root, 'test-results'), { recursive: true });
  for (const width of [1100, 768, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Fits ${width}px`);
    for (const selector of ['.coach-roster', '.coach-position-card', '.coach-suggestions', '.coach-question', '.coach-animation-controls']) {
      const box = await page.locator(selector).boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width + 1, `${selector} fits ${width}px`);
    }
    if (width === 360 || width === 1100) await page.screenshot({ path: join(root, 'test-results', `MeowlChess-coach-polish-${width}.png`), fullPage: true });
  }
  await page.locator('.coach-animation-choice').selectOption('greeting');
  await page.locator('.coach-animation-preview').click();
  const previewBounds = await page.locator('.coach-companion .coach-avatar').boundingBox();
  assert(previewBounds && previewBounds.y >= -1 && previewBounds.y + previewBounds.height <= 1001, 'Explicit mobile preview brings the coach into view.');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('PASS: visual coach selection, keyboard/persistence, quiet settings, contextual actions, companion entry, practice guard, mobile layout.');
} catch (error) {
  if (page) { await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-polish-failure.png'), fullPage: true }).catch(() => {}); }
  throw new Error(`Coach polish failed at ${stage}: ${error.message}`, { cause: error });
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) === temp && basename(absolute).startsWith(bundlePrefix)) await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
}
