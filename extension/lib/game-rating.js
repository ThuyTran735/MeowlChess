import { Chess } from '../vendor/chess.js';
import { expectedScore } from './review.js';

export const GAME_RATING_VERSION = 'meowlchess-rating-2';

const MIN_DECISIONS = 8;
const MIN_RATING = 100;
const MAX_RATING = 4000;
const MAX_ADJUSTMENT = 400;
const unavailable = (reason, eligibleMoves = 0) => ({ rating: null, eligibleMoves, reason });
const unavailableBoth = reason => ({ w: unavailable(reason), b: unavailable(reason) });

function playerRating(headers, color) {
  const value = headers?.[color === 'w' ? 'WhiteElo' : 'BlackElo'];
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value.trim())) return null;
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING ? rating : null;
}

/**
 * A conservative, rating-anchored study heuristic, not calibrated Elo or a
 * reproduction of another site's game rating. Keep the PGN's own rating scale;
 * do not convert Lichess ratings into Chess.com ratings, or invent an anchor.
 *
 * The reference loss (5 percentage points at rating 1000, falling gradually at
 * higher ratings), +/-400 adjustment limit, and 20-decision shrinkage are
 * project choices. They are not fitted estimates of human playing strength.
 * A short or shallow review stays close to the recorded player rating.
 */
export function estimateGameRatings(result) {
  if (!Array.isArray(result?.moves) || !Array.isArray(result?.positions)
    || result.positions.length !== result.moves.length + 1) return unavailableBoth('Incomplete analysis');
  if (result.moves.length > 1000) return unavailableBoth('Invalid analysis');

  const totals = { w: { loss: 0, count: 0, deep: 0 }, b: { loss: 0, count: 0, deep: 0 } };
  const invalid = new Set();
  for (let index = 0; index < result.moves.length; index++) {
    const move = result.moves[index];
    if (!move || !['w', 'b'].includes(move.color)) return unavailableBoth('Invalid analysis');
    const before = result.positions[index];
    const after = result.positions[index + 1];
    if (!before || !Number.isFinite(before.cp) || (before.mate != null && !Number.isInteger(before.mate))
      || !Number.isFinite(move.probabilityLoss) || move.probabilityLoss < 0 || move.probabilityLoss > 1
      || typeof move.before !== 'string'
      || (Array.isArray(result.game?.positions) && result.game.positions[index] !== move.before)) {
      invalid.add(move.color);
      continue;
    }
    if (move.label === 'Book' || move.isBook === true) continue;
    const chances = expectedScore(before, move.color);
    // Easy moves in an already decisive position add little evidence. A move
    // that gives away a meaningful part of that advantage must still count.
    if ((before.mate != null || chances < 0.1 || chances > 0.9) && move.probabilityLoss < 0.01) continue;
    try {
      const position = new Chess(move.before);
      if (position.turn() !== move.color) { invalid.add(move.color); continue; }
      if (position.moves().length < 2) continue;
    } catch {
      invalid.add(move.color);
      continue;
    }
    const side = totals[move.color];
    side.count++;
    // Labels and accuracy overrides are not evidence of error-free play.
    side.loss += move.probabilityLoss;
    if (before.depth >= 12 && after?.depth >= 12) side.deep++;
  }

  return Object.fromEntries(['w', 'b'].map(color => {
    const { loss, count, deep } = totals[color];
    if (invalid.has(color)) return [color, unavailable('Invalid analysis', count)];
    const baseline = playerRating(result.game?.headers, color);
    if (baseline === null) return [color, unavailable('Player rating unavailable', count)];
    if (count < MIN_DECISIONS) return [color, unavailable('Not enough moves', count)];
    const meanLoss = loss / count;
    const referenceLoss = 0.05 * Math.exp((1000 - baseline) / 1400);
    const quality = (referenceLoss - meanLoss) / (referenceLoss + meanLoss);
    const depthCoverage = deep / count;
    const reliability = count / (count + 20) * (0.5 + 0.5 * depthCoverage);
    const lower = Math.ceil(Math.max(MIN_RATING, baseline - MAX_ADJUSTMENT) / 50) * 50;
    const upper = Math.floor(Math.min(MAX_RATING, baseline + MAX_ADJUSTMENT) / 50) * 50;
    const estimate = Math.round((baseline + MAX_ADJUSTMENT * quality * reliability) / 50) * 50;
    const rating = Math.max(lower, Math.min(upper, estimate));
    return [color, { rating, eligibleMoves: count, reason: null, baseline,
      confidence: count >= 20 && depthCoverage >= 0.75 ? 'moderate' : 'low' }];
  }));
}
