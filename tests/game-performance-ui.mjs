import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { estimateGameRatings } from '../extension/lib/game-rating.js';
import { getPhasePerformance } from '../extension/lib/game-performance.js';
import { openImport, openLibrary, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-performance-test-'));
const pgn = '[Event "Performance summary"]\n[White "White player"]\n[Black "Black player"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 11. Qf3 Be7 12. Rfe1 Be6 13. Rad1 Qc7 14. Kh1 Kh8 15. Re2 Rfe8 1/2-1/2';
const ending = '[Event "Custom endgame"]\n[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 27"]\n[White "Promotion White"]\n[Black "Promotion Black"]\n[Result "1-0"]\n\n27. a8=Q+ Kh7 1-0';
let context, page, stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const external = [], errors = [];
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.engineCommands = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(command, ...args) { if (typeof command === 'string') window.engineCommands.push(command); return send.call(this, command, ...args); };
  });
  await mkdir(join(root, 'test-results'), { recursive: true });
  const capture = name => page.screenshot({ path: join(root, 'test-results', `performance-${name}.png`), fullPage: true });
  const importGame = async text => {
    await openImport(page); await page.locator('#pgn-text').fill(text); await page.locator('#import-button').click(); await closeLibrary(page);
  };
  const review = async () => {
    await page.locator('#analyze-button').click();
    await page.waitForFunction(() => /Review complete/.test(document.querySelector('#review-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
    assert.equal(await page.locator('#summary-panel').isVisible(), true);
    assert.equal(await page.locator('#position-label').innerText(), 'Starting position');
    assert.match(await page.locator('#save-status').innerText(), /Saved on this device/);
    assert.equal(await page.locator('.game-performance-table').count(), 1);
  };
  // Read the real persisted result through the library's public API. No fixture
  // results are injected: the engine, saving, loading and rendering all run.
  const storedReview = async event => page.evaluate(async eventName => {
    const { createReviewLibrary } = await import('./lib/library.js');
    const { ANALYSIS_VERSION } = await import('./lib/review.js');
    const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
    try {
      const record = (await library.listReviews()).find(item => item.game.pgn.includes(`[Event "${eventName}"]`));
      if (!record) throw new Error('Expected saved game is missing.');
      return await library.loadReview(record.id);
    } finally { await library.close(); }
  }, event);
  const assertResult = async record => {
    const expectedRatings = estimateGameRatings(record.result), expectedPhases = getPhasePerformance(record.result);
    for (const color of ['w', 'b']) {
      const expected = expectedRatings[color], value = page.locator(`.game-rating-value[data-color="${color}"]`), text = await value.innerText();
      assert.equal(await value.getAttribute('aria-label'), `${color === 'w' ? 'White' : 'Black'} game rating: ${expected.rating === null ? expected.reason : `approximately ${expected.rating}`}`);
      if (expected.rating === null) { assert.equal(text, '—'); assert.equal(await value.getAttribute('title'), expected.reason); }
      else {
        assert(text.startsWith('≈')); assert.equal(Number(text.replace(/\D/g, '')), expected.rating);
        assert(expected.rating >= 300 && expected.rating <= 2800);
        assert.match(await value.getAttribute('title'), /Not an account rating/);
      }
    }
    for (const phase of expectedPhases) {
      const row = page.locator(`.game-performance-table tr[data-phase="${phase.id}"]`);
      assert.equal(await row.locator('th').innerText(), phase.name);
      for (const color of ['w', 'b']) {
        const cell = row.locator(`td[data-color="${color}"]`), expected = phase[color];
        const label = `${color === 'w' ? 'White' : 'Black'} ${phase.name}: ${expected.label ? `${expected.label}, ${expected.total} moves` : 'no moves in this phase'}`;
        assert.equal(await cell.locator('[aria-label]').getAttribute('aria-label'), label);
        if (expected.label) {
          assert.equal(await cell.locator('.phase-badge').count(), 1);
          assert.equal(await cell.locator('img').getAttribute('src'), `move-icons/${expected.label.toLowerCase()}.svg`);
        } else { assert.equal(await cell.innerText(), '—'); assert.equal(await cell.locator('.phase-badge').count(), 0); }
      }
    }
    return { ratings: expectedRatings, phases: expectedPhases };
  };
  const assertFit = async name => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflows the page.`);
    const table = await page.locator('.game-performance-table').boundingBox();
    assert(table && table.x >= 0 && table.x + table.width <= page.viewportSize().width + 1, `${name} table extends off screen.`);
  };
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/review.html`);
  await importGame(pgn);
  await page.locator('#review-settings > summary').click();
  await page.locator('#engine').selectOption('stockfish'); await page.locator('#depth').selectOption('50');
  await page.locator('#multipv').selectOption('1'); await page.locator('#smart-analysis').uncheck();
  await page.locator('#review-settings > summary').click();

  stage = 'real engine ratings and phase summaries';
  await review();
  const record = await storedReview('Performance summary');
  const expected = await assertResult(record);
  for (const color of ['w', 'b']) {
    assert(expected.ratings[color].eligibleMoves >= 8, 'Fixture must contain enough competitive non-book decisions.');
    assert.notEqual(expected.ratings[color].rating, null);
  }
  for (const id of ['opening', 'middlegame']) for (const color of ['w', 'b']) assert.notEqual(expected.phases.find(item => item.id === id)[color].label, null);
  for (const color of ['w', 'b']) assert.equal(expected.phases.find(item => item.id === 'endgame')[color].label, null);
  await assertFit('Desktop performance'); await capture('desktop');
  const beforeReopen = await page.locator('.game-performance-table').innerHTML();
  console.log('PASS: real Stockfish result and saved analysis agree with displayed approximate ratings and phase badges');

  stage = 'saved reload without another engine search';
  await page.reload(); await openLibrary(page);
  if (!await page.locator('#saved-panel').evaluate(el => el.open)) await page.locator('#saved-panel > summary').click();
  const commandsBefore = await page.evaluate(() => window.engineCommands.length);
  await page.locator(`.saved-open[data-review-id="${record.id}"]`).click();
  await page.waitForFunction(() => /Saved review loaded/.test(document.querySelector('#review-status').textContent) && !document.querySelector('#analyze-button').disabled);
  assert.equal(await page.evaluate(() => window.engineCommands.length), commandsBefore, 'Opening saved performance must not start an engine.');
  assert.equal(await page.locator('.game-performance-table').innerHTML(), beforeReopen);
  await assertResult(await storedReview('Performance summary'));
  await page.setViewportSize({ width: 375, height: 812 });
  await assertFit('Mobile performance'); await capture('mobile');
  await page.setViewportSize({ width: 1366, height: 900 });
  console.log('PASS: saved review derives identical performance without engine work; table fits desktop and mobile');

  stage = 'short game unavailable estimates';
  await openLibrary(page); await page.locator('#demo-button').click(); await review();
  const short = await assertResult(await storedReview('MeowlChess sample'));
  for (const color of ['w', 'b']) assert.equal(short.ratings[color].rating, null);
  assert.equal(await page.locator('.game-rating-value').allTextContents().then(items => items.join(',')), '—,—');
  assert.match(await page.locator('.game-performance-note').innerText(), /at least 8/);
  assert.equal(await page.locator('[data-phase="middlegame"] .phase-badge, [data-phase="endgame"] .phase-badge').count(), 0);
  await capture('short-game');
  console.log('PASS: short games show unavailable rating and unreached phases instead of invented estimates');

  stage = 'custom endgame and promotion';
  await importGame(ending); await review();
  const custom = await assertResult(await storedReview('Custom endgame'));
  for (const color of ['w', 'b']) {
    assert.equal(custom.phases.find(item => item.id === 'opening')[color].label, null);
    assert.equal(custom.phases.find(item => item.id === 'middlegame')[color].label, null);
    assert.notEqual(custom.phases.find(item => item.id === 'endgame')[color].label, null);
  }
  assert.equal(await page.locator('[data-phase="opening"] .phase-badge, [data-phase="middlegame"] .phase-badge').count(), 0);
  assert.equal(await page.locator('[data-phase="endgame"] .phase-badge').count(), 2);
  await capture('custom-endgame');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: custom starting position and promotion produce only endgame badges; no page errors or external requests');
} catch (error) {
  console.error(`FAILED at ${stage}`);
  if (page) await page.screenshot({ path: join(root, 'test-results', 'performance-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await closeTestContext(context, profile, 'meowlchess-performance-test-');
}
