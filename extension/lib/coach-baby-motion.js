// Baby uses the same articulated joints as the other Meowls. Its proportions
// belong to the artwork renderer; these timelines never stretch the drawing.
const LIMITS = Object.freeze({
  mouth:[0,1],blink:[0,1],lookX:[-1,1],leftWing:[0,1.35],rightWing:[0,1.35],
  leftElbow:[-2.2,2.2],rightElbow:[-2.2,2.2],leftFoot:[-.3,.3],rightFoot:[-.3,.3],
  leftStep:[0,28],rightStep:[0,28],leftEar:[-.18,.18],rightEar:[-.18,.18],
  headTilt:[-.1,.1],headNod:[-8,8],bodyX:[-18,18],lift:[-12,6],tilt:[-.025,.025],
  book:[0,1],pageTurn:[0,1],glasses:[0,1],feather:[0,1],featherX:[-280,280],
  featherY:[0,900],featherAngle:[-1,1],mug:[0,1],mugLift:[0,90],steam:[0,1],
  steamPhase:[0,1],magnifier:[0,1],glassAngle:[-.4,.4],pennant:[0,1],flagFlutter:[-.4,.4],
});
const REMOVED = ['winkLeft','winkRight','blep','eyeSmile','squash','bodyBend','leftFlop','rightFlop','breathe','leftReach','rightReach','hug','wing'];
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const neutral=()=>Object.fromEntries([...Object.keys(LIMITS),...REMOVED].map(key=>[key,0]));

function curve(time,points){
  const frames=[[0,0],...points,[1,0]];
  if(time<=0||time>=1)return 0;
  let index=1;while(time>frames[index][0])index++;
  const tangent=at=>{
    if(!at||at===frames.length-1)return 0;
    const a=frames[at][0]-frames[at-1][0],b=frames[at+1][0]-frames[at][0];
    const left=(frames[at][1]-frames[at-1][1])/a,right=(frames[at+1][1]-frames[at][1])/b;
    return left*right<=0?0:3*(a+b)/((2*b+a)/left+(b+2*a)/right);
  };
  const[start,from]=frames[index-1],[end,to]=frames[index],span=end-start,p=(time-start)/span;
  return (2*p**3-3*p**2+1)*from+(p**3-2*p**2+p)*span*tangent(index-1)
    +(-2*p**3+3*p**2)*to+(p**3-p**2)*span*tangent(index);
}

function director(pose,time){
  const set=(key,points)=>pose[key]=curve(time,points);
  const pulse=(key,value,start=.1,peak=.42,end=.9)=>set(key,[[start,0],[peak,value],[end,0]]);
  const hold=(key,value,start=.1,arrive=.3,release=.6,end=.9)=>set(key,[[start,0],[arrive,value],[release,value],[end,0]]);
  const look=(value,start=.1,peak=.35,end=.85)=>{
    pulse('lookX',value,start,peak,end);pulse('headTilt',value*.07,start+.03,peak+.03,Math.min(.98,end+.05));
  };
  const ear=(side,value=.12,start=.1,peak=.35,end=.84)=>set(`${side}Ear`,[[start,0],[peak,value],[peak+(end-peak)*.5,-value*.2],[end,0]]);
  const wing=(side,angle,elbow,start=.1,peak=.42,end=.87)=>{
    pulse(`${side}Wing`,angle,start,peak,end);pulse(`${side}Elbow`,elbow,start+.02,peak+.025,Math.min(.98,end+.04));
  };
  const nod=(value=3,start=.15,peak=.45,end=.88)=>pulse('headNod',value,start,peak,end);
  const blink=(start=.58,peak=.68,end=.83)=>pulse('blink',1,start,peak,end);
  const step=(side,start,peak,end,height=15)=>{
    pulse(`${side}Step`,height,start,peak,end);
    set(`${side}Foot`,[[start,0],[peak,side==='left'?-.15:.15],[end,0]]);
  };
  return{pose,set,pulse,hold,look,ear,wing,nod,blink,step};
}

