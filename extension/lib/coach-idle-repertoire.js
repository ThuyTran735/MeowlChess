import { COACH_FULL_BODY_IDLES } from './coach-idle-scenes.js';
import { BABY_IDLE_REPERTOIRE, BABY_IDLE_LABELS, babyIdlePose } from './coach-baby-motion.js';

const COACHES = ['meowl','owl','paws','mellow','scout','evil'];
const LIMITS = Object.freeze({
  blink:[0,1],lookX:[-1,1],headTilt:[-.065,.065],headNod:[-4,4],
  bodyX:[-14,14],lift:[-8,4],tilt:[-.018,.018],leftStep:[0,16],rightStep:[0,16],leftFoot:[-.18,.18],rightFoot:[-.18,.18],
  leftWing:[0,.45],rightWing:[0,.45],leftElbow:[-2.2,2.2],rightElbow:[-2.2,2.2],leftEar:[-.16,.16],rightEar:[-.16,.16],
  book:[0,1],pageTurn:[0,1],glasses:[0,1],mug:[0,1],mugLift:[0,40],steam:[0,1],steamPhase:[0,1],
  magnifier:[0,1],glassAngle:[-.3,.3],pennant:[0,1],flagFlutter:[-.12,.12],
  feather:[0,1],featherX:[-280,280],featherY:[500,900],featherAngle:[-.8,.8],
});
const MAX_CHANNELS = new Set(['blink','book','pageTurn','glasses','mug','steam','magnifier','pennant','feather']);
const PROP_CHANNELS = Object.freeze({mugLift:'mug',steamPhase:'steam',glassAngle:'magnifier',flagFlutter:'pennant',featherX:'feather',featherY:'feather',featherAngle:'feather'});
const clamp = (value,low,high)=>Math.max(low,Math.min(high,value));

function curve(time,points,initial=0,final=0){
  const frames=[[0,initial],...points,[1,final]];
  if(time<=0)return initial;if(time>=1)return final;
  let index=1;while(time>frames[index][0])index++;
  const tangent=at=>{
    if(!at||at===frames.length-1)return 0;
    const a=frames[at][0]-frames[at-1][0],b=frames[at+1][0]-frames[at][0];
    const l=(frames[at][1]-frames[at-1][1])/a,r=(frames[at+1][1]-frames[at][1])/b;
    if(l*r<=0)return 0;
    return 3*(a+b)/((2*b+a)/l+(b+2*a)/r);
  };
  const [start,from]=frames[index-1],[end,to]=frames[index],span=end-start,p=(time-start)/span;
  return (2*p**3-3*p**2+1)*from+(p**3-2*p**2+p)*span*tangent(index-1)+(-2*p**3+3*p**2)*to+(p**3-p**2)*span*tangent(index);
}

