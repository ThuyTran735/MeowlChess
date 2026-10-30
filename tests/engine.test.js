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
        const output = command === 'uci' ? ['option name Hash type spin default 16', 'option name Threads type spin default 1', 'uciok'] : command === 'isready' ? ['readyok'] : command.startsWith('go ') ? lines : [];
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