const actions={
  peek(c){
    c.hold('leftWing',.38,.05,.23,.47,.8);c.hold('rightWing',.4,.1,.28,.5,.85);
    c.hold('leftElbow',1.65,.07,.25,.47,.8);c.hold('rightElbow',1.6,.12,.3,.5,.85);
    c.set('lookX',[[.1,0],[.29,-.4],[.48,-.15],[.64,.35],[.9,0]]);
    c.set('headTilt',[[.12,0],[.3,-.045],[.52,.02],[.91,0]]);
    c.nod(-3,.25,.48,.82);c.blink(.75,.81,.91);
  },
  firstSteps(c){
    c.look(-.35,.06,.2,.44);c.step('left',.18,.3,.43,17);c.step('right',.51,.64,.77,13);
    c.set('bodyX',[[.15,0],[.3,5],[.45,1],[.64,-5],[.88,0]]);
    c.wing('right',.32,.2,.17,.32,.48);c.wing('left',.36,.3,.48,.65,.83);
    c.set('headNod',[[.13,0],[.3,2],[.47,-2],[.66,2],[.9,0]]);c.ear('right',-.12,.72,.83,.97);
  },
  earsThenHello(c){
    c.ear('left',.16,.05,.17,.35);c.ear('right',-.16,.26,.4,.58);
    c.set('lookX',[[.08,-.15],[.21,-.5],[.37,.3],[.55,0],[.9,0]]);
    c.wing('right',.65,.35,.47,.65,.91);c.nod(-2,.51,.67,.88);
  },
  shyWave(c){
    c.hold('leftElbow',1.1,.09,.27,.58,.9);c.pulse('leftWing',.12,.09,.34,.87);
    c.set('rightWing',[[.14,0],[.33,.55],[.44,.35],[.57,.7],[.7,.35],[.92,0]]);
    c.set('rightElbow',[[.15,0],[.34,.35],[.58,.12],[.91,0]]);
    c.pulse('headTilt',-.045,.12,.38,.87);c.blink(.75,.81,.9);
  },
  tinyBow(c){c.nod(5,.13,.42,.84);c.wing('left',.1,1.05,.2,.45,.86);c.wing('right',.12,1.1,.25,.51,.9);c.ear('left',.09,.68,.81,.97);},
  toeHello(c){c.step('right',.1,.24,.38,12);c.wing('right',.48,.35,.32,.54,.87);c.look(.25,.28,.5,.83);c.nod(3,.6,.76,.94);},
  happyFeet(c){
    c.step('left',.06,.2,.34,20);c.step('right',.42,.56,.7,20);
    c.set('bodyX',[[.06,0],[.2,7],[.34,0],[.56,-7],[.74,0]]);
    c.wing('left',.85,.15,.13,.35,.59);c.wing('right',.96,.12,.37,.6,.87);
    c.set('headNod',[[.1,0],[.3,-3],[.5,1],[.7,-2],[.93,0]]);c.ear('left',.14,.73,.84,.98);
  },
  tinyClaps(c){
    c.hold('leftWing',.18,.07,.25,.7,.93);c.hold('rightWing',.2,.1,.28,.71,.94);
    c.set('leftElbow',[[.07,0],[.27,1.15],[.38,1.7],[.49,1.18],[.61,1.7],[.73,1.2],[.93,0]]);
    c.set('rightElbow',[[.1,0],[.28,1.12],[.38,1.65],[.49,1.12],[.61,1.65],[.73,1.18],[.94,0]]);
    c.nod(-3,.12,.37,.75);c.set('headTilt',[[.14,0],[.38,-.025],[.6,.025],[.91,0]]);c.blink(.78,.84,.94);
  },
  littleStar(c){
    c.set('leftWing',[[.06,0],[.25,.3],[.43,1.1],[.62,.9],[.91,0]]);
    c.set('rightWing',[[.1,0],[.29,.28],[.47,1.15],[.65,.85],[.94,0]]);
    c.pulse('leftElbow',-.13,.18,.46,.83);c.pulse('rightElbow',-.12,.22,.5,.87);
    c.nod(-4,.2,.46,.83);c.ear('left',.12,.7,.83,.98);c.ear('right',-.1,.74,.87,.99);
  },
  proudNod(c){c.set('headNod',[[.12,0],[.26,-3],[.42,0],[.61,4],[.88,0]]);c.wing('right',.42,.4,.34,.56,.87);c.pulse('headTilt',.035,.15,.4,.84);},
  reachPoint(c){c.look(-.45,.08,.27,.66);c.wing('left',.6,.45,.21,.46,.84);c.nod(3,.53,.7,.92);c.ear('right',-.12,.64,.78,.95);},
  smallCheer(c){c.wing('left',.62,.25,.1,.34,.68);c.wing('right',.72,.2,.26,.52,.88);c.nod(-2,.2,.4,.75);c.blink(.72,.79,.9);},
  doubleNod(c){c.set('headNod',[[.12,0],[.3,4],[.43,0],[.6,3],[.86,0]]);c.ear('left',.12,.61,.76,.94);c.wing('right',.2,.4,.47,.66,.92);},
  headPuzzle(c){c.set('headTilt',[[.1,0],[.29,-.06],[.48,-.03],[.68,.045],[.92,0]]);c.set('lookX',[[.09,-.1],[.3,-.4],[.52,.25],[.86,0]]);c.ear('left',.13,.11,.3,.59);c.blink(.7,.79,.91);},
  tinyThink(c){c.wing('right',.12,1.45,.13,.43,.87);c.nod(-2,.21,.45,.81);c.look(.25,.19,.42,.81);c.ear('left',.08,.65,.79,.95);},
  listening(c){c.ear('left',.15,.07,.24,.49);c.ear('right',-.12,.43,.6,.86);c.set('headTilt',[[.12,0],[.32,-.045],[.59,.04],[.93,0]]);c.set('lookX',[[.08,-.25],[.28,-.45],[.55,.4],[.87,0]]);},
  wingInspect(c){c.wing('left',.32,1.25,.12,.41,.85);c.look(-.5,.11,.36,.8);c.nod(4,.18,.4,.82);c.blink(.72,.8,.91);},
  glanceUp(c){c.nod(-4,.1,.39,.85);c.look(.32,.2,.46,.88);c.ear('left',.15,.08,.27,.56);c.wing('right',.22,.3,.56,.73,.94);},
  wingOffer(c){c.wing('left',.3,.72,.12,.39,.83);c.wing('right',.26,.66,.32,.58,.92);c.nod(3,.43,.64,.92);c.pulse('headTilt',-.025,.17,.4,.84);},
  slowNod(c){c.nod(3,.18,.54,.93);c.pulse('headTilt',.035,.09,.38,.91);c.blink(.58,.71,.89);},
  comfortFold(c){c.hold('leftWing',.09,.12,.34,.59,.91);c.hold('rightWing',.1,.2,.4,.65,.95);c.hold('leftElbow',1.2,.12,.34,.59,.91);c.hold('rightElbow',1.15,.2,.4,.65,.95);c.nod(3,.43,.64,.93);c.pulse('headTilt',.025,.13,.42,.89);},
};

