import test from 'node:test';
import assert from 'node:assert/strict';
import { coachPoseAt, COACH_REACTION_DURATIONS } from '../extension/lib/coach-puppet.js';

test('all coach reactions have finite bounded poses and settle to the original portrait', () => {
  for (const coachId of ['meowl','owl','paws','mellow','scout']) for (const [kind,duration] of Object.entries(COACH_REACTION_DURATIONS)) {
    for (const time of [-100,0,duration,duration+200,Infinity,NaN]) {
      assert(Object.values(coachPoseAt(kind,time,coachId)).every(value=>value===0), `${kind}/${coachId} neutral at ${time}`);
    }
    for (let time=0;time<=duration;time+=10) {
      const pose=coachPoseAt(kind,time,coachId);
      assert(Object.values(pose).every(Number.isFinite));
      for (const key of ['mouth','blink','breathe']) assert((pose[key]||0)>=0&&(pose[key]||0)<=1,`${kind} ${key} bounded`);
      for (const key of ['wing','leftWing','rightWing']) assert((pose[key]||0)>=0&&(pose[key]||0)<.75,`${kind} wing bounded`);
      assert(Math.abs(pose.tilt||0)<.05);
      assert((pose.lift||0)>=-60&&(pose.lift||0)<=15);
    }
  }
});

test('greetings wave one wing, curiosity stays grounded, and idle stays quiet', () => {
  const greeting=coachPoseAt('greeting',620);
  assert(greeting.rightWing>.5); assert.equal(greeting.leftWing,undefined);
  for (let time=0;time<1600;time+=40) {
    const pose=coachPoseAt('curious',time);
    assert.equal(pose.lift,undefined); assert.equal(pose.wing,undefined);
  }
  const idle=coachPoseAt('idle',330);
  assert(idle.blink>.9&&idle.breathe>.5);
  assert.deepEqual(Object.keys(idle).sort(),['blink','breathe']);
});

test('coach personalities have distinct timing without changing the source drawing', () => {
  assert.notDeepEqual(coachPoseAt('greeting',450,'owl'),coachPoseAt('greeting',450,'paws'));
  const pose=coachPoseAt('talk',300);pose.mouth=200;
  assert(coachPoseAt('talk',300).mouth<=1);
  assert.deepEqual(coachPoseAt('talk',200,'unknown'),coachPoseAt('talk',200,'meowl'));
});
