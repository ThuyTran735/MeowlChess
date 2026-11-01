import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { openImport, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temp = resolve(tmpdir());
const profile = await mkdtemp(join(temp, 'meowlchess-alerts-test-'));
const bundle = await mkdtemp(join(temp, 'meowlchess-alerts-bundle-')), extension = join(bundle, 'extension');
const pgn = event => `[Event "${event}"]\n[White "sitecat"]\n[Black "siteowl"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1`;
const stamp = Math.floor(Date.now() / 1000) - 60;
let context, page, worker, stage = 'launch';
const errors = [], external = [];
const wait = async (read, label, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error(`Timed out: ${label}`);
};
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  assert(manifest.optional_permissions.includes('notifications'));
  assert(!manifest.permissions.includes('notifications'), 'Production notification access is optional.');
  manifest.permissions = [...new Set([...manifest.permissions, 'notifications', 'scripting'])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...manifest.optional_host_permissions])];
  delete manifest.optional_permissions; delete manifest.optional_host_permissions;
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  // Capture the same callback registered with the native click event. Only this
  // disposable test copy exposes it; production does not expose test controls.
  const background = await readFile(join(extension, 'background.js'), 'utf8');
  assert(background.includes('registerNotificationClicks();'));
  await writeFile(join(extension, 'background.js'), background.replace('registerNotificationClicks();', 'registerNotificationClicks();\nglobalThis.__clickCompletionNotification = notificationClicked;'));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    // Playwright deliberately keeps every target visible/focused. Simulate only
    // this browser signal; engine, save, sender validation, and alert flow stay real.
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__alertHidden ?? hidden.call(document) });
    window.__engineSearches = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) { if (typeof message === 'string' && /^go\b/.test(message)) window.__engineSearches++; return post.call(this, message, ...args); };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (window.__blockReviewWrites && value?.result?.moves) throw new DOMException('Test storage failure', 'QuotaExceededError');
      return put.call(this, value, ...args);
    };
  });
  await context.route(/^https?:\/\//, route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && url.hostname === 'www.chess.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Completed game</title><body style="background:#302e2b"><div class="game-over-component result">Game over 0-1</div></body>' });
    if (url.pathname !== '/favicon.ico') external.push(request.url()); return route.abort();
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await worker.evaluate(async () => {
    globalThis.__alerts = []; globalThis.__clearedAlerts = []; globalThis.__alertLevel = 'granted';
    // Exercise the production notification adapter while suppressing OS popups.
    chrome.notifications.create = (id, options, callback) => { __alerts.push({ id, options }); callback(id); };
    chrome.notifications.clear = (id, callback) => { __clearedAlerts.push(id); callback(true); };
    chrome.notifications.getPermissionLevel = callback => callback(__alertLevel);
    chrome.notifications.getAll = callback => callback(Object.fromEntries(__alerts.map(item => [item.id, true])));
    await chrome.storage.local.set({ completionAlerts: true, tutorialNever: true, supportNever: true, reviewSettings: { engine: 'lozza', time: '500', lines: '1', smart: false } });
  });
  const alerts = () => worker.evaluate(() => globalThis.__alerts);
  const count = async () => (await alerts()).length;
  const visibility = (target, hidden) => target.evaluate(value => { window.__alertHidden = value; document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  const spare = await context.newPage(); await spare.goto('about:blank');
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/review.html`); await page.bringToFront();
  const importGame = async event => {
    await openImport(page); await page.locator('#pgn-text').fill(pgn(event)); await page.locator('#import-button').click(); await closeLibrary(page);
  };
  const done = async () => page.waitForFunction(() => /Review complete/.test(document.querySelector('#review-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { polling: 100, timeout: 45000 });
  const saved = async () => page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent), null, { polling: 100, timeout: 45000 });
  stage = 'visible review completes without an alert';
  await importGame('Visible alert fixture');
  assert.equal(await page.evaluate(() => document.hidden), false);
  await page.locator('#analyze-button').click(); await done(); await saved();
  assert.equal(await count(), 0);
  stage = 'hidden fresh save creates one notification';
  await page.locator('#analyze-button').click(); await spare.bringToFront(); await visibility(page, true);
  await done(); await saved(); await wait(async () => await count() === 1, 'hidden main completion alert');
  const first = (await alerts())[0];
  assert.match(first.id, /^meowl-review-game-[a-f0-9]{64}$/);
  assert.match(first.options.message, /sitecat vs siteowl/); assert.equal(first.options.silent, true);
  assert.equal(first.options.iconUrl, `${origin}/icons/icon128.png`);
  stage = 'notification click opens the exact saved review without analysis';
  const open = context.waitForEvent('page'); await worker.evaluate(id => __clickCompletionNotification(id), first.id);
  const opened = await open; opened.on('pageerror', error => errors.push(error.message));
  await opened.waitForURL(`${origin}/review.html?reviewId=${first.id.slice('meowl-review-'.length)}`);
  await opened.waitForFunction(() => document.querySelector('#summary-tab').getAttribute('aria-selected') === 'true' && /Starting position/.test(document.querySelector('#position-label').textContent));
  assert.equal(await opened.evaluate(() => __engineSearches), 0); assert.equal(await count(), 1);
  await opened.close();
  stage = 'canceled review never alerts';
  await page.bringToFront(); await visibility(page, false); await importGame('Canceled alert fixture');
  await page.locator('#analyze-button').click(); await page.locator('#cancel-button').click(); await spare.bringToFront();
  await page.waitForFunction(() => /Review canceled/.test(document.querySelector('#review-status').textContent), null, { polling: 100 });
  assert.equal(await count(), 1);
  stage = 'save failure never alerts';
  await page.bringToFront(); await visibility(page, false); await importGame('Failed save alert fixture'); await page.evaluate(() => { window.__blockReviewWrites = true; });
  await page.locator('#analyze-button').click(); await spare.bringToFront(); await visibility(page, true); await done();
  await page.waitForFunction(() => /not saved/.test(document.querySelector('#save-status').textContent), null, { polling: 100 });
  assert.equal(await count(), 1); await page.evaluate(() => { window.__blockReviewWrites = false; });
  stage = 'native notification denial suppresses toast';
  await worker.evaluate(() => { __alertLevel = 'denied'; });
  await page.bringToFront(); await visibility(page, false); await importGame('Denied alert fixture');
  await page.locator('#analyze-button').click(); await spare.bringToFront(); await visibility(page, true); await done(); await saved();
  assert.equal(await count(), 1);
  await worker.evaluate(() => { __alertLevel = 'granted'; });
  stage = 'opt-in accepted site frame completes while hidden';
  await worker.evaluate(async ({ pgn, stamp }) => {
    globalThis.fetch = async input => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/archives')) return { ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/sitecat/games/2026/11'] }) };
      if (url.includes('api.chess.com')) return { ok: true, json: async () => ({ games: [{ url: 'https://www.chess.com/game/live/888880001', pgn, rules: 'chess', time_class: 'rapid', end_time: stamp, white: { username: 'sitecat', result: 'checkmated' }, black: { username: 'siteowl', result: 'win' } }] }) };
      throw new Error('Unexpected archive transport ' + url);
    };
    await chrome.storage.local.set({ siteReviewSettings: { chesscom: { enabled: true, username: 'sitecat' }, lichess: { enabled: false, username: '' } } });
  }, { pgn: pgn('Hidden site alert fixture'), stamp });
  await wait(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).some(item => item.id === 'meowl-site-chesscom')), 'site helper registered');
  const site = await context.newPage(); site.on('pageerror', error => errors.push(error.message));
  await site.goto('https://www.chess.com/game/live/888880001'); await site.bringToFront();
  let frame;
  await wait(() => { frame = site.frames().find(item => /site-summary\.html#/.test(item.url())); return frame; }, 'site summary frame');
  await frame.waitForFunction(() => document.querySelector('main').dataset.stage === 'analyzing');
  const frameUrl = frame.url();
  await spare.bringToFront(); await visibility(frame, true);
  await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.chess.com/game/live/888880001' }))[0];
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    } });
  });
  assert.equal(frame.isDetached(), false);
  await frame.waitForFunction(() => !document.querySelector('#summary-result').hidden && !document.querySelector('#summary-open-review').disabled, null, { polling: 100, timeout: 45000 });
  await wait(async () => await count() === 2, 'hidden site completion alert');
  assert.equal(frame.url(), frameUrl); assert.equal(frame.isDetached(), false);
  await site.bringToFront(); await visibility(frame, false);
  await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.chess.com/game/live/888880001' }))[0];
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); } });
  });
  assert.equal(site.frames().find(item => item.url() === frameUrl), frame);
  const siteAlert = (await alerts())[1]; assert.notEqual(siteAlert.id, first.id);
  const siteOpen = context.waitForEvent('page'); await worker.evaluate(id => __clickCompletionNotification(id), siteAlert.id);
  const siteReview = await siteOpen; await siteReview.waitForURL(`${origin}/review.html?reviewId=${siteAlert.id.slice('meowl-review-'.length)}`);
  await siteReview.waitForFunction(() => /Saved review loaded/.test(document.querySelector('#review-status').textContent));
  assert.equal(await siteReview.evaluate(() => __engineSearches), 0); assert.equal(await count(), 2); await siteReview.close();
  stage = 'opt-out clears existing alerts';
  await worker.evaluate(() => chrome.storage.local.set({ completionAlerts: false }));
  await wait(() => worker.evaluate(() => __clearedAlerts.includes(__alerts[1].id)), 'opt-out clears notifications');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Completion alerts UI: real engine/save and exact saved click; simulated visibility and OS adapter cover fresh/visible/reused/canceled/failed/denied reviews, site continuation, and opt-out.');
} catch (error) {
  console.error('Completion alerts UI stage:', stage);
  console.error('Alerts:', await worker?.evaluate(() => globalThis.__alerts).catch(() => null));
  console.error('Tabs:', await worker?.evaluate(async () => (await chrome.tabs.query({})).map(({ id, url, active, windowId }) => ({ id, url, active, windowId }))).catch(() => null));
  console.error('Review visibility:', await page?.evaluate(() => ({ hidden: document.hidden, state: document.visibilityState, focus: document.hasFocus() })).catch(() => null));
  if (page && !page.isClosed()) { await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'completion-alerts-failure.png') }).catch(() => {}); }
  throw error;
} finally {
  await closeTestContext(context, profile, 'meowlchess-alerts-test-');
  if (resolve(bundle).startsWith(temp + '\\') && /meowlchess-alerts-bundle-/.test(bundle)) await rm(bundle, { recursive: true, force: true });
}
