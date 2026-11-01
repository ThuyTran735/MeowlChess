import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRecentGames, fetchGameFromArchives, isCompletedGame } from '../extension/lib/archive.js';
import { fetchGames } from '../extension/lib/games.js';

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

test('exact lookup finds an older-ranked game in a full month with more than fifty games', async t => {
  const target = complete({ url: 'https://www.chess.com/game/live/186131404952' });
  const games = Array.from({ length: 53 }, (_, i) => complete({ url: `https://www.chess.com/game/live/${9000 + i}`, end_time: 1700002000 - i }));
  games[30] = target;
  const calls = []; let outstanding = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(outstanding++, 0, 'Exact archive requests must remain serial.');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    calls.push(url); await Promise.resolve(); outstanding--;
    return { ok: true, status: 200, json: async () => url.endsWith('/archives') ? { archives: [archive('10')] } : { games } };
  });
  assert.deepEqual(await fetchGameFromArchives(' Alice ', target.url), [target]);
  assert.deepEqual(calls, ['https://api.chess.com/pub/player/alice/games/archives', archive('10')]);
});

test('exact lookup searches beyond three months despite many newer completed games', async t => {
  const target = complete();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => url.endsWith('/archives') ? { archives: ['01','02','03','04','05','06','06'].map(archive) } : { games: url === archive('01') ? [target] : Array.from({length:60},(_,i)=>complete({url:`https://www.chess.com/game/live/${1000+i}`})) } };
  });
  assert.deepEqual(await fetchGameFromArchives('alice', target.url), [target]);
  assert.deepEqual(calls.slice(1), ['06','05','04','03','02','01'].map(archive));
});

test('exact lookup never substitutes a newer game or accepts an unfinished target', async t => {
  let target = null;
  t.mock.method(globalThis, 'fetch', async url => ({ ok:true, status:200, json:async()=>url.endsWith('/archives') ? {archives:[archive('10')]} : {games:[complete({url:'https://www.chess.com/game/live/999'}), ...(target ? [target] : [])]} }));
  assert.deepEqual(await fetchGameFromArchives('alice', complete().url), []);
  for (const extra of [{rules:'chess960'}, {pgn:'[Result "*"]\n\n1. e4 *'}, {black:{username:'Bob',result:'win'}}, {end_time:Date.now()/1000+60}]) {
    target = complete(extra); assert.deepEqual(await fetchGameFromArchives('alice',target.url),[]);
  }
});

test('exact lookup validates usernames and canonical site targets before any request', async t => {
  t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not fetch');});
  for (const username of ['', 'a', '../alice', null]) await assert.rejects(fetchGameFromArchives(username,complete().url),/username/);
  for (const url of [null,'https://lichess.org/Abcdef12','https://www.chess.com/game/123','https://chess.com/game/live/123','https://www.chess.com/game/live/123?move=5','https://www.chess.com/game/live/123#1','https://www.chess.com/game/live/123/','https://user@www.chess.com/game/live/123','https://www.chess.com.evil.test/game/live/123']) {
    await assert.rejects(fetchGameFromArchives('alice',url),/Chess.com game link/);
  }
});

test('exact lookup rejects unsafe archive indexes and propagates a failed month without skipping it', async t => {
  const calls = [];
  let listing = {archives:['https://evil.test/archive']}, status = 200, body = {games:[]};
  t.mock.method(globalThis,'fetch',async url=>{calls.push(url);return {ok:url.endsWith('/archives')||status===200,status:url.endsWith('/archives')?200:status,json:async()=>url.endsWith('/archives')?listing:body};});
  await assert.rejects(fetchGameFromArchives('alice',complete().url),/invalid archive list/);assert.equal(calls.length,1);
  listing={archives:['01','02'].map(archive)};status=429;calls.length=0;
  await assert.rejects(fetchGameFromArchives('alice',complete().url),/too many requests/);assert.deepEqual(calls.slice(1),[archive('02')]);
  status=200;body={games:'invalid'};calls.length=0;
  await assert.rejects(fetchGameFromArchives('alice',complete().url),/invalid game archive/);assert.equal(calls.length,2);
});

