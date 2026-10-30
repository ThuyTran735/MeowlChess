import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

// The production extension, engines, broker and storage run unchanged. Only site
// markup/public responses are fixtures; no private Chess.com endpoint is used.
const root = resolve(import.meta.dirname, '..');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-bot-test-'));
const bundle = await mkdtemp(join(temporaryRoot, 'meowlchess-bot-bundle-'));
const extension = join(bundle, 'extension');
const PAGE = 'https://www.chess.com/play/computer';
const HOST = '#meowlchess-site-review';
const pgn = '[Event "Bot browser fixture"]\n[White "Guest"]\n[Black "Martin"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const promotionPgn = '[Event "Bot promotion fixture"]\n[White "Guest"]\n[Black "Martin"]\n[SetUp "1"]\n[FEN "8/P7/8/8/8/6k1/8/4K3 w - - 0 1"]\n[Result "1-0"]\n\n1. a8=Q 1-0';
const pastePgn = '[Event "Bot paste fixture"]\n[White "Guest"]\n[Black "Martin"]\n[Result "1/2-1/2"]\n\n1. d4 d5 1/2-1/2';
const unfinished = pgn.replaceAll('0-1', '*');
let context, worker, page, cdp, stage = 'launch';
const errors = [], unexpectedRequests = [];
const checkpoint = setInterval(() => console.log(`Bot UI checkpoint: ${stage}`), 15000); checkpoint.unref();

