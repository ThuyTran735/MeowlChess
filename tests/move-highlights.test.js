import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { sacrificeOffer, highlightCandidate, classifyHighlight } from '../extension/lib/move-highlights.js';

const moveAt = (fen, san) => new Chess(fen).move(san);
const uci = move => move.from + move.to + (move.promotion || '');
const score = (cp = 80, bestMove = null, depth = 16) => ({ cp, mate: null, depth, bestMove, pv: bestMove ? [bestMove] : [], candidates: [] });
const continuation = (move, cp = 80) => score(cp, uci(new Chess(move.after).moves({ verbose: true })[0]));
function compared(move, cp = 80, alternateCp = -120, alternate) {
  const before = score(cp, uci(move));
  const second = alternate || new Chess(move.before).moves({ verbose: true }).map(uci).find(value => value !== uci(move));
  before.candidates = [{ ...score(cp, uci(move)), rank: 1 }, { ...score(alternateCp, second), rank: 2 }];
  return before;
}
const gift = () => moveAt('r1bq1rk1/pppnbppp/4p3/3p4/3P4/3BPN2/PPP2PPP/RNBQK2R w KQ - 0 1', 'Bxh7+');

test('a sound offered piece qualifies even when the best continuation declines it', () => {
  const move = gift(), before = score(80, uci(move));
  assert.deepEqual(sacrificeOffer(move), { square: 'h7', piece: 'b', capture: 'g8h7', investment: 2 });
  for (const pv of [['g8h7', 'f3g5'], ['g8h8']]) {
    assert.equal(classifyHighlight(move, before, { ...score(80, pv[0]), pv }), 'Brilliant');
  }
});

test('a near-best sacrifice can be Brilliant, while a costly or unsupported offer cannot', () => {
  const move = gift(), after = continuation(move, 75);
  const before = score(80, 'e1g1');
  assert.equal(classifyHighlight(move, before, after), 'Brilliant');
  assert.equal(classifyHighlight(move, before, { ...after, cp: 0 }), null);
  assert.equal(classifyHighlight(move, { ...before, bestMove: null }, after), null);
  assert.equal(classifyHighlight(move, { ...before, bestMove: 'e1e8' }, after), null);
});

test('an exchange sacrifice counts the piece already gained', () => {
  const move = moveAt('7k/6pp/8/8/3p4/2b5/2R5/K7 w - - 0 1', 'Rxc3');
  assert.deepEqual(sacrificeOffer(move), { square: 'c3', piece: 'r', capture: 'd4c3', investment: 2 });
  assert.equal(classifyHighlight(move, score(80, uci(move)), continuation(move)), 'Brilliant');
});

test('quiet moves can deliberately leave a different piece available', () => {
  const move = moveAt('6k1/8/p7/1B6/8/8/8/4K1N1 w - - 0 1', 'Nf3');
  assert.deepEqual(sacrificeOffer(move), { square: 'b5', piece: 'b', capture: 'a6b5', investment: 3 });
  assert.equal(classifyHighlight(move, score(80, uci(move)), continuation(move)), 'Brilliant');
});

test('equal trades, winning trades, and immediately recovered material are not sacrifices', () => {
  for (const piece of ['r', 'q']) {
    const move = moveAt(`7k/6pp/8/8/3p4/2${piece}5/2R5/K7 w - - 0 1`, 'Rxc3');
    assert.equal(sacrificeOffer(move), null);
  }
  const temporary = moveAt('7k/pr6/8/8/3B4/8/8/R6K w - - 0 1', 'Rxa7');
  assert.equal(sacrificeOffer(temporary), null);
});

test('a pinned attacker cannot manufacture a sacrifice', () => {
  const move = moveAt('4k3/1B2n3/8/8/8/8/8/4R1K1 w - - 0 1', 'Bc8');
  assert.equal(sacrificeOffer(move), null);
});

