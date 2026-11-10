import { animateCoachFace } from './coach-face-motion.js';

const ENTRIES = {
  meowl: [
    ['scritches', 'Head scritches', 'Oh. That is a very good spot.', 'approve'],
    ['boop', 'Nose boop', 'Boop received. Returning one wing tap.', 'greeting'],
    ['feather', 'Catch the feather', 'Mine! Wait. Come back, little feather.', 'curious'],
    ['steps', 'Happy feet', 'A tiny victory dance. No chess required.', 'greeting'],
  ],
  baby: [
    ['scritches', 'Tiny head rub', 'More, please. Just one more.', 'approve'],
    ['peek', 'Peekaboo', 'Where did you go? Oh! There you are!', 'greeting'],
    ['reach', 'Little high-five', 'I can reach! I can reach!', 'greeting'],
    ['steps', 'Wobbly little steps', 'One little step. Two little steps. Ta-da!', 'curious'],
  ],
  owl: [
    ['scritches', 'A scholarly head rub', 'Ahem. Excellent technique. You may continue.', 'approve'],
    ['page', 'Pick a page', 'You picked the chapter on taking a little break.', 'curious'],
    ['glasses', 'Glasses shuffle', 'One moment. My spectacles have opinions.', 'greeting'],
    ['quiz', 'A tiny pop quiz', 'Left wing or right wing? Both is also acceptable.', 'curious'],
  ],
  paws: [
    ['scritches', 'Captain’s scritches', 'Permission to scritch: granted.', 'approve'],
    ['salute', 'Return the salute', 'A fine salute, crew mate!', 'greeting'],
    ['march', 'Follow the captain', 'Left. Right. Snack break.', 'greeting'],
    ['flag', 'Wave the colors', 'This pennant is officially waving at you.', 'approve'],
  ],
  mellow: [
    ['scritches', 'Sleepy scritches', 'Mmm. I was saving that spot for you.', 'approve'],
    ['cup', 'A cozy tea break', 'A little warmth. A little company.', 'greeting'],
    ['stretch', 'Slow wing stretch', 'No rush. We can stretch first.', 'approve'],
    ['ears', 'Wake those ears', 'I heard that. I was only resting my eyes.', 'curious'],
  ],
  scout: [
    ['scritches', 'Scritches discovered', 'New discovery: this feels very nice.', 'approve'],
    ['lens', 'Inspect your visitor', 'Aha! A friendly human. Case solved.', 'curious'],
    ['track', 'Follow the sound', 'Over here? Over there? Found you!', 'greeting'],
    ['tap', 'Secret wing signal', 'One tap. Two taps. Adventure time.', 'greeting'],
  ],
  evil: [
    ['scritches', 'Definitely not enjoying this', 'These scritches are merely part of my plan.', 'approve'],
    ['boop', 'A forbidden boop', 'You booped the villain. Bold choice.', 'curious'],
    ['sneak', 'A tiny evil scheme', 'Distract them with cuteness. Perfect.', 'greeting'],
    ['bow', 'Villain’s curtain call', 'Thank you, thank you. My evil work here is done.', 'approve'],
  ],
};

export const COACH_PLAY_ACTIONS = Object.freeze(Object.fromEntries(Object.entries(ENTRIES).map(([coach, entries]) => [coach,
  Object.freeze(entries.map(([id, label, text, soundKind], variant) => Object.freeze({
    id: `${coach}-${id}`, label, text, soundKind, variant,
    durationMs: coach === 'mellow' ? 3000 : coach === 'baby' ? 2600 : 2400,
  }))),
])));

const normalizeCoach = coach => Object.hasOwn(COACH_PLAY_ACTIONS, coach) ? coach : 'meowl';
export function coachPlayAction(coachId = 'meowl', variant = 0) {
  const actions = COACH_PLAY_ACTIONS[normalizeCoach(coachId)];
  const index = Number.isFinite(variant) ? ((Math.trunc(variant) % actions.length) + actions.length) % actions.length : 0;
  return actions[index];
}

