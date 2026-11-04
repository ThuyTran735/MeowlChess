// Shared, editable shapes keep the resting portrait and its moving glasses exact.
// No browser objects are created when the outfit builder imports this module.
const GLASSES_PARTS = Object.freeze([
  { d: 'M472 338 L445 333 M762 341 L790 338', stroke: '#97672f', width: 12 },
  { d: 'M586 347 C601 338 629 338 648 351', stroke: '#97672f', width: 10 },
  { d: 'M586 345 C586 377 560 403 528 403 C496 403 470 377 470 345 C470 313 496 287 528 287 C560 287 586 313 586 345 Z M764 348 C764 380 738 406 706 406 C674 406 648 380 648 348 C648 316 674 290 706 290 C738 290 764 316 764 348 Z', stroke: '#97672f', width: 10 },
  { d: 'M482 320 C491 302 508 293 528 293 C547 293 563 302 573 316 M661 322 C671 304 687 296 706 296 C725 296 742 305 751 321', stroke: '#c29a5b', width: 3 },
]);

export const COACH_GLASSES_SVG = `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${GLASSES_PARTS.map(part => `<path d="${part.d}" stroke="${part.stroke}" stroke-width="${part.width}"/>`).join('')}</g>`;

const paths = new Map();
const bounded = amount => Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;

/** Draw the Professor's glasses in source-art coordinates, including at rest. */
export function drawCoachGlasses(context, amount = 0) {
  context.save();
  context.translate(0, -12 * bounded(amount));
  context.lineCap = 'round'; context.lineJoin = 'round';
  for (const part of GLASSES_PARTS) {
    if (!paths.has(part.d)) paths.set(part.d, new Path2D(part.d));
    context.strokeStyle = part.stroke; context.lineWidth = part.width;
    context.stroke(paths.get(part.d));
  }
  context.restore();
}

/** Hold the book with its pages tilted toward Professor, above the outer covers. */
export function drawCoachBook(context, amount = 0, page = 0) {
  const open = bounded(amount);
  if (open <= 0) return;
  const size = (54 + 156 * open) / 210;
  const cx = 705 - 79 * open, cy = 787 + 8 * open;
  const path = (fill, draw) => {
    context.beginPath(); draw(); context.closePath();
    context.fillStyle = fill; context.fill(); context.stroke();
  };
  context.save();
  context.translate(cx, cy); context.scale(size, size);
  context.globalAlpha *= Math.min(1, open * 8);
  context.lineJoin = 'round'; context.lineCap = 'round';
  context.strokeStyle = '#49382d'; context.lineWidth = 6;
  // The visible cover faces form a V; the reading surface is the narrow top plane.
  path('#87634b', () => {
    context.moveTo(-105, -21); context.lineTo(0, 7); context.lineTo(0, 58);
    context.quadraticCurveTo(-53, 40, -100, 25); context.closePath();
  });
  path('#6b5142', () => {
    context.moveTo(0, 7); context.lineTo(105, -21); context.lineTo(100, 25);
    context.quadraticCurveTo(53, 40, 0, 58);
  });
  // Small inset lines belong to the cover, not printed pages facing the viewer.
  context.strokeStyle = '#b78f58'; context.lineWidth = 2.5;
  context.beginPath(); context.moveTo(-90, -6); context.lineTo(-12, 15);
  context.lineTo(-12, 43); context.lineTo(-87, 18); context.closePath(); context.stroke();
  context.beginPath(); context.moveTo(12, 15); context.lineTo(90, -6);
  context.lineTo(87, 18); context.lineTo(12, 43); context.closePath(); context.stroke();
  context.strokeStyle = '#49382d'; context.lineWidth = 4;
  path('#dbc6a1', () => {
    context.moveTo(-96, -47); context.quadraticCurveTo(-46, -39, 0, -22);
    context.quadraticCurveTo(46, -39, 96, -47); context.lineTo(101, -20);
    context.quadraticCurveTo(47, -7, 0, 9); context.quadraticCurveTo(-47, -7, -101, -20);
  });
  path('#f3e6c9', () => {
    context.moveTo(-94, -49); context.quadraticCurveTo(-45, -40, 0, -24);
    context.lineTo(0, 1); context.quadraticCurveTo(-48, -15, -97, -25);
  });
  path('#e9d7b2', () => {
    context.moveTo(0, -24); context.quadraticCurveTo(45, -40, 94, -49);
    context.lineTo(97, -25); context.quadraticCurveTo(48, -15, 0, 1);
  });
  // A narrow paper edge and a quiet gutter keep the upward-facing spread
  // readable at avatar size without changing its outline or grip locations.
  context.strokeStyle = '#f6ead1'; context.lineWidth = 2;
  context.beginPath(); context.moveTo(-95, -20);
  context.quadraticCurveTo(-47, -6, 0, 6);
  context.quadraticCurveTo(47, -6, 95, -20); context.stroke();
  context.fillStyle = 'rgba(91,67,40,.16)';
  context.beginPath(); context.moveTo(-6,-26); context.lineTo(0,-24);
  context.lineTo(6,-26); context.lineTo(4,1); context.lineTo(0,3);
  context.lineTo(-4,1); context.closePath(); context.fill();
  context.strokeStyle = '#b69c70'; context.lineWidth = 2;
  // Two foreshortened lines on each page make the upward-facing plane readable.
  for (const row of [0, 8]) {
    context.beginPath(); context.moveTo(-79, -39 + row);
    context.quadraticCurveTo(-50, -34 + row, -20, -24 + row);
    context.moveTo(20, -24 + row); context.quadraticCurveTo(50, -34 + row, 79, -39 + row);
    context.stroke();
  }
  const turn = bounded(page);
  if (turn > 0 && turn < 1) {
    const edge = 95 * Math.cos(Math.PI * turn), arch = 31 * Math.sin(Math.PI * turn);
    context.strokeStyle = '#ac9368'; context.lineWidth = 2.5;
    // The sheet pivots around the same foreshortened gutter, not in front of the cover.
    path(turn < .5 ? '#f7edd6' : '#e8d7b3', () => {
      context.moveTo(0, -24);
      context.bezierCurveTo(edge * .3, -33 - arch * .7, edge * .73, -46 - arch, edge, -49 - arch);
      context.lineTo(edge, -25 - arch);
      context.bezierCurveTo(edge * .73, -20 - arch * .7, edge * .3, -6 - arch * .2, 0, 1);
    });
  }
  // A short cloth bookmark follows the outside spine, clear of both grip points.
  context.strokeStyle = '#49382d'; context.lineWidth = 2.5;
  path('#8d6260', () => {
    context.moveTo(4, 8); context.lineTo(13, 6); context.lineTo(13, 42);
    context.lineTo(9, 38); context.lineTo(4, 44);
  });
  context.restore();
}
