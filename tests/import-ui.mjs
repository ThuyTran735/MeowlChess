import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { Chess } from '../extension/vendor/chess.js';
import { openLibrary, closeLibrary, openImport, openMoves, openSummary } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-import-ui-'));
const MATE = '[Event "Imported one"]\n[White "Import One"]\n[Black "First Black"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const DRAW = '[Event "Imported two"]\n[White "Import Two"]\n[Black "Second Black"]\n[Result "1/2-1/2"]\n\n1. Nf3 Nf6 1/2-1/2';
const UNFINISHED = '[Event "Unfinished"]\n[Result "*"]\n\n1. e4 e5 *';
const INVALID = '[Event "Invalid"]\n[Result "1-0"]\n\n1. e4 NotAMove 1-0';
const promotions = [
  { color: 'w', from: 'a7', to: 'a8', choice: 'q', fen: '7k/P7/8/8/8/8/8/7K w - - 0 27', moves: '27. a8=Q+ Kh7 1-0' },
  { color: 'b', from: 'a2', to: 'a1', choice: 'n', fen: '7k/8/8/8/8/8/p7/7K b - - 0 27', moves: '27... a1=Q+ 28. Kh2 0-1' },
  { color: 'w', from: 'a7', to: 'b8', choice: 'r', fen: '1r5k/P7/8/8/8/8/8/7K w - - 0 27', moves: '27. axb8=Q+ Kh7 1-0' },
  { color: 'b', from: 'a2', to: 'b1', choice: 'b', fen: '7k/8/8/8/8/8/p7/1R5K b - - 0 27', moves: '27... axb1=Q+ 28. Kh2 0-1' },
].map((fixture, index) => ({ ...fixture, pgn: `[Event "Promotion ${index + 1}"]\n[White "Promotion ${index + 1} White"]\n[Black "Promotion ${index + 1} Black"]\n[SetUp "1"]\n[FEN "${fixture.fen}"]\n[Result "${fixture.color === 'w' ? '1-0' : '0-1'}"]\n\n${fixture.moves}` }));

