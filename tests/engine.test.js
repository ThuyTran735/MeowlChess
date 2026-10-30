import test from 'node:test';
import assert from 'node:assert/strict';
import { StockfishEngine } from '../extension/lib/engine.js';

const WHITE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK = 'rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function fixture(lines = ['info depth 10 score cp 42 pv e2e4 e7e5', 'bestmove e2e4']) {
  const commands = [];
  const worker = {
    stopped: false,
    postMessage(command) {
      commands.push(command);
      queueMicrotask(() => {
        if (this.stopped) return;
        const output = command === 'uci' ? ['option name Hash type spin default 16', 'option name Threads type spin default 1', 'option name MultiPV type spin default 1 min 1 max 256', 'uciok'] : command === 'isready' ? ['readyok'] : command.startsWith('go ') ? lines : [];
        for (const data of output) this.onmessage({ data });
      });
    },
    terminate() { this.stopped = true; },
  };
  return { worker, commands, engine: new StockfishEngine({ workerFactory: () => worker }) };
}

test('initializes local UCI engine and preserves move history', async () => {
  const { engine, commands } = fixture();
  const result = await engine.evaluate(WHITE, { initialFen: WHITE, moves: ['e2e4', 'e7e5'], moveTimeMs: 150 });
  assert.equal(result.cp, 42);
  assert.equal(result.bestMove, 'e2e4');
  assert.deepEqual(result.pv, ['e2e4', 'e7e5']);
  assert.ok(commands.includes('setoption name Hash value 32'));
  assert.ok(commands.includes(`position fen ${WHITE} moves e2e4 e7e5`));
  engine.dispose();
});

test('normalizes black evaluation and ignores bounds/secondary PV', async () => {
  const { engine } = fixture(['info depth 8 score cp 60 pv e7e5', 'info depth 9 score cp 100 lowerbound pv e7e5', 'info depth 9 multipv 2 score cp 200 pv e7e6', 'bestmove e7e5']);
  const result = await engine.evaluate(BLACK);
  assert.equal(result.cp, -60);
  assert.equal(result.depth, 8);
  engine.dispose();
});

test('mate scores are from white perspective', async () => {
  const { engine } = fixture(['info depth 12 score mate 3 pv d8h4', 'bestmove d8h4']);
  const result = await engine.evaluate(BLACK);
  assert.equal(result.mate, -3);
  assert.equal(result.cp, -99700);
  engine.dispose();
});

