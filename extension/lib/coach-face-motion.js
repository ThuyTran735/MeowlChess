const FACE_LIMITS = Object.freeze({ lookX: [-1, 1], lookY: [-1, 1], headTilt: [-.1, .1], headNod: [-8, 8], blink: [0, 1] });
const COACHES = new Set(['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil', 'baby']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smooth = (start, end, value) => {
  const t = clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
};
const beat = (time, start, peak, end) => time < peak
  ? smooth(start, peak, time) : 1 - smooth(peak, end, time);
const variationValue = (take, text) => {
  let hash = Math.trunc(finite(take)) >>> 0;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13; hash = Math.imul(hash, 3266489909) >>> 0;
  return ((hash ^ hash >>> 16) >>> 0) / 4294967296;
};
const blinkCenters = new Map();
function authoredBlinkCenter(kind, coach, variation) {
  if (!Object.hasOwn(COACH_ANIMATION_LABELS, kind) || kind === 'talk') return null;
  const count = coachAnimationTakeCount(kind, coach), take = ((variation % count) + count) % count;
  const key = `${coach}/${kind}/${take}`;
  if (blinkCenters.has(key)) return blinkCenters.get(key);
  const samples = [];
  for (let step = 1; step < 80; step++) {
    const progress = step / 80;
    const source = applyCoachRepertoire(kind, applyCoachAction(kind, {}, progress, coach, take), progress, coach, take);
    samples.push({ progress, blink: finite(source.blink) });
  }
  const peak = Math.max(...samples.map(sample => sample.blink));
  const top = samples.filter(sample => sample.blink >= Math.max(.5, peak - .035));
  const first = top[0]?.progress;
  const closure = top.filter(sample => sample.progress - first < .2);
  const center = peak >= .5 && closure.length ? closure.reduce((sum, sample) => sum + sample.progress, 0) / closure.length : null;
  // Bounded to the finite repertoire, even if an external caller uses bad IDs.
  blinkCenters.set(key, center);
  return center;
}

/**
 * Connect facial attention to an already-authored gesture. Positive lookY is down.
 * Progress is the caller's personality-paced progress; this adds no second clock.
 * The mouth, body, props and joints are retained, with no eye scaling or winks.
 */
export function animateCoachFace(kind, input, progress, coachId = 'meowl', variation = 0, durationMs) {
  const pose = input && typeof input === 'object' ? { ...input } : {};
  for (const [key, value] of Object.entries(pose)) {
    if (typeof value === 'number' && !Number.isFinite(value)) pose[key] = 0;
  }
  for (const [key, [low, high]] of Object.entries(FACE_LIMITS)) pose[key] = clamp(finite(pose[key]), low, high);
  for (const key of ['winkLeft', 'winkRight']) if (key in pose) pose[key] = 0;
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) {
    for (const key of Object.keys(FACE_LIMITS)) pose[key] = 0;
    return pose;
  }

  const time = progress, coach = COACHES.has(coachId) ? coachId : 'meowl';
  const take = Math.trunc(finite(variation)), accent = ((take % 3) + 3) % 3;
  const timing = variationValue(take, `${coach}/${kind}/attention`);
  const directionSeed = variationValue(take, `${coach}/${kind}/direction`);
  const duration = clamp(finite(durationMs, kind === 'idle' ? 2400 : 1600), 600, 12000);
  const edge = smooth(0, .06, time) * (1 - smooth(.94, 1, time));
  const prop = key => clamp(finite(pose[key]), 0, 1);
  const book = prop('book'), mug = prop('mug'), lens = prop('magnifier');
  const feather = prop('feather'), flag = prop('pennant');
  const occupied = Math.max(book, mug, lens, feather, flag);
  const toward = (key, target, weight) => {
    const current = pose[key], [low, high] = FACE_LIMITS[key];
    target = clamp(target, low, high);
    // Retain a strong authored glance in the same direction. The continuous
    // weight avoids snapping when a moving target passes through center.
    const units = key === 'headTilt' ? .1 : key === 'headNod' ? 8 : 1;
    const a = current / units, b = target / units;
    const retain = smooth(0, .3, Math.abs(a) - Math.abs(b)) * smooth(0, .12, a * b);
    pose[key] = current + (target - current) * clamp(weight * (1 - .85 * retain), 0, 1);
  };
  const attend = (x, y, tilt, nod, amount) => {
    // Eyes find the object first; the head catches up as it is brought into place.
    const eyes = smooth(0, .7, amount) * edge;
    const head = smooth(.12, .95, amount) * edge;
    toward('lookX', x, eyes * .86); toward('lookY', y, eyes * .94);
    toward('headTilt', tilt, head * .72); toward('headNod', nod, head * .72);
  };

  if (coach === 'owl' && book > 0) {
    const page = prop('pageTurn'), turning = Math.sin(Math.PI * page);
    const authored = smooth(.03, .22, Math.abs(pose.lookX));
    const reading = (-.25 + .5 * smooth(.25, .7, time)) * (1 - authored) + pose.lookX * authored;
    const scan = reading * (1 - turning) + .42 * Math.cos(Math.PI * page) * turning;
    attend(scan, .8 - .14 * turning, scan * .075, 6.5 - turning, book);
  } else if (coach === 'mellow' && mug > 0) {
    const lifted = smooth(0, 75, finite(pose.mugLift));
    // Watch the cup come up, then lift the chin with it; do not stare at the lap.
    attend(pose.lookX * .55, .78 - .6 * lifted, .018, 5.5 - 6 * lifted, mug);
  } else if (coach === 'scout' && lens > 0) {
    const raised = smooth(.12, 1.1, finite(pose.rightWing));
    const x = clamp(.44 + .25 * raised + finite(pose.glassAngle) * .48, .2, .85);
    const y = .55 - .72 * raised;
    attend(x, y, .025 + .035 * x, y * 6, lens);
  } else if (coach === 'meowl' && feather > 0) {
    const x = clamp(finite(pose.featherX) / 280, -.94, .94);
    const y = clamp((finite(pose.featherY, 650) - 500) / 360, .06, .94);
    attend(x, y, x * .085, (y - .28) * 7, feather);
  } else if (coach === 'paws' && flag > 0) {
    const raised = smooth(.16, 1.05, finite(pose.leftWing));
    const x = -.38 - .25 * raised, y = .25 - .82 * raised;
    attend(x, y, x * .08, y * 5, flag);
  }

  const left = clamp(finite(pose.leftWing), 0, 1.35), right = clamp(finite(pose.rightWing), 0, 1.35);
  const difference = right - left, raised = Math.max(left, right);
  const handAttention = smooth(.035, .5, Math.abs(difference)) * (1 - occupied);
  const direction = clamp(difference * 1.1, -.72, .72);
  const height = .15 - .5 * smooth(.3, 1.15, raised);
  // A salute/high-five gets a glance toward the moving wing. Two equally raised
  // wings keep eye contact rather than arbitrarily choosing a side.
  const glanceSpace = 1 - smooth(.15, .65, Math.abs(pose.lookX));
  const tiltSpace = 1 - smooth(.025, .075, Math.abs(pose.headTilt));
  toward('lookX', direction, handAttention * .65 * glanceSpace);
  toward('lookY', height, handAttention * .7);
  toward('headTilt', direction * .09, handAttention * .72 * tiltSpace);
  toward('headNod', height * 6, handAttention * .45 * (1 - smooth(2, 6, Math.abs(pose.headNod))));

  // Keep deliberate nods and scans from the repertoire. Fill only a missing
  // facial beat, with different intent for a question, praise, and reassurance.
  const quiet = (1 - occupied) * (1 - handAttention * .5);
  const addIfQuiet = (key, value, threshold) => {
    const space = 1 - smooth(0, threshold, Math.abs(pose[key]));
    pose[key] += value * space * quiet;
  };
  if (kind === 'think' || kind === 'curious') {
    const lean = { meowl: -.045, owl: -.028, paws: .028, mellow: .035, scout: -.05, evil: .045, baby: -.035 }[coach];
    addIfQuiet('headTilt', lean * beat(time, .055, .24 + accent * .035, .82), .04);
    addIfQuiet('lookY', -.14 * beat(time, .04, .18, .5), .3);
  } else if (kind === 'approve' || kind === 'great') {
    addIfQuiet('headNod', -1.4 * beat(time, .04, .14, .28) + 3.2 * beat(time, .28, .48, .79), 3.5);
    addIfQuiet('lookY', .16 * beat(time, .3, .48, .78), .25);
  } else if (kind === 'encourage') {
    const lean = coach === 'scout' || coach === 'owl' ? -.032 : .036;
    addIfQuiet('headTilt', lean * beat(time, .07, .32, .88), .04);
    addIfQuiet('headNod', 2.5 * beat(time, .31, .57, .88), 3.5);
  } else if (kind === 'talk') {
    const emphasis = .34 + accent * .09;
    const strength = coach === 'mellow' ? 1.8 : coach === 'paws' ? 3.2 : 2.4;
    addIfQuiet('headNod', strength * beat(time, emphasis - .14, emphasis, emphasis + .25), 3.5);
    addIfQuiet('headTilt', (coach === 'scout' || coach === 'owl' ? -.02 : .02) * beat(time, .08, .25, .67), .04);
  }

  // Let otherwise quiet eyes notice the same thing as the ears/head, then
  // return to eye contact. Held objects, deliberate scans and two-wing gestures
  // keep their authored attention; this does not add another head/body bob.
  const gazeStart = .13 + timing * .18;
  const glance = smooth(gazeStart, gazeStart + .09, time) * (1 - smooth(gazeStart + .27, gazeStart + .46, time));
  const sharedGesture = smooth(.2, .65, Math.min(left, right));
  const gazeSpace = (1 - occupied) * (1 - handAttention) * (1 - sharedGesture);
  const hearing = finite(pose.rightEar) - finite(pose.leftEar);
  const headHint = clamp(pose.headTilt * 5 + hearing * .9, -.36, .36);
  const sign = directionSeed < .5 ? -1 : 1;
  const headWeight = smooth(.025, .1, Math.abs(headHint));
  const targetX = headHint * headWeight + sign * (.19 + directionSeed * .12) * (1 - headWeight);
  const nodWeight = smooth(.2, 1.2, Math.abs(pose.headNod));
  const restingY = kind === 'think' || kind === 'curious' || kind === 'brilliant' ? -.17 : .09;
  const targetY = clamp(pose.headNod * .045, -.23, .23) * nodWeight + restingY * (1 - nodWeight);
  const xSpace = 1 - smooth(.025, .18, Math.abs(pose.lookX));
  const ySpace = 1 - smooth(.035, .23, Math.abs(pose.lookY));
  pose.lookX += targetX * glance * gazeSpace * xSpace;
  pose.lookY += targetY * glance * gazeSpace * ySpace;

  // Every take gets a readable paired blink, including all 40 idle scenes. Its
  // short close/hold/reopen timing is measured in milliseconds rather than a
  // percentage of the gesture, so quick reactions do not become tiny flashes.
  // Coalesce with the authored closure instead of stacking another rapid blink.
  // No mouth or prop timing changes.
  const thoughtful = kind === 'think' || kind === 'curious';
  const close = coach === 'mellow' ? 85 : 70, held = coach === 'mellow' ? 105 : 90;
  const open = coach === 'mellow' ? 135 : 110;
  const authored = authoredBlinkCenter(kind, coach, take);
  const center = authored === null ? (thoughtful ? .24 + timing * .13 : .35 + timing * .35)
    : authored + (timing - .5) * 50 / duration;
  const point = clamp(center * duration, duration * .07 + close, duration * .93 - held - open);
  const blink = smooth(point - close, point, time * duration) * (1 - smooth(point + held, point + held + open, time * duration));
  pose.blink = blink;
  for (const [key, [low, high]] of Object.entries(FACE_LIMITS)) pose[key] = clamp(finite(pose[key]) * edge, low, high);
  return pose;
}
import { applyCoachAction } from './coach-action-motion.js';
import { applyCoachRepertoire, COACH_ANIMATION_LABELS, coachAnimationTakeCount } from './coach-repertoire.js';
