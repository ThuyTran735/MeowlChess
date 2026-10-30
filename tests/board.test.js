import test from 'node:test';
import assert from 'node:assert/strict';
import { squareCenter, moveArrowPath } from '../extension/lib/board.js';

test('square centers match the displayed files and ranks in both orientations', () => {
  assert.deepEqual(squareCenter('a8'), { x: 50, y: 50 });
  assert.deepEqual(squareCenter('h1'), { x: 750, y: 750 });
  assert.deepEqual(squareCenter('e4'), { x: 450, y: 450 });
  for (const file of 'abcdefgh') for (const rank of '12345678') {
    const white = squareCenter(file + rank), black = squareCenter(file + rank, true);
    assert.equal(white.x + black.x, 800);
    assert.equal(white.y + black.y, 800);
  }
});

test('arrows follow ordinary, castling, promotion, and knight moves after flipping', () => {
  assert.equal(moveArrowPath('e2e4'), 'M 450 650 L 450 450');
  assert.equal(moveArrowPath('e2e4', true), 'M 350 150 L 350 350');
  assert.equal(moveArrowPath('e1g1'), 'M 450 750 L 650 750');
  assert.equal(moveArrowPath('a7a8q'), 'M 50 150 L 50 50');
  assert.equal(moveArrowPath('g1f3'), 'M 650 750 L 650 550 L 550 550');
  assert.equal(moveArrowPath('g1f3', true), 'M 150 50 L 150 250 L 250 250');
  assert.equal(moveArrowPath('b1d2'), 'M 150 750 L 350 750 L 350 650');
});

test('malformed squares, moves, and zero-length arrows do not render', () => {
  for (const square of [null, '', 'a0', 'i4', 'e9', 'e44']) assert.equal(squareCenter(square), null);
  for (const move of [null, '', 'e2e2', 'a0a1', 'a7a8x', 'e2e4\ngo infinite']) assert.equal(moveArrowPath(move), null);
});
