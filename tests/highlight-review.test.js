import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGame, parseGame } from '../extension/lib/review.js';

const GIFT = '[SetUp "1"]\n[FEN "r1bq1rk1/pppnbppp/4p3/3p4/3P4/3BPN2/PPP2PPP/RNBQK2R w KQ - 0 1"]\n[Result "1-0"]\n\n1. Bxh7+ 1-0';
const TURN = '[SetUp "1"]\n[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]\n[Result "1-0"]\n\n2. Nf3 1-0';
const score = (cp, bestMove, depth = 16) => ({ cp, mate: null, depth, bestMove, pv: bestMove ? [bestMove] : [], candidates: [] });

function engineFixture(scan, deeper, { supportsMultiPV = true, failDeep = false } = {}) {
  const calls = [];
  const engine = {
    supportsMultiPV, disposed: false,
    async init() {},
    async evaluate(fen, options) {
      const index = options.moves.length;
      calls.push({ fen, ...options });
      if (calls.length > scan.length && failDeep) throw new Error('Deeper search failed');
      return structuredClone(calls.length <= scan.length ? scan[index] : deeper[index]);
    },
    dispose() { this.disposed = true; },
  };
  return { engine, calls, engineFactory: () => engine };
}

test('Fast mode confirms likely sacrifices with a deeper paired search and complete history', async () => {
  const scan = [score(80, 'd3h7', 8), score(80, 'g8h8', 8)];
  const deeper = scan.map(value => ({ ...value, depth: 16 }));
  const fixture = engineFixture(scan, deeper);
  const progress = [];
  const result = await analyzeGame(GIFT, { moveTimeMs: 50, engineFactory: fixture.engineFactory, onProgress: event => progress.push(event) });
  assert.deepEqual(fixture.calls.map(call => [call.moveTimeMs, call.multiPV]), [[50, 1], [50, 1], [2000, 2], [2000, 2]]);
  assert.deepEqual(fixture.calls.map(call => call.moves), [[], ['d3h7'], [], ['d3h7']]);
  assert(fixture.calls.every(call => call.initialFen === parseGame(GIFT).positions[0]));
  assert.equal(result.moves[0].label, 'Brilliant');
  assert.equal(result.summary.w.counts.Brilliant, 1);
  assert.deepEqual(result.analysis.highlightMoves, [1]);
  assert.equal(result.analysis.highlightPositionCount, 2);
  assert.equal(result.positions[0].depth, 16);
  assert.equal(progress.at(-1).phase, 'complete');
  assert(progress.some(event => event.phase === 'highlights'));
  assert(progress.every((event, index) => !index || event.completed / event.total >= progress[index - 1].completed / progress[index - 1].total));
  assert.equal(fixture.engine.disposed, true);
});

test('a shallow nominated only-good move needs coherent deeper alternatives to earn Great', async () => {
  const before = score(200, 'g1f3');
  before.candidates = [{ ...before, rank: 1 }, { ...score(-100, 'b1c3'), rank: 2 }];
  const after = score(200, 'b8c6');
  // The root already provides two coherent choices, but the following position
  // is shallow, so the quick scan alone cannot award Great.
  for (const supportsMultiPV of [true, false]) {
    const deepBefore = supportsMultiPV ? before : { ...before, candidates: [] };
    const fixture = engineFixture([before, { ...after, depth: 8 }], [deepBefore, after], { supportsMultiPV });
    const result = await analyzeGame(TURN, { moveTimeMs: 50, engineFactory: fixture.engineFactory, recognizeOpenings: false });
    assert.equal(result.moves[0].label, supportsMultiPV ? 'Great' : 'Best');
    assert(fixture.calls.slice(2).every(call => call.multiPV === (supportsMultiPV ? 2 : 1)));
  }
});

test('already confirmed deep highlights do not spend time repeating the search', async () => {
  const fixture = engineFixture([score(80, 'd3h7'), score(80, 'g8h8')], []);
  const result = await analyzeGame(GIFT, { moveTimeMs: 3000, engineFactory: fixture.engineFactory });
  assert.equal(result.moves[0].label, 'Brilliant');
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(result.analysis.highlightMoves, []);
});

test('turning highlight rechecks off skips extra searches and their reserved progress', async () => {
  const fixture = engineFixture([score(80, 'd3h7', 8), score(80, 'g8h8', 8)], [], { failDeep: true });
  const progress = [];
  const result = await analyzeGame(GIFT, { moveTimeMs: 50, highlightAnalysis: false, engineFactory: fixture.engineFactory, onProgress: event => progress.push(event) });
  assert.equal(fixture.calls.length, 2);
  assert(fixture.calls.every(call => call.moveTimeMs === 50 && call.multiPV === 1));
  assert.equal(result.analysis.highlightAnalysis, false);
  assert.equal(result.analysis.highlightTimeMs, 0);
  assert.equal(result.analysis.highlightPositionCount, 0);
  assert.deepEqual(result.analysis.highlightMoves, []);
  assert.equal(result.moves[0].label, 'Best');
  assert(!progress.some(event => event.phase === 'highlights'));
  assert(progress.every(event => event.total === 2));
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(fixture.engine.disposed, true);
});

