// Coordinates use a fixed 800 × 800 viewBox so arrows follow every board size.
export function squareCenter(square, flipped = false) {
  if (!/^[a-h][1-8]$/.test(square || '')) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return { x: ((flipped ? 7 - file : file) + 0.5) * 100, y: ((flipped ? rank : 7 - rank) + 0.5) * 100 };
}

export function moveArrowPath(uci, flipped = false, headLength = 0) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '') || uci.slice(0, 2) === uci.slice(2, 4)) return null;
  const from = squareCenter(uci.slice(0, 2), flipped);
  const to = squareCenter(uci.slice(2, 4), flipped);
  const dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y);
  // Knights use the same right-angle path whether the board is flipped or not.
  const bend = dx === 200 && dy === 100 ? { x: to.x, y: from.y } : dx === 100 && dy === 200 ? { x: from.x, y: to.y } : null;
  const previous = bend || from;
  const length = Math.hypot(to.x - previous.x, to.y - previous.y);
  const trim = Number.isFinite(headLength) ? Math.max(0, Math.min(headLength, length - 1)) : 0;
  const end = { x: to.x - (to.x - previous.x) / length * trim, y: to.y - (to.y - previous.y) / length * trim };
  return `M ${from.x} ${from.y}${bend ? ` L ${bend.x} ${bend.y}` : ''} L ${end.x} ${end.y}`;
}
