import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext, openLibrary } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = resolve(tmpdir());
const profilePrefix = 'MeowlChess-auto-username-test-', bundlePrefix = 'MeowlChess-auto-username-bundle-';
const profile = await mkdtemp(join(temporary, profilePrefix)), bundle = await mkdtemp(join(temporary, bundlePrefix));
const extension = join(bundle, 'extension');
const fixture = String.raw`
const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
window.accountFixture = { allow: true, hold: false, response: { status: 'not-found' }, pending: [], requests: [], detectionCalls: [],
  release(result) { this.hold = false; for (const resolve of this.pending.splice(0)) resolve(result || this.response); },
};
chrome.permissions.request = async options => { accountFixture.requests.push(options); return accountFixture.allow; };
chrome.runtime.sendMessage = (message, ...args) => {
  if (message?.type !== 'meowl:detect-account') return originalSend(message, ...args);
  accountFixture.detectionCalls.push(message);
  return accountFixture.hold ? new Promise(resolve => accountFixture.pending.push(resolve)) : Promise.resolve(accountFixture.response);
};
`;
let context, page, stage = 'launch';
const errors = [], requests = [];
async function poll(read, label) {
  const start = Date.now();
  while (Date.now() - start < 12000) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 35)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, ...(manifest.optional_permissions || [])])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...(manifest.optional_host_permissions || [])])];
  delete manifest.optional_permissions; delete manifest.optional_host_permissions;
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const html = await readFile(join(extension, 'review.html'), 'utf8');
  await writeFile(join(extension, 'review.html'), html.replace('<script type="module" src="review.js">', '<script src="MeowlChess-auto-account-fixture.js"></script><script type="module" src="review.js">'));
  await writeFile(join(extension, 'MeowlChess-auto-account-fixture.js'), fixture);
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  await context.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${new URL(worker.url()).hostname}/review.html?siteSettings=1`;
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector('#username').disabled && !document.querySelector('#site-chesscom-enabled').disabled);
  const stored = () => worker.evaluate(() => chrome.storage.local.get(null));
  const load = async values => {
    await page.goto('about:blank');
    await worker.evaluate(async values => { await chrome.storage.local.clear(); await chrome.storage.local.set({ tutorialNeverShowAgain: true, supportNeverShowAgain: true, reviewSettings: { source: 'chesscom' }, ...values }); }, values);
    await page.goto(url); await ready(); await openLibrary(page);
  };
  const input = page.locator('#username'), detect = page.locator('#detect-account'), status = page.locator('#account-status');
  const cache = { chesscom: { username: 'AutoCat', detectedAt: Date.now() }, lichess: { username: 'AutoOwl', detectedAt: Date.now() } };
  const configure = values => page.evaluate(values => Object.assign(accountFixture, values), values);
  const response = (source, username) => ({ status: 'detected', source, username });
  const settle = () => poll(() => detect.isEnabled(), 'account detection finished');
  const release = result => page.evaluate(result => accountFixture.release(result), result);

  console.log(stage = 'fresh automatic account defaults for both websites');
  await load({ detectedAccounts: cache });
  assert.equal(await input.inputValue(), 'AutoCat');
  assert.equal(await page.locator('#site-chesscom-username').inputValue(), 'AutoCat');
  assert.equal(await page.locator('#site-lichess-username').inputValue(), 'AutoOwl');
  await page.locator('#game-source').selectOption('lichess');
  assert.equal(await input.inputValue(), 'AutoOwl');
  assert.equal(await page.evaluate(() => accountFixture.requests.length), 0, 'Automatic filling never requests permissions.');
  assert.equal(requests.length, 0, 'Automatic filling never fetches games.');

  console.log(stage = 'toolbar provider follows its source website');
  await load({ detectedAccounts: cache, reviewSettings: { source: 'chesscom' } });
  await page.goto(url.replace('?siteSettings=1', '?accountSource=lichess')); await ready(); await openLibrary(page);
  assert.equal(await page.locator('#game-source').inputValue(), 'lichess');
  assert.equal(await input.inputValue(), 'AutoOwl');
  await page.goto(url + '&accountSource=lichess'); await ready(); await openLibrary(page);
  assert.equal(await page.locator('#game-source').inputValue(), 'chesscom', 'Settings deep links retain the saved provider.');

  console.log(stage = 'manual names, links, and explicit blanks survive automatic detection');
  for (const manual of ['ManualCat', '', 'https://lichess.org/AbCdEf12']) {
    const source = manual.startsWith('https:') ? 'lichess' : 'chesscom';
    await load({ usernames: { [source]: manual }, username: 'StaleLegacy', reviewSettings: { source }, detectedAccounts: cache });
    assert.equal(await input.inputValue(), manual);
    await worker.evaluate(() => chrome.storage.local.set({ detectedAccounts: { chesscom: { username: 'NewCat' }, lichess: { username: 'NewOwl' } } }));
    assert.equal(await input.inputValue(), manual);
  }
  await load({}); await input.fill('TypingCat');
  await worker.evaluate(cache => chrome.storage.local.set({ detectedAccounts: cache }), cache);
  assert.equal(await input.inputValue(), 'TypingCat');
  await input.fill(''); await input.press('Tab');
  await poll(async () => (await stored()).usernames?.chesscom === '', 'explicit blank saved');
  await page.reload(); await ready(); await openLibrary(page); assert.equal(await input.inputValue(), '');

  console.log(stage = 'manual detection respects edits, website switching, closing, and forgetting');
  await configure({ hold: true }); await detect.click();
  await page.waitForFunction(() => accountFixture.pending.length === 1);
  await input.fill('LaterDraft'); await release(response('chesscom', 'OldReplyCat')); await settle();
  assert.equal(await input.inputValue(), 'LaterDraft');
  await configure({ hold: true }); await detect.click();
  await page.waitForFunction(() => accountFixture.pending.length === 1);
  await page.locator('#game-source').selectOption('lichess');
  await release(response('chesscom', 'OldReplyCat')); await settle();
  assert.notEqual(await input.inputValue(), 'OldReplyCat');
  await page.locator('#game-source').selectOption('chesscom');
  await configure({ hold: true }); await detect.click(); await page.waitForFunction(() => accountFixture.pending.length === 1);
  await page.locator('#library-dialog').evaluate(dialog => dialog.close());
  await release(response('chesscom', 'ClosedReplyCat')); await settle(); await openLibrary(page);
  assert.notEqual(await input.inputValue(), 'ClosedReplyCat');
  await load({ usernames: { chesscom: 'SavedCat' }, savedAccounts: { chesscom: ['SavedCat'], lichess: [] } });
  await configure({ hold: true }); await detect.click(); await page.waitForFunction(() => accountFixture.pending.length === 1);
  await page.locator('#forget-account').click();
  await release(response('chesscom', 'ForgottenReplyCat')); await settle();
  assert.equal(await input.inputValue(), '');

  console.log(stage = 'explicit account detection and clear failure feedback');
  await configure({ response: response('chesscom', 'SignedInCat') }); await detect.click(); await settle();
  assert.equal(await input.inputValue(), 'SignedInCat');
  await poll(async () => (await stored()).usernames.chesscom === 'SignedInCat', 'detected account remembered');
  const beforeDenied = await page.evaluate(() => accountFixture.detectionCalls.length);
  await configure({ allow: false }); await detect.click(); await settle();
  assert.equal(await page.evaluate(() => accountFixture.detectionCalls.length), beforeDenied);
  assert.match(await status.innerText(), /Allow access/);
  for (const outcome of ['not-found', 'ambiguous', 'unavailable']) {
    await configure({ allow: true, response: { status: outcome } }); await detect.click(); await settle();
    assert.equal(await input.inputValue(), 'SignedInCat');
    assert.match(await status.innerText(), /username|account/i);
  }

  console.log(stage = 'on-site detection fills without enabling, and blank enable detects before saving');
  await load({}); await page.locator('#library-dialog').evaluate(dialog => dialog.close());
  if (!await page.locator('#review-settings').evaluate(settings => settings.open)) await page.locator('#review-settings > summary').click();
  await configure({ response: response('chesscom', 'PageCat') });
  await page.locator('#site-chesscom-detect').click();
  await poll(async () => await page.locator('#site-chesscom-username').inputValue() === 'PageCat', 'site account detected');
  assert.equal(await page.locator('#site-chesscom-enabled').isChecked(), false);
  assert(!((await stored()).siteReviewSettings?.chesscom?.enabled));
  await page.locator('#site-chesscom-enabled').click();
  await poll(async () => (await stored()).siteReviewSettings?.chesscom?.enabled === true, 'site explicitly enabled');
  assert.equal((await stored()).siteReviewSettings.chesscom.username, 'pagecat');
  assert(await page.locator('#site-chesscom-detect').isDisabled());
  await page.locator('#site-chesscom-enabled').click();
  await poll(async () => !(await stored()).siteReviewSettings.chesscom.enabled, 'site disabled');
  await page.locator('#site-chesscom-username').fill('');
  await configure({ response: response('chesscom', 'FreshPageCat') });
  await page.locator('#site-chesscom-enabled').click();
  await poll(async () => (await stored()).siteReviewSettings.chesscom.username === 'freshpagecat', 'empty enable detects account');
  await configure({ response: { status: 'not-found' } });
  await page.locator('#site-lichess-enabled').click();
  await poll(async () => !(await page.locator('#site-lichess-enabled').isDisabled()), 'missing account request completed');
  assert.equal(await page.locator('#site-lichess-enabled').isChecked(), false);
  assert(!((await stored()).siteReviewSettings?.lichess?.enabled));
  assert.match(await page.locator('#site-review-status').innerText(), /Open Lichess, sign in/);

  console.log(stage = 'narrow-screen layout');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.locator('#close-settings').click(); await openLibrary(page);
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-auto-username-games-desktop.png'), fullPage: true });
  await page.locator('#close-library').click(); await page.locator('#review-settings > summary').click();
  await page.setViewportSize({ width: 375, height: 850 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-auto-username-settings-mobile.png'), fullPage: true });
  await openLibrary(page);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-auto-username-games-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.equal(requests.length, 0);
  console.log('PASS: automatic own-account defaults, protected manual entries, detection permissions, asynchronous cancellation, on-site enable, and narrow layouts.');
} catch (error) { error.message = `${stage}: ${error.message}`; throw error; }
finally {
  await closeTestContext(context, profile, profilePrefix);
  const target = resolve(bundle);
  if (dirname(target) === temporary && basename(target).startsWith(bundlePrefix)) await rm(target, { recursive: true, force: true, maxRetries: 3 });
}
