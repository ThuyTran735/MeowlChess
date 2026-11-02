const LEFT_WING = [[350,580],[468,580],[488,648],[501,743],[500,840],[477,929],[467,958],[419,961],[350,880]];
const RIGHT_WING = [[777,578],[903,578],[912,918],[844,969],[819,953],[783,906],[759,836],[753,741],[761,668]];
// Professor Meowl's scarf rests over this shoulder and stays with the body.
const OWL_RIGHT_WING = [[791,578],[903,578],[912,918],[844,969],[819,953],[783,906],[759,836],[753,741],[781,693],[800,664],[800,622]];
const EYES = [{ x: 528, y: 345, rx: 49, ry: 42 }, { x: 706, y: 348, rx: 50, ry: 42 }];
export const COACH_REACTION_DURATIONS = Object.freeze({ talk: 1250, brilliant: 1800, celebrate: 1500, curious: 1600, greeting: 1600, idle: 900 });
const TRACKS = {
  talk: {
    mouth: [[0,0],[100,.75],[190,1],[280,0],[390,.6],[470,1],[580,0],[690,.8],[790,.3],[900,0],[1030,.65],[1140,0],[1250,0]],
    blink: [[0,0],[760,0],[810,1],[860,1],[920,0],[1250,0]],
    tilt: [[0,0],[210,-.012],[450,.01],[680,-.008],[1050,0],[1250,0]],
    leftWing: [[0,0],[190,.1],[430,.03],[680,.08],[980,0],[1250,0]],
  },
  brilliant: {
    mouth: [[0,0],[220,.45],[500,.8],[1000,.6],[1420,.3],[1640,0],[1800,0]],
    blink: [[0,0],[1050,0],[1110,1],[1190,0],[1800,0]],
    wing: [[0,0],[130,.08],[300,.38],[500,.62],[720,.25],[940,.5],[1150,.14],[1370,.23],[1600,0],[1800,0]],
    lift: [[0,0],[120,12],[250,0],[500,-55],[820,-28],[1060,0],[1800,0]],
    tilt: [[0,0],[300,-.018],[650,.014],[1050,0],[1800,0]],
  },
  celebrate: {
    mouth: [[0,0],[210,.6],[420,.8],[650,.25],[850,.55],[1120,0],[1500,0]],
    blink: [[0,0],[900,0],[960,1],[1020,0],[1500,0]],
    wing: [[0,0],[240,.3],[490,.2],[730,.36],[1050,0],[1500,0]],
    lift: [[0,0],[150,6],[410,-23],[730,0],[1500,0]],
    tilt: [[0,0],[300,-.016],[700,.012],[1080,0],[1500,0]],
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
};

/** A fixed, finite timeline for the original drawing's moving parts. */
export function coachPoseAt(kind, elapsed, coachId = 'meowl') {
  const personality = PERSONALITIES[coachId] || PERSONALITIES.meowl;
  const duration = COACH_REACTION_DURATIONS[kind] || COACH_REACTION_DURATIONS.talk;
  elapsed = Math.max(0,Math.min(1,Number.isFinite(elapsed) ? elapsed / duration : 1)) ** personality.pace * duration;
  const pose = {};
  for (const [name, points] of Object.entries(TRACKS[kind] || TRACKS.talk)) {
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
  return pose;
}

function polygon(context, points) {
  context.beginPath(); points.forEach(([x,y], index) => index ? context.lineTo(x,y) : context.moveTo(x,y)); context.closePath();
}

function layer(image, document, points, bounds, remove = false) {
  const canvas = document.createElement('canvas'); canvas.width = bounds.width; canvas.height = bounds.height;
  const context = canvas.getContext('2d');
  context.translate(-bounds.x,-bounds.y);
  if (remove) {
    context.drawImage(image, 0, 0); context.globalCompositeOperation = 'destination-out';
    for (const shape of points) { polygon(context,shape); context.fill(); }
  } else {
    polygon(context, points); context.clip(); context.drawImage(image, 0, 0);
  }
  return { canvas, x: bounds.x, y: bounds.y };
}

/** Separate the existing painted wings without changing the source artwork. */
export function createCoachPuppet(image, document = globalThis.document, coachId = 'meowl') {
  const rightWing = coachId === 'owl' ? OWL_RIGHT_WING : RIGHT_WING;
  return {
    image, width: image.naturalWidth, height: image.naturalHeight,
    body: layer(image,document,[LEFT_WING,rightWing],{x:350,y:90,width:570,height:1120},true),
    left: layer(image,document,LEFT_WING,{x:350,y:580,width:153,height:383}),
    right: layer(image,document,rightWing,{x:753,y:578,width:159,height:391}),
  };
}

function wingUnderlay(context) {
  context.fillStyle = '#c5a16c'; context.strokeStyle = '#4b3825'; context.lineWidth = 12;
  context.lineJoin = 'round';
  context.beginPath(); context.moveTo(470,580); context.bezierCurveTo(422,690,417,853,484,990);
  context.lineTo(529,1035); context.lineTo(506,779); context.lineTo(480,620); context.closePath(); context.fill(); context.stroke();
  context.beginPath(); context.moveTo(782,580); context.bezierCurveTo(844,700,845,852,804,987);
  context.lineTo(733,1066); context.lineTo(742,778); context.closePath(); context.fill(); context.stroke();
}

function drawWing(context, layer, x, y, angle) {
  context.save(); context.translate(x,y); context.rotate(angle); context.translate(-x,-y); context.drawImage(layer.canvas,layer.x,layer.y); context.restore();
}

function mouth(context, image, amount) {
  if (amount <= .02) return;
  context.save(); context.beginPath(); context.ellipse(605,456,34,21,0,0,Math.PI*2); context.clip();
  // Reuse clean fur from beside the nose so the brush texture stays consistent.
  context.drawImage(image,570,474,72,22,570,435,72,42); context.restore();
  const depth = 8 + amount * 22;
  context.strokeStyle = '#705239'; context.lineWidth = 5; context.lineCap = 'round';
  context.beginPath(); context.moveTo(605,433); context.lineTo(605,448); context.stroke();
  context.beginPath(); context.moveTo(588,448); context.quadraticCurveTo(605,453,622,448);
  context.bezierCurveTo(622,448+depth,588,448+depth,588,448); context.closePath();
  context.fillStyle = '#694331'; context.fill(); context.stroke();
  context.save(); context.clip(); context.beginPath(); context.ellipse(605,448+depth*.72,10,5,0,0,Math.PI*2);
  context.fillStyle = '#d79a88'; context.fill(); context.restore();
}

function blink(context, image, amount) {
  if (amount <= .02) return;
  for (const eye of EYES) {
    context.save(); context.beginPath(); context.ellipse(eye.x,eye.y,eye.rx,eye.ry,0,0,Math.PI*2); context.clip();
    context.drawImage(image,567,370,80,32,eye.x-eye.rx,eye.y-eye.ry,eye.rx*2,eye.ry*2);
    if (amount < .96) {
      const height=eye.ry*2*(1-amount);
      context.drawImage(image,eye.x-eye.rx,eye.y-eye.ry,eye.rx*2,eye.ry*2,eye.x-eye.rx,eye.y-height/2,eye.rx*2,height);
    } else {
      context.strokeStyle='#493a29'; context.lineWidth=6; context.lineCap='round';
      context.beginPath(); context.moveTo(eye.x-32,eye.y); context.quadraticCurveTo(eye.x,eye.y+14,eye.x+32,eye.y); context.stroke();
    }
    context.restore();
  }
}

/** Draw in original artwork coordinates; the caller controls canvas sizing. */
export function drawCoachPuppet(context, puppet, { mouth: opening = 0, blink: closed = 0, wing = 0, leftWing = wing, rightWing = wing, lift = 0, tilt = 0, breathe = 0 } = {}) {
  context.save(); context.translate(0,lift);
  if (tilt || breathe) {
    context.translate(626,1170); context.rotate(tilt); context.scale(1 + breathe * .003,1 + breathe * .003); context.translate(-626,-1170);
  }
  if (Math.abs(leftWing) < .001 && Math.abs(rightWing) < .001) context.drawImage(puppet.image,0,0);
  else {
    wingUnderlay(context); context.drawImage(puppet.body.canvas,puppet.body.x,puppet.body.y);
    drawWing(context,puppet.left,468,624,leftWing); drawWing(context,puppet.right,780,624,-rightWing);
  }
  mouth(context,puppet.image,opening); blink(context,puppet.image,closed); context.restore();
}
