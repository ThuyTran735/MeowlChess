import { COACH_IDLE_LABELS, applyCoachIdleRepertoire } from './coach-idle-repertoire.js';

const LIMITS = Object.freeze({
  mouth: [0,1], blink: [0,1], lookX: [-1,1], leftWing: [0,1.35], rightWing: [0,1.35],
  leftElbow: [-2.2,2.2], rightElbow: [-2.2,2.2], leftFoot: [-.3,.3], rightFoot: [-.3,.3],
  leftStep: [0,28], rightStep: [0,28], leftEar: [-.18,.18], rightEar: [-.18,.18],
  headTilt: [-.1,.1], headNod: [-8,8], bodyX: [-18,18], lift: [-12,6], tilt: [-.025,.025],
  book: [0,1], pageTurn: [0,1], glasses: [0,1], feather: [0,1], featherX: [-280,280],
  featherY: [500,900], featherAngle: [-1,1], mug: [0,1], mugLift: [0,90], steam: [0,1],
  steamPhase: [0,1], magnifier: [0,1], glassAngle: [-.4,.4], pennant: [0,1], flagFlutter: [-.4,.4],
});
const REMOVED = ['winkLeft','winkRight','blep','eyeSmile','squash','bodyBend','leftFlop','rightFlop','breathe','leftReach','rightReach','hug','wing'];
const COACHES = ['meowl','owl','paws','mellow','scout','evil'];
const clamp = (value,low,high) => Math.max(low,Math.min(high,value));

function track(time, points, initial = 0, final = 0) {
  const frames = [[0,initial],...points,[1,final]];
  if (time <= 0) return initial;
  if (time >= 1) return final;
  let index = 1;
  while (time > frames[index][0]) index++;
  const tangent = at => {
    if (!at || at === frames.length-1) return 0;
    const a = frames[at][0]-frames[at-1][0], b = frames[at+1][0]-frames[at][0];
    const left = (frames[at][1]-frames[at-1][1])/a, right = (frames[at+1][1]-frames[at][1])/b;
    if (left*right <= 0) return 0;
    return 3*(a+b)/((2*b+a)/left+(b+2*a)/right);
  };
  const [start,from] = frames[index-1], [end,to] = frames[index], span = end-start, p = (time-start)/span;
  return (2*p**3-3*p**2+1)*from + (p**3-2*p**2+p)*span*tangent(index-1)
    + (-2*p**3+3*p**2)*to + (p**3-p**2)*span*tangent(index);
}

// Shared joints keep the artwork intact; the programs below give those joints
// different jobs, sequences, and props instead of mirroring one generic wave.
function director(pose,time) {
  const set = (key,points,initial=0,final=0) => (pose[key]=track(time,points,initial,final));
  const pulse = (key,value,start=.12,peak=.43,end=.88) => set(key,[[start,0],[peak,value],[end,0]]);
  const hold = (key,value,start=.08,arrive=.3,release=.63,end=.9) => set(key,[[start,0],[arrive,value],[release,value],[end,0]]);
  const wing = (side,angle,elbow,start=.1,peak=.4,end=.86) => {
    pulse(`${side}Wing`,angle,start,peak,end);
    pulse(`${side}Elbow`,elbow,start+.015,Math.min(end-.04,peak+.025),end+.025);
  };
  const step = (side,start,peak,end,height=20) => {
    pulse(`${side}Step`,height,start,peak,end);
    set(`${side}Foot`,[[start,0],[peak,side==='left'?-.2:.2],[end-.01,side==='left'?.055:-.055],[Math.min(.98,end+.05),0]]);
  };
  const ear = (side,value=.13,start=.13,peak=.33,end=.61) => set(`${side}Ear`,[[start,0],[peak,value],[peak+(end-peak)*.45,-value*.3],[end,0]]);
  const look = (value,start=.1,peak=.35,end=.83) => {
    pulse('lookX',value,start,peak,end);
    pulse('headTilt',value*.065,start+.025,peak+.035,Math.min(.98,end+.06));
  };
  const nod = (value=4,start=.18,peak=.42,end=.78) => pulse('headNod',value,start,peak,end);
  const blink = (start=.62,peak=.68,end=.76) => pulse('blink',1,start,peak,end);
  const book = (turn=false,amount=1) => {
    hold('book',amount,.055,.23,.68,.89);
    hold('leftWing',.1,.04,.2,.69,.9); hold('leftElbow',1.85,.04,.2,.69,.9);
    hold('rightWing',.12,.06,.22,.67,.9); hold('rightElbow',1.75,.06,.22,.67,.9);
    if (turn) {
      set('pageTurn',[[.34,0],[.47,.35],[.62,1],[.92,1],[.985,0]]);
      set('rightElbow',[[.06,0],[.23,1.75],[.47,2.05],[.63,1.78],[.89,0]]);
    }
  };
  const cup = (height=35,amount=1) => {
    hold('mug',amount,.13,.28,.67,.88);
    pulse('mugLift',height,.25,.49,.76);
    hold('leftWing',.08,.035,.2,.71,.91); hold('rightWing',.1,.045,.22,.71,.91);
    hold('leftElbow',1.85,.035,.2,.71,.91); hold('rightElbow',1.85,.045,.22,.71,.91);
    pose.leftElbow+=pose.mugLift*.003; pose.rightElbow+=pose.mugLift*.003;
    hold('steam',.7*amount,.2,.32,.65,.84);
    set('steamPhase',[[.2,0],[.84,1],[.9,1],[.98,0]]);
  };
  const lens = (angle=.5,elbow=-.8,amount=1) => {
    hold('rightWing',angle,.035,.23,.66,.91);
    hold('rightElbow',elbow,.04,.24,.67,.92);
    hold('magnifier',amount,.17,.3,.65,.85);
    set('glassAngle',[[.16,0],[.34,-.16],[.57,.18],[.82,0]]);
  };
  const flag = (angle=.66,elbow=-.25) => {
    hold('leftWing',angle,.025,.24,.66,.91);
    hold('leftElbow',elbow,.04,.26,.68,.93);
    hold('pennant',1,.16,.3,.66,.85);
    set('flagFlutter',[[.16,0],[.31,.25],[.44,-.22],[.58,.3],[.73,-.14],[.85,0]]);
  };
  return {pose,time,set,pulse,hold,wing,step,ear,look,nod,blink,book,cup,lens,flag};
}