const titles={peek:'A shy game of peekaboo',firstSteps:'Two little balancing steps',earsThenHello:'Ears up, hello there',shyWave:'One tiny wing wave',tinyBow:'A very small bow',toeHello:'A toe tap and hello',happyFeet:'Happy little footwork',tinyClaps:'Two excited wing claps',littleStar:'Look how big my wings are',proudNod:'A proud little nod',reachPoint:'I found something here',smallCheer:'A small wing cheer',doubleNod:'Yes, yes, I see it',headPuzzle:'A puzzled kitten tilt',tinyThink:'Thinking with one wing',listening:'Which ear heard that',wingInspect:'What is on this wing',glanceUp:'Something up there',wingOffer:'We can try together',slowNod:'Take one gentle step',comfortFold:'A quiet wing cuddle'};
const plan={
  signature:['peek','firstSteps','earsThenHello'],greeting:['shyWave','tinyBow','toeHello'],
  brilliant:['happyFeet','tinyClaps','littleStar'],celebrate:['smallCheer','happyFeet','proudNod'],
  great:['reachPoint','smallCheer','doubleNod'],think:['headPuzzle','tinyThink','listening'],
  curious:['wingInspect','glanceUp','headPuzzle'],approve:['proudNod','tinyBow','wingOffer'],
  encourage:['wingOffer','slowNod','comfortFold'],
};

