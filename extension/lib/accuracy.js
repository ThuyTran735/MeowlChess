// Uses the public Lichess accuracy method: https://lichess.org/page/accuracy
// Implemented here with MeowlChess evaluations and its exclusion of Book moves.
export const ACCURACY_VERSION = 'volatility-1';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function moveAccuracy(probabilityLoss) {
  if (probabilityLoss <= 0) return 100;
  return clamp(103.1668 * Math.exp(-0.04354 * probabilityLoss * 100) - 3.1669, 0, 100);
}

function whiteChances(evaluation) {
  if (evaluation.mate != null) return evaluation.cp > 0 ? 100 : 0;
  return 100 / (1 + Math.exp(-0.00368208 * evaluation.cp));
}

export function gameAccuracy(moves, positions, color, version = ACCURACY_VERSION) {
  const scored = moves.map((move, index) => ({ move, index }))
    .filter(({ move }) => move.color === color && move.accuracy !== null);
  if (!scored.length) return null;
  // Keep old saved reviews readable with their original summary calculation.
  if (version == null) return Math.round(scored.reduce((sum, { move }) => sum + move.accuracy, 0) / scored.length * 10) / 10;
  if (version !== ACCURACY_VERSION) throw new Error('Unsupported accuracy calculation.');
  const chances = positions.map(whiteChances);
  const windowSize = Math.min(chances.length, clamp(Math.floor(moves.length / 10), 2, 8));
  let weighted = 0, weightTotal = 0, reciprocal = 0, zero = false;
  for (const { move, index } of scored) {
    const start = Math.max(0, index - windowSize + 2);
    const window = chances.slice(start, start + windowSize);
    const mean = window.reduce((sum, chance) => sum + chance, 0) / window.length;
    const volatility = Math.sqrt(window.reduce((sum, chance) => sum + (chance - mean) ** 2, 0) / window.length);
    const weight = clamp(volatility, 0.5, 12);
    weighted += move.accuracy * weight; weightTotal += weight;
    if (move.accuracy === 0) zero = true;
    else reciprocal += 1 / move.accuracy;
  }
  const harmonic = zero ? 0 : scored.length / reciprocal;
  return Math.round(clamp((weighted / weightTotal + harmonic) / 2, 0, 100) * 10) / 10;
}