function animator(time){
  const pose={};
  const set=(key,points,initial=0,final=0)=>pose[key]=curve(time,points,initial,final);
  const pulse=(key,value,start=.12,peak=.43,end=.88)=>set(key,[[start,0],[peak,value],[end,0]]);
  const hold=(key,value,start=.08,arrive=.3,release=.63,end=.9)=>set(key,[[start,0],[arrive,value],[release,value],[end,0]]);
  const ear=(side,value=.1)=>set(`${side}Ear`,[[.1,0],[.35,value],[.61,-value*.25],[.9,0]]);
  const look=(value)=>{pulse('lookX',value,.08,.42,.9);pulse('headTilt',value*.065,.13,.47,.95);};
  const nod=(value=2)=>pulse('headNod',value,.1,.44,.9);
  const blink=()=>set('blink',[[.16,0],[.38,1],[.52,1],[.79,0]]);
  const wing=(side,angle,elbow)=>{pulse(`${side}Wing`,angle,.08,.4,.9);pulse(`${side}Elbow`,elbow,.1,.45,.93);};
  const book=(style='peek')=>{
    const early=style==='close';
    hold('book',1,.12,.27,early?.4:.69,early?.62:.86);
    hold('leftWing',.1,.03,.2,early?.44:.72,early?.7:.94);
    hold('rightWing',.12,.04,.22,early?.44:.72,early?.72:.95);
    hold('leftElbow',1.85,.03,.2,early?.44:.72,early?.7:.94);
    hold('rightElbow',1.75,.04,.22,early?.44:.72,early?.72:.95);
    if(style==='page'){
      set('pageTurn',[[.34,0],[.47,.4],[.64,1],[.94,1],[.99,0]]);
      set('rightElbow',[[.04,0],[.22,1.75],[.48,2.05],[.65,1.75],[.74,1.75],[.95,0]]);
    }else if(style==='compare'){
      set('rightElbow',[[.04,0],[.24,1.75],[.35,2],[.48,1.7],[.61,2.05],[.74,1.75],[.95,0]]);
      set('lookX',[[.15,-.2],[.32,-.4],[.49,.1],[.66,.35],[.89,0]]);
    }else if(style==='underline'){
      set('rightElbow',[[.04,0],[.24,1.75],[.43,2.05],[.62,1.75],[.74,1.75],[.95,0]]);
    }else if(style==='read')set('lookX',[[.16,-.3],[.39,-.05],[.64,.3],[.89,0]]);
    nod(style==='close'?1:2.5);
  };
  const cup=(style='warm')=>{
    hold('mug',1,.13,.29,.69,.89);
    hold('leftWing',.08,.04,.2,.73,.94);hold('rightWing',.1,.05,.22,.73,.95);
    hold('leftElbow',1.85,.04,.2,.73,.94);hold('rightElbow',1.85,.05,.22,.73,.95);
    if(style==='lift')pulse('mugLift',32,.24,.51,.79);
    else if(style==='lower')set('mugLift',[[.15,0],[.31,27],[.47,20],[.64,0],[.85,0]]);
    else if(style==='offer')pulse('mugLift',13,.27,.5,.78);
    else pulse('mugLift',5,.26,.5,.77);
    pose.leftElbow+=pose.mugLift*.003;pose.rightElbow+=pose.mugLift*.003;
    hold('steam',style==='steam'?.68:.48,.22,.37,.65,.85);
    set('steamPhase',[[.2,0],[.85,1],[.93,1],[.99,0]]);
    if(style==='steam'){set('headNod',[[.22,1],[.42,-2],[.62,-1],[.88,0]]);pulse('lookX',.16,.25,.48,.81);}
    else nod(style==='offer'?-1:2);
  };
  const lens=(style='peek')=>{
    const angle=style==='low'?.2:style==='trace'?.36:.27,elbow=style==='low'?-.3:style==='trace'?-.55:-.4;
    hold('rightWing',angle,.04,.24,.69,.94);hold('rightElbow',elbow,.05,.25,.7,.95);
    hold('magnifier',1,.18,.32,.68,.87);
    if(style==='angle')set('glassAngle',[[.17,0],[.37,-.25],[.59,.25],[.85,0]]);
    else if(style==='trace'){
      set('rightWing',[[.04,0],[.24,.27],[.45,.42],[.66,.3],[.94,0]]);
      set('glassAngle',[[.17,0],[.43,.15],[.67,-.15],[.87,0]]);
    }else pulse('glassAngle',.1,.18,.48,.85);
    look(style==='low'?.2:.35);if(style==='low')nod(3);
  };
  const pennant=(style='inspect')=>{
    const raised=style==='breeze';
    hold('leftWing',raised?.4:.22,.04,.23,.69,.94);hold('leftElbow',raised?-.1:1.5,.05,.24,.7,.95);
    hold('pennant',1,.18,.32,.67,.87);
    if(raised)set('flagFlutter',[[.18,0],[.36,.11],[.53,-.09],[.7,.05],[.87,0]]);
    else pulse('flagFlutter',.035,.23,.48,.8);
    if(style==='inspect'){look(-.2);nod(2.5);}
    else if(style==='lower')set('leftWing',[[.04,0],[.23,.32],[.4,.28],[.68,.18],[.94,0]]);
    else look(-.3);
  };
  const feather=(style='drift')=>{
    hold('feather',.65,.09,.24,.72,.91);
    if(style==='fall'){
      set('featherX',[[.2,225],[.43,205],[.68,230],[.9,215]],215,210);
      set('featherY',[[.16,565],[.4,635],[.65,745],[.9,835]],550,850);
      set('headNod',[[.13,-2],[.38,-.5],[.65,3],[.91,0]]);pulse('lookX',.5,.12,.48,.9);
    }else if(style==='hover'){
      set('featherX',[[.2,-210],[.4,-250],[.61,-225],[.85,-200]],-205,-190);
      set('featherY',[[.18,670],[.4,625],[.61,650],[.85,690]],690,705);
      look(-.5);
    }else{
      set('featherX',[[.16,-220],[.35,-125],[.56,85],[.78,220],[.91,245]],-230,250);
      set('featherY',[[.16,710],[.4,665],[.65,700],[.9,750]],730,770);
      set('lookX',[[.14,-.55],[.35,-.3],[.58,.25],[.8,.55],[.95,0]]);
    }
    set('featherAngle',[[.09,0],[.3,.27],[.55,-.25],[.77,.16],[.94,0]]);
  };
  return{pose,set,pulse,hold,ear,look,nod,blink,wing,book,cup,lens,pennant,feather};
}