test('shallow, unstable, losing, and illegal evidence cannot earn Brilliant', () => {
  const move = gift(), before = score(80, uci(move)), after = continuation(move);
  assert.equal(classifyHighlight(move, { ...before, depth: 8 }, after), null);
  assert.equal(classifyHighlight(move, before, { ...after, depth: 8 }), null);
  assert.equal(classifyHighlight(move, before, score(-150)), null);
  assert.equal(classifyHighlight(move, score(-500, uci(move)), score(-500)), null);
  assert.equal(sacrificeOffer({ ...move, before: 'invalid' }), null);
  assert.equal(classifyHighlight({ ...move, after: move.before }, before, after), null);
});

test('a won position needs a meaningful alternative before a sacrifice is special', () => {
  const move = gift();
  assert.equal(classifyHighlight(move, score(1000, uci(move)), continuation(move, 1000)), null);
  assert.equal(classifyHighlight(move, compared(move, 1000, 900), continuation(move, 1000)), null);
  assert.equal(classifyHighlight(move, compared(move, 1000, 0), continuation(move, 1000)), 'Brilliant');
});

test('an accepted sacrifice with a complete verified mating line can be Brilliant in a won position', () => {
  const chess = new Chess('2kr4/p1p2p2/1p6/8/1P3Pnr/P1Pq1pR1/3N1P1p/R1B4K w - - 2 28');
  const previousMove = chess.move('Rxf3'), move = chess.move('Qxf3+');
  const before = { ...score(-99500, 'd3e4'), mate: -5 };
  const pv = ['d2f3', 'd8d1', 'f3e1', 'd1e1', 'h1g2', 'h2h1q', 'g2g3', 'h1h3'];
  const after = { ...score(-99600, pv[0]), mate: -4, pv };
  assert.deepEqual(sacrificeOffer(move, { previousMove }), { square: 'f3', piece: 'q', capture: 'd2f3', investment: 4 });
  assert.equal(classifyHighlight(move, before, after, { previousMove }), 'Brilliant');
  assert.equal(classifyHighlight(move, before, { ...after, pv: pv.slice(0, -2), mate: -3 }, { previousMove }), null);
  assert.equal(classifyHighlight(move, before, { ...after, mate: -5 }, { previousMove }), null);
  assert.equal(classifyHighlight(move, { ...before, mate: null }, after, { previousMove }), null);
  assert.equal(classifyHighlight(move, before, { ...after, mate: 4 }, { previousMove }), null);
});

test('coherent root-best evidence tolerates modest adjacent search drift, but not large or unsupported drift', () => {
  const chess = new Chess(); chess.move('e4'); chess.move('e5'); const move = chess.move('Nf3');
  const before = compared(move, 200, -100, 'b1c3');
  assert.equal(classifyHighlight(move, before, continuation(move, 175)), 'Great');
  assert.equal(classifyHighlight(move, before, continuation(move, 150)), null);
  assert.equal(classifyHighlight(move, score(200, uci(move)), continuation(move, 175)), null);
});

test('Great requires coherent legal alternatives showing a consequential only-good move', () => {
  const chess = new Chess(); chess.move('e4'); chess.move('e5'); const move = chess.move('Nf3');
  const before = compared(move, 200, -100, 'b1c3');
  const after = continuation(move, 200);
  assert.equal(classifyHighlight(move, before, after), 'Great');
  const otherPreferred = compared(move, 200, -100, 'b1c3');
  otherPreferred.bestMove = 'b1c3';
  otherPreferred.candidates[0].bestMove = 'b1c3';
  otherPreferred.candidates[1].bestMove = uci(move);
  assert.equal(classifyHighlight(move, otherPreferred, after), null);
  assert.equal(classifyHighlight(move, score(200, uci(move)), after), null);
  assert.equal(classifyHighlight(move, compared(move, 200, 190, 'b1c3'), after), null);
  assert.equal(classifyHighlight(move, before, { ...after, cp: -100 }), null);
  assert.equal(classifyHighlight(move, { ...before, candidates: [before.candidates[0], { ...before.candidates[1], depth: 15 }] }, after), null);
  assert.equal(classifyHighlight(move, { ...before, candidates: [before.candidates[0], { ...before.candidates[1], bestMove: uci(move) }] }, after), null);
  assert.equal(classifyHighlight(move, { ...before, candidates: [before.candidates[0], { ...before.candidates[1], bestMove: 'e2e5' }] }, after), null);
  assert.equal(classifyHighlight(move, { ...before, candidates: [before.candidates[0], { ...before.candidates[1], lowerbound: true }] }, after), null);
});

