import { personalizeCoachPose } from './coach-character-motion.js';
import { applyCoachAction } from './coach-action-motion.js';
import { applyCoachRepertoire } from './coach-repertoire.js';
import { animateCoachFace } from './coach-face-motion.js';
export { createCoachPuppet, drawCoachPuppet } from './coach-action-renderer.js';

export const COACH_REACTION_DURATIONS = Object.freeze({ talk: 1250, brilliant: 1800, celebrate: 1500, great: 1500, curious: 1600, greeting: 1600, idle: 2400, think: 1100, approve: 1300, encourage: 1800, signature: 3200 });
const TRACKS = {
  think: {
    blink: [[0,0],[200,0],[270,1],[350,0],[1100,0]],
    leftWing: [[0,0],[340,.06],[660,.06],[1000,0],[1100,0]],
  },
  approve: {
    mouth: [[0,0],[140,.55],[280,.15],[420,.7],[560,0],[710,.45],[880,0],[1300,0]],
    blink: [[0,0],[680,0],[750,1],[830,0],[1300,0]],
    rightWing: [[0,0],[260,.1],[560,.14],[1000,0],[1300,0]],
  },
  encourage: {
    mouth: [[0,0],[200,.45],[360,0],[530,.6],[690,.1],[870,.5],[1040,0],[1210,.35],[1390,0],[1800,0]],
    blink: [[0,0],[420,0],[540,.9],[720,0],[1800,0]],
    leftWing: [[0,0],[360,.08],[850,.1],[1450,0],[1800,0]],
  },
  talk: {
    mouth: [[0,0],[100,.75],[190,1],[280,0],[390,.6],[470,1],[580,0],[690,.8],[790,.3],[900,0],[1030,.65],[1140,0],[1250,0]],
    blink: [[0,0],[760,0],[810,1],[860,1],[920,0],[1250,0]],
    tilt: [[0,0],[210,-.012],[450,.01],[680,-.008],[1050,0],[1250,0]],
    leftWing: [[0,0],[190,.06],[430,.02],[680,.045],[980,0],[1250,0]],
  },
  brilliant: {
    mouth: [[0,0],[220,.45],[500,.8],[1000,.6],[1420,.3],[1640,0],[1800,0]],
    blink: [[0,0],[1050,0],[1110,1],[1190,0],[1800,0]],
    wing: [[0,0],[130,.06],[300,.26],[500,.44],[720,.22],[940,.32],[1150,.12],[1370,.17],[1600,0],[1800,0]],
    lift: [[0,0],[120,8],[250,0],[500,-32],[820,-16],[1060,0],[1800,0]],
    tilt: [[0,0],[300,-.01],[650,.008],[1050,0],[1800,0]],
  },
  celebrate: {
    mouth: [[0,0],[210,.6],[420,.8],[650,.25],[850,.55],[1120,0],[1500,0]],
    blink: [[0,0],[900,0],[960,1],[1020,0],[1500,0]],
    wing: [[0,0],[240,.18],[490,.12],[730,.22],[1050,0],[1500,0]],
    lift: [[0,0],[150,4],[410,-14],[730,0],[1500,0]],
    tilt: [[0,0],[300,-.009],[700,.007],[1080,0],[1500,0]],
  },
  great: {
    mouth: [[0,0],[190,.6],[360,.25],[580,.7],[820,.2],[1060,0],[1500,0]],
    blink: [[0,0],[850,0],[920,1],[990,0],[1500,0]],
    rightWing: [[0,0],[220,.18],[440,.32],[690,.24],[1050,0],[1500,0]],
    tilt: [[0,0],[230,.015],[590,.008],[950,0],[1500,0]],
  },
  curious: {
    blink: [[0,0],[330,0],[410,1],[480,0],[1180,0],[1240,.65],[1320,0],[1600,0]],
    mouth: [[0,0],[730,0],[850,.35],[1010,0],[1600,0]],
    tilt: [[0,0],[390,-.035],[750,-.035],[1050,-.02],[1380,0],[1600,0]],
    leftWing: [[0,0],[480,.12],[830,.12],[1180,0],[1600,0]],
  },
  greeting: {
    mouth: [[0,0],[190,.65],[350,.2],[490,.85],[660,.1],[820,.5],[1080,0],[1600,0]],
    blink: [[0,0],[1090,0],[1160,1],[1230,0],[1600,0]],
    rightWing: [[0,0],[260,.55],[440,.3],[620,.65],[790,.3],[970,.55],[1250,0],[1600,0]],
    tilt: [[0,0],[240,.025],[600,.012],[1000,.025],[1320,0],[1600,0]],
    lift: [[0,0],[360,-10],[860,-5],[1250,0],[1600,0]],
  },
  idle: {
    blink: [[0,0],[220,0],[300,1],[360,1],[440,0],[900,0]],
    breathe: [[0,0],[420,1],[900,0]],
  },
};
const PERSONALITIES = {
  meowl: { pace: 1, wing: 1, tilt: 1, mouth: 1 },
  owl: { pace: 1.12, wing: .72, tilt: -.7, mouth: .82 },
  paws: { pace: .88, wing: 1.08, tilt: 1.1, mouth: 1 },
  mellow: { pace: 1.18, wing: .6, tilt: .6, mouth: .8 },
  scout: { pace: .95, wing: .9, tilt: -.9, mouth: .94 },
  evil: { pace: 1.06, wing: .8, tilt: -.8, mouth: .9 },
};

/** A fixed, finite timeline for the original drawing's moving parts. */
export function coachPoseAt(kind, elapsed, coachId = 'meowl', variation = 0) {
  const personality = PERSONALITIES[coachId] || PERSONALITIES.meowl;
  const duration = COACH_REACTION_DURATIONS[kind] || COACH_REACTION_DURATIONS.talk;
  elapsed = Math.max(0,Math.min(1,Number.isFinite(elapsed) ? elapsed / duration : 1)) ** personality.pace * duration;
  const pose = {};
  for (const [name, points] of Object.entries(kind === 'signature' ? {} : TRACKS[kind] || TRACKS.talk)) {
    pose[name] = points.at(-1)[1];
    for (let index = 1; index < points.length; index++) {
      const [end,value] = points[index], [start,from] = points[index-1];
      if (elapsed > end) continue;
      const fraction = Math.max(0,Math.min(1,(elapsed-start)/(end-start)));
      pose[name] = from + (value-from) * fraction * fraction * (3-2*fraction);
      break;
    }
  }
  for (const key of ['wing','leftWing','rightWing']) if (key in pose) pose[key] *= personality.wing;
  if ('tilt' in pose) pose.tilt *= personality.tilt;
  if ('mouth' in pose) pose.mouth *= personality.mouth;
  const progress = elapsed / duration;
  const actionPose = applyCoachRepertoire(kind, applyCoachAction(kind, personalizeCoachPose(kind, pose, progress, coachId), progress, coachId, variation), progress, coachId, variation);
  return animateCoachFace(kind, actionPose, progress, coachId, variation, duration);
}