const ROUTINES = {
  evil: {
    scheme(c) {
      // Check whether anyone is watching, then plot with two folded-wing strokes.
      c.set('lookX',[[.06,0],[.17,-.75],[.28,-.6],[.39,.5],[.52,.2],[.84,0]]);
      c.set('headTilt',[[.1,0],[.23,-.055],[.4,.04],[.6,.025],[.9,0]]);
      c.hold('leftWing',.1,.24,.38,.73,.93); c.hold('rightWing',.12,.29,.42,.74,.94);
      c.set('leftElbow',[[.24,0],[.39,1.35],[.49,1.56],[.59,1.3],[.7,1.53],[.93,0]]);
      c.set('rightElbow',[[.29,0],[.43,1.5],[.53,1.25],[.64,1.53],[.76,1.3],[.94,0]]);
      c.nod(3,.53,.72,.92); c.ear('right',-.11,.76,.86,.98);
    },
    tiptoe(c) {
      c.look(-.65,.04,.21,.5); c.ear('left',.15,.05,.16,.35);
      c.step('left',.26,.38,.51,12); c.step('right',.53,.65,.78,10);
      c.set('bodyX',[[.24,0],[.39,-6],[.52,-2],[.66,5],[.86,0]]);
      c.hold('leftElbow',.95,.22,.37,.71,.9); c.hold('rightElbow',1.05,.25,.4,.73,.92);
      c.set('lookX',[[.08,-.3],[.22,-.65],[.46,-.4],[.67,.6],[.9,0]]);
      c.nod(-2,.55,.71,.9);
    },
    flourish(c) {
      c.hold('leftElbow',1.2,.08,.25,.43,.7);
      c.set('rightWing',[[.08,0],[.25,.16],[.43,.79],[.55,.64],[.76,.18],[.91,0]]);
      c.set('rightElbow',[[.09,0],[.25,1.15],[.43,.18],[.57,-.15],[.8,0]]);
      c.look(.58,.27,.47,.77); c.nod(-4,.18,.4,.64); c.blink(.73,.79,.87);
    },
    reveal(c) {
      c.look(-.55,.07,.24,.49); c.wing('left',.19,1.3,.1,.31,.58);
      c.wing('right',.73,.25,.43,.64,.9); c.nod(4,.61,.76,.94); c.ear('left',.12,.73,.83,.98);
    },
    bow(c) {
      c.wing('right',.23,1.45,.07,.29,.65); c.nod(6,.28,.51,.82);
      c.pulse('headTilt',-.045,.3,.52,.88); c.wing('left',.42,.35,.48,.69,.91);
    },
    calculate(c) {
      c.hold('rightElbow',1.42,.1,.31,.63,.9); c.pulse('rightWing',.13,.1,.39,.9);
      c.set('lookX',[[.08,-.15],[.25,-.55],[.43,-.25],[.61,.45],[.85,0]]);
      c.pulse('headTilt',.065,.2,.46,.87); c.nod(-3,.15,.37,.66); c.ear('left',.1,.67,.79,.96);
    },
    peek(c) {
      c.set('lookX',[[.06,-.15],[.21,-.8],[.35,-.8],[.52,.55],[.71,.32],[.91,0]]);
      c.set('headTilt',[[.12,0],[.28,-.07],[.41,-.03],[.59,.05],[.9,0]]);
      c.set('bodyX',[[.12,0],[.3,-7],[.48,-2],[.65,4],[.88,0]]);
      c.ear('right',-.14,.44,.6,.84); c.wing('left',.18,.6,.66,.79,.96);
    },
    rub(c) {
      c.hold('leftWing',.1,.07,.25,.7,.93); c.hold('rightWing',.12,.1,.28,.72,.95);
      c.set('leftElbow',[[.07,0],[.27,1.25],[.4,1.55],[.52,1.28],[.65,1.5],[.93,0]]);
      c.set('rightElbow',[[.1,0],[.29,1.5],[.42,1.25],[.54,1.52],[.68,1.28],[.95,0]]);
      c.pulse('headTilt',.055,.12,.43,.86); c.look(-.3,.15,.34,.7); c.nod(3,.64,.79,.95);
    },
    point(c) {
      c.wing('left',.2,1.2,.09,.31,.62); c.wing('right',.56,.4,.34,.56,.87);
      c.look(.5,.28,.52,.85); c.nod(3,.54,.71,.93);
    },
    listen(c) {
      c.ear('left',.14,.06,.22,.45); c.pulse('headTilt',-.06,.16,.4,.89);
      c.look(-.35,.1,.3,.68); c.wing('right',.13,.55,.44,.66,.93); c.blink(.69,.76,.85);
    },
    reassure(c) {
      c.hold('leftElbow',1.15,.1,.33,.58,.89); c.pulse('leftWing',.1,.1,.42,.89);
      c.wing('right',.32,.55,.27,.52,.88); c.pulse('headTilt',.035,.19,.42,.82);
      c.nod(4,.42,.65,.92);
    },
    nod(c) {
      c.set('headNod',[[.08,0],[.23,-2],[.39,0],[.58,4],[.86,0]]);
      c.wing('left',.2,.75,.34,.59,.9); c.ear('right',-.08,.69,.81,.96);
    },
  },
  meowl: {
    dance(c) {
      c.step('left',.08,.22,.34,25); c.step('right',.39,.53,.65,25);
      c.set('bodyX',[[.08,0],[.22,9],[.35,0],[.53,-9],[.68,0]]);
      c.wing('right',.37,.2,.1,.29,.5); c.wing('left',.44,.16,.42,.6,.84); c.ear('left',.15,.75,.84,.97);
    },
    listen(c) {
      c.ear('left',.17,.06,.2,.4); c.ear('right',-.16,.36,.51,.72);
      c.set('lookX',[[.08,-.3],[.23,-.8],[.4,0],[.55,.7],[.76,0]]);
      c.set('headTilt',[[.1,-.025],[.26,-.075],[.42,0],[.58,.065],[.88,0]]); c.nod(2,.67,.79,.94);
    },
    featherTap(c) {
      c.hold('feather',1,.04,.13,.68,.9);
      c.set('featherX',[[.12,-245],[.34,-280],[.4,-280],[.55,-70],[.7,130],[.87,160]],-220,180);
      c.set('featherY',[[.18,690],[.4,650],[.54,540],[.73,650],[.9,790]],730,830);
      c.set('featherAngle',[[.07,0],[.27,-.3],[.4,.15],[.55,-.8],[.73,.35],[.91,0]]);
      c.set('leftWing',[[.12,0],[.29,.32],[.4,1.2],[.47,.8],[.62,.15],[.74,0]]);
      c.set('leftElbow',[[.13,0],[.32,.4],[.4,.3],[.51,-.22],[.69,0]]);
      c.set('lookX',[[.12,-.6],[.39,-.95],[.56,-.1],[.72,.6],[.91,0]]); c.ear('right',-.13,.74,.84,.97);
    },
    highFive(c) { c.wing('right',1.14,-.3,.09,.4,.81); c.nod(-3,.15,.36,.66); c.ear('left',.12,.63,.76,.94); },
    shuffle(c) {
      c.step('right',.06,.2,.34,18); c.step('left',.38,.55,.69,14);
      c.wing('left',.23,.3,.09,.32,.56); c.nod(4,.56,.73,.92); c.blink(.76,.81,.88);
    },
    pointPair(c) { c.wing('left',.66,.35,.06,.29,.48); c.wing('right',.88,.18,.42,.64,.9); c.set('lookX',[[.12,-.45],[.3,-.65],[.48,.1],[.64,.65],[.9,0]]); },
    bow(c) { c.nod(7,.11,.42,.78); c.wing('left',.1,1.35,.14,.44,.81); c.wing('right',.09,1.25,.17,.48,.84); c.blink(.49,.56,.64); },
    reassure(c) { c.hold('leftElbow',1.35,.1,.32,.55,.87); c.pulse('leftWing',.09,.09,.4,.87); c.nod(4,.3,.54,.84); c.look(-.22,.08,.26,.59); },
    inspect(c) { c.look(-.8,.07,.27,.53); c.set('headNod',[[.16,-2],[.35,-5],[.57,1],[.8,0]]); c.wing('left',.32,.55,.34,.55,.83); c.ear('right',-.15,.58,.73,.94); },
    invite(c) { c.wing('left',.37,.8,.14,.43,.87); c.wing('right',.3,.7,.24,.56,.91); c.nod(3,.52,.68,.9); },
    nod(c) { c.set('headNod',[[.1,0],[.29,4],[.43,0],[.61,3],[.83,0]]); c.wing('right',.2,.35,.45,.66,.91); c.ear('left',.08,.72,.83,.97); },
  },
  owl: {
    glasses(c) { c.pulse('glasses',.85,.14,.39,.72); c.nod(3,.24,.48,.79); c.wing('right',.17,.34,.15,.37,.69); c.blink(.7,.75,.82); },
    compare(c) { c.book(); c.set('lookX',[[.17,-.3],[.3,-.5],[.46,.25],[.59,.4],[.79,0]]); c.set('rightElbow',[[.06,0],[.25,1.7],[.37,2],[.48,1.5],[.62,2.05],[.88,0]]); c.nod(5,.18,.43,.78); },
    lesson(c) { c.book(false,.88); c.nod(-2,.31,.5,.79); c.set('rightWing',[[.06,0],[.23,.12],[.45,.34],[.65,.12],[.9,0]]); c.pulse('mouth',.3,.35,.48,.64); },
    page(c) { c.book(true); c.nod(6,.16,.36,.73); c.set('lookX',[[.2,-.2],[.41,-.3],[.58,.16],[.76,0]]); c.ear('left',.09,.68,.79,.95); },
    point(c) { c.wing('right',.58,.38,.11,.42,.84); c.nod(3,.29,.52,.79); c.look(.4,.13,.36,.71); },
    underline(c) { c.book(); c.set('rightElbow',[[.07,0],[.24,1.8],[.35,2.1],[.43,1.75],[.54,2.1],[.65,1.8],[.89,0]]); c.nod(5,.22,.49,.78); c.blink(.75,.8,.87); },
    close(c) { c.hold('book',1,.05,.2,.39,.6); c.hold('leftElbow',1.85,.03,.18,.41,.65); c.hold('rightElbow',1.75,.05,.2,.43,.67); c.nod(5,.58,.74,.93); c.pulse('glasses',.3,.64,.76,.91); },
    read(c) { c.book(false,.85); c.nod(6,.14,.43,.79); c.set('lookX',[[.19,-.32],[.38,-.1],[.58,.28],[.8,0]]); c.blink(.62,.68,.75); },
    patient(c) { c.book(false,.7); c.nod(3,.33,.57,.85); c.set('rightElbow',[[.07,0],[.27,1.75],[.45,1.95],[.64,1.75],[.89,0]]); c.pulse('headTilt',-.025,.16,.39,.74); },
    listen(c) { c.pulse('headTilt',-.045,.1,.4,.88); c.pulse('glasses',.35,.38,.57,.8); c.blink(.57,.63,.71); c.ear('left',.065,.7,.81,.95); },
  },
  paws: {
    pennant(c) { c.flag(); c.wing('right',.68,-.16,.22,.5,.82); c.step('right',.61,.74,.88,18); c.nod(-3,.16,.36,.68); },
    march(c) { c.step('left',.08,.23,.36,26); c.step('right',.43,.58,.71,26); c.wing('right',.28,.15,.11,.27,.47); c.wing('left',.3,.18,.45,.62,.85); c.nod(-3,.17,.44,.82); },
    salute(c) { c.wing('right',1.17,-.62,.09,.39,.82); c.nod(-4,.1,.32,.65); c.pulse('tilt',.012,.2,.41,.75); },
    welcome(c) { c.wing('left',.63,.22,.08,.31,.56); c.wing('right',.78,.3,.37,.59,.88); c.nod(3,.63,.77,.94); },
    flagWave(c) { c.flag(); c.set('leftWing',[[.025,0],[.24,.64],[.39,.94],[.53,.52],[.67,.85],[.91,0]]); c.set('flagFlutter',[[.16,0],[.29,.34],[.4,-.32],[.53,.35],[.66,-.3],[.84,0]]); c.ear('right',-.11,.72,.82,.97); },
    flagPresent(c) { c.flag(.28,1.55); c.wing('right',.48,.34,.24,.51,.84); c.nod(4,.47,.65,.89); },
    cheer(c) { c.wing('left',1.02,-.2,.1,.35,.66); c.wing('right',1.18,.2,.28,.56,.88); c.step('left',.66,.79,.92,17); },
    steady(c) { c.wing('right',.38,.55,.14,.44,.86); c.nod(4,.42,.62,.9); c.pulse('headTilt',.025,.14,.36,.7); },
    atEase(c) { c.hold('leftElbow',1.35,.12,.36,.57,.9); c.hold('rightElbow',1.3,.15,.39,.59,.92); c.nod(3,.41,.62,.88); c.blink(.67,.72,.79); },
    lookout(c) { c.set('lookX',[[.09,-.35],[.25,-.7],[.44,0],[.62,.65],[.86,0]]); c.set('headTilt',[[.14,-.025],[.29,-.05],[.47,.01],[.66,.045],[.92,0]]); c.ear('right',-.12,.6,.75,.94); },
    listen(c) { c.look(-.45,.13,.36,.82); c.nod(2,.53,.69,.9); c.ear('left',.12,.22,.41,.69); },
  },
  mellow: {
    cupWarm(c) { c.cup(32); c.nod(5,.24,.49,.8); c.blink(.53,.63,.77); c.pulse('headTilt',.025,.28,.52,.85); },
    teaPause(c) { c.cup(62); c.set('headNod',[[.18,2],[.4,5],[.58,2],[.79,0]]); c.blink(.34,.47,.64); c.ear('left',.08,.72,.82,.96); },
    cupOffer(c) { c.cup(15); c.nod(-2,.31,.5,.8); c.pulse('headTilt',-.03,.19,.45,.83); c.ear('right',-.08,.68,.8,.96); },
    welcome(c) { c.wing('right',.37,.55,.15,.46,.89); c.pulse('headTilt',.045,.15,.43,.9); c.ear('left',.1,.57,.74,.95); },
    nod(c) { c.set('headNod',[[.13,0],[.35,3],[.5,0],[.68,2],[.91,0]]); c.wing('left',.15,.5,.37,.62,.92); c.blink(.67,.75,.85); },
    yawn(c) { c.wing('left',.66,-.1,.13,.43,.82); c.wing('right',.8,-.12,.24,.55,.91); c.pulse('mouth',.9,.24,.48,.71); c.pulse('blink',.94,.28,.5,.76); c.nod(-5,.27,.48,.75); },
    spread(c) { c.wing('left',.88,.05,.08,.34,.71); c.wing('right',1.02,.1,.23,.5,.88); c.pulse('headTilt',-.04,.16,.4,.84); c.ear('right',-.12,.74,.84,.98); },
    point(c) { c.wing('left',.34,.52,.18,.48,.88); c.look(-.3,.19,.43,.81); c.nod(2,.57,.72,.93); },
    ears(c) { c.ear('left',-.13,.12,.32,.61); c.ear('right',.12,.48,.68,.92); c.pulse('headTilt',.04,.18,.47,.86); c.blink(.59,.68,.8); },
    listen(c) { c.pulse('headTilt',-.055,.13,.44,.9); c.nod(2,.5,.69,.92); c.wing('right',.13,.35,.41,.66,.94); },
    comfort(c) { c.cup(8,.85); c.nod(3,.36,.59,.87); c.pulse('headTilt',.035,.26,.52,.87); c.blink(.61,.69,.81); },
    scarf(c) { c.set('leftWing',[[.08,0],[.29,.14],[.5,.1],[.78,0]]); c.set('leftElbow',[[.08,0],[.31,2.1],[.43,1.65],[.57,1.85],[.8,0]]); c.set('rightWing',[[.25,0],[.48,.16],[.67,.1],[.9,0]]); c.set('rightElbow',[[.25,0],[.5,2.05],[.65,1.65],[.9,0]]); c.nod(4,.18,.43,.79); c.ear('left',-.09,.73,.85,.97); },
  },
  scout: {
    lens(c) { c.lens(); c.look(.7,.15,.43,.84); c.nod(3,.27,.5,.8); c.ear('left',.13,.62,.77,.95); },
    compare(c) { c.lens(); c.set('rightWing',[[.035,0],[.23,.4],[.42,.66],[.61,.45],[.91,0]]); c.set('glassAngle',[[.17,0],[.33,-.27],[.55,.28],[.82,0]]); c.set('lookX',[[.16,.4],[.36,.8],[.58,.55],[.84,0]]); c.nod(2,.31,.54,.81); },
    trail(c) { c.ear('left',.16,.05,.2,.42); c.look(-.7,.06,.26,.53); c.step('left',.25,.4,.55,23); c.wing('right',.65,.4,.52,.7,.93); },
    found(c) { c.lens(.66,-.8); c.wing('left',.54,1.15,.33,.57,.84); c.nod(4,.56,.72,.93); c.look(.75,.16,.46,.83); },
    note(c) { c.lens(.37,-.55); c.nod(5,.23,.44,.72); c.set('lookX',[[.19,.4],[.4,.6],[.6,.1],[.78,0]]); c.ear('right',-.13,.69,.81,.97); },
    scan(c) { c.ear('left',.17,.05,.18,.4); c.ear('right',-.16,.32,.48,.72); c.set('lookX',[[.09,-.4],[.24,-.85],[.44,.1],[.63,.8],[.88,0]]); c.set('headTilt',[[.14,-.03],[.29,-.07],[.48,.015],[.67,.065],[.94,0]]); },
    point(c) { c.wing('right',.78,.45,.15,.48,.87); c.look(.6,.12,.36,.79); c.step('left',.62,.76,.9,16); },
    follow(c) { c.lens(.48,-.7); c.step('left',.16,.3,.42,20); c.step('right',.49,.62,.75,20); c.look(.65,.17,.46,.85); c.ear('left',.1,.74,.85,.98); },
    recheck(c) { c.lens(.26,-.35,.85); c.nod(4,.27,.5,.82); c.pulse('headTilt',.025,.18,.41,.77); c.look(.35,.18,.4,.79); },
    listen(c) { c.ear('left',.12,.09,.27,.54); c.pulse('headTilt',-.05,.18,.44,.89); c.wing('right',.19,.3,.5,.7,.93); },
    settle(c) { c.wing('left',.3,.7,.2,.47,.85); c.nod(4,.44,.63,.9); c.ear('right',-.08,.66,.8,.97); c.blink(.61,.68,.76); },
  },
};

