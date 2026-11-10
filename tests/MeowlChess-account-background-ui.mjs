import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeLibrary, openImport, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = resolve(tmpdir());
const profilePrefix = 'MeowlChess-account-background-profile-', bundlePrefix = 'MeowlChess-account-background-bundle-';
const profile = await mkdtemp(join(temporary, profilePrefix)), bundle = await mkdtemp(join(temporary, bundlePrefix));
const extension = join(bundle, 'extension');
let context, page, stage = 'setup';
const chessNav = name => `<nav id="sidebar-main-menu"><a data-interaction="profile" href="/member/${name}">${name}</a></nav>`;
const lichessNav = name => `<header id="top"><div class="dasher"><button id="user_tag">${name}</button></div></header>`;
const markup = new Map([
  ['https://www.chess.com/member/Opponent?username=Opponent', chessNav('PlayerCat') + '<main>Opponent profile</main><iframe src="/embed"></iframe>'],
  ['https://www.chess.com/embed', chessNav('FrameCat')],
  ['https://www.chess.com/second', chessNav('DifferentCat')],
  ['https://www.chess.com/logout-done', '<nav id="sidebar-main-menu"><a class="navbar-login" href="/login">Log in</a></nav>'],
  ['https://lichess.org/@/Opponent', lichessNav('LichessCat') + '<main>Opponent profile</main>'],
]);
const poll = async (read, expected, message) => {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (expected(await read())) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail(message);
};
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  // Only this disposable fixture pregrants site access; the shipped manifest
  // keeps these hosts optional and toolbar detection uses its activeTab grant.
  const manifestPath = join(extension, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...manifest.host_permissions, 'https://www.chess.com/*', 'https://chess.com/*', 'https://lichess.org/*'])];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(extension, 'MeowlChess-account-denied.html'), '<!doctype html><title>Sender boundary fixture</title>');
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, viewport: { width: 1280, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  const errors = [], unexpected = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (markup.has(url)) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Account fixture</title></head><body>${markup.get(url)}</body></html>` });
    if (url.endsWith('/favicon.ico')) return route.fulfill({ status: 204, body: '' });
    unexpected.push(url); return route.abort();
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await worker.evaluate(() => chrome.storage.local.set({
    tutorialNeverShowAgain: true, supportNeverShowAgain: true,
    reviewSettings: { engine: 'lozza', time: '50', lines: '1', smart: false, highlights: false },
    coachPreferences: { coach: 'meowl', perspective: 'me', sounds: false, motion: false, commentary: false },
  }));
  const cache = () => worker.evaluate(async () => (await chrome.storage.local.get('detectedAccounts')).detectedAccounts || {});

  stage = 'actual top-frame injection and automatic detection';
  const chess = await context.newPage();
  await chess.goto('https://www.chess.com/member/Opponent?username=Opponent');
  await poll(cache, value => value.chesscom?.username === 'PlayerCat', 'Background should detect own account from navigation, not profile or child frame.');
  const firstCache = await cache(); assert(firstCache.chesscom.detectedAt > 0);
  const lichess = await context.newPage(); await lichess.goto('https://lichess.org/@/Opponent');
  await poll(cache, value => value.lichess?.username === 'LichessCat' && value.chesscom?.username === 'PlayerCat', 'Both providers should survive real cache merges.');

  stage = 'real review page prefill and authenticated message route';
  page = await context.newPage(); await page.goto(`${origin}/review.html`);
  await page.locator('#library-dialog').waitFor({ state: 'visible' });
  await poll(() => page.locator('#username').inputValue(), value => value === 'PlayerCat', 'Game picker should fill the detected Chess.com name.');
  assert.equal(await page.locator('#site-chesscom-username').inputValue(), 'PlayerCat');
  assert.equal(await page.locator('#site-lichess-username').inputValue(), 'LichessCat');
  assert.deepEqual(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'meowl:detect-account', source: 'chesscom' })), { status: 'detected', source: 'chesscom', username: 'PlayerCat' });
  assert.equal((await page.evaluate(() => chrome.runtime.sendMessage({ type: 'meowl:detect-account', source: 'not-a-provider' }))).status, 'unavailable');
  await page.locator('#game-source').selectOption('lichess');
  assert.equal(await page.locator('#username').inputValue(), 'LichessCat');
  await page.locator('#game-source').selectOption('chesscom');
  await page.locator('#username').fill('Opponent'); await page.locator('#username').press('Tab');
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'meowl:detect-account', source: 'chesscom' }));
  assert.equal(await page.locator('#username').inputValue(), 'Opponent', 'Detection must preserve manual lookup input.');

  stage = 'sender authorization and conflicting open accounts';
  const unauthorized = await context.newPage(); await unauthorized.goto(`${origin}/MeowlChess-account-denied.html`);
  assert.equal((await unauthorized.evaluate(() => chrome.runtime.sendMessage({ type: 'meowl:detect-account', source: 'chesscom' }))).status, 'unavailable');
  await unauthorized.close();
  const conflict = await context.newPage(); await conflict.goto('https://www.chess.com/second');
  await page.bringToFront();
  assert.equal((await page.evaluate(() => chrome.runtime.sendMessage({ type: 'meowl:detect-account', source: 'chesscom' }))).status, 'ambiguous');
  await conflict.close();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'meowl:detect-account', source: 'chesscom' }));
  await poll(cache, value => value.chesscom?.username === 'PlayerCat', 'The one remaining account should be detected.');

  stage = 'coach follows detected account instead of the searched opponent';
  await openImport(page);
  await page.locator('#pgn-text').fill('[Event "Account fixture"]\n[Site "Chess.com"]\n[White "PlayerCat"]\n[Black "Opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1');
  await page.locator('#import-button').click(); await closeLibrary(page);
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
  await page.locator('#coach-tab').click();
  await poll(() => page.locator('.coach-focus-hint').innerText(), value => value === 'Focusing on PlayerCat (White).', 'Coach Me should identify the detected signed-in account.');
  await page.locator('.coach-player-side').selectOption('b');
  assert.equal(await page.locator('.coach-focus-hint').innerText(), 'Focusing on Opponent (Black).');
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'meowl:detect-account', source: 'chesscom' }));
  assert.equal(await page.locator('.coach-focus-hint').innerText(), 'Focusing on Opponent (Black).', 'Manual current-game player override remains in effect.');

  stage = 'real sign-out clears only its provider';
  await chess.goto('https://www.chess.com/logout-done'); await chess.bringToFront();
  await poll(cache, value => !value.chesscom && value.lichess?.username === 'LichessCat', 'Confirmed sign-out should clear only Chess.com.');
  assert.equal(await page.locator('.coach-focus-hint').innerText(), 'Focusing on Opponent (Black).');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log('PASS: actual background injection, provider caches, authorized message route, automatic/manual input, coach identity, and sign-out.');
} catch (error) {
  error.message = `${stage}: ${error.message}`; throw error;
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const target = resolve(bundle);
  if (dirname(target) === temporary && basename(target).startsWith(bundlePrefix)) await rm(target, { recursive: true, force: true, maxRetries: 3 });
}
