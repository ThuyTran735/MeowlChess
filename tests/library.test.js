import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewLibrary, createIndexedDBReviewStore, reviewIdForGame, LibraryError, LIBRARY_SCHEMA_VERSION } from '../extension/lib/library.js';
import { analyzeGame } from '../extension/lib/review.js';
import { importPgn } from '../extension/lib/pgn.js';

const PGN = '[Event "Local library"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
const SETTINGS = { engineId: 'stockfish', engineName: 'Stockfish 18', moveTimeMs: 150, multiPV: 1, smartAnalysis: false, analysisVersion: 'test-v1' };
const copy = value => structuredClone(value);

// Transactional in-memory adapter exercises the same library contract as IndexedDB.
function memoryStore() {
  const records = new Map();
  let queue = Promise.resolve();
  return {
    records,
    async read(id) { return copy(records.get(id) || null); },
    async readAll() { return copy([...records.values()]); },
    transact(update) {
      const pending = queue.then(() => {
        const changes = update(copy([...records.values()]));
        const next = new Map(records);
        for (const id of changes.remove || []) next.delete(id);
        for (const record of changes.put || []) next.set(record.id, copy(record));
        records.clear(); for (const [id, record] of next) records.set(id, record);
        return copy(changes.value);
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
}
async function fixture(pgn = PGN) {
  let position = 0;
  const result = await analyzeGame(pgn, { smartAnalysis: false, engineFactory: () => ({
    async init() {}, dispose() {},
    async evaluate() { return { cp: [0, -400, -400, -700][position++] ?? 0, mate: null, bestMove: null, pv: [], candidates: [], depth: 8 }; },
  }) });
  if (result.analysis) result.analysis.version = SETTINGS.analysisVersion;
  return { game: importPgn(pgn), result };
}
const create = (store, options = {}) => createReviewLibrary({ store, analysisVersion: 'test-v1', ...options });

test('saved full reviews survive a library restart and returned objects cannot mutate storage', async () => {
  const store = memoryStore(), data = await fixture();
  const first = create(store, { now: () => 1000 });
  const saved = await first.saveReview(data.game, data.result, SETTINGS);
  assert.equal(saved.schemaVersion, LIBRARY_SCHEMA_VERSION);
  assert.match(saved.id, /^game-[a-f0-9]{64}$/);
  saved.result.moves[0].san = 'corrupted by consumer';
  const restarted = create(store);
  const loaded = await restarted.loadReview(saved.id);
  assert.equal(loaded.result.moves[0].san, 'e4');
  assert.equal(loaded.game.pgn, data.game.pgn);
  assert.deepEqual(loaded.result.positions, data.result.positions);
  assert.equal(loaded.analysis.engineId, 'stockfish');
  assert.equal(loaded.stale, false);
  const rows = await restarted.listReviews();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].moveCount, 3);
  assert.equal(rows[0].bookmarkCount, 0);
  assert.equal('result' in rows[0], false, 'Library cards do not expose full results unnecessarily.');
});

test('stable identities ignore comments but distinguish different players and custom initial positions', async () => {
  assert.equal(await reviewIdForGame(PGN), await reviewIdForGame(PGN.replace('e4 e5', 'e4 {A comment} e5').replaceAll('\n', '\r\n')));
  assert.notEqual(await reviewIdForGame(PGN), await reviewIdForGame(PGN.replace('Alice', 'Carol')));
  const setup = '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 23"]\n[Result "1/2-1/2"]\n\n23... e5 24. Nf3 1/2-1/2';
  assert.match(await reviewIdForGame(setup), /^game-[a-f0-9]{64}$/);
});

test('review upserts preserve creation time and exact bookmarked positions', async () => {
  const store = memoryStore(), data = await fixture();
  let time = 1000;
  const library = create(store, { now: () => time });
  const original = await library.saveReview(data.game, data.result, SETTINGS);
  time = 2000;
  assert.deepEqual(await library.toggleBookmark(original.id, 1, { note: 'Find a better move' }), { bookmarked: true, bookmark: { ply: 1, note: 'Find a better move', createdAt: 2000 } });
  time = 3000;
  const updated = await library.saveReview(data.game, data.result, { ...SETTINGS, moveTimeMs: 500 });
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, 1000);
  assert.equal(updated.updatedAt, 3000);
  assert.equal(updated.bookmarks[0].ply, 1);
  assert.equal((await library.listReviews()).length, 1);
  const bookmarks = await library.listBookmarks();
  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].fen, data.result.game.positions[1]);
  assert.equal(bookmarks[0].reviewId, original.id);
  assert.equal((await library.toggleBookmark(original.id, 1)).bookmarked, false);
  assert.equal((await library.listBookmarks()).length, 0);
});

