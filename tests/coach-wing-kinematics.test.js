import test from 'node:test';
import assert from 'node:assert/strict';
import { coachPoseAt, COACH_REACTION_DURATIONS } from '../extension/lib/coach-puppet.js';
import { COACH_ANIMATION_LABELS } from '../extension/lib/coach-repertoire.js';
import {
  COACH_WING_GEOMETRY, COACH_WING_GRIP_POINTS, coachWingGrip, coachBookGripTargets, coachBookCarryOffset, coachMugGripTargets, coachMugCarryOffset, coachWingTip, resolveCoachWingPose,
} from '../extension/lib/coach-wing-kinematics.js';

const coaches=['meowl','owl','paws','mellow','scout','evil'];
const near=(actual,expected,message,tolerance=.000001)=>assert(Math.abs(actual-expected)<tolerance,`${message}: ${actual} vs ${expected}`);
const nearPoint=(actual,expected,message)=>actual.forEach((value,index)=>near(value,expected[index],message));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const poseAt=(kind,coach,take,time)=>resolveCoachWingPose(coachPoseAt(kind,time*COACH_REACTION_DURATIONS[kind],coach,take),coach);

test('the rigid wing geometry has the source artwork endpoints and keeps neutral poses neutral',()=>{
  assert(Object.isFrozen(COACH_WING_GEOMETRY));
  for(const side of ['left','right']){
    assert(Object.isFrozen(COACH_WING_GEOMETRY[side]));
    nearPoint(coachWingTip({},side),COACH_WING_GEOMETRY[side].tip,`${side} resting wingtip`);
  }
  for(const coach of coaches){
    const neutral=resolveCoachWingPose({},coach);
    assert(Object.values(neutral).every(value=>value===0));
    nearPoint(coachWingTip(neutral),[442,955],'Left wing at rest');
    nearPoint(coachWingTip(neutral,'right'),[844,962],'Right wing at rest');
  }
});

test('held contact uses opaque feather interiors without shortening the original wings',()=>{
  assert(Object.isFrozen(COACH_WING_GRIP_POINTS));
  nearPoint(COACH_WING_GRIP_POINTS.left,[450,925],'Left painted grip');
  nearPoint(COACH_WING_GRIP_POINTS.right,[838,932],'Right painted grip');
  for(const side of ['left','right']){
    assert(Object.isFrozen(COACH_WING_GRIP_POINTS[side]));
    nearPoint(coachWingGrip({},side),COACH_WING_GRIP_POINTS[side],`${side} resting grip`);
    const overlap=distance(COACH_WING_GEOMETRY[side].tip,COACH_WING_GRIP_POINTS[side]);
    assert(overlap>30&&overlap<32,'A real feather end extends beyond the support point.');
    for(const wing of [0,.2,.7,1.35])for(const elbow of [-2.2,-1,0,1,2.2]){
      const pose={[`${side}Wing`]:wing,[`${side}Elbow`]:elbow};
      near(distance(coachWingTip(pose,side),coachWingGrip(pose,side)),overlap,'The original rigid feather overlap never stretches.');
    }
    assert(coachWingGrip({leftWing:NaN,rightWing:Infinity,leftElbow:NaN,rightElbow:Infinity},side).every(Number.isFinite));
  }
});

