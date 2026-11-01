import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { openLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'meowlchess-accounts-test-', bundlePrefix = 'meowlchess-accounts-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const requests = [], errors = [];
let context, page, stage = 'launch';
async function poll(read, label, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Timed out: ${label}`);
}

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, 'scripting'])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...manifest.optional_host_permissions])];
  manifest.optional_permissions = (manifest.optional_permissions || []).filter(value => value !== 'scripting');
  delete manifest.optional_host_permissions;
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url()); requests.push(url.href);
    if (url.hostname === 'api.chess.com' && /^\/pub\/player\/(?:catone|cattwo|thirdcat)\/games\/archives$/.test(url.pathname)) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ archives: [] }) });
    }
    if (url.hostname === 'lichess.org' && /^\/api\/games\/user\/(?:OwlOne|OwlTwo)$/i.test(url.pathname)) {
      return route.fulfill({ contentType: 'application/x-ndjson', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${new URL(worker.url()).hostname}/review.html?siteSettings=1`;
  const siteAccounts = { chesscom: { enabled: true, username: 'automaticcat' }, lichess: { enabled: false, username: 'automaticowl' } };
  await worker.evaluate(async siteReviewSettings => {
    await chrome.storage.local.set({ username: 'LegacyCat', usernames: { chesscom: 'CatOne', lichess: 'OwlOne' }, reviewSettings: { source: 'chesscom' }, siteReviewSettings, tutorialNeverShowAgain: true, supportNeverShowAgain: true });
  }, siteAccounts);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector('#open-tutorial').disabled && !document.querySelector('#username').disabled);
  const stored = () => worker.evaluate(() => chrome.storage.local.get(['savedAccounts', 'usernames', 'siteReviewSettings']));
  const saved = async (source, names) => poll(async () => JSON.stringify((await stored()).savedAccounts?.[source]) === JSON.stringify(names), `${source} history ${names}`);
  const options = () => page.locator('#saved-account option').evaluateAll(items => items.map(item => item.value).filter(Boolean));
  const lookup = async value => {
    await page.locator('#username').fill(value); await page.locator('#load-button').click();
    await page.waitForFunction(() => !document.querySelector('#load-button').disabled && /No games found|Could not load games/.test(document.querySelector('#game-title').textContent));
  };
  await page.goto(url); await ready(); await openLibrary(page);

  stage = 'legacy-entry migration';
  await saved('chesscom', ['CatOne']); await saved('lichess', ['OwlOne']);
  assert.deepEqual(await options(), ['CatOne']); assert.equal(await page.locator('#saved-account-row').isVisible(), true);
  assert.equal(await page.locator('#username').inputValue(), 'CatOne'); assert.equal(requests.length, 0, 'Migration makes no API request.');

  stage = 'successful usernames and selection without a request';
  await lookup('CatTwo'); await saved('chesscom', ['CatTwo', 'CatOne']);
  assert.deepEqual(await options(), ['CatTwo', 'CatOne']);
  const beforeSwitch = requests.length;
  await page.locator('#saved-account').selectOption('CatOne');
  assert.equal(await page.locator('#username').inputValue(), 'CatOne');
  await poll(async () => (await stored()).usernames.chesscom === 'CatOne', 'selected account becomes last entry');
  assert.equal(requests.length, beforeSwitch, 'Selecting an account does not fetch games.');
  await lookup('cAtOnE'); await saved('chesscom', ['cAtOnE', 'CatTwo']);
  assert.deepEqual(await options(), ['cAtOnE', 'CatTwo'], 'Successful alternate spelling updates one account rather than adding a duplicate.');

  stage = 'provider independence and failed lookup';
  await page.locator('#game-source').selectOption('lichess');
  assert.deepEqual(await options(), ['OwlOne']); assert.equal(await page.locator('#username').inputValue(), 'OwlOne');
  await lookup('OwlTwo'); await saved('lichess', ['OwlTwo', 'OwlOne']);
  await lookup('https://lichess.org/abcdefgh');
  assert.deepEqual((await stored()).savedAccounts.lichess, ['OwlTwo', 'OwlOne'], 'A game URL never becomes an account.');
  assert.equal((await stored()).usernames.lichess, 'https://lichess.org/abcdefgh', 'The existing last-entry URL preference is retained.');
  await page.locator('#game-source').selectOption('chesscom');
  assert.deepEqual(await options(), ['cAtOnE', 'CatTwo']);
  await lookup('MissingCat');
  assert.deepEqual((await stored()).savedAccounts.chesscom, ['cAtOnE', 'CatTwo'], 'Failed usernames do not pollute saved accounts.');
  assert.equal((await stored()).usernames.chesscom, 'MissingCat', 'Failed entries still use the existing last-entry preference.');
  assert.deepEqual((await stored()).siteReviewSettings, siteAccounts, 'The switcher leaves on-site account identities and enabled state unchanged.');

  stage = 'latest storage merge';
  await worker.evaluate(async () => {
    const { savedAccounts } = await chrome.storage.local.get('savedAccounts');
    await chrome.storage.local.set({ savedAccounts: { ...savedAccounts, lichess: ['FreshOtherTabOwl', ...savedAccounts.lichess] } });
  });
  await lookup('ThirdCat'); await saved('chesscom', ['ThirdCat', 'cAtOnE', 'CatTwo']);
  await saved('lichess', ['FreshOtherTabOwl', 'OwlTwo', 'OwlOne']);

  stage = 'forgetting survives reload';
  await page.locator('#saved-account').selectOption('CatTwo'); await page.locator('#forget-account').click();
  await saved('chesscom', ['ThirdCat', 'cAtOnE']);
  await poll(async () => (await stored()).usernames.chesscom === '', 'forgotten current entry cleared');
  assert.equal(await page.locator('#username').inputValue(), '');
  const beforeNormalLaunch = requests.length;
  await page.goto(url.split('?')[0]); await ready(); await openLibrary(page);
  assert.equal(requests.length, beforeNormalLaunch, 'Normal launch does not fetch and restore the forgotten account.');
  assert.deepEqual(await options(), ['ThirdCat', 'cAtOnE'], 'A forgotten last-entered account does not return through migration.');
  await page.locator('#saved-account').selectOption('ThirdCat'); await page.locator('#forget-account').click(); await saved('chesscom', ['cAtOnE']);
  await page.locator('#saved-account').selectOption('cAtOnE'); await page.locator('#forget-account').click(); await saved('chesscom', []);
  assert.equal(await page.locator('#saved-account-row').isVisible(), false, 'An empty switcher is hidden.');
  await page.reload(); await ready(); await openLibrary(page); assert.equal(await page.locator('#saved-account-row').isVisible(), false);

  stage = 'forgetting in a stale tab preserves a newer remembered account';
  await lookup('CatTwo'); await saved('chesscom', ['CatTwo']);
  await poll(async () => (await stored()).usernames.chesscom === 'CatTwo', 'local selected account persisted');
  await worker.evaluate(async () => {
    const { usernames } = await chrome.storage.local.get('usernames');
    await chrome.storage.local.set({ username: 'NewerOtherTabCat', usernames: { ...usernames, chesscom: 'NewerOtherTabCat' } });
  });
  assert.equal(await page.locator('#username').inputValue(), 'CatTwo', 'This tab still displays its stale selection.');
  await page.locator('#forget-account').click(); await saved('chesscom', []);
  await poll(async () => await page.locator('#username').inputValue() === '', 'stale visible draft cleared after forgetting');
  assert.equal((await stored()).usernames.chesscom, 'NewerOtherTabCat', 'Forget must not erase the newer remembered account from another tab.');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('username')).username), 'NewerOtherTabCat', 'The legacy Chess.com entry also retains the newer account.');

  stage = 'unchanged drafts do not erase a newer account on provider switches';
  await page.locator('#game-source').selectOption('lichess');
  await page.evaluate(() => navigator.locks.request('meowlchess-username-preferences', () => true));
  assert.equal((await stored()).usernames.chesscom, 'NewerOtherTabCat', 'Leaving a cleared stale draft must retain the newer account.');
  await page.locator('#game-source').selectOption('chesscom');
  await page.evaluate(() => navigator.locks.request('meowlchess-username-preferences', () => true));
  assert.equal((await stored()).usernames.chesscom, 'NewerOtherTabCat', 'Returning to the provider must retain the newer account.');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('username')).username), 'NewerOtherTabCat');
  await page.locator('#game-source').selectOption('lichess');
  assert.deepEqual(await options(), ['FreshOtherTabOwl', 'OwlTwo', 'OwlOne']);
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Account controls fit a narrow screen.');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-accounts-mobile.png'), fullPage: true });
  assert.deepEqual((await stored()).siteReviewSettings, siteAccounts); assert.deepEqual(errors, []);
  console.log('PASS: account migration, successful lookup history, no-fetch selection, provider separation, deduplication, failure/URL exclusion, latest-storage merge, forget/reload, stale-tab forgetting, and narrow layout.');
} catch (error) {
  if (page) { await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-accounts-failure.png'), fullPage: true }).catch(() => {}); }
  throw new Error(`Accounts UI failed at ${stage}: ${error.message}`, { cause: error });
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) === temporaryRoot && basename(absolute).startsWith(bundlePrefix)) await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
}
