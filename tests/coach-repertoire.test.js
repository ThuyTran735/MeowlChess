import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCoachAction } from '../extension/lib/coach-action-motion.js';
import { applyCoachRepertoire, COACH_ANIMATION_LABELS, coachAnimationTakeCount } from '../extension/lib/coach-repertoire.js';

const coaches=['meowl','owl','paws','mellow','scout'];
const kinds=['signature','greeting','brilliant','celebrate','great','think','curious','approve','encourage','idle','talk'];
const removed=['winkLeft','winkRight','blep','eyeSmile','squash','bodyBend','leftFlop','rightFlop','breathe','leftReach','rightReach','hug','wing'];
const bounds={
  mouth:[0,1],blink:[0,1],lookX:[-1,1],leftWing:[0,1.35],rightWing:[0,1.35],leftElbow:[-2.2,2.2],rightElbow:[-2.2,2.2],
  leftFoot:[-.3,.3],rightFoot:[-.3,.3],leftStep:[0,28],rightStep:[0,28],leftEar:[-.18,.18],rightEar:[-.18,.18],
  headTilt:[-.1,.1],headNod:[-8,8],bodyX:[-18,18],lift:[-12,6],tilt:[-.025,.025],book:[0,1],pageTurn:[0,1],glasses:[0,1],
  feather:[0,1],featherX:[-280,280],featherY:[500,900],featherAngle:[-1,1],mug:[0,1],mugLift:[0,90],steam:[0,1],steamPhase:[0,1],
  magnifier:[0,1],glassAngle:[-.4,.4],pennant:[0,1],flagFlutter:[-.4,.4],
};
const seed={mouth:.45,blink:.2,leftWing:.2,rightWing:.2,headTilt:.02,headNod:2};
const original=(kind,coach,time,take=0)=>applyCoachAction(kind,seed,time,coach,take);
const at=(kind,coach,time,take=0)=>applyCoachRepertoire(kind,original(kind,coach,time,take),time,coach,take);
const samples=(kind,coach,take=0,count=101)=>Array.from({length:count},(_,i)=>at(kind,coach,i/(count-1),take));
const peak=(poses,key)=>Math.max(...poses.map(pose=>pose[key]||0));
const takes=(kind,coach)=>Array.from({length:coachAnimationTakeCount(kind,coach)},(_,index)=>index);

test('the frozen catalog has 40 idles per coach, three takes per reaction, and at least 45 active actions',()=>{
  assert.deepEqual(Object.keys(COACH_ANIMATION_LABELS).sort(),[...kinds].sort());
  assert(Object.isFrozen(COACH_ANIMATION_LABELS));
  const labels=new Set();
  for(const kind of kinds){
    assert(Object.isFrozen(COACH_ANIMATION_LABELS[kind]));
    for(const coach of coaches){
      const names=COACH_ANIMATION_LABELS[kind][coach];
      const count=kind==='idle'?40:3;
      assert.equal(names.length,count);assert.equal(new Set(names).size,count);assert(Object.isFrozen(names));
      for(const name of names){assert(typeof name==='string'&&name.length>3);if(!['talk','idle'].includes(kind))labels.add(name);}
    }
  }
  assert(labels.size>=45,`${labels.size} named active actions are reachable.`);
});

test('the approved signature take zero is preserved exactly for every coach',()=>{
  for(const coach of coaches)for(let tick=0;tick<=200;tick++){
    const time=tick/200,base=original('signature',coach,time,0);
    assert.deepEqual(applyCoachRepertoire('signature',base,time,coach,0),base);
  }
});

test('every reaction and idle take is finite, bounded, deterministic, neutral at endpoints, and free of deformation',()=>{
  for(const kind of kinds)for(const coach of coaches)for(const take of takes(kind,coach)){
    const poses=samples(kind,coach,take);
    assert.deepEqual(poses,samples(kind,coach,take));
    for(const pose of poses)for(const [key,value]of Object.entries(pose)){
      assert(Number.isFinite(value),`${kind}/${coach}/${take}/${key} stays finite.`);
      if(removed.includes(key)){assert.equal(value,0);continue;}
      if(key==='featherY'&&value===0){assert(!(pose.feather>0));continue;}
      assert(value>=bounds[key][0]&&value<=bounds[key][1],`${kind}/${coach}/${take}/${key} stays bounded.`);
    }
    for(const progress of [-1,0,1,2,NaN,Infinity,undefined]){
      const pose=applyCoachRepertoire(kind,{...seed,mug:1,pennant:1,feather:1,featherY:700,...Object.fromEntries(removed.map(key=>[key,1]))},progress,coach,take);
      assert(Object.values(pose).every(value=>value===0));
    }
  }
});