const ATOMS={
  evil:{
    checkLeft:c=>{c.look(-.6);c.ear('left',.085);},
    checkRight:c=>{c.look(.5);c.pulse('headNod',-1,.19,.48,.85);},
    overhear:c=>{c.ear('left',.14);c.pulse('headTilt',-.045,.2,.47,.9);},
    rearSound:c=>{c.ear('right',-.13);c.set('lookX',[[.12,0],[.3,.48],[.58,.25],[.91,0]]);},
    calculate:c=>{c.wing('right',.11,1.35);c.pulse('headTilt',.05,.18,.45,.91);c.nod(-1.5);},
    fold:c=>{c.hold('leftElbow',1.25,.08,.3,.63,.9);c.hold('rightElbow',1.4,.16,.38,.66,.94);c.hold('leftWing',.08,.08,.3,.63,.9);c.hold('rightWing',.1,.16,.38,.66,.94);},
    rub:c=>{c.hold('leftWing',.1,.08,.25,.7,.93);c.hold('rightWing',.1,.11,.29,.72,.95);c.set('leftElbow',[[.08,0],[.27,1.25],[.42,1.52],[.57,1.27],[.7,1.48],[.93,0]]);c.set('rightElbow',[[.11,0],[.29,1.48],[.44,1.24],[.59,1.5],[.72,1.28],[.95,0]]);},
    ponder:c=>{c.set('lookX',[[.1,0],[.34,-.3],[.64,.3],[.93,0]]);c.pulse('headTilt',.04,.12,.45,.92);},
    inspectTip:c=>{c.wing('left',.25,.65);c.look(-.35);c.nod(2.5);},
    collar:c=>{c.wing('right',.1,1.6);c.nod(2);c.pulse('headTilt',-.025,.2,.49,.91);},
    conceal:c=>{c.set('leftElbow',[[.08,0],[.3,1.4],[.61,.95],[.91,0]]);c.set('rightElbow',[[.16,0],[.39,1.45],[.69,1],[.95,0]]);c.nod(1.5);},
    chinUp:c=>{c.nod(-2.5);c.pulse('lookX',.12,.2,.5,.88);},
    down:c=>{c.nod(3);c.pulse('lookX',-.2,.14,.42,.86);},
    smallReveal:c=>{c.set('rightWing',[[.08,0],[.31,.11],[.55,.38],[.9,0]]);c.set('rightElbow',[[.08,0],[.31,1.1],[.56,.25],[.92,0]]);c.look(.27);},
    decide:c=>{c.set('headNod',[[.1,0],[.3,-1.5],[.46,0],[.65,2.5],[.92,0]]);},
    blink:c=>c.blink(),
    beckon:c=>{c.set('leftWing',[[.1,0],[.33,.27],[.54,.12],[.89,0]]);c.set('leftElbow',[[.1,0],[.34,.3],[.57,1.05],[.93,0]]);c.pulse('headTilt',-.025,.25,.51,.9);},
  },
  meowl:{
    hearLeft:c=>{c.ear('left',.13);c.look(-.3);},hearRight:c=>{c.ear('right',-.13);c.look(.3);},
    earsBoth:c=>{c.set('leftEar',[[.08,0],[.27,.12],[.49,0],[.9,0]]);c.set('rightEar',[[.38,0],[.62,-.12],[.91,0]]);},
    lookLow:c=>{c.nod(3);c.pulse('lookX',-.15,.14,.42,.84);},lookHigh:c=>{c.nod(-2);c.pulse('lookX',.18,.14,.43,.86);},
    blink:c=>c.blink(),question:c=>c.set('headTilt',[[.1,0],[.37,-.04],[.66,.022],[.92,0]]),
    preenLeft:c=>{c.wing('left',.18,.9);c.look(-.35);c.nod(2);},preenRight:c=>{c.wing('right',.18,.85);c.look(.35);c.nod(2);},
    tuck:c=>{c.hold('leftElbow',1.05,.1,.36,.6,.9);c.hold('rightElbow',1.05,.13,.39,.63,.93);},
    wingCheck:c=>{c.wing('right',.33,.2);c.look(.35);},nod:c=>c.nod(2.5),
    featherDrift:c=>c.feather('drift'),featherFall:c=>c.feather('fall'),featherHover:c=>c.feather('hover'),
  },
  owl:{
    specs:c=>{c.pulse('glasses',.55,.14,.4,.8);c.nod(2);},peek:c=>c.book('peek'),read:c=>c.book('read'),
    page:c=>c.book('page'),compare:c=>c.book('compare'),close:c=>c.book('close'),underline:c=>c.book('underline'),
    nod:c=>c.set('headNod',[[.1,0],[.32,2],[.49,0],[.69,1.5],[.92,0]]),tilt:c=>c.pulse('headTilt',-.035,.12,.45,.9),
    left:c=>c.look(-.3),right:c=>c.look(.3),blink:c=>c.blink(),ear:c=>c.ear('left',.075),
    point:c=>c.wing('right',.25,.42),waistcoat:c=>{c.wing('left',.12,1.65);c.wing('right',.1,1.55);c.nod(2);},
    sleeve:c=>{c.wing('left',.16,.8);c.look(-.25);c.nod(2);},
  },
  paws:{
    stand:c=>{c.nod(-2);c.ear('right',-.055);},horizon:c=>{c.set('lookX',[[.1,-.2],[.29,-.4],[.5,0],[.72,.4],[.94,0]]);c.set('headTilt',[[.14,-.013],[.34,-.028],[.55,.008],[.76,.027],[.96,0]]);},
    port:c=>c.look(-.35),starboard:c=>c.look(.35),nod:c=>c.nod(2.5),
    leftWing:c=>{c.wing('left',.25,.8);c.look(-.25);},rightWing:c=>{c.wing('right',.25,.75);c.look(.25);},
    uniform:c=>{c.hold('leftElbow',1.45,.1,.35,.6,.9);c.hold('rightElbow',1.4,.13,.38,.63,.93);c.nod(2);},
    salute:c=>{c.wing('right',.42,-.25);c.nod(-1.5);},flagInspect:c=>c.pennant('inspect'),flagLower:c=>c.pennant('lower'),flagBreeze:c=>c.pennant('breeze'),
    ear:c=>c.ear('left',.09),think:c=>c.pulse('headTilt',.03,.13,.46,.9),blink:c=>c.blink(),ground:c=>c.nod(3),
  },
  mellow:{
    warm:c=>c.cup('warm'),liftCup:c=>c.cup('lift'),steam:c=>c.cup('steam'),offer:c=>c.cup('offer'),lowerCup:c=>c.cup('lower'),
    scarf:c=>{c.set('leftWing',[[.08,0],[.31,.12],[.56,.07],[.83,0]]);c.set('leftElbow',[[.08,0],[.32,2.05],[.5,1.65],[.81,0]]);c.set('rightWing',[[.3,0],[.54,.13],[.75,.07],[.94,0]]);c.set('rightElbow',[[.3,0],[.55,2],[.72,1.6],[.95,0]]);c.nod(2);},
    leftWing:c=>c.wing('left',.15,.7),rightWing:c=>c.wing('right',.14,.65),
    ears:c=>{c.ear('left',-.095);c.set('rightEar',[[.4,0],[.66,.065],[.92,0]]);},
    blink:c=>c.blink(),tilt:c=>c.pulse('headTilt',.035,.14,.46,.91),rest:c=>c.nod(2),
    listen:c=>{c.ear('right',-.085);c.look(.2);},hands:c=>{c.hold('leftElbow',1.5,.12,.35,.61,.91);c.hold('rightElbow',1.45,.15,.38,.64,.94);},
    down:c=>{c.nod(3);c.pulse('lookX',-.13,.15,.44,.85);},
  },
  scout:{
    lensPeek:c=>c.lens('peek'),lensAngle:c=>c.lens('angle'),lensLow:c=>c.lens('low'),lensTrace:c=>c.lens('trace'),
    ears:c=>{c.set('leftEar',[[.08,0],[.28,.12],[.56,.035],[.89,0]]);c.set('rightEar',[[.16,0],[.38,-.12],[.66,-.03],[.94,0]]);},
    hearLeft:c=>{c.ear('left',.12);c.look(-.35);},hearRight:c=>{c.ear('right',-.12);c.look(.35);},
    scan:c=>{c.set('lookX',[[.1,-.2],[.29,-.38],[.5,0],[.7,.38],[.94,0]]);c.set('headTilt',[[.15,-.012],[.34,-.028],[.55,.008],[.75,.028],[.97,0]]);},
    ground:c=>{c.nod(3);c.pulse('lookX',.17,.14,.44,.85);},question:c=>c.pulse('headTilt',-.035,.13,.44,.91),
    point:c=>{c.wing('right',.35,.3);c.look(.3);},satchel:c=>{c.wing('left',.12,1.4);c.look(-.22);c.nod(2);},
    nod:c=>c.nod(2),blink:c=>c.blink(),high:c=>{c.nod(-2);c.pulse('lookX',.22,.15,.43,.84);},
  },
};

