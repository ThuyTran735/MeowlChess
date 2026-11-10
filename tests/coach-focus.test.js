import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoachPerspective, resolveCoachFocus, detectCoachPlayerSide } from '../extension/lib/coach-focus.js';
import { answerCoach, describeCoachMove, createCoachWalkthrough } from '../extension/lib/coach.js';
import { parseGame } from '../extension/lib/review.js';

const game = (source = 'chesscom', white = 'Alice', black = 'Bob') => ({ source, white: { username: white }, black: { username: black } });

test('relative focus follows the player across colors and stays unresolved without identity', () => {
  for (const value of ['both', 'w', 'b', 'me', 'opponent']) assert.equal(normalizeCoachPerspective(value), value);
  for (const value of [null, undefined, '', 'white', 'enemy', {}, []]) assert.equal(normalizeCoachPerspective(value), 'both');
  for (const side of ['w', 'b']) {
    assert.equal(resolveCoachFocus('me', side), side);
    assert.equal(resolveCoachFocus('opponent', side), side === 'w' ? 'b' : 'w');
  }
  for (const side of [null, undefined, 'both', 'white', {}]) {
    assert.equal(resolveCoachFocus('me', side), null);
    assert.equal(resolveCoachFocus('opponent', side), null);
    for (const fixed of ['w', 'b', 'both']) assert.equal(resolveCoachFocus(fixed, side), fixed);
  }
});

test('account identity follows actual usernames, not board orientation or a prior color', () => {
  const stored = { usernames: { chesscom: ' aLiCe ', lichess: 'Bob' } };
  assert.equal(detectCoachPlayerSide({ ...game(), orientation: 'black' }, stored), 'w');
  assert.equal(detectCoachPlayerSide({ ...game('chesscom', 'Bob', 'Alice'), orientation: 'white' }, stored), 'b');
  assert.equal(detectCoachPlayerSide(game('lichess'), stored), 'b');
  assert.equal(detectCoachPlayerSide(game(), { usernames: { chesscom: 'Nobody' } }), null);
  assert.equal(detectCoachPlayerSide(game(), {}), null);
});

test('detected signed-in identity takes precedence over an opponent searched in Games', () => {
  const stored = {
    usernames: { chesscom: 'Bob', lichess: 'Alice' }, username: 'Bob',
    siteReviewSettings: { chesscom: { username: 'Bob' } }, savedAccounts: { chesscom: ['Bob'] },
    detectedAccounts: { chesscom: { username: 'aLiCe', detectedAt: 1 }, lichess: { username: 'Bob', detectedAt: 2 } },
  };
  assert.equal(detectCoachPlayerSide(game(), stored), 'w');
  assert.equal(detectCoachPlayerSide(game('chesscom', 'Bob', 'Alice'), stored), 'b');
  assert.equal(detectCoachPlayerSide(game('lichess'), stored), 'b');
  assert.equal(resolveCoachFocus('opponent', detectCoachPlayerSide(game(), stored)), 'b');
});

test('a detected spectator does not become a searched player, and providers stay separate', () => {
  const stored = { usernames: { chesscom: 'Alice' }, savedAccounts: { chesscom: ['Bob'] },
    detectedAccounts: { chesscom: { username: 'Viewer', detectedAt: 1 } } };
  assert.equal(detectCoachPlayerSide(game(), stored), null);
  assert.equal(resolveCoachFocus('me', detectCoachPlayerSide(game(), stored)), null);
  assert.equal(detectCoachPlayerSide(game('lichess'), stored), null);
  assert.equal(detectCoachPlayerSide(game(), {
    usernames: { chesscom: 'Alice' }, detectedAccounts: { lichess: { username: 'Bob', detectedAt: 1 } },
  }), 'w');
});

test('malformed detection cache cannot override remembered or manual account lookup', () => {
  const malformed = [null, [], 'Alice', {}, { username: 'Alice' },
    { username: 'Alice', detectedAt: '1' }, { username: 'Alice', detectedAt: 0 },
    { username: 'Alice', detectedAt: -1 }, { username: 'Alice', detectedAt: Infinity },
    { username: 'Alice', detectedAt: NaN }, { username: 'https://chess.com/member/Alice', detectedAt: 1 },
    { username: 'A'.repeat(51), detectedAt: 1 }];
  for (const value of malformed) {
    assert.equal(detectCoachPlayerSide(game(), { usernames: { chesscom: 'Bob' }, detectedAccounts: { chesscom: value } }), 'b');
  }
});

