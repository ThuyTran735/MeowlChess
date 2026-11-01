import { Chess } from '../vendor/chess.js';

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CAPTURE_ORDER = ['p', 'n', 'b', 'r', 'q'];

/**
 * Summarize the displayed position using its FEN and only the moves before it.
 * Captures belong to the capturing player. Use the actual history rather than
 * missing starting pieces, since imports may start from a custom position.
 */
export function summarizeMaterial({ fen, moves = [] }) {
  const result = {
    w: { captured: [], material: 0, advantage: 0 },
    b: { captured: [], material: 0, advantage: 0 },
  };
  for (const piece of new Chess(fen).board().flat()) {
    if (piece && VALUES[piece.type]) result[piece.color].material += VALUES[piece.type];
  }
  for (const move of moves) {
    if ((move?.color === 'w' || move?.color === 'b') && CAPTURE_ORDER.includes(move.captured)) {
      result[move.color].captured.push(move.captured);
    }
  }
  for (const color of ['w', 'b']) {
    result[color].captured.sort((a, b) => CAPTURE_ORDER.indexOf(a) - CAPTURE_ORDER.indexOf(b));
    result[color].advantage = Math.max(0, result[color].material - result[color === 'w' ? 'b' : 'w'].material);
  }
  return result;
}