// Every entry is an authored little sequence. Prop scenes run long enough to
// read; a quiet glance or ear response can occur while the object is held.
const pair=(label,first,second)=>({label,beats:[{action:first,start:.035,end:.54},{action:second,start:.46,end:.965}]});
const scene=(label,prop,response)=>({label,beats:[{action:prop,start:.025,end:.97},{action:response,start:.39,end:.91}]});
const trio=(label,first,second,third)=>({label,beats:[{action:first,start:.03,end:.38},{action:second,start:.32,end:.68},{action:third,start:.62,end:.97}]});
const RECIPES={
  evil:[
    pair('Check left, make a plan','checkLeft','calculate'),
    pair('A tiny folded-wing scheme','fold','rub'),
    trio('Check both sides, then plot','checkLeft','checkRight','rub'),
    pair('Was that someone listening?','overhear','checkRight'),
    pair('Inspect the scheming wingtip','inspectTip','decide'),
    pair('The collar must look perfect','collar','chinUp'),
    pair('Nothing suspicious here','conceal','blink'),
    scene('Plot quietly while looking aside','rub','checkLeft'),
    pair('A sound interrupts the plan','calculate','rearSound'),
    pair('Look down at the next idea','down','ponder'),
    pair('A very small grand reveal','smallReveal','decide'),
    pair('Keep the idea close','beckon','fold'),
    pair('An innocent upward glance','chinUp','blink'),
    pair('A plan worth reconsidering','ponder','calculate'),
    trio('Listen, glance, conceal','overhear','checkLeft','conceal'),
    pair('The right side seems clear','checkRight','rub'),
    pair('Tidy up before plotting','collar','fold'),
    pair('Hear something behind the plan','rearSound','ponder'),
    pair('The wingtip passes inspection','inspectTip','chinUp'),
    pair('Come closer for the secret','checkLeft','beckon'),
    pair('Calculate, then fold away','calculate','conceal'),
    pair('A thoughtful little pause','ponder','blink'),
    scene('Folded wings, ears alert','fold','overhear'),
    pair('A detail below changes things','down','smallReveal'),
    pair('A collar check after listening','rearSound','collar'),
    pair('Consider the wing, consider the plan','inspectTip','ponder'),
    pair('Offer one mysterious suggestion','beckon','decide'),
    pair('A quiet reveal, then retreat','smallReveal','conceal'),
    trio('Look down, listen, decide','down','overhear','decide'),
    pair('A plan followed by composure','rub','chinUp'),
    pair('Check right, then the wingtip','checkRight','inspectTip'),
    pair('Blink, then start scheming again','blink','calculate'),
  ],
  meowl:[
    pair('A sound, then a glance','hearLeft','lookHigh'),pair('A quiet glance to the right','lookHigh','hearRight'),pair('Listening nearby','question','blink'),
    scene('Follow a drifting feather','featherDrift','earsBoth'),pair('Check the left feathers','preenLeft','blink'),pair('Tuck both wings','tuck','nod'),
    pair('Listen on both sides','hearLeft','hearRight'),pair('A puzzled little tilt','question','earsBoth'),scene('Watch a falling feather','featherFall','blink'),
    pair('Inspect the right wing','preenRight','lookHigh'),pair('Listen, then tuck in','hearRight','tuck'),pair('A quiet wingtip check','wingCheck','lookLow'),
    pair('Low glance, soft blink','lookLow','blink'),pair('Ear flick and feather peek','hearLeft','featherHover'),pair('Pause after a wing check','preenLeft','question'),
    pair('Look up at a sound','earsBoth','lookHigh'),scene('A feather hovers nearby','featherHover','nod'),pair('Both wings in order','preenLeft','preenRight'),
    pair('A comfortable little tuck','tuck','blink'),pair('A curious look around','question','hearRight'),pair('Listen before a nod','hearLeft','nod'),
    pair('Watching the wingtip','wingCheck','question'),pair('Check below, then listen','lookLow','hearRight'),pair('A feather passes the wing','featherDrift','preenRight'),
    pair('The other ear catches it','lookHigh','hearLeft'),pair('Rest after looking up','lookHigh','blink'),pair('Pause, then investigate','blink','preenLeft'),
    pair('One ear, then both','hearRight','earsBoth'),pair('Feather watching finished','featherFall','tuck'),pair('A gentle wing acknowledgement','wingCheck','nod'),
    trio('Blink, listen, and settle','blink','hearLeft','nod'),pair('One last feather look','featherHover','hearRight'),
  ],
  owl:[
    pair('Settle the glasses','specs','nod'),scene('A quick book peek','peek','tilt'),pair('Compare a thought','left','right'),
    pair('Read, then look up','read','nod'),scene('A page worth another look','page','ear'),scene('Compare two lines','compare','blink'),
    pair('Close the book gently','close','tilt'),scene('Mark a useful sentence','underline','nod'),pair('Glasses before reading','specs','peek'),
    pair('The lesson can wait','point','blink'),pair('Neaten the waistcoat','waistcoat','nod'),pair('Inspect a sleeve','sleeve','right'),
    pair('A patient listening pause','ear','tilt'),pair('Look across the notes','left','nod'),pair('Consider the other side','right','tilt'),
    scene('Read with a thoughtful tilt','read','tilt'),scene('Turn a page and refocus','page','specs'),pair('Book closed, glasses settled','close','specs'),
    scene('A quiet comparison','compare','ear'),pair('Check the margin, then pause','underline','blink'),pair('A precise little gesture','point','nod'),
    pair('Left glance, glasses check','left','specs'),pair('Listen before opening','ear','peek'),pair('A tidy sleeve and waistcoat','sleeve','waistcoat'),
    pair('Let the idea settle','tilt','blink'),scene('A second reading','peek','left'),pair('Notes finished for now','read','close'),
    pair('Glasses and a calm point','specs','point'),scene('Follow the next line','underline','right'),trio('Listen, consider, acknowledge','ear','tilt','nod'),
    pair('A resting scholarly posture','waistcoat','blink'),scene('Find the next page','page','right'),
  ],
  paws:[
    pair('Stand easy','stand','ear'),pair('Watch the horizon','horizon','nod'),pair('A captain’s nod','nod','think'),
    pair('Check the port side','port','ear'),pair('Check starboard','starboard','stand'),pair('A quiet uniform check','uniform','blink'),
    pair('Inspect the left wing','leftWing','nod'),pair('Inspect the right wing','rightWing','think'),scene('Check the pennant','flagInspect','blink'),
    scene('A small breeze in the pennant','flagBreeze','ear'),pair('Lower the colors calmly','flagLower','stand'),pair('A restrained salute','salute','nod'),
    pair('Port, then starboard','port','starboard'),pair('Check the deck below','ground','stand'),pair('Listen before looking out','ear','horizon'),
    pair('Uniform straight, ready again','uniform','nod'),pair('Wing check before watch','leftWing','horizon'),pair('A thoughtful sea watch','think','port'),
    scene('Inspect the edge of the flag','flagInspect','ground'),scene('The wind changes gently','flagBreeze','starboard'),pair('Pennant away, wings at ease','flagLower','uniform'),
    pair('Salute, then stand easy','salute','stand'),pair('The starboard wing is tidy','rightWing','blink'),pair('Port wing, then listen','leftWing','ear'),
    trio('Scan, listen, acknowledge','port','ear','nod'),pair('A quiet captain’s pause','think','blink'),scene('Steady the small pennant','flagInspect','think'),
    pair('Check both wings','leftWing','rightWing'),pair('Look down, then across','ground','starboard'),pair('Ready for the next briefing','stand','salute'),
    pair('A final look around','horizon','blink'),pair('Listen at ease','ear','uniform'),
  ],
  mellow:[
    scene('Keep the cup warm','warm','rest'),pair('Rest for a moment','tilt','blink'),pair('A soft ear flick','ears','rest'),
    scene('Watch the little steam curls','steam','blink'),scene('Lift the warm cup','liftCup','tilt'),pair('Lower the cup gently','lowerCup','rest'),
    pair('Tidy the scarf ends','scarf','blink'),pair('Settle the left wing','leftWing','ears'),pair('Settle the right wing','rightWing','tilt'),
    scene('A quiet cup offered nearby','offer','listen'),pair('Fold the wings comfortably','hands','rest'),pair('Listen, then relax','listen','blink'),
    pair('A glance at the cardigan','down','leftWing'),scene('Steam catches the eye','steam','listen'),scene('Warm hands and a calm pause','warm','blink'),
    pair('Scarf settled, ears relaxed','scarf','ears'),pair('Both wings find their place','leftWing','rightWing'),pair('A soft listening tilt','listen','tilt'),
    scene('Hold the cup a little higher','liftCup','ears'),pair('Cup lowered, scarf tidied','lowerCup','scarf'),pair('A comfortable cardigan check','down','hands'),
    scene('A cup and a gentle nod','offer','rest'),pair('Ear flick before a quiet blink','ears','blink'),pair('Rest after a wing check','rightWing','rest'),
    pair('Listen with folded wings','hands','listen'),scene('A little warmth while waiting','warm','tilt'),pair('One look down, then rest','down','blink'),
    pair('Scarf first, then settle','scarf','hands'),scene('Follow the last curl of steam','steam','ears'),trio('Listen, blink, rest','listen','blink','rest'),
    pair('A small left-wing adjustment','leftWing','tilt'),pair('Cup away, a quiet look','lowerCup','listen'),
  ],
  scout:[
    scene('Peek through the lens','lensPeek','question'),pair('Check a sound','ears','scan'),pair('Watch the next clue','hearLeft','question'),
    scene('Turn the lens to the light','lensAngle','blink'),scene('Inspect a lower detail','lensLow','nod'),scene('Trace a small clue','lensTrace','ears'),
    pair('Listen to the left','hearLeft','nod'),pair('Listen to the right','hearRight','ground'),pair('Look across the clearing','scan','high'),
    pair('Check the satchel strap','satchel','blink'),pair('A quiet point toward a clue','point','question'),pair('Something above catches the eye','high','ears'),
    scene('A careful second angle','lensAngle','question'),pair('Lens down, ears ready','lensLow','ears'),pair('Inspect, then look around','lensPeek','scan'),
    pair('Check the ground first','ground','hearRight'),pair('A clue, then an acknowledgement','point','nod'),pair('Satchel checked, listen again','satchel','hearLeft'),
    scene('A lens check in silence','lensPeek','blink'),scene('Follow the edge of a clue','lensTrace','nod'),pair('Both ears take a turn','hearLeft','hearRight'),
    pair('A curious upward glance','question','high'),pair('A scan before inspecting','scan','lensAngle'),pair('The satchel is still secure','satchel','nod'),
    scene('A detail below the lens','lensLow','question'),pair('Listen, then indicate the spot','hearRight','point'),trio('Hear, inspect, acknowledge','ears','ground','nod'),
    pair('One eye-led look around','scan','blink'),pair('Look up, then check the strap','high','satchel'),scene('The lens catches a glint','lensAngle','hearRight'),
    pair('Point finished, all ears','point','ears'),pair('A final quiet double-check','question','lensPeek'),
  ],
};

