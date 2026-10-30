import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGame, classifyMove, expectedScore, isSoundSacrifice, MOVE_LABELS, parseGame } from '../extension/lib/review.js';
import { Chess } from '../extension/vendor/chess.js';

const SHORT = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
const MATE = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const evaluation = (cp = 0, mate = null, bestMove = null) => ({ cp, mate, bestMove, pv: [], depth: 10 });

function fakeEngine(evaluations = []) {
  const calls = [];
  const engine = {
    initialized: false,
    disposed: false,
    async init(signal) { this.initialized = true; this.signal = signal; },
    async evaluate(fen, options) {
      calls.push({ fen, options });
      return evaluations[calls.length - 1] || evaluation();
    },
    dispose() { this.disposed = true; },
  };
  return { calls, engine, engineFactory: () => engine };
}

test('parses completed PGN into legal positions and verbose moves', () => {
  const game = parseGame(SHORT);
  assert.equal(game.headers.White, 'Alice');
  assert.equal(game.headers.Result, '1-0');
  assert.deepEqual(game.moves.map(move => move.san), ['e4', 'e5', 'Nf3']);
  assert.equal(game.positions.length, 4);
  assert.equal(game.positions[0], game.moves[0].before);
  assert.equal(game.positions[3], game.moves[2].after);
});

test('rejects ongoing, empty, invalid, oversized, and nonstandard games', () => {
  assert.throws(() => parseGame('[Result "*"]\n\n1. e4 *'), /Only completed/);
  assert.throws(() => parseGame('[Result "1-0"]\n\n1. e4 *'), /Only completed/);
  assert.throws(() => parseGame('[Result "1-0"]\n\n1-0'), /no moves/);
  assert.throws(() => parseGame('[Result "1-0"]\n\n1. e5 1-0'), /invalid PGN/);
  assert.throws(() => parseGame('x'.repeat(250001)), /oversized/);
  assert.throws(() => parseGame('[Variant "Chess960"]\n' + SHORT), /Only standard/);
});

test('classifications measure loss from either player perspective', () => {
  const labels = [[5, 'Excellent'], [40, 'Good'], [60, 'Inaccuracy'], [150, 'Mistake'], [400, 'Blunder']];
  for (const [loss, label] of labels) {
    const white = classifyMove(evaluation(0), evaluation(-loss), 'w', false);
    const black = classifyMove(evaluation(0), evaluation(loss), 'b', false);
    assert.equal(white.label, label);
    assert.equal(black.label, label);
    assert.equal(white.loss, loss);
    assert.equal(black.loss, loss);
    assert.ok(Math.abs(white.accuracy - black.accuracy) < 1e-10);
    assert.ok(white.accuracy >= 0 && white.accuracy <= 100);
  }
  const improvement = classifyMove(evaluation(0), evaluation(300), 'w', false);
  assert.equal(improvement.loss, 0);
  assert.equal(improvement.accuracy, 100);
  assert.equal(classifyMove(evaluation(0), evaluation(-60), 'w', true).label, 'Best');
});

function sacrificeFixture(color = 'w') {
  const fen = color === 'w'
    ? 'r1bq1rk1/pppnbppp/4p3/3p4/3P4/3BPN2/PPP2PPP/RNBQK2R w KQ - 0 1'
    : 'rnbqk2r/ppp2ppp/3bpn2/3p4/3P4/4P3/PPPNBPPP/R1BQ1RK1 b kq - 0 1';
  const move = new Chess(fen).move(color === 'w' ? 'Bxh7+' : 'Bxh2+');
  const before = { ...evaluation(color === 'w' ? 80 : -80), depth: 16 };
  const after = { ...before, pv: color === 'w' ? ['g8h7', 'f3g5', 'h7g8', 'd1h5'] : ['g1h2', 'f6g4', 'h2g1', 'd8h4'] };
  return { move, before, after };
}

test('Brilliant requires a sound engine-preferred piece sacrifice for either color', () => {
  for (const color of ['w', 'b']) {
    const { move, before, after } = sacrificeFixture(color);
    assert.equal(isSoundSacrifice(move, before, after), true);
    assert.equal(classifyMove(before, after, color, true, { move }).label, 'Brilliant');
    assert.notEqual(classifyMove(before, after, color, false, { move }).label, 'Brilliant');
  }
});