const idleActions={
  hearLeft:c=>{c.ear('left',.14);c.look(-.28);},hearRight:c=>{c.ear('right',-.14);c.look(.28);},
  bothEars:c=>{c.ear('left',.13,.1,.3,.65);c.ear('right',-.12,.36,.58,.91);},
  puzzled:c=>c.set('headTilt',[[.1,0],[.35,-.045],[.62,.025],[.93,0]]),
  down:c=>{c.nod(3);c.pulse('lookX',-.12,.17,.44,.85);},up:c=>{c.nod(-2);c.pulse('lookX',.15,.13,.4,.83);},
  blink:c=>c.blink(.16,.42,.76),sleepy:c=>c.set('blink',[[.1,0],[.34,.6],[.47,1],[.6,.9],[.84,0]]),
  tuck:c=>{c.hold('leftElbow',.95,.1,.3,.61,.9);c.hold('rightElbow',.9,.15,.35,.64,.95);},
  leftFeather:c=>{c.wing('left',.22,.9);c.look(-.3);c.nod(2);},
  rightFeather:c=>{c.wing('right',.23,.85);c.look(.32);c.nod(2);},
  chin:c=>{c.wing('right',.09,1.25);c.nod(-1.5);c.pulse('headTilt',.03,.12,.4,.86);},
  chestFluff:c=>{c.nod(3);c.wing('left',.08,1.1);},
  nod:c=>c.nod(2.5),settle:c=>{c.wing('left',.14,.35);c.ear('right',-.07,.48,.67,.91);},
  across:c=>{c.set('lookX',[[.09,-.2],[.3,-.4],[.56,.3],[.91,0]]);c.set('headTilt',[[.13,0],[.34,-.025],[.6,.025],[.95,0]]);},
  stepLeft:c=>{c.step('left',.13,.36,.61,12);c.pulse('bodyX',4,.13,.36,.72);c.wing('right',.2,.2,.12,.35,.67);c.nod(2,.2,.42,.79);},
  stepRight:c=>{c.step('right',.25,.48,.73,11);c.pulse('bodyX',-4,.24,.48,.85);c.wing('left',.22,.15,.23,.47,.79);c.nod(2,.32,.56,.91);},
  toePeek:c=>{c.nod(3.5,.08,.25,.48);c.step('left',.4,.57,.74,9);c.look(-.23,.34,.54,.89);},
  twoSteps:c=>{c.step('left',.1,.23,.36,12);c.step('right',.5,.63,.76,10);c.set('bodyX',[[.1,0],[.23,4],[.37,0],[.63,-4],[.87,0]]);c.set('headNod',[[.12,0],[.27,2],[.46,0],[.66,2],[.91,0]]);},
  balance:c=>{c.step('right',.18,.39,.61,14);c.wing('left',.35,.1,.16,.4,.72);c.wing('right',.3,.13,.2,.43,.77);c.pulse('headTilt',.035,.22,.46,.85);},
  proudToes:c=>{c.step('left',.1,.26,.43,10);c.nod(-2,.38,.58,.86);c.ear('left',.12,.52,.71,.94);},
  sleepyStep:c=>{c.set('blink',[[.1,0],[.24,.85],[.42,0]]);c.step('right',.5,.66,.82,8);c.nod(2.5,.47,.68,.91);},
  resetFeet:c=>{c.step('left',.14,.29,.44,7);c.step('right',.54,.69,.84,7);c.set('headTilt',[[.14,0],[.34,-.025],[.7,.025],[.95,0]]);c.ear('right',-.09,.66,.81,.97);},
};

