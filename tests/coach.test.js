import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { parseGame } from '../extension/lib/review.js';
import { answerCoach, describeCoachMove, createCoachWalkthrough, COACHES } from '../extension/lib/coach.js';

const SHORT = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0';
const MATE = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const REPETITION = '[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';

function fixture(pgn = SHORT) {
  const parsed = parseGame(pgn);
  const positions = parsed.positions.map((fen, i) => {
    const board = new Chess(fen), next = parsed.moves[i];
    const bestMove = next ? next.from + next.to + (next.promotion || '') : null;
    return { cp: board.isCheckmate() ? board.turn() === 'w' ? -100000 : 100000 : 0, mate: board.isCheckmate() ? 0 : null, depth: 12, bestMove, pv: bestMove ? [bestMove] : [] };
  });
  const moves = parsed.moves.map((move, i) => ({ ...move, ply: i + 1, label: 'Best', probabilityLoss: 0, loss: 0, accuracy: 100, bestSan: move.san, evalAfter: positions[i + 1] }));
  const result = { game: parsed, positions, moves, summary: { w: { accuracy: 100 }, b: { accuracy: 100 } } };
  return { result, game: { pgn, white: { username: 'Alice' }, black: { username: 'Bob' } } };
}

function withError(input, ply, label = 'Blunder', probabilityLoss = 0.4) {
  Object.assign(input.result.moves[ply - 1], { label, probabilityLoss, loss: probabilityLoss * 1000 });
  return input;
}

test('coach profiles are distinct and only change presentation of the same facts', () => {
  assert.equal(COACHES.length, 5);
  assert.equal(new Set(COACHES.map(item => item.id)).size, 5);
  const input = withError(fixture(), 3);
  const answers = COACHES.map(coach => answerCoach({ ...input, question: 'Summarize this game', coach: coach.id }));
  assert.equal(new Set(answers.map(answer => answer.text)).size, 5);
  for (const answer of answers) {
    assert.match(answer.text, /White won/);
    assert.match(answer.text, /2\. Nf3/);
    assert.deepEqual(answer.moves, [{ ply: 3, label: '2. Nf3' }]);
  }
  assert.equal(answerCoach({ ...input, question: 'Summarize this game', coach: 'missing' }).text, answers[0].text);
});

test('unfinished, partial, illegal, and mismatched reviews cannot produce coaching', () => {
  for (const input of [{}, { result: {} }, { ...fixture(), result: null }]) {
    const answer = answerCoach({ ...input, question: 'Summarize this game' });
    assert.match(answer.text, /completed game first/);
    assert.deepEqual(answer.moves, []);
  }
  const cases = [
    value => { value.result.game.headers.Result = '*'; },
    value => { value.result.positions.pop(); },
    value => { value.result.moves[0].to = 'e8'; },
    value => { value.result.moves[0].probabilityLoss = NaN; },
    value => { value.result.positions[0].cp = NaN; },
    value => { value.game.pgn = MATE; },
    value => { value.result.moves[0].after = value.result.game.positions[0]; },
  ];
  for (const change of cases) {
    const value = fixture(); change(value);
    assert.match(answerCoach({ ...value, question: 'Why was this move bad?', ply: 1 }).text, /completed game first/);
  }
});

test('biggest mistakes use expected-score loss and selected side, without calling them the sole cause', () => {
  const input = withError(withError(fixture(), 3, 'Mistake', 0.15), 4, 'Blunder', 0.35);
  assert.equal(answerCoach({ ...input, question: 'What was the biggest mistake?' }).subjectPly, 4);
  const mine = answerCoach({ ...input, question: 'What was my biggest mistake?', perspective: 'w' });
  assert.equal(mine.subjectPly, 3);
  assert.match(mine.text, /15 percentage points/);
  assert.match(mine.text, /not proof that this move alone decided/);
  assert.equal(answerCoach({ ...input, question: "What was my opponent's biggest mistake?", perspective: 'w' }).subjectPly, 4);
  assert.equal(answerCoach({ ...input, question: "What was White's biggest mistake?", perspective: 'b' }).subjectPly, 3);
  const unknown = answerCoach({ ...input, question: 'What was my biggest mistake?' });
  assert.match(unknown.text, /Choose White or Black/);
  assert.deepEqual(unknown.moves, []);
});

