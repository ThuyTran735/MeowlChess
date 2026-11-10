import test from 'node:test';
import assert from 'node:assert/strict';
import { accountSource, createAccountDetectionService } from '../extension/lib/account-detection-service.js';

const chessTab = (id = 1, extra = {}) => ({ id, url: 'https://www.chess.com/play', active: true, ...extra });
const lichessTab = (id = 2, extra = {}) => ({ id, url: 'https://lichess.org/', active: true, ...extra });
const account = (source = 'chesscom', username = 'Alice') => ({ source, state: 'signed-in', username });
const frames = result => [{ frameId: 0, result }];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ tabList = [chessTab()], allowed = true, values = {}, replies = {}, initialTime = 1000000 } = {}) {
  const data = structuredClone(values), liveTabs = new Map(tabList.map(tab => [tab.id, { ...tab }]));
  const calls = { execute: [], permission: [], query: [], getTab: [], getStorage: [], set: [] };
  let clock = initialTime;
  const storage = {
    async get(key) { calls.getStorage.push(key); return { [key]: structuredClone(data[key]) }; },
    async set(value) { calls.set.push(structuredClone(value)); Object.assign(data, structuredClone(value)); },
  };
  const tabs = {
    async query(options) {
      calls.query.push(options);
      const source = options.url.some(url => url.includes('chess.com')) ? 'chesscom' : 'lichess';
      return [...liveTabs.values()].filter(tab => accountSource(tab.url) === source).map(tab => ({ ...tab }));
    },
    async get(id) { calls.getTab.push(id); return liveTabs.has(id) ? { ...liveTabs.get(id) } : undefined; },
  };
  const permissions = {
    async contains(options) { calls.permission.push(options); return typeof allowed === 'function' ? allowed(options) : allowed; },
  };
  const scripting = {
    async executeScript(options) {
      calls.execute.push(options);
      const value = replies[options.target.tabId] ?? account(accountSource(liveTabs.get(options.target.tabId)?.url));
      return typeof value === 'function' ? await value(options) : frames(value);
    },
  };
  const service = createAccountDetectionService({ storage, tabs, scripting, permissions, now: () => clock, locks: null });
  return { service, data, calls, liveTabs, replies, storage, setTime: value => { clock = value; } };
}

test('account detection only recognizes exact secure provider origins', () => {
  assert.equal(accountSource('https://chess.com/member/Alice'), 'chesscom');
  assert.equal(accountSource('https://www.chess.com/game/live/123?username=Alice'), 'chesscom');
  assert.equal(accountSource('https://lichess.org/@/Alice'), 'lichess');
  for (const url of [null, '', 'chess.com', 'http://chess.com/', 'https://chess.com.evil.test/',
    'https://lichess.org.evil.test/', 'https://chess.com@evil.test/', 'https://user:secret@chess.com/',
    'https://lichess.org:9000/', 'https://www.lichess.org/', 'file:///chess.com', 'chrome://extensions']) {
    assert.equal(accountSource(url), null, String(url));
  }
});

test('toolbar activeTab grant reads only the top frame without requesting persistent site permission', async () => {
  const h = harness({ allowed: false });
  assert.deepEqual(await h.service.detectTab(chessTab(), { activeGrant: true }), { status: 'detected', source: 'chesscom', username: 'Alice' });
  assert.equal(h.calls.permission.length, 0);
  assert.equal(h.calls.query.length, 0);
  assert.equal(h.calls.execute.length, 1);
  const injection = h.calls.execute[0];
  assert.deepEqual(Object.keys(injection).sort(), ['func', 'target', 'world']);
  assert.deepEqual(injection.target, { tabId: 1, frameIds: [0] });
  assert.equal(injection.world, 'ISOLATED');
  assert.equal(typeof injection.func, 'function');
  assert.deepEqual(h.data.detectedAccounts, { chesscom: { username: 'Alice', detectedAt: 1000000 } });
});

test('background and explicit scans require provider permission without prompting or reading tabs', async () => {
  const h = harness({ allowed: false });
  assert.equal((await h.service.detectTab(chessTab())).status, 'permission-required');
  assert.equal((await h.service.detect('chesscom')).status, 'permission-required');
  assert.equal(h.calls.execute.length, 0);
  assert.equal(h.calls.query.length, 0);
  assert.equal(h.calls.set.length, 0);
  assert(h.calls.permission.every(request => request.permissions.length === 1 && request.permissions[0] === 'scripting'));
});

test('private, discarded, unsupported and invalid tabs are never inspected even with a toolbar grant', async () => {
  const h = harness();
  for (const tab of [null, chessTab(-1), chessTab(1.5), chessTab(1, { incognito: true }),
    chessTab(1, { discarded: true }), chessTab(1, { url: 'https://example.org/' })]) {
    assert.equal((await h.service.detectTab(tab, { activeGrant: true })).status, 'unavailable');
  }
  assert.equal((await h.service.detect('unknown')).status, 'unavailable');
  assert.equal(h.calls.execute.length, 0);
  assert.equal(h.calls.set.length, 0);
});

