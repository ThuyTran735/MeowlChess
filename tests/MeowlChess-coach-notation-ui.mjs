import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { Chess } from '../extension/vendor/chess.js';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-coach-notation-test-', bundlePrefix = 'MeowlChess-coach-notation-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const pgn = '[Event "Coach notation"]\n[White "Nf3"]\n[Black "O-O"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 1/2-1/2';
const repeatPgn = '[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';
const matePgn = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const fixtureHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeowlChess coach notation</title><link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><link rel="stylesheet" href="workspace.css"><style>body{margin:0;padding:20px}main{width:min(100%,700px);margin:auto}.fixture-title{font-size:20px;margin:0 0 16px}#coach-root{padding:18px;border:1px solid #ffffff18;border-radius:16px;background:#242920}@media(max-width:500px){body{padding:10px}#coach-root{padding:12px}}</style><main><h1 class="fixture-title">MeowlChess · Coach</h1><section id="coach-root"></section></main><script type="module" src="MeowlChess-coach-notation-fixture.js"></script></html>`;
const fixtureScript = String.raw`
import { Chess } from './vendor/chess.js';
import { parseGame } from './lib/review.js';
import { createCoachView } from './lib/coach-view.js';
import { answerCoach, describeCoachMove } from './lib/coach.js';
let context = null, view = null;
function setPly(ply) { context.ply = ply; view.setContext(context); }
window.fixture = {
  load(pgn, options = {}) {
    view?.dispose();
    const parsed = parseGame(pgn);
    const positions = parsed.positions.map((fen, i) => {
      const board = new Chess(fen), next = parsed.moves[i];
      const bestMove = next ? next.from + next.to + (next.promotion || '') : null;
      return { cp: board.isCheckmate() ? board.turn() === 'w' ? -100000 : 100000 : 0, mate: board.isCheckmate() ? 0 : null, depth: 16, bestMove, pv: bestMove ? [bestMove] : [] };
    });
    const moves = parsed.moves.map((move, i) => ({ ...move, ply: i + 1, label: options.labels?.[i] || 'Best', probabilityLoss: 0, loss: 0, accuracy: 100, bestSan: move.san, evalAfter: positions[i + 1] }));
    for (const [key, value] of Object.entries(options.positions || {})) positions[Number(key)] = value;
    context = { game: { pgn, white: { username: parsed.headers.White || 'White' }, black: { username: parsed.headers.Black || 'Black' } }, result: { game: parsed, positions, moves, summary: { w: { accuracy: 100, counts: {} }, b: { accuracy: 100, counts: {} } }, ...(options.opening ? { opening: options.opening } : {}) }, ply: options.ply || 0, active: true, moveReactionsActive: false };
    view = createCoachView(document.querySelector('#coach-root'), { onNavigate: target => { window.fixtureNavigation = target; setPly(target.ply); } });
    view.setContext(context);
  },
  setPly,
  answer(question, coach = 'meowl') { return answerCoach({ ...context, question, coach }); },
  describe(coach = 'meowl') { return describeCoachMove({ ...context, coach }); },
  dispose() { view?.dispose(); },
};
`;

// The SVG replaces only the piece letter. The original SAN stays accessible,
// while pawn and castle icons are opt-in for coach prose.
async function assertNotation(locator, san, color) {
  assert.equal(await locator.count(), 1, `One notation span for ${san}`);
  const actual = await locator.evaluate(element => ({
    san: element.dataset.san, label: element.getAttribute('aria-label'), role: element.getAttribute('role'),
    text: [...element.childNodes].filter(node => !(node.nodeType === 1 && node.matches('.notation-piece'))).map(node => node.textContent).join(''),
    icons: [...element.querySelectorAll('.notation-piece')].map(icon => ({ piece: icon.dataset.piece, color: icon.dataset.color, hidden: icon.getAttribute('aria-hidden'), path: !!icon.querySelector('path[d]')?.getAttribute('d') })),
  }));
  const leading = /^[KQRBN]/.test(san) ? san[0].toLowerCase() : /^O-O/.test(san) ? 'k' : 'p';
  const pieces = [leading, ...[...san.matchAll(/=([QRBN])/g)].map(match => match[1].toLowerCase())];
  assert.deepEqual({ san: actual.san, label: actual.label, role: actual.role }, { san, label: san, role: 'img' });
  assert.equal(actual.text, san.replace(/^[KQRBN]|(?<==)[QRBN]/g, ''), `Capture/check/promotion/castle suffix remains intact for ${san}`);
  assert.deepEqual(actual.icons, pieces.map(piece => ({ piece, color, hidden: 'true', path: true })), `The actual mover determines the symbols for ${san}`);
}

