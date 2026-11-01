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
  async function setup() {
    await page.goto('https://www.chess.com/game/991122334');
    await page.evaluate(() => {
      const listeners = new Set(), roots = new WeakMap(), attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(...args) { const root = attach.apply(this, args); roots.set(this, root); return root; };
      window.lifecycle = { reads: [], calls: [], pending: [], hold: false,
        change(values) { for (const fn of listeners) fn(values, 'local'); },
        shadow(id) { return roots.get(document.getElementById(id)); },
      };
      window.chrome ??= {};
      chrome.runtime = { getURL: path => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path, sendMessage: async message => {
        lifecycle.calls.push(message);
        if (lifecycle.hold) await new Promise(resolve => lifecycle.pending.push(resolve));
        return { status: 'waiting', retryAfterMs: 15000, message: 'Waiting for this completed game.' };
      } };
      chrome.storage = { local: { get: keys => Array.isArray(keys) ? new Promise(resolve => lifecycle.reads.push(resolve)) : Promise.resolve({}), set: async () => {} }, onChanged: { addListener: fn => listeners.add(fn) } };
    });
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
  assert.deepEqual(errors, []);
  console.log('Site lifecycle assertions passed.');
} finally { await closeTestContext(context, profile, prefix); }
