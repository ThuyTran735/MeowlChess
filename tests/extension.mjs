import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

// Load the actual extension in a disposable browser profile. CHROMIUM_PATH can
// select Brave or another Chromium build that supports unpacked-extension flags.
// LIVE_API_USERNAME optionally enables a real, unmocked archive lookup.
const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-extension-test-'));
const expectedVersion = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')).version;
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) ||
    await context.waitForEvent('serviceworker', { timeout: 15000, predicate: worker => worker.url().startsWith('chrome-extension://') });
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/review.html`);
  await page.waitForFunction(() => document.querySelectorAll('#board .piece').length === 32);
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().version), expectedVersion);
  await page.waitForFunction(() => [...document.querySelectorAll('#board .piece')].every(piece => piece.complete && piece.naturalWidth > 0));
  await page.locator('#demo-button').click();
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('#summary').hidden);
  assert.equal(await page.locator('#move-list .move-badge').count(), 4);
  assert.equal(await page.locator('.board-move-badge').count(), 1);
  assert.match(await page.locator('#review-status').innerText(), /complete/i);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'review-extension.png'), fullPage: true });
  console.log(`Actual extension passed: v${expectedVersion}, service worker, local SVG assets, WASM analysis, and move badges.`);

  if (process.env.LIVE_API_USERNAME) {
    const username = process.env.LIVE_API_USERNAME;
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
  assert.deepEqual(errors, []);
} finally {
  await Promise.all((context?.pages() || []).map(page => page.close({ runBeforeUnload: false })));
  await context?.close();
  // Delete only the exact disposable profile generated above, never a user profile.
  if (dirname(profile) === temporaryRoot && basename(profile).startsWith('meowlchess-extension-test-')) {
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
