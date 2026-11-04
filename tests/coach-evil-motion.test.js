import test from 'node:test';
import assert from 'node:assert/strict';
import { coachPoseAt, COACH_REACTION_DURATIONS } from '../extension/lib/coach-puppet.js';
import { applyCoachAction } from '../extension/lib/coach-action-motion.js';
import { applyCoachRepertoire, COACH_ANIMATION_LABELS, coachAnimationTakeCount } from '../extension/lib/coach-repertoire.js';
import { applyCoachIdleRepertoire, COACH_IDLE_REPERTOIRE } from '../extension/lib/coach-idle-repertoire.js';

const removed=['winkLeft','winkRight','blep','eyeSmile','squash','bodyBend','leftFlop','rightFlop','breathe','leftReach','rightReach','hug','wing'];
const props=['book','pageTurn','glasses','mug','mugLift','steam','steamPhase','magnifier','glassAngle','pennant','flagFlutter','feather','featherX','featherY','featherAngle'];
const bounds={mouth:[0,1],blink:[0,1],lookX:[-1,1],lookY:[-1,1],leftWing:[0,1.35],rightWing:[0,1.35],leftElbow:[-2.2,2.2],rightElbow:[-2.2,2.2],leftFoot:[-.3,.3],rightFoot:[-.3,.3],leftStep:[0,28],rightStep:[0,28],leftEar:[-.18,.18],rightEar:[-.18,.18],headTilt:[-.1,.1],headNod:[-8,8],bodyX:[-18,18],lift:[-12,6],tilt:[-.025,.025]};
const samples=(kind,take,count=81,coach='evil')=>Array.from({length:count},(_,index)=>coachPoseAt(kind,COACH_REACTION_DURATIONS[kind]*index/(count-1),coach,take));
const peak=(poses,key)=>Math.max(...poses.map(pose=>pose[key]||0));

test('Evil owns 40 named idle sequences and three takes of every reaction',()=>{
  assert.equal(Object.keys(COACH_ANIMATION_LABELS).length,11);
  for(const [kind,coaches] of Object.entries(COACH_ANIMATION_LABELS)){
    const count=kind==='idle'?40:3,labels=coaches.evil;
    assert.equal(labels.length,count);assert.equal(new Set(labels).size,count);
    assert(Object.isFrozen(labels));assert.equal(coachAnimationTakeCount(kind,'evil'),count);
    const timelines=labels.map((_,take)=>JSON.stringify(samples(kind,take,49)));
    assert.equal(new Set(timelines).size,count,`${kind} has distinct actions.`);
    for(let take=0;take<count;take++)assert.notEqual(timelines[take],JSON.stringify(samples(kind,take,49,'meowl')),`${kind}/${take} does not fall back to Meowl.`);
  }
  const idle=COACH_IDLE_REPERTOIRE.evil;
  assert.equal(new Set(idle.map(item=>item.beats.map(beat=>beat.action).join('/'))).size,40);
  assert(new Set(idle.flatMap(item=>item.beats.map(beat=>beat.action))).size>=14);
  assert(idle.some(item=>item.beats.length===3));
  for(const item of idle){assert(Object.isFrozen(item));for(const beat of item.beats)assert((beat.end-beat.start)*2400>=800);}
});

test('every Evil pose stays finite, rigid, prop-free, deterministic and neutral at both ends',()=>{
  for(const kind of Object.keys(COACH_ANIMATION_LABELS))for(let take=0;take<coachAnimationTakeCount(kind,'evil');take++){
    const poses=samples(kind,take);assert.deepEqual(poses,samples(kind,take));
    for(const pose of poses)for(const [key,value] of Object.entries(pose)){
      assert(Number.isFinite(value),`${kind}/${take}/${key}`);
      if(removed.includes(key)||props.includes(key)){assert.equal(value,0,`${kind}/${take}/${key} must be off.`);continue;}
      assert(bounds[key],`Declare the bounds of ${key}.`);
      assert(value>=bounds[key][0]&&value<=bounds[key][1],`${kind}/${take}/${key} stays bounded.`);
    }
    assert(Object.values(poses[0]).every(value=>value===0));assert(Object.values(poses.at(-1)).every(value=>value===0));
    assert(poses.some(pose=>Object.values(pose).some(value=>Math.abs(value)>.05)));
  }
});

test('scheming, sneaking and revealing differ and keep one foot planted',()=>{
  const scheme=samples('signature',0,201),sneak=samples('signature',1,201),reveal=samples('signature',2,201);
  assert(peak(scheme,'leftElbow')>1.45&&peak(scheme,'rightElbow')>1.4);
  assert.equal(peak(scheme,'leftStep'),0);assert.equal(peak(scheme,'rightStep'),0);
  assert(peak(sneak,'leftStep')>11&&peak(sneak,'rightStep')>9);
  for(const pose of sneak)assert(!(pose.leftStep>0&&pose.rightStep>0));
  assert(peak(reveal,'rightWing')>.7&&peak(reveal,'leftWing')<.2);
  for(const kind of ['greeting','brilliant','celebrate','great'])assert.notDeepEqual(samples(kind,0),samples('signature',0));
});

test('Evil idles are quiet and encouragement stays supportive instead of celebrating',()=>{
  for(let take=0;take<40;take++)for(let tick=0;tick<=80;tick++){
    const pose=applyCoachIdleRepertoire(tick/80,'evil',take);
    for(const key of ['mouth',...removed,...props])assert.equal(pose[key]||0,0);
    assert(Math.abs(pose.headTilt)<=.065&&Math.abs(pose.headNod)<=4);
    assert(pose.leftWing<=.45&&pose.rightWing<=.45);
  }
  for(let take=0;take<3;take++)for(const pose of samples('encourage',take)){
    for(const key of ['mouth','leftStep','rightStep','bodyX','lift','tilt',...props,...removed])assert.equal(pose[key]||0,0);
    assert((pose.leftWing||0)<=.4&&(pose.rightWing||0)<=.4);
  }
});

test('speech preserves mouth timing without performing a full scheming routine',()=>{
  for(let take=0;take<3;take++)for(let tick=1;tick<100;tick++){
    const t=tick/100,base=applyCoachAction('talk',{mouth:.73,blink:.22},t,'evil',take);
    const pose=applyCoachRepertoire('talk',base,t,'evil',take);
    assert.equal(pose.mouth,base.mouth);assert.equal(pose.blink,base.blink);
    assert(pose.leftWing<=.28&&pose.rightWing<=.28);
    assert(Math.abs(pose.leftElbow)<=.5&&Math.abs(pose.rightElbow)<=.5);
    for(const key of ['leftStep','rightStep','bodyX','lift','tilt',...props,...removed])assert.equal(pose[key]||0,0);
  }
});

test('all Evil takes enter and leave continuously without frame jumps',()=>{
  for(const kind of Object.keys(COACH_ANIMATION_LABELS))for(let take=0;take<coachAnimationTakeCount(kind,'evil');take++){
    const poses=samples(kind,take,1001);
    for(let frame=1;frame<poses.length;frame++)for(const [key,[low,high]] of Object.entries(bounds)){
      const delta=Math.abs((poses[frame][key]||0)-(poses[frame-1][key]||0));
      assert(delta<(high-low)*.085,`${kind}/${take}/${key} jumps at ${frame}: ${delta}.`);
    }
  }
});
