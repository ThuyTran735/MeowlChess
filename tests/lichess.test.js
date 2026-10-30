import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLichessGames, normalizeLichessGame } from '../extension/lib/lichess.js';
import { fetchGames, importPgn, safeOriginalGameUrl } from '../extension/lib/games.js';

const PGN = '[Event "Casual game"]\n[Site "https://lichess.org/AbCd1234"]\n[White "Alice"]\n[Black "Bob"]\n[UTCDate "2024.03.02"]\n[UTCTime "14:30:00"]\n[WhiteElo "1500"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
const complete = (overrides = {}) => ({ id: 'AbCd1234', variant: 'standard', speed: 'blitz', status: 'resign', lastMoveAt: 1709389800000, winner: 'white', players: { white: { user: { name: 'Alice' }, rating: 1500 }, black: { user: { name: 'Bob' }, rating: 1600 } }, pgn: PGN, ...overrides });
const reply = (data, single = false) => ({ ok: true, status: 200, text: async () => single ? JSON.stringify(data) : data.map(game => JSON.stringify(game)).join('\n') + '\n' });

test('normalizes completed Lichess games to the existing review shape', () => {
  const game = normalizeLichessGame(complete());
  assert.equal(game.source, 'lichess');
  assert.equal(game.imported, false);
  assert.equal(game.rules, 'chess');
  assert.equal(game.url, 'https://lichess.org/AbCd1234');
  assert.equal(game.end_time, 1709389800);
  assert.equal(game.white.result, 'win');
  assert.equal(game.black.result, 'lose');
  assert.equal(game.black.rating, 1600);
});

test('rejects live, aborted, nonstandard, mismatched and malformed API games', () => {
  for (const change of [
    { status: 'created' }, { status: 'started' }, { status: 'aborted' }, { status: 'noStart' },
    { variant: 'chess960' }, { variant: 'fromPosition' }, { winner: 'black' }, { winner: undefined },
    { status: 'draw' }, { status: 'stalemate' }, { lastMoveAt: Date.now() + 60000 },
    { lastMoveAt: '1709389800000' }, { lastMoveAt: 0 }, { id: '../evil' }, { players: {} },
    { pgn: PGN.replace(/1-0/g, '*') }, { pgn: PGN.replace(/1-0$/, '*') },
    { pgn: PGN.replace(/1-0$/, '0-1') }, { pgn: PGN.replace('2. Nf3', '2. Nf6') },
  ]) assert.equal(normalizeLichessGame(complete(change)), null, JSON.stringify(change));
  assert.equal(normalizeLichessGame(null), null);
});

test('supports completed draws, black wins and computer opponents', () => {
  const draw = normalizeLichessGame(complete({ status: 'draw', winner: undefined, pgn: PGN.replace(/1-0/g, '1/2-1/2') }));
  assert.equal(draw.white.result, 'agreed');
  assert.equal(draw.black.result, 'agreed');
  const win = normalizeLichessGame(complete({ winner: 'black', pgn: PGN.replace(/1-0/g, '0-1'), players: { white: {}, black: { aiLevel: 5 } } }));
  assert.equal(win.black.username, 'Stockfish level 5');
  assert.equal(win.black.result, 'win');
});

test('requests only finished standard Lichess games and filters, sorts and deduplicates', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (value, options) => {
    count++;
    const url = new URL(value);
    assert.equal(url.origin, 'https://lichess.org');
    assert.equal(url.pathname, '/api/games/user/Alice');
    assert.equal(url.searchParams.get('max'), '20');
    assert.equal(url.searchParams.get('ongoing'), 'false');
    assert.equal(url.searchParams.get('finished'), 'true');
    assert.equal(url.searchParams.get('pgnInJson'), 'true');
    assert.ok(!url.searchParams.get('perfType').includes('chess960'));
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Accept, 'application/x-ndjson');
    return reply([complete(), complete(), complete({ status: 'started' }), complete({ id: 'Next1234', lastMoveAt: 1709390000000 })]);
  });
  const games = await fetchGames('lichess', ' Alice ');
  assert.equal(count, 1);
  assert.equal(games.length, 2);
  assert.equal(games[0].url, 'https://lichess.org/Next1234');
});

test('accepts a public game link while discarding viewpoint and move fragment', async t => {
  t.mock.method(globalThis, 'fetch', async (value, options) => {
    assert.equal(new URL(value).pathname, '/game/export/AbCd1234');
    assert.equal(options.headers.Accept, 'application/json');
    return reply(complete(), true);
  });
  assert.equal((await fetchLichessGames('https://lichess.org/AbCd1234/black#23'))[0].url, 'https://lichess.org/AbCd1234');
});

test('single-game export refuses unfinished games even if a response is otherwise valid', async t => {
  t.mock.method(globalThis, 'fetch', async () => reply(complete({ status: 'started' }), true));
  await assert.rejects(fetchLichessGames('https://lichess.org/AbCd1234'), /Only completed standard/);
});

test('rejects invalid usernames and unsafe or unsupported URLs before fetching', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  for (const value of ['', 'a', null, '../alice', 'a'.repeat(31), 'alice@test', 'https://lichess.org.evil.test/AbCd1234', 'http://lichess.org/AbCd1234', 'https://user@lichess.org/AbCd1234', 'https://lichess.org/AbCd1234?x=1', 'https://lichess.org/AbCd1234xxxx', 'https://lichess.org/@/Alice', 'https://www.chess.com/game/live/123']) {
    await assert.rejects(fetchLichessGames(value), /username|game link/);
  }
  await assert.rejects(fetchGames('unknown', 'Alice'), /Choose Chess.com or Lichess/);
});

