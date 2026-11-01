import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

// Full extension and a real bundled engine. Only site pages/API responses are
// controlled fixtures; native permission prompts are granted in a temporary copy.
const root = resolve(import.meta.dirname, '..');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-panel-extension-test-'));
const bundle = await mkdtemp(join(temporaryRoot, 'meowlchess-panel-extension-bundle-'));
const extension = join(bundle, 'extension');
const HOST = '#meowlchess-site-review';
const chessUrl = 'https://www.chess.com/game/884422110';
const lichessUrl = 'https://lichess.org/A1b2C3d4';
const pgn = '[Event "Panel drag fixture"]\n[White "sitecat"]\n[Black "siteowl"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const stamp = Math.floor(Date.now() / 1000) - 60;
let context, worker, page, cdp, stage = 'launch';
const errors = [], unexpectedRequests = [], diagnostics = [];
const checkpoint = setInterval(() => console.log(`Panel extension checkpoint: ${stage}`), 15000); checkpoint.unref();

const near = (actual, expected, message) => assert(Math.abs(actual - expected) <= 2, `${message}: expected ${expected}, got ${actual}`);
async function poll(read, label, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(`Timed out: ${label}`);
}
async function shadowNode(selector) {
  const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  function find(node) {
    if (node.attributes?.some((value, index) => index % 2 === 0 && value === 'id' && node.attributes[index + 1] === 'meowlchess-site-review')) return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const result = find(child); if (result) return result; }
    return null;
  }
  const host = find(tree.root); assert(host?.shadowRoots?.length, 'Closed shadow panel exists.');
  const result = await cdp.send('DOM.querySelector', { nodeId: host.shadowRoots[0].nodeId, selector });
  assert(result.nodeId, `Missing shadow node: ${selector}`); return result.nodeId;
}
async function shadowValue(selector, expression) {
  const { object } = await cdp.send('DOM.resolveNode', { nodeId: await shadowNode(selector) });
  try { return (await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function(){return ${expression}}`, returnByValue: true })).result.value; }
  finally { await cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
}
async function shadowPoint(selector) {
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: await shadowNode(selector) });
  return { x: (model.content[0] + model.content[2]) / 2, y: (model.content[1] + model.content[5]) / 2 };
}
async function waitFrame() {
  let frame;
  await poll(() => { frame = page.frames().find(item => /\/site-summary\.html#/.test(item.url())); return frame; }, 'summary frame');
  await poll(async () => {
    const state = await frame.evaluate(() => ({ ready: !document.querySelector('#summary-result').hidden && !document.querySelector('#summary-open-review').disabled, error: document.querySelector('#summary-status').classList.contains('error'), text: document.querySelector('#summary-status').textContent }));
    if (state.error) throw new Error(state.text);
    return state.ready;
  }, 'real engine summary', 60000);
  return frame;
}
const hostBox = () => page.locator(HOST).boundingBox();
const stored = source => worker.evaluate(async source => (await chrome.storage.local.get(`siteReviewPanelPosition:${source}`))[`siteReviewPanelPosition:${source}`], source);
const storedSize = source => worker.evaluate(async source => (await chrome.storage.local.get(`siteReviewPanelSize:${source}`))[`siteReviewPanelSize:${source}`], source);
async function shadowClick(selector) { const point = await shadowPoint(selector); await page.mouse.click(point.x, point.y); }
async function dragPoint(point, dx, dy, label) {
  const before = await hostBox();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  for (let step = 1; step <= 4; step++) {
    await page.mouse.move(point.x + dx * step / 4, point.y + dy * step / 4);
    await poll(async () => {
      const box = await hostBox(); return Math.abs(box.x - (before.x + dx * step / 4)) <= 2 && Math.abs(box.y - (before.y + dy * step / 4)) <= 2;
    }, `${label} step ${step}`, 2500);
  }
  await page.mouse.up();
  await poll(async () => { const position = await stored('chesscom'); return position && Math.abs(position.left - (before.x + dx)) <= 2 && Math.abs(position.top - (before.y + dy)) <= 2; }, `${label} persisted`);
  return hostBox();
}
async function dragLocator(locator, dx, dy, label) {
  const rect = await locator.boundingBox(); assert(rect, `${label} visible`);
  return dragPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, dx, dy, label);
}
async function resizePanel(dx, dy, source, label) {
  const before = await hostBox(), point = await shadowPoint('.resize-handle');
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 8 }); await page.mouse.up();
  await poll(async () => {
    const box = await hostBox(); return Math.abs(box.width - (before.width + dx)) <= 2 && Math.abs(box.height - (before.height + dy)) <= 2;
  }, label);
  near((await hostBox()).x, before.x, `${label} preserves left`); near((await hostBox()).y, before.y, `${label} preserves top`);
  await poll(async () => { const size = await storedSize(source), box = await hostBox(); return size && Math.abs(size.width - box.width) <= 2 && Math.abs(size.height - box.height) <= 2; }, `${label} stored`);
  return hostBox();
}
async function resizeEdge(direction, dx, dy, source, label) {
  const before = await hostBox(), point = await shadowPoint(`.resize-handle[data-resize-direction="${direction}"]`);
  const view = page.viewportSize();
  const expected = { left: before.x, top: before.y, right: before.x + before.width, bottom: before.y + before.height };
  if (direction.includes('w')) expected.left = Math.max(8, Math.min(expected.right - Math.min(280, view.width - 16), expected.left + dx));
  if (direction.includes('e')) expected.right = Math.min(view.width - 8, Math.max(expected.left + Math.min(280, view.width - 16), expected.right + dx));
  if (direction.includes('n')) expected.top = Math.max(8, Math.min(expected.bottom - Math.min(220, view.height - 16), expected.top + dy));
  if (direction.includes('s')) expected.bottom = Math.min(view.height - 8, Math.max(expected.top + Math.min(220, view.height - 16), expected.bottom + dy));
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 8 }); await page.mouse.up();
  await poll(async () => {
    const box = await hostBox(); return Math.abs(box.x - expected.left) <= 2 && Math.abs(box.y - expected.top) <= 2
      && Math.abs(box.width - (expected.right - expected.left)) <= 2 && Math.abs(box.height - (expected.bottom - expected.top)) <= 2;
  }, label, 4000);
  const box = await hostBox();
  if (!direction.includes('w')) near(box.x, before.x, `${label} anchors left`);
  if (!direction.includes('e')) near(box.x + box.width, before.x + before.width, `${label} anchors right`);
  if (!direction.includes('n')) near(box.y, before.y, `${label} anchors top`);
  if (!direction.includes('s')) near(box.y + box.height, before.y + before.height, `${label} anchors bottom`);
  await poll(async () => {
    const size = await storedSize(source), position = await stored(source);
    return size && position && Math.abs(size.width - box.width) <= 2 && Math.abs(size.height - box.height) <= 2
      && Math.abs(position.left - box.x) <= 2 && Math.abs(position.top - box.y) <= 2;
  }, `${label} saves both position and size`);
  assert.equal(await page.locator('#meowlchess-resize-shield').count(), 0, `${label} removes input shield`);
  return box;
}
const gripFocus = direction => shadowValue(`.resize-handle[data-resize-direction="${direction}"]`, '({focused:this.getRootNode().activeElement===this,visible:this.matches(":focus-visible"),style:getComputedStyle(this).outlineStyle,width:getComputedStyle(this).outlineWidth})');
async function noPointerResizeOutline(direction) {
  await page.mouse.move(20, 20);
  const state = await gripFocus(direction);
  assert.equal(state.focused, true, `${direction} resize keeps its control focused.`);
  assert(state.style === 'none' || state.width === '0px', `${direction} mouse resize leaves no outline after the pointer moves away: ${JSON.stringify(state)}`);
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
    headless: process.env.HEADED_EXT_TEST !== '1', viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.env.HEADED_EXT_TEST === '1' ? ['--start-minimized'] : [])],
  });
  context.setDefaultTimeout(20000);
  await context.addInitScript(() => {
    window.__panelEngineSearches = 0;
    const nativePost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (typeof message === 'string' && /^go\b/.test(message)) window.__panelEngineSearches++;
      return nativePost.call(this, message, ...args);
    };
    window.__panelEvents = [];
    const log = value => { window.__panelEvents.push(value); if (window.__panelEvents.length > 24) window.__panelEvents.shift(); };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, event => log({ type, target: event.target.tagName, id: event.target.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, screenX: event.screenX, screenY: event.screenY, trusted: event.isTrusted, primary: event.isPrimary }), true);
    window.addEventListener('message', event => { if (event.data?.type === 'meowl:site-frame-drag') log({ message: event.data, origin: event.origin, trusted: event.isTrusted }); });
    window.addEventListener('blur', () => log({ type: 'blur' }));
  });
  await context.route(/^https?:\/\//, route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && ['www.chess.com', 'lichess.org'].includes(url.hostname)) {
      return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src 'none'; child-src 'none'; img-src 'none'", ...(url.hostname === 'lichess.org' ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}) }, body: '<!doctype html><html><head><meta charset="utf-8"><title>Panel movement fixture</title><style>body{margin:0;background:#302e2b;color:#eee;font:18px Arial;min-height:1500px}main{padding:30px}button,iframe,img{display:none!important}</style></head><body><main class="round__app"><h1>Completed game fixture</h1><div class="game-over-component result">Game over · 0–1</div></main></body></html>' });
    }
    if (url.pathname !== '/favicon.ico') unexpectedRequests.push(request.url()); return route.abort();
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(async ({ pgn, stamp }) => {
    const archiveReady = new Promise(resolve => { globalThis.releasePanelFixtureArchive = resolve; });
    globalThis.fetch = async input => {
      const raw = typeof input === 'string' ? input : input.url;
      if (raw.endsWith('/archives')) { await archiveReady; return { ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/sitecat/games/2026/10'] }) }; }
      if (raw.includes('api.chess.com')) return { ok: true, json: async () => ({ games: [{ url: 'https://www.chess.com/game/live/884422110', pgn, rules: 'chess', time_class: 'rapid', end_time: stamp, white: { username: 'sitecat', result: 'checkmated' }, black: { username: 'siteowl', result: 'win' } }] }) };
      if (raw.startsWith('https://lichess.org/api/games/user/') || raw.startsWith('https://lichess.org/game/export/A1b2C3d4?')) return { ok: true, text: async () => JSON.stringify({ id: 'A1b2C3d4', variant: 'standard', status: 'mate', lastMoveAt: stamp * 1000, speed: 'rapid', players: { white: { user: { name: 'sitecat' } }, black: { user: { name: 'siteowl' } } }, winner: 'black', pgn }) };
      throw new Error(`Unexpected transport: ${raw}`);
    };
    await chrome.storage.local.set({ siteReviewSettings: { chesscom: { enabled: true, username: 'sitecat' }, lichess: { enabled: true, username: 'sitecat' } }, reviewSettings: { engine: 'lozza', time: '50', lines: '1', smart: false }, tutorialNever: true });
  }, { pgn, stamp });
  await poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith('meowl-site-')).length === 2), 'enabled site scripts');
  page = await context.newPage(); cdp = await context.newCDPSession(page);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await page.goto(chessUrl); await page.bringToFront();
  stage = 'waiting panel horizontal resize preserves height before game data arrives';
  await page.locator(`${HOST}[data-state="waiting"]`).waitFor();
  assert.equal(await shadowValue('.loading-stage', 'this.textContent.trim()'), 'Finding game');
  const waitingBox = await hostBox();
  assert(waitingBox.height >= 220, 'Waiting panel already accommodates the minimum expanded height.');
  const waitingResized = await resizeEdge('w', -40, 0, 'chesscom', 'waiting-state width-only resize');
  near(waitingResized.height, waitingBox.height, 'horizontal waiting resize preserves height');
  near(waitingResized.y, waitingBox.y, 'horizontal waiting resize preserves top');
  await worker.evaluate(() => globalThis.releasePanelFixtureArchive());
  let frame = await waitFrame();
  near((await hostBox()).width, waitingResized.width, 'summary arrival preserves selected width');
  near((await hostBox()).height, waitingResized.height, 'summary arrival preserves selected height');
  await cdp.send('DOM.focus', { nodeId: await shadowNode('.resize-handle') }); await page.keyboard.press('Home');
  await poll(async () => (await hostBox()).height > 500 && !await storedSize('chesscom'), 'reset automatic size after waiting check');
  await cdp.send('DOM.focus', { nodeId: await shadowNode('.brand') }); await page.keyboard.press('Home');
  console.log('Panel extension: waiting width-only resize keeps its height and the finished summary retains the selected size.');

  stage = 'icon decoding under restrictive host CSP';
  await poll(() => shadowValue('.brand-icon', 'this.complete && this.naturalWidth === 48'), 'header icon decoded');
  assert.equal(await shadowValue('.brand-icon', 'this.draggable'), false);
  near(await shadowValue('.brand-icon', 'this.getBoundingClientRect().width'), 28, 'icon size');

  stage = 'summary tabs switch views without moving the panel or restarting analysis';
  const tabPosition = await hostBox(), initialSearches = await frame.evaluate(() => window.__panelEngineSearches);
  const overviewTab = frame.locator('#summary-overview-tab'), ratingsTab = frame.locator('#summary-ratings-tab');
  const assertTab = async expected => {
    for (const name of ['overview', 'ratings']) {
      assert.equal(await frame.locator(`#summary-${name}-tab`).getAttribute('aria-selected'), String(name === expected));
      assert.equal(await frame.locator(`#summary-${name}`).isVisible(), name === expected);
      assert.equal(await frame.locator(`#summary-${name}-tab`).evaluate(element => element.tabIndex), name === expected ? 0 : -1);
    }
    near((await hostBox()).x, tabPosition.x, 'tabs preserve horizontal position');
    near((await hostBox()).y, tabPosition.y, 'tabs preserve vertical position');
    assert.equal(await page.locator('#meowlchess-drag-shield').count(), 0, 'Tab clicks never start panel dragging.');
    assert.equal(await frame.evaluate(() => window.__panelEngineSearches), initialSearches, 'Tabs reuse the completed review.');
  };
  await assertTab('overview');
  await ratingsTab.click(); await assertTab('ratings');
  await page.keyboard.press('ArrowLeft'); await assertTab('overview');
  await page.keyboard.press('ArrowRight'); await assertTab('ratings');
  await page.keyboard.press('Home'); await assertTab('overview');
  await page.keyboard.press('End'); await assertTab('ratings');
  await overviewTab.click(); await assertTab('overview');
  console.log('Panel extension: accessible summary tabs reuse analysis and do not drag the panel.');

  stage = 'summary image sharing in the real extension frame';
  const sharePosition = await hostBox(), shareSearches = await frame.evaluate(() => window.__panelEngineSearches);
  const expectedScoreText = await frame.locator('.score-value').allTextContents();
  await frame.evaluate(() => {
    window.__shareText = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(value, ...args) { window.__shareText.push(String(value)); return fill.call(this, value, ...args); };
  });
  await frame.locator('#summary-share').click();
  const shareDialog = frame.locator('#meowl-summary-share');
  await poll(() => frame.locator('[data-share-save]').isEnabled(), 'real panel share preview ready');
  assert.equal(await shareDialog.getAttribute('data-no-drag'), '');
  const shareText = await frame.evaluate(() => window.__shareText);
  assert(shareText.includes('sitecat') && shareText.includes('siteowl'), 'Export contains this game’s players.');
  for (const value of expectedScoreText) assert(shareText.includes(value), 'Export contains the displayed study scores.');
  assert(shareText.some(value => value.startsWith('0–1 · Black won')), 'Export contains the actual result.');
  assert.equal(await shareDialog.locator('img').evaluate(image => image.naturalWidth), 1200);
  const previewPoint = await shareDialog.locator('img').boundingBox();
  await page.mouse.move(previewPoint.x + 35, previewPoint.y + 35); await page.mouse.down();
  await page.mouse.move(previewPoint.x + 75, previewPoint.y + 50, { steps: 5 }); await page.mouse.up();
  near((await hostBox()).x, sharePosition.x, 'share preview does not drag panel x'); near((await hostBox()).y, sharePosition.y, 'share preview does not drag panel y');
  assert.equal(await page.locator('#meowlchess-drag-shield').count(), 0);
  await frame.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async () => { throw new Error('Clipboard blocked in frame fixture'); } } }));
  await shareDialog.locator('[data-share-copy]').click();
  await poll(() => shareDialog.locator('.summary-share-status').textContent().then(text => text.includes('Use Save image instead')), 'embedded clipboard fallback');
  const shareDownload = page.waitForEvent('download'); await shareDialog.locator('[data-share-save]').click();
  const downloaded = await shareDownload;
  assert.equal(downloaded.suggestedFilename(), 'MeowlChess-sitecat-vs-siteowl.png');
  const sharePng = await readFile(await downloaded.path());
  assert.equal(sharePng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(sharePng.readUInt32BE(16), 1200); assert.equal(sharePng.readUInt32BE(20), 1200);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(join(root, 'test-results', 'panel-share-summary.png'), sharePng);
  await page.screenshot({ path: join(root, 'test-results', 'panel-share-dialog.png') });
  await page.keyboard.press('Escape'); await shareDialog.waitFor({ state: 'hidden' });
  assert.equal(await frame.locator('#summary-share').evaluate(element => element === document.activeElement), true, 'Closing share returns focus to its opener.');
  assert.equal(await frame.evaluate(() => window.__panelEngineSearches), shareSearches, 'Sharing reuses analysis without engine searches.');
  near((await hostBox()).x, sharePosition.x, 'share controls preserve panel x'); near((await hostBox()).y, sharePosition.y, 'share controls preserve panel y');
  console.log('Panel extension: summary image matches the real game; preview, clipboard fallback, download, focus, and engine reuse passed.');

  stage = 'keyboard focus remains above sticky actions in a short panel';
  const automaticBox = await hostBox();
  await resizePanel(0, 320 - automaticBox.height, 'chesscom', 'short keyboard focus check');
  await overviewTab.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const focusClearance = await frame.evaluate(() => ({
    focused: document.activeElement === document.querySelector('.estimate-note summary'),
    bottom: document.activeElement.getBoundingClientRect().bottom,
    footerTop: document.querySelector('footer').getBoundingClientRect().top,
  }));
  assert(focusClearance.focused && focusClearance.bottom <= focusClearance.footerTop + 1, 'About estimates stays visible above sticky actions when reached by keyboard.');
  await cdp.send('DOM.focus', { nodeId: await shadowNode('.resize-handle') }); await page.keyboard.press('Home');
  await poll(async () => Math.abs((await hostBox()).height - automaticBox.height) <= 2 && !await storedSize('chesscom'), 'restore automatic panel after focus check');
  await frame.evaluate(() => window.scrollTo(0, 0));

  stage = 'summary text, card, and icon drag without coordinate drift';
  await dragLocator(frame.locator('#summary-title'), -600, 60, 'summary title drag');
  await dragLocator(frame.locator('.score-card').first(), 90, 45, 'score card drag');
  await frame.locator('#summary-ratings-tab').click();
  await dragLocator(frame.locator('.count-row img').first(), -150, 40, 'move icon drag');
  await frame.locator('#summary-overview-tab').click();
  await dragPoint(await shadowPoint('.brand-icon'), -100, -75, 'header icon drag');
  console.log('Panel extension: decoded header icon; actual iframe text/card/icon and native icon dragging passed.');

  stage = 'capture outside iframe and cancellation';
  let before = await hostBox(), point = await frame.locator('#summary-title').boundingBox();
  const start = { x: point.x + 30, y: point.y + 10 };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(0, start.y);
  await poll(async () => Math.abs((await hostBox()).x - 8) <= 2, 'left viewport clamp outside iframe');
  await page.mouse.move(start.x + 30, start.y + 20); await page.mouse.up();
  await poll(async () => Math.abs((await hostBox()).x - before.x - 30) <= 2, 'captured pointer returns from outside iframe');
  near((await hostBox()).y, before.y + 20, 'capture vertical delta');
  before = await hostBox(); point = await frame.locator('.score-card').first().boundingBox();
  await page.mouse.move(point.x + 20, point.y + 20); await page.mouse.down(); await page.mouse.move(point.x + 90, point.y + 60);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await poll(async () => Math.abs((await hostBox()).x - before.x) <= 2 && Math.abs((await hostBox()).y - before.y) <= 2, 'Escape restores pre-drag placement');

  stage = 'forged drag messages cannot move panel';
  const stable = await hostBox(); const token = new URL(frame.url()).hash.slice(1), extensionOrigin = frame.url().split('/').slice(0, 3).join('/');
  await page.evaluate(({ token, extensionOrigin }) => {
    const message = { type: 'meowl:site-frame-drag', phase: 'start', pointerId: 1, screenX: 50, screenY: 50, token };
    window.postMessage(message, location.origin);
    window.dispatchEvent(new MessageEvent('message', { data: message, origin: extensionOrigin }));
    window.postMessage({ ...message, phase: 'move', screenX: 600, screenY: 600 }, location.origin);
  }, { token, extensionOrigin });
  await page.waitForTimeout(200); near((await hostBox()).x, stable.x, 'forged drag x'); near((await hostBox()).y, stable.y, 'forged drag y');

  stage = 'resize grip, reflow, drag after resize, and collapse/expand';
  assert.equal(await shadowValue('.resize-handle', 'this.getAttribute("aria-label")'), 'Resize review panel');
  const oldFrameWidth = await frame.evaluate(() => innerWidth);
  const resized = await resizePanel(160, -180, 'chesscom', 'bottom-right resize');
  assert.equal(await page.locator(HOST).getAttribute('data-resized'), 'true');
  await poll(() => frame.evaluate(previous => innerWidth > previous + 140, oldFrameWidth), 'summary reflows into resized width');
  assert(await frame.evaluate(() => document.scrollingElement.scrollWidth <= document.documentElement.clientWidth), 'Resized summary has no horizontal overflow.');
  let preferredSize = await storedSize('chesscom');
  await dragLocator(frame.locator('#summary-title'), 40, 30, 'drag after resize');
  near((await hostBox()).width, resized.width, 'drag preserves resized width'); near((await hostBox()).height, resized.height, 'drag preserves resized height');
  await shadowClick('button[aria-label="Collapse review"]');
  await poll(async () => (await hostBox()).height < 80, 'collapsed panel is header only');
  assert.equal(await shadowValue('.resize-handle', 'this.getBoundingClientRect().height'), 0, 'Resize grip is hidden while collapsed.');
  assert.equal(await shadowValue('.resize-handle', '[...this.parentNode.querySelectorAll(".resize-handle")].filter(grip => grip.getBoundingClientRect().height > 0).length'), 0, 'Every resize edge is hidden while collapsed.');
  assert.deepEqual(await storedSize('chesscom'), preferredSize, 'Collapse retains preferred expanded size.');
  await shadowClick('button[aria-label="Expand review"]');
  await poll(async () => Math.abs((await hostBox()).height - resized.height) <= 2, 'expand restores resized height');
  near((await hostBox()).width, resized.width, 'expand restores resized width');
  console.log('Panel extension: resizing, reflow, movement after resizing, and collapse/expand passed.');

  stage = 'all four resize edges and four corners preserve opposite anchors';
  const handleState = await shadowValue('.resize-handle', '[...this.parentNode.querySelectorAll(".resize-handle")].map(grip => ({direction:grip.dataset.resizeDirection,tabIndex:grip.tabIndex,width:grip.getBoundingClientRect().width,height:grip.getBoundingClientRect().height}))');
  assert.deepEqual(handleState.map(grip => grip.direction).sort(), ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  assert(handleState.every(grip => grip.width > 0 && grip.height > 0), 'All eight resize targets have visible hit areas.');
  assert.deepEqual(handleState.filter(grip => grip.tabIndex === 0).map(grip => grip.direction), ['se'], 'Resizing adds one keyboard tab stop.');
  for (const [direction, dx, dy] of [['e', 40, 0], ['s', 0, 30], ['w', -50, 0], ['n', 0, -40], ['ne', 25, -25], ['nw', -30, -20], ['sw', -25, 20], ['se', 20, 20]]) {
    // Begin in keyboard modality: a prevented pointerdown must not inherit its ring.
    await cdp.send('DOM.focus', { nodeId: await shadowNode('.brand') });
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await resizeEdge(direction, dx, dy, 'chesscom', `${direction} expands`);
    await noPointerResizeOutline(direction);
    if (direction === 'e') {
      await mkdir(join(root, 'test-results'), { recursive: true });
      await page.screenshot({ path: join(root, 'test-results', 'panel-grip-focus-after.png') });
    }
    await resizeEdge(direction, -dx, -dy, 'chesscom', `${direction} shrinks across content`);
    await noPointerResizeOutline(direction);
  }
  stage = 'top and left resize cancellation restores geometry and stored preference';
  for (const direction of ['n', 'w']) {
    const prior = await hostBox(), priorPosition = await stored('chesscom'), priorSize = await storedSize('chesscom');
    const edge = await shadowPoint(`.resize-handle[data-resize-direction="${direction}"]`);
    await page.mouse.move(edge.x, edge.y); await page.mouse.down();
    await page.mouse.move(edge.x + (direction === 'w' ? 60 : 0), edge.y + (direction === 'n' ? 60 : 0), { steps: 5 });
    await poll(async () => direction === 'w' ? Math.abs((await hostBox()).x - prior.x - 60) <= 2 : Math.abs((await hostBox()).y - prior.y - 60) <= 2, `${direction} starts inward resize`);
    await page.keyboard.press('Escape'); await page.mouse.up();
    const canceled = await hostBox();
    for (const key of ['x', 'y', 'width', 'height']) near(canceled[key], prior[key], `${direction} Escape restores ${key}`);
    assert.deepEqual(await stored('chesscom'), priorPosition); assert.deepEqual(await storedSize('chesscom'), priorSize);
    assert.equal(await page.locator('#meowlchess-resize-shield').count(), 0, 'Canceled edge resize removes input shield.');
  }
  stage = 'north-west minimum and viewport bounds keep fixed opposite edges';
  const central = await hostBox();
  const minimum = await resizeEdge('nw', 350, 500, 'chesscom', 'north-west clamps to minimum across iframe');
  near(minimum.width, 280, 'north-west minimum width'); near(minimum.height, 220, 'north-west minimum height');
  stage = 'share dialog fits the minimum panel size';
  await frame.locator('#summary-share').click();
  await poll(() => frame.locator('[data-share-save]').isEnabled(), 'minimum panel share ready');
  const minimumDialog = frame.locator('#meowl-summary-share');
  const minimumGeometry = await minimumDialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, overflow: element.scrollWidth > element.clientWidth };
  });
  assert(!minimumGeometry.overflow && minimumGeometry.x >= 0 && minimumGeometry.y >= 0 && minimumGeometry.right <= minimumGeometry.width && minimumGeometry.bottom <= minimumGeometry.height, 'Share modal fits the 280×220 panel without horizontal overflow.');
  await minimumDialog.locator('[data-share-save]').scrollIntoViewIfNeeded();
  const minimumSave = await minimumDialog.locator('[data-share-save]').evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: innerHeight }; });
  assert(minimumSave.top >= 0 && minimumSave.bottom <= minimumSave.height, 'Save image remains reachable in the minimum panel.');
  await page.screenshot({ path: join(root, 'test-results', 'panel-share-minimum.png') });
  await minimumDialog.locator('.summary-share-close').click(); await minimumDialog.waitFor({ state: 'hidden' });
  assert.equal(await frame.locator('#summary-share').evaluate(element => element === document.activeElement), true);
  near((await hostBox()).width, 280, 'sharing preserves minimum width'); near((await hostBox()).height, 220, 'sharing preserves minimum height');
  await resizeEdge('nw', central.x - minimum.x, central.y - minimum.y, 'chesscom', 'north-west restores central size');
  const northWest = await shadowPoint('.resize-handle[data-resize-direction="nw"]');
  const maxNorthWest = await resizeEdge('nw', -northWest.x, -northWest.y, 'chesscom', 'north-west clamps at top and left viewport edges');
  near(maxNorthWest.x, 8, 'north-west left limit'); near(maxNorthWest.y, 8, 'north-west top limit');
  await resizeEdge('nw', central.x - maxNorthWest.x, central.y - maxNorthWest.y, 'chesscom', 'restore after top-left clamp');
  const southEast = await shadowPoint('.resize-handle[data-resize-direction="se"]');
  const maxSouthEast = await resizeEdge('se', 1599 - southEast.x, 1099 - southEast.y, 'chesscom', 'south-east clamps without shifting origin');
  near(maxSouthEast.x + maxSouthEast.width, 1592, 'right viewport limit'); near(maxSouthEast.y + maxSouthEast.height, 1092, 'bottom viewport limit');
  await resizeEdge('se', central.width - maxSouthEast.width, central.height - maxSouthEast.height, 'chesscom', 'restore after bottom-right clamp');
  // Leave a north-west resize in place so reload verifies both its new origin and dimensions.
  await resizeEdge('nw', -40, -30, 'chesscom', 'saved north-west resize');
  preferredSize = await storedSize('chesscom');
  console.log('Panel extension: all eight edges/corners, opposite anchors, iframe crossing, Escape, minimum sizes, and viewport limits passed.');

  stage = 'wheel and scrollbar retain scrolling';
  await frame.locator('#summary-ratings-tab').click();
  await page.setViewportSize({ width: 1100, height: 600 }); await page.waitForTimeout(250);
  const scrolledHost = await hostBox(), iframeBox = await frame.locator('#summary-title').boundingBox();
  await page.mouse.move(iframeBox.x + 50, iframeBox.y + 30); await page.mouse.wheel(0, 700);
  await poll(async () => await frame.evaluate(() => document.scrollingElement.scrollTop > 0), 'native wheel scroll within summary frame');
  assert.equal(await page.locator('#meowlchess-drag-shield').count(), 0, 'Finished drags leave no input shield.');
  near((await hostBox()).x, scrolledHost.x, 'wheel does not move panel x'); near((await hostBox()).y, scrolledHost.y, 'wheel does not move panel y');
  const scrollbar = await shadowValue('.body', '({left:this.getBoundingClientRect().left,top:this.getBoundingClientRect().top,width:this.getBoundingClientRect().width,height:this.getBoundingClientRect().height,clientWidth:this.clientWidth,scrollTop:this.scrollTop})');
  if (scrollbar.width - scrollbar.clientWidth > 2) {
    await page.mouse.move(scrollbar.left + scrollbar.width - 5, scrollbar.top + scrollbar.height - 15);
    await page.mouse.down(); await page.mouse.move(scrollbar.left + scrollbar.width - 5, scrollbar.top + 25, { steps: 8 }); await page.mouse.up();
    near((await hostBox()).x, scrolledHost.x, 'scrollbar does not move panel x'); near((await hostBox()).y, scrolledHost.y, 'scrollbar does not move panel y');
  }
  const frameViewport = await shadowValue('iframe', '({left:this.getBoundingClientRect().left,top:this.getBoundingClientRect().top,width:this.getBoundingClientRect().width,height:this.getBoundingClientRect().height})');
  const frameClient = await frame.evaluate(() => ({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight}));
  if (frameViewport.width - frameClient.width > 2) {
    await page.mouse.move(frameViewport.left + frameViewport.width - 5, frameViewport.top + frameViewport.height - 15);
    await page.mouse.down(); await page.mouse.move(frameViewport.left + frameViewport.width - 5, frameViewport.top + 25, { steps: 8 }); await page.mouse.up();
    near((await hostBox()).x, scrolledHost.x, 'iframe scrollbar does not move panel x'); near((await hostBox()).y, scrolledHost.y, 'iframe scrollbar does not move panel y');
  }
  await page.setViewportSize({ width: 1600, height: 1100 }); await page.waitForTimeout(250);
  await frame.locator('#summary-open-review').scrollIntoViewIfNeeded();

  stage = 'open-review button keeps its action without moving the panel';
  const preferred = await stored('chesscom');
  const opened = context.waitForEvent('page'); await frame.locator('#summary-open-review').click();
  const full = await opened; await full.waitForURL(/review\.html\?reviewId=/);
  await full.waitForFunction(() => document.querySelector('#summary-tab')?.getAttribute('aria-selected') === 'true' && /starting/i.test(document.querySelector('#position-label')?.textContent || ''));
  assert.deepEqual(await stored('chesscom'), preferred); await full.close(); await page.bringToFront(); frame = await waitFrame();
  await page.reload(); frame = await waitFrame();
  near((await hostBox()).x, preferred.left, 'refresh restores dragged left'); near((await hostBox()).y, preferred.top, 'refresh restores dragged top');
  near((await hostBox()).width, preferredSize.width, 'refresh restores resized width'); near((await hostBox()).height, preferredSize.height, 'refresh restores resized height');
  stage = 'resized panel remains within narrow viewport without overwriting preference';
  await page.setViewportSize({ width: 390, height: 420 }); await page.waitForTimeout(250);
  let bounded = await hostBox();
  assert(bounded.x >= 6 && bounded.y >= 6 && bounded.x + bounded.width <= 384 && bounded.y + bounded.height <= 414, 'Resized panel stays inside narrow viewport.');
  assert.deepEqual(await storedSize('chesscom'), preferredSize, 'Viewport clamping does not replace the chosen size.');
  await page.setViewportSize({ width: 1600, height: 1100 }); await page.waitForTimeout(250);
  near((await hostBox()).width, preferredSize.width, 'larger viewport restores preferred width'); near((await hostBox()).height, preferredSize.height, 'larger viewport restores preferred height');
  await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'site-panel-resized.png') });
  await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'site-panel-anywhere.png') });
  await frame.locator('#summary-close').click(); await page.locator(HOST).waitFor({ state: 'detached' });
  assert.deepEqual(await stored('chesscom'), preferred, 'Close button does not drag.');
  console.log('Panel extension: capture, Escape, forged messages, scrolling, controls, persistence, and close passed.');

  stage = 'Lichess isolated page loads icon and supports iframe drag';
  await page.goto(lichessUrl); frame = await waitFrame();
  await poll(() => shadowValue('.brand-icon', 'this.complete && this.naturalWidth === 48'), 'Lichess header icon decoded');
  const lichessBefore = await hostBox(), rect = await frame.locator('#summary-title').boundingBox();
  near(lichessBefore.width, 360, 'Lichess does not inherit Chess.com size');
  assert.equal(Boolean(await storedSize('lichess')), false, 'Lichess initially has no saved size.');
  await page.mouse.move(rect.x + 20, rect.y + 10); await page.mouse.down(); await page.mouse.move(rect.x - 180, rect.y + 50, { steps: 6 }); await page.mouse.up();
  await poll(async () => Math.abs((await hostBox()).x - (lichessBefore.x - 200)) <= 2, 'Lichess iframe drag');
  near((await hostBox()).y, lichessBefore.y + 40, 'Lichess iframe drag y');
  stage = 'site-specific resize preference, minimum size, and keyboard reset';
  await resizePanel(70, -120, 'lichess', 'Lichess resize');
  assert.deepEqual(await storedSize('chesscom'), preferredSize, 'Resizing Lichess preserves Chess.com size.');
  const large = await hostBox(), grip = await shadowPoint('.resize-handle');
  await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(large.x + 100, large.y + 70, { steps: 8 }); await page.mouse.up();
  await poll(async () => Math.abs((await hostBox()).width - 280) <= 2 && Math.abs((await hostBox()).height - 220) <= 2, 'minimum panel dimensions');
  await cdp.send('DOM.focus', { nodeId: await shadowNode('.resize-handle') });
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  const keyboardGrip = await gripFocus('se');
  assert(keyboardGrip.focused && keyboardGrip.visible && keyboardGrip.style === 'solid' && keyboardGrip.width === '2px', 'Keyboard focus on the primary resize handle stays visible.');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  await poll(async () => Math.abs((await hostBox()).width - 290) <= 2 && Math.abs((await hostBox()).height - 260) <= 2, 'keyboard resize');
  await page.keyboard.press('Home');
  await poll(async () => Math.abs((await hostBox()).width - lichessBefore.width) <= 2 && Math.abs((await hostBox()).height - lichessBefore.height) <= 2, 'Home restores automatic size');
  await poll(async () => !await storedSize('lichess'), 'Home clears Lichess size preference');
  assert.deepEqual(await storedSize('chesscom'), preferredSize, 'Reset is provider-specific.');
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedRequests, []);
  console.log('All real-extension panel movement, resizing, persistence, scrolling, and icon checks passed under restrictive Chess.com and isolated Lichess fixtures.');
} catch (error) {
  console.error(`Panel extension failed during ${stage}:`, error); console.error('Page errors:', errors); console.error('Diagnostics:', diagnostics.slice(-12));
  if (page) for (const item of page.frames()) console.error('Pointer trace:', item.url(), await item.evaluate(() => ({events:window.__panelEvents?.slice(-8),viewport:innerHeight,scrollHeight:document.scrollingElement.scrollHeight,scrollTop:document.scrollingElement.scrollTop,bodyHeight:document.body.clientHeight,bodyScroll:document.body.scrollHeight,bodyOverscroll:getComputedStyle(document.body).overscrollBehavior,rootOverscroll:getComputedStyle(document.documentElement).overscrollBehavior,shield:document.querySelectorAll('#meowlchess-drag-shield').length})).catch(() => null));
  if (page) { await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'site-panel-extension-failure.png') }).catch(() => {}); }
  throw error;
} finally {
  clearInterval(checkpoint);
  await closeTestContext(context, profile, 'meowlchess-panel-extension-test-');
  if (dirname(bundle) === temporaryRoot && basename(bundle).startsWith('meowlchess-panel-extension-bundle-')) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