const LABELS = {
  evil: { scheme:'A little master plan',tiptoe:'Sneak, peek, retreat',flourish:'The grand reveal',reveal:'A devious discovery',bow:'A theatrical little bow',calculate:'Calculate the next move',peek:'Who is watching?',rub:'Plot with folded wings',point:'Here is the clever part',listen:'Listen for an opening',reassure:'A better plan awaits',nod:'Consider it approved' },
  meowl: { approved:'Feather chase',dance:'Little step dance',listen:'What was that?',featherTap:'One more feather',highFive:'Wing high-five',shuffle:'Paw shuffle',pointPair:'This way, then that',bow:'A little bow',reassure:'We can try again',inspect:'Curious close look',invite:'Come along',nod:'One step at a time' },
  owl: { approved:'Book and page turn',glasses:'Glasses check',compare:'Compare the lines',lesson:'Open the lesson',page:'Turn to the answer',point:'A precise point',underline:'Mark the key idea',close:'Close the book',read:'Read the position',patient:'Review it together',listen:'A thoughtful pause' },
  paws: { approved:'Step and salute',pennant:'Pennant cheer',march:'Onward march',salute:'Captain’s salute',welcome:'Welcome aboard',flagWave:'Wave the pennant',flagPresent:'Present the colors',cheer:'All wings aboard',steady:'Steady course',atEase:'At ease',lookout:'Check the horizon',listen:'Captain is listening' },
  mellow: { approved:'Wings and a yawn',cupWarm:'Warm little cup',teaPause:'A quiet tea pause',cupOffer:'A cup for you',welcome:'Gentle hello',nod:'Take your time',yawn:'Sleepy wing yawn',spread:'Unfurl the wings',point:'A gentle suggestion',ears:'Settle the ears',listen:'I’m here',comfort:'A moment of comfort',scarf:'Tidy the scarf' },
  scout: { approved:'Look, step, and point',lens:'Inspect the clue',compare:'Check both angles',trail:'Follow the trail',found:'Found something!',note:'A closer inspection',scan:'Listen and scan',point:'There’s the clue',follow:'Track the evidence',recheck:'Let’s check again',listen:'All ears',settle:'One clue at a time' },
};

