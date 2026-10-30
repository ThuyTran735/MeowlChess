import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteReviewBroker, createSiteReviewLibraryBridge, normalizeSiteSettings, normalizeSiteAnalysis, providerForUrl, gameUrlForPage, completedSiteGames } from '../extension/lib/site-review.js';
import { createReviewLibrary, reviewIdForGame } from '../extension/lib/library.js';
import { ANALYSIS_VERSION, analyzeGame } from '../extension/lib/review.js';

const ID = 'meowl-test';
const page = 'https://www.chess.com/home';
const extensionUrl = path => `chrome-extension://${ID}/${path}`;
const completedPgn = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
const game = (id = '123', extra = {}) => ({
  source: 'chesscom', rules: 'chess', url: `https://www.chess.com/game/live/${id}`,
  pgn: completedPgn, end_time: 1700000000,
  white: { username: 'Alice', result: 'win' }, black: { username: 'Bob', result: 'resigned' }, ...extra,
});
const content = (url = page, tabId = 5) => ({ id: ID, frameId: 0, url, tab: { id: tabId, url } });
const frame = (url = page, tabId = 5) => ({ id: ID, frameId: 2, url: extensionUrl('site-summary.html?token=test'), tab: { id: tabId, url } });

function setup(options = {}) {
  let clock = Date.now(), token = 0;
  const state = {
    settings: { siteReviewSettings: { chesscom: { enabled: true, username: 'Alice' }, lichess: { enabled: true, username: 'Alice' } } },
    permitted: true, calls: [], opened: [],
  };
  const broker = createSiteReviewBroker({
    extensionId: ID, extensionUrl, readSettings: async () => state.settings,
    hasPermission: async () => state.permitted,
    fetchGames: async (source, username) => { state.calls.push([source, username]); return [game()]; },
    openReview: async url => state.opened.push(url), now: () => clock, makeToken: () => `00000000-0000-4000-8000-${String(++token).padStart(12, '0')}`, ...options,
  });
  return { broker, state, advance: ms => { clock += ms; }, check: (sender = content()) => broker.handle({ type: 'meowl:site-check' }, sender) };
}

function bridgeFixture() {
  const records = new Map();
  let writes = 0;
  const copy = value => structuredClone(value);
  const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION, store: {
    read: async id => copy(records.get(id) || null),
    readAll: async () => copy([...records.values()]),
    transact: async update => {
      const changes = update(copy([...records.values()]));
      for (const value of changes.put || []) { records.set(value.id, copy(value)); writes++; }
      return copy(changes.value);
    },
  } });
  return { library, records, writes: () => writes, bridge: createSiteReviewLibraryBridge({ library, idForGame: reviewIdForGame }) };
}

const finishedResult = () => analyzeGame(completedPgn, { smartAnalysis: true, moveTimeMs: 50, multiPV: 1, engineFactory: () => ({
  async init() {}, dispose() {},
  async evaluate() { return { cp: 0, mate: null, bestMove: null, pv: [], candidates: [], depth: 8 }; },
}) });

test('page review settings are opt-in, provider-specific, and accept usernames only', () => {
  assert.deepEqual(normalizeSiteSettings(), { chesscom: { enabled: false, username: '' }, lichess: { enabled: false, username: '' } });
  assert.deepEqual(normalizeSiteSettings({ chesscom: { enabled: true, username: '  ALIce_1 ' }, lichess: { enabled: true, username: 'https://lichess.org/alice' } }), {
    chesscom: { enabled: true, username: 'alice_1' }, lichess: { enabled: false, username: '' },
  });
  assert.equal(normalizeSiteSettings({ lichess: { enabled: 'true', username: 'Alice' } }).lichess.enabled, false);
  assert.equal(normalizeSiteSettings({ lichess: { enabled: true, username: 'a'.repeat(31) } }).lichess.enabled, false);
});

