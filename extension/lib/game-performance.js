// Phase summaries are presentation data derived from an existing completed review.
// They do not run an engine or change saved move classifications.
export const PHASE_PERFORMANCE_VERSION = 1;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WEIGHTS = { n: 1, b: 1, r: 2, q: 4, p: 0, k: 0 };
const LABELS = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder']);
const PREFERRED = new Set(['Brilliant', 'Great', 'Best']);
const CLEAN = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good']);

function materialPhase(fen) {
  if (typeof fen !== 'string') return null;
  const ranks = fen.split(' ')[0].split('/');
  if (ranks.length !== 8) return null;
  let material = 0, whiteKings = 0, blackKings = 0;
  for (const rank of ranks) {
    let squares = 0;
    for (const piece of rank) {
      if (/^[1-8]$/.test(piece)) squares += Number(piece);
      else if (Object.hasOwn(WEIGHTS, piece.toLowerCase())) {
        squares++;
        material += WEIGHTS[piece.toLowerCase()];
        if (piece === 'K') whiteKings++;
        if (piece === 'k') blackKings++;
      } else return null;
    }
    if (squares !== 8) return null;
  }
  return whiteKings === 1 && blackKings === 1 ? material : null;
}

function summarize(moves) {
  const scored = moves.filter(move => move.label !== 'Book');
  const side = { label: null, total: moves.length, scoredTotal: scored.length, meanLoss: null };
  if (!moves.length) return side;
  if (!scored.length) return { ...side, label: 'Book' };
  const mean = scored.reduce((sum, move) => sum + move.probabilityLoss, 0) / scored.length;
  side.meanLoss = mean;
  // A special move only represents the whole phase when the rest was clean.
  // In particular, a Brilliant move must not conceal a later mistake/blunder.
  const clean = mean < 0.01 && scored.every(move => CLEAN.has(move.label) && move.probabilityLoss < 0.04);
  if (clean && scored.some(move => move.label === 'Brilliant')) side.label = 'Brilliant';
  else if (clean && scored.some(move => move.label === 'Great')) side.label = 'Great';
  else if (mean < 0.01 && scored.every(move => PREFERRED.has(move.label))) side.label = 'Best';
  else side.label = mean < 0.01 ? 'Excellent' : mean < 0.04 ? 'Good' : mean < 0.08 ? 'Inaccuracy' : mean < 0.2 ? 'Mistake' : 'Blunder';
  return side;
}

/**
 * Opening: first 20 plies from the standard starting position, unless the
 * endgame threshold has already been reached. A custom start is never opening.
 * Endgame: before-move N/B=1, R=2, Q=4 material totals <=6 (initially 24).
 * Once entered, the endgame remains the endgame even after a promotion.
 * The move causing the material reduction belongs to its starting phase.
 */
export function getPhasePerformance(result) {
  const phases = [
    { id: 'opening', name: 'Opening' },
    { id: 'middlegame', name: 'Middlegame' },
    { id: 'endgame', name: 'Endgame' },
  ].map(phase => ({ ...phase, firstPly: null, lastPly: null, moves: { w: [], b: [] } }));
  const moves = Array.isArray(result?.moves) ? result.moves : [];
  const standard = (result?.game?.positions?.[0] || moves[0]?.before) === START;
  let endgame = false;
  moves.forEach((move, index) => {
    const material = materialPhase(move?.before);
    if (material === null) return;
    if (!['w', 'b'].includes(move.color) || !LABELS.has(move.label)
      || !Number.isFinite(move.probabilityLoss) || move.probabilityLoss < 0 || move.probabilityLoss > 1) return;
    if (material <= 6) endgame = true;
    const phase = phases[endgame ? 2 : standard && index < 20 ? 0 : 1];
    phase.firstPly ??= index + 1;
    phase.lastPly = index + 1;
    phase.moves[move.color].push(move);
  });
  return phases.map(({ moves: byColor, ...phase }) => ({ ...phase, w: summarize(byColor.w), b: summarize(byColor.b) }));
}
