import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';
import { parseGame } from '../extension/lib/review.js';
import { estimateGameRatings, gameRatingDescription, GAME_RATING_VERSION } from '../extension/lib/game-rating.js';

const PGN = '[WhiteElo "1000"]\n[BlackElo "1000"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 1/2-1/2';
function fixture(loss = 0.03, depth = 16) {
  const game = parseGame(PGN);
  return {
    game,
    positions: game.positions.map(() => ({ cp: 0, mate: null, depth })),
    moves: game.moves.map((move, index) => ({ ...move, ply: index + 1, label: 'Best', probabilityLoss: loss, accuracy: 100 })),
  };
}

test('experimental ratings are bounded, symmetric, and worsen with observed loss', () => {
  assert.equal(GAME_RATING_VERSION, 'meowlchess-rating-3');
  let previous = Infinity;
  for (const loss of [0, 0.01, 0.03, 0.05, 0.1, 0.3, 1]) {
    const ratings = estimateGameRatings(fixture(loss));
    assert.deepEqual(ratings.w, ratings.b);
    assert.equal(ratings.w.eligibleMoves, 10);
    assert.equal(ratings.w.reason, null);
    assert(ratings.w.rating <= previous);
    assert(ratings.w.rating >= 100 && ratings.w.rating <= 4000);
    assert(ratings.w.range.low >= 100 && ratings.w.range.high <= 4000);
    assert(ratings.w.range.low <= ratings.w.rating && ratings.w.range.high >= ratings.w.rating);
    assert(ratings.w.range.low < ratings.w.range.high);
    assert.equal(ratings.w.rating % 50, 0);
    previous = ratings.w.rating;
  }
  assert(estimateGameRatings(fixture(0)).w.rating > 1000);
  assert(estimateGameRatings(fixture(1)).w.rating < 1000);
  assert(estimateGameRatings(fixture(0)).w.rating < 1400, 'Ten easy decisions cannot imply master strength.');
});

test('poor play is not flattened into the same near-account estimate', () => {
  const result = fixture();
  result.game.headers.WhiteElo = result.game.headers.BlackElo = '980';
  for (const move of result.moves) move.probabilityLoss = move.color === 'w' ? 0.12 : 0.07;
  const ratings = estimateGameRatings(result);
  assert(ratings.w.rating < ratings.b.rating - 200, 'Distinct mistake severity must remain visible.');
  assert(ratings.w.rating < ratings.w.baseline - 400, 'Poor play must not be trapped by the former account-minus-400 floor.');
  assert(ratings.b.rating < ratings.b.baseline, 'Both sides played below the reference quality.');
});

test('better play responds to move quality instead of hitting a shared fixed ceiling', () => {
  const clean = estimateGameRatings(fixture(0)).w;
  const careful = estimateGameRatings(fixture(0.01)).w;
  const modest = estimateGameRatings(fixture(0.03)).w;
  assert(clean.rating > careful.rating && careful.rating > modest.rating);
  assert(clean.rating < 1400, 'A short clean sequence still has limited upside.');
});

test('uses same-game player ratings and observed loss, rather than labels or summary score', () => {
  const result = fixture();
  result.game.headers.WhiteElo = '980'; result.game.headers.BlackElo = '2000';
  const expected = estimateGameRatings(result);
  assert.equal(expected.w.baseline, 980);
  assert.equal(expected.b.baseline, 2000);
  assert(expected.b.rating > expected.w.rating);
  result.source = 'lichess'; result.white = { rating: 200 }; result.black = { rating: 3000 };
  result.summary = { w: { accuracy: 1 }, b: { accuracy: 100 } };
  for (const move of result.moves) { move.label = 'Blunder'; move.accuracy = 1; }
  assert.deepEqual(estimateGameRatings(result), expected);
  const before = JSON.stringify(result);
  estimateGameRatings(result);
  assert.equal(JSON.stringify(result), before, 'Estimation must not mutate the stored review.');
});