test('only trusted HTTPS origins are eligible and page URLs remove player secrets', () => {
  assert.equal(providerForUrl('https://www.chess.com/play/online'), 'chesscom');
  assert.equal(providerForUrl('https://lichess.org/'), 'lichess');
  for (const url of ['http://lichess.org/abcdefgh', 'https://lichess.org.evil.test/', 'https://www.chess.com:444/', 'https://person@lichess.org/', 'javascript:alert(1)', null]) assert.equal(providerForUrl(url), null);
  assert.equal(gameUrlForPage('https://chess.com/analysis/game/live/123?move=20#review'), 'https://www.chess.com/game/live/123');
  assert.equal(gameUrlForPage('https://www.chess.com/game/daily/456/'), 'https://www.chess.com/game/daily/456');
  assert.equal(gameUrlForPage('https://lichess.org/Abcdef12wXyZ/black?token=secret#18'), 'https://lichess.org/Abcdef12');
  for (const path of ['analysis', 'training', 'practice', 'features', 'settings', 'registration', 'abcdefgh/anything', 'abc', 'abcdefghijk', 'abcdefghijklm', 'study/abcdefgh']) assert.equal(gameUrlForPage(`https://lichess.org/${path}`), null);
});

test('page analysis uses a fast default and clamps engine options to supported values', () => {
  assert.deepEqual({ ...normalizeSiteAnalysis(), analysisVersion: 'version' }, { engineId: 'stockfish', engineName: 'Stockfish 18', moveTimeMs: 50, multiPV: 1, smartAnalysis: true, analysisVersion: 'version' });
  assert.equal(normalizeSiteAnalysis({ engine: 'lozza', time: '1500', lines: '3', smart: false }).multiPV, 1);
  assert.equal(normalizeSiteAnalysis({ engine: 'lozza', time: '1500', lines: '3', smart: false }).smartAnalysis, false);
  assert.equal(normalizeSiteAnalysis({ engine: 'evil', time: 100000, lines: -1 }).moveTimeMs, 50);
});

test('archives need the configured player, legal completed PGN, trustworthy URL, and past timestamp', () => {
  const entries = [game(), game('124', { end_time: 1700000001 }), game('125', { white: { username: 'Someone', result: 'win' } }),
    game('126', { pgn: completedPgn.replace('1. e4 e5 1-0', '1. e4 e5 *') }),
    game('127', { pgn: completedPgn.replace('1. e4 e5', '1. e5 e4') }),
    game('128', { end_time: Date.now() / 1000 + 1000 }),
    game('129', { url: 'https://evil.test/game/live/129' }),
    game('130', { rules: 'chess960' }), game('131', { source: 'pgn' })];
  assert.deepEqual(completedSiteGames(entries, 'chesscom', 'alice').map(item => item.url), [game('124').url, game().url]);
});

test('checks fetch only configured archives and return metadata without moves', async () => {
  const { check, state } = setup();
  const response = await check();
  assert.deepEqual(state.calls, [['chesscom', 'alice']]);
  assert.equal(response.status, 'ready');
  assert.deepEqual(Object.keys(response).sort(), ['endTime', 'gameUrl', 'retryAfterMs', 'source', 'status', 'token']);
  assert.equal(response.retryAfterMs, 60000);
});

test('current game must be in the finished archive; never fall back to an older game', async () => {
  const { check } = setup();
  assert.equal((await check(content('https://www.chess.com/game/live/999'))).status, 'waiting');
  assert.equal((await check(content('https://www.chess.com/analysis/game/live/123?move=8'))).status, 'ready');
});

test('SPA navigation uses the browser current tab URL when the sender document URL is stale', async () => {
  const oldUrl = 'https://www.chess.com/game/live/123', newUrl = 'https://www.chess.com/game/live/456';
  const { broker, check } = setup({ fetchGames: async () => [game('456')] });
  const ready = await check({ ...content(oldUrl), tab: { id: 5, url: `${newUrl}?move=2` } });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.gameUrl, newUrl);
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token: ready.token }, frame(newUrl))).status, 'ready');
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token: ready.token }, frame(oldUrl))).status, 'expired');
});

