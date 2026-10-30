import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeLibrary, closeTestContext } from './ui-helpers.mjs';

// Real extension + real local engines, with synthetic public archives only.
// A disposable extension copy grants optional site permissions up front because
// native permission prompts are not available in headless Chromium. The normal
// settings denial path is exercised separately. Production manifest is unchanged.
const root = resolve(import.meta.dirname, '..');
const temporaryRoot = resolve(tmpdir());
const profile = await mkdtemp(join(temporaryRoot, 'meowlchess-site-test-'));
const bundle = await mkdtemp(join(temporaryRoot, 'meowlchess-site-bundle-'));
const extension = join(bundle, 'extension');
const hostSelector = '#meowlchess-site-review';
const stamp = Math.floor(Date.now() / 1000) - 3600;
const chessUrl = 'https://www.chess.com/game/live/884400001';
const nextChessUrl = 'https://www.chess.com/game/live/884400002';
const lichessUrl = 'https://lichess.org/A1b2C3d4sEcR';
const pgn = (event, white, black, complete = true, longer = false) => `[Event "${event}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${complete ? '0-1' : '*'}"]\n\n${longer ? '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O' : '1. f3 e5 2. g4 Qh4#'} ${complete ? '0-1' : '*'}`;
const chessGame = (url, event, white = 'sitecat', black = 'siteowl', complete = true, longer = false) => ({ url, pgn: pgn(event, white, black, complete, longer), rules: 'chess', time_class: 'rapid', end_time: stamp, white: { username: white, result: complete ? 'checkmated' : 'unknown' }, black: { username: black, result: complete ? 'win' : 'unknown' } });
const lichessGame = (id, complete = true, white = 'sitecat', black = 'siteowl') => ({ id, variant: 'standard', status: complete ? 'mate' : 'started', lastMoveAt: stamp * 1000, speed: 'rapid', players: { white: { user: { name: white }, rating: 1200 }, black: { user: { name: black }, rating: 1200 } }, ...(complete ? { winner: 'black' } : {}), pgn: pgn(`Lichess ${id}`, white, black, complete) });
const completedChess = chessGame(chessUrl, 'Site review finished fixture');
const longChess = chessGame(nextChessUrl, 'Site review cancellation fixture');
const newerChessGames = Array.from({ length: 60 }, (_, index) => ({ ...chessGame(`https://www.chess.com/game/live/${884410000 + index}`, `Newer finished game ${index}`, 'sitecat', 'otherowl'), end_time: stamp + index + 1 }));
let context, worker, settings, stage = 'launch';
const errors = [], browserDiagnostics = [], unexpectedRequests = [];
const checkpoint = setInterval(() => console.log(`Site review checkpoint: ${stage}`), 15000);
checkpoint.unref();

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  assert(manifest.optional_permissions?.includes('scripting'), 'Site injection must be an optional permission.');
  for (const origin of ['https://www.chess.com/*', 'https://chess.com/*', 'https://lichess.org/*']) assert(manifest.optional_host_permissions?.includes(origin));
  manifest.permissions = [...new Set([...manifest.permissions, 'scripting'])];
  manifest.host_permissions = [...new Set([...manifest.host_permissions, ...manifest.optional_host_permissions])];
  delete manifest.optional_permissions;
  delete manifest.optional_host_permissions;
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: process.env.HEADED_EXT_TEST !== '1', viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.env.HEADED_EXT_TEST === '1' ? ['--start-minimized'] : [])]
  });
  context.setDefaultTimeout(15000);
  stage = 'browser launched; install fixtures';
  await context.route(/^https?:\/\//, async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && ['www.chess.com', 'chess.com', 'lichess.org'].includes(url.hostname)) {
      return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src 'none'; child-src 'none'", ...(url.hostname === 'lichess.org' ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}) }, body: `<!doctype html><html><head><meta charset="utf-8"><title>Completed game fixture</title><style>body{margin:0;background:#302e2b;color:#eee;font:18px Arial}main{padding:30px}button,iframe{display:none!important}</style></head><body><main class="round__app"><h1>Chess site fixture</h1><div id="round-result" class="game-over-component result" ${url.pathname === '/play/online' ? 'hidden' : ''}>Game over · 0–1</div></main></body></html>` });
    }
    if (url.pathname !== '/favicon.ico') unexpectedRequests.push(request.url());
    return route.abort();
  });
  await context.addInitScript(() => {
    const telemetry = window.__siteTest = { created: 0, terminated: 0, searches: 0, progressSeen: false, summarySeen: false, progressBeforeSummary: false, hostStates: [], workerErrors: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); telemetry.created++; this.addEventListener('error', event => telemetry.workerErrors.push({ message: event.message, filename: event.filename, line: event.lineno })); }
      postMessage(message, ...args) { if (typeof message === 'string' && /^go\b/.test(message)) telemetry.searches++; return super.postMessage(message, ...args); }
      terminate() { telemetry.terminated++; return super.terminate(); }
    };
    const visible = element => element && !element.hidden && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden';
    new MutationObserver(() => {
      const hostState = document.querySelector('#meowlchess-site-review')?.dataset.state;
      if (hostState && telemetry.hostStates.at(-1) !== hostState) telemetry.hostStates.push(hostState);
      if (visible(document.querySelector('#summary-progress'))) telemetry.progressSeen = true;
      if (visible(document.querySelector('#summary-result')) && !telemetry.summarySeen) {
        telemetry.summarySeen = true;
        telemetry.progressBeforeSummary = telemetry.progressSeen;
      }
    }).observe(document, { attributes: true, childList: true, subtree: true });
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionBase = worker.url().replace(/background\.js(?:\?.*)?$/, '');
  const extensionOrigin = extensionBase.slice(0, -1);
  // Chromium service-worker fetches are not consistently intercepted by route.
  // Replace ONLY archive transport in this test process; production fetching,
  // archive normalization, broker checks, frames, library, and engines are real.
  await worker.evaluate(() => {
    globalThis.__siteFixtures = { chess: [], lichess: [] };
    globalThis.__siteFetches = [];
    globalThis.__siteSenders = [];
    chrome.runtime.onMessage.addListener((message, sender) => { if (message?.type === 'meowl:site-check') globalThis.__siteSenders.push({ url: sender.url, tabUrl: sender.tab?.url, frameId: sender.frameId }); });
    globalThis.fetch = async input => {
      const raw = typeof input === 'string' ? input : input.url;
      globalThis.__siteFetches.push(raw);
      const url = new URL(raw);
      const listing = url.pathname.match(/^\/pub\/player\/([a-z0-9_-]+)\/games\/archives$/);
      if (url.origin === 'https://api.chess.com' && listing) return { ok: true, status: 200, json: async () => ({ archives: Object.keys(globalThis.__siteFixtures.chessMonths || { '2026/10': [] }).map(month => `https://api.chess.com/pub/player/${listing[1]}/games/${month}`) }) };
      const archive = url.pathname.match(/^\/pub\/player\/[a-z0-9_-]+\/games\/(\d{4}\/\d{2})$/);
      if (url.origin === 'https://api.chess.com' && archive) return { ok: true, status: 200, json: async () => ({ games: globalThis.__siteFixtures.chessMonths?.[archive[1]] || globalThis.__siteFixtures.chess }) };
      if (url.origin === 'https://lichess.org' && /^\/api\/games\/user\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return { ok: true, status: 200, text: async () => globalThis.__siteFixtures.lichess.slice(0, Number(url.searchParams.get('max')) || 20).map(game => JSON.stringify(game)).join('\n') };
      const single = url.pathname.match(/^\/game\/export\/([a-zA-Z0-9]{8})$/);
      if (url.origin === 'https://lichess.org' && single) {
        const game = globalThis.__siteFixtures.lichess.find(game => game.id === single[1]);
        return { ok: Boolean(game), status: game ? 200 : 404, text: async () => JSON.stringify(game || { error: 'No such game' }), json: async () => game || { error: 'No such game' } };
      }
      throw new Error(`Unexpected network access in site-review test: ${raw}`);
    };
  });
  const fixtures = (chess, lichess = [], chessMonths) => worker.evaluate(value => { globalThis.__siteFixtures = value; }, { chess, lichess, chessMonths });
  const watchErrors = page => {
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) browserDiagnostics.push(message.text()); });
    page.on('requestfailed', request => browserDiagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  };
  settings = await context.newPage(); watchErrors(settings); settings.setDefaultTimeout(15000);
  stage = 'open site-review settings';
  await settings.goto(`${extensionBase}review.html?siteSettings=1`); await closeLibrary(settings);
  if (!await settings.locator('#review-settings').evaluate(el => el.open)) await settings.locator('#review-settings > summary').click();
  const config = () => settings.evaluate(async () => (await chrome.storage.local.get('siteReviewSettings')).siteReviewSettings);
  const poll = async (read, label, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error(`Timed out: ${label}`);
  };
  const enabled = async (source, value) => {
    await settings.bringToFront();
    const toggle = settings.locator(`#site-${source}-enabled`);
    if (await toggle.isChecked() !== value) await toggle.click();
    await poll(async () => Boolean((await config())?.[source]?.enabled) === value, `${source} setting ${value}`);
    await poll(async () => (await toggle.isChecked()) === value && !await toggle.isDisabled(), `${source} checkbox settled`);
    await poll(async () => (await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).some(script => script.id === `meowl-site-${source}`) === value, `${source} content registration`);
  };
  const records = () => settings.evaluate(async () => {
    const [{ createReviewLibrary }, { ANALYSIS_VERSION }] = await Promise.all([import('./lib/library.js'), import('./lib/review.js')]);
    const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
    try { return await library.listReviews(); } finally { await library.close(); }
  });
  const waitFrame = async page => {
    await page.waitForFunction(() => document.querySelector('#meowlchess-site-review'));
    const started = Date.now();
    while (Date.now() - started < 60000) {
      const frame = page.frames().find(item => /\/site-summary\.html(?:[?#]|$)/.test(item.url()));
      if (frame) return frame;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.error('Site state:', await page.evaluate(() => ({ hidden: document.hidden, visibility: document.visibilityState, url: location.href, state: document.querySelector('#meowlchess-site-review')?.dataset.state })));
    console.error('Archive requests:', await worker.evaluate(() => globalThis.__siteFetches));
    console.error('Direct check:', await worker.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url });
      return chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({ type: 'meowl:site-check' }) });
    }, page.url()));
    throw new Error(`No summary frame; host state: ${await page.locator(hostSelector).getAttribute('data-state')}`);
  };
  const noFrame = async page => {
    const started = Date.now();
    while (page.frames().some(frame => /\/site-summary\.html(?:[?#]|$)/.test(frame.url())) && Date.now() - started < 10000) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(page.frames().filter(frame => /\/site-summary\.html(?:[?#]|$)/.test(frame.url())).length, 0);
  };
  const checkCurrentPage = page => worker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url });
    const [reply] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({ type: 'meowl:site-check' }) });
    return reply.result;
  }, page.url());
  const complete = async frame => {
    await poll(async () => {
      const state = await frame.evaluate(() => ({ visible: !document.querySelector('#summary-result').hidden, error: document.querySelector('#summary-status').classList.contains('error'), message: document.querySelector('#summary-status').textContent, workerErrors: window.__siteTest.workerErrors }));
      if (state.error) throw new Error(`Summary frame: ${state.message} ${JSON.stringify(state.workerErrors)}`);
      return state.visible;
    }, 'completed summary', 120000);
    await frame.locator('#summary-open-review').waitFor({ state: 'visible' });
    await frame.waitForFunction(() => !document.querySelector('#summary-open-review').disabled);
    assert.equal(await frame.locator('#summary-progress').isVisible(), false);
    assert.equal(await frame.locator('#summary-scores > *').count(), 2);
    assert(await frame.locator('#summary-counts').innerText());
  };

  stage = 'disabled by default and permission denial';
  assert.equal(await settings.locator('#site-chesscom-enabled').isChecked(), false);
  assert.equal(await settings.locator('#site-lichess-enabled').isChecked(), false);
  const chess = await context.newPage(); watchErrors(chess);
  await fixtures([chessGame(chessUrl, 'Unfinished fixture', 'sitecat', 'siteowl', false), chessGame('https://www.chess.com/game/live/884400000', 'Older fixture')]);
  await chess.goto(chessUrl.replace('/game/live/', '/game/'));
  assert.equal(await chess.locator(hostSelector).count(), 0);
  assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  stage = 'deny site permission through settings';
  await settings.bringToFront();
  await settings.locator('#site-chesscom-username').fill('sitecat');
  await settings.evaluate(() => { window.__realPermissionRequest = chrome.permissions.request; window.__realPermissionContains = chrome.permissions.contains; chrome.permissions.request = async () => false; chrome.permissions.contains = async () => false; });
  await settings.locator('#site-chesscom-enabled').click();
  await settings.waitForFunction(() => !document.querySelector('#site-chesscom-enabled').checked && !document.querySelector('#site-chesscom-enabled').disabled, null, { polling: 50 });
  assert.notEqual((await config())?.chesscom?.enabled, true);
  // The disposable manifest already grants these permissions; emulate accepting
  // the settings prompt while all actual background permission checks stay real.
  await settings.evaluate(() => { chrome.permissions.request = async () => true; chrome.permissions.contains = window.__realPermissionContains; });
  console.log('Site review: default-off and denied-permission checks passed.');

  stage = 'Chess.com current unfinished game cannot fall back to an older game';
  await enabled('chesscom', true);
  await chess.bringToFront();
  await chess.waitForFunction(() => document.querySelector('#meowlchess-site-review')?.dataset.state === 'waiting');
  await noFrame(chess);
  assert.equal((await records()).length, 0);
  stage = 'Chess.com requested old game beyond sixty newer games and three archive months';
  const newerGamesInTargetMonth = newerChessGames.map((game, index) => ({ ...game, url: `https://www.chess.com/game/live/${884420000 + index}` }));
  await fixtures([], [], { '2026/05': [...newerGamesInTargetMonth, completedChess], '2026/06': [], '2026/07': [], '2026/08': [], '2026/09': [], '2026/10': newerChessGames });
  await enabled('chesscom', false); await enabled('chesscom', true);
  await chess.bringToFront();
  const chessFrame = await waitFrame(chess);
  await complete(chessFrame);
  assert.equal(await chessFrame.locator('#summary-players').innerText(), 'sitecat vs siteowl', 'The short game URL must select the exact game, not the newest archive entry.');
  assert.equal((await records())[0].game.url, chessUrl, 'The requested historical game is saved, not one of the sixty newer matches.');
  assert((await worker.evaluate(() => globalThis.__siteFetches)).some(url => url.endsWith('/2026/05')), 'Exact-game lookup searches beyond the latest three archive months.');
  const telemetry = await chessFrame.evaluate(() => window.__siteTest);
  assert(telemetry.created > 0 && telemetry.searches > 0, 'A real local engine must run.');
  assert.equal(telemetry.progressBeforeSummary, true, 'Progress is displayed before the completed summary.');
  assert.equal(telemetry.created, telemetry.terminated, 'Completed engine workers are terminated.');
  assert.equal((await records()).length, 1);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await chess.screenshot({ path: join(root, 'test-results', 'site-review-chesscom.png') });
  await chess.setViewportSize({ width: 390, height: 844 });
  await chess.screenshot({ path: join(root, 'test-results', 'site-review-narrow.png') });
  await chess.setViewportSize({ width: 1366, height: 900 });
  await poll(async () => { const box = await chess.locator(hostSelector).boundingBox(); return Math.abs(box.x + box.width - (1366 - 16)) <= 2; }, 'panel reflows after restoring desktop viewport');
  console.log('Site review: old Chess.com target beyond sixty newer games and three months, progress, summary, persistence, and CSP checks passed.');

  stage = 'forged page messages cannot control the summary';
  const token = new URL(chessFrame.url()).hash.slice(1);
  const frameCount = chess.frames().length;
  const geometry = await chess.locator(hostSelector).boundingBox();
  await chess.evaluate(({ token, origin }) => {
    for (const type of ['meowl:site-frame-close', 'meowl:site-frame-size']) window.dispatchEvent(new MessageEvent('message', { source: window.frames[0], origin, data: { type, token, height: 999999 } }));
    window.frames[0]?.postMessage({ type: 'meowl:site-payload', token, game: { pgn: '[Result "*"]\n\n1. e4 *' } }, '*');
  }, { token, origin: extensionOrigin });
  await chess.waitForTimeout(100);
  assert.equal(chess.frames().length, frameCount);
  assert.deepEqual(await chess.locator(hostSelector).boundingBox(), geometry);
  assert.equal((await chessFrame.evaluate(() => window.__siteTest)).created, telemetry.created);

  stage = 'saved summaries reopen without another engine run';
  await chess.reload();
  const cachedFrame = await waitFrame(chess); await complete(cachedFrame);
  assert.equal((await cachedFrame.evaluate(() => window.__siteTest)).created, 0);
  assert.match(await cachedFrame.locator('#summary-status').innerText(), /saved/i);
  const opened = context.waitForEvent('page'); await cachedFrame.locator('#summary-open-review').click();
  const fullReview = await opened;
  await fullReview.waitForFunction(() => document.querySelector('#summary-tab')?.getAttribute('aria-selected') === 'true' && /starting/i.test(document.querySelector('#position-label')?.textContent || ''));
  assert.match(fullReview.url(), /reviewId=game-[a-f0-9]{64}/);
  await fullReview.close();

  stage = 'SPA navigation removes stale results; disabling cancels a new review';
  await chess.evaluate(url => { history.pushState({}, '', url); document.querySelector('#round-result').textContent = 'New game'; }, nextChessUrl.replace('/game/live/', '/game/'));
  await chess.waitForFunction(() => document.querySelector('#meowlchess-site-review')?.dataset.state === 'waiting');
  await noFrame(chess);
  console.log('SPA sender snapshots:', await worker.evaluate(() => globalThis.__siteSenders));
  await settings.bringToFront();
  await settings.locator('#smart-analysis').uncheck();
  await settings.locator('#depth').selectOption('3000');
  await fixtures([longChess]);
  await enabled('chesscom', false); await enabled('chesscom', true);
  // Keep the SPA document: Chromium can report its original sender.url even
  // after sender.tab.url has changed. The broker must review the current game.
  const cancellationPage = chess;
  await cancellationPage.bringToFront();
  const cancelling = await waitFrame(cancellationPage);
  await cancelling.waitForFunction(() => window.__siteTest.searches > 0);
  assert.equal(await cancelling.locator('#summary-progress').isVisible(), true);
  await enabled('chesscom', false);
  await cancellationPage.bringToFront();
  await cancellationPage.locator(hostSelector).waitFor({ state: 'detached' });
  await cancellationPage.waitForTimeout(250);
  assert.equal(cancellationPage.workers().length, 0);
  await cancellationPage.close();
  assert.equal((await records()).length, 1, 'A partial review must not be saved.');
  console.log('Site review: forged messages, cached reopen, full-review link, SPA, and cancellation passed.');

  stage = 'Lichess account and current-game guards';
  await settings.bringToFront();
  await settings.locator('#smart-analysis').check();
  await settings.locator('#engine').selectOption('lozza');
  await settings.locator('#depth').selectOption('50');
  await settings.locator('#site-lichess-username').fill('siteowl');
  await fixtures([], [lichessGame('A1b2C3d4', false), lichessGame('E5f6G7h8'), lichessGame('A1b2C3d4', true, 'othercat', 'otherowl')]);
  const lichess = await context.newPage(); watchErrors(lichess); await lichess.goto(lichessUrl);
  await enabled('lichess', true);
  await lichess.bringToFront();
  await lichess.waitForFunction(() => ['waiting', 'error'].includes(document.querySelector('#meowlchess-site-review')?.dataset.state));
  assert(['waiting', 'error'].includes((await checkCurrentPage(lichess)).status), 'An unfinished exact game cannot open a review.');
  await noFrame(lichess);
  assert.equal((await records()).length, 1);
  stage = 'Lichess exact game still requires the configured player';
  await fixtures([], [lichessGame('A1b2C3d4', true, 'othercat', 'otherowl')]);
  await enabled('lichess', false); await enabled('lichess', true); await lichess.bringToFront();
  assert(['waiting', 'error'].includes((await checkCurrentPage(lichess)).status), 'A completed game from another account cannot open a review.');
  await noFrame(lichess); assert.equal((await records()).length, 1);
  stage = 'Lichess unknown exact game cannot fall back to another finished game';
  await fixtures([], [lichessGame('E5f6G7h8')]);
  await enabled('lichess', false); await enabled('lichess', true); await lichess.bringToFront();
  assert(['waiting', 'error'].includes((await checkCurrentPage(lichess)).status), 'A missing exact game cannot fall back to the account list.');
  await noFrame(lichess); assert.equal((await records()).length, 1);
  stage = 'Lichess old completed game beyond sixty newer games, private suffix, and real Lozza';
  const newerLichessGames = Array.from({ length: 60 }, (_, index) => ({ ...lichessGame(`N${String(index).padStart(7, '0')}`, true, 'othercat', 'siteowl'), lastMoveAt: (stamp + index + 1) * 1000 }));
  await fixtures([], [...newerLichessGames, lichessGame('A1b2C3d4')]);
  await enabled('lichess', false); await enabled('lichess', true);
  await lichess.bringToFront();
  const lichessFrame = await waitFrame(lichess); await complete(lichessFrame);
  const lichessTelemetry = await lichessFrame.evaluate(() => window.__siteTest);
  assert(lichessTelemetry.searches > 0);
  assert.equal(lichessTelemetry.progressBeforeSummary, true);
  assert.equal(lichessTelemetry.created, lichessTelemetry.terminated);
  assert.match(await lichessFrame.locator('#summary-engine').innerText(), /Lozza/i);
  assert.equal(await lichessFrame.locator('#summary-players').innerText(), 'sitecat vs siteowl', 'The old Lichess game is selected instead of a newer account-list game.');
  assert.equal((await records()).length, 2);
  assert((await records()).some(record => record.game.url === 'https://lichess.org/A1b2C3d4'));
  const apiRequests = await worker.evaluate(() => globalThis.__siteFetches);
  assert(apiRequests.some(url => url.startsWith('https://lichess.org/game/export/A1b2C3d4?')), 'The current Lichess page requests its exact canonical game export.');
  assert(apiRequests.every(url => !url.includes('sEcR')), 'The private player suffix is never sent to public retrieval APIs.');
  assert.equal(apiRequests.filter(url => url.includes('api/games/user/')).length, 0, 'Exact game pages do not depend on recent account lists.');
  assert(apiRequests.filter(url => url.includes('api/games/user/')).every(url => new URL(url).searchParams.get('ongoing') === 'false' && new URL(url).searchParams.get('finished') === 'true'));
  await lichess.screenshot({ path: join(root, 'test-results', 'site-review-lichess.png') });
  await lichessFrame.locator('#summary-close').click();
  await lichess.locator(hostSelector).waitFor({ state: 'detached' });
  await enabled('lichess', false);
  assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  console.log('Site review: Lichess progress/summary, account checks, private URL handling, local engine, and disable passed.');

  stage = 'play page watches the next finished round and starts with progress';
  await fixtures([completedChess, { ...chessGame('https://www.chess.com/game/live/884499999', 'Unrelated newer finished game', 'sitecat', 'otherowl'), end_time: stamp + 10 }]);
  await enabled('chesscom', true);
  const lobby = await context.newPage(); watchErrors(lobby);
  await lobby.goto('https://www.chess.com/play/online'); await lobby.bringToFront();
  await poll(async () => worker.evaluate(async () => (await chrome.storage.session.get('siteReviewSession')).siteReviewSession?.cache?.some(entry => entry.key === 'chesscom:sitecat' && entry.value?.games?.length)), 'play-page completed-game baseline', 60000);
  await lobby.waitForTimeout(500);
  assert.equal(await lobby.locator(hostSelector).count(), 0, 'A playing page must not show the previous finished match.');
  const latest = chessGame('https://www.chess.com/game/live/884400003', 'Newly finished round');
  latest.end_time = Math.floor(Date.now() / 1000) - 1;
  await fixtures([latest, completedChess]);
  // Advance only the disposable broker cache clock; a real site would wait for
  // the documented one-minute public-archive poll before seeing fresh data.
  await worker.evaluate(() => { const readClock = Date.now.bind(Date); Date.now = () => readClock() + 65000; });
  await lobby.evaluate(() => { document.querySelector('#round-result').hidden = false; });
  const roundFrame = await waitFrame(lobby); await complete(roundFrame);
  const roundStates = await lobby.evaluate(() => window.__siteTest.hostStates);
  assert(roundStates.indexOf('waiting') >= 0 && roundStates.indexOf('waiting') < roundStates.indexOf('review'), 'The completed-round notice opens a progress bar before its summary iframe.');
  assert.equal((await roundFrame.evaluate(() => window.__siteTest)).progressBeforeSummary, true);
  assert.equal((await records()).length, 3);
  await lobby.screenshot({ path: join(root, 'test-results', 'site-review-round-ended.png') });
  await enabled('chesscom', false);
  console.log('Site review: next-round detection and progress-first play-page flow passed.');
  assert.deepEqual(unexpectedRequests, [], 'No live network requests are allowed.');
  assert.deepEqual(errors, []);
  console.log('All site-review browser assertions passed. Native permission grant/revoke prompts require manual verification.');
} catch (error) {
  console.error(`Site-review test failed during: ${stage}`);
  console.error(error);
  console.error('Browser errors:', errors);
  console.error('Browser diagnostics:', browserDiagnostics.slice(-40));
  if (context) for (const page of context.pages()) console.error('Page:', page.url());
  if (worker) console.error('Broker diagnostic:', await worker.evaluate(async () => JSON.stringify({ fetches: globalThis.__siteFetches, senders: globalThis.__siteSenders, fixtures: globalThis.__siteFixtures, local: await chrome.storage.local.get('siteReviewSettings'), session: await chrome.storage.session.get('siteReviewSession') })).catch(() => 'Worker unavailable'));
  throw error;
} finally {
  clearInterval(checkpoint);
  await closeTestContext(context, profile, 'meowlchess-site-test-');
  if (dirname(bundle) === temporaryRoot && basename(bundle).startsWith('meowlchess-site-bundle-')) await rm(bundle, { recursive: true, force: true, maxRetries: 3 });
}
