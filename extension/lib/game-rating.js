import { Chess } from '../vendor/chess.js';
import { expectedScore } from './review.js';

export const GAME_RATING_VERSION = 'meowlchess-rating-3';

const MIN_DECISIONS = 8;
const MIN_RATING = 100;
const MAX_RATING = 4000;
const REFERENCE_SCALE = 1400;
const PRIOR_DECISIONS = 4;
const UPWARD_EVIDENCE_DECISIONS = 40;
const clampRating = value => Math.max(MIN_RATING, Math.min(MAX_RATING, value));
const unavailable = (reason, eligibleMoves = 0) => ({ rating: null, eligibleMoves, reason });
const unavailableBoth = reason => ({ w: unavailable(reason), b: unavailable(reason) });

function playerRating(headers, color) {
  const value = headers?.[color === 'w' ? 'WhiteElo' : 'BlackElo'];
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value.trim())) return null;
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING ? rating : null;
}

/**
 * An experimental, rating-referenced study heuristic, not calibrated Elo or a
 * reproduction of another site's game rating. Keep the PGN's own rating scale;
 * do not convert Lichess ratings into Chess.com ratings, or invent an anchor.
 *
 * Invert the existing reference-loss curve instead of squeezing every outcome
 * into +/-400 of the account rating. Four reference decisions regularize small
 * samples and zero loss. Only positive adjustments are tempered: error-free
 * short/easy play is weak evidence of stronger human play. Search coverage
 * widens uncertainty; it must not make bad play look closer to the account.
 *
 * The reference curve and safeguards are project choices, NOT fitted human
 * Elo predictions. The range is a sensitivity guide, not a confidence interval.
 */
export function estimateGameRatings(result) {
  if (!Array.isArray(result?.moves) || !Array.isArray(result?.positions)
    || result.positions.length !== result.moves.length + 1) return unavailableBoth('Incomplete analysis');
  if (result.moves.length > 1000) return unavailableBoth('Invalid analysis');

  const totals = { w: { loss: 0, squaredLoss: 0, count: 0, deep: 0 }, b: { loss: 0, squaredLoss: 0, count: 0, deep: 0 } };
  const invalid = new Set();
  for (let index = 0; index < result.moves.length; index++) {
    const move = result.moves[index];
    if (!move || !['w', 'b'].includes(move.color)) return unavailableBoth('Invalid analysis');
    const before = result.positions[index];
    const after = result.positions[index + 1];
    if (!before || !after || !Number.isFinite(before.cp) || !Number.isFinite(after.cp)
      || (before.mate != null && !Number.isInteger(before.mate))
      || (after.mate != null && !Number.isInteger(after.mate))
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
    side.squaredLoss += move.probabilityLoss ** 2;
    if (Number.isInteger(before.depth) && Number.isInteger(after.depth)
      && before.depth >= 12 && after.depth >= 12) side.deep++;
  }

  return Object.fromEntries(['w', 'b'].map(color => {
    const { loss, squaredLoss, count, deep } = totals[color];
    if (invalid.has(color)) return [color, unavailable('Invalid analysis', count)];
    const baseline = playerRating(result.game?.headers, color);
    if (baseline === null) return [color, unavailable('Player rating unavailable', count)];
    if (count < MIN_DECISIONS) return [color, unavailable('Not enough moves', count)];
    const meanLoss = loss / count;
    const referenceLoss = 0.05 * Math.exp((1000 - baseline) / REFERENCE_SCALE);
    const regularizedLoss = (loss + PRIOR_DECISIONS * referenceLoss) / (count + PRIOR_DECISIONS);
    const rawAdjustment = REFERENCE_SCALE * Math.log(referenceLoss / regularizedLoss);
    const depthCoverage = deep / count;
    // Temper upward estimates for limited evidence without flattening different
    // quality levels at a fixed ceiling. Poor play has no matching floor near
    // the account rating. This is a study safeguard, not human-strength training.
    const adjustment = rawAdjustment > 0
      ? rawAdjustment * count / (count + UPWARD_EVIDENCE_DECISIONS) : rawAdjustment;
    const rating = clampRating(Math.round((baseline + adjustment) / 50) * 50);
    const variance = Math.max(0, (squaredLoss - loss * loss / count) / (count - 1));
    const samplingSpread = REFERENCE_SCALE * Math.sqrt(variance / count) / regularizedLoss;
    // Deliberately broad even when all observed losses happen to be identical.
    // This also reflects missing depth and finite game length, not just variance.
    const margin = Math.ceil((Math.max(200, samplingSpread) + 600 / Math.sqrt(count)
      + 200 * (1 - depthCoverage)) / 50) * 50;
    const range = { low: clampRating(rating - margin), high: clampRating(rating + margin) };
    return [color, { rating, eligibleMoves: count, reason: null, baseline,
      range, meanLoss, depthCoverage,
      confidence: count >= 20 && depthCoverage >= 0.75 ? 'moderate' : 'low' }];
  }));
}

export function gameRatingDescription(estimate) {
  if (!Number.isFinite(estimate?.rating)) return estimate?.reason || 'Not enough moves';
  return `Experimental game estimate, not account Elo or a calibrated Chess.com rating. `
    + `${estimate.eligibleMoves} reviewable decisions; average winning-chance loss ${(estimate.meanLoss * 100).toFixed(1)} percentage points. `
    + `Recorded player rating: ${estimate.baseline}. ${estimate.confidence === 'low' ? 'Limited' : 'Broader'} analysis coverage. `
    + `Rough range ${estimate.range.low.toLocaleString()}–${estimate.range.high.toLocaleString()}: a sensitivity guide, not a statistical confidence interval.`;
}