test('current tab URL cannot cross the content document origin or provider boundary', async () => {
  const { check, state } = setup();
  for (const url of ['https://lichess.org/Abcdef12', 'https://evil.test/', 'http://www.chess.com/', 'https://chess.com/game/live/123', undefined]) {
    assert.equal((await check({ ...content(), tab: { id: 5, url } })).status, 'disabled');
  }
  assert.equal(state.calls.length, 0);
});

test('Lichess private player URLs are matched to public completed archive identities', async () => {
  const url = 'https://lichess.org/Abcdef12';
  const { broker, check } = setup({ fetchGames: async () => [game('123', { source: 'lichess', url })] });
  const response = await check(content(`${url}Priv/black`));
  assert.equal(response.status, 'ready');
  assert.equal(response.gameUrl, url);
  assert.equal(response.retryAfterMs, 30000);
  const payload = await broker.handle({ type: 'meowl:site-payload', token: response.token }, frame(`${url}Priv/black`));
  assert.equal(payload.status, 'ready');
  assert.equal(payload.parentOrigin, 'https://lichess.org');
  assert.equal(JSON.stringify(payload).includes('Priv'), false);
});

test('untrusted senders, nested content frames, disabled sources, and revoked permissions cannot fetch', async () => {
  const { check, state } = setup();
  for (const sender of [{ ...content(), id: 'other-extension' }, { ...content(), frameId: 1 }, content('https://evil.test/'), { ...content(), tab: {} }]) assert.equal((await check(sender)).status, 'disabled');
  state.permitted = false;
  assert.equal((await check()).status, 'disabled');
  state.permitted = true;
  state.settings.siteReviewSettings.chesscom.enabled = false;
  assert.equal((await check()).status, 'disabled');
  assert.equal(state.calls.length, 0);
});

test('parallel archive checks coalesce, repeated polls reuse jobs, and cache expires', async () => {
  let resolve, calls = 0;
  const { check, advance } = setup({ fetchGames: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const one = check(), two = check(content(page, 6));
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 1);
  resolve([game()]);
  const [first, second] = await Promise.all([one, two]);
  assert.notEqual(first.token, second.token);
  assert.equal((await check()).token, first.token);
  assert.equal(calls, 1);
  advance(60001);
  const next = check();
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 2);
  resolve([game()]);
  assert.equal((await next).token, first.token);
});

test('failed archive requests are cached briefly instead of retrying on every poll', async () => {
  let calls = 0;
  const { check } = setup({ fetchGames: async () => { calls++; throw new Error('Wait a minute before trying again.'); } });
  assert.equal((await check()).status, 'error');
  assert.equal((await check()).status, 'error');
  assert.equal(calls, 1);
});

test('opting out or navigation during a pending fetch prevents a late ready response', async () => {
  let resolve;
  const { check, state, broker } = setup({ fetchGames: () => new Promise(done => { resolve = done; }) });
  const pending = check();
  await new Promise(done => setImmediate(done));
  state.settings.siteReviewSettings.chesscom.enabled = false;
  resolve([game()]);
  assert.equal((await pending).status, 'disabled');
  state.settings.siteReviewSettings.chesscom.enabled = true;
  broker.invalidate();
  const moved = check();
  await new Promise(done => setImmediate(done));
  broker.invalidate(5);
  resolve([game()]);
  assert.equal((await moved).status, 'disabled');
});

