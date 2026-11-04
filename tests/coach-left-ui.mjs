import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { openImport, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temp = resolve(tmpdir());
const profilePrefix = 'MeowlChess-left-coach-profile-', bundlePrefix = 'MeowlChess-left-coach-bundle-';
const profile = await mkdtemp(join(temp, profilePrefix)), bundle = await mkdtemp(join(temp, bundlePrefix));
const extension = join(bundle, 'extension'), errors = [];
let context, page, stage = 'startup';
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH, headless: true, viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/review.html`);
  await openImport(page);
  await page.locator('#pgn-text').fill('[White "Cedar"]\n[Black "Juniper"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2');
  await page.locator('#import-button').click(); await closeLibrary(page);
  await page.locator('#review-settings > summary').click();
  await page.locator('#depth').selectOption('50');
  const smart = page.locator('#smart-analysis'); if (await smart.count()) await smart.uncheck();
  await page.locator('#review-settings > summary').click();
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent), null, { timeout: 60000 });
  stage = 'left card and summary entry';
  const card = page.locator('#coach-companion'), select = page.locator('.coach-companion-choice');
  assert(await card.isVisible()); assert(await page.locator('.coach-companion-ask').isVisible());
  const cardBox = await card.boundingBox(), boardBox = await page.locator('#board').boundingBox();
  assert(cardBox.x + cardBox.width < boardBox.x, 'Desktop coach sits fully to the left of the board.');
  assert(cardBox.width >= 250, 'The coach has a usable dedicated column.');
  await select.selectOption('scout');
  await page.waitForFunction(() => document.querySelector('.coach-companion').dataset.coach === 'scout');
  assert.equal(await page.locator('.coach-choice[data-coach="scout"]').getAttribute('aria-pressed'), 'true');
  await page.locator('.coach-companion-ask').click();
  assert.equal(await page.locator('#coach-tab').getAttribute('aria-selected'), 'true');
  assert(await page.locator('.coach-message[data-role="coach"]').count());
  stage = 'quick controls and settings';
  const tips = page.getByRole('button', { name: 'Automatic move tips', exact: true });
  await tips.click(); assert.equal(await tips.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.coach-commentary-toggle').isChecked(), false);
  await tips.click();
  await page.getByRole('button', { name: 'Meow sounds', exact: true }).click();
  assert.equal(await page.locator('.coach-sound-toggle').isChecked(), true);
  await page.getByRole('button', { name: 'Meow sounds', exact: true }).click();
  await page.getByRole('button', { name: 'Open coach settings', exact: true }).click();
  assert.equal(await page.locator('.coach-settings').evaluate(el => el.open), true);
  assert.equal(await page.locator('.coach-settings-summary').evaluate(el => el === document.activeElement), true);
  await page.locator('.coach-settings-summary').click();
  await select.selectOption('meowl');
  await page.locator('#moves-tab').click(); await page.locator('#next-button').click(); await page.locator('#next-button').click();
  await page.locator('.coach-companion-bubble').waitFor({ state: 'visible' });
  await mkdir(join(root, 'test-results'), { recursive: true });
  stage = 'responsive card';
  for (const width of [1600, 1366, 1280, 1100, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal overflow at ${width}px.`);
    for (const selector of ['.coach-companion', '.coach-companion-choice', '.coach-companion-bubble', '.coach-companion-ask']) {
      const box = await page.locator(selector).boundingBox();
      assert(box && box.x >= -1 && box.x + box.width <= width + 1, `${selector} fits ${width}px.`);
    }
    if (width === 1600 || width === 375) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(root, 'test-results', `MeowlChess-left-coach-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Coach card placement, selectors, quick controls, chat entry and responsive layout passed.');
} catch (error) {
  if (page) { await mkdir(join(root, 'test-results'), { recursive: true }); await page.screenshot({ path: join(root, 'test-results/MeowlChess-left-coach-failure.png'), fullPage: true }).catch(() => {}); }
  throw new Error(`${stage}: ${error.message}`, { cause: error });
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) === temp && basename(absolute).startsWith(bundlePrefix)) await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
}
