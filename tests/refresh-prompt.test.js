import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshMonitor } from '../extension/lib/refresh-prompt.js';

const runtime = (sendMessage = async () => ({ version: '1.11.0' })) => ({ id: 'fixture-extension', getManifest: () => ({ version: '1.11.0' }), sendMessage });

test('a newer version is deferred until the active review finishes and refresh needs a click', async () => {
  let busy = true, reloaded = 0, calls = 0;
  const notices = [];
  const monitor = createRefreshMonitor({ runtime: runtime(async () => { calls++; return { version: '1.12.0' }; }), isBusy: () => busy, onNotice: reason => notices.push(reason), reload: () => reloaded++ });
  await monitor.check();
  assert.deepEqual(notices, []); assert.equal(reloaded, 0); assert.equal(monitor.refresh(), false);
  busy = false; await monitor.check();
  assert.deepEqual(notices, ['updated']); assert.equal(calls, 1); assert.equal(reloaded, 0);
  // Starting another operation while a notice is visible still prevents reload.
  busy = true; assert.equal(monitor.refresh(), false); assert.equal(reloaded, 0);
  busy = false; assert.equal(monitor.refresh(), true); assert.equal(reloaded, 1);
});

test('temporary connection failures do not ask users to refresh', async () => {
  const notices = [];
  const monitor = createRefreshMonitor({ runtime: runtime(async () => { throw new Error('Could not establish connection.'); }), onNotice: reason => notices.push(reason) });
  await monitor.check(); assert.deepEqual(notices, []); assert.equal(monitor.pending, false);
});

test('same-version reloads with an invalidated context are detected', async () => {
  const notices = [];
  const monitor = createRefreshMonitor({ runtime: runtime(async () => { throw new Error('Extension context invalidated.'); }), onNotice: reason => notices.push(reason) });
  await monitor.check(); assert.deepEqual(notices, ['updated']);
});

test('loss of runtime identity is detected without a failed message request', async () => {
  const notices = [], api = runtime(); delete api.id;
  const monitor = createRefreshMonitor({ runtime: api, onNotice: reason => notices.push(reason) });
  await monitor.check(); assert.deepEqual(notices, ['updated']);
});

test('backup restore has its own deferred notice and teardown ignores outstanding responses', async () => {
  let busy = true, finish;
  const notices = [];
  const monitor = createRefreshMonitor({ runtime: runtime(), isBusy: () => busy, onNotice: reason => notices.push(reason) });
  monitor.mark('restored'); assert.deepEqual(notices, []);
  busy = false; await monitor.check(); assert.deepEqual(notices, ['restored']);
  const late = createRefreshMonitor({ runtime: runtime(() => new Promise(resolve => { finish = resolve; })), onNotice: reason => notices.push(reason) });
  const pending = late.check(); late.destroy(); finish({ version: '2.0.0' }); await pending;
  assert.deepEqual(notices, ['restored']); assert.equal(late.refresh(), false);
});

test('concurrent focus events share one version check', async () => {
  let calls = 0, finish;
  const monitor = createRefreshMonitor({ runtime: runtime(() => { calls++; return new Promise(resolve => { finish = resolve; }); }) });
  const pending = monitor.check(); await monitor.check(); assert.equal(calls, 1);
  finish({ version: '1.11.0' }); await pending; assert.equal(monitor.pending, false);
});
