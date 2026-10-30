import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRecentGames, isCompletedGame } from '../extension/lib/archive.js';

const archive = (month) => `https://api.chess.com/pub/player/alice/games/2026/${month}`;
const complete = (overrides = {}) => ({
  url: 'https://www.chess.com/game/live/123', rules: 'chess', end_time: 1700000000,
  pgn: '[Result "1-0"]\n\n1. e4 e5 1-0',
  white: { username: 'Alice', result: 'win' }, black: { username: 'Bob', result: 'resigned' },
  ...overrides,
});

test('only accepts consistently completed standard games and safe game links', () => {
  assert.equal(isCompletedGame(complete()), true);
  for (const overrides of [
    { rules: 'chess960' }, { end_time: Date.now() / 1000 + 3600 }, { end_time: '1700000000' },
    { pgn: '[Result "*"]\n\n1. e4 *' }, { pgn: '[Result "1-0"]\n\n1. e4 *' },
    { pgn: '[Result "1-0"]\n\n1. e4 0-1' }, { pgn: '[Result "1-0"]\n\n1. e4' },
    { black: { username: 'Bob', result: 'win' } }, { white: { username: 'Alice', result: 'ongoing' } },
    { url: 'javascript:alert(1)' }, { url: 'https://www.chess.com.evil.test/game/live/123' },
    { url: 'https://www.chess.com/game/live/123?redirect=evil' }, { url: 'https://other@www.chess.com/game/live/123' },
  ]) assert.equal(isCompletedGame(complete(overrides)), false, JSON.stringify(overrides));
  assert.equal(isCompletedGame(null), false);
});

test('accepts black wins and final draws', () => {
  assert.equal(isCompletedGame(complete({ pgn: '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1', white: { username: 'Alice', result: 'checkmated' }, black: { username: 'Bob', result: 'win' } })), true);
  assert.equal(isCompletedGame(complete({ pgn: '[Result "1/2-1/2"]\n\n1. e4 e5 1/2-1/2', white: { username: 'Alice', result: 'agreed' }, black: { username: 'Bob', result: 'agreed' } })), true);
});

test('loads latest monthly archives sequentially, filters, sorts, and caps games', async (t) => {
  const calls = [];
  let outstanding = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(outstanding, 0, 'Requests must be serial');
    outstanding++;
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    await Promise.resolve();
    outstanding--;
    const body = url.endsWith('/archives') ? { archives: [archive('01'), archive('03'), archive('02')] } : url === archive('03') ? { games: [complete({ rules: 'chess960' }), ...Array.from({ length: 10 }, (_, i) => complete({ url: `https://www.chess.com/game/live/${300 + i}`, end_time: 1700001000 + i }))] } : { games: Array.from({ length: 15 }, (_, i) => complete({ url: `https://www.chess.com/game/live/${200 + i}`, end_time: 1700000000 + i })) };
    return { ok: true, status: 200, json: async () => body };
  });
  const games = await fetchRecentGames(' Alice ');
  assert.deepEqual(calls, ['https://api.chess.com/pub/player/alice/games/archives', archive('03'), archive('02')]);
  assert.equal(games.length, 20);
  assert.equal(games[0].end_time, 1700001009);
});

test('checks at most three archives and returns empty list for no completed games', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => url.endsWith('/archives') ? { archives: ['01', '02', '03', '04'].map(archive) } : { games: [] } };
  });
  assert.deepEqual(await fetchRecentGames('alice'), []);
  assert.equal(calls.length, 4);
  assert.equal(calls.at(-1), archive('02'));
});

test('rejects invalid usernames before accessing the network', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  for (const username of ['', 'a', '../alice', 'alice@test', 'a'.repeat(51), null]) {
    await assert.rejects(fetchRecentGames(username), /username/);
  }
});

test('rejects untrusted archive URLs without following them', async (t) => {
  const urls = ['https://evil.test/pub/player/alice/games/2026/01', 'https://api.chess.com/pub/player/bob/games/2026/01', `${archive('01')}?extra=1`, `${archive('01')}#hash`, 'https://user@api.chess.com/pub/player/alice/games/2026/01', archive('13')];
  for (const badUrl of urls) {
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: true, status: 200, json: async () => ({ archives: [badUrl] }) }; });
    await assert.rejects(fetchRecentGames('alice'), /invalid archive list/);
    assert.equal(calls, 1);
    mock.mock.restore();
  }
});

test('reports missing usernames, rate limits, network failures, and unreadable data', async (t) => {
  for (const [status, pattern] of [[404, /could not find/], [429, /too many requests/], [503, /HTTP 503/]]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status }));
    await assert.rejects(fetchRecentGames('alice'), pattern);
    mock.mock.restore();
  }
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network failure'); });
  await assert.rejects(fetchRecentGames('alice'), /internet connection/);
  network.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }));
  await assert.rejects(fetchRecentGames('alice'), /unreadable/);
});
