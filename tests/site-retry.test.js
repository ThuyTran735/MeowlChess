import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteReviewBroker } from '../extension/lib/site-review.js';

const ID = 'retry-test';
const extensionUrl = path => `chrome-extension://${ID}/${path}`;
const pgn = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
const game = (source = 'chesscom', id = '123', extra = {}) => ({
  source, rules: 'chess', url: source === 'chesscom' ? `https://www.chess.com/game/live/${id}` : `https://lichess.org/${id}`,
  pgn, end_time: 1700000000, white: { username: 'Alice', result: 'win' }, black: { username: 'Bob', result: 'resigned' }, ...extra,
});
const actor = (url, tabId = 5) => ({ id: ID, frameId: 0, url, tab: { id: tabId, url } });
function setup(fetchGames, extra = {}) {
  let clock = Date.now(), token = 0, permitted = true;
  const broker = createSiteReviewBroker({
    extensionId: ID, extensionUrl, readSettings: async () => ({ siteReviewSettings: { chesscom: { enabled: true, username: 'Alice' }, lichess: { enabled: true, username: 'Alice' } } }),
    hasPermission: async () => permitted, fetchGames, openReview: async () => {}, now: () => clock,
    makeToken: () => `00000000-0000-4000-8000-${String(++token).padStart(12, '0')}`, ...extra,
  });
  return { broker, advance: ms => { clock += ms; }, revoke: () => { permitted = false; }, check: (sender, manualRetry = false) => broker.handle({ type: 'meowl:site-check', manualRetry }, sender) };
}

test('manual retry revalidates a warm exact miss on both sites without selecting another game', async () => {
  for (const source of ['chesscom', 'lichess']) {
    const selected = game(source, source === 'chesscom' ? '123' : 'Abcdef12');
    const unrelated = game(source, source === 'chesscom' ? '456' : 'Qwerty99');
    let entries = [unrelated]; const calls = [];
    const { check } = setup(async (actualSource, name, options) => { calls.push({ actualSource, name, options }); return entries; });
    const sender = actor(selected.url);
    assert.equal((await check(sender)).status, 'waiting');
    entries = [unrelated, selected];
    assert.equal((await check(sender)).status, 'waiting');
    const reply = await check(sender, true);
    assert.equal(reply.status, 'ready'); assert.equal(reply.gameUrl, selected.url);
    assert.equal(calls.length, 2); assert.deepEqual(calls[1].options, { gameUrl: selected.url, revalidate: true });
  }
});

test('manual retry recovers cached connection errors but shares a fifteen-second retry cooldown', async () => {
  let fail = true, calls = 0;
  const { check, advance } = setup(async () => { calls++; if (fail) throw new Error('Could not connect.'); return [game()]; });
  const sender = actor(game().url);
  assert.equal((await check(sender)).status, 'error');
  assert.equal((await check(sender, true)).status, 'error'); assert.equal(calls, 2);
  fail = false;
  assert.equal((await check(actor(game().url, 6), true)).status, 'error');
  advance(14999); assert.equal((await check(sender, true)).status, 'error'); assert.equal(calls, 2);
  advance(1); assert.equal((await check(sender, true)).gameUrl, game().url); assert.equal(calls, 3);
});

test('explicit rate-limit errors retain the normal backoff even for a manual retry', async () => {
  let calls = 0;
  const { check, advance } = setup(async () => { calls++; throw new Error('Chess.com is receiving too many requests. Wait a minute before trying again.'); });
  const sender = actor(game().url);
  await check(sender); await check(sender, true); advance(59999); await check(sender, true);
  assert.equal(calls, 1);
  advance(1); await check(sender, true); assert.equal(calls, 2);
});

test('retries arriving during an older lookup queue one fresh shared request', async () => {
  const requests = [];
  const { check } = setup((source, username, options) => new Promise(resolve => requests.push({ options, resolve })));
  const initial = check(actor(game().url));
  while (!requests.length) await new Promise(resolve => setImmediate(resolve));
  const first = check(actor(game().url), true), second = check(actor(game().url, 6), true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(requests.length, 1);
  requests[0].resolve([]);
  while (requests.length < 2) await new Promise(resolve => setImmediate(resolve));
  const third = check(actor(game().url, 7), true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(requests.length, 2);
  requests[1].resolve([game()]);
  assert.equal((await initial).status, 'waiting');
  for (const reply of await Promise.all([first, second, third])) assert.equal(reply.gameUrl, game().url);
});

test('manual retry does not make unfinished or another player\'s game reviewable', async () => {
  let entries = [];
  const { check, advance } = setup(async () => entries);
  const sender = actor(game().url);
  await check(sender);
  entries = [game('chesscom', '123', { pgn: pgn.replace('1. e4 e5 1-0', '1. e4 e5 *') })];
  assert.equal((await check(sender, true)).status, 'waiting');
  advance(15000); entries = [game('chesscom', '123', { white: { username: 'Someone', result: 'win' } })];
  assert.equal((await check(sender, true)).status, 'waiting');
});

test('manual retry retains sender and permission checks and cannot revive a navigated request', async () => {
  let release, calls = 0;
  const { broker, check, revoke } = setup(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const sender = actor(game().url);
  for (const bad of [{ ...sender, id: 'other' }, { ...sender, frameId: 1 }, actor('https://evil.test/game/123')]) assert.equal((await check(bad, true)).status, 'disabled');
  assert.equal(calls, 0);
  const pending = check(sender, true);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  broker.pageChanged(5, game('chesscom', '456').url);
  release([game()]); assert.equal((await pending).status, 'disabled');
  revoke(); assert.equal((await check(sender, true)).status, 'disabled'); assert.equal(calls, 1);
});

test('manual retry cooldown survives service-worker restoration', async () => {
  let snapshot, clock = Date.now(), calls = 0;
  const extra = { now: () => clock, readSession: async () => structuredClone(snapshot), writeSession: async value => { snapshot = structuredClone(value); } };
  const fetchGames = async () => { calls++; return []; };
  const first = setup(fetchGames, extra), sender = actor(game().url);
  await first.check(sender, true); assert.equal(calls, 1);
  const restored = setup(fetchGames, extra);
  clock += 14999; await restored.check(sender, true); assert.equal(calls, 1);
  clock++; await restored.check(sender, true); assert.equal(calls, 2);
});

test('retrying a selected completed game renews its handle without fetching another game', async () => {
  let calls = 0;
  const { broker, check, advance } = setup(async () => { calls++; return [game()]; });
  const sender = actor(game().url), initial = await check(sender);
  await broker.handle({ type: 'meowl:site-panel-state', token: initial.token, panelGeneration: initial.panelGeneration, panelState: 'closed' }, sender);
  await broker.handle({ type: 'meowl:site-panel-state', token: initial.token, panelGeneration: initial.panelGeneration, panelState: 'open' }, sender);
  advance(11 * 60 * 1000);
  const reply = await check(sender, true);
  assert.equal(reply.token, initial.token); assert.equal(reply.gameUrl, initial.gameUrl); assert.equal(calls, 1);
});
