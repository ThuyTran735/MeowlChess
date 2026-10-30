import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGame, analyzeGame, ANALYSIS_VERSION, REVIEW_SCHEMA_VERSION } from '../extension/lib/review.js';
import { recognizeOpening, OPENING_DATA_VERSION } from '../extension/lib/openings.js';
import { OPENING_LINES } from '../extension/data/openings.js';

const game = line => parseGame(`[Result "1-0"]\n\n${line} 1-0`);
const score = (cp = 0, bestMove = null, mate = null) => ({ cp, bestMove, mate, depth: 10, pv: [], candidates: [] });
function engineFactory(evaluations = []) {
  let index = 0;
  return () => ({ async init() {}, async evaluate() { return evaluations[index++] || score(); }, dispose() {} });
}

test('the bundled opening dataset has a pinned identity and legal-move sequence format', () => {
  assert.match(OPENING_DATA_VERSION, /^[a-f0-9]{40}$/);
  assert.equal(OPENING_LINES.length, 3865);
  assert(OPENING_LINES.every(([eco, name, moves]) => /^[A-E]\d\d$/.test(eco) && name.length > 0 && /^(?:[a-h][1-8][a-h][1-8][qrbn]?)(?: [a-h][1-8][a-h][1-8][qrbn]?)*$/.test(moves)));
  assert(ANALYSIS_VERSION.includes(OPENING_DATA_VERSION.slice(0, 12)));
  assert.equal(REVIEW_SCHEMA_VERSION, 2);
});

test('recognizes the longest named opening and tracks known continuations separately', () => {
  const ruy = recognizeOpening(game('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6'));
  assert.equal(ruy.name, 'Ruy Lopez: Morphy Defense');
  assert.equal(ruy.eco, 'C70');
  assert.equal(ruy.ply, 6);
  assert.equal(ruy.lastBookPly, 8);
  assert.equal(ruy.departurePly, null);
  assert.equal(ruy.byPly.length, 8);
  assert.notEqual(ruy.byPly[0].name, ruy.name);
  const dragon = recognizeOpening(game('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6'));
  assert.equal(dragon.name, 'Sicilian Defense: Dragon Variation');
  assert.equal(dragon.eco, 'B70');
  assert.equal(dragon.ply, 10);
});

test('stops at a departure, never guesses from a later position, and excludes custom starts', () => {
  const departed = recognizeOpening(game('1. h3 a5 2. a3 a4'));
  assert.equal(departed.name, 'Clemenz Opening');
  assert.equal(departed.lastBookPly, 1);
  assert.equal(departed.departurePly, 2);
  const returned = recognizeOpening(game('1. Nf3 Nf6 2. Ng1 Ng8 3. e4 e5'));
  assert(returned.lastBookPly < 5);
  assert(!returned.name.includes("King's Pawn"));
  const custom = parseGame('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n[Result "1-0"]\n\n1. e4 1-0');
  assert.equal(recognizeOpening(custom), null);
});

test('Book moves count for each player but do not inflate their study score', async () => {
  const pgn = '[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
  const result = await analyzeGame(pgn, { engineFactory: engineFactory() });
  assert(result.moves.every(move => move.isBook && move.label === 'Book' && move.accuracy === null));
  assert.equal(result.summary.w.total, 2);
  assert.equal(result.summary.w.bookTotal, 2);
  assert.equal(result.summary.w.scoredTotal, 0);
  assert.equal(result.summary.w.accuracy, null);
  assert.equal(result.summary.b.counts.Book, 1);
  assert.equal(result.summary.b.accuracy, null);
  assert.match(result.moves[0].explanation, /excluded from study scores/);
  const mixed = await analyzeGame('[Result "1-0"]\n\n1. h3 a5 2. a3 a4 1-0', { engineFactory: engineFactory() });
  assert.equal(mixed.summary.w.bookTotal, 1);
  assert.equal(mixed.summary.w.scoredTotal, 1);
  assert.equal(mixed.summary.w.accuracy, 100);
  assert.equal(mixed.summary.b.bookTotal, 0);
  assert.equal(mixed.summary.b.scoredTotal, 2);
});

test('a named trap does not hide a tactical error or checkmate behind Book', async () => {
  const pgn = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
  const result = await analyzeGame(pgn, { engineFactory: engineFactory([score(), score(), score(), score(-99900, 'd8h4', -1)]) });
  assert.equal(result.opening.name, "Barnes Opening: Fool's Mate");
  assert.equal(result.moves[2].label, 'Blunder');
  assert.equal(result.moves[2].isBook, false);
  assert.equal(result.moves[3].label, 'Best');
  assert.match(result.moves[3].explanation, /delivers checkmate/);
  assert.equal(result.summary.w.scoredTotal, 1);
  assert.equal(result.summary.b.scoredTotal, 1);
});
