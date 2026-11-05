import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { coachFaceId, coachEyeArt, coachMouthArt, coachFaceSvg } from '../extension/lib/coach-face-art.js';

const shapes = scene => scene.flatMap(shape => shape.children ? shapes(shape.children) : [shape]);
const pupils = scene => shapes(scene).filter(shape => shape.fill === '#2e2923');

test('Baby uses the original Meowl eye design at infant positions without adding new face decorations', () => {
  assert.equal(coachFaceId('baby'), 'baby', 'The character keeps its own identity');
  const baby = pupils(coachEyeArt('baby')), normal = pupils(coachEyeArt('meowl'));
  assert.equal(baby.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(baby[i].cx, normal[i].cx);
    assert(Math.abs(baby[i].rx / normal[i].rx - 1.15) < 1e-10);
    assert(Math.abs(baby[i].ry / normal[i].ry - 1.15) < 1e-10);
    assert.equal(baby[i].cy, [365, 368][i] + 3 * 1.15);
  }
  assert.deepEqual(coachEyeArt('baby')[0], coachEyeArt('meowl')[0], 'Keep the original small brow marking');
  const colors = scene => [...new Set(shapes(scene).flatMap(shape => [shape.fill, shape.stroke]))].sort();
  assert.deepEqual(colors(coachEyeArt('baby')), colors(coachEyeArt('meowl')), 'No new blush or eye colors');
  assert.equal(shapes(coachEyeArt('baby')).filter(shape => shape.fill === '#fff2d8').length, 2, 'One small catchlight per eye');
  const mouth = coachMouthArt('baby');
  assert.equal(mouth[0].d, 'M605 431 L605 439', 'The shortened mouth stem meets the existing painted nose');
  assert.equal(mouth[1].stroke, coachMouthArt('meowl')[1].stroke);
});

test('Baby blinks both eyes, looks around and returns its mouth to a closed smile', () => {
  const open = coachEyeArt('baby');
  const closed = coachEyeArt('baby', { blink: 1 });
  assert.equal(pupils(closed).length, 0, 'Both open eyes disappear at the blink peak');
  assert.equal(shapes(closed).filter(shape => shape.stroke === '#49382d').length, 2, 'Two matching closed eyelids remain');
  assert.equal(pupils(coachEyeArt('baby', { blink: 0.5 })).length, 2);
  for (const lookX of [-1, 1]) {
    const gazing = pupils(coachEyeArt('baby', { lookX }));
    const resting = pupils(open);
    assert(gazing.every((eye, i) => Math.sign(eye.cx - resting[i].cx) === lookX));
  }
  assert.deepEqual(coachEyeArt('baby', { blink: 0, lookX: 0, lookY: 0 }), open);
  const resting = coachMouthArt('baby', 0), speaking = coachMouthArt('baby', 0.8);
  assert(resting.every(shape => shape.fill === 'none'));
  assert(speaking.some(shape => shape.fill === '#694331'));
  assert.notDeepEqual(coachMouthArt('baby', 0.2), speaking);
  assert.deepEqual(coachMouthArt('baby', -1), resting);
  assert.deepEqual(coachMouthArt('baby', 0), resting);
});

test('Baby facial proportions do not change the original six Meowl faces', () => {
  const ids = ['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil'];
  const states = [{}, { blink: 0.5 }, { blink: 1 }, { lookX: -1 }, { lookX: 1 }, { lookY: -1 }, { lookY: 1 }, { blink: 0.6, lookX: 0.8, lookY: -0.8 }];
  const art = ids.map(id => ({ id, svg: coachFaceSvg(id), eyes: states.map(state => coachEyeArt(id, state)), mouth: [0, 0.03, 0.1, 0.6, 1].map(amount => coachMouthArt(id, amount)) }));
  const hash = createHash('sha256').update(JSON.stringify(art)).digest('hex');
  assert.equal(hash, 'a8fa781de640c64574874d0215d2d6238a96c1ecab5a222cbbed0e6a0cd7e6bf');
});