for(const coach of COACHES){
  for(const [index,[label,animate]]of COACH_FULL_BODY_IDLES[coach].entries()){
    const action=`fullBody${index}`;ATOMS[coach][action]=animate;
    RECIPES[coach].push({label,beats:[{action,start:.02,end:.98}]});
  }
  for(const item of RECIPES[coach]){for(const beat of item.beats)Object.freeze(beat);Object.freeze(item.beats);Object.freeze(item);}
  Object.freeze(RECIPES[coach]);
}
export const COACH_IDLE_REPERTOIRE=Object.freeze({...RECIPES,baby:BABY_IDLE_REPERTOIRE});
export const COACH_IDLE_LABELS=Object.freeze({...Object.fromEntries(COACHES.map(coach=>[coach,Object.freeze(RECIPES[coach].map(item=>item.label))])),baby:BABY_IDLE_LABELS});
export const COACH_IDLE_TAKE_COUNTS=Object.freeze({...Object.fromEntries(COACHES.map(coach=>[coach,RECIPES[coach].length])),baby:BABY_IDLE_LABELS.length});

/** Quiet, finite idle scenes. Every joint returns to rest; prop poses keep their supporting wings. */
export function applyCoachIdleRepertoire(progress,coachId='meowl',variation=0){
  if(coachId==='baby')return babyIdlePose(progress,variation);
  const pose=Object.fromEntries(Object.keys(LIMITS).map(key=>[key,0]));
  if(!Number.isFinite(progress)||progress<=0||progress>=1)return pose;
  coachId=COACHES.includes(coachId)?coachId:'meowl';
  const count=RECIPES[coachId].length,take=Number.isFinite(variation)?((Math.trunc(variation)%count)+count)%count:0;
  const weights={};
  for(const beat of RECIPES[coachId][take].beats){
    if(progress<=beat.start||progress>=beat.end)continue;
    const c=animator((progress-beat.start)/(beat.end-beat.start));ATOMS[coachId][beat.action](c);
    for(const [key,value]of Object.entries(c.pose)){
      if(Object.hasOwn(PROP_CHANNELS,key)){
        const weight=c.pose[PROP_CHANNELS[key]]||0;
        if(weight>(weights[key]||0)){pose[key]=value;weights[key]=weight;}
      }else if(MAX_CHANNELS.has(key))pose[key]=Math.max(pose[key],value);
      else pose[key]+=value;
    }
  }
  for(const [key,[low,high]]of Object.entries(LIMITS)){
    if(key==='featherY'&&!(pose.feather>0))pose[key]=0;
    else pose[key]=clamp(Number.isFinite(pose[key])?pose[key]:0,low,high);
  }
  return pose;
}
