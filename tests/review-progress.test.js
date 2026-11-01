import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewProgressEstimator } from '../extension/lib/review-progress.js';

test('startup and invalid progress remain unknown rather than guessing completion', () => {
  const estimate = createReviewProgressEstimator();
  const initial = { phase: 'starting', remainingMs: null, text: 'Estimating time…', complete: false };
  for (const event of [undefined, null, {}, { total: 0, completed: 0 }, { total: 10, completed: -1 }, { total: 10, completed: 11 }, { total: Infinity, completed: 1 }, { total: 10, completed: NaN }, { total: '10', completed: 1 }, { total: 10, completed: 1, phase: 'saving' }]) {
    assert.deepEqual(estimate.update(event), initial);
  }
});

test('smart first-pass estimate excludes reserved rechecks and engine startup', () => {
  const estimate = createReviewProgressEstimator({ moveTimeMs: 3000, smartAnalysis: true, now: () => 12000 });
  const value = estimate.update({ phase: 'scan', completed: 1, total: 116, phaseCompleted: 1, phaseTotal: 100 });
  assert.equal(value.remainingMs, 99 * 150);
  assert.equal(value.text, 'About 15 sec left in first pass');
  assert.equal(value.complete, false);
});

test('estimates adapt to observed throughput across batched progress events', () => {
  let clock = 10000;
  const estimate = createReviewProgressEstimator({ moveTimeMs: 150, now: () => clock });
  estimate.update({ completed: 1, total: 100 });
  clock += 5000;
  const first = estimate.update({ completed: 11, total: 100 });
  assert(first.remainingMs > 89 * 150 && first.remainingMs < 89 * 500);
  clock += 5000;
  const second = estimate.update({ completed: 21, total: 100 });
  assert(second.remainingMs / 79 > first.remainingMs / 89, 'Continued slower work increases the measured cost per position.');
  assert(second.remainingMs < 79 * 500, 'Smoothing avoids immediately jumping to one sample.');
});

test('duplicate events do not restart the clock or generate an artificial countdown', () => {
  let clock = 0;
  const estimate = createReviewProgressEstimator({ moveTimeMs: 500, now: () => clock });
  estimate.update({ completed: 0, total: 20 });
  clock = 2500;
  const value = estimate.update({ completed: 5, total: 20 });
  assert.equal(value.remainingMs, 7500);
  clock = 10000;
  assert.deepEqual(estimate.update({ completed: 5, total: 20 }), value);
  clock = 10500;
  const afterDelay = estimate.update({ completed: 6, total: 20 });
  assert(afterDelay.remainingMs > value.remainingMs, 'A real delay is reflected when completed work next advances.');
});

test('recheck starts a separate estimate using actual selected positions and deeper timing', () => {
  let clock = 0;
  const estimate = createReviewProgressEstimator({ moveTimeMs: 3000, smartAnalysis: true, now: () => clock });
  estimate.update({ phase: 'scan', phaseCompleted: 1, phaseTotal: 100, completed: 1, total: 116 });
  clock = 14850;
  const scanDone = estimate.update({ phase: 'scan', phaseCompleted: 100, phaseTotal: 100, completed: 100, total: 116 });
  assert.equal(scanDone.text, 'Choosing key moves to recheck…'); assert.equal(scanDone.complete, false); assert.equal(scanDone.remainingMs, null);
  clock = 16000;
  const recheck = estimate.update({ phase: 'recheck', phaseCompleted: 0, phaseTotal: 4, completed: 100, total: 104 });
  assert.equal(recheck.remainingMs, 12000); assert.equal(recheck.text, 'About 15 sec left in recheck');
  clock = 19000;
  const next = estimate.update({ phase: 'recheck', phaseCompleted: 1, phaseTotal: 4, completed: 101, total: 104 });
  assert.equal(next.remainingMs, 9000);
  clock = 28000;
  const done = estimate.update({ phase: 'recheck', phaseCompleted: 4, phaseTotal: 4, completed: 104, total: 104 });
  assert.equal(done.text, 'Finishing review…'); assert.equal(done.complete, true); assert.equal(done.remainingMs, null);
});

