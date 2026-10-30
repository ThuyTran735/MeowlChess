import test from 'node:test';
import assert from 'node:assert/strict';
import { importPgn, safeOriginalGameUrl } from '../extension/lib/pgn.js';
import { parseGame } from '../extension/lib/review.js';
import { importPgnCollection, importPgnFiles, PGN_IMPORT_MAX_BYTES, PGN_IMPORT_MAX_GAMES } from '../extension/lib/pgn-import.js';

const first = '[Event "First"]\n[Site "https://lichess.org/AbCd1234"]\n[White "Alice"]\n[Black "Bob"]\n[WhiteElo "1500"]\n[UTCDate "2024.03.02"]\n[UTCTime "14:30:00"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
const second = '[Event "Second"]\n[White "Carol"]\n[Black "Dan"]\n[Result "0-1"]\n\n1. d4 d5 2. c4 0-1';

test('Chess.com short and analysis links preserve the exact live game identity in PGN imports', () => {
  const canonical = 'https://www.chess.com/game/live/186247007610';
  for (const url of ['https://www.chess.com/game/186247007610', 'https://chess.com/game/186247007610/', 'https://www.chess.com/analysis/game/186247007610', 'https://www.chess.com/analysis/game/live/186247007610/', canonical]) {
    assert.equal(safeOriginalGameUrl(url), canonical);
    assert.equal(importPgn(`[Link "${url}"]\n${second}`).url, canonical);
  }
  assert.equal(safeOriginalGameUrl('https://www.chess.com/analysis/game/daily/186247007610'), 'https://www.chess.com/game/daily/186247007610');
  for (const url of ['https://www.chess.com/game/186247007610?redirect=evil', 'https://www.chess.com/game/186247007610#other', 'https://www.chess.com.evil.test/game/186247007610', 'https://www.chess.com/game/not-a-game', 'https://www.chess.com/game/186247007610/extra', 'https://user@www.chess.com/game/186247007610']) assert.equal(safeOriginalGameUrl(url), null);
});

test('single-game collections preserve the established normalized import result', () => {
  const input = '\uFEFF' + first.replaceAll('\n', '\r\n') + ' {Finished}';
  const result = importPgnCollection(input);
  assert.deepEqual(result, { games: [importPgn(input)], rejected: [], total: 1 });
});

test('separates tagged and headerless games, including adjacent tags and results', () => {
  const adjacent = second.replaceAll('\n', '');
  const headerless = '1. c4 e5 2. Nc3 1/2-1/2';
  const result = importPgnCollection(first + adjacent + '\n' + headerless);
  assert.equal(result.total, 3);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.games, [first, adjacent, headerless].map(importPgn));
  const twoHeaderless = importPgnCollection('1. e4 e5 1-0\n1. d4 d5 0-1');
  assert.equal(twoHeaderless.games.length, 2);
  assert.deepEqual(twoHeaderless.games.map(game => game.white.result), ['win', 'lose']);
});

test('ignores result markers and apparent headers in clock comments, semicolons and nested variations', () => {
  const annotated = '[Event "First"]\n[Result "1-0"]\n\n1. e4 { [%clk 0:05:00] [Event "Ghost"] 0-1 } (1. d4 (1. c4 { 1-0 }) d5 { 1/2-1/2 }) e5 ; [Result "0-1"] [Event "Ghost"] 1-0\n2. Nf3 $1 Nc6 1-0 { end [Event "Ghost"] 0-1 }';
  const result = importPgnCollection(annotated + '\n\n' + second);
  assert.equal(result.total, 2);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.games, [importPgn(annotated), importPgn(second)]);
  assert.equal(parseGame(result.games[0].pgn).moves.length, 4);
});

test('quoted and escaped tag values cannot introduce phantom game boundaries', () => {
  const quoted = '[Event "Round 1-0 [not a tag]"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
  assert.equal(importPgnCollection(quoted + '\n' + second).total, 2);
  // The existing game parser may reject these tag escapes; splitting must still
  // retain the next actual game and never interpret the quoted Result as a tag.
  const escaped = String.raw`[Event "A \"quote\", [Result \"0-1\"] and 1-0"]
[Result "1-0"]

1. e4 e5 1-0`;
  const result = importPgnCollection(escaped + '\n' + second);
  assert.equal(result.total, 2);
  assert.deepEqual(result.games.at(-1), importPgn(second));
  assert.equal(result.games.length + result.rejected.length, 2);
  assert.ok(result.rejected.every(game => game.index === 1));
});

