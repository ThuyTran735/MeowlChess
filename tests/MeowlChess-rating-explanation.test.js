import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { parseGame, classifyMove } from '../extension/lib/review.js';
import { recognizeOpening } from '../extension/lib/openings.js';
import { explainMoveRating } from '../extension/lib/rating-explanation.js';

const uci = move => move.from + move.to + (move.promotion || '');
const score = (cp = 0, bestMove = null, pv = bestMove ? [bestMove] : []) => ({ cp, bestMove, pv, mate: null, depth: 16, candidates: [] });
function fixture(sans = ['e4', 'e5', 'Nf3'], fen) {
  const chess = fen ? new Chess(fen) : new Chess();
  for (const san of sans) chess.move(san);
  chess.setHeader('Result', '1-0');
  const pgn = chess.pgn(), game = parseGame(pgn);
  const positions = game.positions.map(fen => score(0, new Chess(fen).moves({ verbose: true }).map(uci)[0] || null));
  const result = { game, positions, moves: game.moves.map((move, index) => ({ ...move, ply: index + 1, label: 'Excellent', probabilityLoss: 0 })) };
  return { result, game: { pgn }, ply: sans.length };
}
function grade(input, before, after, label) {
  const index = input.ply - 1, move = input.result.moves[index];
  input.result.positions[index] = before;
  input.result.positions[index + 1] = after;
  Object.assign(move, classifyMove(before, after, move.color, before.bestMove === uci(move), {
    move, previousMove: input.result.moves[index - 1], previousEvaluation: input.result.positions[index - 1],
  }), { evalAfter: after });
  if (label) move.label = label;
  return input;
}
const allText = output => [output.reason, ...output.facts.map(fact => fact.text)].join(' ');
const giftFen = 'r1bq1rk1/pppnbppp/4p3/3p4/3P4/3BPN2/PPP2PPP/RNBQK2R w KQ - 0 1';

