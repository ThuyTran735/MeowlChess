import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCoachAction } from '../extension/lib/coach-action-motion.js';

const coaches = ['meowl', 'owl', 'paws', 'mellow', 'scout'];
const kinds = ['signature', 'greeting', 'brilliant'];
const removed = ['winkLeft', 'winkRight', 'blep', 'eyeSmile', 'squash', 'bodyBend', 'leftFlop', 'rightFlop', 'breathe', 'leftReach', 'rightReach', 'hug', 'wing'];
const bounds = {
  mouth: [0, 1], blink: [0, 1], lookX: [-1, 1],
  leftWing: [0, 1.35], rightWing: [0, 1.35], leftElbow: [-2.2, 2.2], rightElbow: [-2.2, 2.2],
  leftFoot: [-.3, .3], rightFoot: [-.3, .3], leftStep: [0, 28], rightStep: [0, 28],
  leftEar: [-.18, .18], rightEar: [-.18, .18], headTilt: [-.1, .1], headNod: [-8, 8],
  bodyX: [-18, 18], lift: [-12, 6], tilt: [-.025, .025], book: [0, 1], pageTurn: [0, 1], glasses: [0, 1],
  feather: [0, 1], featherX: [-280, 280], featherY: [500, 900], featherAngle: [-1, 1],
};
const base = Object.freeze({
  mouth: .6, blink: .25, leftWing: .5, rightWing: .4, lift: -32, headNod: 12,
  ...Object.fromEntries(removed.map(key => [key, .8])),
});
const at = (coach, time, variation = 0, kind = 'signature') => applyCoachAction(kind, base, time, coach, variation);
const sequence = (coach, variation = 0, kind = 'signature') => Array.from({ length: 501 }, (_, i) => at(coach, i / 500, variation, kind));

test('every kind removes deformation, winks, tongue, and old reaching, including idle and talk', () => {
  for (const kind of [...kinds, 'talk', 'idle', 'think', 'encourage', 'approve', 'great', 'curious', 'celebrate', 'unknown']) {
    for (const coach of coaches) for (const progress of [0, .1, .27, .5, .73, .95, 1]) {
      const pose = applyCoachAction(kind, base, progress, coach);
      for (const key of removed) assert.equal(pose[key], 0, `${kind} cannot restore ${key} from an earlier layer.`);
      assert.equal(pose.lift || 0, 0, `${kind} cannot introduce a shared body bounce.`);
    }
  }
  assert.equal(base.breathe, .8);
  assert.equal(base.lift, -32);
});

test('articulated actions are finite, bounded, deterministic, and neutral at both ends', () => {
  for (const coach of coaches) for (const kind of kinds) for (const variation of [0, 1]) {
    const poses = sequence(coach, variation, kind);
    assert.deepEqual(poses, sequence(coach, variation, kind));
    for (const pose of poses) for (const [key, value] of Object.entries(pose)) {
      assert(Number.isFinite(value), `${coach} ${kind} ${key} stays finite.`);
      if (removed.includes(key)) continue;
      if (key === 'featherY' && value === 0) { assert(!(pose.feather > 0)); continue; }
      assert(value >= bounds[key][0] && value <= bounds[key][1], `${coach} ${kind} ${key} stays in range.`);
    }
    for (const progress of [-1, 0, 1, 2, NaN, Infinity, undefined]) {
      assert(Object.values(applyCoachAction(kind, base, progress, coach, variation)).every(value => value === 0));
    }
  }
});

