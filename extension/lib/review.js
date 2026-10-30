import { Chess } from '../vendor/chess.js';
import { StockfishEngine } from './engine.js';
import { recognizeOpening, OPENING_DATA_VERSION } from './openings.js';

export const REVIEW_SCHEMA_VERSION = 2;
export const ANALYSIS_VERSION = `meowlchess-analysis-2-${OPENING_DATA_VERSION.slice(0, 12)}`;

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);
export const MOVE_LABELS = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder'];
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const abortCheck = (signal) => { if (signal?.aborted) throw new DOMException('Review cancelled.', 'AbortError'); };

export function parseGame(pgn) {
  if (typeof pgn !== 'string' || pgn.length > 250000) throw new Error('This game has an invalid or oversized PGN.');
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

function materialBalance(chess, color) {
  return chess.board().flat().reduce((total, piece) => piece ? total + PIECE_VALUES[piece.type] * (piece.color === color ? 1 : -1) : total, 0);
}

// A deliberately narrow heuristic: the engine must accept the offered piece,
// and its full available continuation must still show a material investment.
// This avoids awarding Brilliant for ordinary exchanges and immediate recaptures.
export function isSoundSacrifice(move, before, after) {
  if (!move || !['n', 'b', 'r', 'q'].includes(move.piece) || move.promotion || !(before.depth >= 12 && after.depth >= 12)) return false;
  if (before.mate != null || expectedScore(before, move.color) > 0.9 || expectedScore(after, move.color) < 0.45) return false;
  if (expectedScore(before, move.color) - expectedScore(after, move.color) > 0.01 || !Array.isArray(after.pv) || after.pv.length < 4) return false;
  try {
    const original = new Chess(move.before);
    if (original.moves().length < 2) return false;
    const initialMaterial = materialBalance(original, move.color);
    const line = new Chess(move.after);
    for (let i = 0; i < after.pv.length; i++) {
      const uci = after.pv[i];
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return false;
      const reply = line.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (i === 0 && (reply.to !== move.to || reply.captured !== move.piece || initialMaterial - materialBalance(line, move.color) < 2)) return false;
    }
    return initialMaterial - materialBalance(line, move.color) >= 2;
  } catch { return false; }
}

export function classifyMove(before, after, color, isBest, { move, previousEvaluation, previousMove } = {}) {
  const probabilityLoss = Math.max(0, expectedScore(before, color) - expectedScore(after, color));
  const loss = Math.max(0, Math.round((before.cp - after.cp) * (color === 'w' ? 1 : -1)));
  let label = isBest ? 'Best' : probabilityLoss < 0.01 ? 'Excellent' : probabilityLoss < 0.04 ? 'Good' : probabilityLoss < 0.08 ? 'Inaccuracy' : probabilityLoss < 0.2 ? 'Mistake' : 'Blunder';
  if (isBest && move && isSoundSacrifice(move, before, after)) label = 'Brilliant';
  else if (isBest && move && previousEvaluation && before.depth >= 12 && after.depth >= 12 && previousEvaluation.depth >= 12 && probabilityLoss <= 0.01
    && expectedScore(before, color) >= 0.5 && expectedScore(before, color) - expectedScore(previousEvaluation, color) >= 0.12
    && !(previousMove?.captured && previousMove.to === move.to) && new Chess(move.before).moves().length > 1) label = 'Great';
  // A transparent study score, not a recreation of Chess.com's accuracy formula.
  return { label, loss, probabilityLoss, accuracy: isBest ? 100 : 100 * Math.exp(-5 * probabilityLoss) };
}

function sanFor(fen, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) return null;
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; }
  catch { return null; }
}

function explain(move, verdict, bestSan, after) {
  if (verdict.label === 'Book') return `${move.san} follows a known line in the local opening reference. Book moves are excluded from study scores.`;
  if (verdict.label === 'Brilliant') return `${move.san} offers a piece while keeping enough compensation in the engine line. This is a MeowlChess estimate.`;
  if (verdict.label === 'Great') return `${move.san} finds the engine’s best reply after the opponent’s error. This is a MeowlChess estimate.`;
  if (move.san.endsWith('#')) return `${move.san} delivers checkmate.`;
  if (verdict.label === 'Best') return `${move.san} matches the engine's preferred move at this search time.`;
  if (['Excellent', 'Good'].includes(verdict.label)) return `${move.san} keeps the position close to the engine's evaluation. ${bestSan ? `The engine preferred ${bestSan}.` : ''}`.trim();
  if (after.mate !== null && after.cp * (move.color === 'w' ? 1 : -1) < 0) {
    return `${move.san} leaves a forced mate for your opponent at this search depth.${bestSan ? ` Compare it with ${bestSan}.` : ''}`;
  }
  return `${move.san} reduces your estimated winning chances by ${Math.round(verdict.probabilityLoss * 100)} percentage points.${bestSan ? ` Consider ${bestSan} instead.` : ''}`;
}