test('provider accounts and the Chess.com-only legacy field never cross sites', () => {
  assert.equal(detectCoachPlayerSide(game(), { usernames: { lichess: 'Alice' } }), null);
  assert.equal(detectCoachPlayerSide(game('lichess'), { username: 'Alice' }), null);
  assert.equal(detectCoachPlayerSide(game(), { username: 'Alice' }), 'w');
  assert.equal(detectCoachPlayerSide(game('lichess'), { savedAccounts: { chesscom: ['Alice'] } }), null);
  assert.equal(detectCoachPlayerSide(game(), { siteReviewSettings: { lichess: { username: 'Alice' } } }), null);
  assert.equal(detectCoachPlayerSide(game('lichess'), { siteReviewSettings: { lichess: { enabled: false, username: 'Alice' } } }), 'w');
});

test('current and site account preferences precede a unique saved-account fallback', () => {
  assert.equal(detectCoachPlayerSide(game(), { usernames: { chesscom: 'Alice' }, username: 'Bob', savedAccounts: { chesscom: ['Alice', 'Bob'] } }), 'w');
  assert.equal(detectCoachPlayerSide(game(), { usernames: { chesscom: 'https://www.chess.com/game/123' }, siteReviewSettings: { chesscom: { username: 'Bob' } } }), 'b');
  assert.equal(detectCoachPlayerSide(game(), { savedAccounts: { chesscom: ['nobody', 'Alice', 'ALICE'] } }), 'w');
  assert.equal(detectCoachPlayerSide(game(), { savedAccounts: { chesscom: ['Alice', 'Bob'] } }), null);
  assert.equal(detectCoachPlayerSide(game('chesscom', 'Alice', 'ALICE'), { username: 'Alice' }), null);
  assert.equal(detectCoachPlayerSide({ source: 'chesscom', white: { username: 'Alice' } }, { username: 'Alice' }), null);
});

test('PGN accounts require a recognized site or URL, including leading PGN headers', () => {
  const stored = { usernames: { chesscom: 'Alice', lichess: 'Bob' } };
  const pgn = '[Site "Chess.com"] [White "Alice"] [Black "Bob"]\n\n1. e4 e5 1-0';
  assert.equal(detectCoachPlayerSide({ source: 'pgn', pgn }, stored), 'w');
  assert.equal(detectCoachPlayerSide({ source: 'pgn', headers: { Site: 'https://lichess.org/abcdefgh', White: 'Alice', Black: 'Bob' } }, stored), 'b');
  assert.equal(detectCoachPlayerSide({ ...game('pgn'), url: 'https://www.chess.com/game/123?username=Alice' }, stored), 'w');
  assert.equal(detectCoachPlayerSide({ ...game('pgn'), headers: { Link: 'https://lichess.org/abcdefgh' } }, stored), 'b');
  assert.equal(detectCoachPlayerSide(game('pgn'), stored), null);
  assert.equal(detectCoachPlayerSide({ ...game('pgn'), pgn: '1. e4 { [Site "Chess.com"] } e5 1-0' }, stored), null);
  for (const url of ['https://chess.com.example.com/game/123', 'https://lichess.org.evil/abcdefgh', 'https://chess.com@evil.test/game/123', 'http://chess.com/game/123', 'file:///chess.com', 'https://www.chess.com:9999/game/123']) {
    assert.equal(detectCoachPlayerSide({ ...game('pgn'), url }, stored), null, url);
  }
  assert.equal(detectCoachPlayerSide({ ...game(), url: 'https://lichess.org/abcdefgh' }, stored), null);
  assert.equal(detectCoachPlayerSide({ ...game('pgn'), url: 'https://lichess.org/abcdefgh', headers: { Site: 'Chess.com' } }, stored), null);
});

function reviewed() {
  const pgn = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0';
  const parsed = parseGame(pgn);
  const positions = parsed.positions.map((fen, index) => {
    const move = parsed.moves[index], bestMove = move ? move.from + move.to : null;
    return { cp: 0, mate: null, depth: 12, bestMove, pv: bestMove ? [bestMove] : [] };
  });
  const moves = parsed.moves.map((move, index) => ({ ...move, ply: index + 1, label: index === 2 ? 'Mistake' : index === 3 ? 'Blunder' : 'Best',
    probabilityLoss: index === 2 ? .15 : index === 3 ? .35 : 0, loss: 0, accuracy: 100, bestSan: move.san, evalAfter: positions[index + 1] }));
  return { game: { ...game(), pgn }, result: { game: parsed, positions, moves, summary: { w: { accuracy: 80 }, b: { accuracy: 70 } } } };
}

