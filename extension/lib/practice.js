import { Chess } from '../vendor/chess.js';
import { StockfishEngine } from './engine.js';
import { expectedScore } from './review.js';
import { parseCompletedPgn } from './pgn.js';
import { moveUci } from './study.js';

const abortCheck = signal => { if (signal?.aborted) throw new DOMException('Practice check canceled.', 'AbortError'); };
function terminalEvaluation(chess) {
  if (chess.isCheckmate()) return { cp: chess.turn() === 'w' ? -100000 : 100000, mate: 0, bestMove: null, pv: [], depth: 0, candidates: [] };
  if (chess.isDraw()) return { cp: 0, mate: null, bestMove: null, pv: [], depth: 0, candidates: [] };
  return null;
}
function validScore(value) { return value && Number.isFinite(value.cp) && (value.mate == null || Number.isInteger(value.mate)); }
function mateWinner(evaluation) { return evaluation.mate == null ? null : evaluation.cp > 0 ? 'w' : evaluation.cp < 0 ? 'b' : null; }
function sanFor(chess, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) return null;
  try { return new Chess(chess.fen()).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return null; }
}

/** Check an attempt at the original move's 1-based ply; both searches keep full history. */
export async function gradeRetry(pgn, attemptedPly, uci, { engineFactory = () => new StockfishEngine(), moveTimeMs = 1000, signal } = {}) {
  abortCheck(signal);
  const game = parseCompletedPgn(pgn).parsed;
  if (!Number.isInteger(attemptedPly) || attemptedPly < 1 || attemptedPly > game.moves.length) throw new Error('Choose a move from the completed game to retry.');
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) throw new Error('Choose a legal move before checking your answer.');
  const replay = new Chess(game.positions[0]);
  const history = [];
  for (const move of game.moves.slice(0, attemptedPly - 1)) { replay.move({ from: move.from, to: move.to, promotion: move.promotion }); history.push(moveUci(move)); }
  const baseline = new Chess(replay.fen());
  const color = replay.turn();
  let attempt;
  try { attempt = replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { throw new Error('That move is not legal in this position.'); }
  const engine = engineFactory();
  const time = Math.max(500, Math.min(5000, Math.round(Number(moveTimeMs) || 1000)));
  let before, after;
  try {
    await engine.init(signal); abortCheck(signal);
    // Rebuild the baseline's history as well, to detect threefold repetitions.
    const beforeReplay = new Chess(game.positions[0]);
    for (const original of game.moves.slice(0, attemptedPly - 1)) beforeReplay.move({ from: original.from, to: original.to, promotion: original.promotion });
    before = terminalEvaluation(beforeReplay) || await engine.evaluate(baseline.fen(), { moveTimeMs: time, multiPV: 1, signal, initialFen: game.positions[0], moves: [...history] });
    abortCheck(signal);
    after = terminalEvaluation(replay) || await engine.evaluate(replay.fen(), { moveTimeMs: time, multiPV: 1, signal, initialFen: game.positions[0], moves: [...history, uci] });
    abortCheck(signal);
  } finally { engine.dispose(); }
  const bestMove = before?.bestMove || null;
  const bestSan = sanFor(baseline, bestMove);
  const base = { bestMove, bestSan, attemptSan: attempt.san, before, after, attemptedPly, uci, color };
  if (!validScore(before) || !validScore(after)) return { ...base, status: 'uncertain', accepted: null, feedback: 'The engine did not return a reliable score. Try checking again with more time.' };
  const probabilityLoss = Math.max(0, expectedScore(before, color) - expectedScore(after, color));
  const cpLoss = Math.max(0, (before.cp - after.cp) * (color === 'w' ? 1 : -1));
  const beforeMate = mateWinner(before), afterMate = mateWinner(after);
  const losesMate = afterMate && afterMate !== color && beforeMate !== afterMate;
  const dropsMate = beforeMate === color && afterMate !== color;
  let accepted = !losesMate && !dropsMate && probabilityLoss <= 0.02 && cpLoss <= 50;
  // Mate distance affects the encoded cp number; preserving a forced win is enough.
  if (beforeMate === color && afterMate === color) accepted = true;
  // When both searches report an unavoidable loss, don't grade any move as solved.
  if ((beforeMate && beforeMate !== color && afterMate === beforeMate) || (!accepted && bestMove === uci)) {
    return { ...base, probabilityLoss, cpLoss, status: 'uncertain', accepted: null, feedback: beforeMate && beforeMate !== color ? 'The engine still sees a forced loss here. Try another critical moment, or use a deeper review.' : 'The engine changed its assessment of its own suggested move. Check again with more time before judging this attempt.' };
  }
  const feedback = accepted
    ? `${attempt.san} keeps the position close to the engine's best result at this search time.${bestMove !== uci ? ' Good alternatives count too.' : ''}`
    : losesMate ? `${attempt.san} allows the opponent a forced mate according to this search. Try another move.`
    : dropsMate ? `${attempt.san} gives up the forced mate the engine found. Try another move.`
    : `${attempt.san} loses about ${Math.round(probabilityLoss * 100)} percentage points of estimated chances${cpLoss >= 50 ? ` (${(cpLoss / 100).toFixed(1)} pawns of evaluation)` : ''} in this search. Try another move.`;
  return { ...base, probabilityLoss, cpLoss, status: accepted ? 'accepted' : 'retry', accepted, feedback };
}
