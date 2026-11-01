import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const prefix = 'meowlchess-username-test-';
const profile = await mkdtemp(join(tmpdir(), prefix));
const bundlePrefix = 'meowlchess-username-bundle-';
const bundle = await mkdtemp(join(tmpdir(), bundlePrefix));
const extension = join(bundle, 'extension');
let context, page, stage = 'launch';
try {
  // Grant optional site permissions only in this disposable copy, as in site-review-ui.
  // That keeps the real background reconciler from disabling our enabled-account fixture.
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions = [...new Set([...manifest.permissions, ...manifest.optional_permissions])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...manifest.optional_host_permissions])];
  delete manifest.optional_permissions;
  delete manifest.optional_host_permissions;
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const requests = [], errors = [];
  await context.route(/^https?:\/\//, route => {
    requests.push(route.request().url());
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const url = `chrome-extension://${new URL(worker.url()).hostname}/review.html`;
  const siteAccounts = { chesscom: { enabled: true, username: 'automaticcat' }, lichess: { enabled: false, username: 'automaticowl' } };
  await worker.evaluate(async siteReviewSettings => {
    await chrome.storage.local.set({ username: 'LegacyCat', usernames: { chesscom: 'ArchiveCat', lichess: 'ArchiveOwl' }, reviewSettings: { source: 'chesscom' }, siteReviewSettings, tutorialNeverShowAgain: true, supportNeverShowAgain: true });
  }, siteAccounts);
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  const ready = async () => page.waitForFunction(() => !document.querySelector('#open-tutorial').disabled && !document.querySelector('#username').disabled && !document.querySelector('#site-chesscom-enabled').disabled);
  const openGames = async () => { if (!await page.locator('#library-dialog').evaluate(el => el.open)) await page.locator('#library-toggle').click(); };
  const stored = async () => worker.evaluate(() => chrome.storage.local.get(['username', 'usernames', 'siteReviewSettings']));
  const saved = async (provider, value) => {
    // Poll persisted state explicitly; an async waitForFunction predicate can
    // produce a truthy Promise before the queued cross-tab storage write runs.
    const started = Date.now();
    while (Date.now() - started < 12000) {
      const valueInStorage = await stored();
      if (valueInStorage.usernames?.[provider] === value && (provider !== 'chesscom' || valueInStorage.username === value)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.fail(`Timed out waiting for the persisted ${provider} username: ${value}`);
  };

  console.log(stage = 'settings deep link restores remembered input without loading games');
  await page.goto(`${url}?siteSettings=1`); await ready();
  assert.equal(await page.locator('#username').inputValue(), 'ArchiveCat');
  assert.equal(await page.locator('#site-chesscom-username').inputValue(), 'automaticcat');
  assert.equal(await page.locator('#site-chesscom-username').isDisabled(), true);
  assert.equal(requests.length, 0);
  await openGames();
  assert.equal(await page.locator('#username').inputValue(), 'ArchiveCat');

  console.log(stage = 'edits are saved on change without submitting');
  await page.locator('#username').fill('  ChangedCat  '); await page.locator('#username').press('Tab');
  await saved('chesscom', 'ChangedCat');
  assert.equal((await stored()).username, 'ChangedCat');
  await page.reload(); await ready(); await openGames();
  assert.equal(await page.locator('#username').inputValue(), 'ChangedCat');

  console.log(stage = 'provider switches retain unsent drafts independently');
  await page.locator('#username').fill('DraftCat');
  await page.locator('#game-source').selectOption('lichess');
  await saved('chesscom', 'DraftCat');
  assert.equal(await page.locator('#username').inputValue(), 'ArchiveOwl');
  await page.locator('#username').fill('DraftOwl');
  await page.locator('#game-source').selectOption('chesscom');
  await saved('lichess', 'DraftOwl');
  assert.equal(await page.locator('#username').inputValue(), 'DraftCat');
  assert.equal((await stored()).username, 'DraftCat', 'Lichess input must not replace the legacy Chess.com entry.');

  console.log(stage = 'failed archive lookup still remembers the entered username');
  await page.locator('#username').fill('FailedCat');
  await page.locator('#load-button').click();
  await page.waitForFunction(() => document.querySelector('#game-title').textContent === 'Could not load games' && !document.querySelector('#load-button').disabled);
  await saved('chesscom', 'FailedCat');
  assert(requests.some(value => value.includes('/player/failedcat/games/archives')));
  await page.reload(); await ready(); await openGames();
  assert.equal(await page.locator('#username').inputValue(), 'FailedCat');

  console.log(stage = 'an explicit blank survives reload and provider switching');
  await page.locator('#username').fill(''); await page.locator('#username').press('Tab');
  await saved('chesscom', '');
  assert.equal((await stored()).username, '');
  await page.locator('#game-source').selectOption('lichess');
  assert.equal(await page.locator('#username').inputValue(), 'DraftOwl');
  await page.locator('#game-source').selectOption('chesscom');
  assert.equal(await page.locator('#username').inputValue(), '');
  await page.reload(); await ready();
  assert.equal(await page.locator('#username').inputValue(), '');

  console.log(stage = 'saving in a stale tab preserves the other provider latest value');
  await worker.evaluate(() => chrome.storage.local.set({ usernames: { chesscom: '', lichess: 'NewerOtherTabOwl' } }));
  await openGames();
  await page.locator('#username').fill('LatestCat'); await page.locator('#username').press('Tab');
  await saved('chesscom', 'LatestCat');
  assert.equal((await stored()).usernames.lichess, 'NewerOtherTabOwl');
  assert.deepEqual((await stored()).siteReviewSettings, siteAccounts, 'Main-picker edits must not alter on-site account identity or enabled state.');

  console.log(stage = 'saved-review deep links restore the input without archive requests');
  const beforeDeepLink = requests.length;
  await page.goto(`${url}?reviewId=game-${'a'.repeat(64)}`); await ready();
  assert.equal(await page.locator('#username').inputValue(), 'LatestCat');
  assert.equal(requests.length, beforeDeepLink);

  console.log(stage = 'normal launch still loads the remembered provider');
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#game-title').textContent === 'Could not load games' && !document.querySelector('#load-button').disabled);
  assert.equal(await page.locator('#username').inputValue(), 'LatestCat');
  assert(requests.slice(beforeDeepLink).some(value => value.includes('/player/latestcat/games/archives')));

  console.log(stage = 'legacy username is a Chess.com fallback only');
  await worker.evaluate(async () => { await chrome.storage.local.remove('usernames'); await chrome.storage.local.set({ username: 'LegacyOnlyCat', reviewSettings: { source: 'lichess' } }); });
  await page.goto(`${url}?siteSettings=1`); await ready(); await openGames();
  assert.equal(await page.locator('#username').inputValue(), '');
  await page.locator('#game-source').selectOption('chesscom');
  assert.equal(await page.locator('#username').inputValue(), 'LegacyOnlyCat');
  await saved('lichess', '');

  console.log(stage = 'untouched normalized site defaults may use remembered picker names');
  await worker.evaluate(() => chrome.storage.local.set({ username: 'LegacyOnlyCat', usernames: { chesscom: 'PickerCat', lichess: 'PickerOwl' }, siteReviewSettings: { chesscom: { enabled: false, username: '' }, lichess: { enabled: false, username: '' } } }));
  await page.goto(`${url}?siteSettings=1`); await ready();
  assert.equal(await page.locator('#site-chesscom-username').inputValue(), 'pickercat');
  assert.equal(await page.locator('#site-lichess-username').inputValue(), 'pickerowl');

  console.log(stage = 'explicit blank picker entry is not replaced by legacy on-site fallback');
  await worker.evaluate(async () => { await chrome.storage.local.remove('siteReviewSettings'); await chrome.storage.local.set({ usernames: { chesscom: '', lichess: 'PickerOwl' } }); });
  await page.reload(); await ready();
  assert.equal(await page.locator('#site-chesscom-username').inputValue(), '');
  assert.equal(await page.locator('#site-lichess-username').inputValue(), 'pickerowl');

  console.log(stage = 'a modern provider map prevents legacy account leakage');
  await worker.evaluate(() => chrome.storage.local.set({ usernames: { lichess: 'OnlyOwl' } }));
  await page.reload(); await ready();
  assert.equal(await page.locator('#site-chesscom-username').inputValue(), '');
  assert.equal(await page.locator('#site-lichess-username').inputValue(), 'onlyowl');
  await worker.evaluate(() => chrome.storage.local.remove('usernames'));
  await page.reload(); await ready();
  assert.equal(await page.locator('#site-chesscom-username').inputValue(), 'legacyonlycat');
  assert.equal(await page.locator('#site-lichess-username').inputValue(), '');
  assert.deepEqual(errors, []);
  console.log('PASS username persistence: deep links, edit/change, failed lookup, provider drafts, explicit clear, stale-tab merge, legacy fallback, and on-site identity isolation.');
} catch (error) {
  if (page) { await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results', 'username-persistence-failure.png'), fullPage: true }).catch(() => {}); }
  throw new Error(`Username persistence failed at ${stage}: ${error.message}`, { cause: error });
} finally {
  await closeTestContext(context, profile, prefix);
  if (dirname(resolve(bundle)) === resolve(tmpdir()) && basename(bundle).startsWith(bundlePrefix)) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
