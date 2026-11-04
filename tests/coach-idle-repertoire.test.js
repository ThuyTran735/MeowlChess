import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCoachIdleRepertoire, COACH_IDLE_REPERTOIRE, COACH_IDLE_LABELS, COACH_IDLE_TAKE_COUNTS,
} from '../extension/lib/coach-idle-repertoire.js';
import {
  applyCoachRepertoire, COACH_ANIMATION_LABELS, COACH_ANIMATION_TAKE_COUNTS, coachAnimationTakeCount,
} from '../extension/lib/coach-repertoire.js';

const coaches=['meowl','owl','paws','mellow','scout'];
const forbidden=['mouth','winkLeft','winkRight','blep','eyeSmile','squash','bodyBend','leftFlop','rightFlop','breathe','leftReach','rightReach','hug','wing'];
const samples=(coach,take,count=81)=>Array.from({length:count},(_,i)=>applyCoachIdleRepertoire(i/(count-1),coach,take));
const peak=(poses,key)=>Math.max(...poses.map(pose=>pose[key]||0));

test('each coach has 40 frozen, accurately connected idle entries and dynamic take counts',()=>{
  assert(Object.isFrozen(COACH_IDLE_REPERTOIRE));
  assert(Object.isFrozen(COACH_IDLE_LABELS));
  assert(Object.isFrozen(COACH_IDLE_TAKE_COUNTS));
  assert(Object.isFrozen(COACH_ANIMATION_TAKE_COUNTS));
  for(const coach of coaches){
    const entries=COACH_IDLE_REPERTOIRE[coach];
    assert.equal(entries.length,40);assert(Object.isFrozen(entries));
    assert.equal(new Set(entries.map(entry=>entry.label)).size,40);
    assert.deepEqual(COACH_IDLE_LABELS[coach],entries.map(entry=>entry.label));
    assert.equal(COACH_ANIMATION_LABELS.idle[coach],COACH_IDLE_LABELS[coach]);
    assert.equal(COACH_IDLE_TAKE_COUNTS[coach],40);
    assert.equal(coachAnimationTakeCount('idle',coach),40);
    for(const [kind,counts]of Object.entries(COACH_ANIMATION_TAKE_COUNTS)){
      assert(Object.isFrozen(counts));assert.equal(counts[coach],kind==='idle'?40:3);
    }
    for(const entry of entries){
      assert(Object.isFrozen(entry));assert(Object.isFrozen(entry.beats));
      assert(entry.label.length>7);assert(entry.beats.length>=1&&entry.beats.length<=3);
      for(const beat of entry.beats){
        assert(Object.isFrozen(beat));assert(beat.start>0&&beat.end<1&&beat.end>beat.start);
        assert((beat.end-beat.start)*2400>=800,'An action has enough screen time to read.');
      }
    }
  }
  assert.equal(coachAnimationTakeCount('idle','unknown'),40);
  assert.equal(coachAnimationTakeCount('unknown','meowl'),0);
});

test('idle programs use distinct authored behavior sequences, not renamed amplitude variants',()=>{
  for(const coach of coaches){
    const entries=COACH_IDLE_REPERTOIRE[coach];
    const sequences=entries.map(entry=>entry.beats.map(beat=>beat.action).join(' / '));
    assert.equal(new Set(sequences).size,40,`${coach} has a different action sequence for every idle.`);
    const vocabulary=new Set(entries.flatMap(entry=>entry.beats.map(beat=>beat.action)));
    assert(vocabulary.size>=14,`${coach} has a broad body-language vocabulary.`);
    const visiblyDifferent=entries.map((_,take)=>JSON.stringify(samples(coach,take,49).map(pose=>
      Object.fromEntries(Object.entries(pose).map(([key,value])=>[key,Math.round(value*100)/100]))
    )));
    assert.equal(new Set(visiblyDifferent).size,40,`${coach} differs at visible precision, not floating-point noise.`);
    assert(entries.some(entry=>entry.beats.length===3));
  }
});

test('every idle is a finite event with quiet joints, no speech, and no body deformation',()=>{
  for(const coach of coaches)for(let take=0;take<40;take++){
    const poses=samples(coach,take);
    assert.deepEqual(poses,samples(coach,take));
    assert(poses.some(pose=>Object.values(pose).some(value=>Math.abs(value)>.05)),`${coach}/${take} visibly acts.`);
    for(const pose of poses){
      assert(Object.values(pose).every(Number.isFinite));
      for(const key of forbidden)assert.equal(pose[key]||0,0);
      assert(Math.abs(pose.headTilt)<=.065&&Math.abs(pose.headNod)<=4);
      assert(pose.leftWing>=0&&pose.leftWing<=.45&&pose.rightWing>=0&&pose.rightWing<=.45);
      assert(Math.abs(pose.leftElbow)<=2.2&&Math.abs(pose.rightElbow)<=2.2);
      assert(Math.abs(pose.leftEar)<=.16&&Math.abs(pose.rightEar)<=.16);
      assert(pose.blink>=0&&pose.blink<=1);
      assert(Math.abs(pose.lookX)<=1);
      assert(Math.abs(pose.bodyX)<=14&&pose.lift>=-8&&pose.lift<=4&&Math.abs(pose.tilt)<=.018);
      assert(pose.leftStep>=0&&pose.leftStep<=16&&pose.rightStep>=0&&pose.rightStep<=16);
      assert(!(pose.leftStep>0&&pose.rightStep>0),'Keep one foot planted.');
      assert(Math.abs(pose.leftFoot)<=.18&&Math.abs(pose.rightFoot)<=.18);
    }
    for(const time of [-10,0,.001,.999,1,10,NaN,Infinity,undefined]){
      assert(Object.values(applyCoachIdleRepertoire(time,coach,take)).every(value=>value===0));
    }
  }
});

