import { Chess } from '../vendor/chess.js';
import { MOVE_LABELS } from './review.js';
import { importPgn, parseCompletedPgn, safeOriginalGameUrl } from './pgn.js';

export const LIBRARY_SCHEMA_VERSION = 1;
export const LIBRARY_LIMITS = Object.freeze({ maxReviews: 100, maxBytes: 40 * 1024 * 1024, maxRecordBytes: 4 * 1024 * 1024 });
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const ID = /^game-[a-f0-9]{64}$/;
const LABELS = new Set([...MOVE_LABELS, 'Book']);
const encoder = new TextEncoder();
const clone = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);
const text = (value, max) => typeof value === 'string' && value.length <= max;

export class LibraryError extends Error {
  constructor(code, message, cause) { super(message, cause ? { cause } : undefined); this.name = 'LibraryError'; this.code = code; }
}
function invalid(message = 'This review contains invalid or incomplete data.') { throw new LibraryError('invalid', message); }
function storageError(error) {
  if (error instanceof LibraryError) return error;
  if (error?.name === 'QuotaExceededError') return new LibraryError('quota', 'Your browser has no space left for this review. Delete a saved review and try again.', error);
  return new LibraryError('unavailable', 'Saved reviews are unavailable in this browser session. Your current game is still open; try again before closing it.', error);
}
function jsonCopy(value) {
  try {
    const json = JSON.stringify(value);
    if (!json || encoder.encode(json).byteLength > LIBRARY_LIMITS.maxRecordBytes) invalid('This review is too large to save.');
    return JSON.parse(json);
  } catch (error) { if (error instanceof LibraryError) throw error; invalid(); }
}
function byteSize(value) { return encoder.encode(JSON.stringify(value)).byteLength; }

/** Local IndexedDB only. transact's synchronous callback must return {put,remove,value}. */
export function createIndexedDBReviewStore({ indexedDB = globalThis.indexedDB, databaseName = 'meowlchess-review-library' } = {}) {
  let connection;
  const open = () => {
    if (!indexedDB?.open) return Promise.reject(new LibraryError('unavailable', 'This browser cannot save reviews locally. Your current review is still available until you close it.'));
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      let request, blocked = false;
      try { request = indexedDB.open(databaseName, 1); } catch (error) { reject(storageError(error)); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('reviews')) request.result.createObjectStore('reviews', { keyPath: 'id' }); };
      request.onerror = () => { connection = null; reject(storageError(request.error)); };
      request.onblocked = () => { blocked = true; connection = null; reject(new LibraryError('unavailable', 'Close other MeowlChess review tabs, then try saving again.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = null; };
        db.onclose = () => { connection = null; };
        resolve(db);
      };
    });
    return connection;
  };
  const read = async (id, all = false) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      let request;
      try { const store = db.transaction('reviews', 'readonly').objectStore('reviews'); request = all ? store.getAll() : store.get(id); }
      catch (error) { reject(storageError(error)); return; }
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(storageError(request.error));
    });
  };
  return {
    read: id => read(id), readAll: () => read(null, true),
    async transact(update) {
      const db = await open();
      return new Promise((resolve, reject) => {
        let transaction, result, failure;
        try { transaction = db.transaction('reviews', 'readwrite'); } catch (error) { reject(storageError(error)); return; }
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure || storageError(transaction.error));
        transaction.onerror = event => { failure ||= storageError(event.target?.error || transaction.error); };
        const store = transaction.objectStore('reviews');
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const changes = update(request.result);
            if (!changes || typeof changes.then === 'function') throw new TypeError('The library transaction must be synchronous.');
            for (const id of changes.remove || []) store.delete(id);
            for (const record of changes.put || []) store.put(record);
            result = changes.value;
          } catch (error) { failure = storageError(error); transaction.abort(); }
        };
      });
    },
    async close() { const pending = connection; connection = null; if (pending) (await pending).close(); },
  };
}

