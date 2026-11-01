import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { summarizeMaterial } from '../extension/lib/material.js';
import { parseCompletedPgn } from '../extension/lib/pgn.js';
import { createStudyLine } from '../extension/lib/study.js';

function position(fen, moves = []) {
  const chess = new Chess(fen);
  for (const move of moves) chess.move(move);
  return chess;
}
const summary = chess => summarizeMaterial({ fen: chess.fen(), moves: chess.history({ verbose: true }) });

test('initial board and equal pawn trades have no material advantage', () => {
  const chess = new Chess();
  assert.deepEqual(summary(chess), {
    w: { captured: [], material: 39, advantage: 0 },
    b: { captured: [], material: 39, advantage: 0 },
  });
  for (const san of ['e4', 'd5', 'exd5', 'Qxd5']) chess.move(san);
  assert.deepEqual(summary(chess), {
    w: { captured: ['p'], material: 38, advantage: 0 },
    b: { captured: ['p'], material: 38, advantage: 0 },
  });
});

test('en passant is a capture and rewinding removes that capture and advantage', () => {
  const chess = new Chess();
  for (const san of ['e4', 'a6', 'e5', 'd5', 'exd6']) chess.move(san);
  assert.deepEqual(summary(chess).w, { captured: ['p'], material: 39, advantage: 1 });
  assert.equal(summary(chess).b.advantage, 0);
  chess.undo();
  assert.deepEqual(summary(chess).w, { captured: [], material: 39, advantage: 0 });
  chess.move('Nf3');
  assert.deepEqual(summary(chess).w.captured, []);
});

test('custom starting positions use actual material without inventing captures', () => {
  const chess = new Chess('4k3/8/8/8/8/8/PNBRQ3/4K3 w - - 0 1');
  assert.deepEqual(summary(chess), {
    w: { captured: [], material: 21, advantage: 21 },
    b: { captured: [], material: 0, advantage: 0 },
  });
});

test('promotion changes current material without counting the promoted pawn as captured', () => {
  for (const [piece, value] of [['q', 9], ['r', 5], ['b', 3], ['n', 3]]) {
    const white = position('7k/P7/8/8/8/8/8/7K w - - 0 1', [{ from: 'a7', to: 'a8', promotion: piece }]);
    assert.deepEqual(summary(white).w, { captured: [], material: value, advantage: value });
    assert.deepEqual(summary(white).b, { captured: [], material: 0, advantage: 0 });
    const black = position('7k/8/8/8/8/8/p7/7K b - - 0 1', [{ from: 'a2', to: 'a1', promotion: piece }]);
    assert.deepEqual(summary(black).b, { captured: [], material: value, advantage: value });
  }
});

test('capture promotions record the captured piece, and promoted pieces can later be captured', () => {
  const capturePromotion = position('1r5k/P7/8/8/8/8/8/7K w - - 0 1', ['axb8=Q+']);
  assert.deepEqual(summary(capturePromotion).w, { captured: ['r'], material: 9, advantage: 9 });
  const recapture = position('1r5k/P7/8/8/8/8/8/7K w - - 0 1', ['a8=Q', 'Rxa8']);
  assert.deepEqual(summary(recapture), {
    w: { captured: [], material: 0, advantage: 0 },
    b: { captured: ['q'], material: 5, advantage: 5 },
  });
});

test('variation navigation retains earlier captures and excludes unseen continuation captures', () => {
  const pgn = '[Result "1-0"]\n\n1. e4 d5 2. exd5 Qxd5 3. Nc3 Qe5+ 1-0';
  const { parsed } = parseCompletedPgn(pgn);
  const line = createStudyLine(pgn, 3, ['d8d5', 'b1c3', 'd5d2']);
  const visible = () => summarizeMaterial({
    fen: line.fen,
    moves: [...parsed.moves.slice(0, line.basePly), ...line.moves.slice(0, line.cursor)],
  });
  assert.equal(line.moves.length, 3);
  assert.deepEqual(visible().w.captured, ['p']);
  assert.deepEqual(visible().b.captured, []);
  assert.equal(visible().w.advantage, 1);
  line.forward();
  assert.deepEqual(visible().b.captured, ['p']);
  assert.equal(visible().w.advantage, 0);
  line.goTo(3);
  assert.deepEqual(visible().b.captured, ['p', 'p']);
  assert.equal(visible().b.advantage, 1);
  line.back();
  assert.deepEqual(visible().b.captured, ['p']);
  line.play('d5e5');
  assert.deepEqual(visible().b.captured, ['p']);
  assert.equal(visible().b.advantage, 0);
});

test('summaries do not alter saved move history or retain captures from later calls', () => {
  const chess = new Chess();
  for (const san of ['e4', 'd5', 'exd5']) chess.move(san);
  const moves = chess.history({ verbose: true }).map(move => Object.freeze({ ...move }));
  Object.freeze(moves);
  const first = summarizeMaterial({ fen: chess.fen(), moves });
  first.w.captured.push('q');
  assert.deepEqual(summarizeMaterial({ fen: chess.fen(), moves }).w.captured, ['p']);
  const start = summarizeMaterial({ fen: moves[0].before, moves: [] });
  assert.deepEqual(start.w.captured, []);
  assert.equal(start.w.advantage, 0);
});
