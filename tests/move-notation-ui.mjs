import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { Chess } from '../extension/vendor/chess.js';
import { openImport, openMoves, openEngine, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-notation-test-'));
const pgn = '[Event "Move symbols"]\n[White "White symbols"]\n[Black "Black symbols"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 11. Qf3 Be7 12. Rfe1 Be6 13. Rad1 Qc7 14. Kh1 Kh8 15. Re2 Rfe8 1/2-1/2';
const game = new Chess(); game.loadPgn(pgn);
const moves = game.history({ verbose: true });

// SAN text outside the replaced piece letters must remain intact, including
// disambiguation, captures, promotion equals signs and check/mate suffixes.
async function assertNotation(locator, san, color) {
  assert.equal(await locator.count(), 1, `One notation element for ${san}`);
  const actual = await locator.evaluate(el => ({
    san: el.dataset.san, label: el.getAttribute('aria-label'), role: el.getAttribute('role'),
    text: [...el.childNodes].filter(node => !(node.nodeType === 1 && node.matches('.notation-piece'))).map(node => node.textContent).join(''),
    icons: [...el.querySelectorAll('.notation-piece')].map(piece => ({ piece: piece.dataset.piece, color: piece.dataset.color, svg: piece instanceof SVGElement, path: !!piece.querySelector('path[d]')?.getAttribute('d'), hidden: piece.getAttribute('aria-hidden') }))
  }));
  const letters = [...san.matchAll(/^[NBRQK]|(?<==)[NBRQ]/g)].map(match => match[0].toLowerCase());
  assert.deepEqual({ san: actual.san, label: actual.label, role: actual.role }, { san, label: san, role: 'img' });
  assert.equal(actual.text, san.replace(/^[NBRQK]|(?<==)[NBRQ]/g, ''), `SAN suffix must survive for ${san}`);
  assert.deepEqual(actual.icons, letters.map(piece => ({ piece, color, svg: true, path: true, hidden: 'true' })), `Actual moving side determines the ${san} icon`);
}

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
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.engineCommands = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(command, ...args) { if (typeof command === 'string') window.engineCommands.push(command); return send.call(this, command, ...args); };
  });
  const fen = async () => (await page.locator('#board').getAttribute('aria-label')).split('FEN: ')[1];
  const importGame = async text => {
    await openImport(page); await page.locator('#pgn-text').fill(text); await page.locator('#import-button').click();
    await page.waitForFunction(() => !document.querySelector('#library-dialog').open);
    await openMoves(page);
  };
  const notation = ply => page.locator(`#move-list .move-button[data-ply="${ply}"] .move-notation`);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/review.html`);

  stage = 'legal imported SAN, side-specific symbols and navigation';
  await importGame(pgn);
  assert.equal(await page.locator('#move-list .move-button').count(), moves.length);
  const seen = new Set();
  for (let index = 0; index < moves.length; index++) {
    const move = moves[index];
    await assertNotation(notation(index + 1), move.san, move.color);
    if (/^[NBRQK]/.test(move.san)) seen.add(move.color + move.piece);
    await page.locator(`#move-list .move-button[data-ply="${index + 1}"]`).click();
    assert.equal(await fen(), move.after);
    await assertNotation(page.locator('#position-label .move-notation'), move.san, move.color);
    assert.match(await page.locator(`#move-list .move-button[data-ply="${index + 1}"]`).getAttribute('aria-label'), new RegExp(move.san.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.deepEqual([...seen].sort(), ['wb', 'wk', 'wn', 'wq', 'wr', 'bb', 'bk', 'bn', 'bq', 'br'].sort());
  for (const piece of ['n', 'b', 'r', 'q', 'k']) {
    const shape = async color => page.locator(`#move-list .notation-piece[data-piece="${piece}"][data-color="${color}"]`).first().evaluate(el => [...el.querySelectorAll('path')].map(path => path.getAttribute('d')).join(' '));
    assert.notEqual(await shape('w'), await shape('b'), `${piece} must use distinct filled and outlined shapes, not just different side metadata.`);
  }
  assert.equal(await page.evaluate(() => window.engineCommands.length), 0, 'Rendering SAN must not start the engine.');
  const beforeFlip = await page.locator('#move-list').innerHTML();
  await page.locator('#flip-button').click();
  assert.equal(await page.locator('#move-list').innerHTML(), beforeFlip);
  assert.equal(await fen(), moves.at(-1).after);
  await assertNotation(page.locator('#position-label .move-notation'), moves.at(-1).san, 'b');
  await page.locator('#flip-button').click();
  console.log('PASS: both sides have all five piece symbols; pawn/capture/disambiguation/castling SAN and every move FEN stay correct when flipped');

  stage = 'review insights, engine choices and legal engine variations';
  await page.locator('#review-settings > summary').click();
  await page.locator('#engine').selectOption('stockfish'); await page.locator('#depth').selectOption('50');
  await page.locator('#multipv').selectOption('3'); await page.locator('#smart-analysis').uncheck();
  await page.locator('#review-settings > summary').click(); await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Review complete/.test(document.querySelector('#review-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 45000 });
  await openMoves(page);
  let choices = 0;
  for (let index = 0; index < moves.length; index++) {
    const move = moves[index];
    await page.locator(`#move-list .move-button[data-ply="${index + 1}"]`).click();
    await assertNotation(notation(index + 1), move.san, move.color);
    await assertNotation(page.locator('#insight-title .move-notation'), move.san, move.color);
    if (await page.locator('#best-move').isVisible()) {
      const best = page.locator('#best-move .move-notation'), san = await best.getAttribute('data-san');
      assert(new Chess(move.before).move(san), 'Displayed engine choice must be legal before the played move.');
      await assertNotation(best, san, move.color); choices++;
    }
  }
  assert(choices > 0, 'The fixture must expose at least one alternative engine choice.');
  await page.locator('#move-list .move-button[data-ply="3"]').click(); await openEngine(page);
  const lineCount = await page.locator('#engine-lines .engine-line').count();
  assert(lineCount > 0);
  let lineSymbols = 0;
  for (let index = 0; index < lineCount; index++) {
    const line = page.locator('#engine-lines .engine-line').nth(index), chess = new Chess(await fen());
    const nodes = line.locator('.move-notation'), count = await nodes.count(); assert(count > 0);
    for (let ply = 0; ply < count; ply++) {
      const san = await nodes.nth(ply).getAttribute('data-san');
      const color = chess.turn(), move = chess.move(san); assert(move, `Engine SAN ${san} must be legal`);
      await assertNotation(nodes.nth(ply), san, color); lineSymbols += await nodes.nth(ply).locator('.notation-piece').count();
      if (ply === 0) assert.equal(move.from + move.to + (move.promotion || ''), await line.getAttribute('data-uci'));
    }
  }
  assert(lineSymbols > 0, 'Engine lines must exercise figurines.');
  const firstLine = page.locator('#engine-lines .engine-line').first();
  const firstSan = await firstLine.locator('.move-notation').first().getAttribute('data-san');
  const expected = new Chess(await fen()); const variationMove = expected.move(firstSan);
  await firstLine.click(); assert.equal(await fen(), expected.fen());
  await assertNotation(page.locator('#position-label .move-notation'), firstSan, variationMove.color);
  await page.locator('#return-game').click(); assert.equal(await fen(), moves[2].after);
  console.log('PASS: reviewed insights, engine choices and legal engine lines retain SAN and moving-side symbols; candidate clicks navigate correctly');

  stage = 'responsive move-list presentation';
  await page.locator('#move-list .move-button[data-ply="23"]').click();
  await page.locator('.move-section').screenshot({ path: join(root, 'test-results', 'move-notation-desktop.png') });
  await page.screenshot({ path: join(root, 'test-results', 'move-notation-review-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#move-list .move-button[data-ply="23"]').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#move-list').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.locator('.move-section').screenshot({ path: join(root, 'test-results', 'move-notation-mobile.png') });
  await page.setViewportSize({ width: 1366, height: 900 });

  stage = 'both-side promotions, checks, mate and long castling';
  const fixtures = [];
  for (const color of ['w', 'b']) for (const promotion of ['q', 'r', 'b', 'n']) {
    const initial = color === 'w' ? '1r5k/P7/8/8/8/8/8/7K w - - 0 27' : '7k/8/8/8/8/8/p7/1R5K b - - 0 27';
    const chess = new Chess(initial), move = chess.move({ from: color === 'w' ? 'a7' : 'a2', to: color === 'w' ? 'b8' : 'b1', promotion });
    fixtures.push({ initial, moves: [move], result: color === 'w' ? '1-0' : '0-1' });
  }
  const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const castleInitial = castle.fen(); const whiteCastle = castle.move('O-O-O'), blackCastle = castle.move('O-O');
  fixtures.push({ initial: castleInitial, moves: [whiteCastle, blackCastle], result: '1/2-1/2' });
  const mate = new Chess(); mate.loadPgn('1. f3 e5 2. g4 Qh4# 0-1');
  fixtures.push({ initial: new Chess().fen(), moves: mate.history({ verbose: true }), result: '0-1' });
  const searchesBeforeImports = await page.evaluate(() => window.engineCommands.filter(command => command.startsWith('go ')).length);
  for (const fixture of fixtures) {
    const notationText = fixture.moves.map(move => `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '...'} ${move.san}`).join(' ');
    await importGame(`[Event "Notation edge cases"]\n[SetUp "1"]\n[FEN "${fixture.initial}"]\n[Result "${fixture.result}"]\n\n${notationText} ${fixture.result}`);
    for (let index = 0; index < fixture.moves.length; index++) {
      const move = fixture.moves[index]; await assertNotation(notation(index + 1), move.san, move.color);
      await page.locator(`#move-list .move-button[data-ply="${index + 1}"]`).click(); assert.equal(await fen(), move.after);
      await assertNotation(page.locator('#position-label .move-notation'), move.san, move.color);
    }
  }
  assert.equal(await page.evaluate(() => window.engineCommands.filter(command => command.startsWith('go ')).length), searchesBeforeImports);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: every promotion piece for each side, capture/promotion/check/mate suffixes and long castling survive real PGN import and navigation');
  console.log('Move notation browser checks passed.');
} catch (error) {
  console.error('Move notation failure stage:', stage, error);
  if (page) await page.screenshot({ path: join(root, 'test-results', 'move-notation-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await closeTestContext(context, profile, 'meowlchess-notation-test-');
}
