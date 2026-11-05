import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeLibrary, openLibrary, openMoves, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-rating-explanation-test-', bundlePrefix = 'MeowlChess-rating-explanation-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const errors = [], external = [];
let context, page, stage = 'launch';
const plainText = locator => locator.evaluate(node => {
  const clone = node.cloneNode(true);
  for (const notation of clone.querySelectorAll('.move-notation')) notation.replaceWith(notation.dataset.san);
  return clone.textContent;
});

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await mkdir(join(root, 'test-results'), { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.ratingEngineStarts = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.ratingEngineStarts++; } };
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await worker.evaluate(async () => chrome.storage.local.set({
    tutorialNeverShowAgain: true, supportNeverShowAgain: true,
    reviewSettings: { engine: 'lozza', time: '50', lines: '1', smart: false, highlights: false },
  }));
  page = await context.newPage();
  const dialog = page.locator('#rating-dialog');
  const heading = page.locator('#insight-explain');
  const moveButton = ply => page.locator(`.move-button[data-ply="${ply}"]`);
  const ratingButton = ply => page.locator(`.move-rating-button[data-ply="${ply}"]`);
  const capture = name => page.screenshot({ path: join(root, 'test-results', `MeowlChess-rating-explanation-${name}.png`), fullPage: name !== 'mobile' });
  const assertClosed = async () => assert.equal(await dialog.evaluate(node => node.open), false);
  const assertFocus = async locator => assert.equal(await locator.evaluate(node => node === document.activeElement), true, 'Closing restores focus to the exact trigger.');
  const assertNotation = async (locator, move) => {
    assert.equal(await locator.getAttribute('data-san'), move.san);
    assert.equal(await locator.getAttribute('aria-label'), move.san);
    const icons = await locator.locator('svg.notation-piece').all();
    assert(icons.length > 0, 'Dialog notation has a piece icon, including pawn moves.');
    for (const icon of icons) {
      assert.equal(await icon.getAttribute('data-color'), move.color);
      assert.equal(await icon.getAttribute('aria-hidden'), 'true');
      assert(await icon.locator('path').getAttribute('d'));
    }
  };
  const assertFits = async () => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page has no horizontal overflow.');
    const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, 'Dialog fits the viewport width.');
    assert(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1, 'Dialog stays within the viewport height.');
    assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Dialog has no horizontal content overflow.');
    const outside = await dialog.locator('.move-notation').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).flatMap(node => {
      const bounds = node.getBoundingClientRect(), dialog = node.closest('dialog').getBoundingClientRect();
      return bounds.left < dialog.left || bounds.right > dialog.right ? [node.dataset.san] : [];
    }));
    assert.deepEqual(outside, [], 'Move notation stays inside the dialog.');
  };

  stage = 'availability before and during the real local review';
  await page.goto(`${origin}/review.html`); await closeLibrary(page);
  assert(await heading.isDisabled()); assert.equal(await ratingButton(1).count(), 0);
  await openLibrary(page); await page.locator('#demo-button').click(); await closeLibrary(page);
  assert(await heading.isDisabled()); assert.equal(await page.locator('.move-rating-button').count(), 0);
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent)
    && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
  const saved = await page.evaluate(async () => {
    const { createReviewLibrary } = await import('./lib/library.js');
    const { ANALYSIS_VERSION } = await import('./lib/review.js');
    const { explainMoveRating } = await import('./lib/rating-explanation.js');
    const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
    try {
      const summary = (await library.listReviews()).find(record => record.game.pgn.includes('[Event "MeowlChess sample"]'));
      const record = await library.loadReview(summary.id);
      return { id: record.id, moves: record.result.moves,
        explanations: record.result.moves.map(move => explainMoveRating({ result: record.result, game: record.game, ply: move.ply })) };
    } finally { await library.close(); }
  });
  assert.equal(saved.moves.length, 4); assert(saved.explanations.every(Boolean));
  const engineStarts = await page.evaluate(() => window.ratingEngineStarts);
  assert(engineStarts > 0, 'The fixture was reviewed by the actual local engine.');
  await openMoves(page); assert(await heading.isDisabled(), 'Starting position has no per-move rating.');
  assert.equal(await page.locator('.move-rating-button').count(), saved.moves.length);
  assert.equal(await page.locator('.move-button .move-rating-button, .move-rating-button .move-button').count(), 0, 'Rating controls are siblings, never nested buttons.');

  const verifyDialog = async ply => {
    const move = saved.moves[ply - 1], expected = saved.explanations[ply - 1];
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.getAttribute('data-ply'), String(ply));
    assert.equal(await dialog.getAttribute('data-evidence'), expected.evidence);
    assert.equal(await page.locator('#rating-dialog-title').innerText(), `Why ${move.label}?`);
    assert.equal(await plainText(page.locator('#rating-dialog-move')), expected.title);
    assert.equal(await plainText(page.locator('#rating-dialog-reason')), expected.reason);
    const consequence = page.locator('#rating-dialog-consequence');
    assert.equal(await consequence.isVisible(), !!expected.consequence);
    if (expected.consequence) assert.equal(await plainText(consequence), expected.consequence.text);
    const details = page.locator('#rating-dialog-details');
    assert.equal(await details.evaluate(node => node.open), false, 'Analysis details start collapsed on every opening.');
    assert.equal(await page.locator('#rating-dialog-facts').isVisible(), false, 'Technical facts stay out of the compact default explanation.');
    await details.locator(':scope > summary').click();
    assert.equal(await details.evaluate(node => node.open), true);
    assert.deepEqual(await page.locator('#rating-dialog-facts li').evaluateAll(nodes => nodes.map(node => {
      const clone = node.cloneNode(true);
      for (const notation of clone.querySelectorAll('.move-notation')) notation.replaceWith(notation.dataset.san);
      return clone.textContent;
    })), expected.facts.map(fact => fact.text));
    assert.equal(await page.locator('#rating-dialog-definition').innerText(), expected.definition);
    assert.equal(await page.locator('#rating-dialog-note').innerText(), expected.note);
    assert.match(await page.locator('#board').getAttribute('aria-label'), new RegExp(`after move ${ply}:`));
    await assertNotation(page.locator('#rating-dialog-move .move-notation'), move);
    if (expected.line) {
      assert.equal(await page.locator('#rating-dialog-line').isVisible(), true);
      assert.equal(await page.locator('#rating-dialog-line').evaluate(node => node.open), false, 'Continuation starts collapsed on every opening.');
      await page.locator('#rating-dialog-line > summary').click();
      const notation = page.locator('#rating-dialog-line-moves .move-notation');
      assert.equal(await notation.count(), expected.line.moves.length);
      for (let index = 0; index < expected.line.moves.length; index++) await assertNotation(notation.nth(index), expected.line.moves[index]);
    } else assert.equal(await page.locator('#rating-dialog-line').isVisible(), false);
    await details.locator(':scope > summary').click();
    if (expected.line) await page.locator('#rating-dialog-line > summary').click();
    assert.equal(await page.evaluate(() => window.ratingEngineStarts), engineStarts, 'Opening explanations reuses saved analysis.');
  };

  stage = 'each move icon opens the exact saved grade and selects its board position';
  for (const move of saved.moves) {
    await ratingButton(move.ply).click(); await verifyDialog(move.ply);
    const beforeArrow = await page.locator('#board').getAttribute('aria-label');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#board').getAttribute('aria-label'), beforeArrow, 'Dialog keyboard input does not navigate the game.');
    await page.locator('#rating-dialog-details > summary').click();
    if (saved.explanations[move.ply - 1].line) await page.locator('#rating-dialog-line > summary').click();
    await page.keyboard.press('Escape'); await assertClosed(); await assertFocus(ratingButton(move.ply));
  }
  console.log('PASS: real saved grades, exact ply selection, piece colors, legal continuation, Escape and focus restoration');

  stage = 'heading entry and desktop/narrow dialog layout';
  await moveButton(3).click(); await heading.click(); await verifyDialog(3);
  await assertFits(); await capture('desktop');
  await page.locator('#rating-dialog-close').click(); await assertClosed(); await assertFocus(heading);
  await page.setViewportSize({ width: 375, height: 812 });
  await heading.click(); await verifyDialog(3); await assertFits(); await capture('mobile');
  await page.keyboard.press('Escape'); await assertFocus(heading);
  await page.setViewportSize({ width: 1440, height: 1050 });

  stage = 'retry and variation keep explanations inaccessible';
  await page.locator('#retry-move').click();
  assert(await heading.isDisabled()); assert.equal(await page.locator('#insight-badge').isVisible(), false);
  assert(await page.locator('.move-rating-button').evaluateAll(nodes => nodes.every(node => node.disabled)));
  await page.evaluate(() => {
    document.querySelector('.move-rating-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('#insight-explain').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await assertClosed(); await page.locator('#retry-exit').click();
  await moveButton(3).click(); await page.locator('#show-why').click();
  assert.equal(await page.locator('#study-controls').isVisible(), true);
  assert(await heading.isDisabled()); assert(await page.locator('.move-rating-button').evaluateAll(nodes => nodes.every(node => node.disabled)));
  await page.evaluate(() => document.querySelector('.move-rating-button').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await assertClosed(); await page.locator('#return-game').click();
  assert.equal(await heading.isDisabled(), false);

  stage = 'badge display preference preserves the heading explanation entry';
  await page.locator('#review-settings > summary').click(); await page.locator('#show-badges').uncheck();
  await page.locator('#review-settings > summary').click();
  assert.equal(await page.locator('.move-rating-button').count(), 0);
  await heading.click(); await verifyDialog(3); await page.locator('#rating-dialog-close').click();
  assert.equal(await page.evaluate(() => window.ratingEngineStarts), engineStarts, 'Dialogs, preferences, retry entry and saved variations never start another engine.');
  console.log('PASS: heading entry, 375px layout, disabled retry/variation entries and badges-off access');

  stage = 'saved-review deep link has the same explanation with zero engine starts';
  await page.goto(`${origin}/review.html?reviewId=${saved.id}`); await openMoves(page);
  await moveButton(4).click(); await heading.click(); await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getAttribute('data-ply'), '4');
  assert.equal(await plainText(page.locator('#rating-dialog-reason')), saved.explanations[3].reason);
  assert.equal(await plainText(page.locator('#rating-dialog-consequence')), saved.explanations[3].consequence.text);
  assert.equal(await page.locator('#rating-dialog-details').evaluate(node => node.open), false);
  assert.equal(await page.evaluate(() => window.ratingEngineStarts), 0);
  await assertNotation(page.locator('#rating-dialog-move .move-notation'), saved.moves[3]);
  await page.keyboard.press('Escape'); await assertFocus(heading);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: reopened saved review explains its stored grade locally with no engine or network requests');
} catch (error) {
  if (page) await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-rating-explanation-failure.png'), fullPage: true }).catch(() => {});
  throw new Error(`Rating explanation UI failed at ${stage}: ${error.message}`, { cause: error });
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) === temporaryRoot && basename(absolute).startsWith(bundlePrefix)) await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
}
