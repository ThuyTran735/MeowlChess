import { coachFaceId, coachEyeArt, coachMouthArt, drawCoachFaceArt } from './coach-face-art.js';

/** Animation bases contain clean fur. Static and animated features share one scene. */
export function createCoachEyes(_artwork, _document, coachId = 'meowl') {
  return { coachId: coachFaceId(coachId) };
}
export function drawCoachEyes(context, eyes, closed = 0, lookX = 0, lookY = 0) {
  drawCoachFaceArt(context, coachEyeArt(eyes.coachId, {blink:closed, lookX, lookY}));
}
export function drawCoachMouth(context, eyes, amount = 0) {
  drawCoachFaceArt(context, coachMouthArt(eyes.coachId, amount));
}