const PLAN = {
  signature: { meowl:['approved','dance','listen'],owl:['approved','glasses','compare'],paws:['approved','pennant','march'],mellow:['approved','cupWarm','scarf'],scout:['approved','lens','follow'],evil:['scheme','tiptoe','flourish'] },
  greeting: { meowl:['highFive','shuffle','bow'],owl:['lesson','glasses','point'],paws:['salute','march','welcome'],mellow:['welcome','cupOffer','ears'],scout:['scan','trail','lens'],evil:['bow','peek','reveal'] },
  brilliant: { meowl:['featherTap','dance','pointPair'],owl:['page','compare','underline'],paws:['pennant','flagWave','flagPresent'],mellow:['cupWarm','spread','cupOffer'],scout:['found','follow','compare'],evil:['flourish','scheme','reveal'] },
  celebrate: { meowl:['dance','highFive','shuffle'],owl:['point','close','glasses'],paws:['cheer','flagPresent','salute'],mellow:['nod','cupOffer','spread'],scout:['point','found','trail'],evil:['rub','bow','tiptoe'] },
  great: { meowl:['highFive','pointPair','bow'],owl:['underline','page','point'],paws:['salute','welcome','pennant'],mellow:['cupOffer','welcome','nod'],scout:['found','note','point'],evil:['reveal','point','flourish'] },
  think: { meowl:['listen','inspect','nod'],owl:['glasses','read','compare'],paws:['lookout','atEase','listen'],mellow:['teaPause','ears','listen'],scout:['scan','compare','lens'],evil:['calculate','rub','peek'] },
  curious: { meowl:['inspect','featherTap','listen'],owl:['read','compare','listen'],paws:['lookout','listen','atEase'],mellow:['ears','teaPause','point'],scout:['lens','scan','note'],evil:['peek','listen','calculate'] },
  approve: { meowl:['bow','invite','nod'],owl:['close','point','lesson'],paws:['salute','atEase','welcome'],mellow:['nod','point','cupWarm'],scout:['point','note','settle'],evil:['nod','point','bow'] },
  encourage: { meowl:['reassure','invite','nod'],owl:['patient','listen','read'],paws:['steady','atEase','listen'],mellow:['comfort','listen','nod'],scout:['recheck','listen','settle'],evil:['reassure','listen','nod'] },
};
const TALK_LABELS = {
  meowl:['Let’s look together','An eager explanation','A little encouragement'],owl:['Make the point','Weigh the evidence','Explain the next step'],
  paws:['Set the course','Give the signal','Captain’s briefing'],mellow:['A gentle explanation','Take it slowly','A patient suggestion'],
  scout:['Point out a clue','Consider both sides','Follow this detail'],
  evil:['Let you in on the plan','A calculated suggestion','The clever little detail'],
};

