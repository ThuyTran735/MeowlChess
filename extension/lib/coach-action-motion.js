const LIMITS = Object.freeze({
  mouth: [0, 1], blink: [0, 1], lookX: [-1, 1],
  leftWing: [0, 1.35], rightWing: [0, 1.35], leftElbow: [-2.2, 2.2], rightElbow: [-2.2, 2.2],
  leftFoot: [-.3, .3], rightFoot: [-.3, .3], leftStep: [0, 28], rightStep: [0, 28],
  leftEar: [-.18, .18], rightEar: [-.18, .18],
  headTilt: [-.1, .1], headNod: [-8, 8], bodyX: [-18, 18], lift: [-12, 6], tilt: [-.025, .025],
  book: [0, 1], pageTurn: [0, 1], glasses: [0, 1],
  feather: [0, 1], featherX: [-280, 280], featherY: [500, 900], featherAngle: [-1, 1],
});
const REMOVED = ['winkLeft', 'winkRight', 'blep', 'eyeSmile', 'squash', 'bodyBend', 'leftFlop', 'rightFlop', 'breathe', 'leftReach', 'rightReach', 'hug', 'wing'];
const COACHES = new Set(['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil']);
const ACTIONS = new Set(['signature', 'greeting', 'brilliant']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Continuous, bounded joint motion. A reversal eases to a stop; a purposeful
// stroke keeps flowing through its intermediate positions without spring noise.
function track(time, points, initial = 0, final = 0) {
  const frames = [[0, initial], ...points, [1, final]];
  if (time <= 0) return initial;
  if (time >= 1) return final;
  let index = 1;
  while (time > frames[index][0]) index++;
  const tangent = at => {
    if (at === 0 || at === frames.length - 1) return 0;
    const before = frames[at][0] - frames[at - 1][0], after = frames[at + 1][0] - frames[at][0];
    const incoming = (frames[at][1] - frames[at - 1][1]) / before;
    const outgoing = (frames[at + 1][1] - frames[at][1]) / after;
    if (incoming * outgoing <= 0) return 0;
    const a = 2 * after + before, b = after + 2 * before;
    return (a + b) / (a / incoming + b / outgoing);
  };
  const [start, from] = frames[index - 1], [end, to] = frames[index];
  const span = end - start, p = (time - start) / span;
  return (2 * p ** 3 - 3 * p ** 2 + 1) * from
    + (p ** 3 - 2 * p ** 2 + p) * span * tangent(index - 1)
    + (-2 * p ** 3 + 3 * p ** 2) * to
    + (p ** 3 - p ** 2) * span * tangent(index);
}

/** Fixed-proportion actions: rigid wing/elbow, foot, ear, and head articulation. */
export function applyCoachAction(kind, basePose, progress, coachId = 'meowl', variation = 0) {
  const pose = {};
  if (basePose && typeof basePose === 'object') {
    for (const [key, [low, high]] of Object.entries(LIMITS)) {
      if (Object.hasOwn(basePose, key)) pose[key] = key === 'featherY' && !basePose[key]
        ? 0 : clamp(Number.isFinite(basePose[key]) ? basePose[key] : 0, low, high);
    }
    // Older acknowledgement tracks used one wing channel for both sides.
    // Translate it to the rigid joints before disabling the legacy channel.
    if (Object.hasOwn(basePose, 'wing')) for (const key of ['leftWing', 'rightWing']) {
      if (!Object.hasOwn(basePose, key)) pose[key] = clamp(Number.isFinite(basePose.wing) ? basePose.wing : 0, 0, 1.35);
    }
  }
  // These channels are disabled even for idle, older reactions, or malformed
  // saved poses. No earlier layer can reintroduce winks or deform the artwork.
  for (const key of REMOVED) pose[key] = 0;
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) {
    for (const key of Object.keys(pose)) pose[key] = 0;
    return pose;
  }
  // Baby's dedicated repertoire authors every gesture; preserve only the
  // upstream speech/blink timing here instead of borrowing an adult signature.
  if (coachId === 'baby') return pose;
  if (!ACTIONS.has(kind) && kind !== 'talk') {
    pose.lift = 0;
    if (!(pose.feather > 0)) pose.featherY = 0;
    return pose;
  }

  coachId = COACHES.has(coachId) ? coachId : 'meowl';
  const alternate = Number.isFinite(variation) && Math.abs(Math.trunc(variation)) % 2 === 1;
  const direction = alternate ? -1 : 1, t = progress;
  const curve = (points, initial = 0, final = 0) => track(t, points, initial, final);
  const spokenMouth = pose.mouth || 0, naturalBlink = pose.blink || 0;
  for (const key of Object.keys(LIMITS)) pose[key] = 0;

  if (kind === 'talk') {
    pose.mouth = spokenMouth;
    pose.blink = naturalBlink;
    if (coachId === 'evil') {
      pose.lookX = curve([[.1,0],[.29,-.32],[.61,-.1],[.88,0]]);
      pose.headTilt = curve([[.16,0],[.4,.035],[.84,0]]);
      pose.leftWing = curve([[.3,0],[.54,.13],[.89,0]]);
      pose.leftElbow = curve([[.32,0],[.58,.4],[.91,0]]);
    } else if (coachId === 'meowl') {
      pose.leftWing = curve([[.1, 0], [.29, .13], [.48, .06], [.7, 0]]);
      pose.leftElbow = curve([[.16, 0], [.36, .19], [.64, 0]]);
      pose.headTilt = direction * curve([[.15, -.015], [.37, .025], [.67, -.01], [.9, 0]]);
      pose.leftEar = curve([[.64, 0], [.73, .085], [.81, -.025], [.91, 0]]);
    } else if (coachId === 'owl') {
      pose.rightWing = curve([[.12, 0], [.3, .2], [.54, .12], [.78, 0]]);
      pose.rightElbow = curve([[.14, 0], [.35, .35], [.56, .18], [.81, 0]]);
      pose.headNod = curve([[.2, 0], [.35, 3], [.51, 0], [.68, 2], [.85, 0]]);
      pose.lookX = direction * curve([[.17, -.2], [.42, -.25], [.7, 0]]);
    } else if (coachId === 'paws') {
      pose.leftWing = curve([[.12, 0], [.29, .24], [.48, .08], [.7, 0]]);
      pose.leftElbow = curve([[.15, 0], [.32, -.16], [.58, 0]]);
      pose.headNod = curve([[.16, -2], [.33, -3], [.55, 2], [.8, 0]]);
      pose.headTilt = direction * curve([[.23, .018], [.47, -.02], [.79, 0]]);
    } else if (coachId === 'mellow') {
      pose.rightWing = curve([[.15, 0], [.42, .09], [.68, .04], [.9, 0]]);
      pose.rightElbow = curve([[.2, 0], [.47, .12], [.8, 0]]);
      pose.headTilt = direction * curve([[.2, .012], [.48, .026], [.72, .013], [.94, 0]]);
      pose.rightEar = curve([[.68, 0], [.8, -.055], [.92, 0]]);
    } else {
      pose.lookX = direction * curve([[.1, -.25], [.3, -.35], [.48, .3], [.68, .16], [.9, 0]]);
      pose.headTilt = pose.lookX * .06;
      pose.rightWing = curve([[.36, 0], [.54, .15], [.75, 0]]);
      pose.rightElbow = curve([[.4, 0], [.59, .22], [.81, 0]]);
      pose.leftEar = curve([[.1, 0], [.22, .09], [.36, 0]]);
    }
  } else if (coachId === 'evil') {
    pose.lookX = curve([[.08,0],[.23,-.6],[.41,.35],[.7,.15],[.92,0]]);
    pose.headTilt = curve([[.14,0],[.3,-.04],[.54,.04],[.92,0]]);
    pose.leftWing = curve([[.22,0],[.4,.1],[.72,.1],[.94,0]]);
    pose.rightWing = curve([[.28,0],[.44,.12],[.73,.12],[.95,0]]);
    pose.leftElbow = curve([[.22,0],[.42,1.35],[.53,1.5],[.65,1.25],[.94,0]]);
    pose.rightElbow = curve([[.28,0],[.45,1.48],[.56,1.25],[.68,1.5],[.95,0]]);
    pose.headNod = curve([[.5,0],[.73,3],[.94,0]]);
  } else if (coachId === 'meowl') {
    // Watch a drifting feather, bat it across with one wing, then send it back
    // with the other. Joint strokes and feather deflections share contact times.
    pose.feather = curve([[.035, 0], [.095, 1], [.83, 1], [.925, .5], [.985, 0]]);
    if (pose.feather > 0) {
      pose.featherX = direction * curve([[.12, 250], [.225, 280], [.255, 280], [.3, 160], [.38, -70], [.47, -245], [.515, -280], [.57, -150], [.65, 50], [.75, 130], [.86, 80], [.95, 45]], 210, 20);
      pose.featherY = curve([[.12, 710], [.2, 675], [.255, 650], [.34, 570], [.43, 610], [.515, 650], [.6, 525], [.72, 610], [.84, 740], [.93, 815]], 740, 840);
      pose.featherAngle = direction * curve([[.035, 0], [.11, .25], [.2, -.18], [.255, .15], [.33, .8], [.43, -.5], [.515, -.25], [.61, -.85], [.73, .4], [.87, -.3], [.98, 0]]);
    }
    pose.rightWing = curve([[.095, 0], [.17, .16], [.22, .55], [.255, 1.15], [.285, .83], [.34, .28], [.41, .04], [.47, 0]]);
    pose.rightElbow = curve([[.1, 0], [.17, .35], [.255, .3], [.31, -.25], [.4, .1], [.48, 0]]);
    pose.leftWing = curve([[.36, .1], [.44, .38], [.49, .8], [.515, 1.2], [.55, .7], [.615, .2], [.67, 0]]);
    pose.leftElbow = curve([[.35, 0], [.44, .36], [.515, .3], [.565, -.22], [.64, .08], [.7, 0]]);
    pose.lookX = direction * curve([[.07, .35], [.16, .85], [.255, .95], [.37, -.2], [.47, -.8], [.515, -.95], [.64, .15], [.77, .4], [.91, 0]]);
    pose.headTilt = direction * curve([[.12, .035], [.24, .065], [.37, -.015], [.51, -.065], [.65, .015], [.8, .025], [.95, 0]]);
    pose.headNod = curve([[.11, -2], [.25, -4], [.39, -2], [.51, -4], [.64, -3], [.79, 2], [.94, 0]]);
    pose.leftStep = curve([[.61, 0], [.68, 22], [.735, 0]]);
    pose.rightStep = curve([[.735, 0], [.8, 24], [.87, 0]]);
    pose.leftFoot = curve([[.61, 0], [.675, -.22], [.72, .09], [.77, 0]]);
    pose.rightFoot = curve([[.735, 0], [.8, .22], [.85, -.08], [.9, 0]]);
    pose.bodyX = direction * curve([[.61, 0], [.67, 6], [.735, -1], [.8, -6], [.89, 0]]);
    pose.leftEar = curve([[.83, 0], [.88, .17], [.92, -.075], [.975, 0]]);
    pose.rightEar = curve([[.865, 0], [.92, -.12], [.95, .04], [.99, 0]]);
    pose.mouth = curve([[.19, 0], [.26, .3], [.33, 0], [.47, 0], [.525, .24], [.59, 0]]);
    pose.blink = curve([[.79, 0], [.835, 1], [.88, 0]]);
  } else if (coachId === 'owl') {
    // Open the book, indicate a line, turn one page, then close it. The turn
    // resets only after the book is invisible, so it cannot play backwards.
    pose.book = curve([[.04, 0], [.14, .5], [.23, 1], [.38, .98], [.57, .98], [.76, .8], [.86, .35], [.91, 0]]);
    pose.pageTurn = curve([[.39, 0], [.46, .15], [.53, .65], [.62, 1], [.93, 1], [.985, 0]]);
    pose.leftWing = curve([[.1, 0], [.25, .11], [.51, .09], [.75, .05], [.89, 0]]);
    pose.leftElbow = curve([[.1, 0], [.24, 1.85], [.57, 1.85], [.76, 1.25], [.9, 0]]);
    pose.rightWing = curve([[.14, 0], [.28, .35], [.39, .12], [.52, .26], [.64, .08], [.8, 0]]);
    pose.rightElbow = curve([[.14, 0], [.28, 1.7], [.39, 1.5], [.53, 2.05], [.64, 1.7], [.82, 0]]);
    pose.headNod = curve([[.15, 3], [.29, 6], [.39, -2], [.55, 5], [.7, -1], [.86, 0]]);
    pose.headTilt = direction * curve([[.18, -.015], [.3, -.035], [.42, .015], [.58, -.025], [.8, 0]]);
    pose.lookX = direction * curve([[.18, -.2], [.3, -.3], [.43, .15], [.56, -.2], [.74, 0]]);
    pose.leftEar = curve([[.11, 0], [.2, .07], [.3, 0]]);
    pose.blink = curve([[.67, 0], [.72, 1], [.78, 0]]);
    pose.mouth = curve([[.26, 0], [.35, .3], [.42, 0], [.66, 0], [.74, .22], [.82, 0]]);
  } else if (coachId === 'paws') {
    // One planted step, a left-wing presentation, then a right-wing flourish.
    pose.leftStep = curve([[.04, 0], [.16, 25], [.255, 0]]);
    pose.leftFoot = curve([[.055, 0], [.16, -.24], [.25, .08], [.31, 0]]);
    pose.bodyX = direction * curve([[.06, 0], [.2, 11], [.31, 7], [.47, 3], [.72, 0]]);
    pose.tilt = direction * curve([[.08, -.008], [.2, -.014], [.32, 0], [.51, .012], [.75, 0]]);
    pose.leftWing = curve([[.21, 0], [.32, .7], [.4, 1.16], [.49, .38], [.6, 0]]);
    pose.leftElbow = curve([[.22, 0], [.34, -.3], [.41, .18], [.52, .28], [.62, 0]]);
    pose.rightWing = curve([[.44, 0], [.55, .7], [.625, 1.24], [.71, .95], [.82, .2], [.93, 0]]);
    pose.rightElbow = curve([[.45, 0], [.57, .55], [.66, -.5], [.75, .1], [.9, 0]]);
    pose.headNod = curve([[.1, -2], [.21, -4], [.38, -1], [.6, -3], [.79, 1], [.94, 0]]);
    pose.headTilt = direction * curve([[.27, -.02], [.39, -.045], [.56, .025], [.67, .045], [.88, 0]]);
    pose.lookX = direction * curve([[.25, -.3], [.4, -.5], [.56, .25], [.65, .5], [.84, 0]]);
    pose.rightEar = curve([[.8, 0], [.88, -.12], [.94, .035], [.99, 0]]);
    pose.mouth = curve([[.25, 0], [.35, .4], [.45, 0], [.57, 0], [.67, .3], [.8, 0]]);
    pose.blink = curve([[.85, 0], [.895, 1], [.945, 0]]);
  } else if (coachId === 'mellow') {
    // Only joints move: spread one wing, spread the other, yawn, lower them.
    pose.leftWing = curve([[.08, 0], [.25, .45], [.37, 1.05], [.5, .92], [.65, .4], [.82, 0]]);
    pose.rightWing = curve([[.17, 0], [.34, .48], [.465, 1.23], [.57, .9], [.73, .25], [.87, 0]]);
    pose.leftElbow = curve([[.13, 0], [.3, .16], [.39, -.1], [.53, .1], [.74, 0]]);
    pose.rightElbow = curve([[.22, 0], [.4, .12], [.49, -.12], [.65, .15], [.82, 0]]);
    pose.headTilt = direction * curve([[.12, -.02], [.29, -.055], [.43, .025], [.57, .045], [.75, .015], [.94, 0]]);
    pose.headNod = curve([[.16, 2], [.3, -2], [.45, -6], [.57, -3], [.75, 2], [.93, 0]]);
    pose.mouth = curve([[.22, 0], [.35, .5], [.46, .95], [.54, .6], [.64, .1], [.7, 0]]);
    pose.blink = curve([[.24, 0], [.39, .75], [.49, .95], [.61, .4], [.72, 0]]);
    pose.leftEar = curve([[.68, 0], [.77, -.17], [.84, .085], [.95, 0]]);
    pose.rightEar = curve([[.75, 0], [.83, .13], [.9, -.045], [.98, 0]]);
  } else {
    // Ears lead the search. Two small, alternating steps follow the glance;
    // the final wing points toward the discovered detail.
    pose.leftEar = curve([[.03, 0], [.1, .16], [.18, .07], [.34, 0], [.77, 0], [.85, .1], [.94, 0]]);
    pose.rightEar = curve([[.055, 0], [.145, -.15], [.22, -.06], [.38, 0]]);
    pose.lookX = direction * curve([[.07, -.3], [.19, -.95], [.29, -.8], [.42, .95], [.57, .8], [.72, .35], [.91, 0]]);
    pose.headTilt = direction * curve([[.12, -.035], [.24, -.08], [.38, .06], [.51, .075], [.72, .025], [.94, 0]]);
    pose.headNod = curve([[.13, -2], [.25, -4], [.39, -3], [.55, -4], [.72, 3], [.86, 0]]);
    pose.leftStep = curve([[.16, 0], [.255, 24], [.34, 0]]);
    pose.leftFoot = curve([[.16, 0], [.25, -.22], [.325, .08], [.38, 0]]);
    pose.rightStep = curve([[.405, 0], [.515, 26], [.615, 0]]);
    pose.rightFoot = curve([[.41, 0], [.51, .24], [.6, -.08], [.66, 0]]);
    pose.bodyX = direction * curve([[.12, 0], [.26, -9], [.36, -4], [.52, 10], [.66, 5], [.83, 0]]);
    pose.rightWing = curve([[.55, 0], [.65, .6], [.72, .85], [.81, .3], [.93, 0]]);
    pose.rightElbow = curve([[.56, 0], [.66, .45], [.75, .65], [.87, 0]]);
    pose.mouth = curve([[.65, 0], [.73, .35], [.81, .08], [.89, 0]]);
    pose.blink = curve([[.79, 0], [.84, 1], [.9, 0]]);
  }

  if (alternate) for (const [left, right] of [['leftWing', 'rightWing'], ['leftElbow', 'rightElbow'], ['leftFoot', 'rightFoot'], ['leftStep', 'rightStep'], ['leftEar', 'rightEar']]) {
    [pose[left], pose[right]] = [pose[right], pose[left]];
  }
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    if (key !== 'featherY' || pose.feather > 0) pose[key] = clamp(pose[key], low, high);
  }
  return pose;
}