test('highlight rechecks off keeps Brilliant and Great labels supported by the normal search', async () => {
  const brilliant = engineFixture([score(80, 'd3h7'), score(80, 'g8h8')], [], { failDeep: true });
  const result = await analyzeGame(GIFT, { highlightAnalysis: false, engineFactory: brilliant.engineFactory });
  assert.equal(result.moves[0].label, 'Brilliant'); assert.equal(brilliant.calls.length, 2);
  const before = score(200, 'g1f3');
  before.candidates = [{ ...before, rank: 1 }, { ...score(-100, 'b1c3'), rank: 2 }];
  const great = engineFixture([before, score(200, 'b8c6')], [], { failDeep: true });
  const other = await analyzeGame(TURN, { highlightAnalysis: false, engineFactory: great.engineFactory, recognizeOpenings: false });
  assert.equal(other.moves[0].label, 'Great'); assert.equal(great.calls.length, 2);
});

test('mistake rechecks remain independent when highlight rechecks are off', async () => {
  const evidence = [score(80, 'd3h7', 8), score(-400, 'g8h8', 8)];
  const fixture = engineFixture(evidence, evidence.map(value => ({ ...value, depth: 16 })));
  const progress = [];
  const result = await analyzeGame(GIFT, { moveTimeMs: 50, smartAnalysis: true, highlightAnalysis: false, engineFactory: fixture.engineFactory, onProgress: event => progress.push(event) });
  assert.equal(result.analysis.recheckedPositionCount, 2); assert.equal(result.analysis.highlightPositionCount, 0);
  assert.deepEqual(fixture.calls.map(call => call.moveTimeMs), [50, 50, 500, 500]);
  assert(progress.some(event => event.phase === 'recheck')); assert(!progress.some(event => event.phase === 'highlights'));
  assert.equal(progress.at(-1).total, 4);
});

test('a turning-point check includes the shallow position before the opponent error and its full history', async () => {
  const pgn = '[SetUp "1"]\n[FEN "r2qkb1r/p1pb1pp1/1pn2n1p/6Q1/4p3/2P1P1P1/PP1P1PBP/RNB1K1NR w KQkq - 0 9"]\n[Result "0-1"]\n\n9. Qf4 Bd6 0-1';
  const previous = score(-200, 'g5b5');
  const before = score(-511, 'f8d6');
  before.candidates = [{ ...score(-511, 'f8d6'), rank: 1 }, { ...score(-508, 'g7g5'), rank: 2 }];
  const after = { ...score(-508, 'f4f6'), pv: ['f4f6', 'd8f6', 'g2e4', 'f6e7', 'e4g2', 'e8c8', 'd2d4', 'f7f5'] };
  const deeper = [previous, before, after];
  const fixture = engineFixture(deeper.map(value => ({ ...value, depth: 8, candidates: [] })), deeper);
  const result = await analyzeGame(pgn, { moveTimeMs: 50, engineFactory: fixture.engineFactory, recognizeOpenings: false });
  assert.deepEqual(fixture.calls.slice(3).map(call => call.moves), [[], ['g5f4'], ['g5f4', 'f8d6']]);
  assert(fixture.calls.every(call => call.initialFen === parseGame(pgn).positions[0]));
  assert.equal(result.analysis.highlightPositionCount, 3);
  assert.equal(result.positions[0].depth, 16);
  assert.equal(result.moves[1].label, 'Great');
});

test('highlight work cannot replace a deeper initial evaluation with weaker evidence', async () => {
  const initial = [score(80, 'e1g1', 24), score(60, 'g8h8', 24)];
  const fixture = engineFixture(initial, [score(80, 'd3h7', 13), score(80, 'g8h8', 13)]);
  const result = await analyzeGame(GIFT, { moveTimeMs: 5000, engineFactory: fixture.engineFactory });
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(result.positions, initial);
  assert.equal(result.moves[0].label, 'Good');
  assert.equal(result.analysis.highlightPositionCount, 2);
});

test('failed or cancelled highlight work disposes the engine and returns no partial review', async () => {
  const scan = [score(80, 'd3h7', 8), score(80, 'g8h8', 8)];
  const deeper = scan.map(value => ({ ...value, depth: 16 }));
  const failed = engineFixture(scan, deeper, { failDeep: true });
  await assert.rejects(analyzeGame(GIFT, { moveTimeMs: 50, engineFactory: failed.engineFactory }), /Deeper search failed/);
  assert.equal(failed.engine.disposed, true);
  const cancelled = engineFixture(scan, deeper);
  const controller = new AbortController();
  await assert.rejects(analyzeGame(GIFT, {
    moveTimeMs: 50, engineFactory: cancelled.engineFactory, signal: controller.signal,
    onProgress: event => { if (event.phase === 'highlights' && event.phaseCompleted === event.phaseTotal) controller.abort(); },
  }), { name: 'AbortError' });
  assert.equal(cancelled.engine.disposed, true);
});
