import test from 'node:test';
import assert from 'node:assert/strict';
import { personalizeCoachPose } from '../extension/lib/coach-character-motion.js';

const coaches = ['meowl', 'owl', 'paws', 'mellow', 'scout'];
const reactions = ['talk', 'brilliant', 'celebrate', 'great', 'curious', 'greeting', 'idle', 'encourage', 'approve', 'think'];
const base = Object.freeze({ mouth: .6, blink: .2, breathe: .8, wing: .2, leftWing: .1, rightWing: .3, lift: -20, tilt: -.025, headTilt: 0, headNod: 0 });

test('character gestures stay finite, bounded, and neutral at both ends', () => {
  for (const coach of coaches) for (const kind of reactions) {
    for (const progress of [-1, 0, 1, 2, Infinity, NaN, undefined]) {
      assert(Object.values(personalizeCoachPose(kind, base, progress, coach)).every(value => value === 0));
    }
    for (let tick = 1; tick < 100; tick++) {
      const pose = personalizeCoachPose(kind, base, tick / 100, coach);
      assert(Object.values(pose).every(Number.isFinite));
      for (const key of ['mouth', 'blink', 'breathe']) assert(pose[key] >= 0 && pose[key] <= 1);
      for (const key of ['wing', 'leftWing', 'rightWing']) assert(pose[key] >= 0 && pose[key] < .75);
      assert(pose.lift >= -45 && pose.lift <= 12);
      assert(Math.abs(pose.tilt) < .05);
      assert(Math.abs(pose.headTilt) <= .09);
      assert(Math.abs(pose.headNod) <= 10);
    }
  }
});

test('the five coaches have distinct conversation and celebration mannerisms', () => {
  for (const kind of reactions.filter(kind => kind !== 'idle')) {
    const poses = coaches.map(coach => JSON.stringify(personalizeCoachPose(kind, base, .37, coach)));
    assert.equal(new Set(poses).size, 5, `Each coach is recognizable during ${kind}.`);
  }
  const professor = personalizeCoachPose('talk', { mouth: .6, leftWing: .06, tilt: .01 }, .4, 'owl');
  assert(professor.rightWing > .1 && professor.lift > 0 && professor.lift <= 3);
  const captain = personalizeCoachPose('brilliant', base, .37, 'paws');
  const mellow = personalizeCoachPose('brilliant', base, .37, 'mellow');
  assert(captain.lift < base.lift && mellow.lift > base.lift);
  assert(captain.wing > base.wing && mellow.wing < base.wing);
  assert(personalizeCoachPose('curious', base, .3, 'scout').tilt < 0);
  assert(personalizeCoachPose('curious', base, .7, 'scout').tilt > 0);
});

test('every speaking, feedback, and thinking reaction articulates the head independently', () => {
  for (const coach of coaches) for (const kind of reactions.filter(kind => kind !== 'idle')) {
    const sequence = Array.from({ length: 201 }, (_, index) => personalizeCoachPose(kind, {}, index / 200, coach));
    assert(sequence.some(pose => Math.abs(pose.headTilt || 0) > .01), `${coach} ${kind} has a readable head gesture.`);
    assert(sequence.some(pose => Math.abs(pose.headNod || 0) > 1), `${coach} ${kind} has a deliberate nod or chin lift.`);
    for (let index = 1; index < sequence.length; index++) {
      assert(Math.abs((sequence[index].headTilt || 0) - (sequence[index - 1].headTilt || 0)) < .006, `${coach} ${kind} cannot snap its head.`);
      assert(Math.abs((sequence[index].headNod || 0) - (sequence[index - 1].headNod || 0)) < .6, `${coach} ${kind} cannot snap its nod.`);
    }
    for (const progress of [.0001, .9999]) {
      const pose = personalizeCoachPose(kind, {}, progress, coach);
      assert.equal(pose.headTilt || 0, 0);
      assert.equal(pose.headNod || 0, 0);
    }
  }
});

test('gestures communicate the coach personalities without adding a continuous bounce', () => {
  const professorFirst = personalizeCoachPose('approve', {}, .3, 'owl');
  const professorBetween = personalizeCoachPose('approve', {}, .48, 'owl');
  const professorSecond = personalizeCoachPose('approve', {}, .68, 'owl');
  assert(professorFirst.headNod > 5);
  assert.equal(professorBetween.headNod, 0);
  assert(professorSecond.headNod > 3);

  assert(personalizeCoachPose('think', {}, .3, 'scout').headTilt < -.06);
  assert(personalizeCoachPose('think', {}, .7, 'scout').headTilt > .04);
  const mellow = personalizeCoachPose('encourage', {}, .5, 'mellow');
  const captain = personalizeCoachPose('approve', {}, .4, 'paws');
  assert(mellow.headTilt > .05 && mellow.leftWing < .08);
  assert(captain.rightWing > .2);
  assert(!Object.hasOwn(mellow, 'lift'));
  assert(!Object.hasOwn(captain, 'lift'));
});

test('idle mannerisms remain silent blinks and breathing, and input stays unchanged', () => {
  const idle = Object.freeze({ blink: .5, breathe: .6 });
  for (const coach of coaches) {
    const pose = personalizeCoachPose('idle', idle, .4, coach);
    assert.deepEqual(Object.keys(pose).sort(), ['blink', 'breathe']);
    assert.notEqual(pose, idle);
  }
  assert.deepEqual(idle, { blink: .5, breathe: .6 });
  const before = JSON.stringify(base);
  for (const coach of coaches) personalizeCoachPose('greeting', base, .4, coach);
  assert.equal(JSON.stringify(base), before);
});

test('unknown coaches use the regular Meowl and malformed poses cannot leak invalid values', () => {
  assert.deepEqual(personalizeCoachPose('talk', base, .4, 'invalid'), personalizeCoachPose('talk', base, .4, 'meowl'));
  assert.deepEqual(personalizeCoachPose('talk', null, .4), {});
  const malformed = { mouth: Infinity, blink: NaN, wing: 500, lift: -900, tilt: .9, headTilt: 10, headNod: -999, invented: 2 };
  const safe = personalizeCoachPose('unknown', malformed, .5, 'meowl');
  assert.deepEqual(safe, { mouth: 0, blink: 0, wing: .7, lift: -45, tilt: .045, headTilt: .09, headNod: -10 });
  assert.equal(malformed.wing, 500);
});
