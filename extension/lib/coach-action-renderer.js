import { createRigidParts, drawRigidBody, drawRigidHead } from './coach-rigid-parts.js';
import { drawCoachGlasses, drawCoachBook } from './coach-accessories.js';
import { resolveCoachWingPose, coachWingGrip, coachBookCarryOffset, coachMugCarryOffset } from './coach-wing-kinematics.js';
import { createCoachEyes, drawCoachEyes, drawCoachMouth } from './coach-eye-renderer.js';
import { createCoachBodyBacking } from './coach-body-backing.js';
import { drawCoachGarment } from './coach-garment-art.js';
import { drawCoachPitchfork, resolveEvilPitchforkPose } from './coach-pitchfork.js';
import { babyBodyFrame, babyHeadFrame, babyWingFrame, prepareBabyArtwork } from './coach-baby-art.js';

const LEFT_WING = [[350,580],[468,580],[488,648],[501,743],[500,840],[477,929],[467,958],[419,961],[350,880]];
const RIGHT_WING = [[777,578],[903,578],[912,918],[844,969],[819,953],[783,906],[759,836],[753,741],[761,668]];
const COLLAR_WING = [[791,578],[903,578],[912,918],[844,969],[819,953],[783,906],[759,836],[753,741],[781,693],[800,664],[800,622]];

function polygon(context, points) {
  if(points===COLLAR_WING){
    // Follow the collar with a curved interior cut so lifting the wing never
    // exposes the old square step beside the Professor's lapel or scarf.
    context.beginPath();context.moveTo(791,578);
    for(const [x,y]of points.slice(1,9))context.lineTo(x,y);
    context.quadraticCurveTo(783,700,794,672);
    context.bezierCurveTo(802,650,798,606,791,578);context.closePath();return;
  }
  context.beginPath(); points.forEach(([x,y],index)=>index?context.lineTo(x,y):context.moveTo(x,y));context.closePath();
}

function canvas(document, width, height) {
  const output=document.createElement('canvas');output.width=width;output.height=height;return output;
}

function wingParts(artwork, document, polygonPoints, bounds, elbow, gripLength=54) {
  const painted=canvas(document,bounds.width,bounds.height),context=painted.getContext('2d');
  context.translate(-bounds.x,-bounds.y);polygon(context,polygonPoints);context.clip();context.drawImage(artwork,0,0);
  const upper=canvas(document,bounds.width,bounds.height),lower=canvas(document,bounds.width,bounds.height),grip=canvas(document,bounds.width,bounds.height);
  const cut=elbow[1]-bounds.y;
  for(const [layer,above] of [[upper,true],[lower,false]]) {
    const mask=layer.getContext('2d');
    // Feather the interior overlap; the source image still supplies the exact
    // outer silhouette and its original inked feather tips.
    mask.filter='blur(2px)';
    mask.beginPath();
    mask.rect(0,above?0:cut,bounds.width,above?cut:bounds.height-cut);
    mask.ellipse(elbow[0]-bounds.x,cut,62,43,0,0,Math.PI*2);mask.fill();mask.filter='none';
    mask.globalCompositeOperation='source-in';mask.drawImage(painted,0,0);
  }
  const tip=grip.getContext('2d');
  tip.drawImage(painted,0,0);tip.globalCompositeOperation='destination-in';
  const gripMask=tip.createLinearGradient(0,bounds.height-gripLength,0,bounds.height-gripLength+6);
  gripMask.addColorStop(0,'transparent');gripMask.addColorStop(1,'#000');
  tip.fillStyle=gripMask;tip.fillRect(0,0,bounds.width,bounds.height);
  return { painted,upper,lower,grip,...bounds,elbow };
}