test('only the bound extension iframe can receive the game; tokens expire and respect permission changes', async () => {
  const { broker, check, state, advance } = setup();
  const { token } = await check();
  const request = { type: 'meowl:site-payload', token };
  for (const sender of [content(), frame(page, 6), frame('https://www.chess.com/game/live/999'), { ...frame(), frameId: 0 }, { ...frame(), url: extensionUrl('review.html') }, { ...frame(), url: 'https://evil.test/site-summary.html' }]) assert.equal((await broker.handle(request, sender)).status, 'expired');
  const payload = await broker.handle(request, frame());
  assert.equal(payload.game.pgn, completedPgn);
  assert.equal(payload.parentOrigin, 'https://www.chess.com');
  state.permitted = false;
  assert.equal((await broker.handle(request, frame())).status, 'expired');
  state.permitted = true;
  advance(600001);
  assert.equal((await broker.handle(request, frame())).status, 'expired');
});

test('release and review opening enforce tab ownership and safe local review IDs', async () => {
  const { broker, check, state } = setup();
  const { token } = await check();
  const type = 'meowl:site-open-review';
  assert.equal((await broker.handle({ type, token, reviewId: '../review.html?url=evil' }, frame())).status, 'expired');
  const reviewId = `game-${'a'.repeat(64)}`;
  assert.equal((await broker.handle({ type, token, reviewId }, frame())).status, 'opened');
  assert.deepEqual(state.opened, [extensionUrl(`review.html?reviewId=${reviewId}`)]);
  assert.equal((await broker.handle({ type: 'meowl:site-release', token }, content(page, 6))).status, 'expired');
  assert.equal((await broker.handle({ type: 'meowl:site-release', token }, content())).status, 'released');
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token }, frame())).status, 'expired');
});

test('the summary iframe may carry only its own UUID token in the URL fragment', async () => {
  const { broker, check } = setup();
  const { token } = await check();
  const request = { type: 'meowl:site-payload', token };
  assert.equal((await broker.handle(request, { ...frame(), url: extensionUrl(`site-summary.html#${token}`) })).status, 'ready');
  assert.equal((await broker.handle(request, { ...frame(), url: extensionUrl('site-summary.html#00000000-0000-4000-8000-000000000009') })).status, 'expired');
  assert.equal((await broker.handle(request, { ...frame(), url: extensionUrl('site-summary.html#untrusted') })).status, 'expired');
});

test('move navigation keeps a job but navigating to another game cancels it', async () => {
  const url = 'https://www.chess.com/game/live/123';
  const { broker, check } = setup();
  const { token } = await check(content(url));
  broker.pageChanged(5, `${url}?move=8#review`);
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token }, frame(`${url}?move=8#review`))).status, 'ready');
  broker.pageChanged(5, 'https://www.chess.com/game/live/456');
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token }, frame(url))).status, 'expired');
});

test('page settings shortcut is restricted to an enabled trusted content sender', async () => {
  const { broker, state } = setup();
  const message = { type: 'meowl:site-open-settings' };
  assert.equal((await broker.handle(message, content('https://evil.test/'))).status, 'disabled');
  assert.equal((await broker.handle(message, frame())).status, 'disabled');
  assert.equal((await broker.handle(message, content())).status, 'opened');
  assert.deepEqual(state.opened, [extensionUrl('review.html?siteSettings=1')]);
  state.permitted = false;
  assert.equal((await broker.handle(message, content())).status, 'disabled');
});

test('settings changes invalidate old jobs and settings messages require the extension review page', async () => {
  const { broker, check, state } = setup();
  const first = await check();
  state.settings.reviewSettings = { engine: 'lozza', time: '150', lines: '3', smart: false };
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token: first.token }, frame())).status, 'expired');
  const second = await check();
  assert.notEqual(first.token, second.token);
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token: second.token }, frame())).analysis.multiPV, 1);
  assert.equal(broker.isSettingsSender(content()), false);
  assert.equal(broker.isSettingsSender({ id: ID, frameId: 0, url: extensionUrl('review.html') }), true);
  broker.invalidate();
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token: second.token }, frame())).status, 'expired');
});

