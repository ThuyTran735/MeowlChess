import { Chess } from '../vendor/chess.js';

const VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const MIN_DEPTH = 12;
const MIN_INVESTMENT = 1.5;
const MAX_EXCHANGE_NODES = 384;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const uciFor = move => `${move.from}${move.to}${move.promotion || ''}`;
const recapture = (move, previous) => !!previous?.captured && previous.to === move?.to;

function chance(evaluation, color) {
  if (!evaluation || !Number.isFinite(evaluation.cp)) return null;
  const cp = evaluation.cp * (color === 'w' ? 1 : -1);
  if (evaluation.mate != null) return Number.isFinite(evaluation.mate) ? cp > 0 ? 1 : 0 : null;
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

function exact(evaluation) {
  return evaluation && Number.isFinite(evaluation.cp) && evaluation.depth >= MIN_DEPTH
    && !evaluation.lowerbound && !evaluation.upperbound && !evaluation.bound;
}

function movePosition(move) {
  if (!move || !['w', 'b'].includes(move.color) || !UCI.test(uciFor(move)) || typeof move.before !== 'string' || typeof move.after !== 'string') return null;
  try {
    const position = new Chess(move.before);
    if (position.turn() !== move.color) return null;
    const legal = position.moves({ verbose: true });
    if (legal.length < 2) return null;
    const played = position.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!played || position.fen() !== move.after || position.isGameOver()) return null;
    return { position, played, legal };
  } catch { return null; }
}

// Legal recaptures account for pins and king safety. A side may stop exchanging
// only when it actually has a legal move elsewhere. The bounded search declines
// to identify a sacrifice if an unusually crowded exchange exceeds its budget.
function exchangeGain(position, square, budget, memo) {
  if (--budget.remaining < 0) throw new Error('Exchange limit');
  const key = `${position.fen()}|${square}`;
  if (memo.has(key)) return memo.get(key);
  const legal = position.moves({ verbose: true });
  const captures = legal.filter(move => move.to === square && move.captured && move.captured !== 'k');
  if (!captures.length) return 0;
  let best = captures.length < legal.length ? 0 : -Infinity;
  for (const capture of captures) {
    position.move({ from: capture.from, to: capture.to, promotion: capture.promotion });
    let gain;
    try {
      gain = VALUES[capture.captured] + (capture.promotion ? VALUES[capture.promotion] - VALUES.p : 0)
        - exchangeGain(position, square, budget, memo);
    } finally { position.undo(); }
    best = Math.max(best, gain);
  }
  memo.set(key, best);
  return best;
}

/** A legal capture that lets the opponent gain material through the exchange. */
export function sacrificeOffer(move, { previousMove } = {}) {
  if (move?.promotion) return null;
  const context = movePosition(move);
  if (!context) return null;
  const { position, played } = context;
  const earned = VALUES[played.captured] || 0;
  const isRecapture = recapture(move, previousMove);
  // Recapturing can itself sacrifice an exchange or a queen. Count its net
  // cost, but do not credit a routine recapture for an unrelated loose piece.
  const captures = position.moves({ verbose: true }).filter(reply => ['n', 'b', 'r', 'q'].includes(reply.captured)
    && (!isRecapture || reply.to === played.to && reply.captured === played.piece));
  const budget = { remaining: MAX_EXCHANGE_NODES }, memo = new Map();
  let offered = null;
  try {
    for (const capture of captures) {
      position.move({ from: capture.from, to: capture.to, promotion: capture.promotion });
      let investment;
      try {
        investment = VALUES[capture.captured] + (capture.promotion ? VALUES[capture.promotion] - VALUES.p : 0)
          - exchangeGain(position, capture.to, budget, memo) - earned;
      } finally { position.undo(); }
      if (investment >= MIN_INVESTMENT && (!offered || investment > offered.investment)) {
        offered = { square: capture.to, piece: capture.captured, capture: uciFor(capture), investment };
      }
    }
  } catch { return null; }
  return offered;
}

