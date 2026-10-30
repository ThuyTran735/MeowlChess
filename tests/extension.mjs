import assert from 'node:assert/strict';
import { openLibrary, closeLibrary, openImport, openMoves, openEngine, openSummary, closeTestContext } from './ui-helpers.mjs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

// Load the actual extension in a disposable browser profile. CHROMIUM_PATH can
// select Brave or another Chromium build that supports unpacked-extension flags.
// LIVE_API_USERNAME and LIVE_LICHESS_USERNAME optionally exercise real public archives.
const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-extension-test-'));
const expectedVersion = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')).version;
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: process.env.HEADED_EXT_TEST !== '1',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.env.HEADED_EXT_TEST === '1' ? ['--start-minimized'] : [])]
  });
  const worker = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) ||
    await context.waitForEvent('serviceworker', { timeout: 15000, predicate: worker => worker.url().startsWith('chrome-extension://') });
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();

  async function ensureSettingsOpen() {
    await closeLibrary(page);
    if (!await page.locator('#review-settings').evaluate(details => details.open)) await page.locator('#review-settings > summary').click();
  }
  async function ensureSettingsClosed() {
    await closeLibrary(page);
    if (await page.locator('#review-settings').evaluate(details => details.open)) await page.locator('#review-settings > summary').click();
  }
  async function selectReviewOption(id, value) {
    await ensureSettingsOpen();
    await page.locator('#' + id).selectOption(value);
  }
  async function setReviewToggle(id, checked) {
    await ensureSettingsOpen();
    await page.locator('#' + id).setChecked(checked);
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/review.html`);
  await page.waitForFunction(() => document.querySelectorAll('#board .piece').length === 32);
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().version), expectedVersion);
  await page.waitForFunction(() => [...document.querySelectorAll('#board .piece')].every(piece => piece.complete && piece.naturalWidth > 0));
  assert.equal(await page.locator('#review-settings').evaluate(details => details.open), false);
  await openLibrary(page);
  await page.locator('#demo-button').click();
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  assert.equal(await page.locator('#move-list .move-badge').count(), 4);
  assert.equal(await page.locator('.board-move-badge').count(), 0);
  assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('#position-label').innerText(), /starting/i);
  assert.match(await page.locator('#review-status').innerText(), /complete/i);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 3);
  assert.equal(await page.locator('#arrow-mode').inputValue(), 'best');
  assert.equal(await page.locator('#smart-analysis').isChecked(), true);
  assert.equal(await page.locator('#board .engine-arrow').count(), 1);
  await page.locator('#engine-lines .engine-line').nth(1).hover();
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '2');
  await page.locator('#game-title').hover();
  assert.equal(await page.locator('#board .engine-arrow').getAttribute('data-rank'), '1');
  await selectReviewOption('arrow-mode', 'all');
  await setReviewToggle('smart-analysis', false);
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  await page.waitForFunction(() => [...document.querySelectorAll('.move-badge img')].every(image => image.complete && image.naturalWidth > 0));

  // Preferences survive reloading the real extension page via chrome.storage.
  await ensureSettingsOpen();
  await selectReviewOption('depth', '500');
  await selectReviewOption('multipv', '2');
  await setReviewToggle('show-arrows', false);
  await setReviewToggle('show-badges', false);
  await setReviewToggle('show-coordinates', false);
  await selectReviewOption('play-speed', '2000');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#depth').value === '500' && document.querySelector('#multipv').value === '2');
  assert.equal(await page.locator('#arrow-mode').inputValue(), 'all');
  assert.equal(await page.locator('#smart-analysis').isChecked(), false);
  assert.equal(await page.locator('#show-arrows').isChecked(), false);
  assert.equal(await page.locator('#show-badges').isChecked(), false);
  assert.equal(await page.locator('#show-coordinates').isChecked(), false);
  assert.equal(await page.locator('#play-speed').inputValue(), '2000');
  assert.equal(await page.locator('#board .coordinate').count(), 0);
  assert.equal(await page.locator('#board .engine-arrow').count(), 0);
  await ensureSettingsOpen();
  // Engine, source, and the new Fast preference survive real extension storage.
  await selectReviewOption('engine', 'lozza');
  await selectReviewOption('depth', '50');
  await openLibrary(page);
  await page.locator('#game-source').selectOption('lichess');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#engine').value === 'lozza' && document.querySelector('#depth').value === '50' && document.querySelector('#game-source').value === 'lichess');
  assert.equal(await page.locator('#multipv').inputValue(), '1');
  assert.equal(await page.locator('#multipv').isDisabled(), true);
  await openLibrary(page);
  await page.locator('#demo-button').click();
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  assert.equal(await page.locator('#engine-lines .engine-line').count(), 1);
  assert.match(await page.locator('#engine-status').innerText(), /Lozza/);
  await openEngine(page);
  await page.locator('#quick-position').click();
  await page.waitForFunction(() => !document.querySelector('#quick-position').disabled);
  assert.match(await page.locator('#engine-status').innerText(), /Lozza.*Position search/);
  await selectReviewOption('engine', 'stockfish');
  await openLibrary(page);
  await page.locator('#game-source').selectOption('chesscom');
  await ensureSettingsOpen();
  await selectReviewOption('depth', '150');
  await selectReviewOption('multipv', '3');
  await setReviewToggle('show-arrows', true);
  await setReviewToggle('show-badges', true);
  await setReviewToggle('show-coordinates', true);
  await openLibrary(page);
  await page.locator('#demo-button').click();
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden && !document.querySelector('#analyze-button').disabled);
  if (!await page.locator('#first-button').isDisabled()) await page.locator('#first-button').click();
  await openEngine(page);
  assert.equal(await page.locator('#board .engine-arrow').count(), 3);
  await ensureSettingsClosed();
  await page.locator('#summary-tab').click();
  assert.equal(await page.locator('#summary').isVisible(), true);
  assert.equal(await page.locator('.engine-panel').isVisible(), false);
  await page.locator('#moves-tab').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#moves-panel').isVisible(), true);
  assert.equal(await page.locator('#summary-panel').isVisible(), false);
  await page.locator('#move-list .move-button').nth(1).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#board img')].every(image => image.complete && image.naturalWidth > 0));
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'review-engine-arrows.png'), fullPage: true });
  console.log(`Actual extension passed: v${expectedVersion}, service worker, Neo PNG/SVG assets, Stockfish MultiPV and Lozza analysis, arrows, move badges, and persisted engine/source/speed settings.`);

  if (process.env.LIVE_API_USERNAME) {
    const username = process.env.LIVE_API_USERNAME;
    await openLibrary(page);
    await page.locator('#username').fill(username);
    await page.locator('#load-button').click();
    await page.waitForFunction(() => !document.querySelector('#load-button').disabled);
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    const count = await page.locator('.game-card').count();
    assert(count > 0, 'Live API returned no recent completed standard games for the requested username.');
    assert(await page.locator('.move-button').count() > 0, 'The retrieved completed game did not load into the review board.');
    assert.equal(await page.evaluate(() => chrome.storage.local.get('username')).then(result => result.username), username);
    console.log(`Live extension retrieval passed: ${count} completed games; first game opened; username preference saved locally.`);
  } else {
    console.log('Live API lookup skipped. Set LIVE_API_USERNAME to exercise unmocked retrieval.');
  }
  if (process.env.LIVE_LICHESS_USERNAME) {
    await openLibrary(page);
    await page.locator('#game-source').selectOption('lichess');
    await openLibrary(page);
    await page.locator('#username').fill(process.env.LIVE_LICHESS_USERNAME);
    await page.locator('#load-button').click();
    await page.waitForFunction(() => !document.querySelector('#load-button').disabled);
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    const count = await page.locator('.game-card').count();
    assert(count > 0, 'Live Lichess API returned no completed standard games.');
    assert(await page.locator('.move-button').count() > 0, 'The Lichess archive game did not open.');
    const originalUrl = await page.locator('#game-subtitle a').getAttribute('href');
    assert.match(originalUrl, /^https:\/\/lichess\.org\/[a-zA-Z0-9]{8}$/);
    await openLibrary(page);
    await page.locator('#username').fill(originalUrl);
    await page.locator('#load-button').click();
    await page.waitForFunction(() => !document.querySelector('#load-button').disabled);
    assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
    assert.equal(await page.locator('.game-card').count(), 1);
    assert.equal(await page.locator('#game-subtitle a').getAttribute('href'), originalUrl);
    assert(await page.locator('.move-button').count() > 0);
    console.log(`Live Lichess extension retrieval passed: ${count} completed archive games and a finished game URL opened through extension host permissions.`);
  } else {
    console.log('Live Lichess lookup skipped. Set LIVE_LICHESS_USERNAME to exercise unmocked retrieval.');
  }
  assert.deepEqual(errors, []);
} finally {
  await closeTestContext(context, profile, 'meowlchess-extension-test-');
}