test('service worker restart preserves a bound job, archive cache, and full-review opening', async () => {
  let saved;
  const session = { readSession: async () => structuredClone(saved), writeSession: async value => { saved = structuredClone(value); } };
  const first = setup(session);
  const ready = await first.check();
  assert.equal(saved.jobs.length, 1);
  assert.equal(saved.cache.length, 1);
  const second = setup({ ...session, makeToken: () => '00000000-0000-4000-8000-000000000099' });
  const payload = await second.broker.handle({ type: 'meowl:site-payload', token: ready.token }, frame());
  assert.equal(payload.status, 'ready');
  assert.equal((await second.check()).token, ready.token);
  assert.equal(second.state.calls.length, 0);
  const reviewId = `game-${'b'.repeat(64)}`;
  assert.equal((await second.broker.handle({ type: 'meowl:site-open-review', token: ready.token, reviewId }, frame())).status, 'opened');
  assert.deepEqual(second.state.opened, [extensionUrl(`review.html?reviewId=${reviewId}`)]);
});

test('restored jobs reject revoked permissions, expired handles, altered pages, and incomplete games', async () => {
  let saved;
  const first = setup({ writeSession: async value => { saved = structuredClone(value); } });
  const { token } = await first.check();
  const original = structuredClone(saved);
  const request = { type: 'meowl:site-payload', token };
  const revoked = setup({ readSession: async () => structuredClone(original) });
  revoked.state.permitted = false;
  assert.equal((await revoked.broker.handle(request, frame())).status, 'expired');
  for (const mutate of [
    snapshot => { snapshot.jobs[0].expiresAt = Date.now() - 1; },
    snapshot => { snapshot.jobs[0].pageKey = 'https://evil.test/'; },
    snapshot => { snapshot.jobs[0].game.pgn = completedPgn.replace('1. e4 e5 1-0', '1. e4 e5 *'); },
    snapshot => { snapshot.jobs[0].parentOrigin = 'https://evil.test'; },
  ]) {
    const snapshot = structuredClone(original); mutate(snapshot);
    const restarted = setup({ readSession: async () => snapshot });
    assert.equal((await restarted.broker.handle(request, frame())).status, 'expired');
  }
  const changedAccount = setup({ readSession: async () => structuredClone(original) });
  changedAccount.state.settings.siteReviewSettings.chesscom.username = 'Someone';
  assert.equal((await changedAccount.broker.handle(request, frame())).status, 'expired');
});

test('session snapshots stay bounded and never retain private Lichess player keys', async () => {
  let saved;
  const pgn = completedPgn.replace('1. e4', `{${'x'.repeat(180000)}}\n1. e4`);
  const url = 'https://lichess.org/Abcdef12';
  const { check } = setup({
    writeSession: async value => { saved = structuredClone(value); },
    fetchGames: async () => [game('123', { source: 'lichess', url, pgn })],
  });
  for (let tab = 1; tab <= 6; tab++) assert.equal((await check(content(`${url}PRIV/black`, tab))).status, 'ready');
  const serialized = JSON.stringify(saved);
  assert.ok(new TextEncoder().encode(serialized).byteLength <= 700000);
  assert.ok(saved.jobs.length > 0 && saved.jobs.length < 6);
  assert.equal(serialized.includes('PRIV'), false);
});

test('unavailable session storage does not block reviewing a completed game', async () => {
  const { check } = setup({ readSession: async () => { throw new Error('Unavailable'); }, writeSession: async () => { throw new Error('Quota'); } });
  assert.equal((await check()).status, 'ready');
});

test('changing one site preserves the other site jobs and cached archive', async () => {
  const calls = [];
  const { broker, check } = setup({ fetchGames: async source => {
    calls.push(source);
    return [source === 'chesscom' ? game() : game('123', { source, url: 'https://lichess.org/Abcdef12' })];
  } });
  const chess = await check();
  const lichess = await check(content('https://lichess.org/Abcdef12', 6));
  broker.invalidateSource('lichess');
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token: chess.token }, frame())).status, 'ready');
  assert.equal((await broker.handle({ type: 'meowl:site-payload', token: lichess.token }, frame('https://lichess.org/Abcdef12', 6))).status, 'expired');
  assert.equal((await check()).token, chess.token);
  assert.deepEqual(calls, ['chesscom', 'lichess']);
});