function canonicalIdentity(parsed) {
  // Preserve distinct games between different players/dates while ignoring PGN whitespace and comments.
  const headers = Object.fromEntries(['White', 'Black', 'Date', 'UTCDate', 'UTCTime', 'Site', 'Link', 'Event', 'Round'].map(key => [key, parsed.headers[key] || '']));
  return JSON.stringify([headers, parsed.positions[0], parsed.moves.map(move => move.from + move.to + (move.promotion || '')), parsed.headers.Result]);
}
export async function reviewIdForGame(gameOrPgn) {
  const { parsed } = parseCompletedPgn(typeof gameOrPgn === 'string' ? gameOrPgn : gameOrPgn?.pgn);
  if (!globalThis.crypto?.subtle) throw new LibraryError('unavailable', 'This browser cannot create a reliable saved-game identity.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalIdentity(parsed)));
  return 'game-' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function normalizeGame(raw) {
  if (!plain(raw)) invalid();
  const game = importPgn(raw.pgn);
  game.source = ['chesscom', 'lichess', 'pgn'].includes(raw.source) ? raw.source : game.source;
  game.imported = game.source === 'pgn';
  if (raw.sample === true) game.sample = true;
  const url = safeOriginalGameUrl(raw.url); if (url) game.url = url;
  if (number(raw.end_time, 1, Date.now() / 1000 + 86400)) game.end_time = Math.floor(raw.end_time);
  if (text(raw.time_class, 40) && raw.time_class) game.time_class = raw.time_class;
  for (const side of ['white', 'black']) {
    if (text(raw[side]?.username, 200) && raw[side].username) game[side].username = raw[side].username;
    if (number(raw[side]?.rating, 0, 10000)) game[side].rating = raw[side].rating;
  }
  return game;
}
function normalizeAnalysis(raw, fallbackVersion) {
  if (!plain(raw)) invalid('The saved review is missing its engine settings.');
  const version = raw.analysisVersion || fallbackVersion;
  if (!['stockfish', 'lozza'].includes(raw.engineId) || !text(raw.engineName, 80) || !raw.engineName || !text(version, 160) || !version
    || !integer(raw.moveTimeMs, 1, 60000) || !integer(raw.multiPV, 1, 3) || (raw.smartAnalysis !== undefined && typeof raw.smartAnalysis !== 'boolean') || (raw.engineId === 'lozza' && raw.multiPV !== 1)) invalid('The saved review has invalid engine settings.');
  return { engineId: raw.engineId, engineName: raw.engineName, moveTimeMs: raw.moveTimeMs, multiPV: raw.multiPV, smartAnalysis: raw.smartAnalysis === true, analysisVersion: version };
}
function validateLine(line, fen, deep) {
  if (!Array.isArray(line) || line.length > 256 || line.some(move => typeof move !== 'string' || !UCI.test(move))) invalid('A saved engine line is invalid.');
  if (deep && line.length) {
    const chess = new Chess(fen);
    try { for (const move of line) chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }); }
    catch { invalid('A saved engine line does not belong to this position.'); }
  }
}
function validateEvaluation(value, fen, deep, candidate = false) {
  if (!plain(value) || !number(value.cp, -1000000, 1000000) || !(value.mate == null || integer(value.mate, -10000, 10000)) || !integer(value.depth, 0, 1000)) invalid('A saved evaluation is invalid.');
  if (value.bestMove !== null && value.bestMove !== undefined) validateLine([value.bestMove], fen, deep);
  validateLine(value.pv || [], fen, deep);
  if (candidate) {
    if (!integer(value.rank, 1, 3)) invalid('A saved engine candidate has an invalid rank.');
  } else if (value.candidates !== undefined) {
    if (!Array.isArray(value.candidates) || value.candidates.length > 3) invalid();
    const ranks = new Set();
    for (const entry of value.candidates) { validateEvaluation(entry, fen, deep, true); if (ranks.has(entry.rank)) invalid(); ranks.add(entry.rank); }
  }
}
function normalizeResult(input, parsed, deep = true) {
  const result = jsonCopy(input);
  if (!plain(result) || !Array.isArray(result.positions) || result.positions.length !== parsed.positions.length || !Array.isArray(result.moves) || result.moves.length !== parsed.moves.length
    || JSON.stringify(result.game?.positions) !== JSON.stringify(parsed.positions)) invalid('This saved analysis belongs to a different game.');
  result.positions.forEach((evaluation, ply) => validateEvaluation(evaluation, parsed.positions[ply], deep));
  result.moves = result.moves.map((move, index) => {
    const actual = parsed.moves[index];
    if (!plain(move) || move.ply !== index + 1 || ['from', 'to', 'color', 'san', 'before', 'after'].some(key => move[key] !== actual[key]) || move.promotion !== actual.promotion
      || !LABELS.has(move.label) || !number(move.loss, 0, 2000000) || !number(move.probabilityLoss, 0, 1)
      || !(move.label === 'Book' && move.accuracy === null || number(move.accuracy, 0, 100)) || !text(move.explanation, 4000)
      || !(move.bestSan == null || text(move.bestSan, 64)) || (move.isBook !== undefined && move.isBook !== (move.label === 'Book')) || (move.confirmed !== undefined && typeof move.confirmed !== 'boolean')
      || JSON.stringify(move.evalAfter) !== JSON.stringify(result.positions[index + 1])) invalid('The saved move list does not match this game.');
    return { ...move, ...actual, ply: index + 1, evalAfter: result.positions[index + 1] };
  });
  if (!plain(result.summary)) invalid('The saved review summary is invalid.');
  for (const color of ['w', 'b']) {
    const side = result.summary[color];
    const moves = result.moves.filter(move => move.color === color);
    const scored = moves.filter(move => move.accuracy !== null);
    const expected = scored.length ? Math.round(scored.reduce((sum, move) => sum + move.accuracy, 0) / scored.length * 10) / 10 : null;
    if (!plain(side) || side.total !== moves.length || !plain(side.counts) || side.accuracy !== expected) invalid('The saved review summary does not match its moves.');
    if (side.scoredTotal !== undefined && side.scoredTotal !== scored.length || side.bookTotal !== undefined && side.bookTotal !== moves.length - scored.length) invalid('The saved book-move counts are inconsistent.');
    for (const label of LABELS) if ((side.counts[label] || 0) !== moves.filter(move => move.label === label).length) invalid('The saved move counts are inconsistent.');
  }
  result.game = jsonCopy(parsed);
  if (result.opening != null && (!plain(result.opening) || !(result.opening.name == null || text(result.opening.name, 500)) || !(result.opening.eco == null || text(result.opening.eco, 16)))) invalid('The saved opening metadata is invalid.');
  return result;
}
function normalizeBookmarks(raw, total) {
  if (!Array.isArray(raw) || raw.length > total + 1) invalid('Saved bookmarks are invalid.');
  const seen = new Set();
  return raw.map(bookmark => {
    if (!plain(bookmark) || !integer(bookmark.ply, 0, total) || seen.has(bookmark.ply) || !number(bookmark.createdAt, 1, Number.MAX_SAFE_INTEGER) || !text(bookmark.note, 2000)) invalid('A saved bookmark has an invalid position.');
    seen.add(bookmark.ply);
    return { ply: bookmark.ply, createdAt: bookmark.createdAt, note: bookmark.note };
  }).sort((a, b) => a.ply - b.ply);
}
function normalizeRecord(raw, deep = true) {
  try {
    if (!plain(raw) || raw.schemaVersion !== LIBRARY_SCHEMA_VERSION || !ID.test(raw.id) || !number(raw.createdAt, 1, Number.MAX_SAFE_INTEGER) || !number(raw.updatedAt, raw.createdAt, Number.MAX_SAFE_INTEGER)) invalid();
    const game = normalizeGame(raw.game);
    const { parsed } = parseCompletedPgn(game.pgn);
    const analysis = normalizeAnalysis(raw.analysis), result = normalizeResult(raw.result, parsed, deep);
    if (result.analysis?.version && result.analysis.version !== analysis.analysisVersion || result.analysis?.smartAnalysis !== undefined && result.analysis.smartAnalysis !== analysis.smartAnalysis) invalid('The saved analysis settings do not match its results.');
    return { schemaVersion: LIBRARY_SCHEMA_VERSION, id: raw.id, game, analysis, result, bookmarks: normalizeBookmarks(raw.bookmarks, parsed.moves.length), createdAt: raw.createdAt, updatedAt: raw.updatedAt };
  } catch (error) { throw new LibraryError('corrupt', 'This saved review is damaged or uses an unsupported format. Reopen its game and review it again, or delete the saved copy.', error); }
}