const pair=(label,a,b)=>({label,beats:[{action:a,start:.035,end:.63},{action:b,start:.39,end:.965}]});
const trio=(label,a,b,c)=>({label,beats:[{action:a,start:.025,end:.4},{action:b,start:.31,end:.69},{action:c,start:.6,end:.975}]});
const full=(label,action)=>({label,beats:[{action,start:.025,end:.975}]});
const idleRecipes=[
  pair('One ear hears a tiny sound','hearLeft','blink'),pair('The other ear has a turn','hearRight','puzzled'),
  pair('Where did that sound go','bothEars','across'),pair('A sleepy little pause','sleepy','nod'),
  pair('Check the little chest feathers','chestFluff','blink'),pair('What is on the left wing','leftFeather','puzzled'),
  pair('Check the other feathers','rightFeather','up'),pair('A little tuck before resting','tuck','sleepy'),
  pair('Something above the board','up','hearLeft'),pair('A curious look at the floor','down','hearRight'),
  pair('Listen, then look around','hearLeft','across'),pair('Both ears before a nod','bothEars','nod'),
  pair('One quiet thinking wing','chin','blink'),pair('Fluff neat, ears ready','chestFluff','bothEars'),
  pair('A puzzled look at the feathers','puzzled','leftFeather'),pair('Eyes open after a doze','sleepy','up'),
  pair('Put the wings back neatly','leftFeather','settle'),pair('Listen from the right side','hearRight','chin'),
  pair('One last glance below','down','tuck'),pair('A shy glance and blink','across','blink'),
  pair('Wings tucked, looking up','tuck','up'),pair('A small nod at a noise','nod','hearRight'),
  pair('A tiny chest feather to smooth','up','chestFluff'),pair('Feathers on both sides','leftFeather','rightFeather'),
  pair('A thinking pause then listen','chin','hearLeft'),pair('Let the little idea settle','puzzled','sleepy'),
  pair('A wing settles and an ear flicks','settle','bothEars'),pair('Look across, then down','across','down'),
  trio('Blink, listen, and a tiny nod','blink','hearLeft','nod'),trio('Chest fluff, wings, ready again','chestFluff','rightFeather','settle'),
  pair('Another sound while tucked in','tuck','hearRight'),pair('Sleepy eyes, curious ears','sleepy','bothEars'),
  full('One careful left step','stepLeft'),full('One careful right step','stepRight'),full('Look down and test a toe','toePeek'),
  full('Two feet find their places','twoSteps'),full('Wings help a little balance','balance'),full('A proud toe adjustment','proudToes'),
  full('A sleepy foot finds the ground','sleepyStep'),full('Settle both little feet','resetFeet'),
];
for(const entry of idleRecipes){for(const beat of entry.beats)Object.freeze(beat);Object.freeze(entry.beats);Object.freeze(entry);}
export const BABY_IDLE_REPERTOIRE=Object.freeze(idleRecipes);
export const BABY_IDLE_LABELS=Object.freeze(idleRecipes.map(entry=>entry.label));
export const BABY_ANIMATION_LABELS=Object.freeze({
  ...Object.fromEntries(Object.entries(plan).map(([kind,ids])=>[kind,Object.freeze(ids.map(id=>titles[id]))])),
  talk:Object.freeze(['A tiny idea to share','Let’s see this little move','One small step together']),idle:BABY_IDLE_LABELS,
});

function finish(pose){
  for(const[key,[low,high]]of Object.entries(LIMITS))pose[key]=clamp(Number.isFinite(pose[key])?pose[key]:0,low,high);
  return pose;
}

export function babyIdlePose(progress,variation=0){
  const pose=neutral();if(!Number.isFinite(progress)||progress<=0||progress>=1)return pose;
  const take=Number.isFinite(variation)?((Math.trunc(variation)%idleRecipes.length)+idleRecipes.length)%idleRecipes.length:0;
  for(const beat of idleRecipes[take].beats){
    if(progress<=beat.start||progress>=beat.end)continue;
    const local={},c=director(local,(progress-beat.start)/(beat.end-beat.start));idleActions[beat.action](c);
    for(const[key,value]of Object.entries(local))pose[key]=key==='blink'?Math.max(pose[key],value):pose[key]+value;
  }
  // Idle body language is smaller than a reaction, even where beats overlap.
  for(const[key,limit]of Object.entries({headTilt:.065,headNod:4,leftWing:.45,rightWing:.45,leftEar:.16,rightEar:.16}))pose[key]=clamp(pose[key],key.endsWith('Wing')?0:-limit,limit);
  return finish(pose);
}

export function babyReactionPose(kind,progress,variation=0,basePose={}){
  if(kind==='idle')return babyIdlePose(progress,variation);
  const pose=neutral();if(!Number.isFinite(progress)||progress<=0||progress>=1||!Object.hasOwn(BABY_ANIMATION_LABELS,kind))return pose;
  const take=Number.isFinite(variation)?((Math.trunc(variation)%3)+3)%3:0,c=director(pose,progress);
  if(kind==='talk'){
    pose.mouth=basePose?.mouth;pose.blink=basePose?.blink;
    if(take===0){c.wing('left',.14,.3,.13,.38,.81);c.nod(2,.35,.55,.85);}
    else if(take===1){c.ear('right',-.11,.1,.3,.56);c.pulse('headTilt',-.025,.16,.42,.86);c.wing('right',.18,.25,.39,.62,.91);}
    else{c.look(.2,.12,.32,.67);c.wing('left',.2,.4,.4,.65,.92);}
  }else actions[plan[kind][take]](c);
  return finish(pose);
}