// Only complete, legal, same-depth root alternatives support an "only move"
// judgment. A one-line engine, bounds, or a partial MultiPV report cannot do so.
function alternatives(move, before, legal) {
  if (!exact(before) || !Array.isArray(before.candidates) || before.candidates.length < 2) return null;
  const [first, second] = before.candidates;
  if (!exact(first) || !exact(second) || first.rank !== 1 || second.rank !== 2
    || first.depth !== before.depth || second.depth !== before.depth
    || first.bestMove !== before.bestMove || first.cp !== before.cp || first.mate !== before.mate
    || first.bestMove === second.bestMove) return null;
  const legalMoves = new Set(legal.map(uciFor));
  if (!legalMoves.has(first.bestMove) || !legalMoves.has(second.bestMove)) return null;
  const best = chance(first, move.color), next = chance(second, move.color);
  if (best == null || next == null || next > best + 0.000001) return null;
  return { best, next, gap: best - next };
}

function routinePickup(move, position) {
  if (!move.captured || move.san?.includes('+')) return false;
  // Taking a loose piece without offering anything back is not a special move.
  return !position.moves({ verbose: true }).some(reply => reply.to === move.to && reply.captured === move.piece);
}

function legalContinuation(move, evaluation) {
  if (!Array.isArray(evaluation.pv) || !evaluation.pv.length || evaluation.pv.length > 256
    || evaluation.bestMove && evaluation.bestMove !== evaluation.pv[0]) return false;
  try {
    const position = new Chess(move.after);
    for (const uci of evaluation.pv) {
      if (!UCI.test(uci)) return false;
      position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    return true;
  } catch { return false; }
}

function stableWinningMate(move, before, after) {
  const sign = move.color === 'w' ? 1 : -1;
  return Number.isInteger(before.mate) && Number.isInteger(after.mate)
    && before.mate * sign > 0 && after.mate * sign > 0
    && Math.abs(after.mate) <= Math.abs(before.mate);
}

function verifiedMatingSacrifice(move, before, after, offer) {
  if (!offer || !stableWinningMate(move, before, after) || after.bestMove !== offer.capture
    || after.pv[0] !== offer.capture || after.pv.length !== Math.abs(after.mate) * 2) return false;
  try {
    const position = new Chess(move.after);
    for (const uci of after.pv) {
      // A line that has already ended cannot prove a later forced checkmate.
      if (position.isGameOver()) return false;
      position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    return position.isCheckmate() && position.turn() !== move.color;
  } catch { return false; }
}

function material(position, color) {
  return position.board().flat().reduce((total, piece) => total + (piece ? VALUES[piece.type] * (piece.color === color ? 1 : -1) : 0), 0);
}

function continuationMaterialGain(move, after) {
  const plies = Math.min(8, after.pv.length - after.pv.length % 2);
  if (plies < 4) return 0;
  try {
    const position = new Chess(move.after), starting = material(position, move.color);
    for (const uci of after.pv.slice(0, plies)) {
      if (position.isGameOver()) return 0;
      position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    const gain = material(position, move.color) - starting;
    // The opponent moves next. Discount their strongest legal capture even if
    // our final move was quiet or a different piece is hanging at the horizon.
    const targets = new Set(position.moves({ verbose: true }).filter(reply => reply.captured).map(reply => reply.to));
    const budget = { remaining: MAX_EXCHANGE_NODES }, memo = new Map();
    let replyGain = 0;
    for (const square of targets) replyGain = Math.max(replyGain, exchangeGain(position, square, budget, memo));
    return gain - replyGain;
  } catch { return 0; }
}

function criticalContinuation(move, before, after, comparison, previousEvaluation, previousMove) {
  if (!comparison || !exact(previousEvaluation) || previousMove?.after !== move.before
    || previousMove.color === move.color || chance(before, move.color) - chance(previousEvaluation, move.color) < 0.08) return false;
  const played = before.candidates.slice(0, 2).find(candidate => candidate.bestMove === uciFor(move));
  if (!played || comparison.best - chance(played, move.color) > 0.01) return false;
  return continuationMaterialGain(move, after) >= 2;
}

/** Nominate a bounded set of promising moves; this never awards a label. */
export function highlightCandidate(move, before, after, { previousEvaluation, previousMove } = {}) {
  const prior = chance(before, move?.color), next = chance(after, move?.color);
  if (prior == null || next == null || prior < 0.25 || next < 0.4 || prior - next > 0.03
    || move?.promotion) return null;
  const context = movePosition(move);
  if (!context) return null;
  const comparison = alternatives(move, before, context.legal);
  const offer = sacrificeOffer(move, { previousMove });
  const previous = chance(previousEvaluation, move.color);
  const opponentError = previous != null && prior - previous >= 0.08;
  if (prior > 0.9 && comparison?.next > 0.9 && !(offer && stableWinningMate(move, before, after)) && !opponentError) return null;
  if (offer) return { kind: 'sacrifice', priority: 2 + Math.min(offer.investment, 9) / 10 };
  if (recapture(move, previousMove)) return null;
  if (routinePickup(context.played, context.position)) return null;
  const playedBest = before.bestMove === uciFor(move);
  if (playedBest && comparison?.gap >= 0.08 || opponentError) {
    return { kind: 'turning-point', priority: 1 + Math.min(1, Math.max(comparison?.gap || 0, previous == null ? 0 : prior - previous)) };
  }
  // A one-line quick scan cannot tell whether a quiet best move is the only
  // good choice. Nominate it below clearer tactical signals; the review caps
  // this fallback with the same small highlight budget as every other candidate.
  if (playedBest && prior >= 0.4 && prior <= 0.9) {
    const forcing = context.played.san.includes('+') || new Chess(move.before).isCheck();
    if (forcing || !comparison) return { kind: 'turning-point', priority: forcing ? 0.5 : 0.25 };
  }
  return null;
}

/** Independent local estimates, backed by deeper evidence rather than counts. */
export function classifyHighlight(move, before, after, { previousMove, previousEvaluation } = {}) {
  if (!exact(before) || !exact(after) || move?.promotion) return null;
  const prior = chance(before, move.color), next = chance(after, move.color);
  if (prior == null || next == null || prior < 0.25 || next < 0.4) return null;
  const context = movePosition(move);
  if (!context || !context.legal.some(candidate => uciFor(candidate) === before.bestMove)
    || !legalContinuation(move, after)) return null;
  const comparison = alternatives(move, before, context.legal);
  // The played root choice has the same score as the root's best candidate.
  // Allow modest adjacent-search drift only with coherent multi-line evidence;
  // a large discrepancy still prevents a highlight until it is resolved.
  const playedBest = before.bestMove === uciFor(move);
  if (prior - next > (playedBest && comparison ? 0.03 : 0.01)) return null;
  const offer = sacrificeOffer(move, { previousMove });
  // In a won position, require evidence that the simpler alternatives do not
  // also keep the same overwhelming advantage. A verified mating combination
  // after the opponent actually accepts a sacrifice is independently notable.
  const alreadyWon = prior > 0.9 && (!comparison || comparison.next > 0.9);
  if (offer && (!alreadyWon || verifiedMatingSacrifice(move, before, after, offer))) return 'Brilliant';
  if (recapture(move, previousMove) || !comparison || routinePickup(context.played, context.position)) return null;
  if (criticalContinuation(move, before, after, comparison, previousEvaluation, previousMove)) return 'Great';
  if (alreadyWon || !playedBest) return null;
  const onlyGood = prior >= 0.45 && comparison.next < 0.4 && comparison.gap >= 0.1;
  const critical = prior >= 0.5 && comparison.next < 0.65 && comparison.gap >= 0.15;
  return onlyGood || critical ? 'Great' : null;
}