test('subframes cannot supply the account identity', async () => {
  const h = harness({ replies: { 1: () => [{ frameId: 8, result: account() }] } });
  assert.equal((await h.service.detectTab(chessTab(), { activeGrant: true })).status, 'not-found');
  assert.equal(h.calls.set.length, 0);
  h.replies[1] = () => [{ frameId: 4, result: account() }, { frameId: 0, result: { source: 'chesscom', state: 'signed-out' } }];
  assert.equal((await h.service.detectTab(chessTab(), { activeGrant: true })).status, 'not-found');
  assert.equal(h.calls.set.length, 0);
});

test('source mismatch and invalid usernames are rejected before saving', async () => {
  const h = harness();
  for (const reply of [account('lichess'), account('chesscom', ''), account('chesscom', 'A'),
    account('chesscom', 'A'.repeat(51)), account('chesscom', '<Alice>'), account('chesscom', 'Alice Bob'),
    account('chesscom', 'https://chess.com/member/Alice')]) {
    h.replies[1] = reply;
    assert.equal((await h.service.detectTab(chessTab(), { activeGrant: true })).status, 'not-found');
  }
  assert.equal(h.calls.set.length, 0);
});

test('a tab navigation or invalidation discards a pending reader', async () => {
  for (const mode of ['navigation', 'invalidation', 'closed']) {
    const held = deferred(), h = harness({ replies: { 1: () => held.promise } });
    const result = h.service.detectTab(chessTab(), { activeGrant: true });
    await tick();
    if (mode === 'navigation') h.liveTabs.set(1, chessTab(1, { url: 'https://www.chess.com/member/Bob' }));
    if (mode === 'invalidation') h.service.invalidate(1);
    if (mode === 'closed') h.liveTabs.delete(1);
    held.resolve(frames(account()));
    assert.equal((await result).status, 'not-found', mode);
    assert.equal(h.calls.set.length, 0, mode);
  }
});

test('simultaneous readers share one injection and repeated detection avoids redundant storage writes', async () => {
  const held = deferred(), h = harness({ replies: { 1: () => held.promise } });
  const first = h.service.detectTab(chessTab(), { activeGrant: true });
  const second = h.service.detectTab(chessTab(), { activeGrant: true });
  await tick(); assert.equal(h.calls.execute.length, 1);
  held.resolve(frames(account()));
  const [older, latest] = await Promise.all([first, second]);
  assert.equal(older.status, 'not-found', 'The newer request supersedes an older reply.');
  assert.equal(latest.status, 'detected');
  assert.equal(h.calls.set.length, 1);
  await h.service.detectTab(chessTab(), { activeGrant: true });
  assert.equal(h.calls.set.length, 1);
  h.setTime(1300000);
  await h.service.detectTab(chessTab(), { activeGrant: true });
  assert.equal(h.calls.set.length, 2);
});

test('concurrent provider updates merge without losing the other detected account or manual preferences', async () => {
  const h = harness({ tabList: [chessTab(), lichessTab()], values: { usernames: { chesscom: 'Opponent' },
    detectedAccounts: { evil: { username: 'Ignored', detectedAt: 10 } } }, replies: { 2: account('lichess', 'LichessCat') } });
  const replies = await Promise.all([h.service.detectTab(chessTab()), h.service.detectTab(lichessTab())]);
  assert(replies.every(reply => reply.status === 'detected'));
  assert.deepEqual(h.data.detectedAccounts, { chesscom: { username: 'Alice', detectedAt: 1000000 }, lichess: { username: 'LichessCat', detectedAt: 1000000 } });
  assert.deepEqual(h.data.usernames, { chesscom: 'Opponent' });
});

test('explicit scans reject multiple different signed-in accounts and ambiguous widgets', async () => {
  const h = harness({ tabList: [chessTab(), chessTab(2)], replies: { 2: account('chesscom', 'Bob') } });
  assert.equal((await h.service.detect('chesscom')).status, 'ambiguous');
  assert.equal(h.calls.set.length, 0);
  h.replies[2] = { source: 'chesscom', state: 'ambiguous' };
  assert.equal((await h.service.detect('chesscom')).status, 'ambiguous');
  assert.equal(h.calls.set.length, 0);
  h.replies[2] = account('chesscom', 'ALICE');
  assert.equal((await h.service.detect('chesscom')).status, 'detected');
  assert.equal(h.calls.set.length, 1);
});

test('explicit scans skip private tabs and cap work when many old pages are open', async () => {
  const h = harness({ tabList: [chessTab(1, { incognito: true }), chessTab(2), chessTab(3, { discarded: true })] });
  assert.equal((await h.service.detect('chesscom')).status, 'detected');
  assert.deepEqual(h.calls.execute.map(call => call.target.tabId), [2]);
  const many = harness({ tabList: Array.from({ length: 11 }, (_, i) => chessTab(i + 1)) });
  assert.equal((await many.service.detect('chesscom')).status, 'ambiguous');
  assert.equal(many.calls.execute.length, 0);
});

