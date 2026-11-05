const LIMITS = Object.freeze({
  mouth: [0, 1], blink: [0, 1], breathe: [0, 1],
  wing: [0, .7], leftWing: [0, .7], rightWing: [0, .7],
  lift: [-45, 12], tilt: [-.045, .045], headTilt: [-.09, .09], headNod: [-10, 10],
});
const COACHES = new Set(['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil']);
const REACTIONS = new Set(['talk', 'brilliant', 'celebrate', 'great', 'curious', 'greeting', 'idle', 'encourage', 'approve', 'think']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A gesture starts and ends at rest, including its velocity.
function pulse(progress, start, end) {
  if (progress <= start || progress >= end) return 0;
  return Math.sin(Math.PI * (progress - start) / (end - start)) ** 2;
}

// Hold a readable expression for a moment, then settle back without a snap.
function hold(progress, start, peak, release, end) {
  if (progress <= start || progress >= end) return 0;
  const smooth = value => value * value * (3 - 2 * value);
  if (progress < peak) return smooth((progress - start) / (peak - start));
  if (progress > release) return 1 - smooth((progress - release) / (end - release));
  return 1;
}

/** Add a coach's mannerisms to a finite pose without changing its timing or input. */
export function personalizeCoachPose(kind, input, progress, coachId = 'meowl') {
  const pose = {};
  if (!input || typeof input !== 'object') return pose;
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    if (Object.hasOwn(input, key)) pose[key] = clamp(Number.isFinite(input[key]) ? input[key] : 0, low, high);
  }
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) {
    for (const key of Object.keys(pose)) pose[key] = 0;
    return pose;
  }
  if (!REACTIONS.has(kind)) return pose;
  if (coachId === 'baby') return pose;
  coachId = COACHES.has(coachId) ? coachId : 'meowl';
  const gesture = pulse(progress, .08, .84);
  const talking = kind === 'talk' || kind === 'greeting';
  const celebration = kind === 'brilliant' || kind === 'celebrate';
  const considering = kind === 'think' || kind === 'curious';
  const approving = kind === 'approve' || kind === 'great';
  const change = (key, value) => { const [low, high] = LIMITS[key]; pose[key] = clamp(value, low, high); };
  const scale = (key, factor) => { if (key in pose) change(key, pose[key] * factor); };
  const head = (tilt, nod) => {
    change('headTilt', (pose.headTilt || 0) + tilt);
    change('headNod', (pose.headNod || 0) + nod);
  };
  const nod = (strength, start, end) => strength * pulse(progress, start, end);

  if (kind === 'idle') {
    // Quiet blinks only: no surprise waves or jumps between comments.
    if (coachId === 'mellow') {
      pose.blink = pulse(progress, .18, .78);
      scale('breathe', .65);
    } else if (coachId === 'owl') {
      pose.blink = pulse(progress, .34, .59);
      scale('breathe', .4);
    } else if (coachId === 'scout') {
      pose.blink = Math.max(pulse(progress, .18, .36), .75 * pulse(progress, .46, .64));
      scale('breathe', .5);
    } else if (coachId === 'evil') {
      pose.blink = pulse(progress, .59, .79);
      pose.breathe = 0;
    }
    return pose;
  }

  if (coachId === 'evil') {
    // Measured, conspiratorial emphasis; the articulated layer supplies the action.
    scale('mouth', .9); change('lift', 0); change('tilt', 0);
    if (talking || considering) head(.04 * hold(progress,.12,.31,.56,.9),nod(-2,.17,.6));
    else if (kind === 'encourage') head(.025 * gesture,nod(4,.29,.82));
    else if (approving || celebration) head(-.03 * gesture,nod(4,.3,.76));
  } else if (coachId === 'meowl') {
    // Friendly eye contact: one small nod, then a relaxed listening tilt.
    if (talking) {
      head(.028 * pulse(progress, .08, .52) - .014 * pulse(progress, .5, .93), nod(5, .28, .66));
      if (kind === 'greeting') change('tilt', (pose.tilt || 0) + .006 * gesture);
    } else if (considering) {
      head(-.052 * hold(progress, .08, .29, .59, .94), nod(-3, .2, .78));
    } else if (kind === 'encourage') {
      head(.045 * hold(progress, .08, .31, .56, .93), nod(6, .3, .76));
      change('rightWing', Math.max(pose.rightWing || 0, .1 * gesture));
    } else if (approving) {
      head(-.018 * gesture, nod(6, .12, .47) + nod(3, .52, .88));
      change('rightWing', Math.max(pose.rightWing || 0, .16 * pulse(progress, .17, .76)));
    } else if (celebration) {
      head(.038 * pulse(progress, .13, .62), nod(kind === 'brilliant' ? -7 : -4, .14, .61));
    }
  } else if (coachId === 'owl') {
    scale('tilt', .5); scale('mouth', .85); scale('lift', .15);
    for (const key of ['wing', 'leftWing', 'rightWing']) scale(key, .7);
    if (talking || kind === 'great') {
      change('rightWing', Math.max(pose.rightWing || 0, .15 * gesture));
      // A tiny downward nod punctuates an explanation rather than a bounce.
      change('lift', (pose.lift || 0) + 3 * pulse(progress, .25, .55));
    }
    // Professor punctuates a point with two measured nods, keeping its body still.
    if (talking || approving) {
      head(-.017 * gesture, nod(6, .16, .44) + nod(4, .53, .83));
      change('rightWing', Math.max(pose.rightWing || 0, .18 * hold(progress, .15, .31, .56, .85)));
    } else if (considering) {
      head(-.043 * hold(progress, .08, .3, .62, .92), nod(-3, .2, .7));
      change('rightWing', Math.max(pose.rightWing || 0, .09 * hold(progress, .22, .39, .58, .85)));
    } else if (kind === 'encourage') {
      head(.024 * gesture, nod(7, .24, .76));
      change('rightWing', Math.max(pose.rightWing || 0, .13 * gesture));
    } else if (celebration) {
      head(-.024 * gesture, nod(6, .14, .43) + nod(4, .53, .82));
    }
  } else if (coachId === 'paws') {
    if (celebration) {
      change('lift', (pose.lift || 0) - 7 * pulse(progress, .15, .62));
      change('wing', (pose.wing || 0) + .075 * gesture);
    } else if (talking || kind === 'great') {
      change('rightWing', (pose.rightWing || 0) + .075 * gesture);
      change('tilt', (pose.tilt || 0) + .008 * pulse(progress, .12, .6));
    }
    // Captain's chin lifts before a confident nod or a single broad salute.
    if (talking) {
      head(.054 * pulse(progress, .08, .55) - .022 * pulse(progress, .58, .92), nod(-4, .12, .4) + nod(7, .46, .78));
    } else if (approving) {
      head(.044 * gesture, nod(-4, .08, .34) + nod(8, .37, .72));
      change('rightWing', Math.max(pose.rightWing || 0, .28 * pulse(progress, .16, .75)));
    } else if (considering) {
      head(.042 * hold(progress, .06, .25, .54, .91), nod(-4, .16, .67));
    } else if (kind === 'encourage') {
      head(-.035 * gesture, nod(8, .16, .61));
      change('leftWing', Math.max(pose.leftWing || 0, .2 * pulse(progress, .21, .82)));
    } else if (celebration) {
      head(.062 * pulse(progress, .1, .61) - .025 * pulse(progress, .62, .94), nod(-8, .15, .56));
    }
  } else if (coachId === 'mellow') {
    scale('tilt', .5); scale('mouth', .75); scale('lift', .1);
    for (const key of ['wing', 'leftWing', 'rightWing']) scale(key, .6);
    // One unhurried blink replaces the quick reaction blink.
    pose.blink = pulse(progress, .4, .86);
    // Mellow lets a gesture linger: a slow nod or reassuring head tilt.
    if (talking) {
      head(.035 * hold(progress, .08, .35, .56, .95), nod(3, .28, .84));
    } else if (considering) {
      head(.047 * hold(progress, .09, .38, .6, .96), nod(-2, .24, .8));
    } else if (kind === 'encourage') {
      head(.055 * hold(progress, .06, .32, .61, .97), nod(4, .27, .86));
      change('leftWing', Math.max(pose.leftWing || 0, .07 * pulse(progress, .18, .89)));
    } else if (approving || celebration) {
      head(.03 * gesture, nod(4, .17, .73));
    }
  } else if (coachId === 'scout') {
    scale('lift', .2);
    if (kind === 'curious' || kind === 'talk') {
      change('tilt', -.022 * pulse(progress, .06, .49) + .014 * pulse(progress, .47, .92));
      change('leftWing', Math.max(pose.leftWing || 0, .13 * pulse(progress, .22, .73)));
    } else if (kind === 'greeting' || kind === 'great') {
      scale('rightWing', .7);
      change('tilt', -.014 * gesture);
    }
    // Scout checks one side, then the other; its head moves independently of the vest.
    if (considering || kind === 'talk') {
      head(-.072 * hold(progress, .05, .2, .34, .53) + .045 * hold(progress, .5, .66, .77, .95), nod(-4, .12, .47));
    } else if (kind === 'greeting') {
      head(-.04 * pulse(progress, .08, .5) + .024 * pulse(progress, .52, .93), nod(-3, .15, .56));
    } else if (kind === 'encourage') {
      head(-.052 * hold(progress, .07, .28, .47, .85), nod(5, .44, .85));
      change('leftWing', Math.max(pose.leftWing || 0, .14 * pulse(progress, .25, .78)));
    } else if (approving) {
      head(-.043 * pulse(progress, .08, .49) + .026 * pulse(progress, .5, .91), nod(6, .32, .73));
      change('leftWing', Math.max(pose.leftWing || 0, .2 * pulse(progress, .18, .76)));
    } else if (celebration) {
      head(-.065 * pulse(progress, .08, .51) + .034 * pulse(progress, .53, .93), nod(-6, .13, .55));
    }
  }
  return pose;
}
