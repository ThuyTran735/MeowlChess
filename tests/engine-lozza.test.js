import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { createEngine, ENGINE_OPTIONS, LozzaEngine, StockfishEngine } from '../extension/lib/engine.js';
import { Chess } from '../extension/vendor/chess.js';
import { analyzeGame } from '../extension/lib/review.js';

const START = new Chess().fen();
const source = await readFile(new URL('../extension/vendor/lozza-9.js', import.meta.url), 'utf8');

// Run the shipped browser script in a real isolated worker with Web Worker I/O.
// This exercises its embedded network and actual UCI output without downloading anything.
function realWorkerFactory(url) {
  assert.match(url.pathname, /\/vendor\/lozza-9\.js$/);
  const native = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const vm = require('node:vm');
    const context = vm.createContext({
      postMessage: data => parentPort.postMessage(data),
      atob, performance, console: { log() {} }, setTimeout, clearTimeout,
    });
    vm.runInContext(workerData, context);
    parentPort.on('message', data => context.onmessage({ data }));
  `, { eval: true, workerData: source });
  const worker = {
    postMessage: command => native.postMessage(command),
    terminate: () => native.terminate(),
  };
  native.on('message', data => worker.onmessage?.({ data }));
  native.on('error', error => worker.onerror?.({ message: error.message }));
  return worker;
}

test('engine choices use distinct bundled workers and reject unknown engines', () => {
  assert.deepEqual(ENGINE_OPTIONS.map(option => [option.id, option.maxLines]), [['stockfish', 3], ['lozza', 1]]);
  assert(createEngine() instanceof StockfishEngine);
  assert(createEngine('lozza') instanceof LozzaEngine);
  assert.throws(() => createEngine('remote'), /available local/);
});

test('Lozza searches actual positions at 50ms with legal, coherent one-line results', { timeout: 15000 }, async () => {
  const engine = createEngine('lozza', { workerFactory: realWorkerFactory });
  const board = new Chess();
  const moves = [];
  try {
    for (const san of [null, 'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']) {
      if (san) {
        const move = board.move(san);
        moves.push(move.from + move.to + (move.promotion || ''));
      }
      const result = await engine.evaluate(board.fen(), { initialFen: START, moves, moveTimeMs: 50, multiPV: 3 });
      assert(Number.isFinite(result.cp));
      assert(result.depth >= 1);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.bestMove, result.pv[0]);
      assert.equal(result.cp, result.candidates[0].cp);
      const replay = new Chess(board.fen());
      for (const uci of result.pv) assert(replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }));
    }
  } finally { engine.dispose(); }
});

test('Lozza reports mate in one and terminal positions without inventing arrows', { timeout: 15000 }, async () => {
  const engine = createEngine('lozza', { workerFactory: realWorkerFactory });
  try {
    const beforeMate = new Chess();
    for (const san of ['f3', 'e5', 'g4']) beforeMate.move(san);
    const result = await engine.evaluate(beforeMate.fen(), { moveTimeMs: 50 });
    assert.equal(result.bestMove, 'd8h4');
    assert.equal(result.mate, -1);
    assert.equal(result.cp, -99900);
    beforeMate.move('Qh4#');
    const mate = await engine.evaluate(beforeMate.fen(), { moveTimeMs: 50 });
    assert.equal(mate.bestMove, null);
    assert.equal(mate.cp, -100000);
    assert.deepEqual(mate.candidates, []);
    const stalemate = await engine.evaluate('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', { moveTimeMs: 50 });
    assert.equal(stalemate.bestMove, null);
    assert.equal(stalemate.cp, 0);
    assert.deepEqual(stalemate.candidates, []);
    const forced = await engine.evaluate('7k/7Q/5K2/8/8/8/8/8 b - - 0 1', { moveTimeMs: 50 });
    assert.equal(forced.bestMove, 'h8h7');
    assert.equal(forced.cp, 0);
    assert.equal(forced.candidates.length, 1);
  } finally { engine.dispose(); }
});

test('Lozza reviews a completed repetition game with full history and a terminal draw', { timeout: 15000 }, async () => {
  const result = await analyzeGame('[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2', {
    moveTimeMs: 50,
    multiPV: 3,
    engineFactory: () => createEngine('lozza', { workerFactory: realWorkerFactory }),
  });
  assert.equal(result.moves.length, 8);
  assert.equal(result.positions.length, 9);
  const terminal = result.positions.at(-1);
  assert.equal(terminal.cp, 0);
  assert.equal(terminal.bestMove, null);
  assert.deepEqual(terminal.candidates, []);
  assert(result.positions.slice(0, -1).every(position => position.candidates.length === 1));
});

test('Lozza cancellation terminates a real ongoing worker search', { timeout: 15000 }, async () => {
  const engine = createEngine('lozza', { workerFactory: realWorkerFactory });
  await engine.init();
  const controller = new AbortController();
  const pending = engine.evaluate(START, { moveTimeMs: 3000, signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(engine.disposed, true);
  assert.equal(engine.worker, null);
});