test('smart analysis with no selected rechecks finishes without showing zero seconds', () => {
  const estimate = createReviewProgressEstimator({ smartAnalysis: true });
  estimate.update({ phase: 'scan', phaseCompleted: 5, phaseTotal: 5, completed: 5, total: 9 });
  const done = estimate.update({ phase: 'complete', phaseCompleted: 0, phaseTotal: 0, completed: 5, total: 5 });
  assert.deepEqual(done, { phase: 'complete', remainingMs: null, text: 'Finishing review…', complete: true });
  assert.deepEqual(estimate.update({ completed: 1, total: 50 }), done, 'A finished estimator cannot be reused by a later run.');
  assert.equal(createReviewProgressEstimator().update().text, 'Estimating time…');
});

test('fast terminal positions keep positive estimates until analysis work is finished', () => {
  const estimate = createReviewProgressEstimator({ moveTimeMs: 50, now: () => 0 });
  const first = estimate.update({ completed: 1, total: 3 });
  const second = estimate.update({ completed: 2, total: 3 });
  assert(first.remainingMs > 0 && second.remainingMs > 0);
  assert.equal(second.text, 'About 1 sec left');
  const done = estimate.update({ completed: 3, total: 3 });
  assert.equal(done.remainingMs, null); assert.equal(done.text, 'Finishing review…');
});

test('regressing progress and old phase callbacks cannot corrupt the current estimate', () => {
  let clock = 1000;
  const estimate = createReviewProgressEstimator({ smartAnalysis: true, now: () => clock });
  const current = estimate.update({ phase: 'scan', phaseCompleted: 5, phaseTotal: 10 });
  clock = 3000;
  assert.deepEqual(estimate.update({ phase: 'scan', phaseCompleted: 4, phaseTotal: 10 }), current);
  const recheck = estimate.update({ phase: 'recheck', phaseCompleted: 0, phaseTotal: 3 });
  assert.deepEqual(estimate.update({ phase: 'scan', phaseCompleted: 10, phaseTotal: 10 }), recheck);
});

test('unavailable or backwards clocks never expose NaN, negative values, or zero-second promises', () => {
  let clock = 1000;
  const estimate = createReviewProgressEstimator({ moveTimeMs: NaN, now: () => clock });
  estimate.update({ completed: 1, total: 10 });
  for (const [completed, stamp] of [[2, 500], [3, NaN], [4, Infinity], [5, 1000]]) {
    clock = stamp;
    const value = estimate.update({ completed, total: 10 });
    assert(Number.isFinite(value.remainingMs) && value.remainingMs > 0);
    assert.doesNotMatch(value.text, /NaN|Infinity|About 0/);
  }
  const throwing = createReviewProgressEstimator({ now: () => { throw new Error('Clock unavailable'); } });
  assert.equal(throwing.update({ completed: 1, total: 10 }).remainingMs, 1350);
});

test('configured thinking time is normalized and long estimates stay readable', () => {
  const minimum = createReviewProgressEstimator({ moveTimeMs: 1, now: () => 0 });
  assert.equal(minimum.update({ completed: 0, total: 10 }).remainingMs, 500);
  const maximum = createReviewProgressEstimator({ moveTimeMs: 999999, now: () => 0 });
  assert.equal(maximum.update({ completed: 0, total: 1000 }).text, 'About 2 hr left');
  const fastRecheck = createReviewProgressEstimator({ moveTimeMs: 50, smartAnalysis: true, now: () => 0 });
  assert.equal(fastRecheck.update({ phase: 'recheck', phaseCompleted: 0, phaseTotal: 10 }).remainingMs, 5000);
});
