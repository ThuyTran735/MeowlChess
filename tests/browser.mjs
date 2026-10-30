import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
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
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
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
  await page.goto('http://127.0.0.1:' + server.address().port + '/review.html');
  await page.waitForFunction(() => document.querySelectorAll('.square').length === 64);
  await page.locator('#review-settings > summary').click();
  assert.equal(await page.locator('#board .piece').count(), 32);
  await page.waitForFunction(() => [...document.querySelectorAll('#board .piece')].every(piece => piece.complete && piece.naturalWidth > 0));
  assert.deepEqual(await page.locator('#depth option').evaluateAll(options => options.map(option => option.value)), ['150', '500', '1500', '3000']);
  assert.deepEqual(await page.locator('#multipv option').evaluateAll(options => options.map(option => option.value)), ['1', '2', '3']);
  assert.equal(await page.locator('#multipv').inputValue(), '3');
  assert.equal(await page.locator('#show-arrows').isChecked(), true);
  assert.equal(await page.locator('#analyze-button').isDisabled(), true);
  assert.equal(await page.locator('#deepen-button').isDisabled(), true);

  // A selected position can be analyzed before a whole-game review.
  await page.locator('#demo-button').click();
  assert.equal(await page.locator('.move-button').count(), 4);
  await page.locator('#deepen-button').click();
  await page.waitForFunction(() => !document.querySelector('#deepen-button').disabled);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 3);
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  assert.equal(await page.locator('#summary').isVisible(), false);
  await page.locator('#demo-button').click();
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 0);

  await page.locator('#depth').selectOption('150');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden);
  assert.equal(await page.locator('#move-list .move-badge').count(), 4);
  assert.equal(await page.locator('.board-move-badge').count(), 1);
  assert.equal(await page.locator('#insight-badge').isVisible(), true);
  assert.equal(await page.locator('#eval-chart button').count(), 5);
  assert.equal(await page.locator('#move-list .move-badge img').count(), 4);
  await page.waitForFunction(() => [...document.querySelectorAll('.move-badge img')].every(image => image.complete && image.naturalWidth > 0));

  await page.locator('#eval-chart button').first().click();
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
  await page.locator('#engine-lines .engine-line').nth(1).click();
  assert.equal(await page.locator('#board .engine-arrow').count(), 1);
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '2');
  await page.locator('#engine-lines .engine-line').nth(1).click();
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  await page.locator('#show-arrows').uncheck();
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  await page.locator('#show-arrows').check();
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  await page.locator('#show-coordinates').uncheck();
  assert.equal(await page.locator('#board .coordinate').count(), 0);
  await page.locator('#show-coordinates').check();
  assert.equal(await page.locator('#board .coordinate').count(), 16);
  await page.locator('#next-button').click();
  await assertLegalCandidates('b');
  await page.locator('#show-badges').uncheck();
  assert.equal(await page.locator('#board .board-move-badge, #move-list .move-badge').count(), 0);
  await page.locator('#show-badges').check();
  assert.equal(await page.locator('#board .board-move-badge').count(), 1);

  // Selected-position searches must not paint their results on a different ply.
  await page.locator('#first-button').click();
  await page.locator('#deepen-button').click();
  await page.locator('#last-button').click();
  await page.waitForFunction(() => document.querySelector('#stop-position').hidden);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 0);
  assert.match(await page.locator('#insight-text').innerText(), /checkmate/i);
  await page.locator('#first-button').click();
  await page.locator('#deepen-button').click();
  await page.locator('#stop-position').click();
  await page.waitForFunction(() => !document.querySelector('#deepen-button').disabled);
  assert.doesNotMatch(await page.locator('#engine-status').innerText(), /searching/i);

  await page.locator('#play-speed').selectOption('700');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => !/starting/i.test(document.querySelector('#position-label').textContent));
  assert.equal(await page.locator('#play-button').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#play-button').getAttribute('aria-pressed'), 'false');
  const pausedPosition = await page.locator('#position-label').innerText();
  await page.waitForTimeout(850); // Longer than the selected autoplay interval; verify keyboard navigation stopped playback.
  assert.equal(await page.locator('#position-label').innerText(), pausedPosition);

  // Fewer requested candidates must propagate through the engine and UI.
  await page.locator('#multipv').selectOption('1');
  await page.locator('#analyze-button').click();
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  await page.waitForFunction(() => !document.querySelector('#summary').hidden);
  await page.locator('#first-button').click();
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 1);
  assert.equal(await page.locator('#board .engine-arrow').count(), 1);
  await page.locator('#multipv').selectOption('3');

  await page.locator('#username').fill('alice');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 0);
  await page.locator('#depth').selectOption('500');
  await page.locator('#analyze-button').click();
  await page.locator('#cancel-button').click();
  await page.waitForFunction(() => !document.querySelector('#analyze-button').disabled);
  assert.match(await page.locator('#review-status').innerText(), /cancel/i);
  await page.locator('#depth').selectOption('150');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden);
  await page.locator('#first-button').click();
  await mkdir(root + '/test-results', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.locator('.board-controls').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), true, 'Board navigation must fit the desktop viewport.');
  await page.screenshot({ path: root + '/test-results/review-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: root + '/test-results/review-laptop.png', fullPage: true });
  const laptopLayout = await page.locator('.board-controls').evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, viewport: innerHeight }));
  assert(laptopLayout.bottom <= laptopLayout.viewport, 'Board navigation must fit a laptop viewport: ' + JSON.stringify(laptopLayout));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: root + '/test-results/review-mobile.png', fullPage: true });
  await page.locator('#last-button').click();
  assert.match(await page.locator('#eval-text').innerText(), /[−-]M0/);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  await page.locator('#username').fill('missing');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => !document.querySelector('#error').hidden);
  assert.match(await page.locator('#error').innerText(), /find|username/i);
  assert.deepEqual(errors, []);
  assert(requests.every(url => /\/games\/(?:archives|\d{4}\/\d{2})$/.test(url)));
  console.log('Browser checks passed: local WASM, vector assets, review options, MultiPV, arrow geometry/flip/toggles/terminal reset, selected-position review/cancel, autoplay, archive guards, and responsive layouts.');
} finally {
  for (const context of browser?.contexts() || []) await Promise.all(context.pages().map(page => page.close({ runBeforeUnload: false })));
  await browser?.close();
  server.close();
}
