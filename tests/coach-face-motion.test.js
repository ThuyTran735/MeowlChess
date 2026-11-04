import test from 'node:test';
import assert from 'node:assert/strict';
import { animateCoachFace } from '../extension/lib/coach-face-motion.js';
import { applyCoachRepertoire, COACH_ANIMATION_LABELS } from '../extension/lib/coach-repertoire.js';
import { coachPoseAt, COACH_REACTION_DURATIONS } from '../extension/lib/coach-puppet.js';

const coaches = ['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil'];
const limits = { lookX: [-1, 1], lookY: [-1, 1], headTilt: [-.1, .1], headNod: [-8, 8], blink: [0, 1] };
const face = (pose, coach, time = .45, kind = 'signature', take = 0) => animateCoachFace(kind, pose, time, coach, take);

test('facial coordination leaves speech, props and all rigid body channels intact', () => {
  const pose = Object.freeze({ mouth: .63, book: .8, pageTurn: .3, leftWing: .57, rightWing: .59, leftElbow: 2, rightElbow: 1.9, bodyX: 7, headTilt: -.02, lookX: -.15 });
  const result = face(pose, 'owl');
  assert.notEqual(result, pose);
  for (const [key, value] of Object.entries(pose)) if (!(key in limits)) assert.equal(result[key], value, `${key} belongs to the existing action.`);
  assert.equal(pose.headTilt, -.02); assert.equal(pose.lookX, -.15);
  for (const key of ['winkLeft', 'winkRight', 'squash', 'bodyBend', 'eyeScale', 'eyeSmile']) assert.equal(result[key] || 0, 0);
});

test('Professor looks down at the book and follows a turning sheet across the spread', () => {
  const reading = face({ book: 1 }, 'owl');
  assert(reading.lookY > .65); assert(reading.headNod > 4);
  const rightPage = face({ book: 1, pageTurn: .25 }, 'owl');
  const leftPage = face({ book: 1, pageTurn: .75 }, 'owl');
  assert(rightPage.lookX > .1 && leftPage.lookX < -.1);
  assert(rightPage.headTilt > 0 && leftPage.headTilt < 0);
  assert(rightPage.lookY > .5 && leftPage.lookY > .5, 'Page tracking stays on the book, below the face.');
  const early = face({ book: .12 }, 'owl');
  assert(early.lookY > 0 && Math.abs(early.headNod) < .05, 'Eyes anticipate before the head follows the emerging book.');
});

test('Mellow follows a rising cup and raises the chin instead of looking through it', () => {
  const low = face({ mug: 1, mugLift: 0 }, 'mellow');
  const middle = face({ mug: 1, mugLift: 35 }, 'mellow');
  const high = face({ mug: 1, mugLift: 70 }, 'mellow');
  assert(low.lookY > middle.lookY && middle.lookY > high.lookY);
  assert(low.headNod > middle.headNod && middle.headNod > high.headNod);
  assert(low.lookY > .6 && high.lookY < .25);
});

test('Meowl follows the feather in both axes with a matching head turn', () => {
  const leftHigh = face({ feather: 1, featherX: -240, featherY: 520 }, 'meowl');
  const rightLow = face({ feather: 1, featherX: 240, featherY: 820 }, 'meowl');
  assert(leftHigh.lookX < -.6 && rightLow.lookX > .6);
  assert(leftHigh.headTilt < -.04 && rightLow.headTilt > .04);
  assert(rightLow.lookY - leftHigh.lookY > .6);
  assert(rightLow.headNod > leftHigh.headNod + 3);
});

test('Scout and Captain attend their own held objects rather than sharing a generic gaze', () => {
  const lensLeft = face({ magnifier: 1, rightWing: .5, glassAngle: -.3 }, 'scout');
  const lensRight = face({ magnifier: 1, rightWing: .5, glassAngle: .3 }, 'scout');
  assert(lensLeft.lookX > 0 && lensRight.lookX > lensLeft.lookX + .2);
  const lowLens = face({ magnifier: 1, rightWing: .2 }, 'scout');
  const highLens = face({ magnifier: 1, rightWing: 1 }, 'scout');
  assert(lowLens.lookY > highLens.lookY + .5);
  const flag = face({ pennant: 1, leftWing: 1 }, 'paws');
  assert(flag.lookX < -.4 && flag.lookY < -.4 && flag.headTilt < -.03 && flag.headNod < -1.5);
});

test('a raised wing gains attention, while an existing deliberate glance remains deliberate', () => {
  const wave = face({ rightWing: 1 }, 'meowl');
  assert(wave.lookX > .4 && wave.headTilt > .04 && wave.lookY < 0);
  const scan = face({ rightWing: 1, lookX: -.85, headTilt: -.08 }, 'scout');
  assert.equal(scan.lookX, -.85); assert.equal(scan.headTilt, -.08);
  const both = face({ rightWing: 1, leftWing: 1 }, 'meowl');
  assert.equal(both.lookX, 0, 'Two equally raised wings do not arbitrarily pull attention to one side.');
});

test('talking preserves every mouth frame, paired blinks settle, and idle has no added generic bob', () => {
  for (const coach of coaches) for (let index = 0; index <= 100; index++) {
    const time = index / 100, mouth = Math.sin(Math.PI * time) ** 2;
    assert.equal(animateCoachFace('talk', { mouth }, time, coach, index % 3).mouth, mouth);
  }
  for (const time of [.1, .3, .5, .7, .9]) {
    const idle = animateCoachFace('idle', {}, time, 'meowl');
    assert.equal(idle.headTilt, 0); assert.equal(idle.headNod, 0, 'Quiet eye motion adds no generic head bob.');
  }
  const blinkFrames = Array.from({ length: 201 }, (_, index) => animateCoachFace('think', {}, index / 200, 'owl'));
  assert(blinkFrames.some(pose => pose.blink > .95));
  assert(blinkFrames.filter(pose => pose.blink > .1).length < 45, 'The attention blink closes briefly rather than holding a squint.');
  assert(blinkFrames.every(pose => !pose.winkLeft && !pose.winkRight));
});