test('three takes really differ, and the two signature bonuses have different actions rather than mirrors',()=>{
  for(const kind of kinds)for(const coach of coaches){
    const timelines=takes(kind,coach).map(take=>JSON.stringify(samples(kind,coach,take,61)));
    assert.equal(new Set(timelines).size,coachAnimationTakeCount(kind,coach),`${kind}/${coach} has distinct timelines.`);
  }
  const meowlDance=samples('signature','meowl',1),meowlListen=samples('signature','meowl',2);
  assert(peak(meowlDance,'leftStep')>20&&peak(meowlListen,'leftStep')===0&&peak(meowlListen,'leftEar')>.15);
  assert(peak(samples('signature','owl',1),'glasses')>.8&&peak(samples('signature','owl',1),'book')===0);
  assert(peak(samples('signature','owl',2),'book')>.99&&peak(samples('signature','owl',2),'pageTurn')===0);
  assert(peak(samples('signature','paws',1),'pennant')>.99&&peak(samples('signature','paws',2),'pennant')===0);
  assert(peak(samples('signature','mellow',1),'mug')>.99&&peak(samples('signature','mellow',2),'mug')===0);
  assert(peak(samples('signature','scout',1),'leftStep')===0&&peak(samples('signature','scout',2),'leftStep')>19);
});

test('greetings and different positive grades do not simply replay the approved signature',()=>{
  for(const coach of coaches){
    const signature=JSON.stringify(samples('signature',coach,0,61));
    for(const kind of ['greeting','brilliant','celebrate','great'])assert.notEqual(JSON.stringify(samples(kind,coach,0,61)),signature,`${coach} gets its own ${kind} action.`);
    assert.notEqual(JSON.stringify(samples('great',coach,0,61)),JSON.stringify(samples('celebrate',coach,0,61)));
  }
});

test('each new prop belongs to its coach and stays supported by an articulated wing',()=>{
  for(const kind of kinds)for(const coach of coaches)for(const take of takes(kind,coach))for(const pose of samples(kind,coach,take,41)){
    if(coach!=='mellow')for(const key of ['mug','mugLift','steam','steamPhase'])assert(!(pose[key]>0));
    if(coach!=='scout')assert(!(pose.magnifier>0));
    if(coach!=='paws')assert(!(pose.pennant>0));
    if(coach!=='owl')assert(!(pose.book>0));
    if(coach!=='meowl')assert(!(pose.feather>0));
    if(pose.mug>.5){assert(pose.leftElbow>1.4&&pose.rightElbow>1.4);assert(pose.leftWing<.2&&pose.rightWing<.2);}
    if(pose.magnifier>.5){assert(pose.rightWing>.12&&Math.abs(pose.rightElbow)>.2);}
    if(pose.pennant>.5){assert(pose.leftWing>.2||pose.leftElbow>.6,'The flag is either raised or held across the chest.');}
  }
  assert(peak(samples('signature','mellow',1),'steam')>.65);
  assert(peak(samples('signature','scout',1),'magnifier')>.99);
  assert(peak(samples('signature','paws',1),'pennant')>.99);
});

test('encouragement is kind and restrained without cheers, feathers, marching, or mocking faces',()=>{
  for(const coach of coaches)for(const take of [0,1,2])for(const pose of samples('encourage',coach,take)){
    for(const key of ['pennant','feather','leftStep','rightStep','lift',...removed])assert.equal(pose[key]||0,0);
    assert(pose.leftWing<=.4&&pose.rightWing<=.4);
    assert(pose.mouth<=.35);
  }
});

test('idle gives finite, quiet personality through rigid joints without speech or deformation',()=>{
  for(const coach of coaches)for(const take of takes('idle',coach))for(const pose of samples('idle',coach,take)){
    for(const key of ['mouth',...removed])assert.equal(pose[key]||0,0);
    if(take<32)for(const key of ['leftStep','rightStep','bodyX','lift','tilt'])assert.equal(pose[key]||0,0);
    assert(Math.abs(pose.bodyX||0)<=14&&(pose.lift||0)>=-8&&(pose.lift||0)<=4&&Math.abs(pose.tilt||0)<=.018);
    assert((pose.leftStep||0)<=16&&(pose.rightStep||0)<=16&&!(pose.leftStep>0&&pose.rightStep>0));
    assert(Math.abs(pose.headTilt)<=.065&&Math.abs(pose.headNod)<=4);
    assert(pose.leftWing<=.45&&pose.rightWing<=.45);
  }
  assert(peak(samples('idle','owl',1),'book')>.6);
  assert(peak(samples('idle','mellow',0),'mug')>.75);
  assert(peak(samples('idle','scout',0),'magnifier')>.7);
});