export async function analyzeGame(pgn, { moveTimeMs = 150, multiPV = 1, smartAnalysis = false, recognizeOpenings = true, onProgress = () => {}, signal, engineFactory = () => new StockfishEngine() } = {}) {
  abortCheck(signal);
  const game = parseGame(pgn);
  const opening = recognizeOpenings ? recognizeOpening(game) : null;
  const selectedTime = Math.max(50, Math.min(5000, Math.round(Number(moveTimeMs) || 150)));
  const scanTimeMs = smartAnalysis ? Math.min(selectedTime, 150) : selectedTime;
  const recheckTimeMs = smartAnalysis ? Math.max(500, Math.min(selectedTime, 3000)) : 0;
  const pairLimit = Math.min(8, Math.max(1, Math.ceil(game.moves.length * 0.15)));
  const scanProgressTotal = game.positions.length + (smartAnalysis ? Math.min(game.positions.length, pairLimit * 2) : 0);
  const engine = engineFactory();
  const positions = [];
  const terminals = [];
  const histories = [[]];
  const rechecked = new Map();
  let recheckedMoves = [];
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
      onProgress(smartAnalysis
        ? { completed: i + 1, total: scanProgressTotal, phase: 'scan', phaseCompleted: i + 1, phaseTotal: game.positions.length }
        : { completed: i + 1, total: game.positions.length });
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
      const total = game.positions.length + pending.length;
      if (pending.length) onProgress({ completed: game.positions.length, total, phase: 'recheck', phaseCompleted: 0, phaseTotal: pending.length });
      for (let count = 0; count < pending.length; count++) {
        abortCheck(signal);
        const index = pending[count];
        const evaluation = await engine.evaluate(game.positions[index], { moveTimeMs: recheckTimeMs, multiPV, signal, initialFen: game.positions[0], moves: histories[index] });
        abortCheck(signal);
        rechecked.set(index, evaluation);
        onProgress({ completed: game.positions.length + count + 1, total, phase: 'recheck', phaseCompleted: count + 1, phaseTotal: pending.length });
      }
      abortCheck(signal);
      // Apply the completed pass together: a selected move never receives only
      // one side of its deeper comparison, and cancellation returns no half-result.
      for (const [index, evaluation] of rechecked) positions[index] = evaluation;
      if (!pending.length) onProgress({ completed: total, total, phase: 'complete', phaseCompleted: 0, phaseTotal: 0 });
      abortCheck(signal);
    }
  } finally { engine.dispose(); }
  const summary = Object.fromEntries(['w', 'b'].map(color => [color, { accuracy: null, counts: Object.fromEntries(MOVE_LABELS.map(label => [label, 0])), total: 0, scoredTotal: 0, bookTotal: 0 }]));
  const totals = { w: 0, b: 0 };
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
    else { side.scoredTotal++; totals[move.color] += verdict.accuracy; }
    const confirmed = smartAnalysis && [i, i + 1].every(index => !!terminals[index] || rechecked.has(index));
    return { ...move, ply: i + 1, ...verdict, bestSan, evalAfter: positions[i + 1], isBook, confirmed, opening: isBook ? opening.byPly[i] : null, explanation: explain(move, verdict, bestSan, positions[i + 1]) };
  });
  for (const color of ['w', 'b']) {
    const side = summary[color];
    if (side.scoredTotal) side.accuracy = Math.round(totals[color] / side.scoredTotal * 10) / 10;
  }
  return {
    game, positions, moves, summary, opening,
    analysis: {
      version: ANALYSIS_VERSION, schemaVersion: REVIEW_SCHEMA_VERSION,
      smartAnalysis: !!smartAnalysis, scanTimeMs, recheckTimeMs,
      recheckedPlies: [...rechecked.keys()].sort((a, b) => a - b), recheckedMoves,
      recheckedPositionCount: rechecked.size, positionCount: positions.length,
      openingDataVersion: recognizeOpenings ? OPENING_DATA_VERSION : null,
    },
  };
}
