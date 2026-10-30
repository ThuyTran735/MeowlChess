import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGame, parseGame, ANALYSIS_VERSION } from '../extension/lib/review.js';

const SIX = '[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0';
const TWELVE = '[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 1-0';
const score = cp => ({ cp, mate: null, bestMove: null, depth: 10, pv: [], candidates: [] });
function fixture(scan = [], deep = {}, onCall = () => {}) {
  const calls = [];
  const engine = {
    disposed: false,
    async init() {},
    async evaluate(fen, options) {
      const index = options.moves.length;
      calls.push({ fen, ...options });
      onCall(options, calls.length);
      return score(options.moveTimeMs >= 500 ? deep[index] ?? scan[index] ?? 0 : scan[index] ?? 0);
    },
    dispose() { this.disposed = true; },
  };
  return { engine, calls, engineFactory: () => engine };
}

test('smart review rescans both sides of an important move before its final label', async () => {
  const f = fixture([0, 0, 0, -700, -700, -700, -700], { 2: 30, 3: 10 });
  const progress = [];
  const result = await analyzeGame(SIX, { smartAnalysis: true, recognizeOpenings: false, moveTimeMs: 50, multiPV: 3, engineFactory: f.engineFactory, onProgress: event => progress.push(event) });
  assert.deepEqual(f.calls.map(call => call.moveTimeMs), [50, 50, 50, 50, 50, 50, 50, 500, 500]);
  assert.deepEqual(f.calls.slice(7).map(call => call.moves.length), [2, 3]);
  assert.deepEqual(f.calls[7].moves, ['e2e4', 'e7e5']);
  assert.deepEqual(f.calls[8].moves, ['e2e4', 'e7e5', 'g1f3']);
  assert(f.calls.every(call => call.multiPV === 3 && call.initialFen === result.game.positions[0]));
  assert.equal(result.moves[2].label, 'Good');
  assert.equal(result.moves[2].confirmed, true);
  assert.equal(result.positions[2].cp, 30);
  assert.equal(result.moves[2].evalAfter, result.positions[3]);
  assert.deepEqual(result.analysis.recheckedPlies, [2, 3]);
  assert.deepEqual(result.analysis.recheckedMoves, [3]);
  assert.equal(result.analysis.version, ANALYSIS_VERSION);
  assert(progress.some(event => event.phase === 'scan'));
  assert(progress.some(event => event.phase === 'recheck'));
  assert.equal(progress.at(-1).completed, progress.at(-1).total);
  const fractions = progress.map(event => event.completed / event.total);
  assert(fractions.every((fraction, index) => !index || fraction >= fractions[index - 1]));
  assert.equal(f.engine.disposed, true);
});

test('overlapping important pairs reuse one deeper evaluation for their shared position', async () => {
  const f = fixture([0, -500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500], { 0: 10, 1: 20, 2: 30 });
  const result = await analyzeGame(TWELVE, { smartAnalysis: true, recognizeOpenings: false, moveTimeMs: 1500, engineFactory: f.engineFactory });
  const rechecks = f.calls.filter(call => call.moveTimeMs === 1500);
  assert.deepEqual(rechecks.map(call => call.moves.length), [0, 1, 2]);
  assert.deepEqual(result.analysis.recheckedMoves, [1, 2]);
  assert(result.moves.slice(0, 2).every(move => move.confirmed));
  assert.equal(result.moves[0].evalAfter, result.positions[1]);
  assert.equal(result.moves[1].evalAfter, result.positions[2]);
  assert(f.calls.slice(0, 13).every(call => call.moveTimeMs === 150));
});

test('smart review avoids deeper work when the quick pass finds no important change', async () => {
  const f = fixture();
  const progress = [];
  const result = await analyzeGame(SIX, { smartAnalysis: true, moveTimeMs: 3000, engineFactory: f.engineFactory, onProgress: event => progress.push(event) });
  assert.equal(f.calls.length, 7);
  assert(f.calls.every(call => call.moveTimeMs === 150));
  assert.equal(result.analysis.recheckedPositionCount, 0);
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(progress.at(-1).completed, progress.at(-1).total);
});

test('rechecks remain bounded even when every early move changes the score sharply', async () => {
  const game = parseGame(TWELVE);
  const scan = game.positions.map((_, index) => index % 2 ? -700 : 700);
  const f = fixture(scan);
  const result = await analyzeGame(TWELVE, { smartAnalysis: true, recognizeOpenings: false, moveTimeMs: 500, engineFactory: f.engineFactory });
  assert(result.analysis.recheckedMoves.length <= Math.ceil(game.moves.length * 0.15));
  assert(result.analysis.recheckedPositionCount <= 2 * Math.ceil(game.moves.length * 0.15));
});

test('rechecks preserve exact terminal repetition and checkmate results', async () => {
  const pgn = '[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';
  const f = fixture([0, 0, 0, 0, 0, 0, 0, -700]);
  const result = await analyzeGame(pgn, { smartAnalysis: true, recognizeOpenings: false, engineFactory: f.engineFactory });
  assert(f.calls.every(call => call.moves.length !== 8));
  assert.equal(result.positions[8].cp, 0);
  assert.deepEqual(result.positions[8].candidates, []);
  assert.equal(result.moves[7].confirmed, true);
  const mate = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
  const m = fixture();
  const finished = await analyzeGame(mate, { smartAnalysis: true, engineFactory: m.engineFactory });
  assert(m.calls.every(call => call.moves.length !== 4));
  assert.equal(finished.positions[4].cp, -100000);
  assert.equal(finished.positions[4].mate, 0);
});

test('cancellation during a deeper pass rejects without exposing a half-updated review', async () => {
  const controller = new AbortController();
  const f = fixture([0, 0, 0, -700, -700, -700, -700], {}, options => { if (options.moveTimeMs === 500) controller.abort(); });
  await assert.rejects(analyzeGame(SIX, { smartAnalysis: true, recognizeOpenings: false, signal: controller.signal, engineFactory: f.engineFactory }), { name: 'AbortError' });
  assert.equal(f.calls.length, 8);
  assert.equal(f.engine.disposed, true);
});

test('a deeper search failure and a cancellation at its final progress callback dispose the engine', async () => {
  const failing = fixture([0, 0, 0, -700, -700, -700, -700], {}, options => { if (options.moveTimeMs === 500) throw new Error('Recheck failed'); });
  await assert.rejects(analyzeGame(SIX, { smartAnalysis: true, recognizeOpenings: false, engineFactory: failing.engineFactory }), /Recheck failed/);
  assert.equal(failing.engine.disposed, true);
  const controller = new AbortController();
  const f = fixture([0, 0, 0, -700, -700, -700, -700]);
  await assert.rejects(analyzeGame(SIX, { smartAnalysis: true, recognizeOpenings: false, signal: controller.signal, engineFactory: f.engineFactory, onProgress: event => { if (event.phase === 'recheck' && event.completed === event.total) controller.abort(); } }), { name: 'AbortError' });
  assert.equal(f.engine.disposed, true);
});