test('exact lookup clips the last request to the overall forty-five-second budget', async t => {
  let elapsed = 0; const delays = [], calls = [];
  const nativeTimeout = globalThis.setTimeout;
  t.mock.method(performance,'now',()=>elapsed);
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{delays.push(delay);return nativeTimeout(callback,0,...args);});
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push(url);
    if(url===archive('01')) return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    elapsed += 14000;
    return {ok:true,status:200,json:async()=>url.endsWith('/archives')?{archives:['01','02','03'].map(archive)}:{games:[]}};
  });
  await assert.rejects(fetchGameFromArchives('alice',complete().url),/took too long.*finished PGN/);
  assert.deepEqual(delays,[15000,15000,15000,3000]);assert.equal(calls.length,4);
});

test('exact lookup stops before another request when reading the archive consumed the budget', async t => {
  let elapsed=0,calls=0;t.mock.method(performance,'now',()=>elapsed);
  t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:true,status:200,json:async()=>{elapsed=45001;return {archives:[archive('01')]};}};});
  await assert.rejects(fetchGameFromArchives('alice',complete().url),/finished PGN/);assert.equal(calls,1);
});

test('game routing uses exact Chess.com archives only when a target is provided', async t => {
  const target=complete();const calls=[];
  const games=Array.from({length:53},(_,i)=>complete({url:`https://www.chess.com/game/live/${1000+i}`,end_time:1700002000-i}));games.push(target);
  t.mock.method(globalThis,'fetch',async url=>{calls.push(url);return {ok:true,status:200,json:async()=>url.endsWith('/archives')?{archives:[archive('10')]}:{games}};});
  const selected=await fetchGames('chesscom','alice',{gameUrl:target.url});assert.equal(selected.length,1);assert.equal(selected[0].source,'chesscom');assert.equal(selected[0].url,target.url);
  const recent=await fetchGames('chesscom','alice');assert.equal(recent.length,20);assert.equal(recent.some(game=>game.url===target.url),false);
});

test('game routing sends canonical Lichess targets to direct export and rejects cross-site targets', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{calls.push(url);assert.equal(options.credentials,'omit');return {ok:true,status:200,text:async()=>JSON.stringify({id:'Abcdef12',variant:'standard',status:'resign',lastMoveAt:1700000000000,winner:'white',players:{white:{user:{name:'Alice'}},black:{user:{name:'Bob'}}},pgn:complete().pgn})};});
  const selected=await fetchGames('lichess','alice',{gameUrl:'https://lichess.org/Abcdef12'});
  assert.equal(selected.length,1);assert.equal(selected[0].url,'https://lichess.org/Abcdef12');assert.match(calls[0],/^https:\/\/lichess\.org\/game\/export\/Abcdef12\?/);
  for(const gameUrl of [complete().url,'https://lichess.org/Abcdef12Priv','https://lichess.org/Abcdef12#3','http://lichess.org/Abcdef12',null]) await assert.rejects(fetchGames('lichess','alice',{gameUrl}),/Lichess game link/);
  await assert.rejects(fetchGames('chesscom','alice',{gameUrl:'https://lichess.org/Abcdef12'}),/Chess.com game link/);
  assert.equal(calls.length,1);
});

test('completed-game refresh revalidates every public Chess.com request without changing URLs or credentials', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, cache: options.cache });
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).search, '');
    return { ok: true, status: 200, json: async () => url.endsWith('/archives') ? { archives: [archive('10')] } : { games: [complete()] } };
  });
  await fetchGames('chesscom', 'alice', { gameUrl: complete().url, revalidate: true });
  await fetchGames('chesscom', 'alice', { revalidate: true });
  await fetchGames('chesscom', 'alice');
  assert.deepEqual(calls.map(call => call.cache), ['no-cache', 'no-cache', 'no-cache', 'no-cache', undefined, undefined]);
  assert.deepEqual(calls.map(call => call.url), Array(3).fill(['https://api.chess.com/pub/player/alice/games/archives', archive('10')]).flat());
});