test('clean play does not invent a mistake or training failure', () => {
  const input = fixture();
  assert.match(answerCoach({ ...input, question: 'What was the biggest mistake?' }).text, /Neither player has a move rated/);
  const training = answerCoach({ ...input, question: 'What should I practice?', perspective: 'w' });
  assert.match(training.text, /No moves were rated/);
  assert.deepEqual(training.moves, []);
});

test('explicit white and black move references select exact reviewed plies', () => {
  const input = fixture();
  for (const question of ['Why was 2...Nc6 good?', 'Why was move 2... Nc6 good?', 'Explain 2… Nc6', 'Explain 2...nc6']) {
    const answer = answerCoach({ ...input, question, ply: 1, perspective: 'w' });
    assert.equal(answer.subjectPly, 4, question);
    assert.match(answer.text, /2\.\.\. Nc6 is rated Best/);
  }
  assert.equal(answerCoach({ ...input, question: 'Explain 2. Nf3', ply: 1 }).subjectPly, 3);
  assert.equal(answerCoach({ ...input, question: 'Explain move 2', perspective: 'b' }).subjectPly, 4);
  assert.equal(answerCoach({ ...input, question: 'Explain Nf3' }).subjectPly, 3);
});

test('missing, wrong SAN, and ambiguous references ask for correction instead of falling back', () => {
  const input = fixture();
  for (const question of ['Explain 99...Nf6', 'Why was 2...Qh4 good?', 'Why was 2...qh4 good?', 'Why was move 0 good?']) {
    const answer = answerCoach({ ...input, question, ply: 1 });
    assert.match(answer.text, /could not find that move/);
    assert.equal(answer.subjectPly, undefined);
  }
  const ambiguous = answerCoach({ ...input, question: 'Explain move 2' });
  assert.match(ambiguous.text, /more than one position/);
  assert.deepEqual(ambiguous.moves.map(move => move.ply), [3, 4]);
  const repeated = answerCoach({ ...fixture(REPETITION), question: 'Explain Nf3' });
  assert.match(repeated.text, /more than one position/);
});

test('custom black-to-move starting positions use FEN move numbers rather than ply arithmetic', () => {
  const input = fixture('[SetUp "1"]\n[FEN "4k3/7p/8/8/8/8/P7/R3K3 b Q - 0 42"]\n[Result "1/2-1/2"]\n\n42... Kf7 43. a4 1/2-1/2');
  const answer = answerCoach({ ...input, question: 'Explain 42...Kf7' });
  assert.equal(answer.subjectPly, 1);
  assert.deepEqual(answer.moves, [{ ply: 1, label: '42... Kf7' }]);
  assert.match(answerCoach({ ...input, question: 'What opening is this?' }).text, /does not identify/);
  assert.match(answerCoach({ ...input, question: 'How was the endgame?' }).text, /Endgame: White Best across 1 move; Black Best across 1 move/);
});

test('current move and follow-up references remain explicit and bounded', () => {
  const input = fixture();
  assert.equal(answerCoach({ ...input, question: 'Why was this move good?', ply: 3 }).subjectPly, 3);
  assert.equal(answerCoach({ ...input, question: 'Why was that good?', ply: 4, previousPly: 3 }).subjectPly, 3);
  assert.equal(answerCoach({ ...input, question: 'Why was that good?', ply: 4, previousPly: 999 }).subjectPly, 4);
  assert.match(answerCoach({ ...input, question: 'Why was this move good?', ply: 0 }).text, /Select a move/);
  assert.match(answerCoach({ ...input, question: 'x'.repeat(601) }).text, /under 600/);
  assert.match(answerCoach({ ...input, question: '   ' }).text, /Ask about this game/);
});