/** Cache fixed-size pieces of the approved drawing for rigid joint animation. */
export function createCoachPuppet(image, document=globalThis.document, coachId='meowl') {
  const artwork=canvas(document,image.naturalWidth,image.naturalHeight);artwork.getContext('2d').drawImage(image,0,0);
  if(coachId==='baby')prepareBabyArtwork(artwork);
  const rightOutline=['owl','mellow'].includes(coachId)?COLLAR_WING:RIGHT_WING;
  const front=canvas(document,artwork.width,artwork.height),source=front.getContext('2d');
  source.drawImage(artwork,0,0);source.globalCompositeOperation='destination-out';
  // Clear the clip's antialiased fringe as well; retained wing-edge pixels
  // would otherwise leave a faint dotted seam across the completed material.
  source.lineWidth=1;
  for(const outline of [LEFT_WING,rightOutline]) { polygon(source,outline);source.fill();source.stroke(); }
  const backing=createCoachBodyBacking(artwork,document,coachId);
  const torso=canvas(document,artwork.width,artwork.height),body=torso.getContext('2d');
  body.drawImage(backing,0,0);
  if(coachId!=='meowl'){
    drawCoachGarment(body,coachId);
    // Fabric follows the complete body, including its original soft exterior
    // edge. A wider coat stroke must not grow a new outline during a blink.
    body.globalCompositeOperation='destination-in';body.drawImage(artwork,0,0);
    body.globalCompositeOperation='source-over';
  }
  body.drawImage(front,0,0);
  const rigid=createRigidParts(artwork,document,torso,coachId);
  return {
    image:artwork,document,coachId,width:artwork.width,height:artwork.height,eyes:createCoachEyes(artwork,document,coachId),
    rigid,
    left:wingParts(artwork,document,LEFT_WING,{x:350,y:580,width:153,height:383},[455,785],coachId==='evil'?58:54),
    right:wingParts(artwork,document,rightOutline,{x:753,y:578,width:159,height:391},[809,785]),
  };
}

function drawWing(context, part, shoulder, angle=0, elbow=0) {
  context.save();context.translate(...shoulder);context.rotate(angle);context.translate(-shoulder[0],-shoulder[1]);
  if(Math.abs(elbow)<.001) context.drawImage(part.painted,part.x,part.y);
  else {
    // Upper feathers and tip rotate at two joints. Neither section is resized.
    context.save();context.translate(...part.elbow);context.rotate(elbow);context.translate(-part.elbow[0],-part.elbow[1]);
    context.drawImage(part.lower,part.x,part.y);context.restore();
    context.drawImage(part.upper,part.x,part.y);
  }
  context.restore();
}

function drawGrip(context,part,shoulder,angle,elbow,strength=0) {
  if(!(strength>.001))return;
  context.save();context.globalAlpha*=strength;
  context.translate(...shoulder);context.rotate(angle);context.translate(-shoulder[0],-shoulder[1]);
  context.translate(...part.elbow);context.rotate(elbow);context.translate(-part.elbow[0],-part.elbow[1]);
  context.drawImage(part.grip,part.x,part.y);context.restore();
}

function book(context,amount=0,page=0) {
  drawCoachBook(context,amount,page);
}

function feather(context,pose) {
  if(!(pose.feather>.01)) return;
  context.save();context.globalAlpha=pose.feather;context.translate(626+pose.featherX,pose.featherY);context.rotate(pose.featherAngle||0);
  context.fillStyle='#e8dfbd';context.strokeStyle='#74664d';context.lineWidth=4;context.lineCap='round';
  context.beginPath();context.moveTo(0,-53);context.bezierCurveTo(-39,-22,-29,15,0,39);
  context.bezierCurveTo(35,4,29,-34,0,-53);context.closePath();context.fill();context.stroke();
  context.beginPath();context.moveTo(0,-40);context.quadraticCurveTo(-5,11,2,52);context.stroke();
  context.lineWidth=2;
  for(const [y,spread] of [[-24,17],[-8,22],[9,18],[23,10]]) {
    context.beginPath();context.moveTo(-2,y+8);context.lineTo(-spread,y-3);context.moveTo(-2,y+8);context.lineTo(spread,y-3);context.stroke();
  }
  context.restore();
}

