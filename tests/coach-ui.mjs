import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { openLibrary, closeLibrary, openImport, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'meowlchess-coach-test-', bundlePrefix = 'meowlchess-coach-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const pgn = '[Event "Coach opening"]\n[White "Opening Cat"]\n[Black "Opening Owl"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';
const sitePgn = '[Event "Coach site"]\n[White "sitecat"]\n[Black "siteowl"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const chessUrl = 'https://www.chess.com/game/live/884477990';
const errors = [], external = [];
let context, worker, page, stage = 'launch';
async function chooseCoach(id) { await page.locator(`.coach-choice[data-coach="${id}"]`).click(); }
async function poll(read, label, timeout = 15000) {
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
    headless: true, viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && url.origin === 'https://www.chess.com' && url.pathname.startsWith('/game/')) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#302e2b;color:white;font:16px Arial}</style><div class="game-over-component">Game over · 0–1</div>' });
    }
    if (url.pathname !== '/favicon.ico') external.push(url.href);
    return route.abort();
  });
  await context.addInitScript(() => {
    window.coachWorkerStarts = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.coachWorkerStarts++; } };
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ tutorialNeverShowAgain: true, supportNeverShowAgain: true, reviewSettings: { engine: 'lozza', time: '50', lines: '1', smart: false } });
  });
  page = await context.newPage();
  await mkdir(join(root, 'test-results'), { recursive: true });
  const capture = name => page.screenshot({ path: join(root, 'test-results', `MeowlChess-coach-${name}.png`), fullPage: true });
  const expectPortrait = async (locator, coachId) => {
    await poll(() => locator.evaluate(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), `loaded ${coachId} portrait`);
    const source = await locator.evaluate(image => image.src);
    assert.equal(source, `${origin}/icons/coaches/MeowlChess-coach-${coachId}.svg`);
    assert.equal(await locator.getAttribute('alt'), '', 'Portrait is decorative beside the visible coach name.');
    assert.equal(await locator.evaluate(image => getComputedStyle(image).objectFit), 'contain', 'The full character is shown without cropping.');
  };
  const questions = surface => surface.locator('.coach-message[data-role="user"]');
  const answers = surface => surface.locator('.coach-message[data-role="coach"]');
  const ask = async (question, surface = page) => {
    const prior = await questions(surface).count();
    await surface.locator('.coach-question').fill(question);
    await surface.locator('.coach-send').click();
    await poll(async () => await questions(surface).count() === Math.min(prior + 1, 12) && (await answers(surface).last().innerText()).trim().length > 10, 'coach reply');
    return answers(surface).last().innerText();
  };
  const readyReview = () => page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
  const coach = async () => { await closeLibrary(page); await page.locator('#coach-tab').click(); await page.locator('.coach-question').waitFor({ state: 'visible' }); };
  const savedRecord = event => page.evaluate(async event => {
    const { createReviewLibrary } = await import('./lib/library.js');
    const { ANALYSIS_VERSION } = await import('./lib/review.js');
    const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
    try { return (await library.listReviews()).find(item => item.game.pgn.includes(`[Event "${event}"]`)); }
    finally { await library.close(); }
  }, event);
  const fit = async () => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow.');
    const rootBounds = await page.locator('#coach-root').boundingBox();
    assert(rootBounds.x >= 0 && rootBounds.x + rootBounds.width <= page.viewportSize().width + 1, 'Coach fits the viewport.');
    for (const selector of ['.coach-question', '.coach-send', '.coach-choice[aria-pressed="true"]', '.coach-perspective']) {
      const box = await page.locator(selector).boundingBox();
      assert(box && box.x >= rootBounds.x - 1 && box.x + box.width <= rootBounds.x + rootBounds.width + 1, `${selector} stays within the coach.`);
    }
  };

  stage = 'completed review availability';
  await page.goto(`${origin}/review.html`); await closeLibrary(page);
  assert.equal(await page.locator('#coach-tab').isDisabled(), true, 'No coach before a reviewed game.');
  await openLibrary(page); await page.locator('#demo-button').click(); await closeLibrary(page);
  assert.equal(await page.locator('#coach-tab').isDisabled(), true, 'Loading a completed PGN alone does not invent a review.');
  await page.locator('#analyze-button').click(); await readyReview();
  assert.equal(await page.locator('#summary-panel').isVisible(), true);
  assert.equal(await page.locator('#position-label').innerText(), 'Starting position');
  const sampleRecord = await savedRecord('MeowlChess sample'); assert(sampleRecord);
  const workersBeforeChat = await page.evaluate(() => window.coachWorkerStarts);
  await coach();
  assert.deepEqual(await page.locator('.coach-select option').evaluateAll(options => options.map(option => option.value)), ['meowl', 'owl', 'paws', 'mellow', 'scout']);
  assert(await page.locator('.coach-commentary-toggle').isChecked(), 'Automatic move explanations start enabled.');
  await expectPortrait(page.locator('.coach-avatar'), 'meowl');
  assert.match(await ask('Summarize this game'), /White|Black|mate|game/i);
  await expectPortrait(answers(page).last().locator('.coach-message-avatar'), 'meowl');
  assert.equal(await questions(page).last().locator('img').count(), 0, 'User messages have no coach portrait.');
  assert.match(await ask('Why 2...Qh4#?'), /Qh4|checkmate/i);
  const jump = answers(page).last().locator('.coach-jump').first();
  assert.equal(await jump.count(), 1, 'Move explanations include a direct board reference.');
  const target = Number(await jump.getAttribute('data-ply')); assert.equal(target, 4);
  await jump.click();
  assert.equal(await page.locator('#coach-tab').getAttribute('aria-selected'), 'true', 'Jump keeps the conversation visible.');
  assert.match(await page.locator('#position-label').innerText(), /2.*h4/);
  assert.match(await page.locator('.coach-context').innerText(), /2|h4/);
  assert.equal(await questions(page).count(), 2, 'Moving the board keeps the chat.');

  stage = 'multi-move playback keeps coach context current';
  await page.locator('#play-button').click();
  await page.waitForFunction(() => {
    const ply = Number(document.querySelector('#board').getAttribute('aria-label').match(/after move (\d+):/)?.[1] || 0);
    return ply >= 3;
  });
  if (await page.locator('#play-button').getAttribute('aria-pressed') === 'true') await page.locator('#play-button').click();
  assert.equal(await page.locator('#play-button').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#coach-tab').getAttribute('aria-selected'), 'true', 'Playback remains in Coach across multiple timer ticks.');
  const playedMove = (await page.locator('#board').getAttribute('aria-label')).match(/after move (\d+): (\S+)/);
  assert(playedMove && Number(playedMove[1]) >= 3);
  const currentSan = playedMove[2].replace(/\.$/, '');
  assert((await page.locator('.coach-context').innerText()).includes(currentSan), 'The coach tracks the position reached during playback.');
  assert((await ask('Why was this move rated this way?')).includes(currentSan), 'A current-move question uses the newly displayed move, not the earlier conversation subject.');

  stage = 'keyboard, input safety, and honest unsupported answers';
  const position = await page.locator('#board').getAttribute('aria-label');
  await page.locator('.coach-question').fill('Why that move?'); await page.locator('.coach-question').focus();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('End');
  assert.equal(await page.locator('#board').getAttribute('aria-label'), position, 'Editing a question never navigates the game.');
  await page.keyboard.press('Shift+Enter'); assert.match(await page.locator('.coach-question').inputValue(), /\n/);
  const beforeEnter = await questions(page).count(); await page.keyboard.press('Enter');
  await poll(async () => await questions(page).count() === beforeEnter + 1, 'Enter submits');
  const unsupported = await ask('What will the weather be in Tokyo tomorrow?');
  assert.match(unsupported, /local|review|question|help|engine|understand/i, 'Unknown questions explain the local coach scope.');
  const attack = '<img src="https://invalid.example/coach" onerror="window.coachInjected=true">';
  await ask(attack);
  assert.equal(await questions(page).last().locator('.coach-message-text').innerText(), attack, 'User text remains literal.');
  assert.equal(await page.locator('.coach-log img[src*="invalid.example"]').count(), 0);
  assert.equal(await page.evaluate(() => !!window.coachInjected), false);
  assert.equal(await page.locator('.coach-question').getAttribute('maxlength'), '500');
  assert.equal(await page.evaluate(() => window.coachWorkerStarts), workersBeforeChat, 'Chat reuses saved analysis without starting an engine.');
  assert.deepEqual(external, [], 'Local coach sends no network requests.');

  stage = 'distinct bundled portraits and per-message identity';
  for (const coachId of ['owl', 'paws', 'meowl']) {
    await chooseCoach(coachId);
    await expectPortrait(page.locator('.coach-avatar'), coachId);
    await ask('Summarize this game');
    await expectPortrait(answers(page).last().locator('.coach-message-avatar'), coachId);
    await expectPortrait(answers(page).first().locator('.coach-message-avatar'), 'meowl');
  }
  assert.deepEqual(external, [], 'Coach portraits are bundled extension assets.');

  stage = 'coach selection and perspective persistence';
  await chooseCoach('owl'); await page.locator('.coach-perspective').selectOption('b');
  await poll(() => worker.evaluate(async () => {
    const preference = (await chrome.storage.local.get('coachPreferences')).coachPreferences;
    return preference?.coach === 'owl' && preference?.perspective === 'b';
  }), 'coach preference saved');
  await ask('What should I practice?');
  await page.goto(`${origin}/review.html?reviewId=${sampleRecord.id}&view=coach`);
  await page.locator('.coach-question').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.coach-select').inputValue(), 'owl');
  await expectPortrait(page.locator('.coach-avatar'), 'owl');
  assert.equal(await page.locator('.coach-perspective').inputValue(), 'b');
  await worker.evaluate(async () => chrome.storage.local.set({ coachPreferences: { coach: 'paws', perspective: 'b' } }));
  await poll(async () => await page.locator('.coach-select').inputValue() === 'paws', 'external coach preference update');
  await expectPortrait(page.locator('.coach-avatar'), 'paws');
  await chooseCoach('owl');
  await expectPortrait(page.locator('.coach-avatar'), 'owl');
  assert.equal(await questions(page).count(), 0, 'Conversation text is not persisted.');
  assert.equal(await page.evaluate(() => window.coachWorkerStarts), 0, 'Saved review deep link does not start an engine.');
  await page.locator('.coach-perspective').selectOption('w');
  assert.match(await ask('What was my biggest mistake?'), /White|f3|g4/i);
  await ask('What should I practice?');
  await fit(); await capture('main');
  await page.setViewportSize({ width: 375, height: 812 }); await fit(); await capture('mobile');
  await page.setViewportSize({ width: 1440, height: 1050 });

  stage = 'retry privacy, reset, and bounded conversation';
  await page.locator('#moves-tab').click(); await page.locator('#last-button').click(); await page.locator('#retry-move').click();
  assert.equal(await page.locator('#coach-tab').isDisabled(), true, 'Practice cannot expose coach answers.');
  assert.equal(await page.locator('.coach-log').isVisible(), false);
  await page.locator('#retry-exit').click(); await coach();
  await page.locator('.coach-clear').click(); assert.equal(await questions(page).count(), 0);
  for (let index = 0; index < 15; index++) await ask(`Summarize this game ${index + 1}`);
  assert.equal(await questions(page).count(), 12, 'Only the latest 12 turns remain in memory.');
  assert.equal(await answers(page).count(), 12);
  await page.locator('.coach-clear').click(); assert.equal(await questions(page).count(), 0);
  await ask('Summarize this game');
  await page.locator('#analyze-button').click(); await readyReview(); await coach();
  assert.equal(await questions(page).count(), 0, 'Re-review clears answers from the older analysis.');
  await ask('Why 2...Qh4#?');
  await openImport(page); await page.locator('#pgn-text').fill(pgn); await page.locator('#import-button').click(); await closeLibrary(page);
  assert.equal(await page.locator('#coach-tab').isDisabled(), true);
  await page.locator('#analyze-button').click(); await readyReview(); await coach();
  assert.equal(await questions(page).count(), 0, 'A different game gets a fresh conversation.');
  assert.match(await ask('What opening is this?'), /Ruy Lopez|Spanish/i);

  stage = 'on-site coach entry opens the correct saved game';
  await worker.evaluate(async ({ pgn, url, stamp }) => {
    globalThis.fetch = async input => {
      const target = new URL(typeof input === 'string' ? input : input.url);
      if (target.hostname !== 'api.chess.com') throw new Error(`Unexpected fixture fetch: ${target}`);
      if (target.pathname.endsWith('/archives')) return { ok: true, status: 200, json: async () => ({ archives: ['https://api.chess.com/pub/player/sitecat/games/2026/10'] }) };
      return { ok: true, status: 200, json: async () => ({ games: [{ url, pgn, rules: 'chess', time_class: 'rapid', end_time: stamp, white: { username: 'sitecat', result: 'checkmated' }, black: { username: 'siteowl', result: 'win' } }] }) };
    };
    await chrome.storage.local.set({ completionAlerts: false, siteReviewSettings: { chesscom: { enabled: true, username: 'sitecat' } }, reviewSettings: { engine: 'lozza', time: '50', lines: '1', smart: false } });
  }, { pgn: sitePgn, url: chessUrl, stamp: Math.floor(Date.now() / 1000) - 60 });
  await poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).some(script => script.id.startsWith('meowl-site-'))), 'site script registered');
  const site = await context.newPage(); await site.goto(chessUrl); await site.bringToFront();
  let frame;
  await poll(() => { frame = site.frames().find(item => /site-summary\.html#/.test(item.url())); return frame; }, 'summary frame');
  await frame.locator('#summary-result').waitFor({ state: 'visible', timeout: 60000 });
  await frame.locator('#summary-coach').waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#summary-coach').isDisabled(), false);
  const panelCoach = await worker.evaluate(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences?.coach || 'meowl');
  await expectPortrait(frame.locator('#summary-coach img'), panelCoach);
  await worker.evaluate(async () => chrome.storage.local.set({ coachPreferences: { coach: 'paws', perspective: 'w' } }));
  await poll(async () => (await frame.locator('#summary-coach img').getAttribute('src')).endsWith('/MeowlChess-coach-paws.svg'), 'panel coach portrait follows changed preference');
  await expectPortrait(frame.locator('#summary-coach img'), 'paws');
  const opened = context.waitForEvent('page'); await frame.locator('#summary-coach').click();
  const full = await opened; await full.waitForURL(/review\.html\?reviewId=.*view=coach/);
  await full.locator('.coach-question').waitFor({ state: 'visible' });
  assert.equal(await full.locator('#coach-tab').getAttribute('aria-selected'), 'true');
  assert.match(await full.locator('#game-title').innerText(), /sitecat.*siteowl/);
  assert.equal(await full.locator('#position-label').innerText(), 'Starting position');
  assert.equal(await full.evaluate(() => window.coachWorkerStarts), 0);
  assert.match(await ask('How did this game end?', full), /checkmate/i);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: local coach availability, evidence answers, board links, keyboard isolation, literal input, persistence, practice privacy, conversation reset/bounds, responsive layout, and saved-game entry from the on-site panel.');
} catch (error) {
  if (page) await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-failure.png'), fullPage: true }).catch(() => {});
  throw new Error(`Coach UI failed at ${stage}: ${error.message}`, { cause: error });
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) === temporaryRoot && basename(absolute).startsWith(bundlePrefix)) await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
}