test('all 40 indexes are reachable without inheriting an old blink or celebration pose',()=>{
  const noisyBase={blink:1,mouth:1,lift:-12,bodyX:18,pennant:1,feather:1,featherY:700,book:1,mug:1,magnifier:1,...Object.fromEntries(forbidden.map(key=>[key,1]))};
  for(const coach of coaches)for(let take=0;take<40;take++)for(const time of [.13,.37,.62,.81]){
    const direct=applyCoachIdleRepertoire(time,coach,take);
    const integrated=applyCoachRepertoire('idle',noisyBase,time,coach,take);
    for(const [key,value]of Object.entries(direct))assert.equal(integrated[key],value,`${coach}/${take}/${key} owns its idle timing.`);
    for(const key of forbidden)assert.equal(integrated[key],0);
    assert.deepEqual(applyCoachIdleRepertoire(time,coach,take+40),direct);
  }
  assert.deepEqual(applyCoachIdleRepertoire(.31,'meowl',-1),applyCoachIdleRepertoire(.31,'meowl',39));
  assert.deepEqual(applyCoachIdleRepertoire(.31,'unknown',NaN),applyCoachIdleRepertoire(.31,'meowl',0));
});

test('each personality has both prop scenes and body-language-only moments',()=>{
  const prop={meowl:'feather',owl:'book',paws:'pennant',mellow:'mug',scout:'magnifier'};
  for(const coach of coaches){
    let withProp=0,withoutProp=0;
    for(let take=0;take<40;take++){
      const poses=samples(coach,take);
      if(peak(poses,prop[coach])>.5)withProp++;else withoutProp++;
      for(const other of coaches.filter(id=>id!==coach))assert.equal(peak(poses,prop[other]),0);
    }
    assert(withProp>=6&&withoutProp>=12,`${coach} balances recognizable props and quiet gestures.`);
  }
  assert(peak(samples('meowl',3),'feather')>.6);
  assert(peak(samples('owl',4),'pageTurn')>.9);
  assert(peak(samples('paws',8),'pennant')>.7);
  assert(peak(samples('mellow',3),'steam')>.6);
  assert(peak(samples('scout',3),'magnifier')>.75);
});

test('props stay attached to their supporting wings through compound idle sequences',()=>{
  for(const coach of coaches)for(let take=0;take<40;take++)for(const pose of samples(coach,take,101)){
    if(pose.book>.5)assert(pose.leftElbow>1.4&&pose.rightElbow>1.3);
    if(pose.mug>.5)assert(pose.leftElbow>1.4&&pose.rightElbow>1.4&&pose.leftWing<.2&&pose.rightWing<.2);
    if(pose.magnifier>.5)assert(pose.rightWing>.12&&Math.abs(pose.rightElbow)>.2);
    if(pose.pennant>.5)assert(pose.leftWing>.2||pose.leftElbow>.6);
    if(pose.feather>0)assert(pose.featherY>=500&&pose.featherY<=900&&Math.abs(pose.featherX)<=280);
    else assert.equal(pose.featherY,0);
  }
});

test('solid held objects reach full opacity and fade only on entry and exit',()=>{
  const prop={owl:'book',paws:'pennant',mellow:'mug',scout:'magnifier'};
  for(const [coach,key]of Object.entries(prop))for(let take=0;take<40;take++){
    const poses=samples(coach,take,201);
    if(!poses.some(pose=>pose[key]>0))continue;
    const solid=poses.filter(pose=>pose[key]>.999);
    assert(solid.length>=10,`${coach}/${take} holds an opaque ${key} for a readable moment.`);
    const start=poses.findIndex(pose=>pose[key]>.999),end=poses.findLastIndex(pose=>pose[key]>.999);
    assert(poses.slice(0,start).some(pose=>pose[key]>0&&pose[key]<1));
    assert(poses.slice(end+1).some(pose=>pose[key]>0&&pose[key]<1));
    for(const pose of solid){
      if(key==='book')assert(pose.leftElbow>1.7&&pose.rightElbow>1.6);
      if(key==='mug')assert(pose.leftElbow>1.7&&pose.rightElbow>1.7);
      if(key==='magnifier')assert(pose.rightWing>=.18&&Math.abs(pose.rightElbow)>=.28);
      if(key==='pennant')assert(pose.leftWing>=.18||pose.leftElbow>1.3);
    }
  }
});