function drawMug(context,pose) {
  if(!(pose.mug>.01))return;
  context.save();context.globalAlpha=Math.min(1,pose.mug*8);context.translate(626,795-(pose.mugLift||0));
  context.lineJoin='round';context.lineCap='round';context.strokeStyle='#564455';context.lineWidth=6;
  context.beginPath();context.moveTo(58,-30);context.bezierCurveTo(111,-42,113,36,59,27);context.stroke();
  context.fillStyle='#aa8cae';context.beginPath();context.moveTo(-65,-43);context.lineTo(65,-43);
  context.lineTo(56,35);context.quadraticCurveTo(0,66,-56,35);context.closePath();context.fill();context.stroke();
  context.strokeStyle='#c9afd0';context.lineWidth=4;context.beginPath();context.moveTo(-51,-21);context.lineTo(-46,24);context.stroke();
  context.strokeStyle='#564455';context.lineWidth=6;
  context.fillStyle='#f3e3c4';context.beginPath();context.ellipse(0,-43,65,14,0,0,Math.PI*2);context.fill();context.stroke();
  context.fillStyle='#8d6248';context.beginPath();context.ellipse(0,-43,53,7,0,0,Math.PI*2);context.fill();
  context.fillStyle='#f3dfbd';context.beginPath();context.ellipse(0,13,18,14,0,0,Math.PI*2);context.fill();
  for(const [x,y]of[[-20,-6],[-7,-15],[9,-15],[23,-4]]){context.beginPath();context.ellipse(x,y,6,8,-x*.02,0,Math.PI*2);context.fill();}
  if(pose.steam>.01){
    context.globalAlpha*=pose.steam*.7;context.strokeStyle='#e7ded0';context.lineWidth=5;
    const drift=Math.sin((pose.steamPhase||0)*Math.PI*2)*9;
    for(const [x,offset]of[[-29,8],[0,-8],[29,2]]){
      context.beginPath();context.moveTo(x,-65);context.bezierCurveTo(x-16+drift,-90,x+15+drift,-104+offset,x+drift,-130+offset);context.stroke();
    }
  }
  context.restore();
}

function drawMagnifier(context,puppet,pose) {
  if(!(pose.magnifier>.01))return;
  const tip=coachWingGrip(pose,'right');
  context.save();context.globalAlpha=pose.magnifier;context.translate(...tip);context.rotate(pose.glassAngle||0);
  context.lineCap='round';context.strokeStyle='#493e2d';context.lineWidth=17;
  context.beginPath();context.moveTo(0,26);context.lineTo(0,-61);context.stroke();
  context.strokeStyle='#bd9862';context.lineWidth=9;context.stroke();
  context.fillStyle='rgba(187,220,204,.24)';context.strokeStyle='#493e2d';context.lineWidth=9;
  context.beginPath();context.arc(0,-110,49,0,Math.PI*2);context.fill();context.stroke();
  context.strokeStyle='#c3a66d';context.lineWidth=4;context.beginPath();context.arc(0,-110,43,0,Math.PI*2);context.stroke();
  context.strokeStyle='#eee7d0';context.lineWidth=6;context.beginPath();context.arc(-4,-112,31,Math.PI*1.1,Math.PI*1.55);context.stroke();
  context.restore();
}

function drawPennant(context,puppet,pose) {
  if(!(pose.pennant>.01))return;
  const tip=coachWingGrip(pose,'left'),flutter=(pose.flagFlutter||0)*35;
  context.save();context.globalAlpha=pose.pennant;context.translate(...tip);context.lineJoin='round';context.lineCap='round';
  context.strokeStyle='#614c32';context.lineWidth=8;context.beginPath();context.moveTo(0,38);context.lineTo(0,-207);context.stroke();
  context.fillStyle='#e0b66a';context.beginPath();context.arc(0,-211,9,0,Math.PI*2);context.fill();
  context.fillStyle='#38495f';context.strokeStyle='#d9b475';context.lineWidth=5;
  context.beginPath();context.moveTo(4,-199);context.quadraticCurveTo(58,-209+flutter,139,-175+flutter);
  context.lineTo(100,-137+flutter);context.lineTo(140,-100+flutter);context.quadraticCurveTo(64,-122+flutter,4,-105);context.closePath();context.fill();context.stroke();
  context.fillStyle='#efd9aa';context.beginPath();context.ellipse(54,-147+flutter*.3,15,12,0,0,Math.PI*2);context.fill();
  for(const [x,y]of[[37,-163],[50,-172],[63,-171],[74,-160]]){context.beginPath();context.ellipse(x,y+flutter*.3,5,6,0,0,Math.PI*2);context.fill();}
  context.restore();
}