test('better move uses the before-position engine line, with no stale bestSan or illegal PV', () => {
  const input = fixture();
  input.result.moves[2].bestSan = 'Qh9';
  input.result.positions[2] = { cp: 10, mate: null, depth: 12, bestMove: 'f1c4', pv: ['f1c4', 'b8c6', 'a1a8'] };
  const answer = answerCoach({ ...input, question: 'What was better than 2. Nf3?' });
  assert.match(answer.text, /engine preferred Bc4/);
  assert.match(answer.text, /2\. Bc4 Nc6/);
  assert.match(answer.text, /After the played move: /);
  assert.doesNotMatch(answer.text, /Qh9|a1a8/);
  assert.match(answer.text, /Only the legal part/);
  input.result.positions[2].bestMove = 'a1a8';
  assert.match(answerCoach({ ...input, question: 'What was better than 2. Nf3?' }).text, /No legal preferred move/);
});

test('consequences preserve threefold history rather than trusting FEN alone', () => {
  const input = fixture(REPETITION);
  input.result.positions.at(-1).pv = ['e2e4'];
  const answer = answerCoach({ ...input, question: 'Why was 4...Ng8 good?' });
  assert.match(answer.text, /This position is drawn by threefold repetition/);
  assert.doesNotMatch(answer.text, /engine continues with e4/);
  const ending = answerCoach({ ...input, question: 'How did this game end?' });
  assert.match(ending.text, /threefold repetition/);
  assert.match(answerCoach({ ...input, question: 'Why was this game a draw?' }).text, /threefold repetition/);
  assert.match(answerCoach({ ...input, question: 'What is the next move?', ply: 8 }).text, /no legal next-move suggestion/i);
});

test('terminal positions explain checkmate and do not offer a next move', () => {
  const input = fixture(MATE);
  assert.match(answerCoach({ ...input, question: 'Explain 2...Qh4#' }).text, /delivered checkmate/);
  assert.match(answerCoach({ ...input, question: 'How did the game finish?' }).text, /2\.\.\. Qh4# delivers checkmate/);
  assert.match(answerCoach({ ...input, question: 'Who is winning?', ply: 4 }).text, /position is checkmate/);
  assert.match(answerCoach({ ...input, question: 'What is the next move?', ply: 4 }).text, /no legal next-move suggestion/i);
});

test('game ending does not guess resignation or timeout from a decisive result alone', () => {
  const answer = answerCoach({ ...fixture(), question: 'What was the game result?' });
  assert.match(answer.text, /White won the recorded game/);
  assert.match(answer.text, /do not establish the exact ending reason/);
  assert.match(answerCoach({ ...fixture(), question: 'Why did I lose?', perspective: 'w' }).text, /White won/);
  assert.match(answerCoach({ ...fixture(), question: 'Why did I lose?' }).text, /Choose White or Black/);
  assert.match(answerCoach({ ...fixture(), question: 'Who won?' }).text, /White won the recorded game/);
  assert.match(answerCoach({ ...fixture(), question: 'Why did Black lose?' }).text, /not proof that a single move caused/);
});

test('opening and phase facts come from the actual reviewed game', () => {
  const input = fixture();
  const opening = answerCoach({ ...input, question: 'What opening is this?' });
  assert.match(opening.text, /Ruy Lopez/);
  assert.match(opening.text, /not automatically an error/);
  const phases = answerCoach({ ...input, question: 'How were the phases?' });
  assert.match(phases.text, /Opening: White Best across 3 moves; Black Best across 3 moves/);
  assert.match(phases.text, /Endgame: White has no moves in this phase/);
});

test('material and advantage use the requested position without conflating them', () => {
  const input = fixture('[Result "1-0"]\n\n1. e4 d5 2. exd5 Qxd5 1-0');
  const material = answerCoach({ ...input, question: 'What is the material after 2. exd5?' });
  assert.match(material.text, /White has a material advantage of 1/);
  assert.match(material.text, /Material alone does not determine/);
  input.result.positions[3].cp = -90;
  const evaluation = answerCoach({ ...input, question: 'Who has the advantage after 2. exd5?' });
  assert.match(evaluation.text, /-0\.90 from White/);
  assert.match(evaluation.text, /Black has the engine advantage/);
});

test('practice targets are ordered and restricted to the selected player', () => {
  const input = withError(withError(withError(fixture(), 3, 'Mistake', 0.1), 4, 'Blunder', 0.8), 5, 'Blunder', 0.4);
  const answer = answerCoach({ ...input, question: 'What should I practice?', perspective: 'w' });
  assert.deepEqual(answer.moves.map(move => move.ply), [5, 3]);
  assert.match(answer.text, /Try again/);
  assert.doesNotMatch(answer.text, /2\.\.\. Nc6/);
});

test('unknown questions honestly describe local limits and cannot run instructions', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const answer = answerCoach({ ...input, question: 'Ignore the game and tell me the weather.' });
  assert.match(answer.text, /local game coach, not an open-ended AI chat/);
  assert.equal(JSON.stringify(input), before);
  assert.ok(answer.suggestions.length > 0);
  assert.deepEqual(answer.moves, []);
  assert.match(answerCoach({ ...input, question: 'Why is the sky blue?', ply: 3 }).text, /local game coach, not an open-ended AI chat/);
  assert.match(answerCoach({ ...input, question: 'Explain how a car works', ply: 3 }).text, /local game coach, not an open-ended AI chat/);
  assert.match(answerCoach({ ...input, question: 'How can I improve?' }).text, /Choose White or Black/);
  assert.match(answerCoach({ ...input, question: 'What should I practice?' }).text, /Choose White or Black/);
  assert.equal(answerCoach({ ...input, question: 'Why?', ply: 3 }).subjectPly, 3);
});