test('missing or malformed player ratings do not invent an absolute Elo', () => {
  for (const value of [undefined, '', '?', 'unrated', '0', '99', '-100', '1000?', '1000.5', '4001', '99999', '1e3']) {
    const result = fixture(); result.game.headers.WhiteElo = value;
    assert.deepEqual(estimateGameRatings(result).w, { rating: null, eligibleMoves: 10, reason: 'Player rating unavailable' });
    assert.equal(estimateGameRatings(result).b.baseline, 1000);
  }
  for (const value of ['100', '4000', ' 980 ']) {
    const result = fixture(); result.game.headers.WhiteElo = value;
    const rating = estimateGameRatings(result).w;
    assert.equal(rating.baseline, Number(value));
    assert(rating.rating >= 100 && rating.rating <= 4000);
    assert(rating.range.low <= rating.rating && rating.range.high >= rating.rating);
  }
});

test('shallow searches widen the range instead of disguising poor play as the account rating', () => {
  const deep = estimateGameRatings(fixture(0.08, 16)).w;
  const shallow = estimateGameRatings(fixture(0.08, 8)).w;
  assert.equal(shallow.rating, deep.rating, 'Identical move evidence has the same central estimate.');
  assert(shallow.range.high - shallow.range.low > deep.range.high - deep.range.low);
  assert(shallow.rating < shallow.baseline - 400);
  assert.equal(shallow.confidence, 'low');
});

test('short clean play has limited upside and missing depth is treated as limited evidence', () => {
  const deep = fixture(0, 16);
  const short = fixture(0, 16);
  short.moves = short.moves.slice(0, 16); short.positions = short.positions.slice(0, 17);
  assert(estimateGameRatings(short).w.rating <= estimateGameRatings(deep).w.rating);
  assert.equal(estimateGameRatings(short).w.confidence, 'low');
  const unknownDepth = fixture(0.08);
  for (const position of unknownDepth.positions) delete position.depth;
  assert.deepEqual(estimateGameRatings(unknownDepth), estimateGameRatings(fixture(0.08, 0)));
});

test('a single outlier produces a broader rough range than consistent play with the same mean loss', () => {
  const consistent = fixture(0.08), uneven = fixture(0);
  uneven.moves[0].probabilityLoss = uneven.moves[1].probabilityLoss = 0.8;
  const steady = estimateGameRatings(consistent).w, mixed = estimateGameRatings(uneven).w;
  assert.equal(mixed.rating, steady.rating);
  assert(mixed.range.high - mixed.range.low > steady.range.high - steady.range.low);
  assert.match(gameRatingDescription(mixed), /Experimental game estimate/);
  assert.match(gameRatingDescription(mixed), /not account Elo or a calibrated Chess.com rating/);
  assert.match(gameRatingDescription(mixed), /not a statistical confidence interval/);
  assert.equal(gameRatingDescription({ rating: null, reason: 'Not enough moves' }), 'Not enough moves');
});

test('book moves and harmless play in already decisive positions do not pad the estimate', () => {
  for (const exclusion of ['book', 'winning', 'losing', 'mate']) {
    const result = fixture();
    for (let index = 0; index < 4; index++) {
      result.moves[index].probabilityLoss = 0;
      if (exclusion === 'book') result.moves[index].label = 'Book';
      if (exclusion === 'winning') result.positions[index].cp = 1500;
      if (exclusion === 'losing') result.positions[index].cp = -1500;
      if (exclusion === 'mate') result.positions[index].mate = 3;
    }
    const ratings = estimateGameRatings(result);
    assert.equal(ratings.w.eligibleMoves, 8);
    assert.equal(ratings.b.eligibleMoves, 8);
  }
});