let context, page, stage = 'launch';
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'MeowlChess-coach-notation-fixture.html'), fixtureHtml);
  await writeFile(join(extension, 'MeowlChess-coach-notation-fixture.js'), fixtureScript);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [], external = [];
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ coachPreferences: { coach: 'meowl', perspective: 'both', motion: false, sounds: false, commentary: true } }));
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureEngineStarts = 0; window.fixtureSounds = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.fixtureEngineStarts++; } };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) { window.fixtureSounds++; return play.apply(this, args); };
  });
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  await page.goto(`${origin}/MeowlChess-coach-notation-fixture.html`);
  await page.waitForFunction(() => !!window.fixture);
  const load = async (pgn, options = {}) => { await page.evaluate(({ pgn, options }) => fixture.load(pgn, options), { pgn, options }); await page.locator('.coach-question').waitFor({ state: 'visible' }); };
  const answers = () => page.locator('.coach-message[data-role="coach"]');
  const ask = async question => {
    const before = await answers().count();
    await page.locator('.coach-question').fill(question); await page.locator('.coach-send').click();
    await page.waitForFunction(before => document.querySelectorAll('.coach-message[data-role="coach"]').length === before + 1, before);
    return answers().last();
  };
  const plainText = locator => locator.evaluate(element => { const clone = element.cloneNode(true); for (const item of clone.querySelectorAll('.move-notation')) item.replaceWith(document.createTextNode(item.dataset.san)); return clone.textContent; });
  const verifyAnswer = async (reply, question, coach = 'meowl') => {
    const answer = await page.evaluate(({ question, coach }) => fixture.answer(question, coach), { question, coach });
    assert.equal(await plainText(reply.locator('.coach-message-text')), answer.text, 'Rendering preserves the plain answer used for speaking duration and other consumers.');
    assert(!/[\uE000-\uF8FF]/.test(answer.text), 'Internal notation markers never leak into answer text.');
    for (const item of answer.notation || []) {
      assert.equal(answer.text.slice(item.start, item.end), item.san, 'Notation metadata still points at the SAN after personality decoration.');
    }
    return answer;
  };
  const matching = (surface, san) => surface.locator(`.move-notation[data-san="${san}"]`);
  await mkdir(join(root, 'test-results'), { recursive: true });

  stage = 'malformed or unrelated notation metadata remains literal';
  const invalidRenderings = await page.evaluate(async () => {
    const { renderCoachText } = await import('./lib/coach-notation.js');
    const text = 'Nf3 <img src=x> Nc6';
    return [
      [{ start: 0, end: 3, san: 'Nf3', color: 'unknown' }],
      [{ start: -1, end: 3, san: 'Nf3', color: 'w' }],
      [{ start: 0, end: 99, san: 'Nf3', color: 'w' }],
      [{ start: 0, end: 3, san: 'Nc6', color: 'b' }],
      [{ start: 4, end: 15, san: '<img src=x>', color: 'w' }],
      null,
    ].map(notation => {
      const node = document.createElement('div'); node.append(renderCoachText(text, notation));
      return { text: node.textContent, icons: node.querySelectorAll('.move-notation').length, images: node.querySelectorAll('img').length };
    });
  });
  for (const item of invalidRenderings) assert.deepEqual(item, { text: 'Nf3 <img src=x> Nc6', icons: 0, images: 0 });

  stage = 'walkthrough and engine continuation use actual moving colors';
  await load(pgn, { ply: 3, labels: { 2: 'Mistake', 3: 'Great' }, positions: { 2: { cp: 10, mate: null, depth: 16, bestMove: 'f1c4', pv: ['f1c4', 'b8c6', 'd2d3'] } } });
  await page.locator('.coach-walkthrough[data-ply="3"]').waitFor({ state: 'visible' });
  await assertNotation(matching(page.locator('.coach-context'), 'Nf3'), 'Nf3', 'w');
  await assertNotation(matching(page.locator('.coach-walkthrough-heading'), 'Nf3'), 'Nf3', 'w');
  await assertNotation(matching(page.locator('.coach-walkthrough-next'), 'Nc6'), 'Nc6', 'b');
  const question = 'What was better than 2. Nf3?';
  let reply = await ask(question); await verifyAnswer(reply, question);
  const prose = reply.locator('.coach-message-text');
  for (const [san, color] of [['Nf3', 'w'], ['Bc4', 'w'], ['Nc6', 'b'], ['d3', 'w']]) {
    assert(await matching(prose, san).count() > 0, `${san} must be decorated in its actual context.`);
    for (const item of await matching(prose, san).all()) await assertNotation(item, san, color);
  }
  await assertNotation(matching(reply.locator('.coach-jump'), 'Nf3'), 'Nf3', 'w');
  await assertNotation(matching(page.locator('.coach-suggestions'), 'Nf3').first(), 'Nf3', 'w');
  assert.equal(await page.locator('.coach-message[data-role="user"] .move-notation').count(), 0);
  const suggestion = page.locator('.coach-suggestion[data-question*="Nf3"]').first();
  const suggestedQuestion = await suggestion.getAttribute('data-question');
  await suggestion.click();
  assert.equal(await page.locator('.coach-message[data-role="user"] .coach-message-text').last().textContent(), suggestedQuestion, 'Figurine follow-up buttons still submit their original SAN question.');
  await verifyAnswer(answers().last(), suggestedQuestion);
  await page.locator('.coach-walkthrough-next').click();
  await page.locator('.coach-walkthrough[data-ply="4"]').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => window.fixtureNavigation), { ply: 4, label: 'Next: 2... Nc6' }, 'Board navigation retains the full plain SAN label.');
  await assertNotation(matching(page.locator('.coach-context'), 'Nc6'), 'Nc6', 'b');
  await assertNotation(matching(page.locator('.coach-walkthrough-heading'), 'Nc6'), 'Nc6', 'b');
  console.log('PASS: walkthrough, chat, follow-up questions and navigation retain player/opponent colors, alternatives and PV pawn moves');

  stage = 'all selectable personalities retain metadata after their prose';
  for (const coach of ['owl', 'paws', 'mellow', 'scout', 'meowl']) {
    await page.locator(`.coach-choice[data-coach="${coach}"]`).click();
    const q = 'Explain 2... Nc6'; reply = await ask(q); await verifyAnswer(reply, q, coach);
    for (const item of await matching(reply.locator('.coach-message-text'), 'Nc6').all()) await assertNotation(item, 'Nc6', 'b');
    await assertNotation(matching(reply.locator('.coach-jump'), 'Nc6'), 'Nc6', 'b');
  }

  stage = 'literal prose and user messages cannot create icons or HTML';
  await load(pgn, { opening: { name: 'Nf3 O-O <img src=x onerror=alert(1)> opening', eco: 'B00' } });
  reply = await ask('What opening is this?');
  assert((await reply.locator('.coach-message-text').innerText()).includes('Nf3 O-O <img src=x onerror=alert(1)> opening'));
  assert.equal(await reply.locator('.coach-message-text .move-notation, .coach-message-text img').count(), 0, 'Untrusted names and prose are never scanned as SAN or HTML.');
  const user = '<img src="https://invalid.example/test" onerror="window.coachInjected=true"> Nf3 O-O a8=Q+';
  await ask(user);
  const userMessage = page.locator('.coach-message[data-role="user"]').last().locator('.coach-message-text');
  assert.equal(await userMessage.textContent(), user); assert.equal(await userMessage.locator('img,.move-notation').count(), 0);
  assert.equal(await page.evaluate(() => !!window.coachInjected), false);

  stage = 'ambiguous repeated moves retain separate navigation targets';
  await load(repeatPgn); reply = await ask('Explain Nf3');
  assert.match(await reply.locator('.coach-message-text').innerText(), /more than one position/);
  assert.deepEqual(await reply.locator('.coach-jump').evaluateAll(items => items.map(item => Number(item.dataset.ply))), [1, 5]);
  for (const item of await matching(reply.locator('.coach-jumps'), 'Nf3').all()) await assertNotation(item, 'Nf3', 'w');
  await reply.locator('.coach-jump[data-ply="5"]').click();
  await page.locator('.coach-walkthrough[data-ply="5"]').waitFor({ state: 'visible' });
  assert.match(await plainText(page.locator('.coach-context')), /3\. Nf3/);

  stage = 'both-side promotions, capture/check suffixes, castle kings and checkmate';
  for (const color of ['w', 'b']) for (const promotion of ['q', 'r', 'b', 'n']) {
    const initial = color === 'w' ? '1r5k/P7/8/8/8/8/8/7K w - - 0 27' : '7k/8/8/8/8/8/p7/1R5K b - - 0 27';
    const chess = new Chess(initial), move = chess.move({ from: color === 'w' ? 'a7' : 'a2', to: color === 'w' ? 'b8' : 'b1', promotion });
    const outcome = color === 'w' ? '1-0' : '0-1';
    await load(`[SetUp "1"]\n[FEN "${initial}"]\n[Result "${outcome}"]\n\n27${color === 'w' ? '.' : '...'} ${move.san} ${outcome}`, { ply: 1 });
    const q = `Explain 27${color === 'w' ? '.' : '...'} ${move.san}`;
    reply = await ask(q); await verifyAnswer(reply, q);
    await assertNotation(matching(reply.locator('.coach-message-text'), move.san).first(), move.san, color);
    await assertNotation(matching(reply.locator('.coach-jump'), move.san), move.san, color);
  }
  await load('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n[Result "1/2-1/2"]\n\n1. O-O-O O-O 1/2-1/2');
  for (const [number, san, color] of [['1.', 'O-O-O', 'w'], ['1...', 'O-O', 'b']]) {
    reply = await ask(`Explain ${number} ${san}`);
    await assertNotation(matching(reply.locator('.coach-message-text'), san).first(), san, color);
  }
  await load(matePgn, { ply: 4 }); reply = await ask('Explain 2... Qh4#');
  await assertNotation(matching(reply.locator('.coach-message-text'), 'Qh4#').first(), 'Qh4#', 'b');
  assert.match(await plainText(reply.locator('.coach-message-text')), /checkmate/);
  console.log('PASS: promotions, underpromotions, captures, checks, mate and both castling symbols preserve SAN and accessibility');

  stage = 'desktop and narrow mobile coach layout';
  await load(pgn, { ply: 3, labels: { 2: 'Mistake', 3: 'Great' }, positions: { 2: { cp: 10, mate: null, depth: 16, bestMove: 'f1c4', pv: ['f1c4', 'b8c6', 'd2d3'] } } });
  await ask(question); await page.locator('.coach-walkthrough[data-ply="3"]').waitFor({ state: 'visible' });
  for (const [name, viewport] of [['desktop', { width: 1000, height: 1000 }], ['mobile', { width: 375, height: 812 }]]) {
    await page.setViewportSize(viewport);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} has no horizontal overflow.`);
    const violations = await page.locator('.move-notation').evaluateAll(items => items.flatMap(item => {
      if (!item.getClientRects().length) return [];
      const bounds = item.getBoundingClientRect(), scope = item.closest('p,strong,button').getBoundingClientRect();
      return bounds.left < scope.left - 1 || bounds.right > scope.right + 1 || bounds.right > innerWidth + 1 ? [item.dataset.san] : [];
    }));
    assert.deepEqual(violations, [], `${name} inline notation stays in its text or button.`);
    await page.screenshot({ path: join(root, 'test-results', `MeowlChess-coach-notation-${name}.png`), fullPage: true });
  }
  assert.equal(await page.evaluate(() => window.fixtureEngineStarts), 0, 'Notation rendering and chat do not start engines.');
  assert.equal(await page.evaluate(() => window.fixtureSounds), 0, 'The existing off-by-default sound preference remains respected.');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: no false prose/user icons, no external requests or engines, and coach fits desktop/mobile');
} catch (error) {
  console.error(`FAILED at ${stage}`);
  if (page) await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-notation-failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  if (page && !page.isClosed()) await page.evaluate(() => window.fixture?.dispose()).catch(() => {});
  await closeTestContext(context, profile, profilePrefix);
  const absolute = resolve(bundle);
  if (dirname(absolute) === temporaryRoot && basename(absolute).startsWith(bundlePrefix)) await rm(absolute, { recursive: true, force: true });
}