test('ordinary grades explain saved chance-loss bands for either player without mutating evidence', () => {
  for (const color of ['w', 'b']) {
    for (const [cp, label, band] of [[5, 'Excellent', /less than 1/i], [30, 'Good', /at least 1 but less than 4/i], [65, 'Inaccuracy', /at least 4 but less than 8/i], [150, 'Mistake', /at least 8 but less than 20/i], [300, 'Blunder', /at least 20/i]]) {
      const input = fixture(color === 'w' ? ['e4'] : ['e4', 'e5']);
      const before = score(0, color === 'w' ? 'd2d4' : 'd7d5');
      const after = score(color === 'w' ? -cp : cp);
      grade(input, before, after);
      const snapshot = structuredClone(input), output = explainMoveRating(input);
      assert.equal(output.label, label); assert.equal(output.evidence, 'verified');
      assert.match(output.definition, band); assert.match(output.reason, /percentage points/);
      assert.match(output.reason, /putting it in this review's/);
      assert.doesNotMatch(output.reason, /at least|less than/);
      assert.match(output.note, /expected-score model, not a measured win probability/);
      assert.deepEqual(structuredClone(input), snapshot);
    }
  }
});

test('Best explains first-choice precedence even when adjacent searches drift', () => {
  const input = fixture(['e4']);
  grade(input, score(0, 'e2e4'), score(-60, 'e7e5'));
  const output = explainMoveRating(input);
  assert.equal(output.label, 'Best'); assert.equal(output.evidence, 'verified');
  assert.match(output.reason, /first choice/); assert.match(output.reason, /before-and-after searches differ/);
  assert.equal(output.line.moves[0].san, 'e5');
});

test('rounding near a threshold never appears to put a loss into a different grade', () => {
  for (const [loss, label, threshold] of [[.00999, 'Excellent', 1], [.03999, 'Good', 4], [.07999, 'Inaccuracy', 8], [.19999, 'Mistake', 20]]) {
    const input = fixture(['e4']);
    grade(input, score(0, 'd2d4'), score(Math.log((.5 - loss) / (.5 + loss)) / .00368208));
    const output = explainMoveRating(input);
    assert.equal(output.label, label); assert.equal(output.evidence, 'verified');
    assert.match(output.reason, new RegExp(`just under ${threshold} percentage points`));
  }
});

test('Brilliant identifies the actual offered piece, capture and net investment', () => {
  const input = fixture(['Bxh7+'], giftFen);
  grade(input, score(80, 'd3h7'), score(80, 'g8h7', ['g8h7', 'f3g5']));
  const output = explainMoveRating(input);
  assert.equal(output.label, 'Brilliant'); assert.equal(output.evidence, 'verified');
  assert.match(output.reason, /bishop on h7/); assert.match(output.reason, /Kxh7.*2 pawns/);
  assert.deepEqual(output.reasonNotation.map(item => [item.san, item.color]), [['Bxh7+', 'w'], ['Kxh7', 'b']]);
});

test('Brilliant can explain a declined offer without pretending it was accepted', () => {
  const input = fixture(['Bxh7+'], giftFen);
  grade(input, score(80, 'd3h7'), score(80, 'g8h8'));
  const output = explainMoveRating(input);
  assert.equal(output.evidence, 'verified'); assert.match(output.reason, /can accept/);
  assert.doesNotMatch(allText(output), /opponent accepts/);
  assert.equal(output.line.moves[0].san, 'Kh8');
});

test('Great explains the actual weaker second choice and saved comparison', () => {
  const input = fixture(), before = score(200, 'g1f3');
  before.candidates = [{ ...before, rank: 1 }, { ...score(-100, 'b1c3'), rank: 2 }];
  grade(input, before, score(200, 'b8c6'));
  const output = explainMoveRating(input);
  assert.equal(output.label, 'Great'); assert.equal(output.evidence, 'verified');
  assert.match(output.reason, /next engine choice, Nc3/); assert.match(allText(output), /point gap/);
  assert.equal(output.reasonNotation.find(item => item.san === 'Nc3').color, 'w');
});

test('Great tactical response does not invent a unique move when two choices are close', () => {
  const input = fixture(['Qf4', 'Bd6'], 'r2qkb1r/p1pb1pp1/1pn2n1p/6Q1/4p3/2P1P1P1/PP1P1PBP/RNB1K1NR w KQkq - 0 9');
  input.result.positions[0] = score(-200, 'g5b5');
  const before = score(-511, 'g7g5');
  before.candidates = [{ ...before, rank: 1 }, { ...score(-508, 'f8d6'), rank: 2 }];
  grade(input, before, score(-508, 'f4f6', ['f4f6', 'd8f6', 'g2e4', 'f6e7', 'e4g2', 'e8c8', 'd2d4', 'f7f5']));
  const output = explainMoveRating(input);
  assert.equal(output.label, 'Great'); assert.equal(output.evidence, 'verified');
  assert.match(output.reason, /preceding error.*near-best continuation/);
  assert.doesNotMatch(output.reason, /only|unique|critical choice/);
});

test('old or incomplete special grades acknowledge missing evidence instead of inventing a reason', () => {
  for (const label of ['Brilliant', 'Great']) {
    const input = fixture(); input.result.moves[2].label = label;
    const output = explainMoveRating(input);
    assert.equal(output.label, label); assert.equal(output.evidence, 'limited');
    assert.match(output.reason, /retained details are not enough/);
    assert.doesNotMatch(output.reason, /offers the|critical choice|gains material/);
  }
  const input = fixture(['Bxh7+'], giftFen);
  grade(input, score(80, 'd3h7'), score(80, 'g8h7'));
  input.result.positions[0].depth = 6;
  assert.equal(explainMoveRating(input).evidence, 'limited');
});

test('Book explains saved opening membership and score exclusion', () => {
  const input = fixture(); input.result.opening = recognizeOpening(input.result.game);
  grade(input, score(0, 'g1f3'), score(0, 'b8c6'), 'Book');
  Object.assign(input.result.moves[2], { isBook: true, opening: input.result.opening.byPly[2] });
  const output = explainMoveRating(input);
  assert.equal(output.evidence, 'verified'); assert.match(output.reason, /does not count toward the study score/);
  assert.match(allText(output), /Saved opening:/);
});

test('a legal saved fork is shown as evidence in the continuation, not as a guaranteed future', () => {
  const input = fixture(['a3'], '4k3/8/8/8/1n6/8/P7/R3K3 w Q - 0 1');
  grade(input, score(0, 'a2a4'), score(-500, 'b4c2', ['b4c2', 'e1d1', 'c2a1']));
  const output = explainMoveRating(input);
  assert.equal(output.label, 'Blunder'); assert.match(allText(output), /In this line, Nc2\+ forks.*king on e1 and rook on a1/);
  assert.match(output.consequence.text, /In this line, Nc2\+ forks.*king on e1 and rook on a1/);
  assert(output.facts.some(fact => fact.text === output.consequence.text), 'Concrete evidence remains available in the fact list.');
  assert.deepEqual(output.consequence.notation.map(item => [item.san, item.color]), [['Nc2+', 'b'], ['Nxa1', 'b']]);
  assert.deepEqual(output.line.moves.map(move => move.uci), ['b4c2', 'e1d1', 'c2a1']);
});

test('delivered checkmate has a concrete consequence even without an engine continuation', () => {
  const input = fixture(['f3', 'e5', 'g4', 'Qh4#']);
  grade(input, { ...score(-99900, 'd8h4'), mate: -1 }, { ...score(-100000), mate: 0 });
  const output = explainMoveRating(input);
  assert.equal(output.label, 'Best'); assert.equal(output.line, null);
  assert.equal(output.consequence.text, 'Black has delivered checkmate.');
});

test('illegal or mismatched engine lines never supply fabricated move or tactic evidence', () => {
  const input = fixture(); grade(input, score(0, 'd2d4'), score(-150, 'a1a8', ['a1a8', 'd8h4']));
  let output = explainMoveRating(input);
  assert.equal(output.line, null); assert.doesNotMatch(allText(output), /Ra8|Qh4/);
  assert.equal(output.consequence, undefined);
  input.result.positions[3] = score(-150, 'b8c6', ['g8f6']);
  output = explainMoveRating(input);
  assert.equal(output.line, null); assert.doesNotMatch(allText(output), /Nf6/);
});

test('history-aware continuations stop at repetition even when the FEN permits more moves', () => {
  const input = fixture(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
  input.result.game.headers.Result = '1/2-1/2';
  input.game.pgn = input.game.pgn.replaceAll('1-0', '1/2-1/2');
  input.ply = 6;
  grade(input, score(0, 'f6g8'), score(0, 'f3g1', ['f3g1', 'f6g8', 'e2e4']));
  let output = explainMoveRating(input);
  assert.deepEqual(output.line.moves.map(move => move.uci), ['f3g1', 'f6g8']);
  assert.equal(output.line.truncated, true); assert.match(allText(output), /threefold repetition/);
  assert.match(output.consequence.text, /threefold repetition/);
  input.ply = 8; input.result.positions[8] = { ...score(99900, 'e2e4'), mate: 1 };
  output = explainMoveRating(input);
  assert.equal(output.line, null); assert.match(allText(output), /drawn.*threefold repetition/);
  assert.doesNotMatch(allText(output), /forced mate/);
});

test('stale or invalid move identities cannot be explained', () => {
  for (const mutate of [
    input => { input.ply = 0; }, input => { input.ply = 1.5; }, input => { input.ply = 50; },
    input => { input.result.moves[2].san = 'Qh4#'; }, input => { input.result.moves[2].color = 'b'; },
    input => { input.result.moves[2].captured = 'q'; }, input => { input.result.moves[2].piece = 'q'; },
    input => { input.result.game.positions[2] = input.result.game.positions[0]; },
    input => { input.result.moves[1].after = input.result.moves[1].before; },
    input => { input.result.positions.pop(); }, input => { input.result.game.headers.Result = '*'; },
    input => { input.game.pgn = '[Result "1-0"]\n\n1. d4 d5 1-0'; },
  ]) { const input = fixture(); mutate(input); assert.equal(explainMoveRating(input), null); }
  assert.equal(explainMoveRating(), null);
});

test('contradictory or non-finite grade metrics are limited, never silently regraded', () => {
  for (const mutate of [
    input => { input.result.moves[2].probabilityLoss = .9; },
    input => { input.result.moves[2].probabilityLoss = NaN; },
    input => { input.result.positions[2].cp = NaN; },
    input => { input.result.positions[3].mate = 2; },
    input => { input.result.moves[2].label = 'Blunder'; },
  ]) {
    const input = fixture(); grade(input, score(0, 'd2d4'), score(-150)); mutate(input);
    const output = explainMoveRating(input);
    assert.equal(output.evidence, 'limited'); assert.equal(output.label, input.result.moves[2].label);
    assert.doesNotMatch(allText(output), /NaN/);
  }
});

test('custom Black starts keep true move numbers and notation colors without requiring source PGN', () => {
  const input = fixture(['Kh7'], '7k/8/8/8/8/8/6R1/7K b - - 0 42');
  grade(input, score(0, 'h8h7'), score(0, 'g2g3')); delete input.game;
  const output = explainMoveRating(input);
  assert.equal(output.title, '42... Kh7 — Best');
  assert.deepEqual(output.titleNotation.map(item => [item.san, item.color]), [['Kh7', 'b']]);
});
