import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { openLibrary, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-companion-test-', bundlePrefix = 'MeowlChess-coach-companion-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const initialPreferences = { coach: 'meowl', perspective: 'both', motion: true, sounds: false, commentary: true, volume: 0.8, explanationLength: 'detailed' };
const errors = [], external = [];
let context, worker, page, stage = 'launch';
async function chooseCoach(id) {
  if (!await page.locator('.coach-picker').evaluate(details => details.open)) await page.locator('.coach-picker-summary').click();
  await page.locator(`.coach-choice[data-coach="${id}"]`).click();
}
async function poll(read, label, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Timed out: ${label}`);
}
const separated = (a, b) => a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1440, height: 1100 }, reducedMotion: 'no-preference', hasTouch: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    window.companionFixtureHide = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
    window.companionIdleBursts = 0; window.companionAudioContexts = 0;
    const NativeAudioContext = window.AudioContext;
    if (NativeAudioContext) window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.companionAudioContexts++; }
    };
    new MutationObserver(records => {
      for (const { target } of records) if (target.closest?.('#coach-companion') && target.dataset.reaction === 'idle') window.companionIdleBursts++;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-reaction'] });
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await worker.evaluate(async coachPreferences => chrome.storage.local.set({
    tutorialNeverShowAgain: true, supportNeverShowAgain: true,
    reviewSettings: { engine: 'lozza', time: '50', lines: '1', smart: false }, coachPreferences,
  }), initialPreferences);
  page = await context.newPage();
  await mkdir(join(root, 'test-results'), { recursive: true });
  const capture = name => page.screenshot({ path: join(root, 'test-results', `MeowlChess-coach-companion-${name}.png`), fullPage: true });
  const companion = page.locator('#coach-companion'), avatar = page.locator('#coach-companion-avatar');
  const greet = companion.locator('.coach-companion-greet');
  const bubble = page.locator('#coach-companion-bubble'), heading = page.locator('#coach-companion-heading');
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences);
  const idle = () => poll(async () => await companion.locator('.coach-actor[data-reaction]').count() === 0, 'companion returns idle', 4500);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const layout = async (width, custom = false) => {
    await page.setViewportSize({ width, height: width >= 1280 ? 1100 : 900 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const [mascot, rail, board, boardColumn, insights] = await Promise.all([
      avatar.boundingBox(), companion.boundingBox(), page.locator('#board').boundingBox(),
      page.locator('.board-column').boundingBox(), page.locator('.insights-column').boundingBox(),
    ]);
    assert(mascot && rail && board && boardColumn && insights, `All review regions have bounds at ${width}px.`);
    assert(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1), `No horizontal overflow at ${width}px${custom ? ' with 880px board setting' : ''}.`);
    for (const [label, bounds] of [['coach', rail], ['board', board], ['insights', insights]]) {
      assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${label} fits ${width}px.`);
    }
    assert(separated(mascot, board), `Coach does not overlap the board at ${width}px.`);
    assert(separated(rail, insights), `Coach is outside the right panel at ${width}px.`);
    assert(board.width <= 881, 'The custom board size remains bounded.');
    if (width >= 1280) {
      assert(mascot.width >= 200 && mascot.width <= 260, 'Desktop coach is approximately 220px.');
      assert(rail.x + rail.width <= boardColumn.x + 1, 'Desktop coach occupies the rail left of the board.');
    } else {
      assert(mascot.y >= board.y + board.height - 1, `Coach moves under the board at ${width}px.`);
      assert(mascot.width >= 110 && mascot.width <= 180, 'Narrow layout keeps a useful, compact portrait.');
    }
    return { mascot, rail, board, boardColumn, insights };
  };
  const ask = async question => {
    await page.locator('.coach-question').fill(question); await page.locator('.coach-send').click();
    await page.locator('.coach-message[data-role="coach"]').last().waitFor({ state: 'visible' });
  };
  const renderedAnimation = async () => {
    const canvas = companion.locator('.coach-reaction-puppet');
    await canvas.waitFor({ state: 'visible', timeout: 1200 });
    const painted = await canvas.evaluate(element => {
      const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      window.companionFrameProbe = { frame: Number(element.dataset.frame), pixels };
      return pixels.filter((value, index) => index % 4 === 3 && value > 32).length;
    });
    assert(painted > 100, 'External companion paints its original artwork.');
    await page.waitForFunction(() => {
      const before = window.companionFrameProbe;
      const canvas = document.querySelector('#coach-companion .coach-reaction-puppet');
      if (!canvas || Number(canvas.dataset.frame) <= before.frame) return false;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let changes = 0;
      for (let i = 0; i < pixels.length; i += 4) if ([0, 1, 2, 3].some(channel => Math.abs(pixels[i + channel] - before.pixels[i + channel]) > 16)) changes++;
      return changes >= 3;
    }, null, { timeout: 1000 });
    await page.evaluate(() => { delete window.companionFrameProbe; });
  };

  stage = 'real completed review and idle Summary companion';
  await page.goto(`${origin}/review.html`); await closeLibrary(page);
  assert.equal(await companion.isVisible(), false, 'No coach companion before a reviewed game.');
  await openLibrary(page); await page.locator('#demo-button').click(); await closeLibrary(page);
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
  await companion.waitFor({ state: 'visible' });
  assert.equal(await bubble.isVisible(), false, 'Summary leaves the coach idle without move hints.');
  assert.equal(await page.locator('#position-label').innerText(), 'Starting position');
  assert(await avatar.evaluate(image => image.complete && image.naturalWidth > 0));
  assert.equal(await avatar.evaluate(image => !!image.closest('.insights-column')), false, 'The avatar is outside the insights panel.');
  await layout(1440);

  stage = 'finite idle blink and keyboard greeting without sound';
  await poll(async () => await companion.locator('[data-reaction="idle"]').count() > 0, 'first idle blink after quiet delay', 8000);
  await renderedAnimation(); await idle();
  await delay(250);
  assert.equal(await companion.locator('.coach-reaction-puppet').count(), 0, 'Idle is a finite burst, not a continuous canvas loop.');
  assert.equal(await bubble.isVisible(), false, 'Idle movement does not reveal move commentary on Summary.');
  assert.match(await greet.getAttribute('aria-label'), /Play with Meowl/);
  await greet.focus(); await greet.press('Enter');
  assert.equal(await companion.locator('[data-reaction="play"]').count(), 1, 'Enter activates the native portrait play button.');
  await renderedAnimation();
  await companion.locator('.coach-reaction-puppet').evaluate(canvas => { window.greetingCanvasProbe = canvas; });
  await greet.evaluate(button => { button.click(); button.click(); }); await delay(50);
  assert(await page.evaluate(() => document.querySelector('#coach-companion .coach-reaction-puppet') === window.greetingCanvasProbe), 'Rapid greetings do not restart the current animation.');
  await page.evaluate(() => { delete window.greetingCanvasProbe; }); await idle();
  assert.equal(await page.evaluate(() => window.companionAudioContexts), 0, 'Default silent greetings and idle never allocate audio.');

  stage = 'idle stays stopped while hidden or disabled';
  await page.evaluate(() => window.companionFixtureHide(true));
  const hiddenIdleCount = await page.evaluate(() => window.companionIdleBursts);
  await delay(6300);
  assert.equal(await page.evaluate(() => window.companionIdleBursts), hiddenIdleCount, 'Hidden documents do not start an idle burst.');
  assert.equal(await companion.locator('.coach-reaction-puppet').count(), 0);
  await page.evaluate(() => window.companionFixtureHide(false));
  await page.locator('#coach-tab').click();
  await page.locator('.coach-settings-summary').click();
  await page.locator('.coach-motion-toggle').uncheck();
  await poll(async () => (await stored()).motion === false, 'disabled animations saved');
  const disabledIdleCount = await page.evaluate(() => window.companionIdleBursts);
  await delay(6300);
  assert.equal(await page.evaluate(() => window.companionIdleBursts), disabledIdleCount, 'Disabled animations do not start an idle burst.');
  assert.equal(await companion.locator('.coach-reaction-puppet').count(), 0);
  await page.locator('.coach-motion-toggle').check();
  await poll(async () => (await stored()).motion === true, 'animations restored');

  stage = 'external Coach chat reaction and stable board';
  await page.locator('#coach-tab').click();
  await page.locator('.coach-settings-summary').click();
  await page.evaluate(() => scrollTo(0, 0));
  const beforeChat = await page.locator('#board').boundingBox();
  await ask('Summarize this game'); await renderedAnimation();
  assert.equal(await page.locator('#coach-root .coach-heading .coach-actor[data-reaction]').count(), 0, 'The hidden old header is not the speaking actor.');
  // Compare layout at the same scroll position, after form focus scrolled the page.
  await page.evaluate(() => scrollTo(0, 0));
  const afterChat = await page.locator('#board').boundingBox();
  for (const property of ['x', 'y', 'width', 'height']) assert(Math.abs(beforeChat[property] - afterChat[property]) < 1, `Chat animation keeps board ${property} stable.`);
  await idle();
  stage = 'filled chat keeps mid-width companion near the board';
  await ask('Summarize this game'); await ask('Summarize this game'); await idle();
  const filled = await layout(1100);
  const companionGap = filled.rail.y - filled.boardColumn.y - filled.boardColumn.height;
  assert(companionGap >= -1 && companionGap <= 40, `Filled chat leaves a compact board-to-coach gap at1100px (actual ${companionGap.toFixed(1)}px).`);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await chooseCoach('paws');
  await poll(async () => (await stored()).coach === 'paws', 'coach choice saved');
  await poll(async () => (await avatar.getAttribute('src')).endsWith('/MeowlChess-coach-paws.svg'), 'external portrait follows selected coach');

  stage = 'automatic Moves comment is external and responsive';
  await page.locator('#moves-tab').click(); await page.locator('#next-button').click();
  await poll(async () => await bubble.isVisible() && /1\.\s*f3/.test(await heading.innerText()), 'first move in companion bubble');
  assert.equal(await bubble.evaluate(element => !!element.closest('.insights-column')), false, 'Automatic explanation is outside the right panel.');
  assert.equal(await page.locator('#coach-root .coach-walkthrough').isVisible(), false, 'No duplicate walkthrough inside chat.');
  await idle();
  await layout(1440); await capture('desktop-1440');
  await layout(1920); await capture('desktop-1920');
  for (const width of [1100, 920, 375, 320]) {
    await layout(width);
    if (width === 375 || width === 320) await capture(`mobile-${width}`);
  }
  stage = 'mobile greeting and volume controls';
  assert.match(await greet.getAttribute('aria-label'), /Captain Paws/);
  await greet.tap();
  assert.equal(await companion.locator('[data-reaction="play"]').count(), 1, 'A touch tap plays with the selected coach.');
  await renderedAnimation(); await idle();
  await page.locator('#coach-tab').click();
  await page.locator('.coach-settings-summary').click();
  assert(await page.locator('.coach-volume-controls').isVisible());
  assert(await page.locator('.coach-sound-preview').isDisabled(), 'Visible volume does not bypass sound opt-in.');
  await page.locator('.coach-sound-toggle').check();
  assert.equal(await page.locator('.coach-volume').inputValue(), '80');
  assert.equal(await page.locator('.coach-volume-value').textContent(), '80%');
  for (const selector of ['.coach-volume-controls', '.coach-volume', '.coach-sound-preview']) {
    const bounds = await page.locator(selector).boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321, `${selector} fits320px.`);
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await capture('mobile-volume-320');
  await page.locator('.coach-sound-toggle').uncheck();
  await poll(async () => (await stored()).sounds === false, 'silent preference restored');
  await page.locator('#moves-tab').click();

  stage = 'custom board size clamps across all layouts';
  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.locator('#review-settings > summary').click();
  await page.locator('#board-size').evaluate(input => { input.value = '880'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#review-settings > summary').click();
  for (const width of [1920, 1440, 1100, 920, 375, 320]) await layout(width, true);
  await poll(() => worker.evaluate(async () => (await chrome.storage.local.get('reviewSettings')).reviewSettings?.boardSize === 880), 'board preference saved');
  assert.deepEqual(await stored(), { ...initialPreferences, coach: 'paws' }, 'Changing layout and board size preserves all coach preferences.');

  stage = 'Summary and practice suppress narration';
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#summary-tab').click();
  assert(await companion.isVisible()); assert.equal(await bubble.isVisible(), false);
  await idle();
  await page.locator('#moves-tab').click(); await page.locator('#last-button').click();
  await poll(async () => await bubble.isVisible() && await heading.locator('.move-notation[data-san="Qh4#"]').count() === 1, 'current last move replaces earlier explanation');
  await page.locator('#retry-move').click();
  assert(await companion.isVisible(), 'Practice retains the idle coach artwork.');
  assert.equal(await bubble.isVisible(), false, 'Practice hides the current move hint.');
  assert(await greet.isDisabled(), 'Practice disables the greeting action.');
  const practiceIdleCount = await page.evaluate(() => window.companionIdleBursts);
  await delay(6300);
  assert.equal(await page.evaluate(() => window.companionIdleBursts), practiceIdleCount, 'Practice does not restart idle motion.');
  assert.equal(await companion.locator('.coach-actor[data-reaction], .coach-reaction-puppet').count(), 0, 'Practice cannot resurrect pending narration or animation.');
  await page.locator('#retry-exit').click();
  await page.locator('#practice-tab').click();
  assert.equal(await bubble.isVisible(), false, 'Practice notebook also hides narration.');
  assert.deepEqual(await stored(), { ...initialPreferences, coach: 'paws' });
  assert.deepEqual(external, [], 'Companion behavior remains fully local.');
  assert.deepEqual(errors, [], 'No page errors.');
  console.log('PASS: external coach layout, actual puppet animation, automatic move comments, responsive sizing, board clamp, preferences and practice privacy');
} catch (error) {
  console.error(`Coach companion failed during ${stage}:`, error);
  if (page) await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-companion-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) !== temporaryRoot || !basename(absolute).startsWith(bundlePrefix)) throw new Error('Unsafe cleanup path.');
  await rm(absolute, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