test('abort terminates the worker and rejects the pending search', async () => {
  const { engine, worker } = fixture([]);
  await engine.init();
  const controller = new AbortController();
  const pending = engine.evaluate(WHITE, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(worker.stopped, true);
});

test('crashes reject pending commands', async () => {
  const { engine, worker } = fixture([]);
  await engine.init();
  const pending = engine.evaluate(WHITE);
  await Promise.resolve();
  worker.onerror({ preventDefault() {} });
  await assert.rejects(pending, /could not run/);
});

test('missing evaluation does not silently invent a score', async () => {
  const { engine } = fixture(['bestmove e2e4']);
  await assert.rejects(engine.evaluate(WHITE), /no evaluation/);
});

test('rejects command injection and overlapping evaluations', async () => {
  const { engine } = fixture([]);
  await assert.rejects(engine.evaluate(`${WHITE}\ngo infinite`), /invalid chess position/);
  await assert.rejects(engine.evaluate(WHITE, { initialFen: WHITE, moves: ['e2e4\ngo infinite'] }), /invalid move history/);
  await engine.init();
  const pending = engine.evaluate(WHITE);
  await assert.rejects(engine.evaluate(WHITE), /current position/);
  engine.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('initialization timeout disposes a hung worker', async () => {
  let terminated = false;
  const engine = new StockfishEngine({ bootTimeoutMs: 5, workerFactory: () => ({ postMessage() {}, terminate() { terminated = true; } }) });
  await assert.rejects(engine.init(), /too long/);
  assert.equal(terminated, true);
});

test('MultiPV keeps the latest complete iteration instead of mixing search depths', async () => {
  const { engine, commands } = fixture([
    'info depth 10 multipv 1 score cp 45 pv e2e4 e7e5',
    'info depth 10 multipv 2 score cp 30 pv d2d4 d7d5',
    'info depth 10 multipv 3 score cp 20 pv g1f3 d7d5',
    'info depth 11 multipv 1 score cp 60 pv e2e4 c7c5',
    'info depth 11 multipv 2 score cp 22 pv d2d4 g8f6',
    'bestmove e2e4',
  ]);
  const result = await engine.evaluate(WHITE, { multiPV: 3, moveTimeMs: 1500 });
  assert.deepEqual(result.candidates.map(({ rank, bestMove, cp, depth }) => ({ rank, bestMove, cp, depth })), [
    { rank: 1, bestMove: 'e2e4', cp: 45, depth: 10 },
    { rank: 2, bestMove: 'd2d4', cp: 30, depth: 10 },
    { rank: 3, bestMove: 'g1f3', cp: 20, depth: 10 },
  ]);
  assert.equal(result.cp, result.candidates[0].cp);
  assert.equal(result.depth, 10);
  assert.ok(commands.includes('go movetime 1500'));
  const optionIndex = commands.indexOf('setoption name MultiPV value 3');
  assert(optionIndex >= 0 && commands[optionIndex + 1] === 'isready');
  assert(optionIndex < commands.findIndex(command => command.startsWith('position ')));
  engine.dispose();
});

test('MultiPV keeps engine ranking for Black while normalizing all scores', async () => {
  const { engine } = fixture([
    'info depth 12 multipv 1 score mate 3 pv e7e5 g1f3',
    'info depth 12 multipv 2 score cp 120 pv c7c5 g1f3',
    'info depth 12 multipv 3 score cp -30 pv e7e6 d2d4',
    'info depth 13 multipv 2 score cp 999 lowerbound pv c7c5',
    'bestmove e7e5',
  ]);
  const result = await engine.evaluate(BLACK, { multiPV: 3 });
  assert.deepEqual(result.candidates.map(candidate => candidate.cp), [-99700, -120, 30]);
  assert.equal(result.candidates[0].mate, -3);
  assert.deepEqual(result.candidates.map(candidate => candidate.rank), [1, 2, 3]);
  assert(result.candidates.every(candidate => candidate.depth === 12));
  engine.dispose();
});

test('MultiPV does not invent lines when only fewer distinct candidates are available', async () => {
  const { engine } = fixture([
    'info depth 10 multipv 1 score cp 40 pv e2e4 e7e5',
    'info depth 10 multipv 2 score cp 30 pv d2d4 d7d5',
    'info depth 11 multipv 1 score cp 50 pv e2e4 c7c5',
    'info depth 11 multipv 2 score cp 25 pv d2d4 g8f6',
    'bestmove e2e4',
  ]);
  const result = await engine.evaluate(WHITE, { multiPV: 3 });
  assert.equal(result.candidates.length, 2);
  assert(result.candidates.every(candidate => candidate.depth === 11));
  engine.dispose();
});

test('MultiPV follows a changed final best move without pairing it with stale alternatives', async () => {
  const { engine } = fixture([
    'info depth 10 multipv 1 score cp 40 pv e2e4 e7e5',
    'info depth 10 multipv 2 score cp 30 pv d2d4 d7d5',
    'info depth 10 multipv 3 score cp 20 pv g1f3 d7d5',
    'info depth 11 multipv 1 score cp 55 pv d2d4 g8f6',
    'bestmove d2d4',
  ]);
  const result = await engine.evaluate(WHITE, { multiPV: 3 });
  assert.equal(result.bestMove, 'd2d4');
  assert.equal(result.cp, 55);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].bestMove, 'd2d4');
  engine.dispose();
});

test('MultiPV rejects duplicate or malformed alternatives and resets its option between requests', async () => {
  const { engine, commands } = fixture([
    'info depth 10 multipv 1 score cp 40 pv e2e4 e7e5',
    'info depth 10 multipv 2 score cp 30 pv e2e4 c7c5',
    'info depth 10 multipv 3 score cp 20 pv g1f3 invalid',
    'bestmove e2e4',
  ]);
  const multiple = await engine.evaluate(WHITE, { multiPV: 3 });
  assert.equal(multiple.candidates.length, 1);
  const single = await engine.evaluate(WHITE, { multiPV: 1 });
  assert.equal(single.candidates.length, 1);
  assert(commands.lastIndexOf('setoption name MultiPV value 1') > commands.indexOf('setoption name MultiPV value 3'));
  for (const multiPV of [0, 4, 1.5, '3\ngo infinite']) await assert.rejects(engine.evaluate(WHITE, { multiPV }), /one and three/);
  engine.dispose();
});

test('mate-zero score keeps the winning side when the engine returns no legal move', async () => {
  for (const [fen, cp] of [[WHITE, -100000], [BLACK, 100000]]) {
    const { engine } = fixture(['info depth 0 score mate 0', 'bestmove (none)']);
    const result = await engine.evaluate(fen);
    assert.equal(result.cp, cp);
    assert.equal(result.bestMove, null);
    assert.deepEqual(result.candidates, []);
    engine.dispose();
  }
});