export const COACH_ANIMATION_LABELS = Object.freeze(Object.fromEntries([
  ...Object.entries(PLAN).map(([kind,coaches])=>[kind,Object.freeze(Object.fromEntries(COACHES.map(coach=>[coach,Object.freeze(coaches[coach].map(id=>LABELS[coach][id]))])))]),
  ['idle',COACH_IDLE_LABELS],
  ['talk',Object.freeze(Object.fromEntries(COACHES.map(coach=>[coach,Object.freeze(TALK_LABELS[coach])])))] ,
]));

export const COACH_ANIMATION_TAKE_COUNTS = Object.freeze(Object.fromEntries(
  Object.entries(COACH_ANIMATION_LABELS).map(([kind,coaches])=>[kind,Object.freeze(
    Object.fromEntries(COACHES.map(coach=>[coach,coaches[coach].length]))
  )])
));

export function coachAnimationTakeCount(kind,coachId='meowl') {
  const coach=COACHES.includes(coachId)?coachId:'meowl';
  return COACH_ANIMATION_TAKE_COUNTS[kind]?.[coach] ?? 0;
}

function talking(c,coach,take,mouth,blink) {
  c.pose.mouth=mouth; c.pose.blink=blink;
  if (coach==='meowl') {
    if (take===0) { c.wing('left',.16,.22,.16,.41,.81); c.look(-.2,.23,.45,.8); }
    else if (take===1) { c.ear('right',-.09,.1,.27,.51); c.wing('right',.23,.16,.35,.57,.87); }
    else { c.nod(3,.21,.43,.77); c.wing('left',.12,.45,.4,.63,.9); }
  } else if (coach==='owl') {
    if (take===0) { c.wing('right',.22,.38,.13,.4,.82); c.nod(2,.36,.56,.81); }
    else if (take===1) { c.set('lookX',[[.15,-.2],[.32,-.25],[.52,.2],[.8,0]]); c.pulse('headTilt',-.02,.19,.43,.78); }
    else { c.wing('left',.12,.32,.15,.37,.58); c.wing('right',.18,.4,.46,.66,.91); }
  } else if (coach==='paws') {
    if (take===0) { c.wing('right',.28,.1,.14,.42,.81); c.nod(-2,.21,.42,.76); }
    else if (take===1) { c.wing('left',.24,-.15,.17,.42,.85); c.ear('right',-.07,.63,.76,.92); }
    else { c.nod(3,.19,.4,.7); c.wing('right',.16,.45,.4,.61,.89); }
  } else if (coach==='mellow') {
    if (take===0) { c.wing('right',.12,.22,.2,.47,.88); c.pulse('headTilt',.025,.16,.44,.86); }
    else if (take===1) { c.nod(2,.24,.49,.86); c.ear('left',-.06,.55,.72,.92); }
    else { c.wing('left',.15,.3,.22,.5,.91); c.look(-.16,.22,.48,.86); }
  } else if (coach==='evil') {
    if (take===0) { c.look(-.32,.09,.29,.66); c.wing('left',.12,.45,.34,.57,.89); }
    else if (take===1) { c.pulse('headTilt',.035,.11,.36,.82); c.wing('right',.19,.4,.29,.53,.87); c.nod(2,.57,.74,.93); }
    else { c.ear('left',.085,.12,.29,.52); c.wing('left',.17,.32,.38,.6,.9); c.look(.22,.37,.58,.85); }
  } else {
    if (take===0) { c.wing('right',.24,.4,.19,.43,.83); c.look(.25,.16,.39,.76); }
    else if (take===1) { c.set('lookX',[[.12,-.25],[.3,-.3],[.5,.25],[.8,0]]); c.ear('left',.075,.47,.63,.86); }
    else { c.ear('right',-.09,.14,.33,.58); c.wing('right',.18,.3,.43,.65,.91); }
  }
}

