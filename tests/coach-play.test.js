import test from 'node:test';
import assert from 'node:assert/strict';
import { COACH_PLAY_ACTIONS, coachPlayAction, coachPlayPoseAt, createCoachPlayCycle } from '../extension/lib/coach-play.js';
import { resolveEvilPitchforkPose, coachPitchforkTransform } from '../extension/lib/coach-pitchfork.js';

test('each coach keeps a separate play sequence, without consecutive repeats', () => {
  const cycle = createCoachPlayCycle();
  const ids = Object.keys(COACH_PLAY_ACTIONS);
  assert.equal(ids.length, 7);
  for (const coach of ids) {
    const entries = Array.from({ length: 12 }, () => cycle.next(coach));
    assert.equal(new Set(entries.slice(0, 4).map(entry => entry.id)).size, 4);
    assert(entries.every((entry, i) => !i || entries[i - 1].id !== entry.id));
    assert(entries.every(entry => entry.durationMs >= 2000 && entry.durationMs <= 3200));
  }
  assert.equal(cycle.next('meowl').variant, 0);
  assert.equal(cycle.next('baby').variant, 0);
  assert.equal(cycle.next('meowl').variant, 1);
  cycle.clear();
  assert.equal(cycle.next('meowl').variant, 0);
});

test('all playful poses finish at rest and stay inside the rig without stretching or winking', () => {
  const limits = {
    mouth: [0, 1], blink: [0, 1], lookX: [-1, 1], lookY: [-1, 1],
    headTilt: [-.1, .1], headNod: [-8, 8], leftEar: [-.18, .18], rightEar: [-.18, .18],
    leftWing: [0, 1.35], rightWing: [0, 1.35], leftElbow: [-2.2, 2.2], rightElbow: [-2.2, 2.2],
    leftStep: [0, 28], rightStep: [0, 28], leftFoot: [-.3, .3], rightFoot: [-.3, .3],
    bodyX: [-18, 18], book: [0, 1], glasses: [0, 1], mug: [0, 1], mugLift: [0, 90],
    magnifier: [0, 1], glassAngle: [-.4, .4], pennant: [0, 1], flagFlutter: [-.4, .4],
  };
  for (const [coach, actions] of Object.entries(COACH_PLAY_ACTIONS)) for (const action of actions) {
    for (const time of [-100, 0, action.durationMs, action.durationMs + 100, NaN, Infinity]) {
      assert(Object.values(coachPlayPoseAt(time, coach, action.variant)).every(value => value === 0), `${action.id} must settle`);
    }
    for (let time = 0; time <= action.durationMs; time += 8) {
      const pose = coachPlayPoseAt(time, coach, action.variant);
      assert(Object.values(pose).every(Number.isFinite), `${action.id} finite`);
      for (const [key, [low, high]] of Object.entries(limits)) assert((pose[key] || 0) >= low && (pose[key] || 0) <= high, `${action.id}/${key}`);
      for (const key of ['winkLeft', 'winkRight', 'squash', 'bodyBend', 'breathe', 'blep', 'eyeSmile']) assert.equal(pose[key] || 0, 0);
      assert.equal(pose.mouth, 0, 'Real playback owns the mouth; silent play must not speak.');
    }
  }
});

test('every action has an actual paired blink and connected head or gaze attention', () => {
  const fingerprints = new Set();
  for (const [coach, actions] of Object.entries(COACH_PLAY_ACTIONS)) for (const action of actions) {
    const poses = Array.from({ length: 121 }, (_, i) => coachPlayPoseAt(action.durationMs * i / 120, coach, action.variant));
    assert(poses.some(pose => pose.blink >= .99), `${action.id} blinks`);
    assert(poses.some(pose => Math.abs(pose.headTilt || 0) > .01 || Math.abs(pose.headNod || 0) > 1), `${action.id} head follows`);
    assert(poses.some(pose => Math.abs(pose.lookX || 0) > .05 || Math.abs(pose.lookY || 0) > .05), `${action.id} attentive gaze`);
    fingerprints.add(JSON.stringify(poses));
  }
  assert.equal(fingerprints.size, 28, 'Each coach/action has an individually authored timeline.');
});

test('handheld props appear only once their carrying wings are raised', () => {
  for (const [coach, variant, prop] of [['owl', 1, 'book'], ['mellow', 1, 'mug'], ['scout', 1, 'magnifier'], ['paws', 3, 'pennant']]) {
    const action = coachPlayAction(coach, variant);
    for (let elapsed = 0; elapsed <= action.durationMs; elapsed += 10) {
      const pose = coachPlayPoseAt(elapsed, coach, variant);
      if ((pose[prop] || 0) < .5) continue;
      if (prop === 'book' || prop === 'mug') {
        assert(pose.leftElbow > 1.3 && pose.rightElbow > 1.3, `${prop}: both wings carry it`);
      } else if (prop === 'magnifier') assert(pose.rightWing > .35 && pose.rightElbow < -.4);
      else assert(pose.leftWing > .4 && pose.leftElbow < -.1);
    }
  }
});

test('Evil Meowl uses the free wing and retains the pitchfork grip throughout play', () => {
  const rest = coachPitchforkTransform(resolveEvilPitchforkPose());
  for (const action of COACH_PLAY_ACTIONS.evil) for (let elapsed = 0; elapsed <= action.durationMs; elapsed += 10) {
    const pose = coachPlayPoseAt(elapsed, 'evil', action.variant);
    assert.equal(pose.leftWing || 0, 0);
    assert.equal(pose.leftElbow || 0, 0);
    assert.deepEqual(coachPitchforkTransform(resolveEvilPitchforkPose(pose)), rest);
  }
});

test('malformed identities and takes fall back to a bounded existing action', () => {
  for (const coach of ['unknown', '__proto__', null]) {
    assert.equal(coachPlayAction(coach).id, 'meowl-scritches');
    assert.deepEqual(coachPlayPoseAt(300, coach), coachPlayPoseAt(300, 'meowl'));
  }
  assert.equal(coachPlayAction('baby', NaN).variant, 0);
  assert.equal(coachPlayAction('baby', -1).variant, 3);
  assert.equal(coachPlayAction('baby', 1000001).variant, 1);
});
