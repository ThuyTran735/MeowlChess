import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { parseGame } from '../extension/lib/review.js';
import { COACHES, answerCoach, describeCoachMove, createCoachWalkthrough } from '../extension/lib/coach.js';

const GAME = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O Nf6 6. d4 exd4 7. Nxd4 Bd6 1-0';
const CHECK_GAME = '[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bb5 Nf6 4. Bxc6 dxc6 5. Qxe5+ Be7 6. Nf3 O-O 1-0';
const PROMOTION = '[SetUp "1"]\n[FEN "8/P7/7k/7p/8/8/8/7K w - - 0 1"]\n[Result "1-0"]\n\n1. a8=Q Kg5 2. Qd5+ Kh6 1-0';
const MATE = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const LABELS = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder'];

function fixture(pgn = GAME) {
  const game = parseGame(pgn);
  const uci = move => move.from + move.to + (move.promotion || '');
  const positions = game.positions.map((fen, i) => {
    const board = new Chess(fen), next = game.moves[i];
    return {
      cp: board.isCheckmate() ? board.turn() === 'w' ? -100000 : 100000 : 0,
      mate: board.isCheckmate() ? 0 : null, depth: 14,
      bestMove: next ? uci(next) : null, pv: game.moves.slice(i, i + 3).map(uci),
    };
  });
  const moves = game.moves.map((move, i) => ({ ...move, ply: i + 1, label: 'Best', probabilityLoss: 0, loss: 0, accuracy: 100, evalAfter: positions[i + 1] }));
  return { result: { game, positions, moves, summary: { w: { accuracy: 81.2 }, b: { accuracy: 72.4 } } }, game: { pgn } };
}

const metadata = ({ text, notation, ...answer }) => ({ ...answer, notation: notation.map(({ san, color }) => ({ san, color })) });

test('coach voices preserve the exact reviewed facts, legal line and linked position', () => {
  const input = fixture();
  Object.assign(input.result.moves[2], { label: 'Mistake', probabilityLoss: .15, loss: 150 });
  input.result.positions[2] = { cp: 10, mate: null, depth: 14, bestMove: 'f1c4', pv: ['f1c4', 'b8c6', 'a1a8'] };
  const before = JSON.stringify(input);
  const answers = COACHES.map(({ id }) => answerCoach({ ...input, question: 'Why was 2. Nf3 a mistake?', coach: id }));
  for (const answer of answers) {
    assert.deepEqual(metadata(answer), metadata(answers[0]));
    assert.match(answer.text, /2\. Nf3 is rated Mistake/);
    assert.match(answer.text, /15 percentage points/);
    assert.match(answer.text, /engine preferred Bc4/);
    assert.match(answer.text, /2\. Bc4 Nc6/);
    assert.match(answer.text, /Only the legal part of the line is shown/);
    assert.doesNotMatch(answer.text, /a1a8|Rxa8|winning tactic|forced win/);
  }
  assert.equal(new Set(answers.map(answer => answer.text.split('\n\n').at(-1))).size, COACHES.length, 'The study method differs beyond an opening catchphrase.');
  assert.equal(JSON.stringify(input), before);
});

test('five successive turns with the same grade have stable, varied coaching for every personality', () => {
  for (const label of LABELS) {
    const input = fixture();
    for (const move of input.result.moves) move.label = label;
    const prepared = createCoachWalkthrough(input);
    for (const { id } of COACHES) {
      const comments = [1, 3, 5, 7, 9].map(ply => describeCoachMove({ ...input, coach: id, ply }));
      assert.equal(new Set(comments.map(comment => comment.text.split(/[.!?] /)[0])).size, 5, `${id}/${label} has five leads`);
      for (const comment of comments) {
        assert.deepEqual(comment, prepared.describe({ coach: id, ply: comment.subjectPly }));
        assert.equal(comment.label, label);
        assert.doesNotMatch(comment.text, /you (?:played|found|made|missed|lost|won)|your (?:move|mistake|blunder)/i);
      }
    }
  }
});

test('walkthrough teaching prompts follow actual captures, castling, checks and promotions', () => {
  const examples = [
    { input: fixture(), ply: 7, expected: /capture|recapture|piece (?:was taken|left the board)/i },
    { input: fixture(), ply: 9, expected: /king|castl/i },
    { input: fixture(CHECK_GAME), ply: 9, expected: /check|legal repl/i },
    { input: fixture(PROMOTION), ply: 1, expected: /promot|new (?:piece|job)/i },
  ];
  for (const { input, ply, expected } of examples) {
    const comments = COACHES.map(({ id }) => describeCoachMove({ ...input, ply, coach: id }));
    assert(comments.every(Boolean));
    for (const comment of comments) assert.match(comment.text, expected);
    assert.equal(new Set(comments.map(comment => comment.text)).size, COACHES.length);
  }
});

test('missing or short continuations do not turn personality into invented evidence', () => {
  const input = fixture();
  input.result.positions[2].bestMove = 'a1a8'; input.result.positions[2].pv = ['a1a8'];
  for (const { id } of COACHES) {
    const comment = describeCoachMove({ ...input, ply: 3, coach: id });
    assert.doesNotMatch(comment.text, /a1a8|Rxa8|engine also chose/);
    assert.match(comment.text, /deeper|legal continuation/i);
  }
  input.result.positions[2].bestMove = 'g1f3'; input.result.positions[2].pv = ['g1f3'];
  for (const { id } of COACHES) {
    const comment = describeCoachMove({ ...input, ply: 3, coach: id });
    assert.match(comment.text, /one (?:recorded candidate|move)|One-move|brief|one candidate/);
    assert.match(comment.text, /legal reply/);
  }
});

test('finished positions and opponent mistakes retain neutral ownership and safe study tasks', () => {
  for (const { id } of COACHES) {
    const mate = fixture(MATE);
    const comment = describeCoachMove({ ...mate, ply: 4, coach: id });
    assert.match(comment.text, /checkmate/i);
    assert.match(comment.text, /last|end|final|preceding/i);
    const position = answerCoach({ ...mate, question: 'Explain this position', ply: 4, coach: id });
    assert.doesNotMatch(position.text, /choose a move|pick a candidate|find the legal replies|to move/i);
    const input = fixture();
    Object.assign(input.result.moves[3], { label: 'Blunder', probabilityLoss: .35, loss: 350 });
    const answer = answerCoach({ ...input, question: "What was my opponent's biggest mistake?", perspective: 'w', coach: id });
    assert.equal(answer.subjectPly, 4);
    assert.doesNotMatch(answer.text, /you (?:played|found|made|missed|lost|won)|your (?:move|mistake|blunder)/i);
  }
});

test('personality carries through material, opening and phase discussion without changing metadata', () => {
  const input = fixture();
  for (const question of ['What is the material?', 'What opening is this?', 'How were the phases?']) {
    const answers = COACHES.map(({ id }) => answerCoach({ ...input, question, ply: 7, coach: id }));
    for (const answer of answers) assert.deepEqual(metadata(answer), metadata(answers[0]));
    assert.equal(new Set(answers.map(answer => answer.text.split('\n\n').at(-1))).size, COACHES.length, question);
  }
});
