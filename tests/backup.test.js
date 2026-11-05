import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, inspectBackup, restoreBackup, BACKUP_MAX_BYTES } from '../extension/lib/backup.js';
import { createReviewLibrary } from '../extension/lib/library.js';
import { analyzeGame } from '../extension/lib/review.js';
import { importPgn } from '../extension/lib/pgn.js';

const SETTINGS = { engineId: 'stockfish', engineName: 'Stockfish 18', moveTimeMs: 50, multiPV: 1, smartAnalysis: false, analysisVersion: 'test-backup' };
const copy = value => structuredClone(value);
function memoryStore() {
  const rows = new Map(); let progress = null, failure = false, queue = Promise.resolve();
  return {
    rows, get progress() { return copy(progress); }, set progress(value) { progress = copy(value); },
    failNext() { failure = true; },
    async read(id) { return copy(rows.get(id) || null); }, async readAll() { return copy([...rows.values()]); },
    async readCoachProgress() { return copy(progress); },
    async snapshot() { return copy({ reviews: [...rows.values()], coachProgress: progress }); },
    transact(update) {
      const next = queue.then(() => {
        const changes = update(copy([...rows.values()]), copy(progress));
        if (failure) { failure = false; throw new DOMException('Full', 'QuotaExceededError'); }
        const nextRows = new Map(rows);
        for (const record of changes.put || []) nextRows.set(record.id, copy(record));
        for (const id of changes.remove || []) nextRows.delete(id);
        rows.clear(); for (const [id, record] of nextRows) rows.set(id, record);
        if (changes.coachProgress) progress = copy(changes.coachProgress);
        return copy(changes.value);
      });
      queue = next.catch(() => {}); return next;
    },
  };
}
function memorySettings(seed = {}) {
  let values = copy(seed), rejectWrite = false;
  return {
    get values() { return copy(values); }, failWrites() { rejectWrite = true; }, allowWrites() { rejectWrite = false; },
    async get(keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, copy(values[key])])); },
    async set(patch) { if (rejectWrite) throw new Error('Storage unavailable'); values = { ...values, ...copy(patch) }; },
  };
}
const library = (store, options = {}) => createReviewLibrary({ store, analysisVersion: SETTINGS.analysisVersion, now: () => 5000, ...options });
async function save(reviewLibrary, index = 0) {
  const pgn = `[Event "Backup fixture"]\n[White "Alice${index}"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0`;
  const result = await analyzeGame(pgn, { smartAnalysis: false, engineFactory: () => ({
    async init() {}, dispose() {}, async evaluate() { return { cp: 0, mate: null, bestMove: null, pv: [], candidates: [], depth: 8 }; },
  }) });
  result.analysis.version = SETTINGS.analysisVersion;
  return reviewLibrary.saveReview(importPgn(pgn), result, SETTINGS);
}
const exportFile = (reviewLibrary, storage = memorySettings()) => createBackup({ library: reviewLibrary, storage, extensionVersion: '1.11.0', now: () => 10000 });

test('backup roundtrip preserves full analyses, bookmark notes, timestamps, settings and coach progress', async () => {
  const source = library(memoryStore()), saved = await save(source);
  await source.toggleBookmark(saved.id, 2, { note: 'Review this reply <b>later</b>' });
  const settings = memorySettings({
    username: 'Alice0', usernames: { chesscom: 'Alice0', lichess: 'https://lichess.org/abcdefgh' },
    savedAccounts: { chesscom: ['Alice0'], lichess: ['Alice'] },
    coachPreferences: { coach: 'mellow', sounds: true, volume: 0.35, motion: true, commentary: false, perspective: 'b', explanationLength: 'detailed' },
    reviewSettings: { engine: 'lozza', lines: '1', time: '150', smart: false, highlights: false, boardSize: 720, arrowMode: 'all', moveSounds: true },
    tutorialNeverShowAgain: true, supportNeverShowAgain: true, shareHidePlayerNames: false,
    'siteReviewPanelPosition:chesscom': { left: 30, top: 90 }, 'siteReviewPanelSize:chesscom': { width: 450, height: 620 },
    siteReviewSettings: { chesscom: { enabled: true, username: 'Alice0' }, lichess: { enabled: false, username: '' } },
    completionAlerts: true, updatePreferences: { automatic: true },
    siteReviewSession: { private: 'omit' }, updateCheckState: { cached: 'omit' }, backupRestoredAt: 123,
  });
  const backup = await exportFile(source, settings);
  assert.equal(backup.settings.siteReviewSession, undefined);
  assert.equal(backup.settings.updateCheckState, undefined);
  assert.equal(backup.settings.backupRestoredAt, undefined);
  const inspected = await inspectBackup(JSON.stringify(backup));
  assert.deepEqual(inspected.summary, { reviews: 1, bookmarks: 1, settings: 13, coachGames: 1, createdAt: 10000, extensionVersion: '1.11.0' });
  const target = library(memoryStore()), targetSettings = memorySettings();
  const restored = await restoreBackup(inspected.backup, { library: target, storage: targetSettings, hasPermission: async () => true });
  assert.equal(restored.added, 1); assert.equal(restored.settingsRestored, true); assert.deepEqual(restored.warnings, []);
  assert.deepEqual(await target.exportBackupData(), await source.exportBackupData());
  assert.deepEqual(targetSettings.values, backup.settings);
  assert.equal(targetSettings.values.coachPreferences.explanationLength, 'detailed');
});

