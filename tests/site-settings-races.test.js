import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteReviewSettings } from '../extension/lib/site-settings.js';

class Control {
  constructor() { this.value = ''; this.checked = false; this.disabled = false; this.listeners = {}; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  focus() {}
  async change() { await this.listeners.change?.(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(initial = {}) {
  const previous = { document: globalThis.document, chrome: globalThis.chrome, navigator: globalThis.navigator };
  const listeners = new Set(), queues = new Map();
  let data = structuredClone(initial), hold = null;
  const locks = { request(name, fn) { const job = (queues.get(name) || Promise.resolve()).then(fn); queues.set(name, job.catch(() => {})); return job; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  const emit = changes => { for (const listener of listeners) listener(changes, 'local'); };
  globalThis.chrome = {
    permissions: { request: async () => true }, runtime: { sendMessage: async () => ({ status: 'ok' }) },
    storage: { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }, local: {
      get: async keys => {
        const snapshot = structuredClone(data);
        if (hold && Array.isArray(keys)) { const release = hold; hold = null; await release.wait; }
        return snapshot;
      },
      set: async values => {
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: structuredClone(value) }]));
        data = { ...data, ...structuredClone(values) }; emit(changes);
      },
    } },
  };
  return {
    mount() {
      const nodes = new Map(['site-review-status', 'site-chesscom-enabled', 'site-chesscom-username', 'site-lichess-enabled', 'site-lichess-username'].map(id => [id, new Control()]));
      globalThis.document = { getElementById: id => nodes.get(id) };
      const settings = createSiteReviewSettings(); settings.setBusy(false); return { nodes, settings };
    },
    holdInitial() { let resolve; hold = { wait: new Promise(done => { resolve = done; }) }; return resolve; },
    external(values) { return chrome.storage.local.set(values); },
    data: () => structuredClone(data),
    restore() { globalThis.document = previous.document; globalThis.chrome = previous.chrome; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator }); },
  };
}

test('simultaneous provider updates merge under a shared lock', async () => {
  const h = harness({ siteReviewSettings: { chesscom: { enabled: false, username: 'cat' }, lichess: { enabled: false, username: 'owl' } } });
  try {
    const first = h.mount(), second = h.mount(); await tick();
    first.nodes.get('site-chesscom-enabled').checked = true;
    second.nodes.get('site-lichess-enabled').checked = true;
    await Promise.all([first.nodes.get('site-chesscom-enabled').change(), second.nodes.get('site-lichess-enabled').change()]);
    assert.equal(h.data().siteReviewSettings.chesscom.enabled, true);
    assert.equal(h.data().siteReviewSettings.lichess.enabled, true);
  } finally { h.restore(); }
});

test('a newer setting event wins over a delayed initialization snapshot', async () => {
  const h = harness({ siteReviewSettings: { chesscom: { enabled: true, username: 'oldcat' } } });
  try {
    const release = h.holdInitial(), current = h.mount();
    await h.external({ siteReviewSettings: { chesscom: { enabled: false, username: 'newcat' } } });
    release(); await tick();
    assert.equal(current.nodes.get('site-chesscom-enabled').checked, false);
    assert.equal(current.nodes.get('site-chesscom-username').value, 'newcat');
  } finally { h.restore(); }
});

test('another provider update preserves a draft and an explicit cleared username replaces stale text', async () => {
  const h = harness({ siteReviewSettings: { chesscom: { enabled: false, username: 'oldcat' }, lichess: { enabled: false, username: 'owl' } } });
  try {
    const current = h.mount(); await tick();
    current.nodes.get('site-chesscom-username').value = 'draftcat';
    await h.external({ siteReviewSettings: { chesscom: { enabled: false, username: 'oldcat' }, lichess: { enabled: true, username: 'owl' } } });
    assert.equal(current.nodes.get('site-chesscom-username').value, 'draftcat');
    await h.external({ siteReviewSettings: { chesscom: { enabled: false, username: '' }, lichess: { enabled: true, username: 'owl' } } });
    assert.equal(current.nodes.get('site-chesscom-username').value, '');
  } finally { h.restore(); }
});