test('bookmarks accept starting and final positions but reject positions outside the completed game', async () => {
  const store = memoryStore(), data = await fixture();
  const library = create(store);
  const saved = await library.saveReview(data.game, data.result, SETTINGS);
  await library.toggleBookmark(saved.id, 0);
  await library.toggleBookmark(saved.id, 3);
  assert.deepEqual((await library.loadReview(saved.id)).bookmarks.map(item => item.ply), [0, 3]);
  await assert.rejects(library.toggleBookmark(saved.id, 4), error => error.code === 'invalid');
  await assert.rejects(library.toggleBookmark(saved.id, -1), error => error.code === 'invalid');
  await assert.rejects(library.toggleBookmark('missing', 0), error => error.code === 'not-found');
});

test('analysis version changes mark saved results and bookmarks stale without deleting them', async () => {
  const store = memoryStore(), data = await fixture();
  const first = create(store);
  const saved = await first.saveReview(data.game, data.result, SETTINGS);
  await first.toggleBookmark(saved.id, 1);
  const changed = create(store, { analysisVersion: 'test-v2' });
  assert.equal((await changed.loadReview(saved.id)).stale, true);
  assert.equal((await changed.listReviews())[0].stale, true);
  assert.equal((await changed.listBookmarks())[0].stale, true);
  const reanalyzed = copy(data.result); if (reanalyzed.analysis) reanalyzed.analysis.version = 'test-v2';
  const fresh = await changed.saveReview(data.game, reanalyzed, { ...SETTINGS, analysisVersion: 'test-v2' });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.bookmarks.length, 1);
});

test('practice collections contain original mistake plies and obey their bounded limit', async () => {
  const store = memoryStore(), data = await fixture();
  const library = create(store);
  const saved = await library.saveReview(data.game, data.result, SETTINGS);
  const expected = data.result.moves.filter(move => ['Mistake', 'Blunder'].includes(move.label));
  const practice = await library.listPracticePositions();
  assert(expected.length > 0);
  assert.deepEqual(practice.map(item => item.ply), expected.map(move => move.ply));
  assert(practice.every(item => item.reviewId === saved.id && item.stale === false));
  assert.equal((await library.listPracticePositions({ limit: 1 })).length, 1);
  await assert.rejects(library.listPracticePositions({ limit: 501 }), error => error.code === 'invalid');
});

test('storage limits never evict bookmarked games and updates remain possible at the game limit', async () => {
  const store = memoryStore(), first = await fixture(), second = await fixture(PGN.replace('Alice', 'Carol'));
  const library = create(store, { maxReviews: 1 });
  const saved = await library.saveReview(first.game, first.result, SETTINGS);
  await library.toggleBookmark(saved.id, 1);
  await assert.rejects(library.saveReview(second.game, second.result, SETTINGS), error => error.code === 'limit');
  assert.equal((await library.loadReview(saved.id)).bookmarks.length, 1);
  await library.saveReview(first.game, first.result, { ...SETTINGS, moveTimeMs: 500 });
  assert.equal((await library.listReviews()).length, 1);
});

