import test from 'node:test';
import assert from 'node:assert/strict';
import { coachPoseAt, COACH_REACTION_DURATIONS } from '../extension/lib/coach-puppet.js';
import { coachAnimationTakeCount } from '../extension/lib/coach-repertoire.js';
import { coachWingTip, resolveCoachWingPose } from '../extension/lib/coach-wing-kinematics.js';
import { coachPitchforkSvg, coachPitchforkTransform, resolveEvilPitchforkPose, EVIL_PITCHFORK_REST, EVIL_PITCHFORK_GRIP } from '../extension/lib/coach-pitchfork.js';

const rotate=(point,angle)=>[point[0]*Math.cos(angle)-point[1]*Math.sin(angle),point[0]*Math.sin(angle)+point[1]*Math.cos(angle)];
const propPoint=(point,hold)=>{const p=rotate(point,hold.angle);return[p[0]+hold.x,p[1]+hold.y];};
const world=(point,pose)=>{const p=rotate([point[0]-626,point[1]-1150],pose.tilt||0);return[p[0]+626+(pose.bodyX||0),p[1]+1150+(pose.lift||0)];};
const bounds=[[-58,-425],[58,-425],[-58,-300],[58,-300],[-12,320],[12,320]];

test('the pitchfork stays inside the bent feather grip with visible shaft above and below throughout every Evil action',()=>{
  let frames=0;
  for(const [kind,duration]of Object.entries(COACH_REACTION_DURATIONS))for(let take=0;take<coachAnimationTakeCount(kind,'evil');take++)for(let tick=0;tick<=64;tick++){
    const raw=coachPoseAt(kind,duration*tick/64,'evil',take),resolved=resolveCoachWingPose(raw,'evil'),pose=resolveEvilPitchforkPose(resolved),hold=coachPitchforkTransform(pose);
    const tip=coachWingTip(pose,'left');
    assert(Math.abs(Math.hypot(hold.x-tip[0],hold.y-tip[1])-Math.hypot(EVIL_PITCHFORK_GRIP[0]-442,EVIL_PITCHFORK_GRIP[1]-955))<1e-9,'The shaft stays30px inside the feather end, never balanced on its tip.');
    assert(pose.leftElbow<-1.4&&pose.leftElbow>-1.7,'The carrying wing must visibly bend across the upright shaft.');
    assert(hold.y>650&&hold.y<850,'The grip sits at chest height instead of beside the feet.');
    for(const key of ['rightWing','rightElbow','headTilt','headNod','mouth','blink','leftEar','rightEar','leftStep','rightStep'])assert.equal(pose[key],resolved[key],key+' keeps its authored action.');
    for(const point of bounds){
      const local=propPoint(point,hold),position=world(local,pose);
      assert(position.every(value=>Number.isFinite(value)&&value>35&&value<1219),`${kind}/${take}/${tick}: prop clipped at ${position}`);
      const head=rotate([local[0]-626,local[1]-535-(pose.headNod||0)],-(pose.headTilt||0));
      const faceDistance=(head[0]/222)**2+((head[1]+185)/225)**2;
      assert(faceDistance>1.02,`${kind}/${take}/${tick}: tines must stay outside the face.`);
    }
    frames++;
  }
  assert.equal(frames,70*65);
});

test('rest, reaction endpoints, and static SVG use the same neutral held prop',()=>{
  const neutral=coachPitchforkTransform(resolveEvilPitchforkPose({}));
  assert.deepEqual(neutral,coachPitchforkTransform(EVIL_PITCHFORK_REST));
  assert.match(coachPitchforkSvg(),new RegExp('translate\\('+neutral.x+' '+neutral.y+'\\)'));
  assert.match(coachPitchforkSvg(),/L7 310/,'The lower shaft stays visibly below the grip.');
  for(const [kind,duration]of Object.entries(COACH_REACTION_DURATIONS))for(const time of [0,duration]){
    const pose=resolveEvilPitchforkPose(resolveCoachWingPose(coachPoseAt(kind,time,'evil',0),'evil'));
    assert.deepEqual(coachPitchforkTransform(pose),neutral);
  }
});

test('held-pose resolution is finite, continuous, and does not change the source pose',()=>{
  for(const value of [-Infinity,-20,0,.1,1.35,20,NaN,undefined]){
    const raw={leftWing:value,leftElbow:2,rightWing:.4,mouth:.6},copy={...raw};
    const pose=resolveEvilPitchforkPose(raw),hold=coachPitchforkTransform(pose);
    assert.deepEqual(raw,copy);assert(Object.values(hold).every(Number.isFinite));
    assert(pose.leftWing>=.18&&pose.leftWing<=.24075001);
    assert.equal(pose.rightWing,.4);assert.equal(pose.mouth,.6);
  }
  const first=coachPitchforkTransform(resolveEvilPitchforkPose({leftWing:.37}));
  const next=coachPitchforkTransform(resolveEvilPitchforkPose({leftWing:.37001}));
  assert(Math.hypot(next.x-first.x,next.y-first.y)<.01);
});