test('Brilliant rejects shallow, missing, losing, unstable, truncated, and illegal engine evidence', () => {
  const { move, before, after } = sacrificeFixture();
  const cases = [
    [{ ...before, depth: 8 }, after],
    [before, { ...after, depth: 8 }],
    [{ ...before, depth: undefined }, after],
    [before, { ...after, cp: -200 }],
    [before, { ...after, cp: 0 }],
    [{ ...before, cp: 900 }, { ...after, cp: 900 }],
    [{ ...before, mate: 3 }, after],
    [before, { ...after, pv: after.pv.slice(0, 3) }],
    [before, { ...after, pv: ['g8h7', 'f3g5', 'h7g8', 'd1h9'] }],
    [before, { ...after, pv: ['g8h8', 'f3g5', 'h8g8', 'd1h5'] }],
  ];
  for (const [prior, next] of cases) assert.equal(isSoundSacrifice(move, prior, next), false);
});

test('Brilliant rejects ordinary exchanges and material recovered in the continuation', () => {
  const before = { ...evaluation(80), depth: 16 };
  const exchange = new Chess('3qk3/8/8/8/8/8/8/3QK2R w K - 0 1').move('Qxd8+');
  assert.equal(isSoundSacrifice(exchange, before, { ...before, pv: ['e8d8', 'h1h8', 'd8d7', 'e1d2'] }), false);
  const temporary = new Chess('7k/pr6/1B6/8/8/8/8/R6K w - - 0 1').move('Rxa7');
  assert.equal(isSoundSacrifice(temporary, before, { ...before, pv: ['b7a7', 'b6a7', 'h8g8', 'h1g1'] }), false);
});

test('Great requires preserving a substantial opportunity, not just any best move', () => {
  const move = parseGame(SHORT).moves[2];
  const previousEvaluation = { ...evaluation(0), depth: 16 };
  const before = { ...evaluation(200), depth: 16 };
  const after = { ...before };
  assert.equal(classifyMove(before, after, 'w', true, { move, previousEvaluation }).label, 'Great');
  assert.equal(classifyMove(before, after, 'w', false, { move, previousEvaluation }).label, 'Excellent');
  assert.equal(classifyMove(before, after, 'w', true, { move }).label, 'Best');
  assert.equal(classifyMove(before, after, 'w', true, { move, previousEvaluation: before }).label, 'Best');
  assert.equal(classifyMove(before, { ...after, cp: 0 }, 'w', true, { move, previousEvaluation }).label, 'Best');
  assert.equal(classifyMove(before, after, 'w', true, { move, previousEvaluation: { ...previousEvaluation, depth: 4 } }).label, 'Best');
  assert.equal(classifyMove(before, after, 'w', true, { move, previousEvaluation, previousMove: { captured: 'n', to: move.to } }).label, 'Best');
});

test('review includes special classifications in summaries with explicit explanations', async () => {
  const { move, before, after } = sacrificeFixture();
  const pgn = `[SetUp "1"]\n[FEN "${move.before}"]\n[Result "1-0"]\n\n1. Bxh7+ 1-0`;
  const fixture = fakeEngine([{ ...before, bestMove: 'd3h7' }, after]);
  const result = await analyzeGame(pgn, { engineFactory: fixture.engineFactory });
  assert.equal(result.moves[0].label, 'Brilliant');
  assert.equal(result.summary.w.counts.Brilliant, 1);
  assert.equal(result.summary.w.accuracy, 100);
  assert.deepEqual(Object.keys(result.summary.w.counts), MOVE_LABELS);
  assert.match(result.moves[0].explanation, /offers a piece.*compensation/);
  assert.match(result.moves[0].explanation, /MeowlChess estimate/);
  const great = fakeEngine([
    { ...evaluation(0), depth: 16 }, { ...evaluation(0), depth: 16 },
    { ...evaluation(200, null, 'g1f3'), depth: 16 }, { ...evaluation(200), depth: 16 },
  ]);
  const second = await analyzeGame(SHORT, { engineFactory: great.engineFactory });
  assert.equal(second.moves[2].label, 'Great');
  assert.equal(second.summary.w.counts.Great, 1);
  assert.match(second.moves[2].explanation, /best reply.*opponent’s error/);
  assert.match(second.moves[2].explanation, /MeowlChess estimate/);
});

test('mate and checkmate scores respect their winning side', () => {
  assert.equal(expectedScore(evaluation(99700, 3), 'w'), 1);
  assert.equal(expectedScore(evaluation(99700, 3), 'b'), 0);
  assert.equal(expectedScore(evaluation(-99700, -3), 'w'), 0);
  assert.equal(expectedScore(evaluation(-100000, 0), 'b'), 1);
  assert.equal(classifyMove(evaluation(0), evaluation(-99900, -1), 'w', false).label, 'Blunder');
  assert.equal(classifyMove(evaluation(0), evaluation(99900, 1), 'b', false).label, 'Blunder');
});

