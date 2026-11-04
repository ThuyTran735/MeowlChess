const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const finite=(value,low,high)=>clamp(Number.isFinite(value)?value:0,low,high);
const smooth=(value)=>{const t=finite(value,0,1);return t*t*(3-2*t);};
const blend=(from,to,amount)=>from+(to-from)*amount;
const sideKey=side=>side==='right'||side===true?'right':'left';
const point=(x,y)=>Object.freeze([x,y]);

/** Original artwork joints. Their distances never change during an action. */
export const COACH_WING_GEOMETRY=Object.freeze({
  left:Object.freeze({shoulder:point(468,624),elbow:point(455,785),tip:point(442,955)}),
  right:Object.freeze({shoulder:point(780,624),elbow:point(809,785),tip:point(844,962)}),
});

/** Opaque painted feather interiors, distinct from the transparent tip ends. */
export const COACH_WING_GRIP_POINTS=Object.freeze({
  left:point(450,925),right:point(838,932),
});

/** Match the book's unfolding scale and its movement out of the vest pocket. */
export function coachBookGripTargets(amount=0){
  const open=finite(amount,0,1),size=(54+156*open)/210,cx=705-79*open,cy=787+8*open;
  return {left:[cx-94*size,cy+5*size],right:[cx+94*size,cy+5*size]};
}

/** The cup is supported under its two lower corners, including while lifted. */
export function coachMugGripTargets(lift=0){
  const y=825-finite(lift,0,90);
  return {left:[570,y],right:[682,y]};
}

/** Forward kinematics, shared with foreground feather-tip grips. */
function wingPoint(pose,side,anchor){
  const key=sideKey(side),right=key==='right',rig=COACH_WING_GEOMETRY[key];
  const wing=(right?-1:1)*finite(pose?.[`${key}Wing`]??pose?.wing,0,1.35);
  const elbow=(right?1:-1)*finite(pose?.[`${key}Elbow`],-2.2,2.2);
  const dx=anchor[0]-rig.elbow[0],dy=anchor[1]-rig.elbow[1];
  const x=rig.elbow[0]+dx*Math.cos(elbow)-dy*Math.sin(elbow)-rig.shoulder[0];
  const y=rig.elbow[1]+dx*Math.sin(elbow)+dy*Math.cos(elbow)-rig.shoulder[1];
  return [rig.shoulder[0]+x*Math.cos(wing)-y*Math.sin(wing),rig.shoulder[1]+x*Math.sin(wing)+y*Math.cos(wing)];
}

export function coachWingTip(pose={},side='left'){
  return wingPoint(pose,side,COACH_WING_GEOMETRY[sideKey(side)].tip);
}

/** Rigid contact point for a prop held inside the original feather silhouette. */
export function coachWingGrip(pose={},side='left'){
  return wingPoint(pose,side,COACH_WING_GRIP_POINTS[sideKey(side)]);
}

function bookGripSlide(source){
  const page=finite(source?.pageTurn,0,1),gesture=finite(source?.rightElbow,-2.2,2.2);
  return Math.sin(Math.PI*page)*4+Math.max(0,gesture-1.75)*8;
}

/** Keep the unfolding book in the carrying wing during its approach/release. */
export function coachBookCarryOffset(raw={},resolved){
  const amount=finite(raw?.book,0,1);
  if(amount<=0)return [0,0];
  const pose=resolved&&typeof resolved==='object'?resolved:resolveCoachWingPose(raw,'owl');
  const expected=coachBookGripTargets(amount).right,actual=coachWingGrip(pose,'right');
  // Use the complete delta: weighting it by the remaining grip blend would
  // leave a gap midway through the transition. Preserve the deliberate slide
  // along the cover, so turning a page does not move the entire held book.
  return [actual[0]-expected[0],actual[1]-expected[1]+bookGripSlide(raw)];
}

/** Keep the cup in its carrying wing until both wings reach the held pose. */
export function coachMugCarryOffset(raw={},resolved){
  if(finite(raw?.mug,0,1)<=0)return [0,0];
  const pose=resolved&&typeof resolved==='object'?resolved:resolveCoachWingPose(raw,'mellow');
  const expected=coachMugGripTargets(raw?.mugLift).right,actual=coachWingGrip(pose,'right');
  // Use the full correction while approaching or lowering the cup. Blending
  // it again by grip strength would leave the partly visible cup floating.
  return [actual[0]-expected[0],actual[1]-expected[1]];
}

