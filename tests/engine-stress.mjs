import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), extension = join(root, 'extension');
const prefix = 'MeowlChess-engine-stress-', profile = await mkdtemp(join(tmpdir(), prefix));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH, headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--mute-audio'],
  });
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = 'chrome-extension://' + new URL(worker.url()).hostname;
  await worker.evaluate(() => chrome.storage.local.set({ tutorialNeverShowAgain: true, supportNeverShowAgain: true }));
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(`${origin}/review.html`);
  const positions = await page.evaluate(async () => {
    const { Chess } = await import('./vendor/chess.js');
    const { createEngine } = await import('./lib/engine.js');
    const NativeWorker = Worker;
    window.engineStress = { active: 0, created: 0, terminated: 0 };
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.engineStress.active++; window.engineStress.created++; }
      terminate() { if (!this.ended) { this.ended = true; window.engineStress.active--; window.engineStress.terminated++; } return super.terminate(); }
    };
    const entries = [];
    let seed = 934183;
    const random = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
    for (let game = 0; game < 4; game++) {
      const chess = new Chess(), initialFen = chess.fen(), moves = [];
      for (let ply = 0; ply < 96 && !chess.isGameOver(); ply++) {
        if (ply % 4 === 0) entries.push({ fen: chess.fen(), initialFen, moves: moves.slice() });
        const legal = chess.moves({ verbose: true }), move = legal[random(legal.length)];
        chess.move(move); moves.push(move.from + move.to + (move.promotion || ''));
      }
    }
    for (const fen of [
      '1r5k/P7/8/8/8/8/8/7K w - - 0 1',
      '4k3/8/8/8/8/8/1p6/R6K b - - 0 1',
      'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
      '7k/8/8/3pP3/8/8/8/K7 w - d6 0 2',
      '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
      '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
      '7k/7Q/5K2/8/8/8/8/8 b - - 0 1',
    ]) entries.push({ fen, moves: [] });
    window.stressEntries = entries;
    window.stressLegal = (result, fen) => {
      if (!Number.isFinite(result.cp)) throw new Error('Nonfinite score');
      if (result.bestMove !== result.pv[0] && result.bestMove !== null) throw new Error('Best move differs from PV');
      const seen = new Set();
      for (const [index, candidate] of result.candidates.entries()) {
        if (candidate.rank !== index + 1 || seen.has(candidate.bestMove)) throw new Error('Invalid candidate rank/duplicate');
        seen.add(candidate.bestMove);
        if (candidate.bestMove !== candidate.pv[0]) throw new Error('Candidate differs from PV');
        const replay = new Chess(fen);
        for (const uci of candidate.pv) replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      }
    };
    return entries.length;
  });
  for (const id of ['stockfish', 'lozza']) {
    const checked = await page.evaluate(async id => {
      const { createEngine } = await import('./lib/engine.js');
      const engine = createEngine(id); let count = 0;
      try {
        for (const entry of window.stressEntries) {
          const result = await engine.evaluate(entry.fen, { ...entry, moveTimeMs: 50, multiPV: 1 + count % 3 });
          window.stressLegal(result, entry.fen); count++;
        }
      } finally { engine.dispose(); }
      return { count, ...window.engineStress };
    }, id);
    assert.equal(checked.count, positions); assert.equal(checked.active, 0);
    console.log(`${id}: ${checked.count} seeded/special positions, all PVs legal, workers disposed`);
  }
  for (const id of ['stockfish', 'lozza']) {
    const stats = await page.evaluate(async id => {
      const { createEngine } = await import('./lib/engine.js');
      for (let cycle = 0; cycle < 12; cycle++) {
        const engine = createEngine(id), controller = new AbortController();
        if (cycle >= 3) await engine.init();
        const pending = engine.evaluate(window.stressEntries[cycle].fen, { moveTimeMs: 3000, multiPV: 3, signal: controller.signal });
        const stopped = new Promise(resolve => setTimeout(() => { controller.abort(); resolve(); }, cycle < 3 ? 0 : 25));
        let rejected = false;
        try { await pending; } catch (error) { if (error.name !== 'AbortError') throw error; rejected = true; }
        await stopped; engine.dispose();
        if (!rejected || window.engineStress.active) throw new Error(`Cancellation leaked at cycle ${cycle}`);
      }
      return window.engineStress;
    }, id);
    assert.equal(stats.active, 0); console.log(`${id}: boot/search cancellation and restart cycles passed`);
  }
  for (const id of ['stockfish', 'lozza']) {
    const stats = await page.evaluate(async id => {
      const { Chess } = await import('./vendor/chess.js');
      const { createEngine } = await import('./lib/engine.js');
      const { analyzeGame } = await import('./lib/review.js');
      const chess = new Chess(); let seed = 1234567;
      const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
      for (let ply = 0; ply < 150 && !chess.isGameOver(); ply++) { const legal = chess.moves(); chess.move(legal[random(legal.length)]); }
      const resultCode = chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2';
      chess.header('Result', resultCode);
      const result = await analyzeGame(chess.pgn(), { engineFactory: () => createEngine(id), moveTimeMs: 50, multiPV: 3, smartAnalysis: true });
      for (const [index, position] of result.positions.entries()) window.stressLegal(position, result.game.positions[index]);
      if (result.positions.length !== result.moves.length + 1 || result.moves.some(move => !Number.isFinite(move.loss))) throw new Error('Incomplete review');
      return { moves: result.moves.length, rechecks: result.analysis.recheckedPositionCount, active: window.engineStress.active };
    }, id);
    assert.equal(stats.active, 0); console.log(`${id}: complete ${stats.moves}-ply smart review, ${stats.rechecks} rechecks, no leaked worker`);
  }
  assert.deepEqual(failures, []);
} finally { await closeTestContext(context, profile, prefix); }