async function closeIsolatedContext(context) {
  if (!context) return;
  const closing = context.close(); let timer;
  const closed = await Promise.race([closing.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]); clearTimeout(timer);
  if (!closed && process.platform === 'win32' && dirname(profile) === temporaryRoot && basename(profile).startsWith('meowlchess-import-ui-')) {
    const command = `$testProfile = '${profile.replaceAll("'", "''")}'
$profilePattern = [regex]::Escape($testProfile) + '(?:["\\s]|$)'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(brave|msedge|chrome|chromium)\\.exe$' -and $_.CommandLine -and $_.CommandLine -match $profilePattern } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 10000, windowsHide: true });
  }
  await closing;
}
let context, page, stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true, viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const external = [];
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.engineCommands = []; const send = Worker.prototype.postMessage; Worker.prototype.postMessage = function(command, ...args) { if (typeof command === 'string') window.engineCommands.push(command); return send.call(this, command, ...args); }; });
  await mkdir(join(root, 'test-results'), { recursive: true });
  const capture = name => page.screenshot({ path: join(root, 'test-results', name), fullPage: true });
  const fen = async () => (await page.locator('#board').getAttribute('aria-label')).split('FEN: ')[1];
  const square = name => page.locator(`#board [data-square="${name}"]`);
  const searchCount = () => page.evaluate(() => window.engineCommands.filter(command => command.startsWith('go ')).length);
  const paste = async text => { await openImport(page); await page.locator('#pgn-text').fill(text); await page.locator('#import-button').click(); };
  const single = async text => { await paste(text); await page.waitForFunction(() => !document.querySelector('#library-dialog').open); };
  const drop = async (text, name) => {
    await openImport(page);
    const dataTransfer = await page.evaluateHandle(({ text, name }) => { const transfer = new DataTransfer(); if (name) transfer.items.add(new File([text], name, { type: 'application/x-chess-pgn' })); else transfer.setData('text/plain', text); return transfer; }, { text, name });
    await page.locator('#pgn-dropzone').dispatchEvent('drop', { dataTransfer }); await dataTransfer.dispose();
  };
  const review = async () => {
    await closeLibrary(page);
    if (!await page.locator('#review-settings').evaluate(details => details.open)) await page.locator('#review-settings > summary').click();
    await page.locator('#engine').selectOption('stockfish'); await page.locator('#depth').selectOption('50'); await page.locator('#smart-analysis').uncheck();
    await page.locator('#review-settings > summary').click();
    await page.locator('#analyze-button').click();
    await page.waitForFunction(() => !document.querySelector('#analyze-button').disabled, null, { timeout: 30000 });
    assert.match(await page.locator('#review-status').innerText(), /Review complete/);
    assert.match(await page.locator('#save-status').innerText(), /Saved on this device/);
    assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#summary-panel').isVisible(), true);
    assert.match(await page.locator('#position-label').innerText(), /starting/i);
    assert.equal(await page.locator('#board .board-move-badge').count(), 0);
    assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  };
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/review.html`);
  await page.locator('#library-dialog').waitFor({ state: 'visible' });

  stage = 'mixed collection picker and completion guards';
  await paste([MATE, UNFINISHED, DRAW, INVALID].join('\n\n'));
  assert.equal(await page.locator('#library-dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('#import-games button.import-game').count(), 2);
  assert.equal(await page.locator('#import-error-list li').count(), 2);
  assert.equal(await searchCount(), 0, 'Import parsing must not start an engine.');
  assert.match(await page.locator('#import-help').textContent(), /ChessTempo/);
  assert.match(await page.locator('#import-help').textContent(), /ICC/);
  await capture('import-picker-desktop.png');
  await page.locator('#import-games button.import-game[data-index="1"]').click();
  assert.equal(await page.locator('#library-dialog').isVisible(), false);
  assert.equal(await page.locator('#game-title').innerText(), 'Import Two vs Second Black');
  assert.equal(await page.locator('#move-list .move-button').count(), 2);
  assert.equal(await searchCount(), 0, 'Choosing an imported game must not analyze automatically.');
  assert.equal(await fen(), new Chess().fen());
  console.log('PASS: mixed multi-PGN import retains completed games, explains rejections, and waits for explicit review');

  stage = 'complete review starts at move zero and Summary';
  await review(); assert.equal(await fen(), new Chess().fen());
  assert.equal(await page.locator('#engine-panel').isVisible(), false);
  assert.equal(await page.locator('.board-controls').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture('import-review-summary-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture('import-review-summary-mobile.png');
  await page.setViewportSize({ width: 1366, height: 768 });
  console.log('PASS: review completion starts at the initial position in Summary on desktop and mobile');

  stage = 'file drop, text drop and oversize feedback';
  const priorSearches = await searchCount();
  await drop([MATE, DRAW].join('\n\n'), 'two-games.pgn');
  await page.waitForFunction(() => document.querySelectorAll('#import-games button.import-game').length === 2);
  await page.locator('#import-games button.import-game[data-index="0"]').click();
  assert.equal(await page.locator('#game-title').innerText(), 'Import One vs First Black');
  await drop(DRAW);
  await page.waitForFunction(() => !document.querySelector('#library-dialog').open);
  assert.equal(await page.locator('#game-title').innerText(), 'Import Two vs Second Black');
  assert.equal(await searchCount(), priorSearches);
  await openImport(page);
  const oversized = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.items.add(new File([' '.repeat(5 * 1024 * 1024 + 1)], 'oversize.pgn', { type: 'application/x-chess-pgn' })); return transfer; });
  await page.locator('#pgn-dropzone').dispatchEvent('drop', { dataTransfer: oversized }); await oversized.dispose();
  await page.waitForFunction(() => /large|size|limit|MiB|MB/i.test(document.querySelector('#import-status').textContent));
  assert.equal(await page.locator('#library-dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('#game-title').innerText(), 'Import Two vs Second Black');
  assert.equal(await searchCount(), priorSearches);
  console.log('PASS: real file/text drops stay local and oversized files show feedback without replacing the game');

  stage = 'multiple headerless PGN files';
  await openImport(page);
  await page.locator('#pgn-file').setInputFiles([
    { name: 'first-headerless.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from('1. e4 e5 1-0') },
    { name: 'second-headerless.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from('1. d4 d5 1/2-1/2') },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#import-games button.import-game').length === 2 && !document.querySelector('#import-button').disabled);
  assert.equal(await page.locator('#import-error-list li').count(), 0);
  assert.equal(await page.locator('#library-dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await searchCount(), priorSearches);
  await page.locator('#import-games button.import-game[data-index="1"]').click();
  assert.equal(await page.locator('#move-list .move-button').count(), 2);
  assert.match(await page.locator('#move-list .move-button').first().innerText(), /d4/);
  assert.match(await page.locator('#move-list .move-button').last().innerText(), /d5/);
  await openImport(page);
  await page.locator('#pgn-file').setInputFiles([
    { name: 'unfinished-headerless.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from('1. e4 e5') },
    { name: 'finished-headerless.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from('1. d4 d5 1-0') },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#import-games button.import-game').length === 1 && document.querySelectorAll('#import-error-list li').length === 1 && !document.querySelector('#import-button').disabled);
  assert.equal(await page.locator('#library-dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await searchCount(), priorSearches);
  await page.locator('#import-games button.import-game[data-index="0"]').click();
  assert.equal(await page.locator('#move-list .move-button').count(), 2);
  assert.match(await page.locator('#move-list .move-button').first().innerText(), /d4/);
  assert.match(await page.locator('#move-list .move-button').last().innerText(), /d5/);
  console.log('PASS: headerless file boundaries preserve separate games and never borrow another file’s completion result');

  stage = 'white and black promotion dialogs, captures, cancellation and keyboard';
  for (let index = 0; index < promotions.length; index++) {
    const fixture = promotions[index]; await single(fixture.pgn); const initial = await fen();
    await square(fixture.from).click(); await square(fixture.to).click();
    assert.equal(await page.locator('#promotion-picker').evaluate(dialog => dialog instanceof HTMLDialogElement && dialog.open), true);
    assert.equal(await fen(), initial);
    const choices = await page.locator('#promotion-picker [data-promotion]').evaluateAll(buttons => buttons.filter(button => !button.hidden).map(button => ({ piece: button.dataset.promotion, image: button.querySelector('img')?.getAttribute('src') })));
    assert.deepEqual(choices.map(choice => choice.piece).sort(), ['b', 'n', 'q', 'r']);
    for (const choice of choices) assert.match(choice.image, new RegExp(`${fixture.color}${choice.piece}\\.png$`));
    if (index < 2) {
      if (index === 0) await page.locator('#cancel-promotion').click(); else await page.keyboard.press('Escape');
      assert.equal(await page.locator('#promotion-picker').isVisible(), false); assert.equal(await fen(), initial);
      assert.equal(await square(fixture.from).evaluate(el => el === document.activeElement), true);
      await square(fixture.to).click();
    }
    if (index === 3) {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await capture('promotion-dialog-mobile.png');
    }
    await page.locator(`#promotion-picker [data-promotion="${fixture.choice}"]`).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#promotion-picker').isVisible(), false);
    const promoted = new Chess(await fen()); assert.deepEqual(promoted.get(fixture.to), { type: fixture.choice, color: fixture.color });
    assert.equal(promoted.get(fixture.from), undefined);
    assert.equal(await page.locator('#moves-tab').getAttribute('aria-selected'), 'true');
    await page.locator('#return-game').click(); assert.equal(await fen(), initial);
    await page.setViewportSize({ width: 1366, height: 768 });
  }
  console.log('PASS: both colors promote and capture with every piece choice; Cancel/Escape and keyboard selection work');

  stage = 'reviewed promotion persistence and retry underpromotion';
  await single(promotions[0].pgn); await review();
  await openMoves(page); await page.locator('#move-list .move-button[data-ply="1"]').click();
  assert.equal(new Chess(await fen()).get('a8').type, 'q');
  await page.locator('#retry-move').click(); await square('a7').click(); await square('a8').click();
  await page.locator('#promotion-picker [data-promotion="n"]').click();
  await page.waitForFunction(() => !document.querySelector('#retry-reset').hidden && !document.querySelector('#retry-reset').disabled, null, { timeout: 15000 });
  assert.equal(new Chess(await fen()).get('a8').type, 'n');
  assert.doesNotMatch(await page.locator('#retry-feedback').innerText(), /Checking/);
  await page.locator('#retry-exit').click();
  await page.reload(); await page.waitForFunction(() => document.querySelector('#saved-count').textContent === '2');
  const commandsAfterReload = await searchCount();
  await openLibrary(page); if (!await page.locator('#saved-panel').evaluate(details => details.open)) await page.locator('#saved-panel > summary').click();
  await page.locator('.saved-open').filter({ hasText: 'Promotion 1 White vs Promotion 1 Black' }).click();
  await page.waitForFunction(() => !document.querySelector('#library-dialog').open);
  assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await fen(), promotions[0].fen);
  assert.equal(await searchCount(), commandsAfterReload, 'Opening a saved promotion review must not run the engine.');
  await openMoves(page); await page.locator('#move-list .move-button[data-ply="1"]').click(); assert.equal(new Chess(await fen()).get('a8').type, 'q');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: reviewed promotion reopens from local storage and retry handles underpromotion with the real engine');
  console.log('All import/promotion UI checks passed.');
} catch (error) {
  console.error(`Import UI failed at: ${stage}`, error);
  if (page) { console.error(await page.locator('#import-status').textContent().catch(() => '')); await page.screenshot({ path: join(root, 'test-results', 'import-ui-failure.png'), fullPage: true }).catch(() => {}); }
  throw error;
} finally {
  await closeIsolatedContext(context);
  if (dirname(profile) === temporaryRoot && basename(profile).startsWith('meowlchess-import-ui-')) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}