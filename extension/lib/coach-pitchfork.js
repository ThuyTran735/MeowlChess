import { COACH_WING_GEOMETRY } from './coach-wing-kinematics.js';

const finite=(value,low,high)=>Math.max(low,Math.min(high,Number.isFinite(value)?value:0));
export const EVIL_PITCHFORK_REST=Object.freeze({leftWing:.18,leftElbow:-1.55});
export const EVIL_PITCHFORK_GRIP=Object.freeze([450,925]);

// One shared drawing supplies both the static portrait and its held prop.
// Coordinates are local to the opaque feather grip; that anchor never drifts.
const PARTS=Object.freeze([
  {d:'M-7 310 L-7 -331 Q-7 -341 0 -341 Q7 -341 7 -331 L7 310 Q0 319 -7 310 Z',fill:'#744146',stroke:'#2c252c',width:7},
  {d:'M-44 -399 L-35 -360 Q-33 -346 -9 -343 L-9 -391 L0 -420 L9 -391 L9 -343 Q33 -346 35 -360 L44 -399 L53 -367 Q56 -335 15 -326 L15 -309 L-15 -309 L-15 -326 Q-56 -335 -53 -367 Z',fill:'#b55a56',stroke:'#2c252c',width:7},
  {d:'M-2 -380 L-2 -345 M-37 -363 Q-33 -351 -19 -348 M37 -363 Q33 -351 19 -348',stroke:'#e3a19a',width:4},
  {d:'M-10 -311 L10 -311 L10 -293 L-10 -293 Z',fill:'#b79a6d',stroke:'#2c252c',width:5},
  {d:'M-7 290 L7 290 L7 308 L-7 308 Z',fill:'#b79a6d',stroke:'#2c252c',width:4},
]);

/** A bent carrying wing crosses the shaft; the free wing keeps the full action. */
export function resolveEvilPitchforkPose(source={}){
  const pose=source&&typeof source==='object'?{...source}:{};
  pose.leftWing=EVIL_PITCHFORK_REST.leftWing+finite(pose.leftWing??pose.wing,0,1.35)*.045;
  pose.leftElbow=EVIL_PITCHFORK_REST.leftElbow+finite(pose.leftElbow,-2.2,2.2)*.025;
  pose.leftGrip=1;
  return pose;
}

/** A restrained carrying angle keeps the tines outside the face silhouette. */
export function coachPitchforkTransform(pose=EVIL_PITCHFORK_REST){
  const {shoulder,elbow}=COACH_WING_GEOMETRY.left;
  const bend=-finite(pose.leftElbow,-2.2,2.2),wing=finite(pose.leftWing,0,1.35);
  const dx=EVIL_PITCHFORK_GRIP[0]-elbow[0],dy=EVIL_PITCHFORK_GRIP[1]-elbow[1];
  const x=elbow[0]+dx*Math.cos(bend)-dy*Math.sin(bend)-shoulder[0];
  const y=elbow[1]+dx*Math.sin(bend)+dy*Math.cos(bend)-shoulder[1];
  return {x:shoulder[0]+x*Math.cos(wing)-y*Math.sin(wing),y:shoulder[1]+x*Math.sin(wing)+y*Math.cos(wing),angle:-.06-(wing-EVIL_PITCHFORK_REST.leftWing)*.12};
}

export function drawCoachPitchfork(context,pose=EVIL_PITCHFORK_REST){
  const {x,y,angle}=coachPitchforkTransform(pose);
  context.save();context.translate(x,y);context.rotate(angle);
  context.lineJoin='round';context.lineCap='round';
  for(const part of PARTS){
    const path=new Path2D(part.d);
    if(part.fill){context.fillStyle=part.fill;context.fill(path);}
    if(part.stroke){context.strokeStyle=part.stroke;context.lineWidth=part.width;context.stroke(path);}
  }
  context.restore();
}

/** Used only by the portrait builder; animation bases deliberately omit it. */
export function coachPitchforkSvg(pose=EVIL_PITCHFORK_REST){
  const {x,y,angle}=coachPitchforkTransform(pose);
  const paths=PARTS.map(part=>`<path d="${part.d}" fill="${part.fill||'none'}" stroke="${part.stroke||'none'}" stroke-width="${part.width||0}"/>`).join('');
  return `<g transform="translate(${x} ${y}) rotate(${angle*180/Math.PI})" stroke-linejoin="round" stroke-linecap="round">${paths}</g>`;
}