test('duplicate review analysis and existing notes stay intact while missing bookmarks merge', async () => {
  const source = library(memoryStore()), saved = await save(source);
  await source.toggleBookmark(saved.id, 1, { note: 'Backup note' }); await source.toggleBookmark(saved.id, 2, { note: 'New bookmark' });
  const target = library(memoryStore(), { now: () => 20000 });
  await save(target); await target.toggleBookmark(saved.id, 1, { note: 'Keep this local note' });
  const before = await target.loadReview(saved.id), backup = await exportFile(source);
  const first = await restoreBackup(backup, { library: target, restoreSettings: false });
  assert.equal(first.added, 0); assert.equal(first.kept, 1); assert.equal(first.bookmarksAdded, 1);
  const after = await target.loadReview(saved.id);
  assert.deepEqual(after.analysis, before.analysis); assert.deepEqual(after.result, before.result);
  assert.equal(after.createdAt, 20000); assert.equal(after.updatedAt, 20000);
  assert.deepEqual(after.bookmarks.map(mark => mark.note), ['Keep this local note', 'New bookmark']);
  const second = await restoreBackup(backup, { library: target, restoreSettings: false });
  assert.equal(second.bookmarksAdded, 0); assert.equal(second.coachGames, 1);
});

test('Baby Meowl preferences roundtrip without unlock progress or saved games', async () => {
  const preferences = { coach: 'baby', perspective: 'both', sounds: false, volume: 0.4, motion: true, commentary: true, explanationLength: 'brief' };
  const backup = await exportFile(library(memoryStore()), memorySettings({ coachPreferences: preferences }));
  const inspected = await inspectBackup(JSON.stringify(backup));
  assert.equal(inspected.summary.reviews, 0);
  assert.equal(inspected.summary.coachGames, 0);
  const targetSettings = memorySettings({ coachPreferences: { coach: 'meowl' } });
  const result = await restoreBackup(inspected.backup, { library: library(memoryStore()), storage: targetSettings });
  assert.equal(result.settingsRestored, true);
  assert.deepEqual(targetSettings.values.coachPreferences, preferences);
});

test('relative coach focus survives backup export, inspection and restore', async () => {
  for (const perspective of ['me', 'opponent']) {
    const preferences = { coach: 'meowl', perspective, commentary: true };
    const backup = await exportFile(library(memoryStore()), memorySettings({ coachPreferences: preferences }));
    const inspected = await inspectBackup(JSON.stringify(backup));
    const targetSettings = memorySettings({ coachPreferences: { perspective: 'both' } });
    await restoreBackup(inspected.backup, { library: library(memoryStore()), storage: targetSettings });
    assert.deepEqual(targetSettings.values.coachPreferences, preferences);
  }
});

test('preferences replace selected values, merge accounts, and require existing browser grants', async () => {
  const sourceSettings = memorySettings({
    usernames: { chesscom: 'NewName' }, savedAccounts: { chesscom: ['NewName'], lichess: [] },
    reviewSettings: { engine: 'stockfish', boardSize: 'auto' }, completionAlerts: true,
    siteReviewSettings: { chesscom: { enabled: true, username: 'NewName' }, lichess: { enabled: true, username: 'OtherName' } },
    updatePreferences: { automatic: true },
  });
  const backup = await exportFile(library(memoryStore()), sourceSettings);
  const targetSettings = memorySettings({ usernames: { chesscom: 'OldName', lichess: 'KeepMe' }, savedAccounts: { chesscom: ['OldName'], lichess: ['KeepMe'] }, reviewSettings: { engine: 'lozza', boardSize: 640 } });
  const result = await restoreBackup(backup, { library: library(memoryStore()), storage: targetSettings });
  assert.deepEqual(targetSettings.values.usernames, { chesscom: 'NewName', lichess: 'KeepMe' });
  assert.deepEqual(targetSettings.values.savedAccounts, { chesscom: ['NewName', 'OldName'], lichess: ['KeepMe'] });
  assert.deepEqual(targetSettings.values.reviewSettings, { engine: 'stockfish', boardSize: 'auto' });
  assert.equal(targetSettings.values.siteReviewSettings.chesscom.enabled, false);
  assert.equal(targetSettings.values.siteReviewSettings.lichess.enabled, false);
  assert.equal(targetSettings.values.completionAlerts, false); assert.equal(targetSettings.values.updatePreferences.automatic, false);
  assert.deepEqual(result.disabledSites, ['chesscom', 'lichess']); assert.equal(result.warnings.length, 3);
  const unchanged = copy(targetSettings.values);
  await restoreBackup(backup, { library: library(memoryStore()), storage: targetSettings, restoreSettings: false });
  assert.deepEqual(targetSettings.values, unchanged);
});

