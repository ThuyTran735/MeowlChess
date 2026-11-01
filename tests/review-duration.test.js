import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGame, ANALYSIS_VERSION } from '../extension/lib/review.js';
import { formatReviewDuration } from '../extension/lib/review-duration.js';
import { createReviewLibrary } from '../extension/lib/library.js';
import { createSiteReviewLibraryBridge } from '../extension/lib/site-review.js';
import { importPgn } from '../extension/lib/pgn.js';

const PGN = '[White "Timer White"]\n[Black "Timer Black"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0';
const settings = { engineId: 'stockfish', engineName: 'Stockfish 18', moveTimeMs: 50, multiPV: 1, smartAnalysis: true, analysisVersion: ANALYSIS_VERSION };
const evaluation = cp => ({ cp, mate: null, bestMove: null, depth: 10, pv: [], candidates: [] });
function memoryStore() {
  const records = new Map();
  return {
    async read(id) { return structuredClone(records.get(id) || null); },
    async readAll() { return structuredClone([...records.values()]); },
    async transact(update) {
      const changes = update(structuredClone([...records.values()]));
      for (const id of changes.remove || []) records.delete(id);
      for (const record of changes.put || []) records.set(record.id, structuredClone(record));
      return structuredClone(changes.value);
    },
  };
}
async function fixture(t) {
  let clock = 70000, scans = 0, rechecks = 0;
  t.mock.method(performance, 'now', () => clock);
  const result = await analyzeGame(PGN, { smartAnalysis: true, recognizeOpenings: false, moveTimeMs: 50, engineFactory: () => ({
    async init() { clock += 1300; },
    async evaluate(fen, options) {
      if (options.moveTimeMs === 500) { rechecks++; clock += 500; return evaluation(0); }
      scans++; clock += 50;
      return evaluation(options.moves.length >= 3 ? -700 : 0);
    },
    dispose() { clock += 10; },
  }) });
  return { result, scans, rechecks, advance: ms => { clock += ms; } };
}

test('duration measures initialization and both analysis passes instead of configured search time', async t => {
  const { result, scans, rechecks, advance } = await fixture(t);
  assert.equal(scans, 7); assert.equal(rechecks, 2);
  assert.equal(result.analysis.durationMs, 1300 + 7 * 50 + 2 * 500 + 10);
  advance(60000);
  assert.equal(result.analysis.durationMs, 2660, 'Post-review work does not keep advancing the stored duration.');
});

test('failed or canceled analysis never returns a completed duration', async t => {
  t.mock.method(performance, 'now', () => 12345);
  for (const kind of ['failure', 'cancel']) {
    const controller = new AbortController(); let disposed = false, returned = false;
    const operation = analyzeGame(PGN, { signal: controller.signal, engineFactory: () => ({
      async init() {}, dispose() { disposed = true; },
      async evaluate() { if (kind === 'failure') throw new Error('Search failed'); controller.abort(); return evaluation(0); },
    }) }).then(value => { returned = true; return value; });
    await assert.rejects(operation, kind === 'failure' ? /Search failed/ : { name: 'AbortError' });
    assert.equal(disposed, true); assert.equal(returned, false);
  }
});

test('duration survives local save, broker round trip, and reused review without gaining waiting time', async t => {
  const { result, advance } = await fixture(t);
  const store = memoryStore(), game = importPgn(PGN);
  const library = createReviewLibrary({ store, analysisVersion: ANALYSIS_VERSION });
  const saved = await library.saveReview(game, result, settings);
  advance(30000);
  const reopened = await createReviewLibrary({ store, analysisVersion: ANALYSIS_VERSION }).loadReview(saved.id);
  assert.equal(reopened.result.analysis.durationMs, 2660);
  const bridge = createSiteReviewLibraryBridge({ library, idForGame: async () => saved.id });
  const reused = await bridge.saveReview({ game, analysis: settings }, { ...result, analysis: { ...result.analysis, durationMs: 99999 } }, () => {});
  assert.equal(reused.savedFresh, false); assert.equal(reused.result.analysis.durationMs, 2660);
  const freshStore = memoryStore(), freshLibrary = createReviewLibrary({ store: freshStore, analysisVersion: ANALYSIS_VERSION });
  const freshBridge = createSiteReviewLibraryBridge({ library: freshLibrary, idForGame: async () => saved.id });
  const fresh = await freshBridge.saveReview({ game, analysis: settings }, result, () => {});
  assert.equal(fresh.savedFresh, true); assert.equal(fresh.result.analysis.durationMs, 2660);
});

test('legacy reviews retain no invented duration and malformed duration metadata is rejected', async t => {
  const { result } = await fixture(t), game = importPgn(PGN);
  const library = createReviewLibrary({ store: memoryStore(), analysisVersion: ANALYSIS_VERSION });
  const legacy = structuredClone(result); delete legacy.analysis.durationMs;
  const saved = await library.saveReview(game, legacy, settings);
  const reopened = await library.loadReview(saved.id);
  assert.equal(reopened.result.analysis.durationMs, undefined);
  assert.equal(formatReviewDuration(reopened.result.analysis.durationMs), '');
  for (const invalid of [-1, 12.5, null, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(result); bad.analysis.durationMs = invalid;
    await assert.rejects(library.saveReview(game, bad, settings), /duration is invalid/);
  }
});

test('duration labels handle short and long reviews without misleading old-data values', () => {
  for (const [input, expected] of [[0, 'under 1 sec'], [999, 'under 1 sec'], [1000, '1 sec'], [2660, '3 sec'], [59500, '1 min'], [65000, '1 min 5 sec'], [3600000, '1 hr'], [3720000, '1 hr 2 min']]) assert.equal(formatReviewDuration(input), expected);
  for (const invalid of [undefined, null, '', '5000', -1, 12.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(formatReviewDuration(invalid), '');
});