test('confirmed sign-out clears only that provider and absent tabs preserve a remembered identity', async () => {
  const cache = { chesscom: { username: 'Alice', detectedAt: 1 }, lichess: { username: 'OtherCat', detectedAt: 1 } };
  const h = harness({ values: { detectedAccounts: cache, usernames: { chesscom: 'Manual' } }, replies: { 1: { source: 'chesscom', state: 'signed-out' } } });
  assert.equal((await h.service.detect('chesscom')).status, 'not-found');
  assert.deepEqual(h.data.detectedAccounts, { lichess: cache.lichess });
  assert.deepEqual(h.data.usernames, { chesscom: 'Manual' });
  const none = harness({ tabList: [], values: { detectedAccounts: cache } });
  assert.equal((await none.service.detect('chesscom')).status, 'not-found');
  assert.deepEqual(none.data.detectedAccounts, cache);
  assert.equal(none.calls.set.length, 0);
});

test('blocked injection and storage failures return finite UI statuses', async () => {
  const denied = harness({ replies: { 1: async () => { throw new Error('Cannot access tab'); } } });
  assert.equal((await denied.service.detectTab(chessTab(), { activeGrant: true })).status, 'not-found');
  assert.equal(denied.calls.set.length, 0);
  const failure = harness(); failure.storage.set = async () => { throw new Error('Storage unavailable'); };
  assert.equal((await failure.service.detect('chesscom')).status, 'unavailable');
});

test('invalidating while waiting for storage prevents stale cache writes', async () => {
  const held = deferred(), h = harness();
  h.storage.get = () => held.promise;
  const pending = h.service.detectTab(chessTab(), { activeGrant: true });
  await tick(); h.service.invalidate(1); held.resolve({});
  assert.equal((await pending).status, 'unavailable');
  assert.equal(h.calls.set.length, 0);
});

test('a slower previously active tab cannot replace a newer signed-in account', async () => {
  const held = deferred(), h = harness({ tabList: [chessTab(), chessTab(2)],
    replies: { 1: () => held.promise, 2: account('chesscom', 'Bob') } });
  const older = h.service.detectTab(chessTab(), { activeGrant: true });
  await tick();
  const latest = await h.service.detectTab(chessTab(2), { activeGrant: true });
  assert.equal(latest.username, 'Bob');
  held.resolve(frames(account()));
  assert.equal((await older).status, 'not-found');
  assert.equal(h.data.detectedAccounts.chesscom.username, 'Bob');
  assert.equal(h.calls.set.length, 1);
});

test('navigation during an already-started storage commit rolls back only the stale provider', async () => {
  const prior = { username: 'PreviousCat', detectedAt: 10 };
  const held = deferred(), entered = deferred(), h = harness({ values: { detectedAccounts: { chesscom: prior } } });
  const originalSet = h.storage.set;
  let first = true;
  h.storage.set = async value => {
    await originalSet(value);
    if (first) { first = false; entered.resolve(); await held.promise; }
  };
  const pending = h.service.detectTab(chessTab(), { activeGrant: true });
  await entered.promise;
  h.service.invalidate(1);
  // A separately committed provider must survive this request's correction.
  h.data.detectedAccounts.lichess = { username: 'LichessCat', detectedAt: 20 };
  held.resolve();
  assert.equal((await pending).status, 'unavailable');
  assert.deepEqual(h.data.detectedAccounts, { chesscom: prior, lichess: { username: 'LichessCat', detectedAt: 20 } });
});

test('rollback never erases a separately updated account and queued newer requests still win', async () => {
  for (const external of [true, false]) {
    const held = deferred(), entered = deferred(), h = harness({ tabList: [chessTab(), chessTab(2)], replies: { 2: account('chesscom', 'Bob') } });
    const originalSet = h.storage.set; let first = true;
    h.storage.set = async value => {
      await originalSet(value);
      if (first) { first = false; entered.resolve(); await held.promise; }
    };
    const pending = h.service.detectTab(chessTab(), { activeGrant: true });
    await entered.promise;
    let next;
    if (external) {
      h.service.invalidate(1);
      h.data.detectedAccounts.chesscom = { username: 'Bob', detectedAt: 99 };
    } else next = h.service.detectTab(chessTab(2), { activeGrant: true });
    await tick(); held.resolve();
    assert.equal((await pending).status, 'unavailable');
    if (next) assert.equal((await next).status, 'detected');
    assert.equal(h.data.detectedAccounts.chesscom.username, 'Bob');
    if (external) assert.equal(h.data.detectedAccounts.chesscom.detectedAt, 99);
  }
});
