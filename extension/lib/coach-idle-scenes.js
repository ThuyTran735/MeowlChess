// Full-body idle scenes use rigid joints. Feet, gaze, and balance share a timeline.
const step=(c,side,start,peak,end,height=12,angle=.12)=>{
  c.pulse(`${side}Step`,height,start,peak,end);
  c.pulse(`${side}Foot`,side==='left'?-angle:angle,start,peak,end);
};
const tracks=(c,values)=>{for(const [key,points]of Object.entries(values))c.set(key,points);};

export const COACH_FULL_BODY_IDLES={
  meowl:[
    ['Is that my own foot?',c=>{
      step(c,'left',.18,.38,.64,16,.17);
      tracks(c,{bodyX:[[.12,0],[.3,11],[.58,11],[.84,0]],headNod:[[.1,0],[.33,4],[.61,3],[.89,0]],lookX:[[.16,0],[.35,-.55],[.62,-.4],[.91,0]],rightWing:[[.16,0],[.37,.32],[.65,.15],[.92,0]]});
      c.ear('left',.12);
    }],
    ['One feather, two careful tiptoes',c=>{
      c.feather('drift');step(c,'left',.13,.25,.39,11);step(c,'right',.5,.65,.8,13);
      tracks(c,{bodyX:[[.1,0],[.27,8],[.45,0],[.66,-9],[.91,0]],leftWing:[[.13,0],[.35,.28],[.72,.12],[.94,0]],rightWing:[[.12,0],[.34,.15],[.67,.3],[.93,0]]});
    }],
    ['A very important fluff inspection',c=>{
      tracks(c,{headNod:[[.08,0],[.26,4],[.63,4],[.9,0]],lookX:[[.1,0],[.28,-.45],[.55,.4],[.84,0]],leftElbow:[[.12,0],[.3,1.3],[.45,.8],[.6,0]],rightElbow:[[.38,0],[.59,1.3],[.73,.75],[.91,0]],leftWing:[[.12,0],[.3,.16],[.62,0]],rightWing:[[.38,0],[.59,.18],[.91,0]],rightFoot:[[.22,0],[.5,.13],[.84,0]]});
    }],
    ['Almost a bow, actually a peek',c=>{
      tracks(c,{tilt:[[.09,0],[.33,-.018],[.58,-.012],[.9,0]],bodyX:[[.09,0],[.34,-13],[.65,-8],[.91,0]],headTilt:[[.16,0],[.42,.055],[.71,.02],[.94,0]],headNod:[[.12,0],[.3,3],[.56,-2],[.9,0]],lookX:[[.12,0],[.35,.45],[.76,.55],[.94,0]],leftWing:[[.15,0],[.39,.25],[.73,.12],[.94,0]]});
    }],
    ['Catch it—oh, it floated away',c=>{
      c.feather('hover');step(c,'right',.22,.44,.67,15,.16);
      tracks(c,{bodyX:[[.12,0],[.34,-11],[.58,-8],[.88,0]],leftWing:[[.12,0],[.35,.43],[.56,.2],[.86,0]],leftElbow:[[.14,0],[.39,-.35],[.62,.65],[.9,0]],headTilt:[[.14,0],[.38,-.055],[.62,.035],[.93,0]]});
    }],
    ['A tiny shuffle and a proud look',c=>{
      step(c,'right',.1,.22,.36,12,.16);step(c,'left',.43,.57,.72,14,.15);
      tracks(c,{bodyX:[[.08,0],[.24,-9],[.4,0],[.58,9],[.81,0]],leftWing:[[.1,0],[.3,.25],[.59,.17],[.88,0]],rightWing:[[.14,0],[.35,.16],[.63,.27],[.9,0]],headNod:[[.1,0],[.27,2],[.55,1],[.77,-3],[.95,0]]});
    }],
    ['Listen, lean, then change my mind',c=>{
      tracks(c,{leftEar:[[.08,0],[.21,.15],[.4,0]],rightEar:[[.4,0],[.57,-.15],[.84,0]],bodyX:[[.16,0],[.36,-13],[.53,0],[.7,11],[.94,0]],headTilt:[[.14,0],[.34,-.06],[.52,0],[.72,.05],[.95,0]],lookX:[[.1,0],[.27,-.6],[.5,0],[.67,.6],[.91,0]]});
      step(c,'right',.25,.38,.49,8,.1);step(c,'left',.6,.73,.86,9,.1);
    }],
    ['Both toes deserve a second look',c=>{
      step(c,'left',.16,.3,.44,13,.16);step(c,'right',.52,.66,.8,13,.16);
      tracks(c,{headNod:[[.1,0],[.28,4],[.72,4],[.94,0]],lookX:[[.12,0],[.28,-.5],[.45,0],[.65,.5],[.91,0]],bodyX:[[.11,0],[.29,8],[.46,0],[.65,-8],[.9,0]],leftWing:[[.12,0],[.3,.2],[.48,0]],rightWing:[[.48,0],[.67,.2],[.9,0]]});
    }],
  ],
  owl:[
    ['A footnote worth leaning into',c=>{
      c.book('read');c.hold('bodyX',-10,.15,.34,.65,.9);c.pulse('headTilt',-.045,.18,.46,.86);
      c.set('leftFoot',[[.1,0],[.3,-.14],[.7,-.14],[.92,0]]);
    }],
    ['Turn the page, settle the stance',c=>{
      c.book('page');step(c,'right',.65,.76,.88,10,.1);
      c.set('bodyX',[[.13,0],[.34,5],[.59,5],[.76,-7],[.94,0]]);c.pulse('glasses',.5,.19,.4,.65);
    }],
    ['A scholar’s small bow',c=>{
      tracks(c,{headNod:[[.12,0],[.4,4],[.58,4],[.88,0]],tilt:[[.13,0],[.4,.016],[.59,.016],[.9,0]],leftWing:[[.12,0],[.35,.12],[.7,.12],[.92,0]],leftElbow:[[.12,0],[.35,1.4],[.66,1.4],[.91,0]],rightFoot:[[.13,0],[.36,.14],[.68,.14],[.92,0]],lookX:[[.17,0],[.45,-.2],[.85,0]]});
    }],
    ['Two pages, one puzzled professor',c=>{
      c.book('compare');c.set('headTilt',[[.1,0],[.33,-.05],[.51,0],[.71,.045],[.94,0]]);
      c.set('bodyX',[[.12,0],[.34,-8],[.53,0],[.73,8],[.95,0]]);c.pulse('leftEar',.12,.47,.66,.86);
    }],
    ['Straighten the waistcoat hem',c=>{
      c.wing('left',.14,1.7);c.wing('right',.14,1.7);c.nod(4);
      tracks(c,{lift:[[.1,0],[.35,-5],[.6,-5],[.9,0]],leftFoot:[[.12,0],[.36,-.13],[.68,-.13],[.93,0]],rightFoot:[[.12,0],[.36,.13],[.68,.13],[.93,0]]});
    }],
    ['Remember it, check the reference',c=>{
      c.book('peek');c.set('headNod',[[.08,0],[.22,-3],[.39,0],[.56,4],[.78,2],[.94,0]]);
      c.set('lookX',[[.12,0],[.25,.45],[.48,-.3],[.7,.2],[.92,0]]);step(c,'left',.73,.83,.94,8,.1);
    }],
    ['A patient professor’s heel turn',c=>{
      tracks(c,{bodyX:[[.1,0],[.36,12],[.66,12],[.92,0]],tilt:[[.13,0],[.4,-.015],[.71,-.015],[.95,0]],leftFoot:[[.16,0],[.43,-.17],[.7,-.17],[.94,0]],headTilt:[[.22,0],[.52,.05],[.88,0]],rightElbow:[[.14,0],[.37,1.3],[.72,1.3],[.94,0]],rightWing:[[.14,0],[.37,.1],[.72,.1],[.94,0]]});
      c.pulse('glasses',.6,.35,.58,.82);
    }],
    ['Put the book away and stretch the toes',c=>{
      c.book('close');step(c,'left',.63,.74,.84,11,.17);step(c,'right',.84,.9,.97,9,.13);
      c.set('headNod',[[.15,0],[.34,3],[.56,1],[.8,-2],[.96,0]]);
    }],
  ],
  paws:[
    ['A very quiet captain’s march',c=>{
      step(c,'left',.12,.25,.4,16,.12);step(c,'right',.49,.63,.79,16,.12);
      tracks(c,{bodyX:[[.09,0],[.25,7],[.42,0],[.63,-7],[.87,0]],rightWing:[[.11,0],[.27,.31],[.44,0]],leftWing:[[.47,0],[.65,.31],[.86,0]],headNod:[[.13,0],[.32,-2],[.71,-2],[.93,0]]});
    }],
    ['Check the boots before the briefing',c=>{
      c.nod(4);step(c,'left',.18,.33,.47,11,.18);step(c,'right',.52,.67,.82,11,.18);
      c.set('lookX',[[.14,0],[.32,-.45],[.48,0],[.67,.45],[.9,0]]);c.set('rightElbow',[[.18,0],[.4,1.1],[.7,1.1],[.94,0]]);
    }],
    ['Plant the pennant, steady the deck',c=>{
      c.pennant('breeze');c.hold('bodyX',9,.14,.35,.66,.91);c.hold('rightFoot',.17,.14,.32,.73,.93);
      c.set('headTilt',[[.19,0],[.43,-.04],[.73,.02],[.95,0]]);
    }],
    ['At attention, then stand easy',c=>{
      tracks(c,{lift:[[.1,0],[.31,-7],[.55,-7],[.79,2],[.95,0]],leftFoot:[[.08,0],[.26,.06],[.55,.06],[.8,-.16],[.96,0]],rightFoot:[[.08,0],[.26,-.06],[.55,-.06],[.8,.16],[.96,0]],headNod:[[.12,0],[.34,-3],[.6,-3],[.86,0]],leftElbow:[[.62,0],[.8,.55],[.97,0]],rightElbow:[[.62,0],[.8,.55],[.97,0]]});
    }],
    ['Lean to see around the mast',c=>{
      c.hold('bodyX',-14,.1,.33,.64,.92);c.hold('tilt',-.018,.13,.38,.65,.94);c.hold('lookX',-.7,.14,.34,.7,.94);
      c.pulse('headTilt',.05,.23,.51,.89);step(c,'right',.24,.46,.69,13,.12);c.wing('right',.28,.15);
    }],
    ['A measured salute and heel click',c=>{
      c.wing('right',.25,1.85);c.nod(-3);c.pulse('leftFoot',.1,.17,.34,.56);c.pulse('rightFoot',-.1,.17,.34,.56);
      c.pulse('lift',-5,.16,.35,.64);step(c,'right',.72,.81,.91,9,.1);
    }],
    ['Follow a breeze without losing the flag',c=>{
      c.pennant('breeze');c.set('bodyX',[[.13,0],[.34,10],[.55,5],[.75,-6],[.94,0]]);
      c.set('rightWing',[[.17,0],[.42,.36],[.7,.23],[.93,0]]);c.set('headTilt',[[.16,0],[.39,-.05],[.68,.025],[.92,0]]);step(c,'right',.32,.48,.66,10,.15);
    }],
    ['One last inspection of the uniform',c=>{
      c.set('headNod',[[.1,0],[.28,4],[.63,3],[.82,-2],[.96,0]]);c.set('lookX',[[.1,0],[.28,-.35],[.55,.35],[.83,0]]);
      c.pulse('leftElbow',1.5,.12,.32,.52);c.pulse('rightElbow',1.5,.45,.64,.85);step(c,'left',.7,.82,.94,11,.14);
    }],
  ],
  mellow:[
    ['Warm cup, warmer toes',c=>{
      c.cup('warm');c.pulse('leftFoot',-.16,.19,.43,.72);c.pulse('rightFoot',.16,.28,.52,.81);c.pulse('headTilt',.04,.3,.56,.88);
    }],
    ['Find the comfiest standing spot',c=>{
      step(c,'left',.13,.27,.42,8,.1);step(c,'right',.52,.67,.82,8,.1);
      tracks(c,{bodyX:[[.1,0],[.29,9],[.47,0],[.68,-9],[.94,0]],headTilt:[[.12,0],[.32,-.04],[.54,.01],[.74,.04],[.96,0]],leftElbow:[[.16,0],[.43,.8],[.74,.8],[.95,0]],rightElbow:[[.19,0],[.46,.8],[.77,.8],[.97,0]]});
    }],
    ['A slow scarf-and-shoulder stretch',c=>{
      c.hold('leftWing',.4,.1,.34,.58,.91);c.hold('leftElbow',-.35,.13,.37,.63,.94);
      c.hold('bodyX',9,.16,.4,.61,.94);c.pulse('headTilt',-.055,.18,.48,.92);c.pulse('rightFoot',.14,.2,.5,.91);c.pulse('headNod',-3,.23,.49,.88);
    }],
    ['Steam rises, nose follows',c=>{
      c.cup('steam');c.set('headNod',[[.13,0],[.3,2],[.53,-4],[.72,-3],[.94,0]]);c.pulse('lift',-6,.32,.56,.84);
      c.set('leftEar',[[.4,0],[.62,.1],[.88,0]]);c.set('rightEar',[[.45,0],[.66,-.08],[.93,0]]);
    }],
    ['Offer a sip with a little bow',c=>{
      c.cup('offer');c.pulse('tilt',.016,.23,.5,.82);c.pulse('headNod',4,.24,.52,.85);c.hold('rightFoot',.13,.14,.32,.7,.94);
    }],
    ['Tuck the cardigan, wiggle a toe',c=>{
      tracks(c,{leftElbow:[[.12,0],[.35,1.5],[.65,1.5],[.91,0]],rightElbow:[[.15,0],[.38,1.5],[.68,1.5],[.94,0]],headNod:[[.16,0],[.42,3],[.76,1],[.95,0]],leftFoot:[[.25,0],[.43,-.15],[.55,-.03],[.7,-.12],[.91,0]],bodyX:[[.18,0],[.45,8],[.72,8],[.95,0]]});
    }],
    ['A tiny stretch before the next sip',c=>{
      c.hold('leftWing',.32,.09,.3,.51,.88);c.hold('rightWing',.32,.11,.32,.53,.9);
      c.pulse('lift',-8,.13,.39,.8);c.pulse('headNod',-4,.16,.44,.83);c.pulse('leftFoot',-.12,.21,.45,.84);c.pulse('rightFoot',.12,.21,.45,.84);
    }],
    ['Cup down, settle in gently',c=>{
      c.cup('lower');step(c,'right',.71,.8,.91,8,.1);c.set('bodyX',[[.14,0],[.36,-5],[.62,-5],[.8,-9],[.96,0]]);
      c.set('headTilt',[[.15,0],[.42,.025],[.76,.055],[.96,0]]);c.pulse('leftEar',.075,.67,.81,.95);
    }],
  ],
  scout:[
    ['A footprint right under my foot',c=>{
      c.lens('low');step(c,'left',.2,.4,.64,16,.17);c.hold('bodyX',11,.14,.33,.61,.9);c.pulse('headNod',4,.2,.48,.89);
    }],
    ['Tiptoe past the imaginary clue',c=>{
      step(c,'right',.12,.27,.42,15,.17);step(c,'left',.5,.66,.82,15,.17);
      tracks(c,{bodyX:[[.09,0],[.27,-10],[.45,0],[.66,10],[.93,0]],headNod:[[.12,0],[.34,3],[.7,3],[.94,0]],lookX:[[.11,0],[.3,.5],[.54,-.3],[.75,-.55],[.95,0]],leftWing:[[.13,0],[.35,.32],[.68,.17],[.93,0]],rightWing:[[.15,0],[.38,.16],[.72,.34],[.95,0]]});
    }],
    ['Check the lens from a different angle',c=>{
      c.lens('angle');c.set('bodyX',[[.13,0],[.36,-11],[.56,0],[.76,9],[.95,0]]);c.set('headTilt',[[.2,0],[.42,-.06],[.68,.045],[.93,0]]);c.hold('leftFoot',-.15,.15,.34,.71,.94);
    }],
    ['The satchel is heavier on this side',c=>{
      c.hold('rightElbow',1.5,.13,.34,.63,.91);c.hold('rightWing',.14,.13,.34,.63,.91);c.pulse('bodyX',-12,.18,.45,.89);
      c.pulse('headNod',4,.19,.46,.9);c.pulse('lookX',.55,.2,.49,.91);step(c,'right',.37,.55,.73,12,.16);
    }],
    ['Peek around an invisible corner',c=>{
      c.hold('bodyX',14,.12,.36,.66,.92);c.hold('tilt',.018,.16,.42,.67,.94);c.hold('lookX',.75,.13,.35,.74,.95);
      c.pulse('leftEar',.15,.3,.52,.81);c.pulse('headTilt',-.05,.25,.51,.9);step(c,'left',.26,.47,.7,14,.12);c.wing('left',.28,.2);
    }],
    ['A moving clue, tracked very carefully',c=>{
      c.lens('trace');c.set('bodyX',[[.12,0],[.32,-6],[.55,10],[.76,6],[.94,0]]);c.set('headNod',[[.15,0],[.35,3],[.62,-2],[.9,0]]);
      step(c,'right',.53,.69,.83,10,.12);c.pulse('leftWing',.27,.3,.55,.84);
    }],
    ['One ear hears it before the other',c=>{
      tracks(c,{leftEar:[[.08,0],[.22,.16],[.4,0]],rightEar:[[.42,0],[.6,-.16],[.84,0]],headTilt:[[.13,0],[.32,-.055],[.49,0],[.69,.06],[.94,0]],bodyX:[[.16,0],[.34,-9],[.53,0],[.72,9],[.95,0]],lookX:[[.11,0],[.29,-.6],[.48,0],[.66,.65],[.92,0]]});
      step(c,'left',.56,.72,.85,11,.14);
    }],
    ['Mark the spot with one careful toe',c=>{
      step(c,'right',.19,.4,.66,14,.18);c.pulse('bodyX',-12,.14,.39,.76);c.pulse('headNod',4,.17,.42,.8);c.pulse('lookX',.55,.19,.45,.82);
      c.set('rightWing',[[.17,0],[.4,.34],[.61,.2],[.9,0]]);c.set('rightElbow',[[.2,0],[.43,.45],[.69,.8],[.93,0]]);c.pulse('headTilt',.045,.54,.74,.94);
    }],
  ],
  evil:[
    ['A sinister little side-step',c=>{
      c.set('lookX',[[.1,0],[.26,.65],[.72,.65],[.94,0]]);step(c,'left',.22,.38,.53,13,.16);step(c,'right',.61,.76,.9,11,.13);
      c.set('bodyX',[[.14,0],[.39,11],[.56,4],[.76,-7],[.96,0]]);c.hold('rightElbow',1.2,.12,.32,.7,.94);
    }],
    ['Check the pitchfork, admire the plan',c=>{
      c.set('headNod',[[.1,0],[.28,-4],[.52,2],[.77,-2],[.95,0]]);c.set('lookX',[[.1,0],[.3,-.65],[.55,-.4],[.8,.25],[.96,0]]);
      c.pulse('bodyX',-10,.15,.41,.81);c.pulse('rightFoot',.16,.18,.44,.83);c.pulse('rightElbow',1.35,.51,.72,.93);
    }],
    ['An unnecessarily formal villain bow',c=>{
      c.hold('rightElbow',1.6,.1,.3,.65,.93);c.hold('rightWing',.13,.1,.3,.65,.93);c.pulse('headNod',4,.18,.46,.88);
      c.pulse('tilt',.018,.17,.44,.89);c.hold('rightFoot',.17,.12,.32,.7,.94);c.pulse('lookX',-.3,.26,.52,.85);
    }],
    ['Sweep the tunic, plant the feet',c=>{
      c.set('rightElbow',[[.1,0],[.31,1.55],[.53,.6],[.77,.2],[.95,0]]);c.set('rightWing',[[.1,0],[.31,.12],[.56,.42],[.81,.17],[.96,0]]);
      c.pulse('headNod',3,.16,.4,.75);step(c,'right',.57,.73,.88,12,.17);c.set('bodyX',[[.17,0],[.4,-6],[.71,-12],[.96,0]]);
    }],
    ['Nobody saw that little stumble',c=>{
      step(c,'right',.18,.32,.46,15,.18);c.set('bodyX',[[.13,0],[.33,-12],[.51,6],[.75,3],[.95,0]]);
      c.set('tilt',[[.16,0],[.35,-.018],[.52,.012],[.78,0]]);c.set('rightWing',[[.17,0],[.35,.44],[.55,.27],[.87,0]]);
      c.set('headTilt',[[.17,0],[.37,.055],[.56,-.04],[.83,0]]);c.set('lookX',[[.3,0],[.52,.65],[.7,-.55],[.93,0]]);
    }],
    ['Listen for the unsuspecting opponent',c=>{
      c.hold('bodyX',12,.14,.38,.68,.93);c.hold('headTilt',-.06,.17,.42,.7,.95);c.hold('lookX',.65,.16,.39,.73,.96);
      c.pulse('rightEar',-.16,.27,.5,.79);step(c,'left',.24,.45,.68,12,.13);c.hold('rightElbow',.8,.2,.45,.69,.94);
    }],
    ['Count the plan on feather tips',c=>{
      c.hold('rightWing',.25,.12,.31,.72,.95);c.set('rightElbow',[[.12,0],[.32,.8],[.43,1.4],[.55,.85],[.68,1.5],[.84,.8],[.97,0]]);
      c.hold('lookX',.45,.18,.35,.74,.95);c.pulse('headNod',3,.2,.49,.85);c.set('rightFoot',[[.18,0],[.37,.15],[.51,.04],[.68,.13],[.93,0]]);
    }],
    ['The dramatic reveal was only a button',c=>{
      c.set('rightElbow',[[.1,0],[.28,1.6],[.48,1.6],[.67,.25],[.9,0]]);c.set('rightWing',[[.1,0],[.28,.1],[.47,.12],[.68,.44],[.92,0]]);
      c.set('headNod',[[.12,0],[.31,4],[.54,3],[.75,-3],[.95,0]]);c.pulse('bodyX',-10,.28,.61,.91);c.pulse('rightFoot',.17,.37,.66,.93);c.pulse('rightEar',-.11,.63,.8,.96);
    }],
  ],
};
