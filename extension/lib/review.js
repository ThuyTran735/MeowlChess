import { Chess } from '../vendor/chess.js';
import { StockfishEngine } from './engine.js';
import { recognizeOpening, OPENING_DATA_VERSION } from './openings.js';
import { ACCURACY_VERSION, moveAccuracy, gameAccuracy } from './accuracy.js';
import { highlightCandidate, classifyHighlight } from './move-highlights.js';

export const REVIEW_SCHEMA_VERSION = 2;
export const ANALYSIS_VERSION = `meowlchess-analysis-4-${OPENING_DATA_VERSION.slice(0, 12)}`;

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);
export const MOVE_LABELS = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder'];
const abortCheck = (signal) => { if (signal?.aborted) throw new DOMException('Review cancelled.', 'AbortError'); };

export function parseGame(pgn) {
  if (typeof pgn !== 'string' || pgn.length > 250000 || new TextEncoder().encode(pgn).byteLength > 250000) throw new Error('This game has an invalid or oversized PGN.');
  const chess = new Chess();
  try { chess.loadPgn(pgn); } catch { throw new Error('The archived game contains an invalid PGN.'); }
  const headers = chess.getHeaders();
  if (!RESULTS.has(headers.Result)) throw new Error('Only completed games can be reviewed.');
  if (headers.Variant && !['standard', 'chess', 'normal'].includes(headers.Variant.toLowerCase())) {
    throw new Error('Only standard chess is supported.');
  }
  const moves = chess.history({ verbose: true });
  if (!moves.length) throw new Error('This game has no moves to review.');
  if (moves.length > 1000) throw new Error('This game is too long to review.');
  return { headers, moves, positions: [moves[0].before, ...moves.map(move => move.after)] };
}

export function expectedScore(evaluation, color = 'w') {
  const sign = color === 'w' ? 1 : -1;
  if (evaluation.mate !== null && evaluation.mate !== undefined) {
    return evaluation.cp * sign > 0 ? 1 : 0;
  }
  return 1 / (1 + Math.exp(-0.00368208 * evaluation.cp * sign));
}

// Shared with the full review so standalone classification uses the same evidence.
export function isSoundSacrifice(move, before, after) {
  return classifyHighlight(move, before, after) === 'Brilliant';
}

export function classifyMove(before, after, color, isBest, { move, previousEvaluation, previousMove } = {}) {
  const probabilityLoss = Math.max(0, expectedScore(before, color) - expectedScore(after, color));
  const loss = Math.max(0, Math.round((before.cp - after.cp) * (color === 'w' ? 1 : -1)));
  let label = isBest ? 'Best' : probabilityLoss < 0.01 ? 'Excellent' : probabilityLoss < 0.04 ? 'Good' : probabilityLoss < 0.08 ? 'Inaccuracy' : probabilityLoss < 0.2 ? 'Mistake' : 'Blunder';
  if (move) {
    const highlight = classifyHighlight(move, before, after, { previousEvaluation, previousMove });
    label = highlight || label;
  }
  return { label, loss, probabilityLoss, accuracy: isBest ? 100 : moveAccuracy(probabilityLoss) };
}

function sanFor(fen, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) return null;
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; }
  catch { return null; }
}

function explain(move, verdict, bestSan, after) {
  if (verdict.label === 'Book') return `${move.san} follows a known line in the local opening reference. Book moves are excluded from study scores.`;
  if (verdict.label === 'Brilliant') return `${move.san} offers a piece while keeping enough compensation in the engine line. This is a MeowlChess estimate.`;
  if (verdict.label === 'Great') return `${move.san} finds a critical choice or takes advantage of a tactical opportunity confirmed by the engine. This is a MeowlChess estimate.`;
  if (move.san.endsWith('#')) return `${move.san} delivers checkmate.`;
  if (verdict.label === 'Best') return `${move.san} matches the engine's preferred move at this search time.`;
  if (['Excellent', 'Good'].includes(verdict.label)) return `${move.san} keeps the position close to the engine's evaluation. ${bestSan ? `The engine preferred ${bestSan}.` : ''}`.trim();
  if (after.mate !== null && after.cp * (move.color === 'w' ? 1 : -1) < 0) {
    return `${move.san} leaves a forced mate for your opponent at this search depth.${bestSan ? ` Compare it with ${bestSan}.` : ''}`;
  }
  return `${move.san} reduces your estimated winning chances by ${Math.round(verdict.probabilityLoss * 100)} percentage points.${bestSan ? ` Consider ${bestSan} instead.` : ''}`;
}