function targetPose(side,target){
  const right=side==='right',rig=COACH_WING_GEOMETRY[side];
  const upper=[rig.elbow[0]-rig.shoulder[0],rig.elbow[1]-rig.shoulder[1]];
  const grip=COACH_WING_GRIP_POINTS[side];
  const lower=[grip[0]-rig.elbow[0],grip[1]-rig.elbow[1]];
  const length1=Math.hypot(...upper),length2=Math.hypot(...lower);
  const restUpper=Math.atan2(upper[1],upper[0]),restLower=Math.atan2(lower[1],lower[0]),restBend=restLower-restUpper;
  const dx=target[0]-rig.shoulder[0],dy=target[1]-rig.shoulder[1];
  // Pick the outward elbow branch. At very high cup lifts, preserve the fixed
  // links and a natural bend rather than shortening a wing to force contact.
  const maximumBend=right?2.2+restBend:2.2-restBend;
  const minimumReach=Math.sqrt(length1**2+length2**2+2*length1*length2*Math.cos(maximumBend));
  const reach=clamp(Math.hypot(dx,dy),minimumReach,length1+length2-.00001);
  const bend=(right?1:-1)*Math.acos(clamp((reach**2-length1**2-length2**2)/(2*length1*length2),-1,1));
  const upperAngle=Math.atan2(dy,dx)-Math.atan2(length2*Math.sin(bend),length1+length2*Math.cos(bend));
  return {
    wing:clamp((right?-1:1)*(upperAngle-restUpper),0,1.35),
    elbow:clamp((right?1:-1)*(bend-restBend),-2.2,2.2),
  };
}

function gentleBend(value){
  const bend=finite(value,-2.2,2.2);
  // Quiet gestures rotate the entire painted wing. Ease into the elbow joint
  // only for a purposeful bend, keeping small feather edges from flickering.
  if(Math.abs(bend)<=.18)return 0;
  if(Math.abs(bend)<.7)return bend*smooth((Math.abs(bend)-.18)/.52);
  // Strong free folds approach the limit smoothly rather than pinching shut.
  if(bend>1.1)return 1.1+.5*(1-Math.exp(-(bend-1.1)/.5));
  if(bend< -1.1)return -1.1-.25*(1-Math.exp(-(-bend-1.1)/.25));
  return bend;
}

function keepTipOnItsSide(pose,side){
  const right=side==='right',rig=COACH_WING_GEOMETRY[side],tip=coachWingTip(pose,side);
  const inside=right?652-tip[0]:tip[0]-600;
  if(inside<= -16)return;
  // Softly open the shoulder before the tip reaches the opposite wing. This
  // keeps a tucked pose without letting the two pointed feather ends cross.
  const correction=inside>=16?inside:(inside+16)**2/64;
  const desiredX=tip[0]+(right?correction:-correction);
  const dx=tip[0]-rig.shoulder[0],dy=tip[1]-rig.shoulder[1],radius=Math.hypot(dx,dy);
  const desiredAngle=Math.acos(clamp((desiredX-rig.shoulder[0])/radius,-1,1));
  const currentAngle=Math.atan2(dy,dx);
  const outward=(right?-1:1)*(desiredAngle-currentAngle);
  if(outward>0)pose[`${side}Wing`]=clamp(pose[`${side}Wing`]+outward,0,1.35);
}

/**
 * Resolve only rigid wing joints. Props get real supporting grip targets while
 * unrelated facial, ear, foot, and prop tracks remain untouched. Grip weights
 * let the renderer paint the last feather tips in front of held objects.
 */
export function resolveCoachWingPose(source={},coachId='meowl'){
  const pose=source&&typeof source==='object'?{...source}:{};
  for(const side of ['left','right']){
    pose[`${side}Wing`]=finite(pose[`${side}Wing`]??pose.wing,0,1.35);
    pose[`${side}Elbow`]=gentleBend(pose[`${side}Elbow`]);
    pose[`${side}Grip`]=0;
    keepTipOnItsSide(pose,side);
  }
  let targets=null,weights=null;
  if(coachId==='owl'){
    const amount=finite(pose.book,0,1);
    if(amount>0){
      targets=coachBookGripTargets(amount);
      // While the small book is still beside the vest, one wing carries it.
      // The other joins once the spread reaches the middle of the body.
      targets.left[0]=Math.min(610,targets.left[0]);
      weights={left:smooth((amount-.3)/.35),right:smooth((amount-.02)/.48)};
      // A small slide along the cover accompanies the existing page/point
      // gesture; the tip remains on the book instead of cutting through it.
      targets.right[1]-=bookGripSlide(source);
    }
  }else if(coachId==='mellow'){
    const amount=finite(pose.mug,0,1);
    if(amount>0){
      const weight=smooth((amount-.02)/.28);
      targets=coachMugGripTargets(pose.mugLift);weights={left:weight,right:weight};
    }
  }else if(coachId==='scout'){
    pose.rightGrip=finite(pose.magnifier,0,1);
  }else if(coachId==='paws'){
    pose.leftGrip=finite(pose.pennant,0,1);
  }
  if(targets)for(const side of ['left','right']){
    const support=targetPose(side,targets[side]),weight=weights[side];
    pose[`${side}Wing`]=blend(pose[`${side}Wing`],support.wing,weight);
    pose[`${side}Elbow`]=blend(pose[`${side}Elbow`],support.elbow,weight);
    pose[`${side}Grip`]=weight;
  }
  return pose;
}
