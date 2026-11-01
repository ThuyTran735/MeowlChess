import { Chess } from '../vendor/chess.js';
import { expectedScore } from './review.js';

export const GAME_RATING_VERSION = 'meowlchess-rating-1';

const MIN_DECISIONS = 8;
const unavailable = (reason, eligibleMoves = 0) => ({ rating: null, eligibleMoves, reason });
const unavailableBoth = reason => ({ w: unavailable(reason), b: unavailable(reason) });

/**
 * A project-defined study heuristic, not a calibrated Elo prediction.
 * Account ratings are deliberately unused. Derive it from saved analysis so
 * older reviews need neither another engine search nor a storage migration.
 */
export function estimateGameRatings(result) {
  if (!Array.isArray(result?.moves) || !Array.isArray(result?.positions)
    || result.positions.length !== result.moves.length + 1) return unavailableBoth('Incomplete analysis');
  if (result.moves.length > 1000) return unavailableBoth('Invalid analysis');

  const totals = { w: { loss: 0, count: 0 }, b: { loss: 0, count: 0 } };
  const invalid = new Set();
  for (let index = 0; index < result.moves.length; index++) {
    const move = result.moves[index];
    if (!move || !['w', 'b'].includes(move.color)) return unavailableBoth('Invalid analysis');
    const before = result.positions[index];
    if (!before || !Number.isFinite(before.cp) || (before.mate != null && !Number.isInteger(before.mate))
      || !Number.isFinite(move.probabilityLoss) || move.probabilityLoss < 0 || move.probabilityLoss > 1
      || typeof move.before !== 'string'
      || (Array.isArray(result.game?.positions) && result.game.positions[index] !== move.before)) {
      invalid.add(move.color);
      continue;
    }
    if (move.label === 'Book' || move.isBook === true || before.mate != null) continue;
    const chances = expectedScore(before, move.color);
    if (chances < 0.1 || chances > 0.9) continue;
    try {
      const position = new Chess(move.before);
      if (position.turn() !== move.color) { invalid.add(move.color); continue; }
      if (position.moves().length < 2) continue;
    } catch {
      invalid.add(move.color);
      continue;
    }
    totals[move.color].count++;
    // Use the observed probability loss even when a move was labelled Best.
    totals[move.color].loss += move.probabilityLoss;
  }

  return Object.fromEntries(['w', 'b'].map(color => {
    const { loss, count } = totals[color];
    if (invalid.has(color)) return [color, unavailable('Invalid analysis', count)];
    if (count < MIN_DECISIONS) return [color, unavailable('Not enough moves', count)];
    const meanLoss = loss / count;
    const rating = Math.round(Math.max(300, Math.min(2800, 2800 * Math.exp(-20 * meanLoss))) / 50) * 50;
    return [color, { rating, eligibleMoves: count, reason: null }];
  }));
}