test('invalid full analysis, schema, identity, duplicate rows and oversized files reject before mutation', async () => {
  const source = library(memoryStore()); await save(source);
  const backup = await exportFile(source), targetStore = memoryStore(), target = library(targetStore), storage = memorySettings({ username: 'KeepMe' });
  const mutations = [
    value => { value.schemaVersion = 99; },
    value => { value.library.reviews[0].schemaVersion = 99; },
    value => { value.library.reviews[0].id = 'game-' + 'a'.repeat(64); },
    value => { value.library.reviews.push(copy(value.library.reviews[0])); },
    value => { value.library.reviews[0].result.positions[0].pv = ['e7e5']; },
    value => { value.library.coachProgress.gameKeys.push(value.library.coachProgress.gameKeys[0]); },
    value => { value.settings.reviewSettings = { boardSize: Infinity }; },
    value => { value.settings.coachPreferences = { explanationLength: 'unbounded' }; },
  ];
  for (const mutate of mutations) {
    const value = copy(backup); mutate(value);
    await assert.rejects(restoreBackup(value, { library: target, storage }));
    assert.equal(targetStore.rows.size, 0); assert.equal(targetStore.progress, null);
    assert.deepEqual(storage.values, { username: 'KeepMe' });
  }
  await assert.rejects(inspectBackup('not JSON'), /valid backup JSON/);
  await assert.rejects(inspectBackup('x'.repeat(BACKUP_MAX_BYTES + 1)), error => error.code === 'too-large');
});

test('capacity or transaction failure leaves the entire target library and settings unchanged', async () => {
  const source = library(memoryStore()); await save(source, 1); await save(source, 2);
  const backup = await exportFile(source, memorySettings({ username: 'Overwrite' }));
  const targetStore = memoryStore(), target = library(targetStore, { maxReviews: 2 }), storage = memorySettings({ username: 'KeepMe' });
  await save(target, 0); const before = await target.exportBackupData();
  await assert.rejects(restoreBackup(backup, { library: target, storage }), error => error.code === 'limit');
  assert.deepEqual(await target.exportBackupData(), before); assert.equal(storage.values.username, 'KeepMe');
  const emptyStore = memoryStore(), empty = library(emptyStore); emptyStore.failNext();
  await assert.rejects(restoreBackup(backup, { library: empty, storage }), error => error.code === 'quota');
  assert.equal(emptyStore.rows.size, 0); assert.equal(emptyStore.progress, null); assert.equal(storage.values.username, 'KeepMe');
});

test('settings failure reports partial restore and retry keeps imported reviews without duplication', async () => {
  const source = library(memoryStore()); await save(source);
  const backup = await exportFile(source, memorySettings({ username: 'Alice' }));
  const target = library(memoryStore()), storage = memorySettings(); storage.failWrites();
  const partial = await restoreBackup(backup, { library: target, storage });
  assert.equal(partial.added, 1); assert.equal(partial.settingsRestored, false);
  assert.match(partial.warnings[0], /preferences could not be saved/);
  storage.allowWrites();
  const retry = await restoreBackup(backup, { library: target, storage });
  assert.equal(retry.added, 0); assert.equal(retry.kept, 1); assert.equal(retry.settingsRestored, true);
  assert.equal(storage.values.username, 'Alice'); assert.equal((await target.listReviews()).length, 1);
});

test('lifetime coach unlock survives deleting all reviewed games before exporting', async () => {
  const source = library(memoryStore());
  for (let index = 0; index < 10; index++) { const saved = await save(source, index); await source.deleteReview(saved.id); }
  const backup = await exportFile(source);
  assert.equal(backup.library.reviews.length, 0); assert.equal(backup.library.coachProgress.gameKeys.length, 10);
  const target = library(memoryStore());
  await restoreBackup(backup, { library: target, restoreSettings: false });
  assert.deepEqual(await target.getCoachUnlockProgress(), { count: 10, required: 10, unlocked: true });
});

test('export rejects unreadable reviews rather than silently creating an incomplete backup', async () => {
  const store = memoryStore(), source = library(store), saved = await save(source);
  store.rows.get(saved.id).schemaVersion = 999;
  const before = copy(store.rows.get(saved.id));
  await assert.rejects(exportFile(source), /could not include every saved review/);
  assert.deepEqual(store.rows.get(saved.id), before);
});

test('unsupported local rows are preserved on duplicate import', async () => {
  const source = library(memoryStore()), saved = await save(source), backup = await exportFile(source);
  const store = memoryStore(), target = library(store); await save(target);
  store.rows.get(saved.id).schemaVersion = 999;
  const before = copy(store.rows.get(saved.id));
  const result = await restoreBackup(backup, { library: target, restoreSettings: false });
  assert.equal(result.kept, 1); assert.deepEqual(store.rows.get(saved.id), before);
});
