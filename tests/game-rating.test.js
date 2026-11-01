import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { parseGame } from '../extension/lib/review.js';
import { estimateGameRatings, GAME_RATING_VERSION } from '../extension/lib/game-rating.js';

const PGN = '[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 1/2-1/2';
function fixture(loss = 0.03) {
  const game = parseGame(PGN);
  return {
    game,
    positions: game.positions.map(() => ({ cp: 0, mate: null })),
    moves: game.moves.map((move, index) => ({ ...move, ply: index + 1, label: 'Best', probabilityLoss: loss, accuracy: 100 })),
  };
}

test('game rating is rounded, bounded, color-symmetric, and worsens monotonically with loss', () => {
  assert.equal(GAME_RATING_VERSION, 'meowlchess-rating-1');
  let previous = Infinity;
  for (const loss of [0, 0.01, 0.03, 0.05, 0.1, 0.3, 1]) {
    const ratings = estimateGameRatings(fixture(loss));
    assert.deepEqual(ratings.w, ratings.b);
    assert.equal(ratings.w.eligibleMoves, 10);
    assert.equal(ratings.w.reason, null);
    assert(ratings.w.rating <= previous);
    assert(ratings.w.rating >= 300 && ratings.w.rating <= 2800);
    assert.equal(ratings.w.rating % 50, 0);
    previous = ratings.w.rating;
  }
  assert.equal(estimateGameRatings(fixture(0)).w.rating, 2800);
  assert.equal(estimateGameRatings(fixture(0.03)).w.rating, 1550);
  assert.equal(estimateGameRatings(fixture(1)).w.rating, 300);
});

test('uses observed probability loss, not best-move score overrides or account metadata', () => {
  const result = fixture(0.05);
  assert.equal(estimateGameRatings(result).w.rating, 1050);
  const expected = estimateGameRatings(result);
  result.game.headers.WhiteElo = '200'; result.game.headers.BlackElo = '3000';
  result.source = 'lichess'; result.white = { rating: 200 }; result.black = { rating: 3000 };
  result.summary = { w: { accuracy: 1 }, b: { accuracy: 100 } };
  assert.deepEqual(estimateGameRatings(result), expected);
  const before = JSON.stringify(result);
  estimateGameRatings(result);
  assert.equal(JSON.stringify(result), before, 'Estimation must not mutate the stored review.');
});

test('Book moves and already-decisive or mate positions do not pad the estimate', () => {
  for (const exclusion of ['book', 'winning', 'losing', 'mate']) {
    const result = fixture();
    for (let index = 0; index < 4; index++) {
      result.moves[index].probabilityLoss = 1;
      if (exclusion === 'book') result.moves[index].label = 'Book';
      if (exclusion === 'winning') result.positions[index].cp = 1500;
      if (exclusion === 'losing') result.positions[index].cp = -1500;
      if (exclusion === 'mate') result.positions[index].mate = 3;
    }
    const rating = estimateGameRatings(result);
    assert.equal(rating.w.eligibleMoves, 8);
    assert.equal(rating.b.eligibleMoves, 8);
    assert.equal(rating.w.rating, 1550);
    assert.equal(rating.b.rating, 1550);
  }
});

test('requires eight eligible decisions per side and suppresses book-only or forced-only play', () => {
  const result = fixture();
  for (const move of result.moves.filter(move => move.color === 'w').slice(0, 3)) move.label = 'Book';
  assert.deepEqual(estimateGameRatings(result).w, { rating: null, eligibleMoves: 7, reason: 'Not enough moves' });
  assert.equal(estimateGameRatings(result).b.rating, 1550);
  for (const move of result.moves) move.label = 'Book';
  assert.equal(estimateGameRatings(result).w.eligibleMoves, 0);
  assert.equal(estimateGameRatings(result).b.rating, null);

  const forced = fixture();
  const fen = '7k/6Q1/5K2/8/8/8/8/8 b - - 0 1';
  // One legal continuation, rather than a terminal position.
  const forcedFen = '7k/8/5K2/6Q1/8/8/8/8 b - - 0 1';
  assert.equal(new Chess(forcedFen).moves().length, 1);
  for (let i = 0; i < forced.moves.length; i++) if (forced.moves[i].color === 'b') {
    forced.moves[i].before = forcedFen;
    forced.game.positions[i] = forcedFen;
  }
  assert.deepEqual(estimateGameRatings(forced).b, { rating: null, eligibleMoves: 0, reason: 'Not enough moves' });
  assert.equal(new Chess(fen).moves().length, 0);
});

test('a move allowing mate is still a loss if its starting position was competitive', () => {
  const result = fixture();
  result.moves[0].probabilityLoss = 0.5;
  result.positions[1] = { cp: -100000, mate: -4 };
  const rating = estimateGameRatings(result);
  assert.equal(rating.w.eligibleMoves, 10);
  assert(rating.w.rating < estimateGameRatings(fixture()).w.rating);
  assert.equal(rating.b.eligibleMoves, 9, 'The following forced-mate position is excluded.');
});

test('malformed and partial results return unavailable rather than throwing or hiding a bad move', () => {
  for (const result of [undefined, null, {}, { moves: [] }, { moves: [], positions: [] }]) {
    assert.equal(estimateGameRatings(result).w.rating, null);
    assert.equal(estimateGameRatings(result).b.rating, null);
  }
  for (const loss of [NaN, Infinity, -0.01, 1.01, undefined]) {
    const result = fixture(); result.moves[0].probabilityLoss = loss;
    assert.equal(estimateGameRatings(result).w.reason, 'Invalid analysis');
    assert.equal(estimateGameRatings(result).b.rating, 1550);
  }
  for (const change of [
    result => { result.positions[0].cp = NaN; },
    result => { result.positions[0].mate = 'unknown'; },
    result => { result.moves[0].before = 'bad fen'; result.game.positions[0] = 'bad fen'; },
    result => { result.moves[0].before = result.moves[1].before; result.game.positions[0] = result.moves[1].before; },
  ]) {
    const result = fixture(); change(result);
    assert.equal(estimateGameRatings(result).w.reason, 'Invalid analysis');
  }
});

test('custom starting positions remain eligible when enough actual decisions are available', () => {
  const game = parseGame('[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1"]\n' + PGN);
  const result = {
    game,
    positions: game.positions.map(() => ({ cp: 0, mate: null })),
    moves: game.moves.map(move => ({ ...move, label: 'Good', probabilityLoss: 0.03 })),
  };
  assert.equal(estimateGameRatings(result).w.rating, 1550);
});
