import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

// Exercise the packaged page and WASM with the manifest's CSP. This HTTP test
// does not certify extension installation or exercise its toolbar worker.
const root = resolve(import.meta.dirname, '..');
const extensionRoot = resolve(root, 'extension');
const manifest = JSON.parse(await readFile(`${root}/extension/manifest.json`, 'utf8'));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
async function asset(url) {
  const path = resolve(extensionRoot, `.${decodeURIComponent(new URL(url, 'http://localhost').pathname)}`);
  if (!path.startsWith(`${extensionRoot}${sep}`)) throw new Error('Invalid path');
  return { body: await readFile(path), headers: { 'Content-Type': types[extname(path)] || 'text/plain', 'Content-Security-Policy': manifest.content_security_policy.extension_pages } };
}
const server = createServer(async (req, res) => {
  try {
    const { body, headers } = await asset(req.url);
    res.writeHead(200, headers);
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pgn = '[Event "Sample"]\n[White "alice"]\n[Black "bob"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
  const game = { url: 'https://www.chess.com/game/live/12345', pgn, rules: 'chess', time_class: 'rapid', end_time: 1700000000, white: { username: 'alice', result: 'checkmated', rating: 1200 }, black: { username: 'bob', result: 'win', rating: 1220 } };
  const requests = [];
  // Optional offline delivery for environments that block browser loopback
  // networking. Files, CSP, workers, and WASM remain the real packaged assets.
  if (process.env.BROWSER_OFFLINE_ASSETS === '1') {
    await page.route(`http://127.0.0.1:${server.address().port}/**`, async route => {
      try { await route.fulfill({ status: 200, ...await asset(route.request().url()) }); }
      catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
  }
  await page.route('https://api.chess.com/**', async route => {
    const url = route.request().url(); requests.push(url);
    const isList = url.endsWith('/archives');
    await route.fulfill({ status: url.includes('/missing/') ? 404 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(isList ? { archives: ['https://api.chess.com/pub/player/alice/games/2023/11'] } : { games: [game, { ...game, pgn: '[Result "*"]\n1. e4 *', url: 'https://www.chess.com/game/live/999' }] }) });
  });
  const url = `http://127.0.0.1:${server.address().port}/review.html`;
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('.square').length === 64);
  assert.equal(await page.locator('#board .piece').count(), 32);
  await page.waitForFunction(() => [...document.querySelectorAll('#board .piece')].every(piece => piece.complete && piece.naturalWidth > 0));
  assert.match(await page.locator('#classification-legend').textContent(), /Brilliant/);
  assert.match(await page.locator('#classification-legend').textContent(), /Great/);
  assert.equal(await page.locator('#analyze-button').isDisabled(), true);
  await page.locator('#demo-button').click();
  assert.equal(await page.locator('.move-button').count(), 4);
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden, { timeout: 30000 });
  assert.equal(await page.locator('#move-list .move-badge').count(), 4);
  assert.equal(await page.locator('.board-move-badge').count(), 1);
  assert.equal(await page.locator('#insight-badge').isVisible(), true);
  assert.equal(await page.locator('#eval-chart button').count(), 5);
  await page.locator('#eval-chart button').first().click();
  assert.match(await page.locator('#position-label').innerText(), /starting/i);
  await page.locator('#last-button').click();
  assert.match(await page.locator('#insight-text').innerText(), /checkmate/i);
  await page.locator('#first-button').click();
  assert.match(await page.locator('#position-label').innerText(), /starting/i);
  await page.keyboard.press('ArrowRight');
  assert.doesNotMatch(await page.locator('#position-label').innerText(), /starting/i);
  await page.locator('#flip-button').click();
  assert.equal(await page.locator('#board .square').first().locator('.coordinate').last().innerText(), '1');
  await page.locator('#username').fill('alice');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => document.querySelectorAll('.game-card').length === 1);
  await page.locator('.game-card').click();
  await page.locator('#depth').selectOption('500');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#cancel-button').hidden);
  await page.locator('#cancel-button').click();
  await page.waitForFunction(() => !document.querySelector('#analyze-button').disabled);
  assert.match(await page.locator('#review-status').innerText(), /cancel/i);
  await page.locator('#depth').selectOption('150');
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden);
  await page.locator('#last-button').click();
  assert.match(await page.locator('#eval-text').innerText(), /[−-]M0/);
  assert.equal(await page.locator('#eval-white').evaluate(el => Number.parseFloat(el.style.height) < 1), true);
  await mkdir(`${root}/test-results`, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.locator('.board-controls').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), true, 'Board navigation must fit the desktop viewport.');
  await page.screenshot({ path: `${root}/test-results/review-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${root}/test-results/review-laptop.png`, fullPage: true });
  const laptopLayout = await page.evaluate(() => {
    const bounds = selector => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, gridTemplateColumns: style.gridTemplateColumns };
    };
    return { viewport: innerHeight, board: bounds('#board'), controls: bounds('.board-controls'), columns: bounds('.board-layout'), title: bounds('.study-title') };
  });
  assert(laptopLayout.controls.bottom <= laptopLayout.viewport, `Board navigation must fit a 1366×768 laptop viewport: ${JSON.stringify(laptopLayout)}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: `${root}/test-results/review-mobile.png`, fullPage: true });
  await page.locator('#username').fill('missing');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => !document.querySelector('#error').hidden);
  assert.match(await page.locator('#error').innerText(), /find|username/i);
  assert.deepEqual(errors, []);
  assert(requests.every(url => /\/games\/(?:archives|\d{4}\/\d{2})$/.test(url)));
  console.log('Browser checks passed: real local WASM, SVG pieces, move and board badges, evaluation chart, demo, mocked completed archive, navigation, flip, cancellation/retry, responsive layout, and error state.');
} finally {
  for (const context of browser?.contexts() || []) {
    await Promise.all(context.pages().map(page => page.close({ runBeforeUnload: false })));
  }
  await browser?.close();
  server.close();
}