test('talk keeps its original mouth timing, uses small gestures, and never pulls out a prop',()=>{
  for(const coach of coaches)for(const take of [0,1,2])for(let tick=1;tick<100;tick++){
    const time=tick/100,base=original('talk',coach,time,take),pose=applyCoachRepertoire('talk',base,time,coach,take);
    assert.equal(pose.mouth,base.mouth);assert.equal(pose.blink,base.blink);
    for(const key of ['book','pageTurn','glasses','mug','magnifier','pennant','feather','leftStep','rightStep','bodyX','lift','tilt',...removed])assert.equal(pose[key]||0,0);
    assert(pose.leftWing<=.28&&pose.rightWing<=.28);
    assert(Math.abs(pose.leftElbow)<=.5&&Math.abs(pose.rightElbow)<=.5);
  }
});

test('pages turn forward while visible, steam resets after fading, and steps alternate on the ground',()=>{
  for(const kind of kinds)for(const coach of coaches)for(const take of takes(kind,coach)){
    let lastPage=0,lastSteam=0;
    for(let tick=1;tick<200;tick++){
      const pose=at(kind,coach,tick/200,take);
      assert(!(pose.leftStep>.01&&pose.rightStep>.01),`${kind}/${coach}/${take} keeps a foot planted.`);
      if(pose.book>0){assert(pose.pageTurn>=lastPage-.000001);lastPage=pose.pageTurn;}
      if(pose.steam>0){assert(pose.steamPhase>=lastSteam-.000001);lastSteam=pose.steamPhase;}
    }
  }
});

test('rigid joint and prop actions stay continuous without pose switches during a reaction',()=>{
  const delta={leftWing:.09,rightWing:.09,leftElbow:.12,rightElbow:.12,leftStep:1.5,rightStep:1.5,leftFoot:.04,rightFoot:.04,leftEar:.045,rightEar:.045,headTilt:.02,headNod:1,bodyX:1.5,lookX:.12,book:.09,pageTurn:.12,mug:.09,mugLift:2.5,magnifier:.09,pennant:.09,glassAngle:.06,flagFlutter:.09};
  for(const kind of kinds)for(const coach of coaches)for(const take of takes(kind,coach)){
    let last=at(kind,coach,0,take);
    for(let tick=1;tick<=500;tick++){
      const pose=at(kind,coach,tick/500,take);
      for(const [key,limit]of Object.entries(delta))assert(Math.abs((pose[key]||0)-(last[key]||0))<limit,`${kind}/${coach}/${take}/${key} does not snap at ${tick}.`);
      if(pose.feather>.01&&last.feather>.01){assert(Math.abs(pose.featherX-last.featherX)<12);assert(Math.abs(pose.featherY-last.featherY)<12);}
      last=pose;
    }
  }
});

test('invalid inputs and take indexes are handled without changing saved poses',()=>{
  const frozen=Object.freeze({...seed,squash:.4,winkLeft:1,book:500,headNod:Infinity});
  const unknown=applyCoachRepertoire('unknown',frozen,.4);
  assert.equal(unknown.squash,0);assert.equal(unknown.winkLeft,0);assert.equal(unknown.book,1);assert.equal(unknown.headNod,0);
  assert.equal(frozen.winkLeft,1);assert.equal(frozen.book,500);
  assert.deepEqual(applyCoachRepertoire('greeting',seed,.4,'unknown'),applyCoachRepertoire('greeting',seed,.4,'meowl'));
  assert.deepEqual(applyCoachRepertoire('greeting',seed,.4,'meowl',-1),applyCoachRepertoire('greeting',seed,.4,'meowl',2));
  assert.deepEqual(applyCoachRepertoire('greeting',seed,.4,'meowl',3),applyCoachRepertoire('greeting',seed,.4,'meowl',0));
  assert.deepEqual(applyCoachRepertoire('greeting',seed,.4,'meowl',NaN),applyCoachRepertoire('greeting',seed,.4,'meowl',0));
  assert(Object.values(applyCoachRepertoire('think',null,.4,'mellow',1)).every(Number.isFinite));
});