/** Each coach remembers its own next game; repeated clicks cannot repeat a take. */
export function createCoachPlayCycle() {
  const nextTakes = new Map();
  return {
    next(coachId = 'meowl') {
      const coach = normalizeCoach(coachId), variant = nextTakes.get(coach) || 0;
      nextTakes.set(coach, (variant + 1) % COACH_PLAY_ACTIONS[coach].length);
      return coachPlayAction(coach, variant);
    },
    clear() { nextTakes.clear(); },
  };
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const ease = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
function track(t, points) {
  const frames = [[0, 0], ...points, [1, 0]];
  for (let i = 1; i < frames.length; i++) {
    const [end, to] = frames[i], [start, from] = frames[i - 1];
    if (t <= end) return from + (to - from) * ease((t - start) / (end - start));
  }
  return 0;
}

/** Small joint-led games. The face follows the same action; no squash or winks. */
export function coachPlayPoseAt(elapsed, coachId = 'meowl', variant = 0) {
  const coach = normalizeCoach(coachId), action = coachPlayAction(coach, variant);
  const t = elapsed / action.durationMs, pose = { mouth: 0, blink: 0 };
  if (!Number.isFinite(t) || t <= 0 || t >= 1) return pose;
  const set = (key, points) => { pose[key] = track(t, points); };
  const pulse = (key, value, start = .1, peak = .4, end = .9) => set(key, [[start, 0], [peak, value], [end, 0]]);
  const hold = (key, value, start = .1, arrive = .3, release = .66, end = .9) => set(key, [[start, 0], [arrive, value], [release, value], [end, 0]]);
  const wing = (side, angle, bend, start = .12, peak = .4, end = .88) => {
    pulse(`${side}Wing`, angle, start, peak, end); pulse(`${side}Elbow`, bend, start + .015, peak + .025, end + .025);
  };
  const step = (side, start, peak, end, height = 13) => {
    pulse(`${side}Step`, height, start, peak, end); pulse(`${side}Foot`, side === 'left' ? -.1 : .1, start, peak, end);
  };
  const first = action.variant === 0;
  if (first) {
    const lean = { meowl: .075, baby: .045, owl: -.04, paws: .055, mellow: .07, scout: -.065, evil: -.045 }[coach];
    set('headTilt', [[.08, 0], [.28, lean], [.47, lean * .55], [.65, lean], [.91, 0]]);
    set('headNod', [[.12, 0], [.31, -3], [.5, -1], [.67, -2], [.91, 0]]);
    set('leftEar', [[.15, 0], [.33, -.12], [.55, -.065], [.72, -.11], [.91, 0]]);
    set('rightEar', [[.18, 0], [.36, .105], [.58, .05], [.75, .09], [.93, 0]]);
    pulse('lookY', -.14, .1, .24, .43);
    // Eyes ease closed as the head leans into the scratch, then look back up.
    hold('blink', 1, .24, .31, .66, .77);
    if (coach === 'evil') { wing('right', .26, .7, .58, .73, .93); pulse('lookX', -.4, .05, .17, .31); }
    if (coach === 'baby') { wing('left', .15, .55, .22, .5, .86); wing('right', .15, .55, .27, .55, .89); }
    if (coach === 'paws') pulse('headNod', 3, .72, .84, .96);
  } else if (coach === 'meowl') {
    if (action.variant === 1) {
      pulse('headNod', -5, .07, .22, .45); pulse('leftEar', .13, .08, .2, .42);
      wing('right', .7, -.25, .32, .52, .81); pulse('headTilt', -.055, .46, .63, .91);
      set('lookX', [[.12, 0], [.32, .1], [.53, .65], [.82, 0]]);
    } else if (action.variant === 2) {
      hold('feather', 1, .08, .17, .77, .9);
      set('featherX', [[.08, 0], [.25, 230], [.49, -210], [.7, 100], [.9, 0]]);
      set('featherY', [[.001, 640], [.3, 570], [.5, 660], [.75, 600], [.99, 640]]);
      set('featherAngle', [[.12, 0], [.27, .6], [.5, -.5], [.76, .3], [.91, 0]]);
      wing('right', 1.05, -.65, .1, .28, .47); wing('left', 1, -.55, .35, .52, .72);
    } else {
      step('left', .1, .23, .35, 20); step('right', .38, .51, .63, 20); step('left', .65, .75, .85, 11);
      set('bodyX', [[.12, 0], [.26, -5], [.4, 0], [.54, 5], [.66, 0], [.8, -3], [.94, 0]]);
      wing('left', .33, .45, .12, .32, .61); wing('right', .35, .45, .43, .64, .91);
      set('headTilt', [[.1, 0], [.28, -.04], [.55, .04], [.83, -.025], [.96, 0]]);
    }
  } else if (coach === 'baby') {
    if (action.variant === 1) {
      hold('leftWing', .26, .08, .26, .49, .72); hold('rightWing', .27, .1, .28, .5, .74);
      hold('leftElbow', 1.65, .08, .26, .48, .71); hold('rightElbow', 1.65, .1, .28, .49, .73);
      pulse('headNod', 5, .12, .31, .57); hold('blink', 1, .23, .28, .45, .55);
      pulse('headTilt', .055, .5, .7, .92); pulse('rightEar', -.13, .56, .71, .94);
    } else if (action.variant === 2) {
      wing('right', .67, -.3, .1, .39, .77); step('left', .2, .44, .68, 11);
      pulse('lookX', .5, .1, .32, .69); pulse('lookY', -.4, .12, .35, .72); pulse('headNod', -4, .15, .38, .73);
      wing('left', .23, .5, .52, .69, .9);
    } else {
      step('left', .1, .25, .4, 12); step('right', .43, .58, .73, 12);
      set('headTilt', [[.12, 0], [.3, -.06], [.48, .04], [.65, -.025], [.87, 0]]);
      set('bodyX', [[.12, 0], [.29, -3], [.44, 0], [.62, 3], [.86, 0]]);
      wing('left', .24, .3, .1, .36, .77); wing('right', .24, .3, .15, .42, .81);
    }
  } else if (coach === 'owl') {
    if (action.variant === 1) {
      hold('book', 1, .13, .28, .69, .89);
      hold('leftWing', .1, .04, .2, .72, .93); hold('rightWing', .12, .06, .22, .72, .93);
      hold('leftElbow', 1.85, .04, .21, .72, .94); hold('rightElbow', 1.75, .06, .23, .72, .94);
      set('pageTurn', [[.3, 0], [.48, .5], [.64, 1], [.9, 1], [.98, 0]]);
      set('rightElbow', [[.06, 0], [.23, 1.75], [.45, 2], [.64, 1.75], [.72, 1.75], [.94, 0]]);
    } else if (action.variant === 2) {
      hold('glasses', 1, .16, .29, .52, .75); wing('right', .37, 1.15, .1, .35, .68);
      set('headTilt', [[.1, 0], [.27, -.04], [.48, .045], [.69, -.02], [.89, 0]]);
      pulse('lookY', -.3, .14, .34, .61); pulse('leftEar', .1, .58, .73, .92);
    } else {
      wing('left', .48, .65, .09, .29, .5); wing('right', .49, .65, .44, .63, .87);
      set('lookX', [[.08, 0], [.26, -.55], [.48, 0], [.63, .55], [.86, 0]]);
      pulse('headNod', 3, .65, .8, .95);
    }
  } else if (coach === 'paws') {
    if (action.variant === 1) {
      wing('right', .65, -.65, .1, .34, .7); pulse('headNod', -3, .13, .34, .64);
      step('left', .65, .77, .89, 11); pulse('leftEar', .1, .6, .75, .93);
    } else if (action.variant === 2) {
      step('left', .08, .23, .37, 24); step('right', .4, .55, .69, 24);
      wing('right', .36, .4, .08, .24, .45); wing('left', .36, .4, .41, .56, .79);
      set('headNod', [[.11, 0], [.25, 3], [.4, 0], [.57, 3], [.8, 0]]);
      pulse('headTilt', .055, .65, .8, .94);
    } else {
      hold('leftWing', .7, .035, .25, .66, .91); hold('leftElbow', -.25, .04, .26, .68, .93);
      hold('pennant', 1, .17, .3, .67, .85);
      set('flagFlutter', [[.15, 0], [.31, .22], [.44, -.2], [.58, .3], [.74, -.14], [.86, 0]]);
      wing('right', .35, .55, .4, .61, .88);
    }
  } else if (coach === 'mellow') {
    if (action.variant === 1) {
      hold('mug', 1, .14, .29, .68, .88); pulse('mugLift', 32, .27, .52, .76);
      hold('leftWing', .08, .035, .2, .72, .92); hold('rightWing', .1, .045, .22, .72, .92);
      hold('leftElbow', 1.85, .035, .2, .72, .92); hold('rightElbow', 1.85, .045, .22, .72, .92);
      pose.leftElbow += (pose.mugLift || 0) * .003; pose.rightElbow += (pose.mugLift || 0) * .003;
      hold('steam', .65, .2, .33, .66, .85); set('steamPhase', [[.2, 0], [.86, 1], [.96, 0]]);
    } else if (action.variant === 2) {
      wing('left', .65, -.25, .1, .43, .88); wing('right', .68, -.25, .14, .48, .93);
      pulse('headNod', -4, .16, .44, .84); hold('blink', 1, .27, .36, .56, .7);
    } else {
      set('leftEar', [[.1, 0], [.25, .17], [.36, -.055], [.48, .09], [.65, 0]]);
      set('rightEar', [[.34, 0], [.49, -.16], [.61, .05], [.73, -.07], [.88, 0]]);
      pulse('headTilt', .065, .26, .51, .92); pulse('lookX', -.38, .1, .26, .66);
    }
  } else if (coach === 'scout') {
    if (action.variant === 1) {
      hold('rightWing', .58, .04, .26, .67, .91); hold('rightElbow', -.7, .06, .27, .68, .93);
      hold('magnifier', 1, .18, .32, .67, .86); set('glassAngle', [[.19, 0], [.35, -.2], [.58, .22], [.84, 0]]);
      pulse('headTilt', .055, .17, .43, .9); step('left', .57, .72, .87, 12);
    } else if (action.variant === 2) {
      set('lookX', [[.07, 0], [.23, -.8], [.46, .7], [.7, .05], [.9, 0]]);
      set('headTilt', [[.12, 0], [.29, -.07], [.54, .065], [.82, 0]]);
      pulse('leftEar', .15, .08, .21, .39); pulse('rightEar', -.16, .34, .49, .69);
      wing('right', .5, .4, .58, .76, .93);
    } else {
      set('rightWing', [[.1, 0], [.27, .53], [.39, .22], [.53, .6], [.68, .25], [.87, 0]]);
      set('rightElbow', [[.12, 0], [.29, .4], [.42, .1], [.55, .5], [.7, .12], [.89, 0]]);
      pulse('lookX', .4, .14, .38, .77); step('left', .61, .76, .9, 16);
    }
  } else {
    // The left wing stays available to the fixed-grip pitchfork renderer.
    if (action.variant === 1) {
      pulse('headNod', -5, .08, .24, .46); pulse('leftEar', .14, .1, .23, .42);
      wing('right', .53, .6, .31, .52, .81); pulse('headTilt', .055, .47, .66, .92);
      pulse('lookX', .55, .35, .53, .82);
    } else if (action.variant === 2) {
      set('lookX', [[.07, 0], [.21, -.7], [.41, .55], [.67, -.25], [.91, 0]]);
      step('right', .24, .38, .51, 12); step('left', .53, .67, .81, 12);
      set('bodyX', [[.18, 0], [.38, 5], [.51, 0], [.68, -5], [.89, 0]]);
      wing('right', .17, 1.1, .24, .53, .88); pulse('headTilt', -.06, .22, .42, .8);
    } else {
      wing('right', .7, -.2, .08, .28, .65); pulse('headNod', 7, .29, .54, .85);
      pulse('headTilt', .035, .31, .54, .85); pulse('lookY', .5, .27, .5, .82);
      step('right', .55, .72, .88, 9);
    }
  }
  if (!(pose.feather > 0)) pose.featherY = 0;
  const result = animateCoachFace('play', pose, t, coach, action.variant, action.durationMs);
  // Preserve intentional relaxed eyes during scritches/peekaboo/stretching.
  result.blink = Math.max(result.blink, pose.blink);
  return result;
}
