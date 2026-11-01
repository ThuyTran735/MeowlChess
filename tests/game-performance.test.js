import test from 'node:test';
import assert from 'node:assert/strict';
import { getPhasePerformance } from '../extension/lib/game-performance.js';
import { Chess } from '../extension/vendor/chess.js';

const START = new Chess().fen();
const END = '4k3/7p/8/8/8/8/P7/R3K3 w Q - 0 21';
const MIDDLE = 'r3k2r/pp3ppp/8/8/8/8/PP3PPP/R3K2R w KQkq - 0 21';
const PROMOTED = 'Q3k2r/7p/8/8/8/8/P7/R3K2R b KQ - 0 22';
const move = (before = START, color = 'w', label = 'Best', probabilityLoss = 0) => ({ before, color, label, probabilityLoss });
const result = (moves, initial = moves[0]?.before) => ({ game: { positions: initial ? [initial] : [] }, moves });
const phase = (input, name) => getPhasePerformance(input).find(item => item.id === name);

test('empty or missing review returns three unplayed phases without a fabricated grade', () => {
  for (const input of [null, {}, result([])]) {
    const phases = getPhasePerformance(input);
    assert.deepEqual(phases.map(item => item.id), ['opening', 'middlegame', 'endgame']);
    for (const item of phases) {
      assert.equal(item.firstPly, null);
      assert.deepEqual(item.w, { label: null, total: 0, scoredTotal: 0, meanLoss: null });
      assert.deepEqual(item.b, item.w);
    }
  }
});

test('normal opening lasts 20 plies, then moves become middlegame without inventing an endgame', () => {
  const game = new Chess();
  game.loadPgn('[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 1/2-1/2');
  const moves = game.history({ verbose: true }).map(item => ({ ...item, label: 'Best', probabilityLoss: 0 }));
  const [opening, middle, ending] = getPhasePerformance(result(moves));
  assert.deepEqual([opening.firstPly, opening.lastPly, opening.w.total, opening.b.total], [1, 20, 10, 10]);
  assert.deepEqual([middle.firstPly, middle.lastPly, middle.w.total, middle.b.total], [21, 22, 1, 1]);
  assert.equal(ending.w.label, null);
  assert.equal(ending.b.label, null);
});

test('material threshold wins over opening length and endgame does not revert after promotion', () => {
  const input = result([move(START), move(END, 'b'), move(PROMOTED)], START);
  const [opening, middle, ending] = getPhasePerformance(input);
  assert.equal(opening.w.total, 1);
  assert.equal(middle.firstPly, null);
  assert.deepEqual([ending.firstPly, ending.lastPly, ending.w.total, ending.b.total], [2, 3, 1, 1]);
});

test('custom starts use material, including FEN move numbers other than one', () => {
  const middle = getPhasePerformance(result([move(MIDDLE)]));
  assert.equal(middle[0].w.total, 0);
  assert.equal(middle[1].w.label, 'Best');
  const ending = getPhasePerformance(result([move(END)]));
  assert.equal(ending[0].w.total, 0);
  assert.equal(ending[2].w.label, 'Best');
  const restoredArmy = START.replace(' 0 1', ' 0 42');
  assert.equal(phase(result([move(restoredArmy)]), 'middlegame').w.total, 1);
});

test('queen and rook weights use the same threshold and the capture belongs to its before-position phase', () => {
  const atSix = '4k2r/7p/8/8/8/8/P7/Q3K3 w - - 0 20';
  const atSeven = '2b1k2r/7p/8/8/8/8/P7/Q3K3 w - - 0 20';
  const phases = getPhasePerformance(result([move(atSeven), move(atSix, 'b')], atSeven));
  assert.equal(phases[1].w.total, 1);
  assert.equal(phases[2].b.total, 1);
});

test('all-Book phase uses the Book icon and excludes Book loss from aggregate grading', () => {
  const allBook = phase(result([move(START, 'w', 'Book', 0.005), move(START, 'b', 'Book', 0)]), 'opening');
  assert.deepEqual(allBook.w, { label: 'Book', total: 1, scoredTotal: 0, meanLoss: null });
  const mixed = phase(result([move(START, 'w', 'Book', 0.9), move(START, 'w', 'Good', 0.02)]), 'opening');
  assert.equal(mixed.w.label, 'Good');
  assert.equal(mixed.w.meanLoss, 0.02);
  assert.deepEqual([mixed.w.total, mixed.w.scoredTotal], [2, 1]);
});

test('phase grades use each side independently with documented mean-loss boundaries', () => {
  for (const [loss, expected] of [[0, 'Excellent'], [0.009, 'Excellent'], [0.01, 'Good'], [0.039, 'Good'], [0.04, 'Inaccuracy'], [0.079, 'Inaccuracy'], [0.08, 'Mistake'], [0.199, 'Mistake'], [0.2, 'Blunder'], [1, 'Blunder']]) {
    const scored = phase(result([move(END, 'w', 'Excellent', loss), move(END, 'b', 'Best', 0)]), 'endgame');
    assert.equal(scored.w.label, expected, String(loss));
    assert.equal(scored.b.label, 'Best');
  }
});

test('Brilliant and Great require a real special move and otherwise clean play', () => {
  for (const label of ['Brilliant', 'Great']) {
    const clean = phase(result([move(END, 'w', label), move(END, 'w', 'Excellent', 0.002)]), 'endgame');
    assert.equal(clean.w.label, label);
    const bad = phase(result([move(END, 'w', label), move(END, 'w', 'Blunder', 0.4)]), 'endgame');
    assert.equal(bad.w.label, 'Blunder');
    const dilutedMistake = phase(result([move(END, 'w', label), move(END, 'w', 'Mistake', 0.08), ...Array.from({ length: 20 }, () => move(END))]), 'endgame');
    assert.equal(dilutedMistake.w.label, 'Excellent');
  }
  assert.equal(phase(result([move(END), move(END)]), 'endgame').w.label, 'Best');
  assert.equal(phase(result([move(END, 'w', 'Excellent', 0)]), 'endgame').w.label, 'Excellent');
});

test('malformed observations do not create phase labels or mutate the review', () => {
  const input = result([move(END), move('invalid'), move(END, 'x'), move(END, 'w', 'Unknown'), move(END, 'w', 'Best', NaN), move(END, 'w', 'Best', -1), move(END, 'w', 'Best', 2)]);
  const before = structuredClone(input);
  const ending = phase(input, 'endgame');
  assert.equal(ending.w.total, 1);
  assert.equal(ending.w.label, 'Best');
  assert.deepEqual(input, before);
  const badEarlyEndgame = getPhasePerformance(result([move(END, 'w', 'Unknown'), move(MIDDLE)], MIDDLE));
  assert.equal(badEarlyEndgame[1].w.total, 1);
  assert.equal(badEarlyEndgame[2].w.total, 0);
});
