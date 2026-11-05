// The source drawing is cut into fixed-size pieces. Joints only translate and
// rotate those pieces: no mesh deformation or scaling is used by this rig.
const HEAD_BOUNDS = Object.freeze({ x: 390, y: 70, width: 480, height: 480 });
const BODY_BOUNDS = Object.freeze({ x: 350, y: 470, width: 570, height: 740 });
const LEFT_EAR_BOUNDS = Object.freeze({ x: 420, y: 95, width: 150, height: 205 });
const RIGHT_EAR_BOUNDS = Object.freeze({ x: 735, y: 105, width: 115, height: 205 });
const LEFT_FOOT_BOUNDS = Object.freeze({ x: 490, y: 1035, width: 150, height: 170 });
const RIGHT_FOOT_BOUNDS = Object.freeze({ x: 640, y: 1035, width: 150, height: 170 });
const finite = (value, low, high) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : 0));

const smooth = value => { const t = finite(value, 0, 1); return t * t * (3 - 2 * t); };
const chinBlend = x => Math.min(smooth((x - 480) / 28), smooth((776 - x) / 28));
function chinY(x) {
  const t = (322 - Math.sqrt(322 * 322 - 12 * (787 - x))) / 6;
  return 489 + 132 * t - 131 * t * t;
}

function headBoundary(context, overlap = 0) {
  context.beginPath();
  context.moveTo(350, 0); context.lineTo(920, 0); context.lineTo(920, 489);
  context.lineTo(787, 489);
  if (overlap) {
    for (let x = 785; x > 468; x -= 2) context.lineTo(x, chinY(x) - overlap * chinBlend(x));
    context.lineTo(468, 490);
  } else context.quadraticCurveTo(626, 555, 468, 490);
  context.lineTo(350, 490); context.closePath();
}

function softenChin(head) {
  const context = head.canvas.getContext('2d');
  context.save(); context.setTransform(1, 0, 0, 1, -head.x, -head.y);
  context.globalCompositeOperation = 'destination-out';
  // Only the cut through the interior cream fur fades. The original inked
  // cheeks and silhouette remain sharp, as do all other source pixels.
  for (let x = 480; x < 776; x++) {
    const bottom = chinY(x + .5), alpha = chinBlend(x + .5);
    const fade = context.createLinearGradient(0, bottom - 14, 0, bottom);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, `rgba(0,0,0,${alpha})`);
    context.fillStyle = fade; context.fillRect(x, bottom - 14, 1, 15);
  }
  context.restore();
}

function earBoundary(context, right) {
  context.beginPath();
  if (right) {
    // Keep hats and their brims with the head; the ear's outer triangle pivots.
    context.moveTo(752, 191); context.lineTo(799, 121);
    context.quadraticCurveTo(827, 109, 839, 145);
    context.quadraticCurveTo(848, 215, 815, 290);
    context.lineTo(761, 262); context.lineTo(739, 239);
  } else {
    context.moveTo(436, 129); context.quadraticCurveTo(438, 101, 461, 111);
    context.quadraticCurveTo(493, 130, 548, 204);
    context.lineTo(535, 230); context.lineTo(490, 261); context.lineTo(450, 287);
    context.quadraticCurveTo(427, 216, 436, 129);
  }
  context.closePath();
}

function sourceCanvas(source) {
  return source?.canvas || source;
}

function drawSource(context, source) {
  context.drawImage(sourceCanvas(source), source?.canvas ? source.x || 0 : 0, source?.canvas ? source.y || 0 : 0);
}

function sourceColor(artwork,x,y,width,height,fallback){
  const context=sourceCanvas(artwork).getContext('2d',{willReadFrequently:true});
  const pixels=context.getImageData(x,y,width,height).data,channels=[[],[],[]];
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>250&&pixels[i]+pixels[i+1]+pixels[i+2]>165){
    for(let c=0;c<3;c++)channels[c].push(pixels[i+c]);
  }
  if(!channels[0].length)return fallback;
  const color=channels.map(values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]);
  return `rgb(${color.join(',')})`;
}

function part(source, document, bounds, clip, erase) {
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width; canvas.height = bounds.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The coach artwork could not be prepared.');
  context.translate(-bounds.x, -bounds.y);
  if (clip) { context.save(); clip(context); context.clip(); }
  drawSource(context, source);
  if (clip) context.restore();
  if (erase) {
    context.globalCompositeOperation = 'destination-out';
    erase(context); context.fill();
  }
  return { canvas, x: bounds.x, y: bounds.y };
}

/**
 * Prepare the full artwork once. bodyWithoutWings can be a full-size canvas or
 * the existing cropped { canvas, x, y } body layer. The caller owns wing motion.
 */