test('library bridge is frame-bound and derives game identity and settings only from its trusted job', async () => {
  const { bridge, records } = bridgeFixture();
  const { broker, check } = setup(bridge);
  const { token } = await check();
  const load = { type: 'meowl:site-load-review', token };
  assert.equal((await broker.handle(load, content())).status, 'expired');
  assert.equal((await broker.handle(load, frame(page, 6))).status, 'expired');
  assert.deepEqual(await broker.handle(load, frame()), { status: 'ready', record: null });
  const saved = await broker.handle({ type: 'meowl:site-save-review', token, result: await finishedResult(), game: { pgn: 'malicious' }, reviewId: `game-${'f'.repeat(64)}`, analysis: { engineId: 'evil' } }, frame());
  assert.equal(saved.status, 'saved');
  assert.equal(saved.record.id, await reviewIdForGame(game()));
  assert.equal(saved.record.game.pgn, completedPgn);
  assert.equal(saved.record.analysis.engineId, 'stockfish');
  assert.equal(records.size, 1);
  assert.equal((await broker.handle(load, frame())).record.id, saved.record.id);
});

test('library bridge rejects incomplete results without writing a record and preserves useful errors', async () => {
  const { bridge, records } = bridgeFixture();
  const { broker, check } = setup(bridge);
  const { token } = await check();
  const response = await broker.handle({ type: 'meowl:site-save-review', token, result: { game: {}, positions: [], moves: [] } }, frame());
  assert.equal(response.status, 'error');
  assert.match(response.message, /invalid|incomplete|review|analysis/i);
  assert.equal(records.size, 0);
  const unavailable = setup({ loadReview: async () => { throw new Error('Browser storage is unavailable.'); } });
  const ready = await unavailable.check();
  assert.deepEqual(await unavailable.broker.handle({ type: 'meowl:site-load-review', token: ready.token }, frame()), { status: 'error', message: 'Browser storage is unavailable.' });
});

test('automatic save reuses deeper current analysis and serializes simultaneous saves of the same game', async () => {
  const result = await finishedResult();
  const existing = bridgeFixture();
  const deep = await existing.library.saveReview(game(), result, { ...normalizeSiteAnalysis(), moveTimeMs: 3000, multiPV: 3 });
  const first = setup(existing.bridge);
  const ready = await first.check();
  const reused = await first.broker.handle({ type: 'meowl:site-save-review', token: ready.token, result }, frame());
  assert.equal(reused.status, 'saved');
  assert.equal(reused.record.analysis.moveTimeMs, 3000);
  assert.equal(reused.record.updatedAt, deep.updatedAt);
  assert.equal(existing.writes(), 1);

  const simultaneous = bridgeFixture();
  const second = setup(simultaneous.bridge);
  const a = await second.check(), b = await second.check(content(page, 6));
  const responses = await Promise.all([
    second.broker.handle({ type: 'meowl:site-save-review', token: a.token, result }, frame()),
    second.broker.handle({ type: 'meowl:site-save-review', token: b.token, result }, frame(page, 6)),
  ]);
  assert.deepEqual(responses.map(value => value.status), ['saved', 'saved']);
  assert.equal(responses[0].record.id, responses[1].record.id);
  assert.equal(simultaneous.writes(), 1);
});

test('revoking access while a library save waits prevents committing the result', async () => {
  let release, writes = 0;
  const bridge = createSiteReviewLibraryBridge({ idForGame: reviewIdForGame, library: {
    loadReview: () => new Promise(resolve => { release = resolve; }),
    saveReview: async () => { writes++; },
  } });
  const { broker, check, state } = setup(bridge);
  const { token } = await check();
  const pending = broker.handle({ type: 'meowl:site-save-review', token, result: await finishedResult() }, frame());
  while (!release) await new Promise(resolve => setImmediate(resolve));
  state.permitted = false;
  release(null);
  const response = await pending;
  assert.equal(response.status, 'error');
  assert.match(response.message, /canceled|settings changed/i);
  assert.equal(writes, 0);
});