test('a near-best continuation that wins material after an error can be Great without a unique best move', () => {
  const chess = new Chess('r2qkb1r/p1pb1pp1/1pn2n1p/6Q1/4p3/2P1P1P1/PP1P1PBP/RNB1K1NR w KQkq - 0 9');
  const previousMove = chess.move('Qf4'), move = chess.move('Bd6');
  const before = score(-511, 'g7g5');
  before.candidates = [{ ...score(-511, 'g7g5'), rank: 1 }, { ...score(-508, uci(move)), rank: 2 }];
  const pv = ['f4f6', 'd8f6', 'g2e4', 'f6e7', 'e4g2', 'e8c8', 'd2d4', 'f7f5'];
  const after = { ...score(-508, pv[0]), pv };
  const previousEvaluation = score(-200, 'g5b5');
  const context = { previousMove, previousEvaluation };
  assert.equal(classifyHighlight(move, before, after, context), 'Great');
  assert.equal(classifyHighlight(move, before, after), null);
  assert.equal(classifyHighlight(move, before, after, { ...context, previousEvaluation: score(-500) }), null);
  assert.equal(classifyHighlight(move, before, after, { ...context, previousEvaluation: score(-200, 'g5b5', 8) }), null);
  assert.equal(classifyHighlight(move, before, after, { ...context, previousMove: { ...previousMove, after: previousMove.before } }), null);
  assert.equal(classifyHighlight(move, { ...before, candidates: [before.candidates[0], { ...before.candidates[1], cp: -400 }] }, after, context), null);
  assert.equal(classifyHighlight(move, before, { ...after, pv: pv.slice(0, 2) }, context), null);
  const quiet = ['f4h4', 'g7g5', 'h4h3', 'a8b8'];
  assert.equal(classifyHighlight(move, before, { ...score(-508, quiet[0]), pv: quiet }, context), null);
});

test('automatic recaptures and loose-piece pickups do not receive Great', () => {
  const pickup = moveAt('7k/8/8/8/8/2n5/2R5/K7 w - - 0 1', 'Rxc3');
  assert.equal(classifyHighlight(pickup, compared(pickup, 200, -200), continuation(pickup, 200)), null);
  const chess = new Chess(); chess.move('e4'); chess.move('d5');
  const previousMove = chess.move('exd5'), recaptured = chess.move('Qxd5');
  assert.equal(classifyHighlight(recaptured, compared(recaptured, -200, 200), continuation(recaptured, -200), { previousMove }), null);
});

test('a tactical continuation cannot claim material that is hanging at its bounded horizon', () => {
  const chess = new Chess('rb2r2k/7p/8/8/8/8/4P3/R3K1N1 b - - 0 1');
  const previousMove = chess.move('Ba7'), move = chess.move('Nf3');
  const before = compared(move, 200, 195, 'g1h3');
  const pv = ['h7h6', 'a1a7', 'e8e2', 'e1f1', 'a8a7'];
  const after = { ...score(200, pv[0]), pv };
  assert.equal(classifyHighlight(move, before, after, { previousMove, previousEvaluation: score(0) }), null);
});