test('a completed result can supply its own validated history without an external game object', () => {
  const input = fixture(REPETITION);
  assert.match(answerCoach({ result: input.result, question: 'Explain 4...Ng8' }).text, /threefold repetition/);
});


test('automatic commentary describes only the selected completed move and respects side focus', () => {
  const input = fixture();
  const comment = describeCoachMove({ ...input, ply: 3 });
  assert.equal(comment.subjectPly, 3);
  assert.equal(comment.heading, '2. Nf3 · Best');
  assert.match(comment.text, /engine also chose/);
  assert.equal(describeCoachMove({ ...input, ply: 3, perspective: 'b' }), null);
  assert.equal(describeCoachMove({ ...input, ply: 0 }), null);
  assert.equal(describeCoachMove({ ...input, ply: 999 }), null);
  assert.equal(describeCoachMove({ ...input, ply: 2.5 }), null);
  for (const coach of COACHES) {
    assert.equal(describeCoachMove({ ...input, ply: 4, coach: coach.id }).subjectPly, 4);
  }
});

test('automatic commentary rejects unfinished, mismatched and incomplete reviews', () => {
  for (const change of [
    value => { value.result.game.headers.Result = '*'; },
    value => { value.result.positions.pop(); },
    value => { value.game.pgn = MATE; },
    value => { value.result.moves[1].to = 'e8'; },
  ]) {
    const input = fixture(); change(input);
    assert.equal(describeCoachMove({ ...input, ply: 1 }), null);
  }
});

test('automatic commentary keeps engine alternatives legal and does not invent missing evidence', () => {
  const input = withError(fixture(), 3);
  input.result.positions[2].bestMove = 'f1c4'; input.result.positions[2].pv = ['f1c4'];
  const comment = describeCoachMove({ ...input, ply: 3 });
  assert.match(comment.text, /preferred Bc4/);
  input.result.positions[2].bestMove = 'f1f8'; input.result.positions[2].pv = ['f1f8'];
  assert.doesNotMatch(describeCoachMove({ ...input, ply: 3 }).text, /preferred/);
  input.result.moves[2].label = 'Best';
  assert.doesNotMatch(describeCoachMove({ ...input, ply: 3 }).text, /also chose/);
});

test('automatic commentary uses verified checkmate and local Book facts', () => {
  const input = fixture(MATE);
  assert.match(describeCoachMove({ ...input, ply: 4 }).text, /checkmate/i);
  input.result.moves[0].label = 'Book';
  const book = describeCoachMove({ ...input, ply: 1 });
  assert.match(book.text, /opening/);
  assert.match(book.text, /excluded from the study score/);
});


test('prepared walkthrough matches defensive comments through forward/backward history and side changes', () => {
  const input = withError(fixture(), 3), prepared = createCoachWalkthrough(input);
  for (const ply of [1, 2, 6, 3, 4, 1, 5, 6, 2]) {
    for (const coach of COACHES) {
      const options = { ply, coach: coach.id };
      assert.deepEqual(prepared.describe(options), describeCoachMove({ ...input, ...options }));
    }
  }
  assert.equal(prepared.describe({ ply: 2, perspective: 'w' }), null);
});

