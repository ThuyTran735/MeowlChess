import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { openLibrary, closeLibrary, openImport, openMoves, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), extension = join(root, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-reviewed-test-'));
const white = 'WhitePlayerWithALongName', black = 'BlackPlayerWithALongName';
const title = `${white} vs ${black}`;
const pgn = `[Event "Reviewed badge test"]\n[Site "Chess.com"]\n[Date "2026.10.31"]\n[Round "1"]\n[White "${white}"]\n[Black "${black}"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1`;
const differentPgn = pgn.replace('[Round "1"]', '[Round "2"]');
const commented = pgn.replace('1. f3 e5', '1. f3 {Same game, with a comment.}\n e5');
const game = { source: 'chesscom', url: 'https://www.chess.com/game/live/12345', pgn, rules: 'chess', time_class: 'rapid', end_time: 1793462400, white: { username: white, result: 'checkmated', rating: 1200 }, black: { username: black, result: 'win', rating: 1220 } };
const differentGame = { ...game, url: 'https://www.chess.com/game/live/12346', pgn: differentPgn, end_time: game.end_time - 3600 };
let context, page, stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const unexpected = [], errors = [];
  await context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url === 'https://api.chess.com/pub/player/reader/games/archives') return route.fulfill({ json: { archives: ['https://api.chess.com/pub/player/reader/games/2026/10'] } });
    if (url === 'https://api.chess.com/pub/player/reader/games/2026/10') return route.fulfill({ json: { games: [differentGame, game] } });
    unexpected.push(url); return route.abort();
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.engineCommands = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(command, ...args) { if (typeof command === 'string') window.engineCommands.push(command); return send.call(this, command, ...args); };
  });
  await mkdir(join(root, 'test-results'), { recursive: true });
  const capture = name => page.screenshot({ path: join(root, 'test-results', `reviewed-${name}.png`), fullPage: true });
  const commands = () => page.evaluate(() => window.engineCommands.length);
  const idle = () => page.waitForFunction(() => !document.querySelector('#analyze-button').disabled && !document.querySelector('#library-dialog').open);
  const recent = index => page.locator(`#games .game-card[data-index="${index}"]`);
  const imported = index => page.locator(`#import-games .game-card[data-index="${index}"]`);
  const waitBadge = async (selector, present = true, older = false) => page.waitForFunction(({ selector, present, older }) => {
    const badge = document.querySelector(selector)?.querySelector('.reviewed-badge');
    return present ? !!badge && badge.textContent === (older ? 'Reviewed · older' : 'Reviewed') : !badge;
  }, { selector, present, older });
  const assertSaved = async (before, older = false) => {
    await idle();
    assert.equal(await page.locator('#summary-panel').isVisible(), true);
    assert.equal(await page.locator('#position-label').innerText(), 'Starting position');
    assert.match(await page.locator('#review-status').innerText(), older ? /older analysis version/ : /Saved review loaded/);
    assert.equal(await commands(), before, 'Opening saved analysis must not issue engine commands.');
  };
  const openSavedPanel = async () => {
    await openLibrary(page);
    if (!await page.locator('#saved-panel').evaluate(el => el.open)) await page.locator('#saved-panel > summary').click();
  };
  const importText = async text => {
    await openImport(page); await page.locator('#pgn-text').fill(text); await page.locator('#import-button').click();
    await page.waitForFunction(() => !document.querySelector('#import-button').disabled);
  };
  const rawRecord = async (target, operation, value) => target.evaluate(async ({ operation, value }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('meowlchess-review-library', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('reviews', operation === 'read' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('reviews');
        const request = operation === 'read' ? store.get(value) : operation === 'put' ? store.put(value) : store.delete(value);
        let result; request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => resolve(result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, { operation, value });
  const assertTitles = async selector => {
    const values = await page.locator(selector).evaluateAll(items => items.map(el => ({ text: el.textContent, title: el.title })));
    assert(values.length, `Expected names at ${selector}`);
    for (const value of values) assert.equal(value.title, value.text, `Full title must be retained at ${selector}`);
  };

  await page.goto(`${origin}/review.html`);
  await openLibrary(page); await page.locator('#username').fill('reader'); await page.locator('#load-button').click(); await idle();
  assert.equal(await page.locator('#game-title').innerText(), title);
  await page.locator('#review-settings > summary').click();
  await page.locator('#depth').selectOption('50'); await page.locator('#multipv').selectOption('1'); await page.locator('#smart-analysis').uncheck();
  await page.locator('#review-settings > summary').click(); await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 45000 });
  const record = await page.evaluate(async () => {
    const { createReviewLibrary } = await import('./lib/library.js'), { ANALYSIS_VERSION } = await import('./lib/review.js');
    const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
    try { const records = await library.listReviews(); return await library.loadReview(records[0].id); } finally { await library.close(); }
  });
  const pristine = structuredClone(record);
  let timestamp = record.updatedAt;
  const restore = async target => { const copy = structuredClone(pristine); copy.updatedAt = ++timestamp; await rawRecord(target, 'put', copy); };
  stage = 'reviewed recent game and full-name tooltips';
  await assertTitles('#game-title, #top-player, #bottom-player, .score-info strong');
  await openMoves(page); await page.locator('#move-list .move-button[data-ply="1"]').click(); await page.locator('#bookmark-position').click();
  await page.waitForFunction(() => document.querySelector('#bookmark-position').getAttribute('aria-pressed') === 'true');
  await openSavedPanel(page); await waitBadge('#games .game-card[data-index="0"]');
  assert.equal(await recent(1).locator('.reviewed-badge').count(), 0, 'Different round must not match the saved game.');
  await assertTitles('#games .game-card > strong, .saved-open strong');
  assert.equal(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth === 128 && img.naturalHeight === 128), true);
  const assertSavedFits = async () => {
    const layout = await page.evaluate(() => {
      const container = document.querySelector('#saved-games'), label = container.querySelector('.saved-open strong');
      const button = container.querySelector('.saved-delete').getBoundingClientRect(), bounds = container.getBoundingClientRect();
      return { fits: container.scrollWidth <= container.clientWidth, truncated: label.scrollWidth > label.clientWidth,
        title: label.title, text: label.textContent, deleteVisible: button.left >= bounds.left && button.right <= bounds.right && button.top >= bounds.top && button.bottom <= bounds.bottom };
    });
    assert(layout.fits, 'Saved games must not scroll horizontally.');
    assert(layout.truncated, 'Long saved names must actually truncate.');
    assert.equal(layout.title, layout.text, 'Truncated saved names must retain their full tooltip.');
    assert(layout.deleteVisible, 'Delete must remain within the visible saved-game list.');
  };
  await assertSavedFits(); await capture('picker-desktop');
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await assertSavedFits(); await capture('picker-mobile');
  await page.setViewportSize({ width: 1366, height: 900 });
  let before = await commands(); await recent(0).click(); await assertSaved(before);
  await openLibrary(page); await page.locator('#open-notebook').click(); await assertTitles('#bookmark-items .notebook-item strong');
  console.log('PASS: recent Reviewed badge, distinct-game guard, direct saved opening, full-name tooltips, icon and responsive picker');

  stage = 'automatic archive first game and imported identity';
  await openLibrary(page); before = await commands(); await page.locator('#load-button').click(); await assertSaved(before);
  before = await commands(); await importText(commented); await assertSaved(before);
  await importText(`${commented}\n\n${differentPgn}`);
  await waitBadge('#import-games .game-card[data-index="0"]');
  assert.equal(await imported(1).locator('.reviewed-badge').count(), 0);
  await assertTitles('#import-games .game-card > strong');
  before = await commands(); await imported(0).click(); await assertSaved(before);
  console.log('PASS: archive auto-selection and single/multi PGN imports reuse canonical saved analysis without an engine run');

  stage = 'stale analysis';
  const stale = structuredClone(pristine); stale.updatedAt = ++timestamp;
  stale.analysis.analysisVersion = 'old-review-test'; stale.result.analysis.version = 'old-review-test';
  await rawRecord(page, 'put', stale); await openLibrary(page); await waitBadge('#games .game-card[data-index="0"]', true, true);
  before = await commands(); await recent(0).click(); await assertSaved(before, true);
  console.log('PASS: older analysis is marked, opens without reanalysis, and retains its warning');

  stage = 'removed saved game after badge is displayed';
  await restore(page); await openLibrary(page); await waitBadge('#games .game-card[data-index="0"]');
  await rawRecord(page, 'delete', record.id);
  assert.equal(await recent(0).locator('.reviewed-badge').count(), 1, 'Keep the displayed snapshot until the user opens the game.');
  before = await commands(); await recent(0).click(); await idle();
  assert.equal(await page.locator('#analyze-button').innerText(), 'Review game');
  assert.equal(await page.locator('#game-title').innerText(), title); assert.equal(await commands(), before);
  await openLibrary(page); await waitBadge('#games .game-card[data-index="0"]', false); await closeLibrary(page);

  stage = 'deeply corrupt saved analysis';
  await restore(page);
  const corrupt = await rawRecord(page, 'read', record.id); corrupt.updatedAt = ++timestamp;
  corrupt.result.positions[0].pv = ['a1a8']; // Valid UCI syntax, illegal in the starting position.
  await rawRecord(page, 'put', corrupt); await openLibrary(page); await waitBadge('#games .game-card[data-index="0"]');
  before = await commands(); await recent(0).click(); await idle();
  assert.equal(await page.locator('#analyze-button').innerText(), 'Review game');
  assert.match(await page.locator('#review-status').innerText(), /Saved analysis could not be opened/); assert.equal(await commands(), before);
  await openLibrary(page); await waitBadge('#games .game-card[data-index="0"]', false); await closeLibrary(page);
  console.log('PASS: deleted/corrupt saves fall back to the original game without engine activity or a stuck Reviewed badge');

  stage = 'cross-tab refresh and deletion through the UI';
  const other = await context.newPage(); await other.goto(`${origin}/review.html?siteSettings=1`);
  await other.waitForFunction(() => !document.querySelector('#open-tutorial').disabled);
  await restore(other); await page.bringToFront(); await openLibrary(page); await waitBadge('#games .game-card[data-index="0"]');
  await closeLibrary(page); await rawRecord(other, 'delete', record.id); await openLibrary(page); await waitBadge('#games .game-card[data-index="0"]', false);
  await closeLibrary(page); await restore(other); await openSavedPanel(page); await waitBadge('#games .game-card[data-index="0"]');
  await page.locator(`.saved-open[data-review-id="${record.id}"]`).locator('..').locator('.saved-delete').click();
  await page.waitForFunction(() => document.querySelector('#saved-count').textContent === '0');
  await waitBadge('#games .game-card[data-index="0"]', false);
  await other.close();
  console.log('PASS: reopening Games observes another tab’s save/delete and local delete removes the badge');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log('Reviewed-game and name-tooltip browser checks passed.');
} catch (error) {
  console.error(`FAIL at ${stage}`);
  if (page) await page.screenshot({ path: join(root, 'test-results', 'reviewed-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await closeTestContext(context, profile, 'meowlchess-reviewed-test-'); }
