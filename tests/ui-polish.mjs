import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { openImport, openLibrary, openMoves, openSummary, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-polish-test-'));
const pgn = '[Event "Interactive review"]\n[White "White player"]\n[Black "Black player"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 11. Qf3 Be7 12. Rfe1 Be6 13. Rad1 Qc7 14. Kh1 Kh8 15. Re2 Rfe8 1/2-1/2';
let context, page, stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const external = [], errors = [];
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(join(root, 'test-results'), { recursive: true });
  const capture = name => page.screenshot({ path: join(root, 'test-results', `polish-${name}.png`), fullPage: true });
  const fen = () => page.locator('#board').getAttribute('aria-label');
  const activePly = async () => Number(await page.locator('#move-list .move-button.active').getAttribute('data-ply'));
  const noOverflow = async name => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} has horizontal page overflow.`);
  const review = async () => {
    await page.locator('#analyze-button').click();
    await page.waitForFunction(() => /Review complete/.test(document.querySelector('#review-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
    assert.equal(await page.locator('#summary-panel').isVisible(), true);
    assert.equal(await page.locator('#position-label').innerText(), 'Starting position');
  };
  const chooseRating = async () => {
    await openSummary(page);
    const counts = await page.locator('.rating-count').evaluateAll(items => items.map(item => ({ count: Number(item.textContent), color: item.dataset.color, label: item.dataset.label, disabled: item.disabled })));
    assert(counts.some(item => item.count === 0), 'Fixture must include empty ratings.');
    for (const count of counts) assert.equal(count.disabled, count.count === 0);
    const chosen = counts.toSorted((a, b) => b.count - a.count)[0];
    assert(chosen.count >= 2, 'Fixture needs several moves sharing a rating.');
    const expected = await page.locator('#move-list .move-button').evaluateAll((buttons, { color, label }) => buttons.filter(button => {
      const name = button.getAttribute('aria-label');
      return name.includes(color === 'w' ? ', White:' : ', Black:') && name.endsWith(`, ${label}`);
    }).map(button => Number(button.dataset.ply)), chosen);
    assert.equal(expected.length, chosen.count, 'Summary count must agree with move-list ratings.');
    await page.locator(`.rating-count[data-color="${chosen.color}"][data-label="${chosen.label}"]`).click();
    assert.equal(await page.locator('#moves-panel').isVisible(), true);
    assert.equal(await activePly(), expected[0]);
    assert.equal(await page.locator('#rating-focus-label').innerText(), `${chosen.color === 'w' ? 'White' : 'Black'} · ${chosen.label}`);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'moves-tab', 'Focus must move to the visible tab after activating a summary count.');
    assert.deepEqual(await page.locator('.move-button.rating-match').evaluateAll(buttons => buttons.map(button => Number(button.dataset.ply))), expected);
    return { chosen, expected };
  };
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/review.html`);
  await openImport(page); await page.locator('#pgn-text').fill(pgn); await page.locator('#import-button').click();
  await closeLibrary(page);
  await page.locator('#review-settings > summary').click();
  await page.locator('#engine').selectOption('stockfish'); await page.locator('#depth').selectOption('50');
  await page.locator('#multipv').selectOption('1'); await page.locator('#smart-analysis').uncheck();
  await page.locator('#review-settings > summary').click();

  stage = 'summary count navigation';
  await review();
  for (const height of [900, 768]) {
    await page.setViewportSize({ width: 1366, height });
    await page.evaluate(() => scrollTo(0, 0));
    const bounds = await page.locator('.board-controls').boundingBox();
    assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `Board controls must fit the ${height}px desktop viewport without scrolling: ${JSON.stringify(bounds)}`);
    const last = await page.locator('#last-button').boundingBox();
    assert(last && last.x >= 0 && last.x + last.width <= 1367 && last.y + last.height <= height + 1, 'Last-position control must remain on screen.');
    await noOverflow(`Desktop ${height}px summary`);
    await capture(`summary-desktop-${height}`);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await capture('summary-desktop');
  const { expected } = await chooseRating();
  assert.equal(await page.locator('#previous-key').isDisabled(), true);
  for (let index = 1; index < expected.length; index++) {
    await page.locator('#next-key').click(); assert.equal(await activePly(), expected[index]);
    assert.equal(await page.locator('#key-moments-label').innerText(), `${index + 1} / ${expected.length} moves`);
  }
  assert.equal(await page.locator('#next-key').isDisabled(), true);
  await page.locator('#previous-key').click(); assert.equal(await activePly(), expected.at(-2));
  await capture('rating-desktop');
  await page.locator('#clear-rating-focus').click();
  assert.equal(await page.locator('#rating-focus').isVisible(), false);
  assert.equal(await page.locator('.move-button.rating-match').count(), 0);
  assert.equal(await page.locator('#key-moments-label').innerText(), 'Key moments');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'moves-tab');
  console.log('PASS: real analysis counts, disabled zero totals, rating jumps, matched navigation, clearing and focus');

  stage = 'chart preview and keyboard tabs';
  await page.locator('#moves-tab').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
  const beforeHover = await fen();
  const point = page.locator('.chart-hit button[data-ply="7"]');
  await point.hover(); assert.equal(await page.locator('#chart-readout').innerText(), await point.getAttribute('aria-label'));
  assert.equal(await fen(), beforeHover, 'Hovering the graph must not change the position.');
  await page.locator('#game-title').hover(); assert.equal(await page.locator('#chart-readout').innerText(), 'White’s advantage ↑');
  await point.focus(); assert.equal(await page.locator('#chart-readout').innerText(), await point.getAttribute('aria-label'));
  await point.press('Enter'); assert.equal(await activePly(), 7);
  await page.locator('#moves-tab').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#practice-tab').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home'); assert.equal(await page.locator('#summary-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#summary-panel').evaluate(el => getComputedStyle(el).animationName), 'none');
  console.log('PASS: graph hover/focus previews without navigation, graph activation, keyboard tabs, reduced motion');

  stage = 'responsive layout and motion';
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow('Mobile summary'); await capture('summary-mobile');
  await chooseRating(); await noOverflow('Mobile rating selection'); await capture('rating-mobile');
  await page.locator('#review-settings > summary').click(); await noOverflow('Mobile settings'); await capture('settings-mobile');
  await page.locator('#review-settings > summary').click();
  await openLibrary(page); await noOverflow('Mobile games dialog'); await capture('games-mobile'); await closeLibrary(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSummary(page);
  assert.equal(await page.locator('#summary-panel').evaluate(el => getComputedStyle(el).animationName), 'review-reveal');
  await page.waitForFunction(() => !document.querySelector('#summary-panel').getAnimations().some(animation => animation.playState === 'running'));
  assert.equal(await page.locator('#summary-panel').evaluate(el => getComputedStyle(el).opacity), '1');
  await openLibrary(page);
  await page.waitForFunction(() => !document.querySelector('#library-dialog').getAnimations().some(animation => animation.playState === 'running'));
  assert.equal(await page.locator('#library-dialog').evaluate(el => getComputedStyle(el).opacity), '1'); await capture('games-desktop'); await closeLibrary(page);
  console.log('PASS: desktop/mobile summary, rating, settings and game picker fit; entrance transitions finish');

  stage = 'selection resets';
  await chooseRating(); await review();
  await openMoves(page); assert.equal(await page.locator('#rating-focus').isVisible(), false);
  assert.equal(await page.locator('.move-button.rating-match').count(), 0);
  await chooseRating(); await openLibrary(page); await page.locator('#demo-button').click();
  assert.equal(await page.locator('#rating-focus').isVisible(), false);
  assert.equal(await page.locator('.move-button.rating-match').count(), 0);
  assert.equal(await page.locator('#key-moments-label').innerText(), 'Key moments');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: re-review and changing games clear rating selections; no page errors or external requests');
} catch (error) {
  if (page) await page.screenshot({ path: join(root, 'test-results', 'polish-failure.png'), fullPage: true }).catch(() => {});
  console.error(`FAILED at ${stage}`); throw error;
} finally {
  await closeTestContext(context, profile, 'meowlchess-polish-test-');
}
