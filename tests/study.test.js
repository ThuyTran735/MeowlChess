import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { createStudyLine } from '../extension/lib/study.js';
import { gradeRetry } from '../extension/lib/practice.js';
import { explainConsequence } from '../extension/lib/tactics.js';

const PGN = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0';
const MATE = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const score = (cp, bestMove = null, pv = [], mate = null) => ({ cp, bestMove, pv, mate, depth: 15 });
function fakeEngine(evaluations) {
  const calls = [];
  const engine = { disposed: false, initialized: false, async init() { this.initialized = true; }, async evaluate(fen, options) { calls.push({ fen, options }); const value = evaluations[calls.length - 1]; if (value instanceof Error) throw value; return value; }, dispose() { this.disposed = true; } };
  return { calls, engine, engineFactory: () => engine };
}

test('study lines start at the completed-game position and retain the full original prefix', () => {
  const line = createStudyLine(PGN, 2, ['g1f3', 'b8c6', 'f1c4']);
  assert.equal(line.cursor, 0);
  assert.equal(line.moves.length, 3);
  assert.deepEqual(line.history, ['e2e4', 'e7e5']);
  assert.equal(line.turn, 'w');
  assert.equal(line.truncated, false);
  assert.equal(line.forward(), line.positions[1]);
  assert.equal(line.cursor, 1);
  assert.deepEqual(line.history, ['e2e4', 'e7e5', 'g1f3']);
  line.goTo(3); assert.equal(line.canForward, false);
  line.back(); assert.equal(line.cursor, 2);
  line.reset(); assert.equal(line.cursor, 0); assert.equal(line.moves.length, 3);
});

test('a legal user branch replaces the old continuation and illegal moves leave it intact', () => {
  const line = createStudyLine(PGN, 0, ['e2e4', 'e7e5', 'g1f3']);
  line.forward();
  const move = line.play({ from: 'c7', to: 'c5' });
  assert.equal(move.san, 'c5');
  assert.deepEqual(line.moves.map(move => move.uci), ['e2e4', 'c7c5']);
  const positions = line.positions;
  assert.throws(() => line.play('a1a8'), /not legal/);
  assert.deepEqual(line.positions, positions);
  assert.equal(line.cursor, 2);
  assert.throws(() => line.goTo(3), /within this study line/);
});

test('illegal or malformed supplied PV is truncated at its legal prefix', () => {
  for (const bad of ['e2e4', 'bogus', 'e7e8x']) {
    const line = createStudyLine(PGN, 0, ['e2e4', bad, 'g1f3']);
    assert.equal(line.truncated, true); assert.equal(line.moves.length, 1); assert.equal(line.cursor, 0);
  }
  assert.throws(() => createStudyLine('[Result "*"]\n\n1. e4 *', 0), /Only completed/);
  for (const ply of [-1, 7, 1.5, '0']) assert.throws(() => createStudyLine(PGN, ply), /position from/);
  assert.throws(() => createStudyLine(PGN, 0, 'e2e4'), /list of moves/);
});