test('unequal recaptures can offer the recapturing piece at a genuine net material cost', () => {
  const chess = new Chess('7k/6pp/8/1n6/3p4/2B5/2R5/K7 b - - 0 1');
  const previousMove = chess.move('Nxc3'), move = chess.move('Rxc3');
  assert.deepEqual(sacrificeOffer(move, { previousMove }), { square: 'c3', piece: 'r', capture: 'd4c3', investment: 2 });
  assert.equal(highlightCandidate(move, score(80, uci(move), 8), score(80, null, 8), { previousMove })?.kind, 'sacrifice');
  assert.equal(classifyHighlight(move, score(80, uci(move)), continuation(move), { previousMove }), 'Brilliant');
  assert.equal(classifyHighlight(move, score(80, uci(move)), continuation(move, -200), { previousMove }), null);
});

test('recapture detection still excludes equal trades and unrelated loose pieces', () => {
  const chess = new Chess('7k/6pp/8/8/3p4/2r5/2R5/K7 w - - 0 1');
  const equal = chess.move('Rxc3'), previousMove = { captured: 'n', to: 'c3' };
  assert.equal(sacrificeOffer(equal, { previousMove }), null);
  const quiet = moveAt('6k1/8/p7/1B6/8/5n2/8/4K1N1 w - - 0 1', 'Nxf3');
  assert.equal(sacrificeOffer(quiet, { previousMove: { captured: 'p', to: 'f3' } }), null);
});

test('quick scans nominate sacrifices without awarding unsupported labels or mutating evidence', () => {
  const move = gift(), before = score(1000, uci(move), 8), after = score(1000, null, 8);
  const snapshot = structuredClone({ before, after });
  assert.equal(highlightCandidate(move, before, after)?.kind, 'sacrifice');
  assert.equal(classifyHighlight(move, before, after), null);
  assert.deepEqual({ before, after }, snapshot);
  assert.equal(highlightCandidate(move, before, score(-500)), null);
});

test('quiet quick-scan best moves can be checked without an unsupported Great label', () => {
  const chess = new Chess(); chess.move('e4'); chess.move('e5'); const move = chess.move('Nf3');
  const before = score(80, uci(move), 8), after = { ...continuation(move), depth: 8 };
  assert.equal(highlightCandidate(move, before, after)?.priority, 0.25);
  assert.equal(classifyHighlight(move, before, after), null);
  assert.equal(highlightCandidate(move, compared(move, 80, 75, 'b1c3'), continuation(move)), null);
  assert.equal(highlightCandidate(move, score(1000, uci(move), 8), continuation(move, 1000)), null);
});

test('a near-best response to an error is nominated for confirmation, not awarded Great', () => {
  const chess = new Chess(); chess.move('e4'); chess.move('e5'); const move = chess.move('Nf3');
  const before = score(150, 'b1c3', 8), after = { ...continuation(move, 140), depth: 8 };
  assert.equal(highlightCandidate(move, before, after, { previousEvaluation: score(-100) })?.kind, 'turning-point');
  assert.equal(classifyHighlight(move, before, after), null);
  assert.equal(highlightCandidate(move, before, after), null);
  const pickup = moveAt('7k/8/8/8/8/2n5/2R5/K7 w - - 0 1', 'Rxc3');
  assert.equal(highlightCandidate(pickup, score(150, 'c2c3', 8), continuation(pickup, 140), { previousEvaluation: score(-100) }), null);
});

test('both colors use their own expected-score direction', () => {
  const move = moveAt('rnbqk2r/ppp2ppp/3bpn2/3p4/3P4/4P3/PPPNBPPP/R1BQ1RK1 b kq - 0 1', 'Bxh2+');
  assert.equal(classifyHighlight(move, score(-80, uci(move)), continuation(move, -80)), 'Brilliant');
  assert.equal(classifyHighlight(move, score(-80, uci(move)), continuation(move, 200)), null);
});

test('special labels reject missing, inconsistent, or illegal continuations', () => {
  const move = gift(), before = score(80, uci(move));
  for (const after of [score(80), { ...score(80, 'g8h8'), pv: ['g8h7'] }, score(80, 'g8g1'), { ...score(80, 'g8h7'), pv: ['g8h7', 'f3g5', 'h7g8', 'd1h9'] }]) {
    assert.equal(classifyHighlight(move, before, after), null);
  }
});
