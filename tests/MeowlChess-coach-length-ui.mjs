import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-length-test-', bundlePrefix = 'MeowlChess-coach-length-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const fixtureHtml = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess explanation length</title><link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><link rel="stylesheet" href="workspace.css"><style>body{padding:16px}main{max-width:680px;margin:auto}#coach-root{padding:16px;background:#242920}</style><main><section id="coach-root"></section></main><script type="module" src="MeowlChess-coach-length-fixture.js"></script></html>';
const fixtureScript = String.raw`
import { Chess } from './vendor/chess.js';
import { parseGame } from './lib/review.js';
import { createCoachView } from './lib/coach-view.js';
const pgn = '[White "Cat"]\n[Black "Owl"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';
const parsed = parseGame(pgn);
const positions = parsed.positions.map((fen, index) => {
  const next = parsed.moves[index], bestMove = next ? next.from + next.to : null;
  return { cp: 0, mate: null, depth: 16, bestMove, pv: bestMove ? [bestMove] : [] };
});
positions[2] = { cp: 10, mate: null, depth: 16, bestMove: 'f1c4', pv: ['f1c4', 'b8c6', 'g1f3', 'g8f6'] };
const moves = parsed.moves.map((move, index) => ({ ...move, ply: index + 1, label: index === 2 ? 'Mistake' : 'Best', probabilityLoss: index === 2 ? 0.15 : 0, loss: 0, accuracy: 100, evalAfter: positions[index + 1] }));
const state = { game: { pgn }, result: { game: parsed, positions, moves, summary: { w: { accuracy: 90 }, b: { accuracy: 100 } } }, ply: 3, active: true };
const view = createCoachView(document.querySelector('#coach-root'), { onNavigate({ ply }) { state.ply = ply; view.setContext(state); } });
view.setContext(state);
window.fixture = { dispose: () => view.dispose() };
`;
const plainText = locator => locator.evaluate(element => {
  const copy = element.cloneNode(true);
  for (const move of copy.querySelectorAll('.move-notation')) move.replaceWith(document.createTextNode(move.dataset.san));
  return copy.textContent;
});
let context, page;
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'MeowlChess-coach-length-fixture.html'), fixtureHtml);
  await writeFile(join(extension, 'MeowlChess-coach-length-fixture.js'), fixtureScript);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  const errors = [], external = [];
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.fixtureWorkers = 0; window.fixtureAudio = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.fixtureWorkers++; } };
    const nativeStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) { window.fixtureAudio++; return nativeStart.apply(this, args); };
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ coachPreferences: { coach: 'meowl', perspective: 'both', motion: false, sounds: false, commentary: true, volume: 0.8 } }));
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`, url = `${origin}/MeowlChess-coach-length-fixture.html`;
  page = await context.newPage(); await page.goto(url);
  const control = page.getByLabel('Explanation length', { exact: true });
  await page.locator('.coach-walkthrough').waitFor({ state: 'visible' });
  assert.equal(await control.inputValue(), 'brief', 'Older preferences default to Brief.');
  assert.equal(await page.locator('.coach-picker').evaluate(item => item.open), false);
  const briefTip = await plainText(page.locator('.coach-walkthrough-text'));
  const ask = async () => {
    await page.locator('.coach-question').fill('What was better than 2. Nf3?');
    await page.locator('.coach-send').click();
    return plainText(page.locator('.coach-message[data-role="coach"] .coach-message-text').last());
  };
  const briefAnswer = await ask();
  assert.match(briefAnswer, /Line starts: 2\. Bc4 Nc6/);
  const oldChat = await page.locator('.coach-log').innerHTML();
  await worker.evaluate(async () => {
    const { coachPreferences } = await chrome.storage.local.get('coachPreferences');
    await chrome.storage.local.set({ coachPreferences: { ...coachPreferences, sounds: true } });
  });
  await page.waitForFunction(() => document.querySelector('.coach-sound-toggle').checked);
  const soundsBefore = await page.evaluate(() => window.fixtureAudio);
  await control.selectOption('detailed');
  await page.waitForFunction(() => /The engine continues/.test(document.querySelector('.coach-walkthrough-text').textContent));
  const detailedTip = await plainText(page.locator('.coach-walkthrough-text'));
  assert(detailedTip.length > briefTip.length);
  assert.equal(await page.locator('.coach-log').innerHTML(), oldChat, 'Length changes preserve earlier chat verbatim.');
  assert.equal(await page.evaluate(() => window.fixtureAudio), soundsBefore, 'A length change does not start a sound even with sounds enabled.');
  assert.equal(await page.evaluate(() => window.fixtureWorkers), 0, 'Length changes do not start an engine.');
  await worker.evaluate(async () => {
    const { coachPreferences } = await chrome.storage.local.get('coachPreferences');
    await chrome.storage.local.set({ coachPreferences: { ...coachPreferences, sounds: false } });
  });
  await page.waitForFunction(() => !document.querySelector('.coach-sound-toggle').checked);
  const detailedAnswer = await ask();
  assert(detailedAnswer.length > briefAnswer.length);
  assert.match(detailedAnswer, /Suggested line: 2\. Bc4 Nc6 3\. Nf3 Nf6/);
  const second = await context.newPage(); await second.goto(url);
  await second.waitForFunction(() => document.querySelector('.coach-explanation-length')?.value === 'detailed');
  assert.equal(await second.locator('.coach-log').textContent(), '', 'Chats remain private to the original tab.');
  await control.selectOption('brief');
  await second.waitForFunction(() => document.querySelector('.coach-explanation-length').value === 'brief');
  await page.waitForFunction(() => /Saved reply/.test(document.querySelector('.coach-walkthrough-text').textContent));
  assert.equal(await plainText(page.locator('.coach-walkthrough-text')), briefTip);
  await page.evaluate(async () => {
    const { createReviewLibrary } = await import('./lib/library.js');
    const { createBackup, restoreBackup } = await import('./lib/backup.js');
    const library = createReviewLibrary();
    try {
      const backup = await createBackup({ library, storage: chrome.storage.local, extensionVersion: '1.13.0' });
      backup.settings.coachPreferences.explanationLength = 'detailed';
      await restoreBackup(backup, { library, storage: chrome.storage.local, restoreSettings: true });
    } finally { await library.close(); }
  });
  await page.waitForFunction(() => document.querySelector('.coach-explanation-length').value === 'detailed');
  await second.waitForFunction(() => document.querySelector('.coach-explanation-length').value === 'detailed');
  assert.equal(await page.locator('.coach-message[data-role="coach"]').count(), 2, 'Restoring preferences also preserves chat.');
  await page.locator('.coach-picker-summary').click();
  await page.locator('.coach-choice[data-coach="evil"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.coach-select').inputValue(), 'meowl', 'The collapsed picker preserves Evil Meowl’s lock.');
  assert(await page.locator('.coach-unlock-explanation').isVisible());
  await page.locator('.coach-choice[data-coach="owl"]').click();
  assert.equal(await page.locator('.coach-select').inputValue(), 'owl');
  assert.equal(await page.locator('.coach-picker').evaluate(item => item.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.className), 'coach-picker-summary');
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('.coach-picker-summary').click();
  await page.locator('.coach-choice[data-coach="owl"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.coach-select').inputValue(), 'paws', 'Arrow-key coach browsing remains available.');
  assert.equal(await page.locator('.coach-picker').evaluate(item => item.open), true);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-length-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: explanation length, unchanged chat, silent refresh, cross-tab preferences, backup restore and accessible coach picker.');
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absoluteBundle = resolve(bundle);
  if (dirname(absoluteBundle) === temporaryRoot && basename(absoluteBundle).startsWith(bundlePrefix)) await rm(absoluteBundle, { recursive: true, force: true, maxRetries: 3 });
}