export function createRigidParts(artwork, document = globalThis.document, bodyWithoutWings = artwork, coachId='meowl') {
  if (!artwork || !document?.createElement) throw new TypeError('Coach artwork and a document are required.');
  const head = part(artwork, document, HEAD_BOUNDS, headBoundary);
  softenChin(head);
  const headWithoutEars = part(head, document, HEAD_BOUNDS, null, context => {
    earBoundary(context, false); context.fill(); earBoundary(context, true);
  });
  // The untouched torso fur continues beneath the soft internal chin edge.
  // Baby's shorter torso needs extra fur behind the unchanged head fade.
  // Without this overlap the two fixed coordinate frames leave a faint chin
  // arc even at rest. The original six keep their approved boundary.
  const bodyBounds=coachId==='baby'?{x:350,y:430,width:570,height:780}:BODY_BOUNDS;
  const body = part(bodyWithoutWings, document, bodyBounds, null, context => headBoundary(context, coachId==='baby'?70:22));
  const torso = part(body, document, bodyBounds, null, context => {
    context.beginPath(); context.rect(0, 1083, 1254, 171);
  });
  return {
    head, headWithoutEars, body, torso,
    underlay:coachId==='evil'?{
      leftEar:sourceColor(artwork,472,245,20,20,'#66656c'),
      rightEar:sourceColor(artwork,786,254,20,20,'#66656c'),
      leftAnkle:sourceColor(artwork,566,1043,30,22,'#d4d5da'),
      rightAnkle:sourceColor(artwork,684,1043,30,22,'#d4d5da'),
    }:null,
    neck: part(artwork, document, { x: 481, y: 475, width: 293, height: 80 }),
    leftEar: part(artwork, document, LEFT_EAR_BOUNDS, context => earBoundary(context, false)),
    rightEar: part(artwork, document, RIGHT_EAR_BOUNDS, context => earBoundary(context, true)),
    // The calf overlaps the torso by 48 pixels. The torso is painted last so a
    // raised foot rotates behind its ankle, with no exposed straight cut edge.
    leftFoot: part(artwork, document, LEFT_FOOT_BOUNDS),
    rightFoot: part(artwork, document, RIGHT_FOOT_BOUNDS),
  };
}

function drawPart(context, image) {
  context.drawImage(image.canvas, image.x, image.y);
}

function joint(context, image, x, y, angle, shiftY = 0) {
  context.save();
  context.translate(x, y + shiftY); context.rotate(angle); context.translate(-x, -y);
  drawPart(context, image); context.restore();
}

function ankleUnderlay(context, x, color='#eee2c9') {
  context.save(); context.fillStyle = color;
  context.beginPath(); context.moveTo(x - 34, 1042); context.lineTo(x + 34, 1042);
  context.lineTo(x + 25, 1108); context.quadraticCurveTo(x, 1117, x - 25, 1108);
  context.closePath(); context.fill(); context.restore();
}

/** Draw the stationary torso and independently stepping feet in source coordinates. */
export function drawRigidBody(context, rig, pose = {}) {
  const leftFoot = finite(pose.leftFoot, -.3, .3), rightFoot = finite(pose.rightFoot, -.3, .3);
  const leftStep = finite(pose.leftStep, 0, 28), rightStep = finite(pose.rightStep, 0, 28);
  if (Math.abs(finite(pose.headTilt, -.1, .1)) > .0001 || Math.abs(finite(pose.headNod, -8, 8)) > .01) drawPart(context, rig.neck);
  if (Math.abs(leftFoot) < .0001 && Math.abs(rightFoot) < .0001 && leftStep < .01 && rightStep < .01) {
    drawPart(context, rig.body); return;
  }
  if (Math.abs(leftFoot) > .0001 || leftStep > .01) ankleUnderlay(context, 582,rig.underlay?.leftAnkle);
  if (Math.abs(rightFoot) > .0001 || rightStep > .01) ankleUnderlay(context, 697,rig.underlay?.rightAnkle);
  joint(context, rig.leftFoot, 582, 1085, leftFoot, -leftStep);
  joint(context, rig.rightFoot, 697, 1085, rightFoot, -rightStep);
  drawPart(context, rig.torso);
}

function earUnderlay(context, right, color='#c5a16c') {
  context.save(); context.fillStyle = color;
  context.beginPath();
  if (right) {
    context.moveTo(747, 232); context.lineTo(806, 253); context.lineTo(815, 292);
    context.quadraticCurveTo(780, 278, 747, 254);
  } else {
    context.moveTo(451, 261); context.lineTo(501, 235); context.lineTo(535, 238);
    context.quadraticCurveTo(495, 269, 451, 291);
  }
  context.closePath(); context.fill(); context.restore();
}

/** Draw the head without resizing it; facial features share its joint transform. */
export function drawRigidHead(context, rig, pose = {}, faceCallback) {
  const tilt = finite(pose.headTilt, -.1, .1), nod = finite(pose.headNod, -8, 8);
  const leftEar = finite(pose.leftEar, -.18, .18), rightEar = finite(pose.rightEar, -.18, .18);
  context.save();
  try {
    context.translate(626, 535 + nod); context.rotate(tilt); context.translate(-626, -535);
    if (Math.abs(leftEar) < .0001 && Math.abs(rightEar) < .0001) drawPart(context, rig.head);
    else {
      if (Math.abs(leftEar) > .0001) earUnderlay(context, false,rig.underlay?.leftEar);
      if (Math.abs(rightEar) > .0001) earUnderlay(context, true,rig.underlay?.rightEar);
      joint(context, rig.leftEar, 495, 250, leftEar);
      joint(context, rig.rightEar, 779, 256, rightEar);
      drawPart(context, rig.headWithoutEars);
    }
    if (typeof faceCallback === 'function') faceCallback(context);
  } finally { context.restore(); }
}