test('prepared walkthrough owns a validated private snapshot and rejects initially bad review data', () => {
  const input = fixture(), prepared = createCoachWalkthrough(input);
  const expected = prepared.describe({ ply: 1 });
  input.result.game.headers.Result = '*'; input.result.moves[0].san = 'forged'; input.game.pgn = MATE;
  assert.deepEqual(prepared.describe({ ply: 1 }), expected);
  assert.equal(createCoachWalkthrough(input).describe({ ply: 1 }), null);
  assert.equal(createCoachWalkthrough({}).describe({ ply: 1 }), null);
  for (const ply of [-1, 999, 2.5, null]) assert.equal(prepared.describe({ ply }), null);
});

test('prepared walkthrough preserves repetition and terminal game history in engine continuations', () => {
  const input = fixture(REPETITION);
  input.result.moves[7].label = 'Mistake';
  input.result.positions[8].pv = ['e2e4'];
  const prepared = createCoachWalkthrough(input);
  for (const ply of [8, 2, 8]) {
    assert.deepEqual(prepared.describe({ ply }), describeCoachMove({ ...input, ply }));
  }
  assert.match(prepared.describe({ ply: 8 }).text, /threefold repetition/i);
});


const ALL_LABELS = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder'];
function ratingFixture() {
  const input = fixture('[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 1/2-1/2');
  input.result.moves.forEach((move, index) => {
    move.label = ALL_LABELS[Math.floor(index / 2)];
    move.probabilityLoss = ['Inaccuracy', 'Mistake', 'Blunder'].includes(move.label) ? 0.2 : 0;
  });
  return input;
}

test('category queries find actual saved grades instead of the current Best move', () => {
  const input = ratingFixture();
  for (const [index, label] of ALL_LABELS.entries()) {
    const plural = label === 'Inaccuracy' ? 'inaccuracies' : label.toLowerCase() + 's';
    for (const question of [`Show moves rated ${label}`, `Count ${label} moves`, plural.toUpperCase()]) {
      const answer = answerCoach({ ...input, question, ply: 5 });
      assert.equal(answer.matchCount, 2, question);
      assert.equal(answer.counts[label], 2, question);
      assert.equal(answer.label, label, question);
      assert.equal(answer.subjectPly, index * 2 + 1, question);
      assert.deepEqual(answer.moves.map(move => move.ply), [index * 2 + 1, index * 2 + 2], question);
    }
  }
  for (const question of ['show brilliant moves', 'list the greats', 'where were the excellents?', 'find book moves', 'did I have any greats?']) {
    const answer = answerCoach({ ...input, question, perspective: 'w', ply: 5 });
    assert.equal(answer.matchCount, 1, question);
    assert.notEqual(answer.subjectPly, 5, question);
  }
});

test('category totals, multiple labels and empty counts follow the requested side', () => {
  const input = ratingFixture();
  const every = answerCoach({ ...input, question: 'How many of each?', perspective: 'w', ply: 5 });
  assert.equal(every.matchCount, 9);
  assert.deepEqual(every.counts, Object.fromEntries(ALL_LABELS.map(label => [label, 1])));
  const mixed = answerCoach({ ...input, question: 'Show greats and brilliants', perspective: 'b' });
  assert.deepEqual(mixed.counts, { Brilliant: 1, Great: 1 });
  assert.deepEqual(mixed.moves.map(move => move.ply), [2, 4]);
  const opponent = answerCoach({ ...input, question: "Show my opponent's brilliants", perspective: 'w' });
  assert.deepEqual(opponent.moves.map(move => move.ply), [2]);
  const named = answerCoach({ ...input, question: "How many Great moves did Black have?", perspective: 'w' });
  assert.deepEqual(named.moves.map(move => move.ply), [4]);
  assert.match(answerCoach({ ...input, question: 'Did I have any greats?' }).text, /Choose White or Black/);
  const empty = answerCoach({ ...fixture(), question: 'Show brilliants', ply: 3 });
  assert.equal(empty.matchCount, 0);
  assert.deepEqual(empty.counts, { Brilliant: 0 });
  assert.equal(empty.subjectPly, undefined); assert.equal(empty.label, undefined);
  assert.deepEqual(empty.moves, []); assert.match(empty.text, /0 moves rated Brilliant/);
});