test('full book support puts both opaque feather grips on their own cover without crossing the body',()=>{
  const raw={book:1,leftWing:.1,rightWing:.12,leftElbow:1.85,rightElbow:1.75};
  const pose=resolveCoachWingPose(raw,'owl');
  nearPoint(coachWingGrip(pose),[532,800],'Left book grip');
  nearPoint(coachWingGrip(pose,'right'),[720,800],'Right book grip');
  assert(pose.leftWing>.25&&pose.rightWing>.25,'Support opens the shoulders instead of pinching the tips inward.');
  assert(pose.leftElbow<1.8&&pose.rightElbow<1.95,'The interior contact avoids the old sharper fold.');
  assert(coachWingTip(pose)[0]>coachWingGrip(pose)[0]+20,'Original left feathers visibly overlap the cover.');
  assert(coachWingTip(pose,'right')[0]<coachWingGrip(pose,'right')[0]-20,'Original right feathers visibly overlap the cover.');
  assert.equal(pose.leftGrip,1);assert.equal(pose.rightGrip,1);
  for(let tick=1;tick<=100;tick++){
    const amount=tick/100,resolved=resolveCoachWingPose({...raw,book:amount},'owl'),targets=coachBookGripTargets(amount);
    const left=coachWingGrip(resolved),right=coachWingGrip(resolved,'right');
    assert(left[0]<620&&right[0]>650,'The tips remain on their own side while opening.');
    if(amount>=.5)nearPoint(right,targets.right,'Right wing follows the moving book');
    if(amount>=.65)nearPoint(left,targets.left,'Left wing joins the opened spread');
    if(amount<=.3)assert.equal(resolved.leftGrip,0,'The left tip is not painted over the small rightward book.');
  }
});

test('page and pointing gestures slide along the cover instead of passing through the book',()=>{
  for(let tick=0;tick<=100;tick++){
    const page=tick/100,pose=resolveCoachWingPose({book:1,pageTurn:page,rightElbow:2.1},'owl');
    const left=coachWingGrip(pose),right=coachWingGrip(pose,'right');
    nearPoint(left,[532,800],'The supporting left grip stays planted');
    near(right[0],720,'The right tip stays on the cover edge');
    assert(right[1]>=793&&right[1]<=800);
  }
});

test('every visible book frame stays in the carrying wing while entering and leaving',()=>{
  let partialGrips=0,pageSlides=0;
  for(const [kind,byCoach]of Object.entries(COACH_ANIMATION_LABELS))for(let take=0;take<byCoach.owl.length;take++)for(let tick=1;tick<200;tick++){
    const raw=coachPoseAt(kind,tick/200*COACH_REACTION_DURATIONS[kind],'owl',take);
    const resolved=resolveCoachWingPose(raw,'owl'),offset=coachBookCarryOffset(raw,resolved);
    assert(offset.every(Number.isFinite));
    if(!(raw.book>0)){assert.deepEqual(offset,[0,0]);continue;}
    const nominal=coachBookGripTargets(raw.book).right;
    const slide=Math.sin(Math.PI*raw.pageTurn)*4+Math.max(0,raw.rightElbow-1.75)*8;
    const carriedGrip=[nominal[0]+offset[0],nominal[1]+offset[1]-slide];
    nearPoint(carriedGrip,coachWingGrip(resolved,'right'),`${kind}/${take} stays attached during entry, hold, and exit`);
    if(resolved.rightGrip===1)nearPoint(offset,[0,0],'A fully supported book is not translated');
    if(slide>.1&&resolved.rightGrip===1)pageSlides++;
    if(resolved.rightGrip>0&&resolved.rightGrip<1&&Math.hypot(...offset)>5){
      partialGrips++;
      const weakened=[nominal[0]+offset[0]*(1-resolved.rightGrip),nominal[1]+offset[1]*(1-resolved.rightGrip)-slide];
      assert(distance(weakened,coachWingGrip(resolved,'right'))>.000001,'A second blend would reintroduce the gap.');
    }
  }
  assert(partialGrips>100,'Checks include many real approach/release frames.');
  assert(pageSlides>100,'Checks preserve page and pointing gestures at full contact.');
});