test('Meowl watches the feather and its two swats coincide with opposite deflections', () => {
  const first = at('meowl', .255), second = at('meowl', .515);
  assert(first.feather > .99 && first.rightWing > 1.1 && first.leftWing < .15);
  assert.equal(first.featherX, 280);
  assert.equal(first.featherY, 650);
  assert(first.lookX > .9);
  assert(at('meowl', .3).featherX < first.featherX - 100);
  assert(at('meowl', .34).featherY < first.featherY - 70);
  assert(second.feather > .99 && second.leftWing > 1.19 && second.rightWing === 0);
  assert.equal(second.featherX, -280);
  assert.equal(second.featherY, 650);
  assert(second.lookX < -.9);
  assert(at('meowl', .57).featherX > second.featherX + 100);
  assert(at('meowl', .6).featherY < second.featherY - 100);
  assert(at('meowl', .68).leftStep > 21 && at('meowl', .68).rightStep === 0);
  assert(at('meowl', .8).rightStep > 23 && at('meowl', .8).leftStep === 0);
  assert(at('meowl', .88).leftEar > .16);
});

test('Professor indicates the book and turns one page forward before closing it', () => {
  const pointing = at('owl', .28), turning = at('owl', .53), finished = at('owl', .7);
  assert(pointing.book > .98 && pointing.rightWing > .34 && pointing.rightElbow > 1.69 && pointing.leftElbow > 1.84);
  assert.equal(pointing.pageTurn, 0);
  assert(turning.book > .97 && turning.pageTurn > .64 && turning.rightElbow > 2.04);
  assert.equal(finished.pageTurn, 1);
  let prior = 0;
  for (let tick = 1; tick < 1000; tick++) {
    const pose = at('owl', tick / 1000);
    if (pose.book > 0) { assert(pose.pageTurn >= prior); prior = pose.pageTurn; }
    if (tick > 930) assert.equal(pose.book, 0, 'The page resets only while its book is hidden.');
  }
  assert(sequence('owl').every(pose => !pose.leftStep && !pose.rightStep && !pose.feather));
});

test('Captain takes one step, presents the left wing, then flourishes the right wing', () => {
  assert(at('paws', .16).leftStep > 24 && at('paws', .16).rightStep === 0);
  const left = at('paws', .4), right = at('paws', .625);
  assert(left.leftWing > 1.15 && left.rightWing === 0);
  assert(right.rightWing > 1.23 && right.leftWing === 0);
  assert(right.rightElbow !== left.leftElbow, 'The two flourishes have different elbow articulation.');
  assert(sequence('paws').every(pose => !pose.book && !pose.feather && !pose.rightStep));
});

test('Mellow opens its rigid wings in sequence, yawns, then flicks its ears', () => {
  const left = at('mellow', .37), right = at('mellow', .465), yawn = at('mellow', .46);
  assert(left.leftWing > 1.04 && left.leftWing > left.rightWing);
  assert(right.rightWing > 1.22 && right.rightWing > right.leftWing);
  assert(yawn.mouth > .94 && yawn.headNod < -5);
  assert(at('mellow', .77).leftEar < -.16 && at('mellow', .84).leftEar > .08);
  assert(sequence('mellow').every(pose => !pose.bodyX && !pose.leftStep && !pose.rightStep && !pose.book && !pose.feather));
});

test('Scout perks its ears, searches with its eyes, takes alternating steps, then points', () => {
  assert(at('scout', .1).leftEar > .15);
  assert(at('scout', .145).rightEar < -.14);
  assert(at('scout', .19).lookX < -.9 && at('scout', .42).lookX > .9);
  assert(at('scout', .255).leftStep > 23 && at('scout', .255).rightStep === 0);
  assert(at('scout', .515).rightStep > 25 && at('scout', .515).leftStep === 0);
  assert(at('scout', .72).rightWing > .84 && at('scout', .72).rightElbow > .6);
  assert(sequence('scout').every(pose => !pose.book && !pose.feather));
});