test('throwing a winning advantage or a forced mate still lowers the estimate', () => {
  for (const mate of [null, 4]) {
    const clean = fixture();
    clean.positions[0] = { cp: 1500, mate, depth: 16 };
    clean.moves[0].probabilityLoss = 0;
    const thrown = structuredClone(clean);
    thrown.moves[0].probabilityLoss = 0.75;
    const before = estimateGameRatings(clean).w, after = estimateGameRatings(thrown).w;
    assert.equal(after.eligibleMoves, before.eligibleMoves + 1);
    assert(after.rating < before.rating, 'A consequential mistake must not disappear because the player was winning.');
  }
  const losing = fixture(); losing.positions[0].cp = -900; losing.moves[0].probabilityLoss = 0.025;
  assert.equal(estimateGameRatings(losing).w.eligibleMoves, 10, 'Losing the last meaningful chances still counts.');
});

test('requires eight eligible decisions per side and suppresses book-only or forced-only play', () => {
  const result = fixture();
  for (const move of result.moves.filter(move => move.color === 'w').slice(0, 3)) move.label = 'Book';
  assert.deepEqual(estimateGameRatings(result).w, { rating: null, eligibleMoves: 7, reason: 'Not enough moves' });
  assert.notEqual(estimateGameRatings(result).b.rating, null);
  for (const move of result.moves) move.label = 'Book';
  assert.equal(estimateGameRatings(result).w.eligibleMoves, 0);
  assert.equal(estimateGameRatings(result).b.rating, null);

  const forced = fixture();
  const forcedFen = '7k/8/5K2/6Q1/8/8/8/8 b - - 0 1';
  assert.equal(new Chess(forcedFen).moves().length, 1);
  for (let i = 0; i < forced.moves.length; i++) if (forced.moves[i].color === 'b') {
    forced.moves[i].before = forcedFen;
    forced.game.positions[i] = forcedFen;
  }
  assert.deepEqual(estimateGameRatings(forced).b, { rating: null, eligibleMoves: 0, reason: 'Not enough moves' });
});

test('malformed and partial results are unavailable rather than throwing or hiding a bad move', () => {
  for (const result of [undefined, null, {}, { moves: [] }, { moves: [], positions: [] }]) {
    assert.equal(estimateGameRatings(result).w.rating, null);
    assert.equal(estimateGameRatings(result).b.rating, null);
  }
  for (const loss of [NaN, Infinity, -0.01, 1.01, undefined]) {
    const result = fixture(); result.moves[0].probabilityLoss = loss;
    assert.equal(estimateGameRatings(result).w.reason, 'Invalid analysis');
    assert.notEqual(estimateGameRatings(result).b.rating, null);
  }
  for (const change of [
    result => { result.positions[0].cp = NaN; },
    result => { result.positions[0].mate = 'unknown'; },
    result => { result.positions[1].cp = Infinity; },
    result => { result.positions[1].mate = 'unknown'; },
    result => { result.moves[0].before = 'bad fen'; result.game.positions[0] = 'bad fen'; },
    result => { result.moves[0].before = result.moves[1].before; result.game.positions[0] = result.moves[1].before; },
  ]) {
    const result = fixture(); change(result);
    assert.equal(estimateGameRatings(result).w.reason, 'Invalid analysis');
  }
  for (const evaluation of [null, { cp: NaN, mate: null }, { cp: 0, mate: 'unknown' }]) {
    const result = fixture(); result.positions[result.positions.length - 1] = evaluation;
    const ratings = estimateGameRatings(result);
    assert.equal(ratings.b.reason, 'Invalid analysis', 'A malformed final position must not produce a plausible rating.');
    assert.notEqual(ratings.w.rating, null);
  }
});

test('custom starts remain eligible when player ratings and enough decisions are present', () => {
  const game = parseGame('[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1"]\n' + PGN);
  const result = {
    game,
    positions: game.positions.map(() => ({ cp: 0, mate: null })),
    moves: game.moves.map(move => ({ ...move, label: 'Good', probabilityLoss: 0.03 })),
  };
  assert.equal(estimateGameRatings(result).w.baseline, 1000);
  assert.notEqual(estimateGameRatings(result).w.rating, null);
});
