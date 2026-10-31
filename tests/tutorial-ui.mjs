import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-tutorial-test-'));
const key = 'tutorialNeverShowAgain';
const supportKey = 'supportNeverShowAgain';
const repository = 'https://github.com/ThuyTran735/MeowlChess';
const pgn = '[Event "Tutorial test"]\n[White "alice"]\n[Black "bob"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const game = { url: 'https://www.chess.com/game/live/12345', pgn, rules: 'chess', time_class: 'rapid', end_time: 1700000000, white: { username: 'alice', result: 'checkmated' }, black: { username: 'bob', result: 'win' } };
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
const server = createServer(async (req, res) => {
  try {
    const path = resolve(extension, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(extension + sep)) throw new Error('Invalid asset path');
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/plain', 'Content-Security-Policy': manifest.content_security_policy.extension_pages });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context, page, stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const requests = [], githubRequests = [], errors = [];
  await context.route(/^https?:\/\//, async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:')) return route.continue();
    if (url === repository) {
      githubRequests.push(url);
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>MeowlChess GitHub fixture</title><link rel="icon" href="data:,"><p>Controlled repository page</p>' });
    }
    requests.push(url);
    if (url === 'https://api.chess.com/pub/player/bob/games/archives') return route.fulfill({ json: { archives: ['https://api.chess.com/pub/player/bob/games/2023/11'] } });
    if (url === 'https://api.chess.com/pub/player/bob/games/2023/11') return route.fulfill({ json: { games: [game] } });
    return route.abort();
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const url = `chrome-extension://${new URL(worker.url()).hostname}/review.html`;
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.engineCommands = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(command, ...args) { if (typeof command === 'string') window.engineCommands.push(command); return send.call(this, command, ...args); };
  });
  const tutorial = () => page.locator('#tutorial-dialog');
  const support = () => page.locator('#support-dialog');
  const supportVisible = () => support().waitFor({ state: 'visible' });
  const skipSupport = async () => { await page.locator('#support-skip').click(); await support().waitFor({ state: 'hidden' }); };
  const visible = () => tutorial().waitFor({ state: 'visible' });
  const dismissed = () => tutorial().waitFor({ state: 'hidden' });
  const library = () => page.locator('#library-dialog').waitFor({ state: 'visible' });
  const saved = () => page.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
  const visibleStep = () => page.locator('[data-tutorial-step]:visible').getAttribute('data-tutorial-step');
  const reopen = async () => { if (await page.locator('#library-dialog').evaluate(el => el.open)) await page.locator('#close-library').click(); await page.locator('#open-tutorial').click(); await visible(); };
  const finish = async () => { await page.locator('#tutorial-next').click(); await page.locator('#tutorial-next').click(); assert.match(await page.locator('#tutorial-next').innerText(), /Get started/i); await page.locator('#tutorial-next').click(); await dismissed(); };
  const capture = name => page.screenshot({ path: join(root, 'test-results', name), fullPage: false });
  const assertGuidance = async target => {
    await page.waitForFunction(target => {
      const highlight = document.querySelector('#tutorial-highlight');
      const card = document.querySelector('#tutorial-card');
      const arrow = document.querySelector('#tutorial-arrow');
      return highlight?.dataset.target === target && highlight.childElementCount > 0 && card?.getBoundingClientRect().width > 0 && arrow?.getAttribute('d');
    }, target);
    // Positioning follows scrolling/resizing on the next frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.evaluate(() => {
      const box = selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
      return { viewport: { width: innerWidth, height: innerHeight }, card: box('#tutorial-card'), highlight: box('#tutorial-highlight'), arrow: box('#tutorial-arrow') };
    });
    for (const name of ['card', 'highlight', 'arrow']) {
      const box = geometry[name];
      assert(name === 'arrow' ? box.width + box.height > 0 : box.width > 0 && box.height > 0, `${name} is visible for ${target}`);
      assert(box.left >= -1 && box.right <= geometry.viewport.width + 1 && box.top >= -1 && box.bottom <= geometry.viewport.height + 1, `${name} stays in view for ${target}: ${JSON.stringify(geometry)}`);
    }
    const a = geometry.card, b = geometry.highlight;
    assert(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1, `Tutorial text must not cover the highlighted control: ${JSON.stringify(geometry)}`);
    assert.equal(await page.locator('#tutorial-highlight [id]').count(), 0, 'Highlight copies must not duplicate live-control IDs.');
    assert.equal(await page.locator('#tutorial-arrow').evaluate(el => { const css = getComputedStyle(el); return css.visibility !== 'hidden' && css.display !== 'none' && css.stroke !== 'none' && Number(css.opacity) > 0; }), true);
    assert.equal(await tutorial().evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'Reduced motion must not keep tutorial animations running.');
  };
  await mkdir(join(root, 'test-results'), { recursive: true });
  stage = 'support invitation, focus, mobile layout and no automatic activity';
  await page.goto(url); await supportVisible();
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await tutorial().isVisible(), false);
  assert.equal(await page.locator('#library-dialog').isVisible(), false);
  assert.equal(await page.locator('#support-never').isChecked(), false);
  assert.equal(await page.locator('#support-title').evaluate(el => el === document.activeElement), true);
  assert.match(await page.locator('label:has(#support-never)').innerText(), /Never show again/);
  assert.equal(await page.locator('#support-github').getAttribute('href'), repository);
  assert.equal(await page.locator('#support-github').getAttribute('target'), '_blank');
  assert.deepEqual((await page.locator('#support-github').getAttribute('rel')).split(/\s+/).sort(), ['noopener', 'noreferrer']);
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await support().evaluate(el => el.contains(document.activeElement) || (document.activeElement === document.body && !document.hasFocus())), true, 'Support focus cannot enter the background app.');
  }
  await capture('support-desktop.png');
  await page.setViewportSize({ width: 360, height: 560 });
  await page.locator('#support-skip').focus();
  const supportGeometry = await support().evaluate(el => {
    const rect = el.getBoundingClientRect(), focused = document.activeElement.getBoundingClientRect();
    return { fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, noOverflow: el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth, focusVisible: focused.top >= rect.top && focused.bottom <= rect.bottom };
  });
  assert.deepEqual(supportGeometry, { fits: true, noOverflow: true, focusVisible: true });
  await capture('support-mobile.png');
  assert.equal(await page.evaluate(() => window.engineCommands.length), 0);
  assert.deepEqual(requests, []); assert.deepEqual(githubRequests, []);
  await page.keyboard.press('Escape'); await visible();
  await page.locator('#tutorial-skip').click(); await library();
  await page.setViewportSize({ width: 1366, height: 768 });

  stage = 'support Skip, independent preferences and native GitHub link';
  await page.reload(); await supportVisible(); await skipSupport(); await visible();
  await page.locator('#tutorial-skip').click(); await library();
  await page.evaluate(async key => chrome.storage.local.set({ [key]: true }), key);
  await page.reload(); await supportVisible(); await page.keyboard.press('Escape'); await library();
  assert.equal(await tutorial().isVisible(), false, 'The tutorial preference must not suppress the support invitation.');
  await page.reload(); await supportVisible(); await page.locator('#support-never').check();
  const [github] = await Promise.all([context.waitForEvent('page'), page.locator('#support-github').click()]);
  await github.waitForURL(repository); await github.waitForLoadState('domcontentloaded');
  assert.equal(await github.title(), 'MeowlChess GitHub fixture');
  assert.equal(await github.evaluate(() => window.opener), null);
  assert.deepEqual(githubRequests, [repository]);
  await library(); assert.equal(await support().isVisible(), false);
  assert.deepEqual(await page.evaluate(async () => chrome.storage.local.get(['supportNeverShowAgain', 'tutorialNeverShowAgain'])), { supportNeverShowAgain: true, tutorialNeverShowAgain: true });
  await github.close(); await page.bringToFront();
  await page.reload(); await library(); assert.equal(await support().isVisible(), false);
  const supportTab = await context.newPage(); await supportTab.goto(url); await supportTab.locator('#library-dialog').waitFor({ state: 'visible' });
  assert.equal(await supportTab.locator('#support-dialog').isVisible(), false); await supportTab.close();
  await page.evaluate(async key => chrome.storage.local.set({ [key]: false }), supportKey);
  await reopen(); assert.equal(await support().isVisible(), false, 'Manual Tutorial must not reopen the support invitation.');
  await page.locator('#tutorial-skip').click(); await dismissed();
  console.log('PASS: support comes first, stays optional, opens only the exact repository on click, and remembers an independent preference');

  stage = 'support storage failure still continues onboarding';
  await page.evaluate(async key => chrome.storage.local.set({ [key]: false }), key);
  await page.reload(); await supportVisible();
  await page.evaluate(() => { const original = chrome.storage.local.set.bind(chrome.storage.local); chrome.storage.local.set = values => Object.hasOwn(values, 'supportNeverShowAgain') ? Promise.reject(new Error('Test support storage unavailable')) : original(values); });
  await page.locator('#support-never').check(); await page.locator('#support-storage-status').waitFor({ state: 'visible' });
  assert.match(await page.locator('#support-storage-status').innerText(), /could not be saved/);
  await skipSupport(); await visible();
  assert.equal(await page.evaluate(async key => (await chrome.storage.local.get(key))[key], supportKey), false);
  assert.equal(await saved(), false);
  await page.reload(); await supportVisible(); await page.locator('#support-never').check(); await skipSupport(); await visible();
  console.log('PASS: support preference failure explains the problem without trapping the user');

  stage = 'first launch, progress, focus and keyboard';
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await page.locator('#library-dialog').evaluate(el => el.open), false);
  assert.equal(await page.locator('#tutorial-never').isChecked(), false);
  assert.match(await page.locator('label[for="tutorial-never"], label:has(#tutorial-never)').innerText(), /Never show again/);
  assert.equal(await visibleStep(), '0');
  assert.equal(await page.locator('#tutorial-back').isVisible(), false);
  assert.equal(await page.locator('[data-tutorial-step="0"] h3').evaluate(el => el === document.activeElement), true);
  for (let index = 0; index < 10; index++) { await page.keyboard.press('Tab'); assert.equal(await tutorial().evaluate(el => el.contains(document.activeElement) || (document.activeElement === document.body && !document.hasFocus())), true, 'Tab may reach browser chrome but cannot focus background app controls.'); }
  const initialBoard = await page.locator('#board').getAttribute('aria-label');
  await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#board').getAttribute('aria-label'), initialBoard);
  await page.locator('#tutorial-next').click(); assert.equal(await visibleStep(), '1'); assert.match(await page.locator('#tutorial-progress').innerText(), /2.*3/);
  await page.locator('#tutorial-back').click(); assert.equal(await visibleStep(), '0');
  await assertGuidance('#library-toggle'); await capture('tutorial-desktop.png');
  await page.locator('#tutorial-next').click(); await assertGuidance('#analyze-button'); await capture('tutorial-review-desktop.png');
  await page.locator('#tutorial-next').click(); await assertGuidance('.review-tabs'); await capture('tutorial-explore-desktop.png');
  await page.locator('#tutorial-back').click(); await page.locator('#tutorial-back').click();
  await page.setViewportSize({ width: 390, height: 560 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await assertGuidance('#library-toggle'); await capture('tutorial-mobile.png');
  await page.locator('#tutorial-next').click(); await assertGuidance('#analyze-button'); await capture('tutorial-review-mobile.png');
  await page.locator('#tutorial-next').click(); await assertGuidance('.review-tabs'); await capture('tutorial-explore-mobile.png');
  await page.locator('#tutorial-back').click(); await page.locator('#tutorial-back').click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await finish(); await library();
  assert.equal(await page.evaluate(() => window.engineCommands.length), 0);
  assert.equal(requests.length, 0);
  console.log('PASS: three-step guided tutorial, arrows and highlights, reduced motion, keyboard focus, responsive layout, and no game/engine activity');

  stage = 'Skip and never-show persistence';
  await page.reload(); await visible(); await page.locator('#tutorial-skip').click(); await dismissed(); await library();
  await page.reload(); await visible();
  await page.locator('#tutorial-never').check(); await page.locator('#tutorial-skip').click(); await dismissed();
  assert.equal(await saved(), true);
  await page.reload(); await library(); assert.equal(await tutorial().isVisible(), false);
  const secondTab = await context.newPage(); await secondTab.goto(url); await secondTab.locator('#library-dialog').waitFor({ state: 'visible' });
  assert.equal(await secondTab.locator('#tutorial-dialog').isVisible(), false); await secondTab.close();
  await reopen(); assert.equal(await page.locator('#tutorial-never').isChecked(), true);
  await page.locator('#tutorial-never').uncheck(); await finish(); assert.equal(await saved(), false);
  await page.reload(); await visible();
  await page.keyboard.press('Escape'); await dismissed(); await library();
  await page.reload(); await visible();
  await page.locator('#tutorial-never').check(); await page.keyboard.press('Escape'); await dismissed(); assert.equal(await saved(), true);
  await page.reload(); await library(); assert.equal(await tutorial().isVisible(), false);
  await reopen(); await page.locator('#tutorial-never').uncheck(); await page.locator('#tutorial-never').check(); await finish(); assert.equal(await saved(), true);
  assert.equal(await page.evaluate(async key => (await chrome.storage.local.get(key))[key], supportKey), true, 'Changing the tutorial preference must not change the support preference.');
  console.log('PASS: Skip, Escape, Finish and checkbox preference persist correctly across reloads and tabs');

  stage = 'manual tutorial preserves a completed review';
  await page.locator('#library-toggle').click(); await library(); await page.locator('#demo-button').click();
  await page.locator('#review-settings > summary').click(); await page.locator('#depth').selectOption('50'); await page.locator('#smart-analysis').uncheck(); await page.locator('#review-settings > summary').click();
  await page.locator('#analyze-button').click(); await page.waitForFunction(() => /Review complete/.test(document.querySelector('#review-status').textContent) && !document.querySelector('#analyze-button').disabled);
  await page.locator('#next-button').click();
  const reviewState = await page.evaluate(() => ({ board: document.querySelector('#board').getAttribute('aria-label'), title: document.querySelector('#game-title').textContent, moves: document.querySelector('#move-list').innerHTML, tab: document.querySelector('[role="tab"][aria-selected="true"]').id, saved: document.querySelector('#saved-count').textContent, commands: window.engineCommands.length }));
  await page.locator('#open-tutorial').scrollIntoViewIfNeeded();
  const originalScroll = await page.evaluate(() => scrollY);
  await reopen(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.locator('#tutorial-skip').click(); await dismissed();
  await page.waitForFunction(y => Math.abs(scrollY - y) < 2, originalScroll);
  assert.deepEqual(await page.evaluate(() => ({ board: document.querySelector('#board').getAttribute('aria-label'), title: document.querySelector('#game-title').textContent, moves: document.querySelector('#move-list').innerHTML, tab: document.querySelector('[role="tab"][aria-selected="true"]').id, saved: document.querySelector('#saved-count').textContent, commands: window.engineCommands.length })), reviewState);
  assert.equal(await page.locator('#open-tutorial').evaluate(el => el === document.activeElement), true);
  console.log('PASS: reopening the tutorial preserves the completed review, selected move and focus');

  stage = 'direct saved review and site settings bypass both prompts';
  const reviewId = await page.locator('.saved-open[data-review-id]').first().getAttribute('data-review-id');
  assert.match(reviewId, /^game-[a-f0-9]{64}$/);
  await page.evaluate(() => chrome.storage.local.set({ supportNeverShowAgain: false, tutorialNeverShowAgain: false }));
  const direct = await context.newPage();
  await direct.addInitScript(() => { window.engineCommands = []; const send = Worker.prototype.postMessage; Worker.prototype.postMessage = function(command, ...args) { window.engineCommands.push(command); return send.call(this, command, ...args); }; });
  await direct.goto(`${url}?reviewId=${reviewId}`);
  await direct.waitForFunction(() => document.querySelector('#summary-tab').getAttribute('aria-selected') === 'true' && !document.querySelector('#analyze-button').disabled);
  assert.equal(await direct.locator('#game-title').innerText(), reviewState.title.trim());
  assert.equal(await direct.locator('#support-dialog').isVisible(), false);
  assert.equal(await direct.locator('#tutorial-dialog').isVisible(), false);
  assert.equal(await direct.evaluate(() => window.engineCommands.length), 0);
  await direct.goto(`${url}?siteSettings=1`);
  await direct.waitForFunction(() => document.activeElement?.id === 'site-chesscom-enabled');
  assert.equal(await direct.locator('#review-settings').evaluate(el => el.open), true);
  assert.equal(await direct.locator('#support-dialog').isVisible(), false);
  assert.equal(await direct.locator('#tutorial-dialog').isVisible(), false);
  await direct.close();
  console.log('PASS: direct saved reviews and site settings bypass both prompts without engine activity');

  stage = 'remembered game retrieval waits until dismissal';
  await page.evaluate(async key => chrome.storage.local.set({ [key]: false, supportNeverShowAgain: false, username: 'bob', usernames: { chesscom: 'bob' } }), key);
  const beforeRequests = requests.length;
  await page.reload(); await supportVisible();
  assert.equal(requests.length, beforeRequests); assert.equal(await page.evaluate(() => window.engineCommands.length), 0);
  await page.locator('#support-never').check(); await skipSupport(); await visible();
  assert.equal(requests.length, beforeRequests); assert.equal(await page.locator('dialog[open]').count(), 1);
  await page.locator('#tutorial-skip').click(); await dismissed();
  await page.waitForFunction(() => document.querySelector('#game-title').textContent === 'alice vs bob');
  assert.equal(requests.length, beforeRequests + 2);
  console.log('PASS: remembered archive loading waits until both support and tutorial have been dismissed');

  stage = 'storage errors do not trap the user';
  await page.evaluate(() => chrome.storage.local.remove(['username', 'usernames']));
  await reopen();
  await page.evaluate(() => { const original = chrome.storage.local.set.bind(chrome.storage.local); chrome.storage.local.set = values => Object.hasOwn(values, 'tutorialNeverShowAgain') ? Promise.reject(new Error('Test storage unavailable')) : original(values); });
  await page.locator('#tutorial-never').check();
  await page.locator('#tutorial-storage-status').waitFor({ state: 'visible' });
  assert.match(await page.locator('#tutorial-storage-status').innerText(), /save|remember|storage/i);
  await page.locator('#tutorial-skip').click(); await dismissed();
  assert.equal(await page.locator('#open-tutorial').isEnabled(), true);
  await page.reload(); await visible();
  console.log('PASS: unavailable preference storage is explained and Skip remains usable');

  stage = 'webpage local-storage fallback';
  const web = await context.newPage(); web.on('pageerror', error => errors.push(error.message));
  await web.goto(`http://127.0.0.1:${server.address().port}/review.html`);
  await web.locator('#support-dialog').waitFor({ state: 'visible' });
  await web.locator('#support-never').check(); await web.locator('#support-skip').click();
  await web.locator('#tutorial-dialog').waitFor({ state: 'visible' });
  assert.equal(await web.evaluate(() => localStorage.getItem('meowlchess.supportNeverShowAgain')), 'true');
  assert.equal(await web.evaluate(() => localStorage.getItem('meowlchess.tutorialNeverShowAgain')), null);
  await web.locator('#tutorial-never').check(); await web.locator('#tutorial-skip').click();
  await web.locator('#tutorial-dialog').waitFor({ state: 'hidden' });
  assert.equal(await web.evaluate(() => localStorage.getItem('meowlchess.tutorialNeverShowAgain')), 'true');
  await web.reload(); await web.locator('#library-dialog').waitFor({ state: 'visible' }); assert.equal(await web.locator('#tutorial-dialog').isVisible(), false);
  assert.equal(await web.locator('#support-dialog').isVisible(), false);
  await web.evaluate(() => localStorage.setItem('meowlchess.supportNeverShowAgain', 'false'));
  await web.reload(); await web.locator('#support-dialog').waitFor({ state: 'visible' });
  await web.locator('#support-never').check(); await web.locator('#support-skip').click();
  await web.locator('#library-dialog').waitFor({ state: 'visible' }); assert.equal(await web.locator('#tutorial-dialog').isVisible(), false);
  await web.locator('#close-library').click(); await web.locator('#open-tutorial').click(); await web.locator('#tutorial-never').uncheck(); await web.locator('#tutorial-skip').click();
  await web.locator('#tutorial-dialog').waitFor({ state: 'hidden' }); await web.reload(); await web.locator('#tutorial-dialog').waitFor({ state: 'visible' });
  await web.close();
  assert.deepEqual(errors, []);
  console.log('PASS: webpage fallback stores support and tutorial preferences independently across reloads');
  console.log('Support and tutorial browser checks passed.');
} catch (error) {
  console.error('Tutorial failure stage:', stage, error);
  if (page) console.error(await page.evaluate(() => ({ title: document.querySelector('#game-title')?.textContent, dialogs: [...document.querySelectorAll('dialog[open]')].map(el => el.id), error: document.querySelector('#error')?.textContent, storage: document.querySelector('#tutorial-storage-status')?.textContent })).catch(() => ({})));
  throw error;
} finally {
  await closeTestContext(context, profile, 'meowlchess-tutorial-test-');
  server.closeAllConnections(); server.close();
}