test('book carry offsets are finite, neutral when hidden, and do not alter either input pose',()=>{
  for(const book of [undefined,0,-1,NaN,Infinity])assert.deepEqual(coachBookCarryOffset({book},{rightWing:Infinity}),[0,0]);
  assert.deepEqual(coachBookCarryOffset(null,null),[0,0]);
  const raw=Object.freeze({book:.2,pageTurn:.5,rightElbow:2.05,rightWing:.1});
  const resolved=Object.freeze(resolveCoachWingPose(raw,'owl'));
  assert.deepEqual(coachBookCarryOffset(raw),coachBookCarryOffset(raw,resolved));
  assert.deepEqual(coachBookCarryOffset(raw,null),coachBookCarryOffset(raw,resolved));
  assert.equal(raw.rightElbow,2.05);assert.equal(raw.book,.2);
  const malformed=coachBookCarryOffset({book:1,pageTurn:NaN,rightElbow:Infinity},{rightWing:NaN,rightElbow:Infinity});
  assert(malformed.every(Number.isFinite));
});

test('cup grips follow both lower corners through every authored lift',()=>{
  for(let lift=0;lift<=62;lift++){
    const pose=resolveCoachWingPose({mug:1,mugLift:lift,leftElbow:2.2,rightElbow:2.2},'mellow');
    nearPoint(coachWingGrip(pose),[570,825-lift],'Left cup support');
    nearPoint(coachWingGrip(pose,'right'),[682,825-lift],'Right cup support');
    assert(pose.leftWing>.08&&pose.rightWing>.08);
    assert.equal(pose.leftGrip,1);assert.equal(pose.rightGrip,1);
  }
  const extreme=resolveCoachWingPose({mug:1,mugLift:90},'mellow');
  assert(extreme.leftElbow<=2.2&&extreme.rightElbow<=2.2,'An extreme request does not over-fold either wing.');
  assert(distance(coachWingGrip(extreme,'right'),[682,735])<12,'The reachable correction stays inside the lower cup edge.');
});

test('all visible mug entries, holds, lifts, and exits stay attached to the carrying wing',()=>{
  let partialGrips=0,fullHolds=0;
  for(const [kind,byCoach]of Object.entries(COACH_ANIMATION_LABELS))for(let take=0;take<byCoach.mellow.length;take++)for(let tick=1;tick<200;tick++){
    const raw=coachPoseAt(kind,tick/200*COACH_REACTION_DURATIONS[kind],'mellow',take);
    const resolved=resolveCoachWingPose(raw,'mellow'),offset=coachMugCarryOffset(raw,resolved);
    assert(offset.every(Number.isFinite));
    if(!(raw.mug>0)){assert.deepEqual(offset,[0,0]);continue;}
    const targets=coachMugGripTargets(raw.mugLift),tip=coachWingGrip(resolved,'right');
    const carriedRight=[targets.right[0]+offset[0],targets.right[1]+offset[1]];
    nearPoint(carriedRight,tip,`${kind}/${take} keeps its cup on the carrying wing`);
    assert(carriedRight[0]>coachWingGrip(resolved,'left')[0]+30,'Carrying never crosses the supporting wings.');
    if(resolved.rightGrip===1&&resolved.leftGrip===1){
      fullHolds++;
      nearPoint(offset,[0,0],'Full cup holds keep their original centered position');
      nearPoint(coachWingGrip(resolved,'left'),targets.left,'The second wing meets the opposite corner');
    }
    if(resolved.rightGrip>0&&resolved.rightGrip<1&&Math.hypot(...offset)>5){
      partialGrips++;
      const weakened=[targets.right[0]+offset[0]*(1-resolved.rightGrip),targets.right[1]+offset[1]*(1-resolved.rightGrip)];
      assert(distance(weakened,tip)>.000001,'An extra fade multiplier would detach the cup.');
    }
  }
  assert(partialGrips>100,'Includes the real fade-in and fade-out transitions.');
  assert(fullHolds>100,'Includes centered holds and lifted cups.');
});

