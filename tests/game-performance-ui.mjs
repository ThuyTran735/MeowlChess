import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { estimateGameRatings, gameRatingDescription } from '../extension/lib/game-rating.js';
import { getPhasePerformance } from '../extension/lib/game-performance.js';
import { openImport, openLibrary, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'MeowlChess-performance-test-'));
const bundle = await mkdtemp(join(tmpdir(), 'MeowlChess-performance-bundle-')), extension = join(bundle, 'extension');
const pgn = '[Event "Performance summary"]\n[White "sitecat"]\n[Black "siteowl"]\n[WhiteElo "980"]\n[BlackElo "1200"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 11. Qf3 Be7 12. Rfe1 Be6 13. Rad1 Qc7 14. Kh1 Kh8 15. Re2 Rfe8 1/2-1/2';
const unrated = pgn.replace('Performance summary', 'Unrated performance').replace(/\[(?:White|Black)Elo "\d+"\]\n/g, '');
const shortRated = '[Event "Short rated game"]\n[White "White"]\n[Black "Black"]\n[WhiteElo "980"]\n[BlackElo "1200"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const ending = '[Event "Custom endgame"]\n[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 27"]\n[White "Promotion White"]\n[Black "Promotion Black"]\n[Result "1-0"]\n\n27. a8=Q+ Kh7 1-0';
let context, page, stage = 'launch';
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, 'scripting'])];
  const siteOrigins = ['https://www.chess.com/*', 'https://chess.com/*'];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...siteOrigins])];
  manifest.optional_permissions = manifest.optional_permissions.filter(value => value !== 'scripting');
  manifest.optional_host_permissions = manifest.optional_host_permissions.filter(value => !siteOrigins.includes(value));
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const external = [], errors = [];
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest() && url.hostname === 'www.chess.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#302e2b}</style><div class="game-over-component">Draw</div>' });
    external.push(url.href); return route.abort();
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
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
      const label = await value.getAttribute('aria-label');
      assert.equal(await value.getAttribute('title'), gameRatingDescription(expected));
      if (expected.rating === null) {
        assert.equal(text, '—'); assert(label.includes(expected.reason));
        assert.equal(await page.locator(`.game-rating-range[data-color="${color}"]`).count(), 0);
      }
      else {
        assert(text.startsWith('≈')); assert.equal(Number(text.replace(/\D/g, '')), expected.rating);
        assert(expected.rating >= 100 && expected.rating <= 4000);
        assert(expected.range.low <= expected.rating && expected.range.high >= expected.rating);
        assert(label.includes(`approximately ${expected.rating.toLocaleString()}`));
        assert(label.includes(`rough range ${expected.range.low.toLocaleString()} to ${expected.range.high.toLocaleString()}`));
        const range = page.locator(`.game-rating-range[data-color="${color}"]`);
        assert.equal((await range.innerText()).replace(/\s+/g, ' '), `Range ${expected.range.low.toLocaleString()}–${expected.range.high.toLocaleString()}`);
        assert.equal(await range.getAttribute('aria-hidden'), 'true');
        const title = await value.getAttribute('title');
        assert(title.includes(`Recorded player rating: ${expected.baseline}`));
        assert(title.includes(`${expected.eligibleMoves} reviewable decisions`));
        assert.match(title, /(?:Limited|Broader) analysis coverage/);
        assert.match(title, /not account Elo/);
        assert.match(title, /sensitivity guide, not a statistical confidence interval/);
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
    assert(await page.locator('.game-rating-row').evaluate(row => [...row.querySelectorAll('.game-rating-value, .game-rating-range')].every(item => {
      const cell = item.closest('td').getBoundingClientRect(), box = item.getBoundingClientRect();
      return box.left >= cell.left && box.right <= cell.right + 1;
    })), `${name} estimates fit their individual columns.`);
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
    assert.equal(expected.ratings[color].baseline, color === 'w' ? 980 : 1200);
  }
  for (const id of ['opening', 'middlegame']) for (const color of ['w', 'b']) assert.notEqual(expected.phases.find(item => item.id === id)[color].label, null);
  for (const color of ['w', 'b']) assert.equal(expected.phases.find(item => item.id === 'endgame')[color].label, null);
  await assertFit('Desktop performance'); await capture('desktop');
  assert.match(await page.locator('.game-rating-row th').innerText(), /MeowlChess estimate/);
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

  stage = 'missing recorded ratings';
  await importGame(unrated); await review();
  const noRatings = await assertResult(await storedReview('Unrated performance'));
  for (const color of ['w', 'b']) {
    assert(noRatings.ratings[color].eligibleMoves >= 8, 'The missing-rating case must have enough reviewable decisions.');
    assert.equal(noRatings.ratings[color].rating, null);
    assert.equal(noRatings.ratings[color].reason, 'Player rating unavailable');
  }
  assert.match(await page.locator('.game-performance-note').innerText(), /recorded player rating/);

  stage = 'short game unavailable estimates';
  await importGame(shortRated); await review();
  const shortWithRatings = await assertResult(await storedReview('Short rated game'));
  for (const color of ['w', 'b']) {
    assert.equal(shortWithRatings.ratings[color].rating, null);
    assert.equal(shortWithRatings.ratings[color].reason, 'Not enough moves');
  }
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
  stage = 'shared PNG uses the same estimate and range';
  const image = await page.evaluate(async record => {
    const { renderSummaryImage } = await import('./lib/summary-share.js');
    const drawn = [], original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(value, x, y, ...args) {
      drawn.push({ text: String(value), x, y, width: this.measureText(value).width, align: this.textAlign });
      return original.call(this, value, x, y, ...args);
    };
    try {
      const image = await renderSummaryImage({ game: record.game, result: record.result, analysis: record.analysis });
      return { width: image.width, height: image.height, type: image.blob.type, drawn, png: Array.from(new Uint8Array(await image.blob.arrayBuffer())) };
    } finally { CanvasRenderingContext2D.prototype.fillText = original; }
  }, record);
  assert.equal(image.type, 'image/png'); assert.equal(image.width, 1200); assert.equal(image.height, 1200);
  for (const color of ['w', 'b']) {
    const rating = expected.ratings[color];
    assert(image.drawn.some(item => item.text === `≈${rating.rating.toLocaleString()}`));
    assert(image.drawn.some(item => item.text === `Range ${rating.range.low.toLocaleString()}–${rating.range.high.toLocaleString()}`));
  }
  assert.equal(image.drawn.filter(item => item.text === 'MeowlChess estimate').length, 2);
  for (const item of image.drawn) {
    const left = item.x - (item.align === 'center' ? item.width / 2 : item.align === 'right' ? item.width : 0);
    assert(left >= 52 && left + item.width <= 1148, `Shared summary text overflow: ${item.text}`);
    if ([324, 360, 383].includes(item.y) && item.align === 'right') {
      const cardLeft = item.x < 600 ? 56 : 612;
      assert(left >= cardLeft + 278 && left + item.width <= cardLeft + 508, `Estimate overlaps the study score: ${item.text}`);
    }
  }
  await writeFile(join(root, 'test-results', 'MeowlChess-performance-summary.png'), Buffer.from(image.png));
  stage = 'on-site panel loads matching saved ranges without another engine';
  await worker.evaluate(async ({ pgn, stamp }) => {
    globalThis.fetch = async input => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname.endsWith('/archives')) return { ok: true, status: 200, json: async () => ({ archives: ['https://api.chess.com/pub/player/sitecat/games/2026/10'] }) };
      return { ok: true, status: 200, json: async () => ({ games: [{ rules: 'chess', url: 'https://www.chess.com/game/live/884499001', pgn, end_time: stamp, white: { username: 'sitecat', result: 'agreed' }, black: { username: 'siteowl', result: 'agreed' } }] }) };
    };
    await chrome.storage.local.set({ siteReviewSettings: { chesscom: { enabled: true, username: 'sitecat' }, lichess: { enabled: false, username: '' } }, reviewSettings: { engine: 'stockfish', time: '50', lines: '1', smart: false } });
  }, { pgn, stamp: Math.floor(Date.now() / 1000) - 60 });
  const until = Date.now() + 15000;
  while (!await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).some(script => script.id === 'meowl-site-chesscom'))) {
    if (Date.now() > until) throw new Error('Site scripts were not registered.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const site = await context.newPage(); site.on('pageerror', error => errors.push(error.message));
  await site.setViewportSize({ width: 375, height: 812 });
  await site.goto('https://www.chess.com/game/live/884499001'); await site.bringToFront();
  let panel;
  for (let attempt = 0; attempt < 300; attempt++) {
    panel = site.frames().find(frame => /site-summary\.html#/.test(frame.url()));
    if (panel) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(panel, 'The actual on-site summary frame opens.');
  await panel.locator('#summary-result').waitFor({ state: 'visible', timeout: 30000 });
  assert.match(await panel.locator('#summary-status').innerText(), /Saved review loaded/);
  assert.equal(await panel.evaluate(() => window.engineCommands.length), 0);
  for (const color of ['w', 'b']) {
    const rating = expected.ratings[color], cell = panel.locator(`#summary-rating-${color}`);
    assert.equal(await cell.locator('.game-rating-value').innerText(), `≈${rating.rating.toLocaleString()}`);
    assert.equal((await cell.locator('.game-rating-range').innerText()).replace(/\s+/g, ' '), `Range ${rating.range.low.toLocaleString()}–${rating.range.high.toLocaleString()}`);
    assert.equal(await cell.getAttribute('title'), gameRatingDescription(rating));
  }
  assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The narrow panel has no horizontal overflow.');
  assert(await panel.locator('.game-rating-row').evaluate(row => [...row.querySelectorAll('.game-rating-value, .game-rating-range')].every(item => {
    const cell = item.closest('td').getBoundingClientRect(), box = item.getBoundingClientRect();
    return box.left >= cell.left && box.right <= cell.right + 1;
  })), 'Panel estimate text fits its individual columns.');
  const panelSize = await panel.locator('.game-performance-table').boundingBox();
  assert(panelSize && panelSize.width <= 351, 'Panel ratings stay inside the mobile viewport.');
  await site.screenshot({ path: join(root, 'test-results', 'MeowlChess-performance-panel-mobile.png'), fullPage: true });
  await site.close();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: custom starting position and promotion produce only endgame badges; no page errors or external requests');
} catch (error) {
  console.error(`FAILED at ${stage}`);
  if (page) await page.screenshot({ path: join(root, 'test-results', 'performance-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await closeTestContext(context, profile, 'MeowlChess-performance-test-');
  const absolute = resolve(bundle), temporaryRoot = resolve(tmpdir());
  if ((absolute.startsWith(temporaryRoot + '\\') || absolute.startsWith(temporaryRoot + '/')) && basename(absolute).startsWith('MeowlChess-performance-bundle-')) await rm(absolute, { recursive: true, force: true });
}
