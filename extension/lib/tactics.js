import { Chess } from '../vendor/chess.js';

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const sideName = color => color === 'w' ? 'White' : 'Black';
const material = (chess, color) => chess.board().flat().reduce((sum, piece) => sum + (piece ? VALUES[piece.type] * (piece.color === color ? 1 : -1) : 0), 0);
const capturedSquare = move => move.flags.includes('e') ? move.to[0] + move.from[1] : move.to;

function legalContinuation(fen, pv) {
  const board = new Chess(fen), positions = [board.fen()], moves = [], line = [];
  const input = Array.isArray(pv) ? pv : [];
  let truncated = input.length > 24;
  for (const uci of input.slice(0, 24)) {
    if (board.isGameOver()) { truncated = true; break; }
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) { truncated = true; break; }
    try {
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      moves.push({ ...move, uci }); line.push(uci); positions.push(board.fen());
    } catch { truncated = true; break; }
  }
  return { line, moves, positions, truncated, board };
}

function forkEvidence(continuation, victimColor, materialLoss) {
  if (materialLoss < 2) return null;
  const { moves, positions } = continuation;
  for (let i = 0; i < moves.length; i++) {
    const attack = moves[i];
    if (attack.color === victimColor || !['n', 'p'].includes(attack.promotion || attack.piece)) continue;
    const board = new Chess(positions[i + 1]);
    const attacker = board.get(attack.to);
    if (!attacker) continue;
    const ownKing = board.board().flat().find(piece => piece?.color === attack.color && piece.type === 'k')?.square;
    const unblocked = new Chess(board.fen()); unblocked.remove(attack.to);
    // A geometrical attack by a pinned knight/pawn is not enough to claim a fork.
    if (!ownKing || unblocked.isAttacked(ownKing, victimColor)) continue;
    const targets = board.board().flat().filter(piece => piece?.color === victimColor && (piece.type === 'k' || VALUES[piece.type] >= 3) && board.attackers(piece.square, attack.color).includes(attack.to));
    if (targets.length < 2) continue;
    // Verify that this same piece actually captures one of the forked targets.
    const captureIndex = moves.findIndex((reply, j) => j > i && reply.color === attack.color);
    const payoff = moves[captureIndex];
    if (!payoff || payoff.from !== attack.to || payoff.piece !== attacker.type || !payoff.captured || !targets.some(target => target.square === payoff.to && target.type === payoff.captured)) continue;
    const captured = targets.find(target => target.square === moves[captureIndex].to);
    const other = targets.find(target => target.square !== captured.square && target.type === 'k') || targets.find(target => target.square !== captured.square);
    return { attack, at: i + 1, capture: moves[captureIndex], captureAt: captureIndex + 1, targets: [other, captured] };
  }
  return null;
}

/** Concrete, conservative observations from a legal engine line, never a claimed human explanation. */
export function explainConsequence(reviewMove, afterEvaluation = reviewMove?.evalAfter) {
  const unavailable = { type: 'unavailable', text: 'No legal engine continuation is available for this move yet. Analyze the position more deeply.', line: [], moves: [], positions: [], highlights: [], truncated: false };
  if (!reviewMove?.before || !reviewMove?.after || !['w', 'b'].includes(reviewMove.color)) return unavailable;
  let board;
  try {
    board = new Chess(reviewMove.before);
    const actual = board.move({ from: reviewMove.from, to: reviewMove.to, promotion: reviewMove.promotion });
    if (actual.color !== reviewMove.color || board.fen() !== new Chess(reviewMove.after).fen()) return unavailable;
  } catch { return unavailable; }
  const continuation = legalContinuation(board.fen(), afterEvaluation?.pv);
  const { line, moves, positions, truncated } = continuation;
  const base = { line, moves, positions, truncated, highlights: [] };
  const end = continuation.board;
  if (board.isCheckmate()) return { ...base, type: 'mate', text: `${sideName(reviewMove.color)} has delivered checkmate.` };
  if (board.isDraw()) return { ...base, type: 'draw', text: 'This position is drawn. There is no further engine continuation to explain.' };
  if (end.isCheckmate() && moves.length) {
    const last = moves.at(-1);
    return { ...base, type: 'mate', text: `In this line, ${sideName(last.color)} ends with ${last.san}, checkmate.`, highlights: [{ square: last.to, role: 'attacker', at: moves.length }] };
  }
  if (Number.isInteger(afterEvaluation?.mate) && afterEvaluation.mate !== 0 && Number.isFinite(afterEvaluation.cp) && afterEvaluation.cp !== 0) {
    return { ...base, type: 'mate', text: `The engine reports a forced mate for ${sideName(afterEvaluation.cp > 0 ? 'w' : 'b')} in ${Math.abs(afterEvaluation.mate)} moves at this search depth.` };
  }
  if (!moves.length) return { ...unavailable, positions, truncated };
  const materialLoss = material(board, reviewMove.color) - material(end, reviewMove.color);
  const fork = forkEvidence(continuation, reviewMove.color, materialLoss);
  if (fork) {
    const [first, second] = fork.targets;
    return { ...base, type: 'fork', materialLoss, text: `In this line, ${fork.attack.san} forks ${sideName(reviewMove.color)}'s ${NAMES[first.type]} on ${first.square} and ${NAMES[second.type]} on ${second.square}; ${fork.capture.san} then captures the ${NAMES[second.type]}.`, highlights: [{ square: fork.attack.to, role: 'attacker', at: fork.at }, ...fork.targets.map(target => ({ square: target.square, role: 'target', at: fork.at }))] };
  }
  const lostCaptures = moves.map((move, index) => ({ ...move, at: index + 1 })).filter(move => move.color !== reviewMove.color && move.captured);
  if (materialLoss >= 1 && lostCaptures.length) {
    const capture = lostCaptures.find(move => move.captured !== 'p') || lostCaptures[0];
    const amount = Number.isInteger(materialLoss) ? materialLoss : materialLoss.toFixed(1);
    return { ...base, type: 'material', materialLoss, text: `In this line, ${capture.san} captures ${sideName(reviewMove.color)}'s ${NAMES[capture.captured]} on ${capturedSquare(capture)}. By the end of the shown line, ${sideName(reviewMove.color)} has lost about ${amount} pawn${materialLoss === 1 ? '' : 's'} of net material compared with the position after ${reviewMove.san}.`, highlights: [{ square: capture.from, role: 'attacker', at: capture.at - 1 }, { square: capturedSquare(capture), role: 'target', at: capture.at - 1 }] };
  }
  if (end.isDraw()) return { ...base, type: 'draw', text: 'In this line, the continuation reaches a drawn position. Step through the moves to see how.' };
  return { ...base, type: 'line', text: `The engine continues with ${moves.slice(0, 4).map(move => move.san).join(' ')} in this line. No simple lasting material gain or forced mate is verified in the shown continuation.` };
}