test('reports API failures and does not silently accept malformed NDJSON', async t => {
  for (const [status, expected] of [[404, /could not find/], [429, /too many requests/], [503, /HTTP 503/]]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status }));
    await assert.rejects(fetchLichessGames('Alice'), expected);
    mock.mock.restore();
  }
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Connection failed'); });
  await assert.rejects(fetchLichessGames('Alice'), /internet connection/);
  network.mock.restore();
  for (const body of ['not JSON', '{}\n{bad}', 'null', '[]', 'x'.repeat(6000001)]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, text: async () => body }));
    await assert.rejects(fetchLichessGames('Alice'), /unreadable|too much/);
    mock.mock.restore();
  }
});

test('decodes streamed UTF-8 NDJSON and returns an empty list for no eligible games', async t => {
  const data = JSON.stringify(complete({ players: { white: { user: { name: 'Alïce' } }, black: {} } })) + '\n';
  const bytes = new TextEncoder().encode(data);
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17)); controller.close(); } })));
  assert.equal((await fetchLichessGames('Alice'))[0].white.username, 'Alïce');
});

test('imports one completed PGN with annotations and preserves useful metadata', () => {
  const game = importPgn('\uFEFF' + PGN.replace('1. e4 e5', '1. e4 {Good move} e5 (1... c5)') + ' {Finished}');
  assert.equal(game.source, 'pgn');
  assert.equal(game.imported, true);
  assert.equal(game.white.username, 'Alice');
  assert.equal(game.white.rating, 1500);
  assert.equal(game.black.username, 'Bob');
  assert.equal(game.url, 'https://lichess.org/AbCd1234');
  assert.equal(game.end_time, Date.parse('2024-03-02T14:30:00Z') / 1000);
  assert.equal(game.time_class, 'imported');
});

test('imports headerless finished movetext without inventing a game date or link', () => {
  const game = importPgn('1. e4 e5 2. Nf3 1-0');
  assert.equal(game.white.username, 'White');
  assert.equal(game.black.username, 'Black');
  assert.equal(game.white.result, 'win');
  assert.equal(game.end_time, null);
  assert.equal(game.url, null);
});

test('rejects incomplete, conflicting, multiple-game, oversized and nonstandard PGNs', () => {
  for (const value of ['', null, PGN.replace(/1-0$/, '*'), PGN.replace(/1-0$/, ''), PGN.replace(/1-0$/, '0-1'), PGN + '\n\n' + PGN, 'x'.repeat(250001), '[Variant "Chess960"]\n' + PGN]) assert.throws(() => importPgn(value));
  assert.equal(importPgn(PGN.replace('2024.03.02', '2024.02.31')).end_time, null);
  assert.equal(importPgn(PGN.replace('2024.03.02', '9999.12.31')).end_time, null);
});

test('only exposes safe original-game links from PGN headers', () => {
  assert.equal(safeOriginalGameUrl('https://chess.com/game/live/123'), 'https://www.chess.com/game/live/123');
  assert.equal(safeOriginalGameUrl('https://lichess.org/AbCd1234/white#20'), 'https://lichess.org/AbCd1234');
  for (const value of [undefined, 'javascript:alert(1)', 'https://evil.test/AbCd1234', 'https://lichess.org.evil.test/AbCd1234', 'https://user@lichess.org/AbCd1234', 'https://lichess.org/AbCd1234?redirect=evil', 'https://www.chess.com/game/live/123#evil']) assert.equal(safeOriginalGameUrl(value), null);
  const game = importPgn(PGN.replace('https://lichess.org/AbCd1234', 'javascript:alert(1)'));
  assert.equal(game.url, null);
});

test('checks adjacent PGN Result tags before chess.js can overwrite them from movetext', () => {
  const movetext = '\n\n1. e4 e5 1-0';
  for (const tags of [
    '[Result "*"] [White "Alice"]',
    '[White "Alice"] [Result "0-1"]',
    '[Result"*"][White"Alice"]',
    '[ Result "0-1" ][ White "Alice" ]',
  ]) assert.throws(() => importPgn(tags + movetext), /do not match/);
  for (const tags of [
    '[Result "1-0"] [Result "1-0"]',
    '[Result "*"][Result "1-0"]',
    '[Result "1-0"]\n[Result "1-0"]',
  ]) assert.throws(() => importPgn(tags + movetext), /one completed game/);
  const game = importPgn('[Event "Casual game"][White "Alice"] [Result "1-0"]' + movetext);
  assert.equal(game.white.username, 'Alice');
  assert.equal(game.white.result, 'win');
});

test('does not treat tag-looking text in comments or variations as game headers', () => {
  const game = importPgn('[White "Alice"] [Result "1-0"]\n\n1. e4 { [Result "0-1"] } e5 (1... c5 { [Result "*"] 0-1 }) 2. Nf3 ; [Result "*"]\n1-0 { [Result "0-1"] }');
  assert.equal(game.white.username, 'Alice');
  assert.equal(game.white.result, 'win');
  // The trailing variation has no mainline result: its text cannot finish the game.
  assert.throws(() => importPgn('[Result "1-0"]\n\n1. e4 e5 (1... c5 { 1-0 })'), /Only completed/);
});
