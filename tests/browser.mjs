import assert from 'node:assert/strict';
import { openLibrary, closeLibrary, openImport, openMoves, openEngine, openSummary, closeTestContext } from './ui-helpers.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep, join } from 'node:path';
import { chromium } from 'playwright-core';
import { Chess } from '../extension/vendor/chess.js';

// Test the real page, local engine, and CSP with controlled archive responses.
const root = resolve(import.meta.dirname, '..');
const extensionRoot = resolve(root, 'extension');
const manifest = JSON.parse(await readFile(root + '/extension/manifest.json', 'utf8'));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
async function asset(url) {
  const path = resolve(extensionRoot, '.' + decodeURIComponent(new URL(url, 'http://localhost').pathname));
  if (!path.startsWith(extensionRoot + sep)) throw new Error('Invalid path');
  return { body: await readFile(path), headers: { 'Content-Type': types[extname(path)] || 'text/plain', 'Content-Security-Policy': manifest.content_security_policy.extension_pages } };
}
const server = createServer(async (req, res) => {
  try { const { body, headers } = await asset(req.url); res.writeHead(200, headers); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-browser-test-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();

  async function ensureSettingsOpen() {
    await closeLibrary(page);
    if (!await page.locator('#review-settings').evaluate(details => details.open)) await page.locator('#review-settings > summary').click();
  }
  async function ensureSettingsClosed() {
    await closeLibrary(page);
    if (await page.locator('#review-settings').evaluate(details => details.open)) await page.locator('#review-settings > summary').click();
  }
  async function selectReviewOption(id, value) {
    await ensureSettingsOpen();
    await page.locator('#' + id).selectOption(value);
  }
  async function setReviewToggle(id, checked) {
    await ensureSettingsOpen();
    await page.locator('#' + id).setChecked(checked);
  }
  async function assertLegalCandidates(color) {
    const fen = (await page.locator('#board').getAttribute('aria-label')).split('FEN: ')[1];
    assert.equal(new Chess(fen).turn(), color);
    assert.match(await page.locator('#engine-turn').innerText(), color === 'w' ? /White to move/ : /Black to move/);
    const candidates = await page.locator('#engine-lines .engine-line').evaluateAll(lines => lines.map(line => ({ uci: line.dataset.uci, rank: line.dataset.rank, color: line.style.getPropertyValue('--line-color') })));
    for (const candidate of candidates) {
      const uci = candidate.uci;
      assert(new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }), 'Engine candidates must be legal in the displayed position.');
    }
    const arrows = await page.locator('#board .engine-arrow').evaluateAll(paths => paths.map(path => ({ uci: path.dataset.uci, rank: path.dataset.rank, color: path.getAttribute('stroke') })));
    for (const arrow of arrows) assert.deepEqual(arrow, candidates.find(candidate => candidate.rank === arrow.rank), 'Arrow colors and moves must match their candidate rows.');
    assert.equal(new Set(candidates.map(candidate => candidate.color)).size, candidates.length);
  }
  // Observe actual engine commands without replacing workers or engine replies.
  await page.addInitScript(() => {
    window.engineCommands = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (typeof message === 'string') window.engineCommands.push(message);
      return send.call(this, message, ...args);
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pgn = '[Event "Sample"]\n[White "alice"]\n[Black "bob"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
  const game = { url: 'https://www.chess.com/game/live/12345', pgn, rules: 'chess', time_class: 'rapid', end_time: 1700000000, white: { username: 'alice', result: 'checkmated', rating: 1200 }, black: { username: 'bob', result: 'win', rating: 1220 } };
  const requests = [];
  if (process.env.BROWSER_OFFLINE_ASSETS === '1') {
    await page.route('http://127.0.0.1:' + server.address().port + '/**', async route => {
      try { await route.fulfill({ status: 200, ...await asset(route.request().url()) }); }
      catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
  }
  await page.route('https://api.chess.com/**', async route => {
    const url = route.request().url(); requests.push(url);
    await route.fulfill({ status: url.includes('/missing/') ? 404 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(url.endsWith('/archives') ? { archives: ['https://api.chess.com/pub/player/alice/games/2023/11'] } : { games: [game, { ...game, pgn: '[Result "*"]\n1. e4 *', url: 'https://www.chess.com/game/live/999' }] }) });
  });
  const lichessRequests = [];
  const lichessGame = { id: 'abcdefgh', variant: 'standard', status: 'mate', winner: 'black', speed: 'rapid', lastMoveAt: 1700000000000, pgn, players: { white: { user: { name: 'alice' }, rating: 1200 }, black: { user: { name: 'bob' }, rating: 1220 } } };
  await page.route('https://lichess.org/**', async route => {
    const url = new URL(route.request().url()); lichessRequests.push(url.toString());
    const single = url.pathname.startsWith('/game/export/');
    const unfinished = { ...lichessGame, id: 'live0001', status: 'started' };
    await route.fulfill({ status: 200, contentType: single ? 'application/json' : 'application/x-ndjson', headers: { 'access-control-allow-origin': '*' }, body: single ? JSON.stringify(url.pathname.endsWith('live0001') ? unfinished : lichessGame) : [lichessGame, unfinished].map(JSON.stringify).join('\n') });
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/review.html');
  await page.waitForFunction(() => document.querySelectorAll('.square').length === 64);
  assert.equal(await page.locator('#review-settings').evaluate(details => details.open), false, 'Review settings start closed.');
  assert.equal(await page.locator('#moves-panel').isVisible(), true);
  assert.equal(await page.locator('#summary-panel').isVisible(), false);
  await ensureSettingsOpen();
  assert.equal(await page.locator('#board .piece').count(), 32);
  await page.waitForFunction(() => [...document.querySelectorAll('#board .piece')].every(piece => piece.complete && piece.naturalWidth > 0));
  assert.deepEqual(await page.locator('#depth option').evaluateAll(options => options.map(option => option.value)), ['50', '150', '500', '1500', '3000']);
  assert.deepEqual(await page.locator('#multipv option').evaluateAll(options => options.map(option => option.value)), ['1', '2', '3']);
  assert.equal(await page.locator('#multipv').inputValue(), '3');
  assert.deepEqual(await page.locator('#engine option').evaluateAll(options => options.map(option => option.value)), ['stockfish', 'lozza']);
  assert.deepEqual(await page.locator('#game-source option').evaluateAll(options => options.map(option => option.value)), ['chesscom', 'lichess']);
  assert.deepEqual(await page.locator('#board .square.light').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(235, 236, 208)');
  assert.deepEqual(await page.locator('#board .square.dark').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(115, 149, 82)');
  assert.equal(await page.locator('#board .piece').evaluateAll(images => images.every(image => image.naturalWidth === 300 && image.src.endsWith('.png'))), true);
  assert.equal(await page.locator('#quick-position').isDisabled(), true);
  assert.equal(await page.locator('#show-arrows').isChecked(), true);
  assert.equal(await page.locator('#arrow-mode').inputValue(), 'best');
  assert.equal(await page.locator('#smart-analysis').isChecked(), true);
  await setReviewToggle('smart-analysis', false);
  assert.equal(await page.locator('#analyze-button').isDisabled(), true);
  assert.equal(await page.locator('#deepen-button').isDisabled(), true);

  // A selected position can be analyzed before a whole-game review.
  await openLibrary(page);
  await page.locator('#demo-button').click();
  assert.equal(await page.locator('.move-button').count(), 4);
  await openEngine(page);
  await page.locator('#quick-position').click();
  await page.waitForFunction(() => !document.querySelector('#quick-position').disabled);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 3);
  assert.equal(await page.evaluate(() => window.engineCommands.includes('go movetime 150')), true, 'Quick look must request a real 150 ms engine search.');
  await assertLegalCandidates('w');
  assert.equal(await page.locator('#board .engine-arrow').count(), 1, 'Best-move arrows are the default despite three available engine lines.');
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '1');
  await page.locator('#engine-lines .engine-line').nth(1).hover();
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '2');
  await page.locator('#game-title').hover();
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '1');
  await page.locator('#engine-lines .engine-line').nth(2).focus();
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '3');
  await page.locator('#next-button').focus();
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '1');
  await selectReviewOption('arrow-mode', 'all');
  await openEngine(page);
  await page.locator('#deepen-button').click();
  await page.waitForFunction(() => !document.querySelector('#deepen-button').disabled);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 3);
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  assert.equal(await page.locator('#summary').isVisible(), false);
  await openLibrary(page);
  await page.locator('#demo-button').click();
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 0);

  await selectReviewOption('depth', '150');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  assert.equal(await page.locator('#move-list .move-badge').count(), 4);
  assert.equal(await page.locator('.board-move-badge').count(), 0);
  assert.match(await page.locator('#position-label').innerText(), /starting/i);
  assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#insight-badge').isVisible(), false);
  assert.equal(await page.locator('#eval-chart button').count(), 5);
  assert.equal(await page.locator('#move-list .move-badge img').count(), 4);
  await page.waitForFunction(() => [...document.querySelectorAll('.move-badge img')].every(image => image.complete && image.naturalWidth > 0));

  // A finished review starts at the initial position in Summary. Moves remain one action away.
  await ensureSettingsClosed();
  await openMoves(page);
  assert.equal(await page.locator('#moves-panel').isVisible(), true);
  assert.equal(await page.locator('#summary-panel').isVisible(), false);
  assert.equal(await page.locator('#moves-tab').getAttribute('aria-selected'), 'true');
  await page.locator('#summary-tab').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#summary-panel').isVisible(), true);
  assert.equal(await page.locator('#summary').isVisible(), true);
  assert.equal(await page.locator('#moves-panel').isVisible(), false);
  assert.equal(await page.locator('.engine-panel').isVisible(), false);
  await page.locator('#moves-tab').click();
  assert.equal(await page.locator('#moves-panel').isVisible(), true);
  assert.equal(await page.locator('#summary-panel').isVisible(), false);
  assert.equal(await page.locator('.engine-panel').isVisible(), true);
  const tabPosition = await page.locator('#position-label').innerText();
  await page.locator('#moves-tab').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#practice-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#practice-tab').evaluate(tab => tab === document.activeElement), true);
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.locator('#practice-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#practice-panel').isVisible(), true);
  assert.equal(await page.locator('#position-label').innerText(), tabPosition, 'Tab navigation must not navigate game moves.');
  await page.locator('#moves-tab').click();
  await ensureSettingsClosed();
  await page.locator('#moves-tab').click();
  await mkdir(root + '/test-results', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: root + '/test-results/review-first-pass.png', fullPage: true });

  await openSummary(page);
  await page.locator('#eval-chart button').first().click();
  await openEngine(page);
  assert.match(await page.locator('#position-label').innerText(), /starting/i);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 3);
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  await assertLegalCandidates('w');
  const normalArrows = await page.locator('#board .engine-arrow').evaluateAll(paths => paths.map(path => ({ rank: path.dataset.rank, uci: path.dataset.uci, from: path.dataset.from, to: path.dataset.to, d: path.getAttribute('d') })));
  assert(normalArrows.every(arrow => /^[a-h][1-8]$/.test(arrow.from) && /^[a-h][1-8]$/.test(arrow.to) && arrow.d));
  await page.locator('#flip-button').click();
  const flippedArrows = await page.locator('#board .engine-arrow').evaluateAll(paths => paths.map(path => ({ rank: path.dataset.rank, uci: path.dataset.uci, from: path.dataset.from, to: path.dataset.to, d: path.getAttribute('d') })));
  assert.deepEqual(flippedArrows.map(({ d, ...arrow }) => arrow), normalArrows.map(({ d, ...arrow }) => arrow));
  assert(flippedArrows.every((arrow, index) => arrow.d !== normalArrows[index].d), 'Every arrow must rotate with the board.');
  await page.locator('#flip-button').click();
  assert.deepEqual(await page.locator('#board .engine-arrow').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), normalArrows.map(arrow => arrow.d));
  const gamePositionBeforeVariation = await page.locator('#board').getAttribute('aria-label');
  await page.locator('#engine-lines .engine-line').nth(1).hover();
  assert.equal(await page.locator('#board .engine-arrow').count(), 1);
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '2');
  await page.locator('#engine-lines .engine-line').nth(1).click();
  assert.equal(await page.locator('#study-controls').isVisible(), true);
  assert.match(await page.locator('#board').getAttribute('aria-label'), /variation/);
  assert.equal(await page.locator('#move-list .move-button').count(), 4, 'Trying an engine line must preserve the completed game.');
  await page.locator('#return-game').click();
  assert.equal(await page.locator('#study-controls').isVisible(), false);
  assert.equal(await page.locator('#board').getAttribute('aria-label'), gamePositionBeforeVariation);
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  await setReviewToggle('show-arrows', false);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  await setReviewToggle('show-arrows', true);
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  await setReviewToggle('show-coordinates', false);
  assert.equal(await page.locator('#board .coordinate').count(), 0);
  await setReviewToggle('show-coordinates', true);
  assert.equal(await page.locator('#board .coordinate').count(), 16);
  await page.locator('#next-button').click();
  await assertLegalCandidates('b');
  await setReviewToggle('show-badges', false);
  assert.equal(await page.locator('#board .board-move-badge, #move-list .move-badge').count(), 0);
  await setReviewToggle('show-badges', true);
  assert.equal(await page.locator('#board .board-move-badge').count(), 1);

  // Selected-position searches must not paint their results on a different ply.
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  await page.locator('#deepen-button').click();
  await page.locator('#last-button').click();
  await page.waitForFunction(() => document.querySelector('#stop-position').hidden);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 0);
  assert.match(await page.locator('#insight-text').innerText(), /checkmate/i);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  await page.locator('#deepen-button').click();
  await page.locator('#stop-position').click();
  await page.waitForFunction(() => !document.querySelector('#deepen-button').disabled);
  assert.doesNotMatch(await page.locator('#engine-status').innerText(), /searching/i);

  await selectReviewOption('play-speed', '700');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => !/starting/i.test(document.querySelector('#position-label').textContent));
  assert.equal(await page.locator('#play-button').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#play-button').getAttribute('aria-pressed'), 'false');
  const pausedPosition = await page.locator('#position-label').innerText();
  await page.waitForTimeout(850); // Longer than the selected autoplay interval; verify keyboard navigation stopped playback.
  assert.equal(await page.locator('#position-label').innerText(), pausedPosition);

  // Fewer requested candidates must propagate through the engine and UI.
  await selectReviewOption('multipv', '1');
  await page.locator('#analyze-button').click();
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 1);
  assert.equal(await page.locator('#board .engine-arrow').count(), 1);
  await selectReviewOption('multipv', '3');

  // Fast reviews run the real engines and keep a legal best-move arrow.
  await selectReviewOption('depth', '50');
  assert.equal(await page.locator('#multipv').inputValue(), '1');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 1);
  await assertLegalCandidates('w');
  assert.equal(await page.evaluate(() => window.engineCommands.includes('go movetime 50')), true);
  await selectReviewOption('engine', 'lozza');
  assert.match(await page.locator('#review-engine').innerText(), /Stockfish/, 'Changing engine selection must retain the existing review attribution.');
  assert.equal(await page.locator('#multipv').isDisabled(), true);
  assert.equal(await page.locator('#multipv').inputValue(), '1');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 1);
  assert.match(await page.locator('#engine-status').innerText(), /Lozza/);
  assert.match(await page.locator('#review-engine').innerText(), /Lozza/);
  await assertLegalCandidates('w');
  await openEngine(page);
  await page.locator('#quick-position').click();
  await page.waitForFunction(() => !document.querySelector('#quick-position').disabled);
  await assertLegalCandidates('w');
  await selectReviewOption('engine', 'stockfish');
  assert.equal(await page.locator('#multipv').isDisabled(), false);
  await selectReviewOption('depth', '150');
  await selectReviewOption('multipv', '3');

  // A one-move navigation animates the moving piece, with an immediate reduced-motion alternative.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const animated = await page.locator('#next-button').evaluate(button => { button.click(); return document.querySelector('#board').getAnimations({ subtree: true }).filter(animation => animation.effect.target.classList.contains('piece')).length; });
  assert(animated > 0, 'Stepping one move should animate a piece.');
  await page.locator('#board').evaluate(board => Promise.all(board.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.locator('#previous-button').evaluate(button => { button.click(); return document.querySelector('#board').getAnimations({ subtree: true }).filter(animation => animation.effect.target.classList.contains('piece')).length; });
  assert.equal(reduced, 0, 'Reduced motion must move pieces immediately.');

  // Public Lichess exports exclude started games, including a pasted live-game URL.
  await openLibrary(page);
  await page.locator('#game-source').selectOption('lichess');
  assert.match(await page.locator('#username-label').innerText(), /Lichess.*URL/);
  await openLibrary(page);
  await page.locator('#username').fill('alice');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => !document.querySelector('#load-button').disabled);
  assert.equal(await page.locator('.game-card').count(), 1);
  assert.match(await page.locator('#game-subtitle').innerText(), /Lichess/);
  await openLibrary(page);
  await page.locator('#username').fill('https://lichess.org/abcdefgh/black#2');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => !document.querySelector('#load-button').disabled);
  assert.equal(await page.locator('.game-card').count(), 1);
  assert.equal(await page.locator('#game-subtitle a').getAttribute('href'), 'https://lichess.org/abcdefgh');
  await openLibrary(page);
  await page.locator('#username').fill('https://lichess.org/live0001');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => !document.querySelector('#load-button').disabled);
  assert.equal(await page.locator('.game-card').count(), 0);
  assert.match(await page.locator('#error').innerText(), /completed|unfinished/);
  assert(lichessRequests.some(value => value.includes('/api/games/user/alice') && value.includes('ongoing=false') && value.includes('finished=true')));
  assert(lichessRequests.some(value => value.includes('/game/export/abcdefgh?')));

  // Both paste and file imports use real PGN parsing and preserve completion guards.
  await openImport(page);
  await page.locator('#pgn-text').fill('[Result "*"]\n\n1. e4 *');
  await page.locator('#import-button').click();
  assert.match(await page.locator('#import-status').innerText(), /completed/);
  const networkBeforeImport = requests.length + lichessRequests.length;
  await openImport(page);
  await page.locator('#pgn-text').fill(pgn);
  await page.locator('#import-button').click();
  assert.equal(await page.locator('.move-button').count(), 4);
  assert.match(await page.locator('#game-subtitle').innerText(), /Imported PGN/);
  assert.equal(await page.locator('#error').isVisible(), false);
  const drawPgn = '[Event "Agreed draw"]\n[White "File White"]\n[Black "File Black"]\n[Result "1/2-1/2"]\n\n1. Nf3 Nf6 1/2-1/2';
  await openImport(page);
  await page.locator('#pgn-file').setInputFiles({ name: 'finished-game.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(drawPgn) });
  await page.waitForFunction(() => document.querySelector('#game-title').textContent === 'File White vs File Black');
  assert.equal(await page.locator('.move-button').count(), 2);
  await page.locator('#last-button').click();
  assert.equal(await page.locator('#board .board-move-badge.draw').count(), 2);
  assert.equal(requests.length + lichessRequests.length, networkBeforeImport, 'Importing a PGN must remain local.');
  const fenPgn = '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 23"]\n[White "Setup White"]\n[Black "Setup Black"]\n[Result "1/2-1/2"]\n\n23... e5 24. Nf3 1/2-1/2';
  await openImport(page);
  await page.locator('#pgn-text').fill(fenPgn);
  await page.locator('#import-button').click();
  assert.equal(await page.locator('.move-button').count(), 2);
  await page.locator('#next-button').click();
  assert.match(await page.locator('#position-label').innerText(), /23.*e5/);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  await page.locator('#quick-position').click();
  await page.waitForFunction(() => !document.querySelector('#quick-position').disabled);
  await assertLegalCandidates('b');
  await openImport(page);
  await openLibrary(page);
  await page.locator('#game-source').selectOption('chesscom');
  await openLibrary(page);
  await page.locator('#username').fill('alice');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 0);
  await selectReviewOption('depth', '500');
  await page.locator('#analyze-button').click();
  await page.locator('#cancel-button').click();
  await page.waitForFunction(() => !document.querySelector('#analyze-button').disabled);
  assert.match(await page.locator('#review-status').innerText(), /cancel/i);
  await selectReviewOption('depth', '150');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  await ensureSettingsClosed();
  assert.equal(await page.locator('#review-settings').evaluate(details => details.open), false);
  await page.locator('#moves-tab').click();
  await mkdir(root + '/test-results', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.locator('.board-controls').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), true, 'Board navigation must fit the desktop viewport.');
  await page.screenshot({ path: root + '/test-results/review-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const compactLayout = await page.evaluate(() => {
    const board = document.querySelector('#board').getBoundingClientRect();
    const moves = document.querySelector('#move-list').getBoundingClientRect();
    const controls = document.querySelector('.board-controls').getBoundingClientRect();
    return { board: { width: board.width, right: board.right, bottom: board.bottom }, moves: { left: moves.left, top: moves.top, width: moves.width }, controlsBottom: controls.bottom, height: innerHeight };
  });
  assert(compactLayout.board.width >= 460, 'The board must remain at least 460px wide on a 1366×768 laptop: ' + JSON.stringify(compactLayout));
  assert(compactLayout.controlsBottom <= compactLayout.height, 'Board navigation remains in view: ' + JSON.stringify(compactLayout));
  assert(compactLayout.moves.left >= compactLayout.board.right && compactLayout.moves.top < compactLayout.height - 40, 'Moves must be visible beside the board without expanding summary: ' + JSON.stringify(compactLayout));
  await page.screenshot({ path: root + '/test-results/review-laptop.png', fullPage: true });
  const laptopLayout = await page.locator('.board-controls').evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, viewport: innerHeight }));
  assert(laptopLayout.bottom <= laptopLayout.viewport, 'Board navigation must fit a laptop viewport: ' + JSON.stringify(laptopLayout));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#library-toggle').getAttribute('aria-expanded') === 'false');
  assert.equal(await page.locator('#library-dialog').isVisible(), false);
  const phoneBoardTop = await page.locator('#board').evaluate(board => board.getBoundingClientRect().top);
  assert(phoneBoardTop < 300, 'The selected game board must appear near the top on phones: ' + phoneBoardTop);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: root + '/test-results/review-mobile.png', fullPage: true });
  await page.locator('#last-button').click();
  assert.match(await page.locator('#eval-text').innerText(), /[−-]M0/);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  await openLibrary(page);
  await page.locator('#username').fill('missing');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => !document.querySelector('#error').hidden);
  assert.match(await page.locator('#error').innerText(), /find|username/i);
  assert.deepEqual(errors, []);
  assert(requests.every(url => /\/games\/(?:archives|\d{4}\/\d{2})$/.test(url)));
  console.log('Browser checks passed: local Stockfish/Lozza, exact artwork, Fast/Quick searches, PGN/Lichess completion guards, motion preferences, settings, three review tabs, hover arrows and variations, compact board layout, review options, MultiPV, arrow geometry/flip/toggles/terminal reset, selected-position review/cancel, autoplay, archive guards, and responsive layouts.');
} catch (error) {
  console.error(error);
  for (const page of context?.pages() || []) {
    console.error('Browser failure state:', await page.evaluate(() => ({ error: document.querySelector('#error')?.textContent, review: document.querySelector('#review-status')?.textContent, engine: document.querySelector('#engine-status')?.textContent, progress: document.querySelector('#progress-text')?.textContent, summary: document.querySelector('#summary')?.hidden, commands: window.engineCommands?.slice(-12) })).catch(() => ({})));
  }
  throw error;
} finally {
  await closeTestContext(context, profile, 'meowlchess-browser-test-');
  server.close();
}