test('face endpoints are exact, invalid inputs are finite, and variation is deterministic', () => {
  const base = { lookX: 99, lookY: -99, headTilt: NaN, headNod: Infinity, blink: 8, winkLeft: 1, winkRight: 1, mouth: .4 };
  for (const progress of [-1, 0, 1, 2, NaN, Infinity, undefined]) {
    const result = animateCoachFace('signature', base, progress, 'owl');
    assert(Object.keys(limits).every(key => result[key] === 0));
    assert.equal(result.mouth, .4);
  }
  for (const progress of [.001, .15, .4, .75, .999]) {
    const result = face(base, 'unknown', progress, 'think', NaN);
    for (const [key, [low, high]] of Object.entries(limits)) assert(Number.isFinite(result[key]) && result[key] >= low && result[key] <= high);
    assert.equal(result.winkLeft, 0); assert.equal(result.winkRight, 0);
    assert.deepEqual(result, face(base, 'meowl', progress, 'think', 0));
  }
  assert.deepEqual(face({}, 'meowl', .4, 'talk', 4), face({}, 'meowl', .4, 'talk', 4));
  assert.notDeepEqual(face({}, 'meowl', .4, 'talk', 1), face({}, 'meowl', .4, 'talk', 4), 'Eye timing no longer aliases every third variation.');
});

test('all 420 takes retain a clearly closed paired blink at 12 fps, including shifted sampling', () => {
  let takes = 0;
  for (const coach of coaches) for (const [kind, entries] of Object.entries(COACH_ANIMATION_LABELS)) {
    const duration = COACH_REACTION_DURATIONS[kind];
    for (let take = 0; take < entries[coach].length; take++) {
      for (let phase = 0; phase < 8; phase++) {
        let closed = 0;
        for (let elapsed = phase * 1000 / 96; elapsed < duration; elapsed += 1000 / 12) {
          const pose = coachPoseAt(kind, elapsed, coach, take);
          closed = Math.max(closed, pose.blink);
          assert.equal(pose.winkLeft || 0, 0); assert.equal(pose.winkRight || 0, 0);
        }
        assert(closed > .97, `${coach}/${kind}/${take}, sample phase ${phase}: closure ${closed}`);
      }
      takes++;
    }
  }
  assert.equal(takes, 420);
});

test('one natural blink replaces stacked closures and keeps a real-time duration', () => {
  for (const duration of [1100, 2400, 6000]) for (const coach of coaches) {
    let active = false, closures = 0, visibleMs = 0;
    for (let elapsed = 0; elapsed <= duration; elapsed += 2) {
      const pose = animateCoachFace('talk', { blink: Math.sin(elapsed / 100) ** 2, mouth: .37 }, elapsed / duration, coach, 17, duration);
      if (pose.blink > .5 && !active) closures++;
      active = pose.blink > .5;
      if (pose.blink > .05) visibleMs += 2;
      assert.equal(pose.mouth, .37);
    }
    assert.equal(closures, 1, `${coach}/${duration} keeps one paired closure, not rapid double blinking.`);
    assert(visibleMs > 180 && visibleMs < 340, `${coach}/${duration} blink lasts ${visibleMs} ms.`);
  }
});

test('all 40 idle variations have deterministic eye timing and purposeful quiet glances', () => {
  for (const coach of coaches) {
    const timelines = new Set();
    for (let take = 0; take < 40; take++) {
      const timeline = [];
      let glance = 0;
      for (let step = 0; step <= 240; step++) {
        const pose = animateCoachFace('idle', {}, step / 240, coach, take, 2400);
        timeline.push(Math.round(pose.blink * 100));
        glance = Math.max(glance, Math.hypot(pose.lookX, pose.lookY));
        assert.equal(pose.headTilt, 0); assert.equal(pose.headNod, 0);
      }
      assert(glance > .15 && glance < .4, `${coach}/${take} gets a small quiet glance.`);
      timelines.add(timeline.join(','));
    }
    assert(timelines.size >= 35, `${coach} uses ${timelines.size} eye timelines across 40 idles, not a three-take loop.`);
  }
});

test('authored prop and gesture timelines remain bounded and have no sharp new face steps', () => {
  const maximumStep = { lookX: .16, lookY: .16, headTilt: .02, headNod: 1.7, blink: .28 };
  for (const [kind, entries] of Object.entries(COACH_ANIMATION_LABELS)) for (const coach of coaches) {
    for (let take = 0; take < entries[coach].length; take++) {
      let previous;
      for (let index = 0; index <= 400; index++) {
        const time = index / 400;
        const raw = applyCoachRepertoire(kind, {}, time, coach, take);
        const result = animateCoachFace(kind, raw, time, coach, take);
        for (const [key, [low, high]] of Object.entries(limits)) {
          assert(Number.isFinite(result[key]) && result[key] >= low && result[key] <= high, `${coach}/${kind}/${take}/${key} stays bounded.`);
          if (previous) assert(Math.abs(result[key] - previous[key]) < maximumStep[key], `${coach}/${kind}/${take}/${time}/${key} has an abrupt frame.`);
        }
        previous = result;
      }
    }
  }
});