test('mug carry handles hidden props and extreme lift requests without changing input poses',()=>{
  for(const mug of [undefined,0,-1,NaN,Infinity])assert.deepEqual(coachMugCarryOffset({mug},{rightWing:Infinity}),[0,0]);
  assert.deepEqual(coachMugCarryOffset(null,null),[0,0]);
  const raw=Object.freeze({mug:.15,mugLift:32,rightWing:.1,rightElbow:1.8});
  const resolved=Object.freeze(resolveCoachWingPose(raw,'mellow'));
  assert.deepEqual(coachMugCarryOffset(raw),coachMugCarryOffset(raw,resolved));
  assert.deepEqual(coachMugCarryOffset(raw,null),coachMugCarryOffset(raw,resolved));
  assert.equal(raw.mug,.15);assert.equal(raw.mugLift,32);assert.equal(raw.rightElbow,1.8);
  for(const lift of [-10,0,62,90,100,NaN,Infinity]){
    const source={mug:1,mugLift:lift},pose=resolveCoachWingPose(source,'mellow');
    const offset=coachMugCarryOffset(source,pose),target=coachMugGripTargets(lift).right;
    assert(offset.every(Number.isFinite));
    nearPoint([target[0]+offset[0],target[1]+offset[1]],coachWingGrip(pose,'right'),'Clamped lift retains contact');
    assert(Math.abs(pose.rightElbow)<=2.2,'Carry correction never changes the fixed wing geometry.');
  }
  assert(coachMugCarryOffset({mug:1,mugLift:NaN},{rightWing:NaN,rightElbow:Infinity}).every(Number.isFinite));
});

test('purposeful free gestures are preserved and strong folds soften without tip collisions',()=>{
  for(const side of ['left','right'])for(const bend of [-.9,-.7,0,.7,.8,1.1]){
    const pose=resolveCoachWingPose({[`${side}Wing`]:.2,[`${side}Elbow`]:bend});
    near(pose[`${side}Elbow`],bend,'Ordinary elbow gesture');
    near(pose[`${side}Wing`],.2,'Ordinary shoulder gesture');
  }
  let last=-Infinity;
  for(let tick=0;tick<=220;tick++){
    const bend=tick/100,pose=resolveCoachWingPose({leftElbow:bend,rightElbow:bend});
    assert(pose.leftElbow>=last,'Stronger requests still produce distinct stronger bends.');last=pose.leftElbow;
    assert(pose.leftElbow<1.6&&pose.rightElbow<1.6);
    assert(coachWingTip(pose)[0]<=600.00001&&coachWingTip(pose,'right')[0]>=651.99999);
    assert.equal(pose.leftGrip,0);assert.equal(pose.rightGrip,0);
  }
});

test('lens and pennant get a visible feather grip without changing their authored joints',()=>{
  for(const[coach,prop,side]of[['scout','magnifier','right'],['paws','pennant','left']])for(const amount of [0,.05,.2,.5,.8,1]){
    const source={leftWing:.4,rightWing:.7,leftElbow:.8,rightElbow:.9,[prop]:amount};
    const free=resolveCoachWingPose(source,'meowl'),held=resolveCoachWingPose(source,coach);
    assert.equal(held[`${side}Grip`],amount);
    assert.equal(held[`${side==='left'?'right':'left'}Grip`],0);
    for(const key of ['leftWing','rightWing','leftElbow','rightElbow'])near(held[key],free[key],`${prop} preserves ${key}`);
    assert.equal(source[prop],amount);
  }
  for(const value of [-1,NaN,Infinity]){
    assert.equal(resolveCoachWingPose({magnifier:value},'scout').rightGrip,0);
    assert.equal(resolveCoachWingPose({pennant:value},'paws').leftGrip,0);
  }
  assert.equal(resolveCoachWingPose({magnifier:1,pennant:1},'evil').leftGrip,0,'Evil keeps its separate approved staff resolver.');
});

