import test from 'node:test';
import assert from 'node:assert/strict';
import { coachPoseAt, COACH_REACTION_DURATIONS } from '../extension/lib/coach-puppet.js';
import { applyCoachRepertoire, COACH_ANIMATION_LABELS, coachAnimationTakeCount } from '../extension/lib/coach-repertoire.js';
import { COACH_IDLE_REPERTOIRE, applyCoachIdleRepertoire } from '../extension/lib/coach-idle-repertoire.js';
import { babyReactionPose } from '../extension/lib/coach-baby-motion.js';

const kinds=Object.keys(COACH_REACTION_DURATIONS);
const removed=['winkLeft','winkRight','blep','eyeSmile','squash','bodyBend','leftFlop','rightFlop','breathe','leftReach','rightReach','hug','wing'];
const props=['book','pageTurn','glasses','feather','featherX','featherY','featherAngle','mug','mugLift','steam','steamPhase','magnifier','glassAngle','pennant','flagFlutter'];
const bounds={mouth:[0,1],blink:[0,1],lookX:[-1,1],lookY:[-1,1],leftWing:[0,1.35],rightWing:[0,1.35],leftElbow:[-2.2,2.2],rightElbow:[-2.2,2.2],leftStep:[0,28],rightStep:[0,28],leftFoot:[-.3,.3],rightFoot:[-.3,.3],leftEar:[-.18,.18],rightEar:[-.18,.18],headTilt:[-.1,.1],headNod:[-8,8],bodyX:[-18,18],lift:[-12,6],tilt:[-.025,.025]};
const poses=(kind,take=0,count=101)=>Array.from({length:count},(_,i)=>coachPoseAt(kind,COACH_REACTION_DURATIONS[kind]*i/(count-1),'baby',take));
const peak=(samples,key)=>Math.max(...samples.map(pose=>pose[key]||0));

test('Baby has a complete registered repertoire with 40 distinct idle stories and three takes for every reaction',()=>{
  for(const kind of kinds){
    const labels=COACH_ANIMATION_LABELS[kind].baby,count=kind==='idle'?40:3;
    assert.equal(labels.length,count);assert.equal(new Set(labels).size,count);assert(Object.isFrozen(labels));
    assert.equal(coachAnimationTakeCount(kind,'baby'),count);
    const visible=Array.from({length:count},(_,take)=>JSON.stringify(poses(kind,take,49).map(pose=>Object.fromEntries(Object.entries(pose).map(([key,value])=>[key,Math.round(value*100)/100])))));
    assert.equal(new Set(visible).size,count,`${kind} takes differ visibly`);
  }
  const entries=COACH_IDLE_REPERTOIRE.baby;
  assert(Object.isFrozen(entries));assert(entries.every(entry=>Object.isFrozen(entry)&&Object.isFrozen(entry.beats)));
  assert.equal(new Set(entries.map(entry=>entry.beats.map(beat=>beat.action).join('/'))).size,40);
  assert(new Set(entries.flatMap(entry=>entry.beats.map(beat=>beat.action))).size>=20);
});

test('all Baby animations are finite, articulated, blink naturally, and keep one foot planted',()=>{
  for(const kind of kinds)for(let take=0;take<coachAnimationTakeCount(kind,'baby');take++){
    const frames=poses(kind,take);
    assert.deepEqual(frames,poses(kind,take));
    assert(peak(frames,'blink')>.75,`${kind}/${take} includes a paired blink`);
    for(const pose of frames){
      for(const[key,value]of Object.entries(pose)){
        assert(Number.isFinite(value),`${kind}/${take}/${key} is finite`);
        if(bounds[key])assert(value>=bounds[key][0]&&value<=bounds[key][1],`${kind}/${take}/${key} is bounded`);
      }
      for(const key of [...removed,...props])assert.equal(pose[key]||0,0,`${kind}/${take} has no ${key}`);
      assert(!(pose.leftStep>.001&&pose.rightStep>.001),`${kind}/${take} keeps one foot grounded`);
    }
    assert(Object.values(frames[0]).every(value=>value===0));assert(Object.values(frames.at(-1)).every(value=>value===0));
  }
});

test('Baby talks gently with preserved speech timing and gives calm encouragement',()=>{
  for(let take=0;take<3;take++)for(let i=1;i<100;i++){
    const time=i/100,pose=applyCoachRepertoire('talk',{mouth:.63,blink:.2},time,'baby',take);
    assert.equal(pose.mouth,.63);assert.equal(pose.blink,.2);
    assert(pose.leftWing<=.2&&pose.rightWing<=.2);
    for(const key of ['leftStep','rightStep','bodyX','lift',...props])assert.equal(pose[key],0);
    const gentle=coachPoseAt('encourage',time*COACH_REACTION_DURATIONS.encourage,'baby',take);
    for(const key of ['leftStep','rightStep','bodyX','lift',...props])assert.equal(gentle[key],0);
    assert(gentle.leftWing<=.3&&gentle.rightWing<=.3);
  }
});

test('Baby idles remain quiet and small, and malformed inputs cannot leak earlier poses',()=>{
  for(let take=0;take<40;take++)for(let i=0;i<=100;i++){
    const pose=applyCoachIdleRepertoire(i/100,'baby',take);
    assert.equal(pose.mouth,0);assert(pose.leftWing<=.45&&pose.rightWing<=.45);
    assert(Math.abs(pose.headTilt)<=.065&&Math.abs(pose.headNod)<=4);
    assert(Math.abs(pose.bodyX)<=14&&pose.leftStep<=16&&pose.rightStep<=16);
    if(take<32)for(const key of ['bodyX','leftStep','rightStep','lift','tilt'])assert.equal(pose[key],0);
  }
  for(const kind of kinds)for(const progress of [-1,0,1,2,Infinity,NaN,undefined]){
    assert(Object.values(babyReactionPose(kind,progress,3,{mouth:1,book:1})).every(value=>value===0));
  }
  for(const base of [undefined,null,{},Object.freeze({mouth:Infinity,blink:NaN})])assert(Object.values(babyReactionPose('talk',.4,NaN,base)).every(Number.isFinite));
  assert.deepEqual(applyCoachIdleRepertoire(.31,'baby',-1),applyCoachIdleRepertoire(.31,'baby',39));
});

test('Baby joint motion is continuous at starts, turns, and settling frames',()=>{
  const maximum={leftWing:.12,rightWing:.12,leftElbow:.16,rightElbow:.16,leftStep:2,rightStep:2,leftFoot:.05,rightFoot:.05,leftEar:.045,rightEar:.045,headTilt:.025,headNod:1,bodyX:2};
  for(const kind of kinds)for(let take=0;take<coachAnimationTakeCount(kind,'baby');take++){
    let last=poses(kind,take,2)[0];
    for(let tick=1;tick<=500;tick++){
      const pose=coachPoseAt(kind,tick/500*COACH_REACTION_DURATIONS[kind],'baby',take);
      for(const[key,limit]of Object.entries(maximum))assert(Math.abs((pose[key]||0)-(last[key]||0))<limit,`${kind}/${take}/${key} does not snap at ${tick}`);
      last=pose;
    }
  }
});