export async function analyzeGame(pgn, { moveTimeMs = 150, multiPV = 1, smartAnalysis = false, highlightAnalysis = true, recognizeOpenings = true, onProgress = () => {}, signal, engineFactory = () => new StockfishEngine() } = {}) {
  abortCheck(signal);
  const startedAt = performance.now();
  const game = parseGame(pgn);
  const opening = recognizeOpenings ? recognizeOpening(game) : null;
  const selectedTime = Math.max(50, Math.min(5000, Math.round(Number(moveTimeMs) || 150)));
  const scanTimeMs = smartAnalysis ? Math.min(selectedTime, 150) : selectedTime;
  const recheckTimeMs = smartAnalysis ? Math.max(500, Math.min(selectedTime, 3000)) : 0;
  const pairLimit = Math.min(8, Math.max(1, Math.ceil(game.moves.length * 0.15)));
  const checkHighlights = highlightAnalysis !== false;
  const highlightLimit = Math.min(8, Math.max(1, Math.ceil(game.moves.length * 0.1)));
  const highlightTimeMs = checkHighlights ? Math.max(2000, Math.min(selectedTime, 3000)) : 0;
  const highlightReserve = checkHighlights ? Math.min(game.positions.length, highlightLimit * 3) : 0;
  const scanProgressTotal = game.positions.length + highlightReserve + (smartAnalysis ? Math.min(game.positions.length, pairLimit * 2) : 0);
  const engine = engineFactory();
  const positions = [];
  const terminals = [];
  const histories = [[]];
  const rechecked = new Map();
  let recheckedMoves = [];
  const highlightChecks = new Map();
  let highlightMoves = [];
  const replay = new Chess(game.positions[0]);
  try {
    await engine.init(signal);
    for (let i = 0; i < game.positions.length; i++) {
      abortCheck(signal);
      if (i > 0) {
        const move = game.moves[i - 1];
        replay.move({ from: move.from, to: move.to, promotion: move.promotion });
        histories.push([...histories[i - 1], `${move.from}${move.to}${move.promotion || ''}`]);
      }
      let terminal = null;
      if (replay.isCheckmate()) {
        terminal = { cp: replay.turn() === 'w' ? -100000 : 100000, mate: 0, bestMove: null, pv: [], depth: 0, candidates: [] };
      } else if (replay.isDraw()) {
        terminal = { cp: 0, mate: null, bestMove: null, pv: [], depth: 0, candidates: [] };
      }
      terminals.push(terminal);
      const evaluation = terminal || await engine.evaluate(game.positions[i], { moveTimeMs: scanTimeMs, multiPV, signal, initialFen: game.positions[0], moves: histories[i] });
      abortCheck(signal);
      positions.push(evaluation);
      onProgress({ completed: i + 1, total: scanProgressTotal, phase: 'scan', phaseCompleted: i + 1, phaseTotal: game.positions.length, moreWork: !!smartAnalysis || checkHighlights });
    }
    abortCheck(signal);
    if (smartAnalysis) {
      const important = game.moves.flatMap((move, index) => {
        const before = positions[index];
        const after = positions[index + 1];
        const sign = move.color === 'w' ? 1 : -1;
        const loss = expectedScore(before, move.color) - expectedScore(after, move.color);
        const lostMate = before.mate != null && before.cp * sign > 0 && (after.mate == null || after.cp * sign <= 0);
        const allowsMate = after.mate != null && after.cp * sign < 0 && (before.mate == null || before.cp * sign >= 0);
        return loss >= 0.04 || lostMate || allowsMate ? [{ index, priority: loss + (lostMate || allowsMate ? 1 : 0) }] : [];
      }).sort((a, b) => b.priority - a.priority || a.index - b.index).slice(0, pairLimit);
      recheckedMoves = important.map(({ index }) => index + 1).sort((a, b) => a - b);
      const pending = [...new Set(important.flatMap(({ index }) => [index, index + 1]))]
        .filter(index => !terminals[index]).sort((a, b) => a - b);
      const total = game.positions.length + pending.length + highlightReserve;
      if (pending.length) onProgress({ completed: game.positions.length, total, phase: 'recheck', phaseCompleted: 0, phaseTotal: pending.length, moreWork: checkHighlights });
      for (let count = 0; count < pending.length; count++) {
        abortCheck(signal);
        const index = pending[count];
        const evaluation = await engine.evaluate(game.positions[index], { moveTimeMs: recheckTimeMs, multiPV, signal, initialFen: game.positions[0], moves: histories[index] });
        abortCheck(signal);
        rechecked.set(index, evaluation);
        onProgress({ completed: game.positions.length + count + 1, total, phase: 'recheck', phaseCompleted: count + 1, phaseTotal: pending.length, moreWork: checkHighlights });
      }
      abortCheck(signal);
      // Apply the completed pass together: a selected move never receives only
      // one side of its deeper comparison, and cancellation returns no half-result.
      for (const [index, evaluation] of rechecked) positions[index] = evaluation;
      abortCheck(signal);
    }
    // Optional deeper checks can confirm rare labels missed by a fast scan.
    // Turning them off keeps normal classification from the available evidence.
    const highlights = checkHighlights ? game.moves.flatMap((move, index) => {
      if (classifyHighlight(move, positions[index], positions[index + 1], { previousEvaluation: positions[index - 1], previousMove: game.moves[index - 1] })) return [];
      const candidate = highlightCandidate(move, positions[index], positions[index + 1], {
        previousEvaluation: positions[index - 1], previousMove: game.moves[index - 1],
      });
      return candidate ? [{ index, ...candidate }] : [];
    }).sort((a, b) => b.priority - a.priority || a.index - b.index).slice(0, highlightLimit) : [];
    highlightMoves = highlights.map(({ index }) => index + 1).sort((a, b) => a - b);
    const highlightLines = engine.supportsMultiPV ? Math.max(2, multiPV) : multiPV;
    const pendingHighlights = [...new Set(highlights.flatMap(({ index, kind }) => [
      ...(kind === 'turning-point' && index > 0 && positions[index - 1].depth < 12 ? [index - 1] : []),
      index, index + 1,
    ]))]
      .filter(index => !terminals[index]).sort((a, b) => a - b);
    const completeBeforeHighlights = game.positions.length + rechecked.size;
    const finalTotal = completeBeforeHighlights + pendingHighlights.length;
    if (pendingHighlights.length) onProgress({ completed: completeBeforeHighlights, total: finalTotal, phase: 'highlights', phaseCompleted: 0, phaseTotal: pendingHighlights.length });
    for (let count = 0; count < pendingHighlights.length; count++) {
      abortCheck(signal);
      const index = pendingHighlights[count];
      const evaluation = await engine.evaluate(game.positions[index], { moveTimeMs: highlightTimeMs, multiPV: highlightLines, signal, initialFen: game.positions[0], moves: histories[index] });
      abortCheck(signal);
      highlightChecks.set(index, evaluation);
      onProgress({ completed: completeBeforeHighlights + count + 1, total: finalTotal, phase: 'highlights', phaseCompleted: count + 1, phaseTotal: pendingHighlights.length });
    }
    // A bounded highlight search must not downgrade a slower review's deeper
    // evidence, even when the new search includes more candidate lines.
    for (const [index, evaluation] of highlightChecks) {
      if (evaluation.depth >= positions[index].depth) positions[index] = evaluation;
    }
    onProgress({ completed: finalTotal, total: finalTotal, phase: 'complete', phaseCompleted: 0, phaseTotal: 0 });
    abortCheck(signal);
  } finally { engine.dispose(); }
  const summary = Object.fromEntries(['w', 'b'].map(color => [color, { accuracy: null, counts: Object.fromEntries(MOVE_LABELS.map(label => [label, 0])), total: 0, scoredTotal: 0, bookTotal: 0 }]));
  const moves = game.moves.map((move, i) => {
    const uci = `${move.from}${move.to}${move.promotion || ''}`;
    const bestSan = sanFor(move.before, positions[i].bestMove);
    const verdict = classifyMove(positions[i], positions[i + 1], move.color, positions[i].bestMove === uci, { move, previousEvaluation: positions[i - 1], previousMove: game.moves[i - 1] });
    // Opening names also cover traps and unsound lines. Preserve tactical errors,
    // special engine classifications, and mate rather than endorsing every name.
    const isBook = i < (opening?.lastBookPly || 0) && !move.san.endsWith('#') && ['Best', 'Excellent', 'Good'].includes(verdict.label);
    if (isBook) { verdict.label = 'Book'; verdict.accuracy = null; }
    const side = summary[move.color];
    side.counts[verdict.label]++;
    side.total++;
    if (isBook) side.bookTotal++;
    else side.scoredTotal++;
    const confirmed = smartAnalysis && [i, i + 1].every(index => !!terminals[index] || rechecked.has(index));
    return { ...move, ply: i + 1, ...verdict, bestSan, evalAfter: positions[i + 1], isBook, confirmed, opening: isBook ? opening.byPly[i] : null, explanation: explain(move, verdict, bestSan, positions[i + 1]) };
  });
  for (const color of ['w', 'b']) {
    const side = summary[color];
    side.accuracy = gameAccuracy(moves, positions, color);
  }
  return {
    game, positions, moves, summary, opening,
    analysis: {
      version: ANALYSIS_VERSION, schemaVersion: REVIEW_SCHEMA_VERSION,
      accuracyVersion: ACCURACY_VERSION,
      highlightAnalysis: checkHighlights, highlightMoves, highlightPositionCount: highlightChecks.size, highlightTimeMs,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      smartAnalysis: !!smartAnalysis, scanTimeMs, recheckTimeMs,
      recheckedPlies: [...rechecked.keys()].sort((a, b) => a - b), recheckedMoves,
      recheckedPositionCount: rechecked.size, positionCount: positions.length,
      openingDataVersion: recognizeOpenings ? OPENING_DATA_VERSION : null,
    },
  };
}