test('invalid result or header tokens inside variations reject only their containing game', () => {
  const malformedVariation = '[Event "Bad annotation"]\n[Result "1-0"]\n\n1. e4 (1. d4 (1. c4 1-0 [Event "Fake"]) d5 0-1) e5 1-0';
  const result = importPgnCollection(malformedVariation + '\n' + second);
  assert.equal(result.total, 2);
  assert.deepEqual(result.rejected.map(game => game.index), [1]);
  assert.deepEqual(result.games, [importPgn(second)]);
});

test('retains valid games and reports source indexes for unfinished, illegal, conflicting and nonstandard games', () => {
  const records = [
    first,
    '[Event "Unfinished"]\n[Result "*"]\n\n1. e4 e5 *',
    '[Event "Missing result"]\n[Result "1-0"]\n\n1. d4 d5',
    '[Event "Illegal"]\n[Result "1-0"]\n\n1. e5 e4 1-0',
    '[Event "Mismatch"]\n[Result "0-1"]\n\n1. e4 e5 1-0',
    '[Event "Variant"]\n[Variant "Chess960"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
    second,
  ];
  const result = importPgnCollection(records.join('\n\n'));
  assert.equal(result.total, 7);
  assert.deepEqual(result.games, [importPgn(first), importPgn(second)]);
  assert.deepEqual(result.rejected.map(game => game.index), [2, 3, 4, 5, 6]);
  assert.match(result.rejected[0].message, /completed/);
  assert.match(result.rejected[1].message, /completed/);
  assert.match(result.rejected[2].message, /invalid PGN/);
  assert.match(result.rejected[3].message, /do not match/);
  assert.match(result.rejected[4].message, /standard chess/);
});

test('new Event headers recover a header-only record; a variation result cannot complete a game', () => {
  const records = '[Event "No moves"]\n[Result "*"]\n\n' + first + '\n\n[Event "Only a variation result"]\n[Result "1-0"]\n\n1. e4 e5 (1... c5 1-0)\n\n' + second;
  const result = importPgnCollection(records);
  assert.equal(result.total, 4);
  assert.deepEqual(result.rejected.map(game => game.index), [1, 3]);
  assert.deepEqual(result.games, [importPgn(first), importPgn(second)]);
});

test('free-standing export comments do not become games, and trailing comments stay with the prior game', () => {
  const trailing = first + ' { end [Event "Fake"] 0-1 [Result "*"] }';
  const result = importPgnCollection('{Exported games 0-1}\n; site note [Event "Fake"]\n' + trailing + '\n' + second);
  assert.equal(result.total, 2);
  assert.deepEqual(result.games, [importPgn(trailing), importPgn(second)]);
});

test('rejects empty and globally oversized input without returning partial imports', () => {
  assert.equal(PGN_IMPORT_MAX_BYTES, 5 * 1024 * 1024);
  for (const input of [null, undefined, {}, '', ' \n', '{Only a comment}\n; another comment']) {
    assert.throws(() => importPgnCollection(input), /PGN file|paste/);
  }
  const oversized = first + '\n{' + 'é'.repeat(PGN_IMPORT_MAX_BYTES / 2) + '}';
  assert.ok(oversized.length < PGN_IMPORT_MAX_BYTES);
  assert.throws(() => importPgnCollection(oversized), /5 MiB/);
});

test('enforces the collection count before parsing, counting rejected records too', () => {
  assert.equal(PGN_IMPORT_MAX_GAMES, 100);
  const hundred = Array(PGN_IMPORT_MAX_GAMES).fill('1. e4 e5 1-0').join('\n');
  assert.equal(importPgnCollection(hundred).games.length, PGN_IMPORT_MAX_GAMES);
  assert.throws(() => importPgnCollection(hundred + '\n1. d4 d5 *'), /up to 100 games/);
});

