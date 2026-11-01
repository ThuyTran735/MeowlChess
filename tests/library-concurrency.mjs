import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

// Every database and browser profile in this test is temporary.
const root = resolve(import.meta.dirname, '..');
const prefix = 'meowlchess-library-concurrency-';
const profile = await mkdtemp(join(tmpdir(), prefix));
let context;
const errors = [], requests = [];
try {
  const extension = join(root, 'extension');
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1000, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/review.html?siteSettings=1`);
    await page.evaluate(async () => {
      const { createReviewLibrary, createIndexedDBReviewStore, LIBRARY_LIMITS } = await import('./lib/library.js');
      const { analyzeGame, ANALYSIS_VERSION } = await import('./lib/review.js');
      const { importPgn } = await import('./lib/pgn.js');
      window.makeLibrary = name => {
        const store = createIndexedDBReviewStore({ databaseName: name });
        return { store, library: createReviewLibrary({ store, analysisVersion: ANALYSIS_VERSION }) };
      };
      window.records = makeLibrary('MeowlChess-concurrent-records');
      window.settings = { engineId: 'stockfish', engineName: 'Stockfish 18', moveTimeMs: 50, multiPV: 1, smartAnalysis: false, analysisVersion: ANALYSIS_VERSION };
      window.makeFixture = async index => {
        const pgn = `[Event "Concurrent ${index}"]\n[White "Player${index}"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0`;
        return { game: importPgn(pgn), result: await analyzeGame(pgn, { engineFactory: () => ({ async init() {}, dispose() {}, async evaluate() { return { cp: 0, mate: null, depth: 8, bestMove: null, pv: [], candidates: [] }; } }) }) };
      };
      window.limits = LIBRARY_LIMITS;
    });
  }
  const [a, b, c] = pages;
  // Three connections compete for the last available slots; no eviction occurs.
  const outcome = await Promise.all(pages.map((page, group) => page.evaluate(async group => {
    const outcomes = [];
    for (let index = group * 40; index < group * 40 + 40; index++) {
      const { game, result } = await makeFixture(index);
      try { const saved = await records.library.saveReview(game, result, settings); outcomes.push({ ok: true, id: saved.id }); }
      catch (error) { outcomes.push({ ok: false, code: error.code }); }
    }
    return outcomes;
  }, group)));
  const writes = outcome.flat();
  assert.equal(writes.filter(item => item.ok).length, 100);
  assert.equal(writes.filter(item => item.code === 'limit').length, 20);
  const id = writes.find(item => item.ok).id;
  assert.equal(await a.evaluate(async () => (await records.library.listReviews()).length), 100);
  console.log('PASS: three real IndexedDB connections enforce the 100-review limit across 120 competing saves');

  await Promise.all(pages.map((page, group) => page.evaluate(async ({ id, group }) => {
    for (let index = 0; index < 17; index++) await records.library.toggleBookmark(id, 1, { note: `Tab ${group} note ${index}` });
  }, { id, group })));
  assert.equal(await a.evaluate(async id => (await records.library.loadReview(id)).bookmarks.length, id), 1);
  const old = await a.evaluate(async id => records.library.loadReview(id), id);
  await Promise.all(pages.map(page => page.evaluate(async ({ game, result }) => {
    for (let index = 0; index < 12; index++) await records.library.saveReview(game, result, settings);
  }, old)));
  assert.equal((await a.evaluate(async id => records.library.loadReview(id), id)).bookmarks[0].note, old.bookmarks[0].note);
  assert.equal(await b.evaluate(async () => (await records.library.listReviews()).length), 100);
  console.log('PASS: 51 cross-tab bookmark toggles and 36 replacements preserve exact notes without lost writes');

  // Aborted writes never expose their provisional additions or deletions.
  assert.equal(await a.evaluate(async id => {
    try { await records.store.transact(() => { throw new DOMException('Injected full device', 'QuotaExceededError'); }); return false; }
    catch (error) { return error.code === 'quota' && !!(await records.library.loadReview(id)); }
  }, id), true);
  assert.equal(await a.evaluate(async id => {
    try { await records.store.transact(() => ({ remove: [id], put: [{ id: 'bad-record', uncloneable: () => {} }] })); return false; }
    catch { return !!(await records.library.loadReview(id)); }
  }, id), true);

  // The actual configured 40 MiB boundary, using bounded inert metadata.
  const capacity = await a.evaluate(async () => {
    const { store, library } = makeLibrary('MeowlChess-byte-capacity');
    let saved = 0, rejected = 0, lastId;
    for (let index = 0; index < 41; index++) {
      const { game, result } = await makeFixture(index + 200);
      result.localPadding = 'x'.repeat(1024 * 1024);
      try { lastId = (await library.saveReview(game, result, settings)).id; saved++; }
      catch (error) { if (error.code !== 'limit') throw error; rejected++; }
    }
    const rows = await store.readAll();
    const bytes = new TextEncoder().encode(JSON.stringify(rows).slice(1, -1)).byteLength - Math.max(0, rows.length - 1);
    const preserved = !!(await library.loadReview(lastId));
    const over = await makeFixture(900); over.result.localPadding = 'x'.repeat(limits.maxRecordBytes);
    let oversized = false;
    try { await library.saveReview(over.game, over.result, settings); } catch (error) { oversized = error.code === 'invalid'; }
    await library.close();
    return { saved, rejected, bytes, preserved, oversized };
  });
  assert.equal(capacity.saved, 39); assert.equal(capacity.rejected, 2); assert(capacity.bytes <= 40 * 1024 * 1024);
  assert(capacity.preserved); assert(capacity.oversized);
  console.log('PASS: actual 40 MiB and 4 MiB boundaries reject excess data without losing saved reviews');

  // Damaged records can be repaired explicitly, and future schemas stay untouched.
  await a.evaluate(async id => records.store.transact(rows => {
    const record = rows.find(item => item.id === id); record.result.summary.w.total = -1;
    return { put: [record] };
  }), id);
  assert.equal(await b.evaluate(async id => (await records.library.listReviews()).find(item => item.id === id).invalid, id), true);
  await c.evaluate(async ({ game, result }) => records.library.saveReview(game, result, settings), old);
  assert.equal((await a.evaluate(async id => records.library.loadReview(id), id)).bookmarks[0].note, old.bookmarks[0].note);
  await a.evaluate(async id => records.store.transact(rows => {
    const record = rows.find(item => item.id === id); record.schemaVersion = 999;
    return { put: [record] };
  }), id);
  assert.equal(await b.evaluate(async ({ game, result }) => {
    try { await records.library.saveReview(game, result, settings); return false; }
    catch (error) { return error.code === 'corrupt'; }
  }, old), true);
  await a.evaluate(async id => records.library.deleteReview(id), id);
  await b.evaluate(async ({ game, result }) => records.library.saveReview(game, result, settings), old);

  for (let index = 0; index < 12; index++) {
    await a.evaluate(async () => records.library.close());
    assert.equal(await a.evaluate(async () => (await records.library.listReviews()).length), 100);
  }
  const deletion = await Promise.all(pages.map(page => page.evaluate(async id => records.library.deleteReview(id), id)));
  assert.equal(deletion.filter(Boolean).length, 1);
  assert.equal(await a.evaluate(async () => (await records.library.listReviews()).length), 99);
  console.log('PASS: repair, future-schema preservation, 12 reopen cycles, and concurrent deletion');
  await Promise.all(pages.map(page => page.evaluate(async () => records.library.close())));
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
} finally {
  await closeTestContext(context, profile, prefix);
}