test('my and opponent questions use actual player identity even while focused on the other side', () => {
  const input = reviewed();
  for (const playerSide of ['w', 'b']) for (const perspective of ['both', 'w', 'b', 'me', 'opponent']) {
    const mine = playerSide === 'w' ? 3 : 4, theirs = playerSide === 'w' ? 4 : 3;
    for (const question of ['What was my biggest mistake?', 'What was the biggest mistake I made?']) {
      assert.equal(answerCoach({ ...input, question, perspective, playerSide }).subjectPly, mine, `${playerSide}/${perspective}/${question}`);
    }
    for (const question of ["What was my opponent's biggest mistake?", 'What was their biggest mistake?']) {
      assert.equal(answerCoach({ ...input, question, perspective, playerSide }).subjectPly, theirs, `${playerSide}/${perspective}/${question}`);
    }
  }
});

test('explicit side names win, generic prompts follow focus, and move-number pronouns disambiguate correctly', () => {
  const input = reviewed(), base = { ...input, perspective: 'opponent', playerSide: 'w' };
  assert.equal(answerCoach({ ...base, question: 'What was the biggest mistake?' }).subjectPly, 4);
  assert.equal(answerCoach({ ...base, perspective: 'me', question: 'What was the biggest mistake?' }).subjectPly, 3);
  assert.equal(answerCoach({ ...base, question: "What was White's biggest mistake?" }).subjectPly, 3);
  assert.equal(answerCoach({ ...base, question: "What was Black's biggest mistake?" }).subjectPly, 4);
  assert.equal(answerCoach({ ...base, question: 'What was the biggest mistake for both players?' }).subjectPly, 4);
  assert.equal(answerCoach({ ...base, question: 'Explain my move 2' }).subjectPly, 3);
  assert.equal(answerCoach({ ...base, question: "Explain my opponent's move 2" }).subjectPly, 4);
  assert.equal(answerCoach({ ...base, question: 'Explain 2. Nf3' }).subjectPly, 3);
});

test('unknown identity never silently becomes the selected side, while legacy callers keep working', () => {
  const input = reviewed();
  for (const question of ['What was my biggest mistake?', "What was my opponent's biggest mistake?"]) {
    const answer = answerCoach({ ...input, playerSide: null, perspective: 'b', question });
    assert.match(answer.text, /couldn’t identify your side/);
    assert.equal(answer.subjectPly, undefined);
  }
  assert.match(answerCoach({ ...input, playerSide: null, perspective: 'me', question: 'Summarize this game' }).text, /couldn’t identify your side/);
  assert.equal(answerCoach({ ...input, playerSide: null, perspective: 'me', question: "What was White's biggest mistake?" }).subjectPly, 3);
  assert.equal(answerCoach({ ...input, perspective: 'w', question: 'What was my biggest mistake?' }).subjectPly, 3);
  assert.equal(answerCoach({ ...input, perspective: 'w', question: "What was my opponent's biggest mistake?" }).subjectPly, 4);
  assert.match(answerCoach({ ...input, question: 'What was my biggest mistake?' }).text, /Choose White or Black/);
});

test('relative walkthrough and direct commentary filter exact mover colors', () => {
  const input = reviewed(), prepared = createCoachWalkthrough(input);
  for (const describe of [options => describeCoachMove({ ...input, ...options }), options => prepared.describe(options)]) {
    assert.equal(describe({ ply: 3, perspective: 'me', playerSide: 'w' })?.subjectPly, 3);
    assert.equal(describe({ ply: 3, perspective: 'opponent', playerSide: 'w' }), null);
    assert.equal(describe({ ply: 4, perspective: 'opponent', playerSide: 'w' })?.subjectPly, 4);
    assert.equal(describe({ ply: 4, perspective: 'me', playerSide: 'b' })?.subjectPly, 4);
    assert.equal(describe({ ply: 4, perspective: 'me', playerSide: null }), null);
  }
});
