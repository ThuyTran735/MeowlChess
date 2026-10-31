import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteReviewBroker, createSiteReviewLibraryBridge, isChessComBotPage } from '../extension/lib/site-review.js';
import { createReviewLibrary, reviewIdForGame } from '../extension/lib/library.js';
import { ANALYSIS_VERSION, analyzeGame } from '../extension/lib/review.js';

const ID = 'bot-test';
const PAGE = 'https://www.chess.com/play/computer';
const pgn = '[Event "Computer game"]\n[White "Guest"]\n[Black "Martin"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const otherPgn = '[Event "Computer game"]\n[White "Guest"]\n[Black "Martin"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
const extensionUrl = path => `chrome-extension://${ID}/${path}`;
const content = (url = PAGE, tabId = 5) => ({ id: ID, frameId: 0, url, tab: { id: tabId, url } });
const frame = (token, url = PAGE, tabId = 5) => ({ id: ID, frameId: 2, url: extensionUrl(`site-summary.html#${token}`), tab: { id: tabId, url } });

function setup(options = {}) {
  let time = Date.now(), sequence = 0;
  const state = { settings: { siteReviewSettings: { chesscom: { enabled: true, username: 'Alice' } } }, permitted: true, fetches: 0, opened: [] };
  const broker = createSiteReviewBroker({
    extensionId: ID, extensionUrl, readSettings: async () => state.settings,
    hasPermission: async () => state.permitted,
    fetchGames: async () => { state.fetches++; return []; },
    openReview: async url => state.opened.push(url), now: () => time,
    makeToken: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, ...options,
  });
  return { broker, state, advance: ms => { time += ms; }, check: (sender = content()) => broker.handle({ type: 'meowl:site-check' }, sender),
    submit: (value = pgn, sender = content()) => broker.handle({ type: 'meowl:site-bot-import', pgn: value }, sender),
    payload: (token, sender = frame(token)) => broker.handle({ type: 'meowl:site-payload', token }, sender) };
}

test('bot routes are restricted to trusted computer play and saved computer game pages', () => {
  for (const path of ['/play/computer', '/play/computer/', '/play/computer/martin', '/play/computer/%E7%8C%AB', '/game/computer/private-bot-id', '/game/computer/123', '/analysis/game/computer/123?move=0']) {
    assert.equal(isChessComBotPage(`https://www.chess.com${path}`), true);
    assert.equal(isChessComBotPage(`https://chess.com${path}`), true);
  }
  for (const url of ['https://www.chess.com/play/online', 'https://www.chess.com/game/live/123', 'https://www.chess.com/play/computers', 'https://www.chess.com/game/computer/', 'https://evil.test/play/computer', 'https://lichess.org/play/computer', 'http://www.chess.com/play/computer', 'https://www.chess.com:99/play/computer', 'https://person@www.chess.com/play/computer', null]) assert.equal(isChessComBotPage(url), false);
});

test('bot checks never fetch or reuse the latest public human archive game', async () => {
  const { check, state } = setup({ fetchGames: async () => { throw new Error('Bot pages must never fetch the public archive.'); } });
  const reply = await check();
  assert.equal(reply.status, 'bot');
  assert.equal(reply.source, 'chesscom');
  assert.equal(reply.retryAfterMs, 60000);
  assert.match(reply.message, /private/);
  assert.equal((await check(content('https://www.chess.com/game/computer/private-bot-id'))).status, 'bot');
  assert.equal((await check(content('https://www.chess.com/play/computer/%E7%8C%AB'))).status, 'bot');
  assert.equal(state.fetches, 0);
});

test('completed Guest bot PGN creates an opaque frame-bound import job', async () => {
  const { submit, payload, check, state } = setup();
  const reply = await submit();
  assert.equal(reply.status, 'ready');
  assert.equal(reply.kind, 'bot');
  assert.equal(reply.gameUrl, `pgn:${await reviewIdForGame(pgn)}`);
  assert.equal(reply.gameKey, reply.gameUrl);
  assert.equal(JSON.stringify(reply).includes('Guest'), false);
  const data = await payload(reply.token);
  assert.equal(data.kind, 'bot');
  assert.equal(data.source, 'chesscom');
  assert.equal(data.game.source, 'pgn');
  assert.equal(data.game.imported, true);
  assert.equal(data.game.url, null);
  assert.equal(data.game.white.username, 'Guest');
  assert.equal(data.game.pgn, pgn);
  assert.equal((await check()).token, reply.token);
  assert.equal(state.fetches, 0);
});

test('imports reject unfinished, conflicting, illegal, empty, oversized, and variant games', async () => {
  const { submit, check } = setup();
  for (const value of [null, '', {}, pgn.replace(/0-1/g, '*'), pgn.replace('Qh4# 0-1', 'Qh4# *'), pgn.replace('Qh4# 0-1', 'Qh4# 1-0'), pgn.replace('1. f3 e5', '1. f5 e4'), pgn.replace('1. f3 e5 2. g4 Qh4#', ''), '[Variant "Chess960"]\n' + pgn, pgn + ' '.repeat(250001), pgn.replace('1. f3', `{${'猫'.repeat(90000)}} 1. f3`), `${pgn}\n\n${otherPgn}`]) {
    const reply = await submit(value);
    assert.equal(reply.status, 'error', `Unexpected acceptance: ${String(value).slice(0, 80)}`);
    assert.equal((await check()).status, 'bot');
  }
});

test('imports accept only the enabled, permitted, top-frame content sender on a bot page', async () => {
  const { submit, state } = setup();
  for (const sender of [content('https://www.chess.com/play/online'), content('https://www.chess.com/game/live/123'), content('https://lichess.org/Abcdef12'), content('https://evil.test/play/computer'), { ...content(), frameId: 1 }, { ...content(), id: 'other' }, { ...content(), tab: { id: -1, url: PAGE } }, { ...content(), tab: { id: 5, url: 'https://chess.com/play/computer' } }, { ...content(), tab: { id: 5 } }, frame('00000000-0000-4000-8000-000000000001')]) assert.equal((await submit(pgn, sender)).status, 'disabled');
  state.permitted = false;
  assert.equal((await submit()).status, 'disabled');
  state.permitted = true; state.settings.siteReviewSettings.chesscom.enabled = false;
  assert.equal((await submit()).status, 'disabled');
  assert.equal(state.fetches, 0);
});

test('SPA bot imports use the browser current URL, not the stale content-document URL', async () => {
  const { submit, payload } = setup();
  const sender = { ...content('https://www.chess.com/play/online'), tab: { id: 5, url: PAGE } };
  const reply = await submit(pgn, sender);
  assert.equal(reply.status, 'ready');
  assert.equal((await payload(reply.token)).status, 'ready');
  assert.equal((await submit(pgn, { ...content(), tab: { id: 5, url: 'https://www.chess.com/play/online' } })).status, 'disabled');
});

test('canonical same-game import reuses its handle; a new game replaces the old handle', async () => {
  const { submit, payload } = setup();
  const first = await submit();
  const same = await submit(pgn.replace('1. f3', '{A comment}\n1. f3'));
  assert.equal(same.token, first.token);
  const next = await submit(otherPgn);
  assert.notEqual(next.token, first.token);
  assert.equal((await payload(first.token)).status, 'expired');
  assert.equal((await payload(next.token)).game.pgn, otherPgn);
});

test('a bot handle is bound to its frame, tab, selected game, origin, settings, and expiry', async () => {
  const { submit, payload, state, advance } = setup();
  const { token } = await submit();
  for (const sender of [content(), frame(token, PAGE, 6), frame(token, 'https://www.chess.com/game/computer/another'), frame(token, 'https://chess.com/play/computer'), { ...frame(token), frameId: 0 }, { ...frame(token), id: 'other' }]) assert.equal((await payload(token, sender)).status, 'expired');
  state.settings.siteReviewSettings.chesscom.username = 'Bob';
  assert.equal((await payload(token)).status, 'expired');
  state.settings.siteReviewSettings.chesscom.username = 'Alice';
  state.permitted = false;
  assert.equal((await payload(token)).status, 'expired');
  state.permitted = true; advance(600001);
  assert.equal((await payload(token)).status, 'expired');
});

test('release clears bot jobs, while browsing preserves their completed import identity', async () => {
  const { submit, payload, check, broker, state } = setup();
  const first = await submit();
  assert.equal((await broker.handle({ type: 'meowl:site-release', token: first.token, panelGeneration: first.panelGeneration }, content())).status, 'released');
  assert.equal((await payload(first.token)).status, 'expired');
  assert.equal((await check()).status, 'bot');
  const second = await submit();
  broker.pageChanged(5, 'https://www.chess.com/play/online');
  const carried = await check(content('https://www.chess.com/play/online'));
  assert.equal(carried.token, second.token);
  assert.equal(carried.kind, 'bot');
  assert.equal((await payload(second.token, frame(second.token, 'https://www.chess.com/play/online'))).game.pgn, pgn);
  broker.pageChanged(5, 'https://www.chess.com/game/computer/another');
  assert.equal((await payload(second.token)).status, 'expired');
  assert.equal(state.fetches, 0);
});

test('bot jobs survive a worker restart, including Guest player and opaque identity', async () => {
  let saved;
  const persistence = { readSession: async () => structuredClone(saved), writeSession: async value => { saved = structuredClone(value); } };
  const first = setup(persistence);
  const ready = await first.submit();
  assert.equal(saved.jobs.length, 1);
  assert.equal(saved.cache.length, 0);
  const second = setup(persistence);
  assert.equal((await second.payload(ready.token)).game.pgn, pgn);
  assert.equal((await second.check()).token, ready.token);
  assert.equal(second.state.fetches, 0);
});

test('restoring bot jobs rejects changed identity, source, route, result, timestamp, and account', async () => {
  let saved;
  const first = setup({ writeSession: async value => { saved = structuredClone(value); } });
  const ready = await first.submit();
  for (const mutate of [
    item => { item.gameKey = `pgn:game-${'f'.repeat(64)}`; },
    item => { item.game.pgn = otherPgn; },
    item => { item.game.pgn = pgn.replace('Qh4# 0-1', 'Qh4# *'); },
    item => { item.game.source = 'chesscom'; },
    item => { item.game.imported = false; },
    item => { item.game.url = 'https://www.chess.com/game/live/123'; },
    item => { item.selectionPageKey = 'https://www.chess.com/play/online'; },
    item => { item.game.end_time = Date.now() / 1000 + 300; },
    item => { item.game.end_time = -1; },
    item => { item.expiresAt = Date.now() - 1; },
    item => { delete item.kind; },
  ]) {
    const snapshot = structuredClone(saved); mutate(snapshot.jobs[0]);
    const next = setup({ readSession: async () => snapshot });
    assert.equal((await next.payload(ready.token)).status, 'expired');
  }
  const revoked = setup({ readSession: async () => structuredClone(saved) }); revoked.state.permitted = false;
  assert.equal((await revoked.payload(ready.token)).status, 'expired');
  const changed = setup({ readSession: async () => structuredClone(saved) }); changed.state.settings.siteReviewSettings.chesscom.username = 'Bob';
  assert.equal((await changed.payload(ready.token)).status, 'expired');
});

test('navigation or settings revocation while bot import is pending prevents a late job', async () => {
  for (const invalidate of ['page', 'source', 'all', 'account']) {
    let release, calls = 0, fixture;
    fixture = setup({ readSettings: async () => { if (++calls === 2) await new Promise(resolve => { release = resolve; }); return fixture.state.settings; } });
    const pending = fixture.submit();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    if (invalidate === 'page') fixture.broker.pageChanged(5, 'https://www.chess.com/play/online');
    if (invalidate === 'source') fixture.broker.invalidateSource('chesscom');
    if (invalidate === 'all') fixture.broker.invalidate();
    if (invalidate === 'account') fixture.state.settings.siteReviewSettings.chesscom.username = 'Bob';
    release();
    assert.equal((await pending).status, 'disabled');
    assert.equal((await fixture.check()).status, 'bot');
  }
});

test('an unrelated exact game during worker restore cannot resurrect the old bot job', async () => {
  let saved, release;
  const first = setup({ writeSession: async value => { saved = structuredClone(value); } });
  const { token } = await first.submit();
  const next = setup({ readSession: () => new Promise(resolve => { release = resolve; }) });
  const pending = next.payload(token);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  next.broker.pageChanged(5, 'https://www.chess.com/game/live/456');
  release(saved);
  assert.equal((await pending).status, 'expired');
});

test('bot reviews save and reopen through the existing validated local library', async () => {
  const records = new Map();
  const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION, store: {
    read: async id => structuredClone(records.get(id) || null), readAll: async () => structuredClone([...records.values()]),
    transact: async update => { const changes = update(structuredClone([...records.values()])); for (const value of changes.put || []) records.set(value.id, structuredClone(value)); return structuredClone(changes.value); },
  } });
  const { broker, submit } = setup(createSiteReviewLibraryBridge({ library, idForGame: reviewIdForGame }));
  const { token } = await submit();
  const result = await analyzeGame(pgn, { smartAnalysis: true, moveTimeMs: 50, multiPV: 1, engineFactory: () => ({
    async init() {}, dispose() {}, async evaluate() { return { cp: 0, mate: null, bestMove: null, pv: [], candidates: [], depth: 8 }; },
  }) });
  const saved = await broker.handle({ type: 'meowl:site-save-review', token, result }, frame(token));
  assert.equal(saved.status, 'saved', saved.message);
  assert.equal(saved.record.game.source, 'pgn');
  assert.equal(saved.record.game.white.username, 'Guest');
  assert.equal(saved.record.id, await reviewIdForGame(pgn));
  assert.equal(records.size, 1);
  const loaded = await broker.handle({ type: 'meowl:site-load-review', token }, frame(token));
  assert.equal(loaded.record.id, saved.record.id);
  assert.equal(loaded.record.stale, false);
  assert.equal((await broker.handle({ type: 'meowl:site-save-review', token, result: {} }, content())).status, 'expired');
});