test('steps keep one foot planted and articulated motion has no frame discontinuities', () => {
  const deltaLimits = { leftWing: .035, rightWing: .035, leftElbow: .04, rightElbow: .04, leftStep: .65, rightStep: .65, leftFoot: .012, rightFoot: .012, leftEar: .012, rightEar: .012, headTilt: .006, headNod: .4, bodyX: .5, lookX: .07, book: .035, pageTurn: .04, featherAngle: .05 };
  for (const coach of coaches) for (const variation of [0, 1]) {
    let prior = at(coach, 0, variation);
    for (let tick = 1; tick <= 1000; tick++) {
      const pose = at(coach, tick / 1000, variation);
      assert(!(pose.leftStep > .01 && pose.rightStep > .01), `${coach} cannot float with both feet stepping at once.`);
      for (const [key, limit] of Object.entries(deltaLimits)) {
        assert(Math.abs((pose[key] || 0) - (prior[key] || 0)) < limit, `${coach} ${key} has a smooth joint action at ${tick}.`);
      }
      if (pose.feather > .01 && prior.feather > .01) {
        assert(Math.abs(pose.featherX - prior.featherX) < 5);
        assert(Math.abs(pose.featherY - prior.featherY) < 5);
      }
      prior = pose;
    }
  }
});

test('the five routines differ and variations exchange the active side without random motion', () => {
  assert.equal(new Set(coaches.map(coach => JSON.stringify(sequence(coach)))).size, 5);
  for (const coach of coaches) for (const kind of [...kinds, 'talk']) {
    assert.notDeepEqual(sequence(coach, 0, kind), sequence(coach, 1, kind));
  }
  const mirrored = at('meowl', .255, 1);
  assert(mirrored.leftWing > 1.1 && mirrored.rightWing < .15);
  assert.equal(mirrored.featherX, -280);
  assert.equal(at('paws', .16, 1).leftStep, 0);
  assert(at('paws', .16, 1).rightStep > 24);
});

test('speech keeps mouth timing and uses only restrained wing, elbow, head, and ear gestures', () => {
  for (const coach of coaches) for (const variation of [0, 1]) for (let tick = 1; tick < 100; tick++) {
    const pose = applyCoachAction('talk', base, tick / 100, coach, variation);
    assert.equal(pose.mouth, base.mouth);
    assert.equal(pose.blink, base.blink);
    assert(pose.leftWing <= .24 && pose.rightWing <= .24);
    assert(Math.abs(pose.leftElbow) <= .35 && Math.abs(pose.rightElbow) <= .35);
    for (const key of ['bodyX', 'lift', 'tilt', 'leftStep', 'rightStep', 'book', 'pageTurn', 'feather', ...removed]) assert.equal(pose[key], 0);
  }
});

test('invalid input cannot leak unsafe values and unrecognized coaches use normal Meowl', () => {
  assert.deepEqual(at('unknown', .4), at('meowl', .4));
  assert.deepEqual(applyCoachAction('signature', base, .4, 'meowl', NaN), at('meowl', .4));
  const bad = { leftWing: Infinity, rightElbow: 500, leftEar: NaN, headNod: -500, feather: 0, featherY: 700, squash: 1, winkLeft: 1, invented: 2 };
  const safe = applyCoachAction('unknown', bad, .4);
  assert.equal(safe.leftWing, 0);
  assert.equal(safe.rightElbow, 2.2);
  assert.equal(safe.leftEar, 0);
  assert.equal(safe.headNod, -8);
  assert.equal(safe.featherY, 0);
  assert.equal(safe.squash, 0);
  assert.equal(safe.winkLeft, 0);
  assert(!Object.hasOwn(safe, 'invented'));
  assert(Object.values(applyCoachAction('signature', null, .4)).every(Number.isFinite));
  assert.equal(bad.rightElbow, 500);
});

test('legacy shared-wing acknowledgements retain both articulated wings without overriding an explicit side', () => {
  const both = applyCoachAction('celebrate', { wing: .3, mouth: .4 }, .4);
  assert.equal(both.leftWing, .3);
  assert.equal(both.rightWing, .3);
  assert.equal(both.wing, 0);
  const asymmetric = applyCoachAction('celebrate', { wing: .3, rightWing: .1 }, .4);
  assert.equal(asymmetric.leftWing, .3);
  assert.equal(asymmetric.rightWing, .1);
  const invalid = applyCoachAction('celebrate', { wing: Infinity }, .4);
  assert.equal(invalid.leftWing, 0);
  assert.equal(invalid.rightWing, 0);
});