test('concurrent saves enforce the game limit in one atomic transaction', async () => {
  const store = memoryStore(), first = await fixture(), second = await fixture(PGN.replace('Alice', 'Carol'));
  const a = create(store, { maxReviews: 1 }), b = create(store, { maxReviews: 1 });
  const results = await Promise.allSettled([a.saveReview(first.game, first.result, SETTINGS), b.saveReview(second.game, second.result, SETTINGS)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'limit');
  assert.equal((await a.listReviews()).length, 1);
});

test('byte-cap and browser-quota failures leave existing reviews intact and explain the problem', async () => {
  const store = memoryStore(), data = await fixture();
  const library = create(store);
  const saved = await library.saveReview(data.game, data.result, SETTINGS);
  await assert.rejects(create(store, { maxBytes: 1 }).saveReview(data.game, data.result, SETTINGS), error => error.code === 'limit');
  assert.equal((await library.loadReview(saved.id)).id, saved.id);
  const full = create({ ...store, async transact() { throw new DOMException('Full', 'QuotaExceededError'); } });
  await assert.rejects(full.saveReview(data.game, data.result, SETTINGS), error => error instanceof LibraryError && error.code === 'quota' && /space/.test(error.message));
});

test('unavailable IndexedDB reports a storage error instead of pretending a save succeeded', async () => {
  const library = createReviewLibrary({ store: createIndexedDBReviewStore({ indexedDB: null }) });
  await assert.rejects(library.listReviews(), error => error.code === 'unavailable');
});

test('unfinished PGNs, mismatched results, illegal engine lines, and invalid settings are rejected', async () => {
  const data = await fixture(), library = create(memoryStore());
  await assert.rejects(library.saveReview({ pgn: '[Result "*"]\n\n1. e4 *' }, data.result, SETTINGS), /completed/);
  const wrongMove = copy(data.result); wrongMove.moves[0].san = 'd4';
  await assert.rejects(library.saveReview(data.game, wrongMove, SETTINGS), error => error.code === 'invalid');
  const wrongFen = copy(data.result); wrongFen.game.positions[0] = wrongFen.game.positions[1];
  await assert.rejects(library.saveReview(data.game, wrongFen, SETTINGS), error => error.code === 'invalid');
  const illegal = copy(data.result); illegal.positions[0].pv = ['e7e5'];
  await assert.rejects(library.saveReview(data.game, illegal, SETTINGS), error => error.code === 'invalid');
  await assert.rejects(library.saveReview(data.game, data.result, { ...SETTINGS, engineId: 'lozza', multiPV: 3 }), error => error.code === 'invalid');
});

test('corrupted and future-schema records remain visible for deletion but cannot load onto the board', async () => {
  const store = memoryStore(), data = await fixture(), library = create(store);
  const saved = await library.saveReview(data.game, data.result, SETTINGS);
  store.records.get(saved.id).schemaVersion = 999;
  assert.equal((await library.listReviews())[0].invalid, true);
  await assert.rejects(library.loadReview(saved.id), error => error.code === 'corrupt');
  assert.equal(await library.deleteReview(saved.id), true);
  assert.equal(await library.loadReview(saved.id), null);
  assert.equal(await library.deleteReview(saved.id), false);
});

test('saved record identities and move summaries are checked again when loaded', async () => {
  const store = memoryStore(), data = await fixture(), library = create(store);
  const saved = await library.saveReview(data.game, data.result, SETTINGS);
  const fakeId = 'game-' + 'a'.repeat(64);
  store.records.set(fakeId, { ...copy(store.records.get(saved.id)), id: fakeId });
  await assert.rejects(library.loadReview(fakeId), error => error.code === 'corrupt');
  store.records.get(saved.id).result.summary.w.total = 999;
  await assert.rejects(library.loadReview(saved.id), error => error.code === 'corrupt');
  assert.equal((await library.listPracticePositions()).length, 0, 'Wrong identities and corrupted results cannot enter practice.');
});

test('opening-book moves retain null study scores and the analysis schema/version on reload', async () => {
  const result = await analyzeGame(PGN, { smartAnalysis: false, engineFactory: () => ({ async init() {}, dispose() {}, async evaluate() { return { cp: 0, mate: null, bestMove: null, pv: [], candidates: [], depth: 8 }; } }) });
  assert(result.moves.some(move => move.label === 'Book'));
  const library = create(memoryStore(), { analysisVersion: result.analysis.version });
  const settings = { ...SETTINGS, analysisVersion: result.analysis.version };
  const saved = await library.saveReview(importPgn(PGN), result, settings);
  const loaded = await library.loadReview(saved.id);
  assert.deepEqual(loaded.result.summary, result.summary);
  assert.equal(loaded.result.moves.find(move => move.label === 'Book').accuracy, null);
  assert.equal(loaded.result.analysis.schemaVersion, result.analysis.schemaVersion);
  assert.equal(loaded.result.opening.name, result.opening.name);
  assert.deepEqual((await library.listReviews())[0].opening, { name: result.opening.name, eco: result.opening.eco });
  await assert.rejects(library.saveReview(importPgn(PGN), result, { ...settings, analysisVersion: 'wrong-version' }), error => error.code === 'invalid');
  await assert.rejects(library.saveReview(importPgn(PGN), result, { ...settings, smartAnalysis: true }), error => error.code === 'invalid');
});
