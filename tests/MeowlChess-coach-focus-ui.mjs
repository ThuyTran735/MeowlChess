import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-focus-test-', bundlePrefix = 'MeowlChess-coach-focus-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const fixtureHtml = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess coach focus</title><link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><link rel="stylesheet" href="workspace.css"><style>body{padding:16px}main{max-width:680px;margin:auto}#coach-root{padding:16px;background:#242920}</style><main><section id="coach-root"></section></main><script type="module" src="MeowlChess-coach-focus-fixture.js"></script></html>';
const fixtureScript = String.raw`
import { parseGame } from './lib/review.js';
import { createCoachView } from './lib/coach-view.js';
let state;
const view = createCoachView(document.querySelector('#coach-root'), { onNavigate({ ply }) { go(ply); } });
function load({ white = 'PlayerCat', black = 'OtherOwl', source = 'chesscom', ply = 3, suffix = '1' } = {}) {
  const site = source === 'lichess' ? 'https://lichess.org' : source === 'chesscom' ? 'https://www.chess.com' : 'Local';
  const pgn = '[Event "Focus fixture ' + suffix + '"]\n[Site "' + site + '"]\n[White "' + white + '"]\n[Black "' + black + '"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';
  const parsed = parseGame(pgn);
  const positions = parsed.positions.map((fen, index) => {
    const next = parsed.moves[index], bestMove = next ? next.from + next.to : null;
    return { cp: 0, mate: null, depth: 16, bestMove, pv: bestMove ? [bestMove] : [] };
  });
  positions[2] = { cp: 10, mate: null, depth: 16, bestMove: 'f1c4', pv: ['f1c4', 'b8c6', 'g1f3', 'g8f6'] };
  positions[3] = { cp: 310, mate: null, depth: 16, bestMove: 'g8f6', pv: ['g8f6', 'f1b5'] };
  const labels = ['Brilliant', 'Brilliant', 'Blunder', 'Mistake', 'Best', 'Best'];
  const moves = parsed.moves.map((move, index) => ({ ...move, ply: index + 1, label: labels[index], probabilityLoss: index === 2 ? .30 : index === 3 ? .15 : 0, loss: index === 2 ? 300 : index === 3 ? 150 : 0, accuracy: index === 2 ? 40 : index === 3 ? 65 : 100, evalAfter: positions[index + 1] }));
  state = { game: { pgn, source, url: source === 'lichess' ? 'https://lichess.org/AbCdEf12' : source === 'chesscom' ? 'https://www.chess.com/game/live/123456789' : '', white: { username: white }, black: { username: black } }, result: { game: parsed, positions, moves, summary: { w: { accuracy: 82 }, b: { accuracy: 94 } } }, ply, active: true, moveReactionsActive: true };
  view.setContext(state);
}
function go(ply) { state.ply = ply; view.setContext(state); }
load();
window.fixture = { load, go, dispose: () => view.dispose() };
`;
// Observe calls without replacing animation behavior in the copied extension fixture.
const motionProbe = String.raw`
import { createCoachMotion as original } from './coach-motion.js';
export function createCoachMotion(options) {
  const motion = original(options);
  return { ...motion, react(image, args) {
    const accepted = motion.react(image, args);
    (window.fixtureReactions ||= []).push({ kind: args.kind, grade: args.grade, accepted, at: performance.now() });
    return accepted;
  } };
}
`;
const plainText = locator => locator.evaluate(element => {
  const copy = element.cloneNode(true);
  for (const move of copy.querySelectorAll('.move-notation')) move.replaceWith(document.createTextNode(move.dataset.san));
  return copy.textContent;
});
let context, page;
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'MeowlChess-coach-focus-fixture.html'), fixtureHtml);
  await writeFile(join(extension, 'MeowlChess-coach-focus-fixture.js'), fixtureScript);
  await writeFile(join(extension, 'lib', 'MeowlChess-coach-focus-motion-probe.js'), motionProbe);
  const viewPath = join(extension, 'lib', 'coach-view.js');
  await writeFile(viewPath, (await readFile(viewPath, 'utf8')).replace("from './coach-motion.js'", "from './MeowlChess-coach-focus-motion-probe.js'"));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, viewport: { width: 1000, height: 1100 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  const errors = [], external = [];
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.fixtureWorkers = 0; window.fixtureAudio = 0; window.fixtureReactions = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.fixtureWorkers++; } };
    const nativeStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) { window.fixtureAudio++; return nativeStart.apply(this, args); };
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({
    coachPreferences: { coach: 'meowl', perspective: 'both', motion: false, sounds: false, commentary: true, volume: .8 },
    usernames: { chesscom: 'playercat', lichess: 'LichessCat' },
  }));
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`, url = `${origin}/MeowlChess-coach-focus-fixture.html`;
  page = await context.newPage(); await page.goto(url);
  const focus = page.getByLabel('Focus on', { exact: true });
  const playerSide = page.getByLabel('You played as', { exact: true });
  const hint = page.locator('.coach-focus-hint'), tip = page.locator('.coach-walkthrough');
  const setIdentity = async values => {
    await worker.evaluate(values => chrome.storage.local.set({ username: '', usernames: {}, siteReviewSettings: {}, savedAccounts: {}, ...values }), values);
  };
  const load = async values => page.evaluate(values => window.fixture.load(values), values);
  const go = async ply => page.evaluate(ply => window.fixture.go(ply), ply);
  const focusing = async text => page.waitForFunction(text => document.querySelector('.coach-focus-hint').textContent === text, text);
  const ask = async question => {
    const before = await page.locator('.coach-message[data-role="coach"]').count();
    await page.locator('.coach-question').fill(question); await page.locator('.coach-send').click();
    await page.waitForFunction(before => document.querySelectorAll('.coach-message[data-role="coach"]').length === before + 1, before);
    return plainText(page.locator('.coach-message[data-role="coach"] .coach-message-text').last());
  };
  const expectUnknown = async () => {
    await page.locator('.coach-blocked').waitFor({ state: 'visible' });
    assert.match(await page.locator('.coach-blocked').innerText(), /Choose.*player.*You played as/i);
    assert(await page.locator('.coach-question').isDisabled());
    assert.equal(await playerSide.inputValue(), '');
    assert(await playerSide.locator('option[value=""]').isDisabled());
    assert.equal(await tip.isVisible(), false);
  };

  await tip.waitFor({ state: 'visible' });
  assert.deepEqual(await focus.locator('option').evaluateAll(items => items.map(item => item.value)), ['both', 'me', 'opponent', 'w', 'b']);
  assert.equal(await playerSide.isVisible(), false);
  await focus.selectOption('me'); await focusing('Focusing on PlayerCat (White).');
  assert.match(await playerSide.locator('option[value=""]').innerText(), /Auto.*PlayerCat.*White/);
  await tip.waitFor({ state: 'visible' });
  assert.match(await plainText(page.locator('.coach-walkthrough-heading')), /Nf3/);
  await go(4); await tip.waitFor({ state: 'hidden' });
  await focus.selectOption('opponent'); await focusing('Focusing on OtherOwl (Black).');
  await tip.waitFor({ state: 'visible' });
  assert.match(await plainText(page.locator('.coach-walkthrough-heading')), /Nc6/);
  assert.match(await ask('What was the biggest mistake?'), /Nc6 \(Black\)/);
  assert.match(await ask('What was my biggest mistake?'), /Nf3 \(White\)/);
  assert.match(await ask("What was my opponent's biggest mistake?"), /Nc6 \(Black\)/);
  const summary = await ask('Summarize this game');
  assert.match(summary, /Black: study score/); assert.doesNotMatch(summary, /White: study score/);
  await page.waitForFunction(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences.perspective === 'opponent');
  await page.reload(); await focusing('Focusing on OtherOwl (Black).');
  assert.equal(await focus.inputValue(), 'opponent', 'Relative focus survives reload without becoming a fixed color.');
  await load({ white: 'OtherOwl', black: 'PlayerCat' }); await focusing('Focusing on OtherOwl (White).');
  assert.match(await ask('What was the biggest mistake?'), /Nf3 \(White\)/);
  assert.match(await ask('What was my biggest mistake?'), /Nc6 \(Black\)/);
  await focus.selectOption('me'); await focusing('Focusing on PlayerCat (Black).');
  await tip.waitFor({ state: 'hidden' }); await go(4); await tip.waitFor({ state: 'visible' });

  // Each site's remembered accounts stay separate, including the legacy Chess.com setting.
  await load({ white: 'PlayerCat', black: 'LichessCat', source: 'lichess' }); await focusing('Focusing on LichessCat (Black).');
  await setIdentity({ username: 'PlayerCat', usernames: { chesscom: 'PlayerCat' } }); await expectUnknown();
  await load({ white: 'PlayerCat', black: 'OtherOwl', source: 'chesscom' }); await focusing('Focusing on PlayerCat (White).');
  await setIdentity({ username: 'PlayerCat' }); await focusing('Focusing on PlayerCat (White).');
  await load({ white: 'PlayerCat', black: 'OtherOwl', source: 'lichess' }); await expectUnknown();
  await setIdentity({ siteReviewSettings: { lichess: { username: 'OtherOwl', enabled: true }, chesscom: { username: 'PlayerCat' } } });
  await focusing('Focusing on OtherOwl (Black).');
  await setIdentity({ savedAccounts: { lichess: ['PlayerCat'], chesscom: ['OtherOwl'] } });
  await focusing('Focusing on PlayerCat (White).');
  await tip.waitFor({ state: 'visible' });
  await setIdentity({ savedAccounts: { lichess: ['OtherOwl'], chesscom: ['PlayerCat'] } });
  await focusing('Focusing on OtherOwl (Black).'); await tip.waitFor({ state: 'hidden' });

  // A pasted game with no matching account uses an explicit side for this game only.
  await setIdentity({});
  await load({ white: 'UnknownWhite', black: 'UnknownBlack', source: 'pgn' }); await expectUnknown();
  await playerSide.selectOption('w'); await focusing('Focusing on UnknownWhite (White).');
  assert.equal(await page.locator('.coach-question').isDisabled(), false);
  await focus.selectOption('opponent'); await focusing('Focusing on UnknownBlack (Black).');
  assert.match(await ask('What was the biggest mistake?'), /Nc6 \(Black\)/);
  assert.match(await ask('What was my biggest mistake?'), /Nf3 \(White\)/);
  await playerSide.selectOption('b'); await focusing('Focusing on UnknownWhite (White).');
  assert.match(await ask('What was my biggest mistake?'), /Nc6 \(Black\)/);
  await go(4); assert.equal(await playerSide.inputValue(), 'b', 'A move change preserves the per-game manual side.');
  const stored = await worker.evaluate(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences);
  assert.equal(stored.perspective, 'opponent');
  assert.equal('playerSide' in stored, false, 'The resolved player color must not leak into global preferences.');
  assert.equal('manualPlayerSide' in stored, false);
  await load({ white: 'AnotherWhite', black: 'AnotherBlack', source: 'pgn', suffix: '2' }); await expectUnknown();
  await focus.selectOption('w'); assert.equal(await page.locator('.coach-question').isDisabled(), false);
  assert.equal(await playerSide.isVisible(), false);
  assert.match(await ask('What was the biggest mistake?'), /Nf3 \(White\)/);
  const unknownPersonal = await ask('What was my biggest mistake?');
  assert.match(unknownPersonal, /player|White|Black/i); assert.doesNotMatch(unknownPersonal, /rated Blunder|rated Mistake/);
  await focus.selectOption('b'); assert.match(await ask('What was the biggest mistake?'), /Nc6 \(Black\)/);
  await focus.selectOption('both');
  const bothSummary = await ask('Summarize this game');
  assert.match(bothSummary, /White: study score/); assert.match(bothSummary, /Black: study score/);

  // Real motion still plays for an included Brilliant; the other side causes no reaction.
  await setIdentity({ usernames: { chesscom: 'PlayerCat' } });
  await load({ ply: 0 }); await focus.selectOption('me'); await focusing('Focusing on PlayerCat (White).');
  await worker.evaluate(async () => {
    const { coachPreferences } = await chrome.storage.local.get('coachPreferences');
    await chrome.storage.local.set({ coachPreferences: { ...coachPreferences, motion: true, commentary: false } });
  });
  await page.waitForFunction(() => document.querySelector('.coach-motion-toggle').checked && !document.querySelector('.coach-commentary-toggle').checked);
  await page.evaluate(() => { window.fixtureReactions = []; }); await go(2);
  assert.equal(await page.evaluate(() => window.fixtureReactions.length), 0, 'An opponent Brilliant does not celebrate while focusing Me.');
  await go(1);
  await page.waitForFunction(() => window.fixtureReactions.some(item => item.kind === 'brilliant' && item.accepted));
  await page.locator('.coach-reaction-puppet').first().waitFor({ state: 'visible' });
  assert(await page.locator('.coach-reaction-puppet').first().evaluate(canvas => canvas.width > 0 && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)));
  await focus.selectOption('opponent'); await page.evaluate(() => { window.fixtureReactions = []; });
  await go(0); await go(1); assert.equal(await page.evaluate(() => window.fixtureReactions.length), 0);
  await go(2); await page.waitForFunction(() => window.fixtureReactions.some(item => item.kind === 'brilliant' && item.accepted));

  await worker.evaluate(async () => {
    const { coachPreferences } = await chrome.storage.local.get('coachPreferences');
    await chrome.storage.local.set({ coachPreferences: { ...coachPreferences, motion: false, commentary: true } });
  });
  await load({ white: 'A_Player_With_A_Very_Long_Chess_Username', black: 'Another_Player_With_A_Long_Chess_Username', source: 'pgn' });
  await expectUnknown(); await playerSide.selectOption('w');
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  for (const selector of ['.coach-perspective', '.coach-player-side', '.coach-focus-hint']) {
    const box = await page.locator(selector).boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 376, `${selector} fits the narrow screen.`);
  }
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-focus-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => window.fixtureWorkers), 0);
  assert.equal(await page.evaluate(() => window.fixtureAudio), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: relative focus persistence, changing colors and sites, actual-player pronouns, immediate tips/reactions, live account changes, per-game manual fallback, fixed-color options and narrow layout.');
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absoluteBundle = resolve(bundle);
  if (dirname(absoluteBundle) === temporaryRoot && basename(absoluteBundle).startsWith(bundlePrefix)) await rm(absoluteBundle, { recursive: true, force: true, maxRetries: 3 });
}