/** Construct once per page. No in-memory cache: every call observes committed IndexedDB data. */
export function createReviewLibrary({ store = createIndexedDBReviewStore(), analysisVersion = 'legacy', now = () => Date.now(), maxReviews = LIBRARY_LIMITS.maxReviews, maxBytes = LIBRARY_LIMITS.maxBytes } = {}) {
  if (!integer(maxReviews, 1, 10000) || !integer(maxBytes, 1, Number.MAX_SAFE_INTEGER) || !text(analysisVersion, 160) || !analysisVersion) throw new TypeError('Invalid library configuration.');
  const call = async (method, ...args) => { try { return await store[method](...args); } catch (error) { throw storageError(error); } };
  const expose = record => ({ ...record, stale: record.analysis.analysisVersion !== analysisVersion });
  const summary = record => ({ id: record.id, game: record.game, analysis: record.analysis, opening: record.result.opening ? { name: record.result.opening.name, eco: record.result.opening.eco } : null, createdAt: record.createdAt, updatedAt: record.updatedAt, bookmarkCount: record.bookmarks.length, moveCount: record.result.moves.length, stale: record.analysis.analysisVersion !== analysisVersion });
  const capacity = records => {
    if (records.length > maxReviews) throw new LibraryError('limit', `Your library already has ${maxReviews} games. Delete a saved game before adding another. Bookmarked games are never removed automatically.`);
    if (records.some(record => byteSize(record) > LIBRARY_LIMITS.maxRecordBytes) || records.reduce((bytes, record) => bytes + byteSize(record), 0) > maxBytes) throw new LibraryError('limit', 'Your saved-review library is full. Delete a saved review before saving this one. Nothing has been removed.');
  };
  const validRecords = async () => {
    const records = await call('readAll');
    return Promise.all(records.map(async raw => {
      try {
        const record = normalizeRecord(raw, false);
        if (await reviewIdForGame(record.game) !== record.id) throw new LibraryError('corrupt', 'This saved review has the wrong game identity.');
        return record;
      } catch (error) { return { id: raw.id, invalid: true, error: error.message, createdAt: raw.createdAt || 0, updatedAt: raw.updatedAt || 0, bookmarkCount: Array.isArray(raw.bookmarks) ? raw.bookmarks.length : 0, game: { white: { username: 'Unreadable saved game' }, black: { username: '' } }, stale: true }; }
    }));
  };
  return {
    async listReviews() { return (await validRecords()).map(record => record.invalid ? record : summary(record)).sort((a, b) => b.updatedAt - a.updatedAt); },
    async loadReview(id) {
      const raw = await call('read', id); if (!raw) return null;
      const record = normalizeRecord(raw);
      if (record.id !== id || await reviewIdForGame(record.game) !== id) throw new LibraryError('corrupt', 'This saved review has the wrong game identity.');
      return expose(record);
    },
    async saveReview(game, result, settings) {
      const normalizedGame = normalizeGame(game);
      const { parsed } = parseCompletedPgn(normalizedGame.pgn);
      const normalizedResult = normalizeResult(result, parsed);
      const analysis = normalizeAnalysis(settings, analysisVersion);
      if (normalizedResult.analysis?.version && normalizedResult.analysis.version !== analysis.analysisVersion || normalizedResult.analysis?.smartAnalysis !== undefined && normalizedResult.analysis.smartAnalysis !== analysis.smartAnalysis) invalid('The engine settings do not match this analysis result.');
      const id = await reviewIdForGame(normalizedGame);
      const timestamp = now(); if (!number(timestamp, 1, Number.MAX_SAFE_INTEGER)) invalid('The system clock cannot timestamp this review.');
      return call('transact', records => {
        const previous = records.find(record => record.id === id);
        const old = previous ? normalizeRecord(previous, false) : null;
        const record = { schemaVersion: LIBRARY_SCHEMA_VERSION, id, game: normalizedGame, result: normalizedResult, analysis, bookmarks: old?.bookmarks || [], createdAt: old?.createdAt || timestamp, updatedAt: Math.max(timestamp, old?.updatedAt || 0) };
        capacity([...records.filter(item => item.id !== id), record]);
        return { put: [record], value: expose(clone(record)) };
      });
    },
    async deleteReview(id) { return call('transact', records => ({ remove: [id], value: records.some(record => record.id === id) })); },
    async toggleBookmark(id, ply, { note = '' } = {}) {
      if (!integer(ply, 0, 1000) || !text(note, 2000)) invalid('Choose a valid game position and a note shorter than 2,000 characters.');
      const timestamp = now(); if (!number(timestamp, 1, Number.MAX_SAFE_INTEGER)) invalid('The system clock cannot timestamp this bookmark.');
      return call('transact', records => {
        const raw = records.find(record => record.id === id);
        if (!raw) throw new LibraryError('not-found', 'Save a completed review before bookmarking its positions.');
        const record = normalizeRecord(raw, false);
        if (ply >= record.result.game.positions.length) invalid('That position is outside this completed game.');
        const index = record.bookmarks.findIndex(bookmark => bookmark.ply === ply);
        let bookmark = null;
        if (index >= 0) record.bookmarks.splice(index, 1);
        else { bookmark = { ply, note, createdAt: timestamp }; record.bookmarks.push(bookmark); record.bookmarks.sort((a, b) => a.ply - b.ply); }
        record.updatedAt = Math.max(timestamp, record.updatedAt);
        capacity(records.map(item => item.id === id ? record : item));
        return { put: [record], value: { bookmarked: !!bookmark, bookmark: bookmark ? clone(bookmark) : null } };
      });
    },
    async listBookmarks() {
      return (await validRecords()).filter(record => !record.invalid).flatMap(record => record.bookmarks.map(bookmark => ({ ...bookmark, reviewId: record.id, fen: record.result.game.positions[bookmark.ply], game: record.game, analysis: record.analysis, label: record.result.moves[bookmark.ply - 1]?.label || null, bestMove: record.result.positions[bookmark.ply]?.bestMove || null, stale: record.analysis.analysisVersion !== analysisVersion }))).sort((a, b) => b.createdAt - a.createdAt);
    },
    async listPracticePositions({ includeInaccuracies = false, limit = 500 } = {}) {
      if (!integer(limit, 1, 500)) invalid('Choose up to 500 practice positions.');
      const labels = new Set(includeInaccuracies ? ['Mistake', 'Blunder', 'Inaccuracy'] : ['Mistake', 'Blunder']);
      return (await validRecords()).filter(record => !record.invalid).sort((a, b) => b.updatedAt - a.updatedAt).flatMap(record => record.result.moves.filter(move => labels.has(move.label)).map(move => ({ reviewId: record.id, ply: move.ply, game: record.game, label: move.label, createdAt: record.createdAt, stale: record.analysis.analysisVersion !== analysisVersion }))).slice(0, limit);
    },
    async close() { if (store.close) await call('close'); },
  };
}