test('review passes complete replay history and calculates player summaries', async () => {
  const fixture = fakeEngine([evaluation(0, null, 'e2e4'), evaluation(10, null, 'c7c5'), evaluation(400, null, 'g1f3'), evaluation(400)]);
  const progress = [];
  const controller = new AbortController();
  const result = await analyzeGame(SHORT, { engineFactory: fixture.engineFactory, moveTimeMs: 500, signal: controller.signal, onProgress: value => progress.push(value) });
  assert.equal(fixture.engine.initialized, true);
  assert.equal(fixture.engine.disposed, true);
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(fixture.calls.map(call => call.options.moves), [[], ['e2e4'], ['e2e4', 'e7e5'], ['e2e4', 'e7e5', 'g1f3']]);
  assert.ok(fixture.calls.every(call => call.options.initialFen === result.game.positions[0] && call.options.moveTimeMs === 500 && call.options.signal === controller.signal));
  assert.deepEqual(progress, [1, 2, 3, 4].map(completed => ({ completed, total: 4 })));
  assert.equal(result.moves[0].bestSan, 'e4');
  assert.equal(result.moves[1].bestSan, 'c5');
  assert.equal(result.moves[1].label, 'Blunder');
  assert.equal(result.summary.w.accuracy, 100);
  assert.equal(result.summary.w.counts.Best, 2);
  assert.equal(result.summary.b.counts.Blunder, 1);
  assert.match(result.moves[1].explanation, /Consider c5/);
});

test('checkmate resolves without evaluating the final position', async () => {
  const fixture = fakeEngine([evaluation(), evaluation(), evaluation(), evaluation(-99900, -1, 'd8h4')]);
  const result = await analyzeGame(MATE, { engineFactory: fixture.engineFactory });
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(result.positions[4], { cp: -100000, mate: 0, bestMove: null, pv: [], depth: 0 });
  assert.equal(result.moves[3].label, 'Best');
  assert.equal(result.moves[3].explanation, 'Qh4# delivers checkmate.');
  assert.equal(result.moves[2].label, 'Blunder');
  assert.match(result.moves[2].explanation, /forced mate for your opponent/);
});

test('stalemate is scored as a draw without evaluating the terminal position', async () => {
  const pgn = '[SetUp "1"]\n[FEN "k7/8/1QK5/8/8/8/8/8 w - - 0 1"]\n[Result "1/2-1/2"]\n\n1. Qc7 1/2-1/2';
  const fixture = fakeEngine([evaluation(900)]);
  const result = await analyzeGame(pgn, { engineFactory: fixture.engineFactory });
  assert.equal(fixture.calls.length, 1);
  assert.equal(result.positions[1].cp, 0);
  assert.equal(result.positions[1].mate, null);
  assert.equal(result.summary.b.accuracy, null);
});

test('repetition detection includes the entire replay', async () => {
  const pgn = '[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';
  const fixture = fakeEngine();
  const result = await analyzeGame(pgn, { engineFactory: fixture.engineFactory });
  assert.equal(fixture.calls.length, 8);
  assert.deepEqual(result.positions[8], { cp: 0, mate: null, bestMove: null, pv: [], depth: 0 });
});

test('a pre-cancelled review does not start an engine', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeGame(SHORT, { signal: controller.signal, engineFactory: () => { throw new Error('Should not create'); } }), { name: 'AbortError' });
});

test('cancellation during evaluation rejects and disposes the engine', async () => {
  const fixture = fakeEngine();
  const controller = new AbortController();
  fixture.engine.evaluate = async () => { controller.abort(); return evaluation(); };
  await assert.rejects(analyzeGame(SHORT, { engineFactory: fixture.engineFactory, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fixture.engine.disposed, true);
});

test('cancellation at the last progress callback does not return a completed review', async () => {
  const fixture = fakeEngine();
  const controller = new AbortController();
  await assert.rejects(analyzeGame(SHORT, { engineFactory: fixture.engineFactory, signal: controller.signal, onProgress: ({ completed, total }) => { if (completed === total) controller.abort(); } }), { name: 'AbortError' });
  assert.equal(fixture.engine.disposed, true);
});

test('initialization and evaluation failures always dispose the engine', async () => {
  for (const method of ['init', 'evaluate']) {
    const fixture = fakeEngine();
    fixture.engine[method] = async () => { throw new Error('Engine failure'); };
    await assert.rejects(analyzeGame(SHORT, { engineFactory: fixture.engineFactory }), /Engine failure/);
    assert.equal(fixture.engine.disposed, true);
  }
});