test('background registers only opted-in permitted sites and disables a site after permission loss', async t => {
  const original = globalThis.chrome;
  const listeners = {}, scripts = new Map(), injected = [], opened = [];
  let grant = true;
  let sessionSnapshot;
  const seeded = setup({ writeSession: async value => { sessionSnapshot = structuredClone(value); } });
  const seededJob = await seeded.check();
  const settings = { siteReviewSettings: { chesscom: { enabled: true, username: 'Alice' }, lichess: { enabled: false, username: '' } } };
  const event = name => ({ addListener: listener => { listeners[name] = listener; } });
  globalThis.chrome = {
    runtime: { id: ID, getURL: extensionUrl, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    action: { onClicked: event('action') },
    storage: { local: { get: async () => settings, set: async value => Object.assign(settings, value) }, session: { get: async () => ({ siteReviewSession: structuredClone(sessionSnapshot) }), set: async value => { sessionSnapshot = value.siteReviewSession; } }, onChanged: event('storage') },
    permissions: { contains: async ({ permissions, origins }) => grant && permissions.includes('scripting') && origins.includes('https://www.chess.com/*'), onAdded: event('added'), onRemoved: event('removed') },
    tabs: { query: async () => [{ id: 5 }], create: async value => opened.push(value), onRemoved: event('tabRemoved'), onUpdated: event('tabUpdated') },
    scripting: {
      getRegisteredContentScripts: async () => [...scripts.values()],
      registerContentScripts: async entries => entries.forEach(entry => scripts.set(entry.id, entry)),
      unregisterContentScripts: async ({ ids }) => ids.forEach(id => scripts.delete(id)),
      executeScript: async value => injected.push(value),
    },
  };
  t.after(() => { globalThis.chrome = original; });
  await import(`../extension/background.js?site-test=${Date.now()}`);
  const reconcile = () => new Promise(resolve => listeners.message({ type: 'meowl:site-settings-changed' }, { id: ID, frameId: 0, url: extensionUrl('review.html') }, resolve));
  assert.equal((await reconcile()).status, 'ready');
  assert.deepEqual([...scripts.keys()], ['meowl-site-chesscom']);
  assert.deepEqual(scripts.get('meowl-site-chesscom').matches, ['https://www.chess.com/*', 'https://chess.com/*']);
  assert.equal(injected.length, 1);
  const payload = () => new Promise(resolve => listeners.message({ type: 'meowl:site-payload', token: seededJob.token }, frame(), resolve));
  assert.equal((await payload()).status, 'ready');
  settings.reviewSettings = { autoOrient: false, arrowMode: 'all', badges: false };
  listeners.storage({ reviewSettings: { oldValue: undefined, newValue: settings.reviewSettings } }, 'local');
  assert.equal((await payload()).status, 'ready');
  const oldSites = structuredClone(settings.siteReviewSettings);
  settings.siteReviewSettings.lichess = { enabled: false, username: 'Somebody' };
  listeners.storage({ siteReviewSettings: { oldValue: oldSites, newValue: settings.siteReviewSettings } }, 'local');
  await reconcile();
  assert.equal((await payload()).status, 'ready');
  const oldReview = settings.reviewSettings;
  settings.reviewSettings = { ...oldReview, engine: 'lozza' };
  listeners.storage({ reviewSettings: { oldValue: oldReview, newValue: settings.reviewSettings } }, 'local');
  assert.equal((await payload()).status, 'expired');
  listeners.action();
  assert.deepEqual(opened, [{ url: extensionUrl('review.html') }]);
  grant = false;
  listeners.removed();
  await reconcile();
  assert.equal(settings.siteReviewSettings.chesscom.enabled, false);
  assert.equal(scripts.size, 0);
});