/** A character acts by moving separate, fixed-proportion body parts. */
export function drawCoachPuppet(context,puppet,pose={}) {
  const originalPose=pose;
  pose=resolveCoachWingPose(pose,puppet.coachId);
  const moving=Object.values(pose).some(value=>Number.isFinite(value)&&Math.abs(value)>.0001);
  if(puppet.coachId==='baby') {
    // Use the same composition even at rest, so the static portrait, blinking,
    // talking and full-body actions share Baby's fixed juvenile proportions.
    context.save();context.translate(pose.bodyX||0,pose.lift||0);
    context.translate(626,1150);context.rotate(pose.tilt||0);context.translate(-626,-1150);
    context.save();babyBodyFrame(context);drawRigidBody(context,puppet.rigid,pose);context.restore();
    context.save();babyHeadFrame(context);
    drawRigidHead(context,puppet.rigid,pose,()=>{
      drawCoachEyes(context,puppet.eyes,pose.blink,pose.lookX,pose.lookY);
      drawCoachMouth(context,puppet.eyes,pose.mouth);
    });
    context.restore();
    context.save();babyWingFrame(context,'left');
    drawWing(context,puppet.left,[468,624],pose.leftWing||0,-(pose.leftElbow||0));
    context.restore();context.save();babyWingFrame(context,'right');
    drawWing(context,puppet.right,[780,624],-(pose.rightWing||0),pose.rightElbow||0);
    context.restore();context.restore();return;
  }
  if(puppet.coachId==='evil')pose=resolveEvilPitchforkPose(pose);
  // The permanently held staff shares the same layered rest/action drawing.
  // Avoid painting a second copy of the wing's antialiased edge at rest.
  if(!moving&&puppet.coachId!=='evil') {
    context.drawImage(puppet.image,0,0);
    drawCoachEyes(context,puppet.eyes,0,0,0);drawCoachMouth(context,puppet.eyes,0);
    if(puppet.coachId==='owl')drawCoachGlasses(context,0);return;
  }
  context.save();context.translate(pose.bodyX||0,pose.lift||0);
  context.translate(626,1150);context.rotate(pose.tilt||0);context.translate(-626,-1150);
  drawRigidBody(context,puppet.rigid,pose);
  drawRigidHead(context,puppet.rigid,pose,()=>{
    drawCoachEyes(context,puppet.eyes,pose.blink,pose.lookX,pose.lookY);drawCoachMouth(context,puppet.eyes,pose.mouth);
    if(puppet.coachId==='owl')drawCoachGlasses(context,pose.glasses||0);
  });
  drawWing(context,puppet.left,[468,624],pose.leftWing??pose.wing??0,-(pose.leftElbow||0));
  drawWing(context,puppet.right,[780,624],-(pose.rightWing??pose.wing??0),pose.rightElbow||0);
  if(puppet.coachId==='evil')drawCoachPitchfork(context,pose);
  if(puppet.coachId==='owl'){
    context.save();context.translate(...coachBookCarryOffset(originalPose,pose));
    book(context,pose.book,pose.pageTurn);context.restore();
  }
  if(puppet.coachId==='mellow'){
    context.save();context.translate(...coachMugCarryOffset(originalPose,pose));
    drawMug(context,pose);context.restore();
  }
  if(puppet.coachId==='scout')drawMagnifier(context,puppet,pose);
  if(puppet.coachId==='paws')drawPennant(context,puppet,pose);
  drawGrip(context,puppet.left,[468,624],pose.leftWing||0,-(pose.leftElbow||0),pose.leftGrip);
  drawGrip(context,puppet.right,[780,624],-(pose.rightWing||0),pose.rightElbow||0,pose.rightGrip);
  context.restore();feather(context,pose);
}
