import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachIdleCycle } from '../extension/lib/coach-idle-cycle.js';

test('all 32 idle actions appear once before repeating, including across bag boundaries', () => {
  let seed = 31;
  const cycle = createCoachIdleCycle(() => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646);
  let previous = -1;
  for (let round = 0; round < 12; round++) {
    const actions = [];
    for (let index = 0; index < 32; index++) {
      const action = cycle.next('meowl', 32);
      assert.notEqual(action, previous);
      actions.push(action); previous = action;
    }
    assert.equal(new Set(actions).size, 32);
    assert.deepEqual(actions.slice().sort((a, b) => a - b), Array.from({ length: 32 }, (_, index) => index));
  }
});

test('coach switches preserve each individual bag and resizing discards obsolete indexes', () => {
  const cycle = createCoachIdleCycle(() => .5);
  const sets = new Map(['meowl', 'owl', 'paws', 'mellow', 'scout'].map(id => [id, new Set()]));
  for (let index = 0; index < 32; index++) for (const [id, seen] of sets) seen.add(cycle.next(id, 32));
  for (const seen of sets.values()) assert.equal(seen.size, 32);
  for (let index = 0; index < 20; index++) assert(cycle.next('meowl', 3) < 3);
  cycle.clear();
  assert.equal(cycle.next('meowl', 1), 0);
});
