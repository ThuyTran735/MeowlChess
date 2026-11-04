import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';
const root = resolve(import.meta.dirname, '..'), prefix = 'MeowlChess-lifecycle-test-';
const profile = await mkdtemp(join(tmpdir(), prefix));
const scripts = await Promise.all(['site-panel.js', 'site-content.js'].map(name => readFile(join(root, 'extension', name), 'utf8')));
let context;
const settings = enabled => ({ chesscom: { enabled, username: 'sitecat' } });
const poll = async (fn, label) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Timed out: ${label}`);
};
try {
  context = await chromium.launchPersistentContext(profile, { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true, viewport: { width: 1100, height: 800 } });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0; background:#302e2b}</style><div class="game-over-component">Game over</div>' }));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  async function setup({ url = 'https://www.chess.com/game/991122334', metadata = null, result = true } = {}) {
    await page.goto(url);
    await page.evaluate(({ metadata, result }) => {
      if (!result) document.querySelector('.game-over-component').remove();
      for (const [attribute, name, content] of [
        ['property', 'og:url', metadata?.url], ['name', 'description', metadata?.description], ['property', 'og:description', metadata?.ogDescription],
      ]) if (content !== undefined) {
        const meta = document.createElement('meta'); meta.setAttribute(attribute, name); meta.content = content; document.head.append(meta);
      }
      const listeners = new Set(), roots = new WeakMap(), attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(...args) { const root = attach.apply(this, args); roots.set(this, root); return root; };
      window.lifecycle = { reads: [], calls: [], pending: [], hold: false,
        change(values) { for (const fn of listeners) fn(values, 'local'); },
        shadow(id) { return roots.get(document.getElementById(id)); },
      };
      window.chrome ??= {};
      chrome.runtime = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getURL: path => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path, sendMessage: async message => {
        lifecycle.calls.push(message);
        if (lifecycle.hold) await new Promise(resolve => lifecycle.pending.push(resolve));
        return { status: 'waiting', retryAfterMs: 15000, message: 'Waiting for this completed game.' };
      } };
      chrome.storage = { local: { get: keys => Array.isArray(keys) ? new Promise(resolve => lifecycle.reads.push(resolve)) : Promise.resolve({}), set: async () => {} }, onChanged: { addListener: fn => listeners.add(fn) } };
    }, { metadata, result });
    for (const source of scripts) await page.addScriptTag({ content: source });
  }
  await setup();
  await page.evaluate(({ newer, old }) => {
    lifecycle.change({ siteReviewSettings: { newValue: newer } });
    lifecycle.reads.shift()({ siteReviewSettings: old, completionAlerts: false });
  }, { newer: settings(false), old: settings(true) });
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => lifecycle.calls.filter(x => x.type === 'meowl:site-check').length), 0, 'An older initial read cannot re-enable a disabled site.');
  assert.equal(await page.locator('#meowlchess-site-review').count(), 0);

  await setup();
  await page.evaluate(value => lifecycle.reads.shift()({ siteReviewSettings: value }), settings(true));
  await page.locator('#meowlchess-site-review').waitFor();
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.evaluate(({ old, newer }) => {
    lifecycle.change({ siteReviewSettings: { newValue: newer } });
    lifecycle.reads.shift()({ siteReviewSettings: old });
  }, { old: settings(true), newer: settings(false) });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#meowlchess-site-review').count(), 0, 'A delayed restore cannot recreate a disabled panel.');

  await setup();
  await page.evaluate(value => lifecycle.reads.shift()({ siteReviewSettings: value }), settings(true));
  await page.locator('#meowlchess-site-review').waitFor();
  for (let round = 0; round < 80; round++) {
    await page.evaluate(() => lifecycle.shadow('meowlchess-site-review').querySelector('[aria-label="Close review"]').click());
    await page.locator('#meowlchess-site-launcher').waitFor();
    await page.evaluate(() => lifecycle.shadow('meowlchess-site-launcher').querySelector('button').click());
    await page.locator('#meowlchess-site-review').waitFor();
    assert.equal(await page.locator('#meowlchess-site-review').count(), 1);
    assert.equal(await page.locator('#meowlchess-site-launcher').count(), 0);
    if (round % 10 === 0) {
      await page.setViewportSize(round % 20 === 0 ? { width: 320, height: 300 } : { width: 1100, height: 800 });
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const rect = await page.locator('#meowlchess-site-review').boundingBox();
      assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= page.viewportSize().width && rect.y + rect.height <= page.viewportSize().height, 'Recreated panel remains reachable after a viewport change.');
    }
  }
  await page.evaluate(value => {
    lifecycle.hold = true;
    history.pushState({}, '', '/game/991122335');
  }, settings(true));
  await poll(() => page.evaluate(() => lifecycle.pending.length > 0), 'held navigation request');
  await page.evaluate(value => {
    lifecycle.change({ siteReviewSettings: { newValue: value } });
    lifecycle.hold = false; lifecycle.pending.splice(0).forEach(resolve => resolve());
  }, settings(false));
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#meowlchess-site-review, #meowlchess-site-launcher, #meowlchess-drag-shield, #meowlchess-resize-shield').count(), 0, 'Late work after disabling creates no panel or shield.');
  await page.evaluate(() => {
    chrome.storage.local.get = () => { throw new Error('Extension context invalidated.'); };
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.waitForTimeout(50);

  const replay = 'https://www.chess.com/game/live/186378605424';
  const finishedDescription = 'NaGmOr-5 (958) vs DillPickleChips1 (988). DillPickleChips1 won by resignation in 38 moves over 14 minutes. Click to review the game, move by move.';
  await setup({ url: 'https://www.chess.com/game/186378605424?move=0', metadata: { url: replay, description: finishedDescription }, result: false });
  await page.evaluate(value => lifecycle.reads.shift()({ siteReviewSettings: value }), settings(true));
  await page.locator('#meowlchess-site-review').waitFor();
  assert.equal(await page.evaluate(() => lifecycle.calls.find(call => call.type === 'meowl:site-check')?.refreshCompleted), true, 'A matching finished replay at move zero starts retrieval without a modal.');
  await page.evaluate(() => { lifecycle.calls.length = 0; history.pushState({}, '', '/game/186378605425'); });
  await poll(() => page.evaluate(() => lifecycle.calls.some(call => call.type === 'meowl:site-check')), 'new game route with prior replay metadata');
  assert.equal(await page.evaluate(() => lifecycle.calls.some(call => call.refreshCompleted === true)), false, 'Stale metadata cannot mark the next SPA game complete.');
  assert.equal(await page.locator('#meowlchess-site-review').count(), 0);

  for (const fixture of [
    { metadata: { url: 'https://chess.com/game/991122334', ogDescription: 'The game was drawn by repetition in 72 moves.' }, finished: true },
    { metadata: null, finished: false },
    { metadata: { url: 'https://www.chess.com/game/live/991122334', description: 'sitecat vs siteowl. Game in progress. Watch live.' }, finished: false },
    { metadata: { url: 'https://www.chess.com/game/live/991122335', description: finishedDescription }, finished: false },
    { metadata: { url: 'https://www.chess.com.evil.invalid/game/live/991122334', description: finishedDescription }, finished: false },
    { metadata: { url: 'https://visitor@www.chess.com/game/live/991122334', description: finishedDescription }, finished: false },
    { metadata: { url: 'http://www.chess.com/game/live/991122334', description: finishedDescription }, finished: false },
    { url: 'https://www.chess.com/play/online', metadata: { url: replay, description: finishedDescription }, finished: false },
  ]) {
    await setup({ ...fixture, result: false });
    await page.evaluate(value => lifecycle.reads.shift()({ siteReviewSettings: value }), settings(true));
    await poll(() => page.evaluate(() => lifecycle.calls.some(call => call.type === 'meowl:site-check')), 'replay metadata check');
    assert.equal(await page.evaluate(() => lifecycle.calls.some(call => call.refreshCompleted === true)), fixture.finished, JSON.stringify(fixture));
    if (fixture.finished) await page.locator('#meowlchess-site-review').waitFor();
    else assert.equal(await page.locator('#meowlchess-site-review').count(), 0);
  }
  await setup();
  await page.evaluate(value => lifecycle.reads.shift()({ siteReviewSettings: value }), settings(true));
  await page.locator('#meowlchess-site-review').waitFor();
  const originalUrl = page.url();
  await page.evaluate(() => {
    document.getElementById('meowlchess-site-review').dataset.busy = 'true';
    chrome.runtime.id = undefined;
  });
  await page.locator('#MeowlChess-page-refresh').waitFor();
  assert.equal(page.url(), originalUrl, 'An invalidated helper never refreshes automatically.');
  assert.equal(await page.evaluate(() => lifecycle.shadow('MeowlChess-page-refresh').querySelector('button').disabled), true, 'Refresh waits for active review completion.');
  assert.equal(await page.locator('#meowlchess-site-review').count(), 1, 'The existing review remains visible.');
  await page.evaluate(() => { document.getElementById('meowlchess-site-review').dataset.busy = 'false'; });
  await poll(() => page.evaluate(() => !lifecycle.shadow('MeowlChess-page-refresh').querySelector('button').disabled), 'refresh enabled after review');
  await page.evaluate(() => lifecycle.shadow('MeowlChess-page-refresh').querySelectorAll('button')[1].click());
  assert.equal(await page.locator('#MeowlChess-page-refresh').count(), 0, 'Later dismisses the notice.');
  assert.equal(page.url(), originalUrl);
  await page.evaluate(() => { delete globalThis.__meowlChessSiteReview; chrome.runtime.id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; document.getElementById('meowlchess-site-review').dataset.busy = 'true'; });
  await page.addScriptTag({ content: scripts[1] });
  assert.equal(await page.locator('#meowlchess-site-review').count(), 1, 'Reinjection never duplicates an old panel.');
  assert.equal(await page.locator('#MeowlChess-page-refresh').count(), 1);
  await page.evaluate(() => lifecycle.shadow('MeowlChess-page-refresh').querySelectorAll('button')[2].click());
  assert.equal(page.url(), originalUrl, 'Choosing stuck-review recovery still needs explicit refresh confirmation.');
  assert.equal(await page.evaluate(() => lifecycle.shadow('MeowlChess-page-refresh').querySelector('button').textContent), 'Stop review and refresh');
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.evaluate(() => lifecycle.shadow('MeowlChess-page-refresh').querySelector('button').click()),
  ]);
  assert.equal(page.url(), originalUrl, 'Explicit refresh keeps the current game URL.');
  assert.equal(await page.locator('#meowlchess-site-review').count(), 0, 'Only the explicit refresh replaced the old document.');
  assert.deepEqual(errors, []);
  console.log('Site lifecycle assertions passed.');
} finally { await closeTestContext(context, profile, prefix); }