test('tiny free bends use the whole painted wing and join the elbow motion without a threshold jump',()=>{
  for(const side of ['left','right'])for(const sign of [-1,1]){
    for(const value of [0,.03,.1,.18])assert.equal(resolveCoachWingPose({[`${side}Elbow`]:sign*value})[`${side}Elbow`],0);
    let previous=0;
    for(let tick=1;tick<=700;tick++){
      const request=tick/1000,actual=resolveCoachWingPose({[`${side}Elbow`]:sign*request})[`${side}Elbow`]*sign;
      assert(actual>=previous&&actual<=request+.000001);
      assert(actual-previous<.003,'There is no jump when the elbow starts moving.');
      previous=actual;
    }
    near(previous,.7,'Full purposeful bend at the end of the blend');
  }
});

test('all authored reactions remain finite, bounded, neutral at the ends, and separated',()=>{
  for(const [kind,byCoach]of Object.entries(COACH_ANIMATION_LABELS))for(const coach of coaches)for(let take=0;take<byCoach[coach].length;take++){
    for(let tick=0;tick<=100;tick++){
      const pose=poseAt(kind,coach,take,tick/100);
      for(const side of ['left','right']){
        assert(Number.isFinite(pose[`${side}Wing`])&&pose[`${side}Wing`]>=0&&pose[`${side}Wing`]<=1.35);
        assert(Number.isFinite(pose[`${side}Elbow`])&&Math.abs(pose[`${side}Elbow`])<=2.2);
        assert(pose[`${side}Grip`]>=0&&pose[`${side}Grip`]<=1);
      }
      assert(coachWingTip(pose)[0]+30<coachWingTip(pose,'right')[0],`${kind}/${coach}/${take} does not cross feather tips.`);
      if(tick===0||tick===100)assert(Object.values(pose).every(value=>value===0));
    }
  }
});

test('the grip blend stays continuous through every authored book and cup entry and exit',()=>{
  for(const [kind,byCoach]of Object.entries(COACH_ANIMATION_LABELS))for(const coach of ['owl','mellow'])for(let take=0;take<byCoach[coach].length;take++){
    let previous=poseAt(kind,coach,take,0);
    for(let tick=1;tick<=1000;tick++){
      const pose=poseAt(kind,coach,take,tick/1000);
      for(const side of ['left','right']){
        assert(Math.abs(pose[`${side}Wing`]-previous[`${side}Wing`])<.07,`${kind}/${coach}/${take}/${side} shoulder does not snap.`);
        assert(Math.abs(pose[`${side}Elbow`]-previous[`${side}Elbow`])<.15,`${kind}/${coach}/${take}/${side} elbow does not snap.`);
        assert(distance(coachWingTip(pose,side),coachWingTip(previous,side))<28,`${kind}/${coach}/${take}/${side} tip follows a continuous path.`);
      }
      previous=pose;
    }
  }
});

test('the resolver preserves unrelated tracks, never mutates source poses, and handles malformed joints',()=>{
  const source=Object.freeze({leftWing:.2,leftElbow:.4,headTilt:.03,mouth:.7,book:1,pageTurn:.2,leftFoot:.1,feather:1});
  const pose=resolveCoachWingPose(source,'owl');
  for(const key of ['headTilt','mouth','book','pageTurn','leftFoot','feather'])assert.equal(pose[key],source[key]);
  assert.equal(source.leftWing,.2);assert.equal(source.leftElbow,.4);
  const malformed=resolveCoachWingPose({leftWing:Infinity,rightElbow:NaN,leftElbow:100,rightWing:-5});
  for(const key of ['leftWing','rightWing','leftElbow','rightElbow','leftGrip','rightGrip'])assert(Number.isFinite(malformed[key]));
  assert.deepEqual(resolveCoachWingPose(null),resolveCoachWingPose({}));
  assert.equal(resolveCoachWingPose({book:1},'meowl').leftGrip,0);
  assert.equal(resolveCoachWingPose({mug:1},'owl').rightGrip,0);
});
