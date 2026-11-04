import test from 'node:test';
import assert from 'node:assert/strict';
import { coachPoseAt, COACH_REACTION_DURATIONS } from '../extension/lib/coach-puppet.js';
import { coachArtworkId, coachPortraitUrl, coachPuppetUrl } from '../extension/lib/coach-portraits.js';
import { readFile } from 'node:fs/promises';

test('all coach reactions have finite bounded poses and settle to the original portrait', () => {
  for (const coachId of ['meowl','owl','paws','mellow','scout']) for (const [kind,duration] of Object.entries(COACH_REACTION_DURATIONS)) {
    for (const time of [-100,0,duration,duration+200,Infinity,NaN]) {
      assert(Object.values(coachPoseAt(kind,time,coachId)).every(value=>value===0), `${kind}/${coachId} neutral at ${time}`);
    }
    for (let time=0;time<=duration;time+=10) {
      const pose=coachPoseAt(kind,time,coachId);
      assert(Object.values(pose).every(Number.isFinite));
      for (const key of ['mouth','blink','breathe']) assert((pose[key]||0)>=0&&(pose[key]||0)<=1,`${kind} ${key} bounded`);
      for (const key of ['leftWing','rightWing']) assert((pose[key]||0)>=0&&(pose[key]||0)<=1.35,`${kind} wing bounded`);
      for (const key of ['winkLeft','winkRight','squash','bodyBend','blep','eyeSmile','breathe']) assert.equal(pose[key]||0,0,`${kind} never uses ${key}`);
      assert(Math.abs(pose.tilt||0)<=.025);
      assert((pose.lift||0)>=-12&&(pose.lift||0)<=6);
    }
  }
});

test('Meowl follows and bats a feather with separate wings; curiosity stays grounded and idle stays quiet', () => {
  const duration=COACH_REACTION_DURATIONS.signature;
  const first=coachPoseAt('signature',duration*.255);
  const second=coachPoseAt('signature',duration*.515);
  assert(first.rightWing>1&&first.leftWing<.3&&first.featherX>250);
  assert(second.leftWing>1&&second.rightWing<.3&&second.featherX< -250);
  assert.equal(first.feather,1); assert.equal(second.feather,1);
  for (let time=0;time<1600;time+=40) {
    const pose=coachPoseAt('curious',time);
    assert.equal(pose.lift||0,0); assert.equal(pose.wing,0);
  }
  const idles=Array.from({length:24},(_,index)=>coachPoseAt('idle',COACH_REACTION_DURATIONS.idle*index/24));
  for(const idle of idles) for(const key of ['leftStep','rightStep','bodyX','lift','squash','breathe','mouth'])assert.equal(idle[key]||0,0);
  assert(idles.some(idle=>idle.leftEar>0), 'Meowl quietly listens while waiting.');
});

test('coach personalities have distinct timing without changing the source drawing', () => {
  assert.notDeepEqual(coachPoseAt('greeting',450,'owl'),coachPoseAt('greeting',450,'paws'));
  const pose=coachPoseAt('talk',300);pose.mouth=200;
  assert(coachPoseAt('talk',300).mouth<=1);
  assert.deepEqual(coachPoseAt('talk',200,'unknown'),coachPoseAt('talk',200,'meowl'));
});

test('Great has a grounded single-wing acknowledgment distinct from Best and Brilliant', () => {
  const great = coachPoseAt('great', 440);
  assert(great.rightWing > .2);
  assert.equal(great.wing, 0);
  assert.equal(great.lift, 0);
  assert.notDeepEqual(great, coachPoseAt('celebrate', 440));
  assert.notDeepEqual(great, coachPoseAt('brilliant', 440));
});

test('every coach has a local portrait and a clean animation base for its shared face', async () => {
  const ids = ['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil'];
  const portraits = ids.map(coachPortraitUrl);
  assert.equal(new Set(portraits).size, 6);
  for (const id of ids) {
    assert.equal(coachArtworkId(id), id);
    const svg = await readFile(new URL(coachPortraitUrl(id)), 'utf8');
    assert.match(svg, /width="1254" height="1254"/);
    assert.match(svg, /href="data:image\/png;base64,/);
    assert(!/<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/i.test(svg));
    if(id==='evil')assert.match(svg, /data-render-source="coach-action-renderer"/);
    else assert.match(svg, new RegExp(`id="face-${id}-`));
    assert(coachPuppetUrl(id).endsWith(`MeowlChess-coach-${id}-base.svg`));
    const base = await readFile(new URL(coachPuppetUrl(id)), 'utf8');
    assert.match(base, /href="data:image\/png;base64,/);
    assert(!base.includes(`id="face-${id}-`), 'The animated head must not retain a second static face.');
  }
  assert.equal(coachPortraitUrl('unknown'), coachPortraitUrl('meowl'));
  assert.equal(coachPuppetUrl('unknown'), coachPuppetUrl('meowl'));
});
