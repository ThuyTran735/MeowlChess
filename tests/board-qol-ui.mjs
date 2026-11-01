import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { openImport, openLibrary, closeLibrary, closeTestContext } from './ui-helpers.mjs';
import { formatReviewDuration } from '../extension/lib/review-duration.js';

// The local engines, extension broker, rendering, and persistence are real. Only
// completed-game website/API fixtures and a controlled save delay are synthetic.
const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'meowlchess-board-qol-test-', bundlePrefix = 'meowlchess-board-qol-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const pgn = '[Event "Board QoL"]\n[White "White player"]\n[Black "Black player"]\n[Result "1/2-1/2"]\n\n1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. Nf3 Nf6 1/2-1/2';
const promotion = '[Event "Capture promotion"]\n[White "Promotion White"]\n[Black "Promotion Black"]\n[SetUp "1"]\n[FEN "1r5k/P7/8/8/8/8/8/7K w - - 0 1"]\n[Result "1-0"]\n\n1. axb8=Q+ Kh7 1-0';
const sitePgn = pgn.replace('Board QoL', 'Panel ETA').replace('White player', 'sitecat').replace('Black player', 'siteowl');
const chessUrl = 'https://www.chess.com/game/live/884455991';
const errors = [], external = [];
let context, worker, page, site, stage = 'launch';
async function poll(read, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Timed out: ${label}`);
}
const near = (a, b, label) => assert(Math.abs(a - b) <= 2, `${label}: ${a} vs ${b}`);

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, 'scripting'])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...manifest.optional_host_permissions])];
  delete manifest.optional_host_permissions;
  manifest.optional_permissions = (manifest.optional_permissions || []).filter(value => value !== 'scripting');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => {
    if (route.request().isNavigationRequest() && route.request().url().startsWith('https://www.chess.com/game/')) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#302e2b;color:white;font:16px Arial}</style><div class="game-over-component">Game over · ½–½</div>' });
    }
    if (!route.request().url().endsWith('/favicon.ico')) external.push(route.request().url());
    return route.abort();
  });
  await context.addInitScript(() => {
    window.qolTelemetry = { starts: 0, eta: [], savePending: false };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.qolTelemetry.starts++; }
    };
    new MutationObserver(() => {
      const eta = document.querySelector('#progress-eta, #summary-eta');
      if (eta && !eta.hidden && eta.getBoundingClientRect().height && eta.textContent.trim()) {
        if (window.qolTelemetry.eta.at(-1) !== eta.textContent.trim()) window.qolTelemetry.eta.push(eta.textContent.trim());
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    if (location.pathname.endsWith('/site-summary.html') && globalThis.chrome?.runtime?.sendMessage) {
      const nativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (message, ...args) => {
        if (message?.type === 'meowl:site-save-review') {
          window.qolTelemetry.savePending = true;
          window.qolTelemetry.completedDurationMs = message.result.analysis?.durationMs;
          await new Promise(resolve => { window.releaseQolSave = () => { window.qolTelemetry.savePending = false; resolve(); }; });
        }
        return nativeSend(message, ...args);
      };
    }
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await mkdir(join(root, 'test-results'), { recursive: true });
  page = await context.newPage();
  const capture = name => page.screenshot({ path: join(root, 'test-results', `MeowlChess-board-qol-${name}.png`), fullPage: true });
  const settings = async open => {
    await closeLibrary(page);
    if (await page.locator('#review-settings').evaluate(el => el.open) !== open) await page.locator('#review-settings > summary').click();
  };
  const importGame = async text => {
    await openImport(page); await page.locator('#pgn-text').fill(text); await page.locator('#import-button').click(); await closeLibrary(page);
  };
  const fen = () => page.locator('#board').getAttribute('aria-label').then(text => text.split('FEN: ')[1]);
  const row = color => page.locator(`#top-captured[data-color="${color}"], #bottom-captured[data-color="${color}"]`);
  const material = async (color, pieces, advantage) => {
    assert.equal(await row(color).count(), 1, `One captured row for ${color}.`);
    const sources = await row(color).locator('.captured-pieces img').evaluateAll(images => images.map(image => image.getAttribute('src').split('/').at(-1).replace('.png', '')).sort());
    assert.deepEqual(sources, pieces.slice().sort(), `Captured pieces for ${color}.`);
    const score = row(color).locator('.material-advantage');
    assert.equal(await score.count() ? (await score.textContent()).trim() : '', advantage, `Material advantage for ${color}.`);
  };
  const fit = async label => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: horizontal page overflow.`);
    const board = await page.locator('#board').boundingBox();
    assert(board.x >= 0 && board.x + board.width <= page.viewportSize().width + 1, `${label}: board fits viewport.`);
  };
  const dimensions = () => page.evaluate(() => ({
    board: document.querySelector('#board').getBoundingClientRect().width,
    side: document.querySelector('.insights-column').getBoundingClientRect().width,
    font: getComputedStyle(document.querySelector('#analyze-button')).fontSize,
  }));
  const setSize = async value => {
    await settings(true);
    await page.locator('#board-size').focus(); await page.keyboard.press('Home');
    for (let size = 320; size < value; size += 40) await page.keyboard.press('ArrowRight');
    await poll(async () => (await worker.evaluate(async () => (await chrome.storage.local.get('reviewSettings')).reviewSettings)).boardSize === value, `stored board size ${value}`);
  };
  const etaCleared = async (surface, selector) => {
    assert.equal(await surface.locator(selector).isVisible(), false, `${selector} is hidden.`);
    assert.equal((await surface.locator(selector).textContent()).trim(), '', `${selector} has no stale estimate.`);
  };
  const waitEta = (surface, selector) => surface.waitForFunction(selector => {
    const element = document.querySelector(selector);
    return element && !element.hidden && element.getBoundingClientRect().height > 0 && /left|remaining/i.test(element.textContent);
  }, selector);
  await page.goto(`${origin}/review.html`); await importGame(pgn);

  stage = 'board sizing and preferences';
  await settings(true); assert.equal((await page.locator('#board-size-value').innerText()).trim(), 'Auto');
  const original = await dimensions(), firstFen = await fen();
  await setSize(320); await settings(false); const small = await dimensions();
  assert(small.board < original.board - 100, 'Small board is independently smaller than Auto.');
  near(small.board, 320, '320px board'); near(small.side, original.side, 'Sidebar width unchanged'); assert.equal(small.font, original.font);
  const controlsFit = await page.evaluate(() => {
    const column = document.querySelector('.board-column').getBoundingClientRect();
    return [...document.querySelectorAll('.board-controls button')].every(button => {
      const box = button.getBoundingClientRect(); return box.x >= column.x && box.right <= column.right + 1;
    });
  });
  assert(controlsFit, 'Every navigation button fits the smallest board column.');
  await fit('320px board'); await capture('small');
  await page.locator('#next-button').click(); assert.notEqual(await fen(), firstFen, 'Navigation works at small board size.');
  await page.locator('#first-button').click(); await setSize(840);
  const large = await dimensions(); assert(large.board > small.board + 300, 'Board grows on wide display.'); near(large.side, small.side, 'Large sidebar width unchanged'); assert.equal(large.font, small.font);
  const beforeKey = await fen(); await page.locator('#board-size').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#board-size').inputValue(), '880'); assert.equal(await fen(), beforeKey, 'Slider keys do not step through moves.');
  await poll(async () => (await worker.evaluate(async () => (await chrome.storage.local.get('reviewSettings')).reviewSettings)).boardSize === 880, 'keyboard board size persisted');
  await page.reload(); await settings(true); assert.equal(await page.locator('#board-size').inputValue(), '880'); assert.match(await page.locator('#board-size-value').innerText(), /880/);
  await importGame(pgn); await settings(false); await fit('Large board'); await capture('wide');
  await page.setViewportSize({ width: 375, height: 812 }); await fit('375px screen');
  await page.locator('#next-button').click(); await page.locator('#first-button').click();
  await settings(true); await fit('375px settings'); await capture('mobile');
  await page.locator('#board-size-auto').click(); assert.equal((await page.locator('#board-size-value').innerText()).trim(), 'Auto');
  await poll(async () => (await worker.evaluate(async () => (await chrome.storage.local.get('reviewSettings')).reviewSettings)).boardSize === 'auto', 'Auto persisted');
  await page.reload(); await settings(true); assert.equal((await page.locator('#board-size-value').innerText()).trim(), 'Auto');
  await page.setViewportSize({ width: 1366, height: 900 }); await settings(false); await importGame(pgn);
  console.log('PASS: default Auto, slider dimensions, sidebar/text invariance, keyboard isolation, persistence/reset, and 375px fit');

  stage = 'captures, rewind, flip, and variations';
  await material('w', [], ''); await material('b', [], '');
  for (let i = 0; i < 3; i++) await page.locator('#next-button').click();
  await material('w', ['bp'], '+1'); await material('b', [], '');
  await page.locator('#flip-button').click(); assert.equal(await page.locator('#top-captured').getAttribute('data-color'), 'w'); await material('w', ['bp'], '+1');
  await page.locator('#next-button').click(); await material('w', ['bp'], ''); await material('b', ['wp'], '');
  await page.locator('#previous-button').click(); await material('w', ['bp'], '+1'); await material('b', [], '');
  await page.locator('#board [data-square="d8"]').click(); await page.locator('#board [data-square="d5"]').click();
  await material('w', ['bp'], ''); await material('b', ['wp'], '');
  await page.locator('#undo-variation').click(); await material('w', ['bp'], '+1'); await material('b', [], '');
  await page.locator('#return-game').click(); await material('w', ['bp'], '+1');
  await page.locator('#previous-button').click(); await material('w', [], '');
  await page.locator('#board [data-square="e4"]').click(); await page.locator('#board [data-square="d5"]').click();
  assert.equal(await page.locator('#study-controls').isVisible(), true); await material('w', ['bp'], '+1');
  await page.locator('#undo-variation').click(); await material('w', [], ''); await material('b', [], '');
  await page.locator('#return-game').click(); await material('w', [], '');
  await page.locator('#first-button').click(); await material('b', [], '');
  await importGame(promotion); await material('w', [], ''); await material('b', [], '+4');
  await page.locator('#next-button').click(); await material('w', ['br'], '+9'); await material('b', [], '');
  await page.locator('#first-button').click(); await material('w', [], ''); await material('b', [], '+4');
  await page.locator('#board [data-square="a7"]').click(); await page.locator('#board [data-square="b8"]').click();
  await page.locator('#promotion-picker [data-promotion="n"]').click();
  await material('w', ['br'], '+3'); await material('b', [], ''); await capture('promotion');
  await page.locator('#return-game').click(); await material('w', [], ''); await material('b', [], '+4');
  console.log('PASS: actual captures follow position, orientation, branches, undo and promotion; custom FEN has no invented captures');

  stage = 'main real engine ETA cancellation and completion';
  await importGame(pgn); await settings(true);
  await page.locator('#engine').selectOption('stockfish'); await page.locator('#multipv').selectOption('1'); await page.locator('#depth').selectOption('500'); await page.locator('#smart-analysis').uncheck(); await settings(false);
  await page.locator('#analyze-button').click(); await waitEta(page, '#progress-eta');
  assert.equal(await page.locator('#progress-area').isVisible(), true);
  await page.locator('#cancel-button').click();
  await page.waitForFunction(() => !document.querySelector('#analyze-button').disabled); await etaCleared(page, '#progress-eta');
  await settings(true); await page.locator('#depth').selectOption('50'); await page.locator('#smart-analysis').check(); await settings(false);
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
  await etaCleared(page, '#progress-eta'); assert.equal(await page.locator('#summary-panel').isVisible(), true);
  assert.equal(await page.locator('#position-label').innerText(), 'Starting position');
  const mainDuration = await page.locator('#review-duration').innerText();
  assert.match(mainDuration, /^Reviewed in /);
  const record = await page.evaluate(async () => {
    const { createReviewLibrary } = await import('./lib/library.js'); const { ANALYSIS_VERSION } = await import('./lib/review.js');
    const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
    try {
      const item = (await library.listReviews()).find(item => item.game.pgn.includes('[Event "Board QoL"]'));
      return item ? { ...item, durationMs: (await library.loadReview(item.id)).result.analysis?.durationMs } : null;
    } finally { await library.close(); }
  });
  assert(record, 'Completed review saved.');
  assert(record.durationMs > 0);
  assert.equal(mainDuration, `Reviewed in ${formatReviewDuration(record.durationMs)}`);
  await capture('duration-main');
  await page.reload(); await openLibrary(page);
  if (!await page.locator('#saved-panel').evaluate(el => el.open)) await page.locator('#saved-panel > summary').click();
  await page.locator(`.saved-open[data-review-id="${record.id}"]`).click();
  await page.waitForFunction(() => /Saved review loaded/.test(document.querySelector('#review-status').textContent));
  await etaCleared(page, '#progress-eta'); assert.equal(await page.evaluate(() => window.qolTelemetry.starts), 0); assert.deepEqual(await page.evaluate(() => window.qolTelemetry.eta), []);
  assert.equal(await page.locator('#review-duration').innerText(), mainDuration, 'Reopened review preserves its measured duration.');
  console.log('PASS: main ETA clears on cancel/complete; saved review reopens with original duration and no engine or ETA');

  stage = 'real on-site panel ETA';
  await worker.evaluate(async ({ pgn, url, stamp }) => {
    globalThis.fetch = async input => {
      const target = new URL(typeof input === 'string' ? input : input.url);
      if (target.hostname !== 'api.chess.com') throw new Error(`Unexpected fixture fetch: ${target}`);
      if (target.pathname.endsWith('/archives')) return { ok: true, status: 200, json: async () => ({ archives: ['https://api.chess.com/pub/player/sitecat/games/2026/10'] }) };
      return { ok: true, status: 200, json: async () => ({ games: [{ url, pgn, rules: 'chess', time_class: 'rapid', end_time: stamp, white: { username: 'sitecat', result: 'agreed' }, black: { username: 'siteowl', result: 'agreed' } }] }) };
    };
    await chrome.storage.local.set({ completionAlerts: false, siteReviewSettings: { chesscom: { enabled: true, username: 'sitecat' } }, reviewSettings: { engine: 'lozza', time: '500', lines: '1', smart: false } });
  }, { pgn: sitePgn, url: chessUrl, stamp: Math.floor(Date.now() / 1000) - 60 });
  site = await context.newPage(); await site.goto(chessUrl); await site.bringToFront();
  let frame;
  await poll(() => { frame = site.frames().find(item => /site-summary\.html#/.test(item.url())); return frame; }, 'panel frame');
  await waitEta(frame, '#summary-eta'); await frame.locator('#summary-cancel').click();
  assert.equal(await frame.locator('#summary-title').innerText(), 'Review stopped'); await etaCleared(frame, '#summary-eta');
  await frame.locator('#summary-retry').click(); await poll(() => frame.isDetached(), 'canceled frame replaced');
  await poll(() => { frame = site.frames().find(item => /site-summary\.html#/.test(item.url())); return frame; }, 'replacement panel frame');
  await waitEta(frame, '#summary-eta');
  await site.screenshot({ path: join(root, 'test-results', 'MeowlChess-board-qol-panel-progress.png'), fullPage: true });
  await frame.waitForFunction(() => window.qolTelemetry.savePending, null, { timeout: 60000 });
  assert.equal(await frame.locator('#summary-title').innerText(), 'Saving'); await etaCleared(frame, '#summary-eta');
  const panelDuration = await frame.evaluate(() => window.qolTelemetry.completedDurationMs);
  assert(panelDuration > 0 && Number.isInteger(panelDuration), 'Panel save receives measured elapsed analysis time.');
  await frame.evaluate(() => window.releaseQolSave());
  await frame.locator('#summary-result').waitFor({ state: 'visible' }); await etaCleared(frame, '#summary-eta');
  assert((await frame.evaluate(() => window.qolTelemetry.eta)).length > 0, 'Panel showed a real analysis estimate.');
  const panelDurationText = `Reviewed in ${formatReviewDuration(panelDuration)}`;
  assert.equal(await frame.locator('#summary-duration').innerText(), panelDurationText);
  await frame.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  assert(await frame.evaluate(() => document.querySelector('#summary-duration').getBoundingClientRect().bottom <= document.querySelector('footer').getBoundingClientRect().top + 1), 'Duration can scroll fully above sticky actions.');
  await site.screenshot({ path: join(root, 'test-results', 'MeowlChess-board-qol-duration-panel.png'), fullPage: true });
  await frame.evaluate(() => location.reload());
  await frame.locator('#summary-result').waitFor({ state: 'visible' });
  assert.match(await frame.locator('#summary-status').innerText(), /Saved review loaded/);
  await etaCleared(frame, '#summary-eta'); assert.equal(await frame.evaluate(() => window.qolTelemetry.starts), 0); assert.deepEqual(await frame.evaluate(() => window.qolTelemetry.eta), []);
  assert.equal(await frame.locator('#summary-duration').innerText(), panelDurationText, 'Cached panel keeps original duration through the background save/load bridge.');
  console.log('PASS: panel ETA clears on cancel/save/completion/reopen; measured duration survives saving and reuse');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Board QoL UI passed with real Brave, local Stockfish/Lozza, and isolated saved data.');
} catch (error) {
  console.error(`Board QoL failed at: ${stage}`);
  if (page) await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-board-qol-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) === temporaryRoot && basename(absolute).startsWith(bundlePrefix)) await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
}
