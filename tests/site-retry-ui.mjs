import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-retry-test-'));
const bundle = await mkdtemp(join(temporaryRoot, 'meowlchess-retry-bundle-')), extension = join(bundle, 'extension');
const HOST = '#meowlchess-site-review';
const pgn = '[Event "Retry fixture"]\n[White "sitecat"]\n[Black "siteowl"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
let context, worker, page, cdp, stage = 'launch';
const errors = [];
const poll = async (read, label, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Timed out: ${label}`);
};
async function shadow(selector, expression) {
  const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const find = node => {
    if (node.attributes?.some((value, i) => i % 2 === 0 && value === 'id' && node.attributes[i + 1] === HOST.slice(1))) return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const result = find(child); if (result) return result; }
  };
  const host = find(tree.root); assert(host?.shadowRoots?.length, 'Panel exists.');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: host.shadowRoots[0].nodeId, selector });
  assert(nodeId, `${selector} exists.`);
  const { object } = await cdp.send('DOM.resolveNode', { nodeId });
  try { return (await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function(){return ${expression}}`, returnByValue: true })).result.value; }
  finally { await cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
}
const retryReady = () => poll(async () => { try { return await shadow('.retry-loading', '!this.disabled'); } catch { return false; } }, 'retry enabled');
async function clickRetry() {
  const point = await shadow('.retry-loading', '({x:this.getBoundingClientRect().x+this.getBoundingClientRect().width/2,y:this.getBoundingClientRect().y+this.getBoundingClientRect().height/2})');
  await page.mouse.click(point.x, point.y);
}
async function summary() {
  let frame;
  await poll(() => { frame = page.frames().find(item => /site-summary\.html#/.test(item.url())); return frame; }, 'summary iframe');
  await poll(async () => {
    const value = await frame.evaluate(() => ({ ready: !document.querySelector('#summary-result').hidden, error: document.querySelector('#summary-status').classList.contains('error'), text: document.querySelector('#summary-status').textContent }));
    if (value.error) throw new Error(value.text);
    return value.ready;
  }, 'completed summary', 60000);
  return frame;
}

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, 'scripting'])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...manifest.optional_host_permissions])];
  delete manifest.optional_host_permissions;
  manifest.optional_permissions = (manifest.optional_permissions || []).filter(value => value !== 'scripting');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true,
    viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce', ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.addInitScript(() => {
    window.retryEngineStarts = 0;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker { constructor(...args) { super(...args); window.retryEngineStarts++; } };
  });
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest() && ['www.chess.com', 'lichess.org'].includes(url.hostname)) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#302e2b;color:white;font:16px Arial}</style><div class="game-over-component">Game over</div><div class="round__app"><div class="result">0–1</div></div>' });
    return route.abort();
  });
  worker = context.serviceWorkers().find(item => /chrome-extension:/.test(item.url())) || await context.waitForEvent('serviceworker');
  await worker.evaluate(async ({ pgn, stamp }) => {
    globalThis.retryFixture = { mode: 'missing', id: '884422101', calls: 0, hold: null, release: null };
    globalThis.fetch = async input => {
      const url = new URL(typeof input === 'string' ? input : input.url), fixture = globalThis.retryFixture;
      fixture.calls++;
      if (fixture.hold) await fixture.hold;
      if (fixture.mode === 'error') return { ok: false, status: 503 };
      if (url.hostname === 'api.chess.com') {
        if (url.pathname.endsWith('/archives')) return { ok: true, status: 200, json: async () => ({ archives: ['https://api.chess.com/pub/player/sitecat/games/2026/10'] }) };
        return { ok: true, status: 200, json: async () => ({ games: fixture.mode === 'ready' ? [{ url: `https://www.chess.com/game/live/${fixture.id}`, pgn: fixture.pgn || pgn, rules: 'chess', end_time: stamp, white: { username: 'sitecat', result: 'checkmated' }, black: { username: 'siteowl', result: 'win' } }] : [] }) };
      }
      if (url.hostname === 'lichess.org' && url.pathname.startsWith('/game/export/')) {
        const value = { id: fixture.id, variant: 'standard', status: 'mate', lastMoveAt: stamp * 1000, speed: 'rapid', players: { white: { user: { name: 'sitecat' } }, black: { user: { name: 'siteowl' } } }, winner: 'black', pgn: fixture.pgn || pgn };
        return { ok: true, status: 200, text: async () => JSON.stringify(value) };
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    await chrome.storage.local.set({ completionAlerts: false, siteReviewSettings: { chesscom: { enabled: true, username: 'sitecat' }, lichess: { enabled: true, username: 'sitecat' } }, reviewSettings: { engine: 'lozza', time: '50', lines: '1', smart: false } });
  }, { pgn, stamp: Math.floor(Date.now() / 1000) - 60 });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); cdp = await context.newCDPSession(page);
  stage = 'waiting and coalescing';
  await page.goto('https://www.chess.com/game/884422101'); await page.bringToFront();
  await page.locator(`${HOST}[data-state="waiting"]`).waitFor(); await retryReady();
  const position = await page.locator(HOST).boundingBox();
  await worker.evaluate(() => { retryFixture.hold = new Promise(resolve => { retryFixture.release = resolve; }); });
  const beforeRetry = await worker.evaluate(() => retryFixture.calls);
  await clickRetry();
  await poll(() => shadow('.retry-loading', 'this.disabled && this.textContent === "Checking…"'), 'disabled while retry is in flight');
  await poll(() => worker.evaluate(before => retryFixture.calls > before, beforeRetry), 'first held retry request started');
  const calls = await worker.evaluate(() => retryFixture.calls);
  await shadow('.retry-loading', '(this.click(), this.click(), true)');
  assert.equal(await worker.evaluate(() => retryFixture.calls), calls, 'Repeated clicks do not duplicate an in-flight retry.');
  await worker.evaluate(() => { retryFixture.release(); retryFixture.hold = null; });
  await poll(() => shadow('.retry-loading', '/Retry in/.test(this.textContent) && this.disabled'), 'retry cooldown');
  const after = await page.locator(HOST).boundingBox(); assert.equal(after.x, position.x); assert.equal(after.y, position.y);
  stage = 'navigation resets retry and exact retry loads the game';
  await worker.evaluate(() => { retryFixture.id = '884422102'; });
  await page.evaluate(() => history.pushState({}, '', '/game/884422102'));
  await retryReady();
  await worker.evaluate(() => { retryFixture.mode = 'ready'; });
  await clickRetry();
  const chess = await summary();
  assert.equal(await chess.locator('#summary-players').innerText(), 'sitecat vs siteowl');
  stage = 'Lichess error recovers from retry';
  await worker.evaluate(() => { retryFixture.mode = 'error'; retryFixture.id = 'Abcdef12'; });
  await page.goto('https://lichess.org/Abcdef12'); await page.bringToFront();
  await page.locator(`${HOST}[data-state="error"]`).waitFor(); await retryReady();
  await worker.evaluate(() => { retryFixture.mode = 'ready'; });
  await clickRetry();
  const lichess = await summary();
  assert.equal(await lichess.locator('#summary-source').innerText(), 'Lichess');
  assert.equal(await lichess.locator('#summary-players').innerText(), 'sitecat vs siteowl');
  stage = 'expired iframe retries the retained completed game';
  const callsBeforeRestart = await worker.evaluate(() => retryFixture.calls);
  await worker.evaluate(() => { const originalNow = Date.now; Date.now = () => originalNow() + 11 * 60 * 1000; });
  await lichess.evaluate(() => location.reload());
  await lichess.locator('#summary-retry').waitFor({ state: 'visible' });
  assert.match(await lichess.locator('#summary-status').innerText(), /expired/);
  await lichess.locator('#summary-retry').click();
  await poll(() => lichess.isDetached(), 'failed summary frame replaced');
  const recovered = await summary();
  assert.equal(await recovered.locator('#summary-players').innerText(), 'sitecat vs siteowl');
  assert.match(await recovered.locator('#summary-status').innerText(), /Saved review loaded/);
  assert.equal(await worker.evaluate(() => retryFixture.calls), callsBeforeRestart, 'Restart reuses its selected completed game, not another archive entry.');
  stage = 'stopped analysis retries exactly one engine for the same game';
  await worker.evaluate(async pgn => {
    retryFixture.id = '884422103'; retryFixture.pgn = pgn.replace('Retry fixture', 'Retry stopped fixture');
    await chrome.storage.local.set({ reviewSettings: { engine: 'lozza', time: '500', lines: '1', smart: false } });
  }, pgn);
  await page.goto('https://www.chess.com/game/884422103'); await page.bringToFront();
  let stopped;
  await poll(() => { stopped = page.frames().find(item => /site-summary\.html#/.test(item.url())); return stopped; }, 'analysis frame');
  await stopped.locator('#summary-cancel').waitFor({ state: 'visible' });
  await stopped.waitForFunction(() => window.retryEngineStarts === 1);
  await stopped.locator('#summary-cancel').click();
  assert.equal(await stopped.locator('#summary-title').innerText(), 'Review stopped');
  assert.equal(await stopped.locator('#summary-result').isVisible(), false);
  await stopped.locator('#summary-retry').click();
  await poll(() => stopped.isDetached(), 'stopped frame replaced');
  const restarted = await summary();
  assert.equal(await restarted.evaluate(() => window.retryEngineStarts), 1, 'Restart creates one engine.');
  assert.equal(page.frames().filter(item => /site-summary\.html#/.test(item.url())).length, 1, 'Only one summary remains.');
  assert.equal(await restarted.locator('#summary-players').innerText(), 'sitecat vs siteowl');
  assert.match(await restarted.locator('#summary-status').innerText(), /Review complete/);
  assert.deepEqual(errors, []);
  console.log('Retry UI passed: waiting recovery, in-flight disabling, cooldown, route reset, no drag, Lichess error recovery, expired iframe restart, and canceled analysis restart.');
} catch (error) { console.error('Retry UI failed at:', stage); throw error; }
finally {
  if (context) await closeTestContext(context, profile);
  const absolute = resolve(bundle); if (absolute.startsWith(temporaryRoot + '\\') || absolute.startsWith(temporaryRoot + '/')) await rm(absolute, { recursive: true, force: true });
}