test('study supports custom Black starting positions and explicit underpromotion', () => {
  const fen = '7k/P7/8/8/8/8/8/7K w - - 0 27';
  const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n[Result "1-0"]\n\n27. a8=Q+ Kh7 1-0`;
  const line = createStudyLine(pgn, 0);
  assert.deepEqual(new Set(line.promotionChoices('a7', 'a8')), new Set(['q', 'r', 'b', 'n']));
  assert.throws(() => line.play('a7a8'), { code: 'PROMOTION_REQUIRED' });
  assert.equal(line.play('a7a8n').promotion, 'n');
  assert.equal(new Chess(line.fen).get('a8').type, 'n');
  const black = createStudyLine(pgn, 1, ['h8h7']);
  assert.equal(black.turn, 'b'); assert.equal(black.fen.split(' ')[5], '27');
});

test('retry accepts a sound alternative rather than requiring the exact engine move', async () => {
  const fixture = fakeEngine([score(30, 'g1f3'), score(15, 'b8c6')]);
  const result = await gradeRetry(PGN, 3, 'f1c4', { engineFactory: fixture.engineFactory, moveTimeMs: 50 });
  assert.equal(result.accepted, true); assert.equal(result.status, 'accepted');
  assert.equal(result.attemptSan, 'Bc4'); assert.equal(result.bestSan, 'Nf3');
  assert.match(result.feedback, /alternatives/);
  assert.deepEqual(fixture.calls[0].options.moves, ['e2e4', 'e7e5']);
  assert.deepEqual(fixture.calls[1].options.moves, ['e2e4', 'e7e5', 'f1c4']);
  assert.equal(fixture.calls[0].options.initialFen, new Chess().fen());
  assert.equal(fixture.calls[0].options.moveTimeMs, 500);
  assert.equal(fixture.engine.disposed, true);
});

test('retry normalizes evaluation loss for Black as well as White', async () => {
  const fixture = fakeEngine([score(-20, 'e7e5'), score(200, 'g1f3')]);
  const result = await gradeRetry(PGN, 2, 'd7d5', { engineFactory: fixture.engineFactory });
  assert.equal(result.color, 'b'); assert.equal(result.accepted, false);
  assert.equal(result.cpLoss, 220); assert.ok(result.probabilityLoss > .1);
  assert.deepEqual(fixture.calls[1].options.moves, ['e2e4', 'd7d5']);
});

test('retry refuses newly allowed mates and accepts preserving a forced win', async () => {
  const fail = fakeEngine([score(0, 'd2d4'), score(-99500, 'd8h4', ['d8h4'], -5)]);
  const rejected = await gradeRetry(MATE, 3, 'g2g4', { engineFactory: fail.engineFactory });
  assert.equal(rejected.accepted, false); assert.match(rejected.feedback, /forced mate/);
  const win = fakeEngine([score(99700, 'g1f3', [], 3), score(99100, 'b8c6', [], 9)]);
  assert.equal((await gradeRetry(PGN, 3, 'f1c4', { engineFactory: win.engineFactory })).accepted, true);
});

test('retry reports uncertainty when searches disagree on the engine recommended move', async () => {
  const fixture = fakeEngine([score(0, 'g1f3'), score(-200, 'b8c6')]);
  const result = await gradeRetry(PGN, 3, 'g1f3', { engineFactory: fixture.engineFactory });
  assert.equal(result.status, 'uncertain'); assert.equal(result.accepted, null); assert.match(result.feedback, /changed its assessment/);
});

test('checkmate attempts skip the terminal search and give a winning score', async () => {
  const fixture = fakeEngine([score(-99900, 'd8h4', ['d8h4'], -1)]);
  const result = await gradeRetry(MATE, 4, 'd8h4', { engineFactory: fixture.engineFactory });
  assert.equal(result.accepted, true); assert.equal(result.after.mate, 0); assert.equal(result.after.cp, -100000);
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.engine.disposed, true);
});

test('retry rejects illegal inputs before starting an engine and disposes failures/cancellations', async () => {
  const fixture = fakeEngine([]);
  await assert.rejects(gradeRetry(PGN, 2, 'a1a8', { engineFactory: fixture.engineFactory }), /not legal/);
  assert.equal(fixture.engine.initialized, false);
  await assert.rejects(gradeRetry('[Result "*"]\n\n1. e4 *', 1, 'e2e4'), /Only completed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(gradeRetry(PGN, 1, 'e2e4', { signal: controller.signal }), { name: 'AbortError' });
  const failing = fakeEngine([new Error('search failed')]);
  await assert.rejects(gradeRetry(PGN, 1, 'd2d4', { engineFactory: failing.engineFactory }), /search failed/);
  assert.equal(failing.engine.disposed, true);
  const cancel = new AbortController();
  const active = fakeEngine([score(0, 'e2e4')]);
  active.engine.evaluate = async () => { cancel.abort(); return score(0, 'e2e4'); };
  await assert.rejects(gradeRetry(PGN, 1, 'd2d4', { engineFactory: active.engineFactory, signal: cancel.signal }), { name: 'AbortError' });
  assert.equal(active.engine.disposed, true);
});

function moveFrom(fen, san) { return new Chess(fen).move(san); }

test('tactical explanation verifies a king/rook fork and its later capture', () => {
  const move = moveFrom('4k3/8/8/8/1n6/8/P7/R3K3 w Q - 0 1', 'a3');
  const why = explainConsequence(move, score(-500, 'b4c2', ['b4c2', 'e1d1', 'c2a1']));
  assert.equal(why.type, 'fork'); assert.match(why.text, /In this line/); assert.match(why.text, /king on e1 and rook on a1/);
  assert.deepEqual(why.line, ['b4c2', 'e1d1', 'c2a1']); assert.equal(why.highlights.length, 3);
});

test('a geometric double attack alone is not labelled a winning fork', () => {
  const move = moveFrom('4k3/8/8/8/1n6/8/P7/R3K3 w Q - 0 1', 'a3');
  const why = explainConsequence(move, score(-500, 'b4c2', ['b4c2', 'e1d1']));
  assert.notEqual(why.type, 'fork'); assert.notEqual(why.type, 'material');
});

test('material explanations require a lasting net loss, not an immediately recaptured piece', () => {
  const move = moveFrom('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', 'e4');
  const why = explainConsequence(move, score(-100, 'd4e3', ['d4e3']));
  assert.equal(why.type, 'material'); assert.equal(why.materialLoss, 1); assert.match(why.text, /pawn on e4/);
  const trade = moveFrom('4k3/8/8/2p5/3p4/4P3/8/4K3 w - - 0 1', 'Kd2');
  const even = explainConsequence(trade, score(0, 'd4e3', ['d4e3', 'd2e3']));
  assert.notEqual(even.type, 'material');
});

test('mate explanations distinguish legal checkmate from an engine mate forecast', () => {
  const chess = new Chess(); chess.move('f3'); chess.move('e5'); const move = chess.move('g4');
  const mate = explainConsequence(move, score(-99900, 'd8h4', ['d8h4'], -1));
  assert.equal(mate.type, 'mate'); assert.match(mate.text, /In this line.*Qh4#.*checkmate/);
  const forecast = explainConsequence(move, score(-99500, 'b8c6', ['b8c6'], -5));
  assert.match(forecast.text, /engine reports.*Black.*5 moves.*search depth/);
  const illegal = explainConsequence(move, score(-300, 'a1a8', ['a1a8', 'd8h4']));
  assert.equal(illegal.type, 'unavailable'); assert.equal(illegal.line.length, 0); assert.equal(illegal.truncated, true);
});

test('invalid review metadata cannot invent a tactical explanation', () => {
  assert.equal(explainConsequence(null).type, 'unavailable');
  const move = new Chess().move('e4');
  assert.equal(explainConsequence({ ...move, after: new Chess().fen() }, score(100)).type, 'unavailable');
});

test('study retains original repetition history and stops supplied/user lines at a draw', () => {
  const repeated = '[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';
  const terminal = createStudyLine(repeated, 8, ['e2e4']);
  assert.equal(terminal.terminal, true); assert.equal(terminal.terminalReason, 'Threefold repetition');
  assert.equal(terminal.truncated, true); assert.deepEqual(terminal.legalMoves(), []);
  assert.throws(() => terminal.play('e2e4'), /finished.*Threefold/);
  const line = createStudyLine(repeated, 6, ['f3g1', 'f6g8', 'e2e4']);
  assert.equal(line.moves.length, 2); assert.equal(line.truncated, true);
  assert.equal(line.terminal, false);
  line.goTo(2); assert.equal(line.terminal, true);
  line.back(); assert.equal(line.terminal, false); assert.ok(line.legalMoves().length > 0);
  line.forward(); assert.equal(line.terminalReason, 'Threefold repetition');
  line.reset(); assert.equal(line.terminal, false); assert.equal(line.cursor, 0);
});

test('study stops on checkmate and retains the halfmove clock for fifty-move draws', () => {
  const mate = createStudyLine(MATE, 3, ['d8h4', 'e1e2']);
  assert.equal(mate.moves.length, 1); assert.equal(mate.truncated, true);
  mate.forward(); assert.equal(mate.terminalReason, 'Checkmate'); assert.deepEqual(mate.legalMoves(), []);
  const fen = '7k/8/8/8/8/8/R7/7K w - - 99 50';
  const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n[Result "1/2-1/2"]\n\n50. Ra3 1/2-1/2`;
  const line = createStudyLine(pgn, 0, ['a2a3', 'h8g8']);
  assert.equal(line.moves.length, 1); line.forward(); assert.equal(line.terminalReason, 'Fifty-move rule');
});

test('retry recognizes a repetition completed by the attempt without searching past the draw', async () => {
  const repeated = '[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';
  const fixture = fakeEngine([score(0, 'f6g8')]);
  const result = await gradeRetry(repeated, 8, 'f6g8', { engineFactory: fixture.engineFactory });
  assert.equal(result.accepted, true); assert.equal(result.after.cp, 0); assert.equal(result.after.bestMove, null);
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].options.moves.length, 7);
});
