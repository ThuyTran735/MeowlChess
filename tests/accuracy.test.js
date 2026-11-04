import test from 'node:test';
import assert from 'node:assert/strict';
import { moveAccuracy, gameAccuracy, ACCURACY_VERSION } from '../extension/lib/accuracy.js';

const position = cp => ({ cp, mate: null });
test('move scores are bounded and decline as the loss grows', () => {
  const scores = [0, .01, .05, .1, .5, 1].map(moveAccuracy);
  assert.equal(scores[0], 100);
  assert(scores.every(value => value >= 0 && value <= 100));
  assert(scores.every((value, index) => !index || value < scores[index - 1]));
});

test('a critical mistake is not washed away by easy moves in a decided game', () => {
  const positions = [position(0), ...Array.from({ length: 40 }, () => position(-900))];
  const moves = positions.slice(1).map((_, index) => ({ color: index % 2 ? 'b' : 'w', accuracy: index ? 100 : 20 }));
  const legacy = gameAccuracy(moves, positions, 'w', null);
  const weighted = gameAccuracy(moves, positions, 'w');
  assert.equal(legacy, 96);
  assert(weighted < legacy - 10);
  assert.equal(gameAccuracy(moves, positions, 'b'), 100);
});

test('book moves stay unscored and zero-score moves stay finite', () => {
  const moves = [{ color: 'w', accuracy: null }, { color: 'b', accuracy: 0 }, { color: 'w', accuracy: 100 }];
  const positions = [0, 0, 3000, 3000].map(position);
  assert.equal(gameAccuracy(moves, positions, 'w'), 100);
  assert.equal(gameAccuracy(moves, positions, 'b'), 0);
  assert.equal(gameAccuracy([{ color: 'w', accuracy: null }], positions.slice(0, 2), 'w'), null);
  assert.throws(() => gameAccuracy(moves, positions, 'w', 'unknown'), /Unsupported/);
  assert.equal(gameAccuracy(moves, positions, 'w', ACCURACY_VERSION), 100);
});

test('swapping colors and evaluation signs preserves both scores', () => {
  const moves = Array.from({ length: 30 }, (_, i) => ({ color: i % 2 ? 'b' : 'w', accuracy: i % 7 ? 100 : 35 }));
  const positions = Array.from({ length: 31 }, (_, i) => position(Math.sin(i) * 400));
  const swappedMoves = moves.map(move => ({ ...move, color: move.color === 'w' ? 'b' : 'w' }));
  const swappedPositions = positions.map(p => ({ ...p, cp: -p.cp }));
  assert.equal(gameAccuracy(moves, positions, 'w'), gameAccuracy(swappedMoves, swappedPositions, 'b'));
  assert.equal(gameAccuracy(moves, positions, 'b'), gameAccuracy(swappedMoves, swappedPositions, 'w'));
});
