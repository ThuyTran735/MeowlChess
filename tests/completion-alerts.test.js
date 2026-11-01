import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompletionAlertService } from '../extension/lib/completion-alert-service.js';
import { notifyReviewComplete, installCompletionAlertSetting } from '../extension/lib/completion-alerts.js';

const id = 'game-' + 'a'.repeat(64), now = 2000000;
function fixture(overrides = {}) {
  const state = { allowed: true, away: true, record: { id, updatedAt: now, stale: false, game: { white: { username: 'Alice' }, black: { username: 'Bob' } } }, notifications: [], opened: [], cleared: [], history: [], authorized: 0 };
  const options = {
    enabled: async () => state.allowed,
    away: async () => state.away,
    authorize: async () => { state.authorized++; return state.record; },
    loadReview: async () => state.record,
    create: async (...args) => { state.notifications.push(args); },
    clear: async value => { state.cleared.push(value); },
    openReview: async value => { state.opened.push(value); },
    now: () => now,
    readHistory: async () => state.history,
    writeHistory: async value => { state.history = structuredClone(value); },
    ...overrides,
  };
  return { state, options, service: createCompletionAlertService(options), message: { type: 'meowl:review-completed', reviewId: id, updatedAt: now, away: true } };
}
test('alerts are opt-in and suppressed for visible reviews or untrusted records', async () => {
  const f = fixture(); f.state.allowed = false;
  assert.equal((await f.service.complete(f.message, {})).status, 'disabled');
  assert.equal(f.state.authorized, 0);
  f.state.allowed = true; f.state.away = false;
  assert.equal((await f.service.complete(f.message, {})).status, 'skipped');
  f.state.away = true; f.state.record = null;
  assert.equal((await f.service.complete(f.message, {})).status, 'skipped');
  assert.equal(f.state.notifications.length, 0);
});
test('only a valid exact fresh saved revision can produce an alert', async () => {
  for (const changed of [{ reviewId: 'https://example.com' }, { updatedAt: 0 }, { away: false }, { updatedAt: now - 1 }]) {
    const f = fixture(); assert.equal((await f.service.complete({ ...f.message, ...changed }, {})).status, 'skipped');
    assert.equal(f.state.notifications.length, 0);
  }
  for (const changed of [{ stale: true }, { id: 'game-' + 'b'.repeat(64) }, { updatedAt: now - 600001 }, { updatedAt: now + 1001 }]) {
    const f = fixture(); Object.assign(f.state.record, changed);
    assert.equal((await f.service.complete({ ...f.message, updatedAt: f.state.record.updatedAt }, {})).status, 'skipped');
    assert.equal(f.state.notifications.length, 0);
  }
});
test('parallel completion messages and a worker restart notify only once per saved revision', async () => {
  const f = fixture();
  const replies = await Promise.all(Array.from({ length: 8 }, () => f.service.complete(f.message, {})));
  assert.equal(replies.filter(value => value.status === 'notified').length, 1);
  assert.equal(f.state.notifications.length, 1);
  assert.equal((await createCompletionAlertService(f.options).complete(f.message, {})).status, 'duplicate');
  assert.deepEqual(f.state.history, [[id, now]]);
  f.state.record.updatedAt++;
  assert.equal((await f.service.complete({ ...f.message, updatedAt: now + 1 }, {})).status, 'notified');
});
test('permission changes during verification suppress the notification', async () => {
  let allowedReads = 0;
  const f = fixture({ enabled: async () => ++allowedReads === 1 });
  assert.equal((await f.service.complete(f.message, {})).status, 'skipped');
  assert.equal(f.state.notifications.length, 0);
});
test('notification failure is not remembered as a successful alert', async () => {
  let attempts = 0;
  const f = fixture({ create: async () => { if (!attempts++) throw new Error('Notifications unavailable'); } });
  await assert.rejects(f.service.complete(f.message, {}), /unavailable/);
  assert.equal((await f.service.complete(f.message, {})).status, 'notified');
  assert.equal(attempts, 2);
});
test('notification click opens only its locally validated saved review', async () => {
  const f = fixture();
  await f.service.complete(f.message, {});
  const [notificationId, options] = f.state.notifications[0];
  assert.equal(options.type, 'basic'); assert.equal(options.silent, true);
  assert.match(options.message, /Alice vs Bob/);
  assert.equal((await f.service.click(notificationId)).status, 'opened');
  assert.deepEqual(f.state.opened, [id]); assert.deepEqual(f.state.cleared, [notificationId]);
  assert.equal((await f.service.click('meowl-review-https://example.com')).status, 'skipped');
  assert.equal((await f.service.click('meowl-review-game-' + 'b'.repeat(64))).status, 'skipped');
  f.state.record = null;
  assert.equal((await f.service.click(notificationId)).status, 'missing');
  assert.deepEqual(f.state.opened, [id]);
  f.state.allowed = false;
  assert.equal((await f.service.click(notificationId)).status, 'skipped');
});
test('notification helper sends only hidden, saved completion with minimal metadata', async () => {
  const sent = [], record = { id, updatedAt: now, result: { private: 'large result' } };
  const api = { runtime: { sendMessage: async value => { sent.push(value); return { status: 'notified' }; } } };
  assert.equal((await notifyReviewComplete(record, { api, hidden: false })).status, 'skipped');
  assert.equal((await notifyReviewComplete(null, { api, hidden: true })).status, 'skipped');
  assert.equal((await notifyReviewComplete(record, { api, hidden: true, token: 'frame-token' })).status, 'notified');
  assert.deepEqual(sent, [{ type: 'meowl:review-completed', reviewId: id, updatedAt: now, away: true, token: 'frame-token' }]);
  assert.equal((await notifyReviewComplete(record, { hidden: true, api: { runtime: { sendMessage: async () => { throw Error('Reloaded'); } } } })).status, 'unavailable');
});
function settingsFixture({ grant = true } = {}) {
  const listeners = () => ({ handlers: new Set(), addListener(fn) { this.handlers.add(fn); }, removeListener(fn) { this.handlers.delete(fn); } });
  const checkbox = new EventTarget(); checkbox.checked = false; checkbox.disabled = true;
  const status = { textContent: '' }, state = { stored: false, granted: false, prompts: 0 };
  const api = {
    storage: { local: { get: async () => ({ completionAlerts: state.stored }), set: async value => { state.stored = value.completionAlerts; } }, onChanged: listeners() },
    permissions: { contains: async () => state.granted, request: async () => { state.prompts++; return state.granted = grant; }, onRemoved: listeners() },
  };
  return { checkbox, status, state, api };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('setting requests optional permission only on enabling and persists the choice', async () => {
  const f = settingsFixture(); const cleanup = await installCompletionAlertSetting(f.checkbox, f.status, { api: f.api });
  assert.equal(f.state.prompts, 0); assert.equal(f.checkbox.disabled, false);
  f.checkbox.checked = true; f.checkbox.dispatchEvent(new Event('change'));
  assert.equal(f.state.prompts, 1, 'Permission request starts in the user gesture.');
  await settle(); assert.equal(f.state.stored, true); assert.equal(f.checkbox.checked, true);
  f.checkbox.checked = false; f.checkbox.dispatchEvent(new Event('change')); await settle();
  assert.equal(f.state.stored, false); assert.equal(f.state.prompts, 1);
  cleanup(); assert.equal(f.api.storage.onChanged.handlers.size, 0);
});
test('permission denial and later revocation leave the setting unchecked', async () => {
  const denied = settingsFixture({ grant: false }); await installCompletionAlertSetting(denied.checkbox, denied.status, { api: denied.api });
  denied.checkbox.checked = true; denied.checkbox.dispatchEvent(new Event('change')); await settle();
  assert.equal(denied.state.stored, false); assert.equal(denied.checkbox.checked, false); assert.match(denied.status.textContent, /not allowed/);
  const revoked = settingsFixture(); revoked.state.stored = revoked.state.granted = true;
  await installCompletionAlertSetting(revoked.checkbox, revoked.status, { api: revoked.api }); assert.equal(revoked.checkbox.checked, true);
  revoked.state.granted = false;
  for (const fn of revoked.api.permissions.onRemoved.handlers) fn({ permissions: ['notifications'] });
  await settle(); assert.equal(revoked.checkbox.checked, false);
});