async function poll(read, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(`Timed out: ${label}`);
}
async function shadowNode(selector) {
  const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const find = node => {
    if (node.attributes?.some((value, index) => index % 2 === 0 && value === 'id' && node.attributes[index + 1] === 'meowlchess-site-review')) return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const result = find(child); if (result) return result; }
    return null;
  };
  const host = find(tree.root);
  assert(host?.shadowRoots?.length, 'The closed review shadow root exists.');
  const result = await cdp.send('DOM.querySelector', { nodeId: host.shadowRoots[0].nodeId, selector });
  assert(result.nodeId, `Missing shadow control: ${selector}`);
  return result.nodeId;
}
async function shadowPoint(selector) {
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: await shadowNode(selector) });
  return { x: (model.content[0] + model.content[2]) / 2, y: (model.content[1] + model.content[5]) / 2 };
}
async function shadowClick(selector) { await page.waitForTimeout(180); const point = await shadowPoint(selector); await page.mouse.click(point.x, point.y); }
async function shadowFill(selector, value) {
  await cdp.send('DOM.focus', { nodeId: await shadowNode(selector) });
  await page.keyboard.press('Control+A'); await page.keyboard.insertText(value);
}
async function shadowText(selector) {
  const { object } = await cdp.send('DOM.resolveNode', { nodeId: await shadowNode(selector) });
  try { return (await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){return this.textContent}', returnByValue: true })).result.value; }
  finally { await cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
}
async function waitFrame() {
  let found;
  await poll(async () => { found = page.frames().find(item => /\/site-summary\.html#/.test(item.url())); return found; }, 'summary frame', 60000);
  return found;
}
async function complete(frame) {
  await poll(async () => {
    const state = await frame.evaluate(() => ({ visible: !document.querySelector('#summary-result').hidden, error: document.querySelector('#summary-status').classList.contains('error'), text: document.querySelector('#summary-status').textContent }));
    if (state.error) {
      console.error('Recent engine messages:', await frame.evaluate(() => window.__botUi.messages));
      throw new Error(`Summary: ${state.text}`);
    }
    return state.visible && !await frame.locator('#summary-open-review').isDisabled();
  }, 'finished and saved bot summary', 120000);
  assert.equal(await frame.locator('#summary-source').innerText(), 'Chess.com · bot game');
  const telemetry = await frame.evaluate(() => window.__botUi);
  assert(telemetry.progressBeforeSummary, 'A progress bar precedes summary.');
  assert.equal(telemetry.workers, telemetry.terminated, 'The real engine stops after completing.');
  return telemetry;
}
async function records() {
  return worker.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('meowlchess-review-library', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const request = database.transaction('reviews', 'readonly').objectStore('reviews').getAll();
      request.onerror = () => { database.close(); reject(request.error); };
      request.onsuccess = () => { database.close(); resolve(request.result); };
    };
  }));
}
async function restartRound() {
  await page.evaluate(() => { document.querySelector('#result').textContent = 'In progress'; document.querySelector('#share-modal')?.replaceChildren(); window.__fixturePgn = ''; });
  await poll(async () => page.frames().every(frame => !/\/site-summary\.html#/.test(frame.url())), 'old summary cleared on rematch');
  await page.waitForTimeout(1100);
}

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, 'scripting'])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...manifest.optional_host_permissions])];
  delete manifest.optional_permissions; delete manifest.optional_host_permissions;
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: process.env.HEADED_EXT_TEST !== '1', viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.env.HEADED_EXT_TEST === '1' ? ['--start-minimized'] : [])],
  });
  context.setDefaultTimeout(20000);
  await context.route(/^https?:\/\//, route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && url.origin === 'https://www.chess.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><title>Bot review fixture</title><style>body{background:#302e2b;color:#eee;font:18px Arial;margin:30px}dialog{border:1px solid #888;background:#eee;color:#222;padding:18px}textarea{display:block;width:500px;height:150px}.small-controls-leftIcons{margin-top:20px}</style></head><body><h1>Computer game fixture</h1><div id="result" data-cy="game-result">In progress</div><div class="small-controls-leftIcons"><button id="download" aria-label="Download">Download</button></div><div id="share-modal"></div></body></html>' });
    if (url.pathname !== '/favicon.ico') unexpectedRequests.push(request.url());
    return route.abort();
  });
  await context.addInitScript(() => {
    window.__botUi = { workers: 0, terminated: 0, searches: 0, progressSeen: false, summarySeen: false, progressBeforeSummary: false, messages: [] };
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.__botUi.workers++; this.addEventListener('message', event => { if (typeof event.data === 'string') { window.__botUi.messages.push(event.data.slice(0, 600)); if (window.__botUi.messages.length > 12) window.__botUi.messages.shift(); } }); }
      postMessage(message, ...args) { if (typeof message === 'string' && /^go\b/.test(message)) window.__botUi.searches++; return super.postMessage(message, ...args); }
      terminate() { window.__botUi.terminated++; return super.terminate(); }
    };
    const visible = element => element && !element.hidden && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    new MutationObserver(() => {
      if (visible(document.querySelector('#summary-progress'))) window.__botUi.progressSeen = true;
      if (visible(document.querySelector('#summary-result')) && !window.__botUi.summarySeen) { window.__botUi.summarySeen = true; window.__botUi.progressBeforeSummary = window.__botUi.progressSeen; }
    }).observe(document, { attributes: true, childList: true, subtree: true });
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(async oldPgn => {
    globalThis.__botFetches = [];
    // A previous public human game exists but must never be consulted for bots.
    globalThis.fetch = async input => {
      const url = typeof input === 'string' ? input : input.url; globalThis.__botFetches.push(url);
      if (url.endsWith('/archives')) return { ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/alice/games/2026/10'] }) };
      return { ok: true, json: async () => ({ games: [{ rules: 'chess', url: 'https://www.chess.com/game/live/123', pgn: oldPgn.replace('Guest', 'Alice'), end_time: Math.floor(Date.now() / 1000) - 60, white: { username: 'Alice', result: 'checkmated' }, black: { username: 'Martin', result: 'win' } }] }) };
    };
    await chrome.storage.local.set({ siteReviewSettings: { chesscom: { enabled: true, username: 'alice' }, lichess: { enabled: false, username: '' } }, reviewSettings: { engine: 'stockfish', time: '1500', lines: '1', smart: false }, tutorialNever: true });
  }, pgn);
  await poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).some(script => script.id === 'meowl-site-chesscom' && script.js.includes('site-bot.js') && script.js.includes('site-panel.js'))), 'three production helpers registered');
  page = await context.newPage(); cdp = await context.newCDPSession(page);
  page.on('pageerror', error => errors.push(error.message));
  const installFixture = async () => {
    await page.evaluate(value => {
      window.__fixturePgn = value; window.__downloads = 0; window.__shareCloses = 0;
      document.querySelector('#download').addEventListener('click', () => {
        window.__downloads++;
        const modal = document.createElement('dialog');
        const header = document.createElement('div'); header.className = 'share-menu-modal-header';
        const close = document.createElement('button'); close.className = 'cc-modal-header-close'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close share');
        close.onclick = () => { window.__shareCloses++; modal.close(); modal.remove(); }; header.append(close);
        const body = document.createElement('div'); body.className = 'share-menu-tab-pgn-component';
        const text = document.createElement('textarea'); text.name = 'pgn'; text.readOnly = true; text.setAttribute('aria-label', 'PGN'); text.value = window.__fixturePgn; body.append(text);
        modal.append(header, body); document.querySelector('#share-modal').append(modal); modal.showModal();
      });
    }, unfinished);
  };
  await page.goto(PAGE); await page.bringToFront(); await installFixture();
  stage = 'unfinished bot page and movable collapsed panel';
  await page.waitForFunction(() => document.querySelector('#meowlchess-site-review')?.dataset.state === 'bot');
  assert.equal(await page.locator(HOST).getAttribute('data-collapsed'), 'true');
  await page.waitForTimeout(1200);
  assert.equal(page.frames().length, 1); assert.equal(await page.evaluate(() => window.__downloads), 0);
  assert.deepEqual(await worker.evaluate(() => globalThis.__botFetches), []);
  const handle = await shadowPoint('.brand');
  await page.mouse.move(handle.x, handle.y); await page.mouse.down(); await page.mouse.move(140, 540, { steps: 12 }); await page.mouse.up();
  const moved = await page.locator(HOST).boundingBox();
  assert(moved.x < 300 && moved.y > 450, 'The actual integrated header drags the panel.');
  await poll(() => worker.evaluate(async () => Boolean((await chrome.storage.local.get('siteReviewPanelPosition:chesscom'))['siteReviewPanelPosition:chesscom'])), 'panel placement saved');
  const preferred = await worker.evaluate(async () => (await chrome.storage.local.get('siteReviewPanelPosition:chesscom'))['siteReviewPanelPosition:chesscom']);

  stage = 'finish triggers official export, real Stockfish progress, summary and save';
  await page.evaluate(value => { window.__fixturePgn = value; document.querySelector('#result').textContent = '0–1'; }, pgn);
  const firstFrame = await waitFrame();
  const firstTelemetry = await complete(firstFrame);
  assert(firstTelemetry.workers > 0 && firstTelemetry.searches > 0, 'A bundled local engine actually searched.');
  assert.equal(await page.evaluate(() => window.__downloads), 1);
  assert.equal(await page.evaluate(() => window.__shareCloses), 1, 'Only the automatically opened export is closed.');
  assert.equal(await page.locator('#share-modal dialog').count(), 0);
  assert.equal((await records()).length, 1);
  assert.equal((await records())[0].game.pgn, pgn);
  await page.waitForTimeout(300);
  const grown = await page.locator(HOST).boundingBox();
  assert(Math.abs(grown.x - preferred.left) <= 2, 'Summary retains the horizontal drag placement.');
  assert(grown.y + grown.height <= 900 - 6 && grown.y >= 6, 'Growing summary remains on screen.');
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('siteReviewPanelPosition:chesscom'))['siteReviewPanelPosition:chesscom']), preferred, 'Automatic growth does not overwrite preferred placement.');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'site-bot-summary.png') });
  console.log('Bot UI: automatic export, Stockfish progress/summary, Guest save, drag and growth clamp passed.');

  stage = 'rematch clears old review; custom starting position and promotion export';
  await restartRound();
  assert.equal((await records()).length, 1);
  await page.evaluate(value => { window.__fixturePgn = value; document.querySelector('#result').textContent = '1–0'; }, promotionPgn);
  const promotionFrame = await waitFrame(); await complete(promotionFrame);
  assert.equal((await records()).length, 2);
  const promoted = (await records()).find(record => record.game.pgn.includes('Bot promotion fixture'));
  assert(promoted?.game.pgn.includes('[FEN "8/P7/8/8/8/6k1/8/4K3 w - - 0 1"]'));
  assert(promoted.game.pgn.includes('a8=Q'));
  assert.equal(await page.evaluate(() => window.__downloads), 2);
  console.log('Bot UI: rematch cancellation and promotion/FEN export passed.');

  stage = 'manual paste fallback and invalid PGN feedback';
  await restartRound();
  await page.evaluate(() => { document.querySelector('#download').remove(); document.querySelector('#result').textContent = '1/2-1/2'; });
  await page.waitForFunction(() => document.querySelector('#meowlchess-site-review')?.dataset.state === 'bot');
  await poll(async () => /Open Share/.test(await shadowText('.bot-feedback')), 'manual fallback after export unavailable');
  await shadowClick('.bot-import summary');
  await shadowFill('textarea[aria-label="Finished bot game PGN"]', unfinished);
  await shadowClick('.bot-import details .bot-action');
  await poll(async () => /completed|finished/i.test(await shadowText('.bot-feedback')), 'unfinished import error');
  assert.equal(page.frames().length, 1);
  await shadowFill('textarea[aria-label="Finished bot game PGN"]', pastePgn);
  await shadowClick('.bot-import details .bot-action');
  const pastedFrame = await waitFrame(); await complete(pastedFrame);
  assert.equal((await records()).length, 3);
  assert((await records()).some(record => record.game.pgn === pastePgn));
  console.log('Bot UI: manual paste and incomplete-PGN rejection passed.');

  stage = 'close dismissal and persisted panel placement after refresh';
  await pastedFrame.locator('#summary-close').click();
  await page.locator(HOST).waitFor({ state: 'detached' });
  await page.waitForTimeout(1400); assert.equal(await page.locator(HOST).count(), 0);
  await page.reload(); await installFixture();
  await page.waitForFunction(() => document.querySelector('#meowlchess-site-review')?.dataset.state === 'bot');
  await page.waitForTimeout(250);
  const restored = await page.locator(HOST).boundingBox();
  assert(Math.abs(restored.x - preferred.left) <= 2 && Math.abs(restored.y - preferred.top) <= 2, 'Reload restores the saved placement.');

  stage = 'unfinished export times out and closes only the automatically opened modal';
  await page.evaluate(() => { document.querySelector('#result').textContent = '0–1'; });
  await page.locator('#share-modal dialog').waitFor({ state: 'visible' });
  await page.locator('#share-modal dialog').waitFor({ state: 'detached', timeout: 12000 });
  assert.equal(await page.evaluate(() => window.__shareCloses), 1);
  assert.equal(page.frames().length, 1, 'An unfinished export cannot start an engine.');
  assert.equal((await records()).length, 3);

  stage = 'preexisting user export modal is preserved on timeout';
  await restartRound();
  await page.evaluate(value => { window.__fixturePgn = value; }, unfinished);
  await page.locator('#download').click();
  await page.evaluate(() => { document.querySelector('#result').textContent = '0–1'; });
  await page.waitForTimeout(6200);
  assert.equal(await page.locator('#share-modal dialog').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__shareCloses), 1, 'The user-owned modal remains open.');
  assert.equal(page.frames().length, 1);
  await page.getByRole('button', { name: 'Close share', exact: true }).click();

  stage = 'starting a rematch while export is pending discards its late PGN';
  await restartRound();
  await page.evaluate(value => { window.__fixturePgn = value; document.querySelector('#result').textContent = '0–1'; }, unfinished);
  await page.locator('#share-modal dialog').waitFor({ state: 'visible' });
  await page.evaluate(value => {
    const oldExport = document.querySelector('#share-modal textarea');
    document.querySelector('#result').textContent = 'In progress';
    // The site's export arrives after the next round starts. The old element
    // stays referenced so this models delayed delivery even if it was closed.
    setTimeout(() => { oldExport.value = value; }, 650);
  }, pgn.replace('Bot browser fixture', 'Bot abandoned export fixture'));
  await page.locator('#share-modal dialog').waitFor({ state: 'detached' });
  await page.waitForTimeout(1000);
  assert.equal(page.frames().length, 1, 'Late PGN from the previous round cannot start a review.');
  assert.equal((await records()).length, 3, 'The abandoned export is not saved.');
  assert.equal(await page.evaluate(() => window.__shareCloses), 3);
  const nextRoundPgn = pastePgn.replace('Bot paste fixture', 'Bot rematch after export fixture');
  await page.evaluate(value => { window.__fixturePgn = value; document.querySelector('#result').textContent = '1/2-1/2'; }, nextRoundPgn);
  const nextRoundFrame = await waitFrame(); await complete(nextRoundFrame);
  assert.equal((await records()).length, 4);
  assert((await records()).some(record => record.game.pgn === nextRoundPgn));
  assert.equal(await page.evaluate(() => window.__shareCloses), 4);
  console.log('Bot UI: pending-export rematch rejects late old PGN and reviews the next completed round.');

  stage = 'disabling during export closes its modal and removes the panel';
  await restartRound();
  await page.evaluate(value => { window.__fixturePgn = value; document.querySelector('#result').textContent = '0–1'; }, unfinished);
  await page.locator('#share-modal dialog').waitFor({ state: 'visible' });
  await worker.evaluate(async () => { await chrome.storage.local.set({ siteReviewSettings: { chesscom: { enabled: false, username: 'alice' } } }); });
  await page.locator(HOST).waitFor({ state: 'detached' });
  await page.locator('#share-modal dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__shareCloses), 5);
  await poll(() => worker.evaluate(async () => !(await chrome.scripting.getRegisteredContentScripts()).some(script => script.id === 'meowl-site-chesscom')), 'disabled helper unregistered');

  stage = 'disabling an active engine cancels without saving a partial review';
  await page.evaluate(value => { window.__fixturePgn = value; }, pgn.replace('Bot browser fixture', 'Bot cancellation fixture'));
  await worker.evaluate(async () => { await chrome.storage.local.set({ siteReviewSettings: { chesscom: { enabled: true, username: 'alice' } }, reviewSettings: { engine: 'stockfish', time: '3000', lines: '1', smart: false } }); });
  const canceledFrame = await waitFrame();
  await poll(() => canceledFrame.evaluate(() => window.__botUi.searches > 0), 'actual local search before cancellation');
  await worker.evaluate(async () => { await chrome.storage.local.set({ siteReviewSettings: { chesscom: { enabled: false, username: 'alice' } } }); });
  await page.locator(HOST).waitFor({ state: 'detached' });
  await page.waitForTimeout(1200);
  assert.equal((await records()).length, 4, 'Canceled engine does not save a partial review.');
  assert.deepEqual(await worker.evaluate(() => globalThis.__botFetches), []);
  assert.deepEqual(unexpectedRequests, []); assert.deepEqual(errors, []);
  console.log('All bot UI checks passed. Live Chess.com layout and native permissions remain separate from these controlled fixtures.');
} catch (error) {
  console.error(`Bot UI failed during: ${stage}`); console.error(error);
  console.error('Page errors:', errors); console.error('Unexpected network:', unexpectedRequests);
  if (page) { console.error('Page state:', await page.evaluate(() => ({ url: location.href, hidden: document.hidden, result: document.querySelector('#result')?.textContent, host: document.querySelector('#meowlchess-site-review')?.dataset.state, downloads: window.__downloads, closes: window.__shareCloses })).catch(() => null)); await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'site-bot-failure.png') }).catch(() => {}); }
  throw error;
} finally {
  clearInterval(checkpoint);
  await closeTestContext(context, profile, 'meowlchess-bot-test-');
  if (dirname(bundle) === temporaryRoot && basename(bundle).startsWith('meowlchess-bot-bundle-')) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