test('category navigation selects first, last, next and previous actual matches', () => {
  const input = ratingFixture();
  assert.equal(answerCoach({ ...input, question: 'Show first great', ply: 5 }).subjectPly, 3);
  assert.equal(answerCoach({ ...input, question: 'Show last great', ply: 1 }).subjectPly, 4);
  assert.equal(answerCoach({ ...input, question: 'Next brilliant', ply: 1 }).subjectPly, 2);
  assert.equal(answerCoach({ ...input, question: 'Previous brilliant', ply: 2 }).subjectPly, 1);
  const absent = answerCoach({ ...input, question: 'Next brilliant', ply: 5 });
  assert.equal(absent.subjectPly, undefined); assert.deepEqual(absent.moves, []);
  assert.match(absent.text, /no later matching move/);
});

test('generic highlights prioritize Brilliant and Great while rated Best remains exact', () => {
  const input = ratingFixture();
  for (const question of ['Show highlights', 'What was my best move?', 'Show best moves']) {
    const answer = answerCoach({ ...input, question, perspective: 'w', ply: 5 });
    assert.equal(answer.subjectPly, 1, question); assert.equal(answer.label, 'Brilliant', question);
  }
  const best = answerCoach({ ...input, question: 'Show moves rated Best', perspective: 'w' });
  assert.equal(best.subjectPly, 5); assert.equal(best.label, 'Best'); assert.equal(best.matchCount, 1);
  const summary = answerCoach({ ...input, question: 'Summarize this game' });
  assert.match(summary.text, /Brilliant/); assert.match(summary.text, /Great/);
  assert(summary.moves.some(move => move.ply === 1));
});

test('label definitions and specific move questions do not turn into category searches', () => {
  const input = ratingFixture();
  for (const question of ['What is a brilliant move?', 'What are greats?', 'What does Best mean?', 'Explain the Good rating', 'Difference between Brilliant and Great']) {
    const answer = answerCoach({ ...input, question, ply: 5 });
    assert.match(answer.text, /MeowlChess’s review labels/, question);
    assert.equal(answer.subjectPly, undefined, question);
  }
  for (const question of ['Why was this move brilliant?', 'Why was 3. Bb5 not Great?', 'Was this a great move?']) {
    const answer = answerCoach({ ...input, question, ply: 5 });
    assert.equal(answer.subjectPly, 5, question); assert.equal(answer.label, 'Best', question);
    assert.match(answer.text, /rated Best/, question);
    assert.equal(answer.matchCount, undefined, question);
  }
  const followup = answerCoach({ ...input, question: 'Why was that great?', ply: 5, previousPly: 3 });
  assert.equal(followup.subjectPly, 3); assert.equal(followup.label, 'Great');
  const invalid = ratingFixture(); invalid.result.game.headers.Result = '*';
  assert.match(answerCoach({ ...invalid, question: 'Show brilliants' }).text, /completed game first/);
});

test('all five Meowl personalities provide valid chat and walkthrough wording for every grade', () => {
  assert.deepEqual(COACHES.map(coach => coach.id), ['meowl', 'owl', 'paws', 'mellow', 'scout']);
  assert.equal(COACHES.find(coach => coach.id === 'owl').name, 'Professor Meowl');
  const input = ratingFixture();
  for (const coach of COACHES) {
    for (const question of ['Summarize this game', 'What should I practice?', 'What was my biggest mistake?', 'Why was this move rated this way?', 'Show brilliants']) {
      const answer = answerCoach({ ...input, question, coach: coach.id, perspective: 'w', ply: 5 });
      assert.equal(typeof answer.text, 'string'); assert(answer.text.length > 30);
      assert.doesNotMatch(answer.text, /undefined|null/);
    }
    for (let index = 0; index < ALL_LABELS.length; index++) {
      const comment = describeCoachMove({ ...input, coach: coach.id, ply: index * 2 + 1 });
      assert.equal(comment.label, ALL_LABELS[index]); assert(comment.text.length > 10);
      assert.doesNotMatch(comment.text, /undefined|null/);
    }
  }
});