test('enforces each game’s 250 KB limit in bytes without losing the next game', () => {
  const base = '1. e4 {PAD} e5 1-0';
  const exact = base.replace('PAD', 'a'.repeat(250000 - base.length + 3));
  assert.equal(new TextEncoder().encode(exact).byteLength, 250000);
  assert.equal(importPgnCollection(exact).games.length, 1);
  const tooLarge = base.replace('PAD', 'é'.repeat(125000));
  assert.ok(tooLarge.length < 250000);
  const result = importPgnCollection(tooLarge + '\n' + second);
  assert.equal(result.total, 2);
  assert.deepEqual(result.games, [importPgn(second)]);
  assert.equal(result.rejected[0].index, 1);
  assert.match(result.rejected[0].message, /250 KB/);
});

test('preserves the per-game 1000-ply limit and FEN validation', () => {
  const moves = Array.from({ length: 501 }, (_, index) => `${index + 1}. ${index % 2 === 0 ? 'Nf3 Nf6' : 'Ng1 Ng8'}`).join(' ');
  const invalidFen = '[Event "Bad FEN"]\n[SetUp "1"]\n[FEN "not a position"]\n[Result "1-0"]\n\n1. e4 1-0';
  const result = importPgnCollection(moves + ' 1/2-1/2\n' + invalidFen + '\n' + second);
  assert.equal(result.total, 3);
  assert.deepEqual(result.games, [importPgn(second)]);
  assert.deepEqual(result.rejected.map(game => game.index), [1, 2]);
  assert.match(result.rejected[0].message, /too long/);
  assert.match(result.rejected[1].message, /invalid PGN/);
});

test('imports custom standard starts and underpromotions by both colors unchanged', () => {
  const promotion = '[Event "Promotions"]\n[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/7p/4K3 w - - 0 27"]\n[Result "1/2-1/2"]\n\n27. a8=N h1=R+ 28. Kf2 1/2-1/2';
  const result = importPgnCollection(promotion + '\n' + second);
  assert.equal(result.total, 2);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.games[0], importPgn(promotion));
  assert.deepEqual(parseGame(result.games[0].pgn).moves.slice(0, 2).map(move => [move.color, move.promotion]), [['w', 'n'], ['b', 'r']]);
});


test('file boundaries keep a later headerless game after an incomplete or unclosed file', () => {
  const valid = '1. d4 d5 1-0';
  for (const broken of ['1. e4 e5', '[Event "Unclosed tag', '1. e4 {Unclosed comment with [Event "Fake"] 0-1']) {
    const result = importPgnFiles([broken, valid]);
    assert.equal(result.total, 2);
    assert.deepEqual(result.games, [importPgn(valid)]);
    assert.deepEqual(result.rejected.map(game => game.index), [1]);
  }
});

test('file imports combine record failures and count empty or comment-only files once', () => {
  const unfinished = '[Event "Unfinished"]\n[Result "*"]\n\n1. e4 e5 *';
  const illegal = '[Event "Illegal"]\n[Result "1-0"]\n\n1. e5 e4 1-0';
  const result = importPgnFiles([first + '\n' + unfinished, '', '{Only export notes}\n; no games', illegal + '\n' + second]);
  assert.equal(result.total, 6);
  assert.deepEqual(result.games, [importPgn(first), importPgn(second)]);
  assert.deepEqual(result.rejected.map(game => game.index), [2, 3, 4, 5]);
  assert.match(result.rejected[0].message, /completed/);
  assert.match(result.rejected[1].message, /no games/);
  assert.match(result.rejected[2].message, /no games/);
  assert.match(result.rejected[3].message, /invalid PGN/);
});

test('file imports enforce one aggregate game cap including empty files and invalid games', () => {
  const valid = Array(99).fill('1. e4 e5 1-0').join('\n');
  const exact = importPgnFiles([valid, '']);
  assert.equal(exact.total, 100);
  assert.equal(exact.games.length, 99);
  assert.deepEqual(exact.rejected.map(game => game.index), [100]);
  assert.throws(() => importPgnFiles([valid, '', '1. e4 e5 *']), /up to 100 games/);
});

test('file imports reject the aggregate UTF-8 byte limit before importing any file', () => {
  const half = 'é'.repeat(PGN_IMPORT_MAX_BYTES / 4);
  assert.throws(() => importPgnFiles([half, half + ' ']), /5 MiB/);
  assert.throws(() => importPgnFiles([first, 'a'.repeat(PGN_IMPORT_MAX_BYTES)]), /5 MiB/);
  for (const input of [null, [], '1. e4 e5 1-0', [first, null]]) assert.throws(() => importPgnFiles(input), /PGN file/);
});
