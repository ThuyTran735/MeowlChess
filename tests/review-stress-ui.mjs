import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { openImport, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const prefix = 'meowlchess-review-stress-', profile = await mkdtemp(join(tmpdir(), prefix));
let context;
async function poll(read, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH, headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${join(root, 'extension')}`, `--load-extension=${join(root, 'extension')}`],
  });
  const errors = [], requests = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    const Native = Worker; const active = new Set();
    window.workerStats = { active: 0, created: 0 };
    window.Worker = class extends Native {
      constructor(...args) { super(...args); active.add(this); window.workerStats.created++; window.workerStats.active = active.size; }
      terminate() { active.delete(this); window.workerStats.active = active.size; return super.terminate(); }
    };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await worker.evaluate(() => chrome.storage.local.set({ tutorialNeverShowAgain: true, supportNeverShowAgain: true }));
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('reviewSettings')).reviewSettings || {});
  const a = await context.newPage(), b = await context.newPage();
  const ready = page => page.waitForFunction(() => !document.querySelector('#open-tutorial').disabled);
  const settings = async (page, open) => {
    await closeLibrary(page);
    if (await page.locator('#review-settings').evaluate(el => el.open) !== open) await page.locator('#review-settings > summary').click();
  };
  await a.goto(`${origin}/review.html?siteSettings=1`); await ready(a);
  await b.goto(`${origin}/review.html?siteSettings=1`); await ready(b);
  await a.locator('#move-sounds').check(); await poll(async () => (await stored()).moveSounds === true, 'sounds saved');
  await b.locator('#board-size').focus(); await b.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await b.keyboard.press('ArrowRight');
  await poll(async () => (await stored()).boardSize === 480, 'board size saved');
  assert.equal((await stored()).moveSounds, true, 'Changing board size in an older tab must retain another tab\'s sound preference.');
  await a.locator('#play-speed').selectOption('2000');
  await poll(async () => (await stored()).playback === '2000', 'playback saved');
  assert.equal((await stored()).boardSize, 480, 'Changing playback must retain another tab\'s board size.');
  await b.reload(); await ready(b);
  assert.equal(await b.locator('#move-sounds').isChecked(), true);
  assert.equal(await b.locator('#play-speed').inputValue(), '2000');
  await a.evaluate(() => {
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    window.restorePreferenceStorage = () => { chrome.storage.local.set = set; };
    let fail = true;
    chrome.storage.local.set = values => {
      if (values.reviewSettings && fail) { fail = false; return Promise.reject(new Error('Temporary storage failure')); }
      return set(values);
    };
  });
  await a.locator('#board-size').focus(); await a.keyboard.press('Home');
  await poll(async () => /could not be saved/.test(await a.locator('#preferences-status').textContent()), 'failed preference write reported');
  await a.locator('#show-badges').uncheck();
  await poll(async () => { const value = await stored(); return value.boardSize === 320 && value.badges === false; }, 'next preference write retries unsaved choices');
  assert.equal((await stored()).moveSounds, true);
  assert.equal(await a.locator('#preferences-status').textContent(), '');
  await a.evaluate(() => window.restorePreferenceStorage());
  for (let run = 0; run < 24; run++) {
    await Promise.all([
      a.evaluate(checked => { const el = document.querySelector('#show-coordinates'); el.checked = checked; el.dispatchEvent(new Event('change', { bubbles: true })); }, run % 2 === 0),
      b.evaluate(checked => { const el = document.querySelector('#show-arrows'); el.checked = checked; el.dispatchEvent(new Event('change', { bubbles: true })); }, run % 2 === 0),
    ]);
  }
  await poll(async () => { const value = await stored(); return value.coordinates === false && value.arrows === false; }, 'concurrent settings converge');
  assert.equal((await stored()).boardSize, 320); assert.equal((await stored()).moveSounds, true);
  await b.close();
  console.log('PASS: cross-tab settings retain other choices, retry failed writes, and serialize rapid changes');

  const pgn = '[Event "UI transitions"]\n[White "White"]\n[Black "Black"]\n[Result "1/2-1/2"]\n\n1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. d4 Nf6 1/2-1/2';
  await openImport(a); await a.locator('#pgn-text').fill(pgn); await a.locator('#import-button').click(); await closeLibrary(a);
  await settings(a, true); await a.locator('#move-sounds').uncheck(); await a.locator('#multipv').selectOption('1'); await a.locator('#depth').selectOption('500'); await a.locator('#smart-analysis').uncheck(); await settings(a, false);
  for (const engine of ['lozza', 'stockfish']) {
    await settings(a, true); await a.locator('#engine').selectOption(engine); await settings(a, false);
    for (let run = 0; run < 10; run++) {
      await a.locator('#analyze-button').click();
      await poll(() => a.evaluate(() => window.workerStats.active > 0), 'engine start');
      await a.locator('#cancel-button').click();
      await poll(() => a.locator('#analyze-button').isEnabled(), 'cancellation returns controls');
      assert.equal(await a.evaluate(() => window.workerStats.active), 0, 'Canceled engine worker must terminate.');
      assert.equal(await a.locator('#progress-eta').textContent(), '');
      assert.match(await a.locator('#review-status').textContent(), /canceled/);
    }
  }
  await settings(a, true); await a.locator('#depth').selectOption('50'); await settings(a, false);
  await a.locator('#analyze-button').click();
  await poll(async () => /Saved on this device/.test(await a.locator('#save-status').textContent()) && await a.locator('#analyze-button').isEnabled(), 'review recovers after repeated cancellation', 60000);
  assert.equal(await a.evaluate(() => window.workerStats.active), 0);
  console.log('PASS: twenty start/cancel cycles leave no workers and completed analysis still saves');

  await a.locator('#moves-tab').click();
  for (let run = 0; run < 120; run++) {
    await a.evaluate(run => {
      document.querySelector(run % 2 ? '#first-button' : '#last-button').click();
      if (run % 3 === 0) document.querySelector('#flip-button').click();
      document.querySelector('#show-coordinates').checked = run % 2 === 0;
      document.querySelector('#show-coordinates').dispatchEvent(new Event('change', { bubbles: true }));
    }, run);
    assert.equal(await a.locator('#board > .square').count(), 64);
    assert.equal(await a.locator('#board .engine-overlay').count() <= 1, true);
  }
  await a.locator('#summary-tab').click();
  for (let run = 0; run < 12; run++) {
    await a.locator('#share-summary').click();
    const dialog = a.locator('#meowl-summary-share');
    await dialog.locator('[data-share-private]').waitFor({ state: 'visible' });
    await poll(() => dialog.locator('[data-share-private]').isEnabled(), 'privacy ready');
    await dialog.locator('[data-share-private]').setChecked(run % 2 === 0);
    await dialog.locator('.summary-share-close').click();
    assert.equal(await dialog.locator('img').getAttribute('src'), null, 'Closing pending render releases old preview.');
  }
  await a.locator('#share-summary').click();
  await poll(() => a.locator('#meowl-summary-share [data-share-save]').isEnabled(), 'share recovers after rapid close/reopen');
  assert.equal(await a.locator('#meowl-summary-share').count(), 1);
  await a.locator('#meowl-summary-share .summary-share-close').click();
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('PASS: rapid navigation, redraws and interrupted sharing preserve working controls');
} finally { await closeTestContext(context, profile, prefix); }