/** Forty quiet idles and three takes per reaction; signature take 0 is preserved. */
export function applyCoachRepertoire(kind,basePose,progress,coachId='meowl',variation=0) {
  const pose={};
  if (basePose && typeof basePose==='object') for (const [key,[low,high]] of Object.entries(LIMITS)) {
    if (Object.hasOwn(basePose,key)) pose[key]=key==='featherY'&&!basePose[key]?0:clamp(Number.isFinite(basePose[key])?basePose[key]:0,low,high);
  }
  for (const key of REMOVED) pose[key]=0;
  if (!Number.isFinite(progress)||progress<=0||progress>=1) { for (const key of Object.keys(pose)) pose[key]=0; return pose; }
  if (!Object.hasOwn(COACH_ANIMATION_LABELS,kind)) return pose;
  coachId=COACHES.includes(coachId)?coachId:'meowl';
  const count=coachAnimationTakeCount(kind,coachId);
  const take=Number.isFinite(variation)?((Math.trunc(variation)%count)+count)%count:0;
  if (kind==='signature'&&take===0&&coachId!=='evil') return pose;
  const mouth=pose.mouth||0,blink=pose.blink||0;
  for (const key of Object.keys(LIMITS)) pose[key]=0;
  const c=director(pose,progress);
  if (kind==='idle') Object.assign(pose,applyCoachIdleRepertoire(progress,coachId,take));
  else if (kind==='talk') talking(c,coachId,take,mouth,blink);
  else ROUTINES[coachId][PLAN[kind][coachId][take]](c);
  for (const [key,[low,high]] of Object.entries(LIMITS)) {
    if (key==='featherY'&&!(pose.feather>0)) pose[key]=0;
    else pose[key]=clamp(Number.isFinite(pose[key])?pose[key]:0,low,high);
  }
  return pose;
}
