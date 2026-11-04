import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-board-size-drag-test-', bundlePrefix = 'MeowlChess-board-size-drag-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const probeOnly = process.argv.includes('--probe-only');
let context, page, worker, stage = 'launch';
const errors = [], traces = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(read, label) {
  const started = Date.now();
  while (Date.now() - started < 5000) { if (await read()) return; await delay(25); }
  throw new Error(`Timed out: ${label}`);
}

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  context.on('page', target => target.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => route.abort());
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ reviewSettings: { boardSize: 320 } }));
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage();
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('reviewSettings')).reviewSettings);
  const settings = async () => {
    await closeLibrary(page);
    if (!await page.locator('#review-settings').evaluate(details => details.open)) await page.locator('#review-settings > summary').click();
    await page.locator('#board-size').scrollIntoViewIfNeeded();
  };
  const fit = async label => {
    const info = await page.evaluate(() => {
      const board = document.querySelector('#board').getBoundingClientRect();
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, x: board.x, right: board.right, width: board.width, preferred: document.querySelector('#board-size').value };
    });
    assert(info.scroll <= info.viewport + 1, `${label}: page fits horizontally`);
    assert(info.x >= -1 && info.right <= info.viewport + 1, `${label}: board fits viewport`);
    return info;
  };
  const drag = async (from, to, label) => {
    await settings();
    const input = page.locator('#board-size');
    assert.equal(Number(await input.inputValue()), from);
    const bounds = await input.boundingBox(), track = bounds.width - 16;
    const point = value => bounds.x + 8 + (value - 320) / 560 * track;
    await page.mouse.move(point(from), bounds.y + bounds.height / 2);
    await page.mouse.down();
    const samples = [];
    for (let index = 1; index <= 28; index++) {
      await page.mouse.move(point(from + (to - from) * index / 28), bounds.y + bounds.height / 2);
      await delay(18);
      samples.push(await input.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { value: Number(element.value), x: rect.x, y: rect.y, width: rect.width };
      }));
    }
    await page.mouse.up();
    const maxTrackMovement = Math.max(...samples.map(sample => Math.max(Math.abs(sample.x - bounds.x), Math.abs(sample.y - bounds.y), Math.abs(sample.width - bounds.width))));
    traces.push({ label, from, to, maxTrackMovement, samples });
    if (!probeOnly) {
      assert(maxTrackMovement <= 1.5, `${label}: slider track moved ${maxTrackMovement}px during the drag`);
      for (let index = 1; index < samples.length; index++) {
        assert((samples[index].value - samples[index - 1].value) * Math.sign(to - from) >= 0, `${label}: value reversed while dragging in one direction`);
      }
      assert.equal(Number(await input.inputValue()), to, `${label}: pointer can reach the requested endpoint`);
      await poll(async () => (await stored()).boardSize === to, `${label}: final preferred size saved`);
    }
  };

  await page.goto(`${origin}/review.html`); await settings();
  stage = 'continuous desktop pointer drag';
  await drag(320, 880, 'desktop growing');
  if (probeOnly) {
    console.log(JSON.stringify(traces.map(({ samples, ...trace }) => ({ ...trace, values: samples.map(sample => sample.value) }))));
  } else {
    assert(Math.abs((await fit('large desktop board')).width - 880) < 2);
    await drag(880, 320, 'desktop shrinking');
    assert(Math.abs((await fit('small desktop board')).width - 320) < 2);

    stage = 'keyboard and reload persistence';
    const fen = await page.locator('#board').getAttribute('aria-label');
    await page.locator('#board-size').focus(); await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#board-size').inputValue(), '840');
    await poll(async () => (await stored()).boardSize === 840, 'keyboard value saved');
    assert.equal(await page.locator('#board').getAttribute('aria-label'), fen, 'Range keys never navigate game positions.');
    await page.reload(); await settings();
    assert.equal(await page.locator('#board-size').inputValue(), '840');
    // Explicitly focus the range again after reload and scrolling.
    await page.locator('#board-size').focus(); await page.keyboard.press('End');
    await poll(async () => (await stored()).boardSize === 880, 'large preference saved');

    stage = 'responsive clamp preserves the chosen width';
    for (const width of [768, 375, 320, 1600]) {
      await page.setViewportSize({ width, height: 1100 }); await delay(60);
      const info = await fit(`${width}px viewport`);
      assert.equal(info.preferred, '880'); assert.equal((await stored()).boardSize, 880);
      if (width === 1600) assert(Math.abs(info.width - 880) < 2, 'Preferred size returns on a wide viewport.');
    }
    stage = 'continuous pointer drag in stacked layout';
    await page.setViewportSize({ width: 768, height: 1100 });
    await drag(880, 320, 'stacked shrinking'); await drag(320, 880, 'stacked growing');
    await fit('stacked final board');

    stage = 'Auto applies and persists';
    await page.locator('#board-size-auto').click();
    await poll(async () => (await stored()).boardSize === 'auto', 'Auto saved');
    assert.equal(await page.locator('#board-size-value').innerText(), 'Auto');
    assert.equal(await page.locator('html').getAttribute('data-board-size'), 'auto');
    await page.reload(); await settings();
    assert.equal(await page.locator('#board-size-value').innerText(), 'Auto');
    await fit('Auto after reload');
    assert.deepEqual(errors, []);
    console.log('PASS: stable continuous dragging, keyboard isolation, persisted preference, responsive resize, and Auto.');
  }
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(join(root, 'test-results', `MeowlChess-board-size-drag${probeOnly ? '-before' : ''}.json`), JSON.stringify(traces, null, 2));
} catch (error) {
  console.error(`Board size failed during ${stage}:`, error);
  console.error('Page errors:', errors);
  if (page) {
    await mkdir(join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-board-size-drag-failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (context) await closeTestContext(context, profile, profilePrefix);
  for (const [directory, prefix] of [[profile, profilePrefix], [bundle, bundlePrefix]]) {
    const target = resolve(directory);
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup path.');
    await rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  }
}
