import assert from 'node:assert/strict';
import { openLibrary, closeLibrary, openImport, openMoves, openEngine, openSummary } from './ui-helpers.mjs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { Chess } from '../extension/vendor/chess.js';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-features-test-'));
const MATE = '[Event "Feature test"]\n[White "alice"]\n[Black "bob"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const OPENING = '[Event "Opening feature test"]\n[White "Opening White"]\n[Black "Opening Black"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0';
const PROMOTION = '[Event "Promotion feature test"]\n[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 27"]\n[White "Promotion White"]\n[Black "Promotion Black"]\n[Result "1-0"]\n\n27. a8=Q+ Kh7 1-0';
const REPETITION = '[Event "Repetition feature test"]\n[White "Repetition White"]\n[Black "Repetition Black"]\n[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';
const game = { source: 'chesscom', url: 'https://www.chess.com/game/live/12345', pgn: MATE, rules: 'chess', time_class: 'rapid', end_time: 1700000000, white: { username: 'alice', result: 'checkmated', rating: 1200 }, black: { username: 'bob', result: 'win', rating: 1220 } };
// Brave on Windows may leave its crash reporter holding Playwright's process pipe.
// The fallback only closes processes carrying this exact, generated test profile.
async function closeDisposableContext(context) {
  if (!context) return;
  const closing = context.close();
  let timer;
  const closed = await Promise.race([closing.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
  clearTimeout(timer);
  if (!closed && process.platform === 'win32' && dirname(profile) === temporaryRoot && basename(profile).startsWith('meowlchess-features-test-')) {
    const literalProfile = profile.replaceAll("'", "''");
    const command = `$testProfile = '${literalProfile}'
$profilePattern = [regex]::Escape($testProfile) + '(?:["\\s]|$)'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(brave|msedge|chrome|chromium)\\.exe$' -and $_.CommandLine -and $_.CommandLine -match $profilePattern } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 10000, windowsHide: true });
  }
  await closing;
}
let context, page;
let stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https?:\/\//, async route => {
    const url = route.request().url();
    if (url === 'https://api.chess.com/pub/player/bob/games/archives') return route.fulfill({ json: { archives: ['https://api.chess.com/pub/player/bob/games/2023/11'] } });
    if (url === 'https://api.chess.com/pub/player/bob/games/2023/11') return route.fulfill({ json: { games: [game] } });
    await route.abort();
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).hostname;
  page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.engineCommands = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) { if (typeof message === 'string') window.engineCommands.push(message); return original.call(this, message, ...args); };
    window.reviewProgress = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(() => window.reviewProgress.push(document.querySelector('#progress-text')?.textContent || '')).observe(document.querySelector('#progress-text'), { childList: true, subtree: true, characterData: true }));
  });
  await mkdir(join(root, 'test-results'), { recursive: true });
  const capture = name => page.screenshot({ path: join(root, 'test-results', name), fullPage: true });
  const fen = async () => (await page.locator('#board').getAttribute('aria-label')).split('FEN: ')[1];
  const sq = name => page.locator(`#board [data-square="${name}"]`);
  const clickMove = async (from, to) => { await sq(from).click(); await sq(to).click(); };
  const waitIdle = async () => page.waitForFunction(() => !document.querySelector('#analyze-button').disabled && !document.querySelector('#analyze-button').hidden, null, { timeout: 30000 });
  const settings = async () => { await closeLibrary(page); if (!await page.locator('#review-settings').evaluate(item => item.open)) await page.locator('#review-settings > summary').click(); };
  const closeSettings = async () => { await closeLibrary(page); if (await page.locator('#review-settings').evaluate(item => item.open)) await page.locator('#review-settings > summary').click(); };
  const importGame = async pgn => { await openImport(page); await page.locator('#pgn-text').fill(pgn); await page.locator('#import-button').click(); assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').innerText()); };
  const review = async () => { await closeSettings(); await page.locator('#analyze-button').click(); await waitIdle(); assert.match(await page.locator('#review-status').innerText(), /Review complete/); assert.match(await page.locator('#save-status').innerText(), /Saved on this device/); };
  const choosePly = async ply => { await openMoves(page); await page.locator(`#move-list .move-button[data-ply="${ply}"]`).click(); };
  await page.goto(`chrome-extension://${id}/review.html`);
  await page.waitForFunction(() => document.querySelectorAll('#board .square').length === 64);

  stage = 'archive orientation and smart review';
  await page.locator('#username').fill('bob'); await page.locator('#load-button').click();
  await page.waitForFunction(() => !document.querySelector('#load-button').disabled);
  assert.equal(await page.locator('#error').isVisible(), false);
  assert.equal(await page.locator('#bottom-player').innerText(), 'bob');
  assert.equal(await page.locator('#board .square').first().getAttribute('data-square'), 'h1');
  await settings(); await page.locator('#depth').selectOption('150'); await page.locator('#smart-analysis').check(); await review();
  const commands = await page.evaluate(() => window.engineCommands);
  assert(commands.includes('go movetime 150'), 'Real smart scan was not issued.');
  assert(commands.includes('go movetime 500'), 'Real deeper recheck was not issued.');
  assert((await page.evaluate(() => window.reviewProgress)).some(text => /Rechecking/.test(text)), 'Recheck progress was never displayed.');
  assert.equal(await page.locator('#saved-count').innerText(), '1');
  console.log('PASS: archive orientation, real smart scan/recheck, automatic save');

  stage = 'default arrows and engine variation';
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  if (await page.locator('.engine-line').count() < 2) {
    await openEngine(page);
  await page.locator('#deepen-button').click();
    await page.waitForFunction(() => document.querySelector('#stop-position').hidden, null, { timeout: 15000 });
  }
  assert(await page.locator('.engine-line').count() >= 2, 'A completed deeper search should supply at least two candidate lines for hover preview.');
  assert.equal(await page.locator('.engine-arrow').count(), 1);
  assert.equal(await page.locator('.engine-arrow').getAttribute('data-rank'), '1');
  await page.locator('.engine-line[data-rank="2"]').hover();
  assert.equal(await page.locator('.engine-arrow').count(), 1);
  assert.equal(await page.locator('.engine-arrow').getAttribute('data-rank'), '2');
  await page.locator('#game-title').hover();
  assert.equal(await page.locator('.engine-arrow').getAttribute('data-rank'), '1');
  const originalFen = await fen();
  const best = await page.locator('.engine-line').first().getAttribute('data-uci');
  const expected = new Chess(originalFen); expected.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
  await page.locator('.engine-line').first().click();
  assert.equal(await page.locator('#study-controls').isVisible(), true);
  assert.equal(await fen(), expected.fen());
  await capture('features-variation-laptop.png');
  assert(await page.locator('#study-moves button').count() >= 3, 'Real PV should provide a continuation to step through.');
  await page.locator('#next-button').click(); const secondFen = await fen(); assert.notEqual(secondFen, expected.fen());
  await page.locator('#previous-button').click(); assert.equal(await fen(), expected.fen());
  await page.locator('#return-game').click(); assert.equal(await fen(), originalFen);
  assert.equal(await page.locator('#study-controls').isVisible(), false);
  console.log('PASS: default/hover arrows and engine continuation navigation');

  stage = 'legal clicks, illegal move, drag and branch undo';
  await clickMove('e2', 'e5'); assert.equal(await fen(), originalFen); assert.equal(await page.locator('#study-controls').isVisible(), false);
  await clickMove('e2', 'e4'); assert.equal(new Chess(await fen()).get('e4').type, 'p');
  assert.equal(await page.locator('#study-title').innerText(), 'Analysis variation');
  await page.locator('#undo-variation').click(); assert.equal(await fen(), originalFen);
  await sq('d2').locator('img').dragTo(sq('d4'));
  assert.equal(new Chess(await fen()).get('d4')?.type, 'p', 'Dragging should create a legal branch move.');
  await page.locator('#return-game').click(); assert.equal(await fen(), originalFen);
  console.log('PASS: legal clicks/drag, illegal rejection, branch undo and return');

  stage = 'bookmark and saved reopen without engine';
  await choosePly(3); const bookmarkedFen = await fen();
  await page.locator('#bookmark-position').click();
  await page.waitForFunction(() => document.querySelector('#bookmark-position').getAttribute('aria-pressed') === 'true');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#saved-count').textContent === '1' && !document.querySelector('#load-button').disabled);
  await openLibrary(page);
  await page.locator('#saved-panel > summary').click();
  const beforeOpen = await page.evaluate(() => window.engineCommands.length);
  await page.locator('.saved-open').click(); await waitIdle();
  assert.equal(await page.evaluate(() => window.engineCommands.length), beforeOpen, 'Opening a saved review must not run the engine.');
  assert.match(await page.locator('#review-status').innerText(), /Saved review loaded/);
  await openLibrary(page);
  await page.locator('#open-notebook').click();
  await capture('features-notebook-laptop.png');
  await page.waitForFunction(() => document.querySelectorAll('#bookmark-items .notebook-item').length === 1);
  await page.locator('#bookmark-items .notebook-item').click(); await waitIdle();
  assert.equal(await fen(), bookmarkedFen); assert.equal(await page.locator('#bookmark-position').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.engineCommands.length), beforeOpen);
  console.log('PASS: saved review reload/reopen and bookmark notebook, without new analysis');

  stage = 'retry hides answers and grades a legal attempt';
  await choosePly(3); await page.locator('#retry-move').click();
  assert.equal(await page.locator('#retry-panel').isVisible(), true);
  for (const selector of ['.engine-panel', '.chart-panel', '.move-section', '#summary-panel', '.player-score', '#eval-text', '#opening-info']) assert.equal(await page.locator(selector).first().isVisible(), false, `${selector} leaks an answer during retry`);
  assert.equal(await page.locator('.board-move-badge').count(), 0); assert.equal(await page.locator('.engine-arrow').count(), 0);
  await capture('features-retry-laptop.png');
  const retryBase = await fen();
  assert.equal(new Chess(retryBase).turn(), 'w');
  await clickMove('g2', 'g5'); assert.equal(await fen(), retryBase);
  await clickMove('e2', 'e4');
  await page.waitForFunction(() => !document.querySelector('#retry-reset').hidden && !document.querySelector('#retry-reset').disabled && !/Checking/.test(document.querySelector('#retry-feedback').textContent), null, { timeout: 15000 });
  assert.match(await page.locator('#retry-feedback').innerText(), /Good move|Try another move|assessment|forced|search|reliable/i);
  await page.locator('#retry-reset').click(); assert.equal(await fen(), retryBase);
  await page.locator('#retry-reveal').click();
  assert.match(await page.locator('#retry-feedback').innerText(), /engine.s suggestion/i);
  assert.equal(await page.locator('.engine-panel').isVisible(), true);
  assert.equal(await page.locator('#study-title').innerText(), 'Puzzle answer');
  await page.locator('#retry-exit').click(); assert.equal(await fen(), bookmarkedFen);
  console.log('PASS: retry answer hiding, illegal rejection, real grading, reset/reveal/exit');

  stage = 'retry cancellation and notebook retry';
  await page.locator('#retry-move').click(); await clickMove('d2', 'd4');
  await page.locator('#retry-exit').click();
  assert.equal(await page.locator('#retry-panel').isVisible(), false); assert.equal(await fen(), bookmarkedFen);
  await page.waitForTimeout(100); assert.equal(await page.locator('#retry-panel').isVisible(), false);
  await openLibrary(page);
  await page.locator('#open-notebook').click();
  await capture('features-notebook-laptop.png');
  assert(await page.locator('#practice-items .notebook-item').count() > 0, 'A real blunder should be in the notebook.');
  await page.locator('#practice-items .notebook-item').first().click();
  await page.waitForFunction(() => !document.querySelector('#retry-panel').hidden);
  assert.equal(await page.locator('.engine-panel').isVisible(), false);
  await page.locator('#retry-exit').click();
  console.log('PASS: retry cancellation and practice notebook opening');

  stage = 'Show why legal continuation and highlights';
  await choosePly(3); const whyBase = await fen();
  const searchesBeforeDeeper = await page.evaluate(() => window.engineCommands.filter(command => command === 'go movetime 1500').length);
  await openEngine(page);
  await page.locator('#deepen-button').click();
  await page.waitForFunction(() => document.querySelector('#stop-position').hidden, null, { timeout: 15000 });
  assert.match(await page.locator('#engine-status').innerText(), /Position search/);
  assert((await page.evaluate(() => window.engineCommands.filter(command => command === 'go movetime 1500').length)) > searchesBeforeDeeper);
  await page.locator('#show-why').click();
  assert.equal(await page.locator('#study-title').innerText(), 'What happens next');
  assert.match(await page.locator('#study-message').innerText(), /checkmate|mate|line/i);
  const whyFen = await fen();
  const checker = new Chess(whyBase); checker.move('Qh4#'); assert.equal(whyFen, checker.fen());
  assert(await page.locator('.consequence-target').count() > 0, 'Verified mate line should highlight its attacker.');
  await page.locator('#return-game').click(); assert.equal(await fen(), whyBase);
  console.log('PASS: Show why reaches the legal mate continuation and highlights it');

  stage = 'promotion picker and underpromotion';
  await importGame(PROMOTION); const promotionBase = await fen();
  await clickMove('a7', 'a8'); assert.equal(await page.locator('#promotion-picker').isVisible(), true); assert.equal(await fen(), promotionBase);
  assert.equal(await page.locator('#promotion-picker [data-promotion]:visible').count(), 4);
  await page.locator('#cancel-promotion').click(); assert.equal(await fen(), promotionBase);
  // Cancel keeps the pawn selected so a new destination click can resume promotion.
  assert.equal(await sq('a7').getAttribute('aria-selected'), 'true');
  await sq('a8').click(); await page.locator('[data-promotion="n"]').click();
  assert.equal(new Chess(await fen()).get('a8').type, 'n'); assert.equal(await page.locator('#promotion-picker').isVisible(), false);
  await page.locator('#return-game').click(); assert.equal(await fen(), promotionBase);
  console.log('PASS: completed custom-FEN promotion picker, cancel and underpromotion');

  stage = 'completed threefold repetition explanation';
  await importGame(REPETITION);
  await settings(); await page.locator('#smart-analysis').uncheck(); await page.locator('#depth').selectOption('150'); await review();
  await page.locator('#last-button').click();
  await openMoves(page);
  assert.equal(await page.locator('.engine-arrow').count(), 0);
  await page.locator('#show-why').click();
  assert.match(await page.locator('#study-message').innerText(), /drawn?: threefold repetition/i);
  assert.equal(await page.locator('.engine-arrow').count(), 0);
  assert.equal(await page.locator('#study-moves button').count(), 1, 'A terminal repetition has no continuation beyond Start.');
  assert.equal(await page.locator('#next-button').isDisabled(), true);
  await page.locator('#return-game').click();
  console.log('PASS: full-history threefold repetition has a draw explanation and no continuation');

  stage = 'opening names and Book ratings';
  await importGame(OPENING);
  await settings(); await page.locator('#smart-analysis').uncheck(); await page.locator('#depth').selectOption('150'); await review();
  assert.equal(await page.locator('#opening-info').isVisible(), true); assert.match(await page.locator('#opening-name').innerText(), /Italian|Giuoco/i);
  assert(await page.locator('#move-list .move-badge.book').count() > 0, 'Recognized sound opening moves should receive Book badges.');
  assert.equal(await page.locator('#saved-count').innerText(), '3');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'features-study-review.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: recognized opening and Book labels. All feature integration checks passed.');
} catch (error) {
  console.error(`Feature integration failed at: ${stage}`, error);
  if (page) { console.error('UI:', await page.locator('#error').textContent().catch(() => 'unavailable')); await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'features-failure.png'), fullPage: true }).catch(() => {}); }
  throw error;
} finally {
  await closeDisposableContext(context);
  if (dirname(profile) === temporaryRoot && basename(profile).startsWith('meowlchess-features-test-')) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
