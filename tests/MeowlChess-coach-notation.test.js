import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachText } from '../extension/lib/coach-notation.js';

test('move references follow authored moves through personality text and repeated SAN', () => {
  const writer = createCoachText();
  const white = writer.move('Nf3', 'w');
  const black = writer.move('Nf3', 'b');
  const answer = writer.resolve(`Meow! Nf3 is a player name. Play ${white}; the reply is ${black}.`);
  assert.equal(answer.text, 'Meow! Nf3 is a player name. Play Nf3; the reply is Nf3.');
  assert.deepEqual(answer.notation.map(ref => ({ ...ref, text: answer.text.slice(ref.start, ref.end) })), [
    { start: 33, end: 36, san: 'Nf3', color: 'w', text: 'Nf3' },
    { start: 51, end: 54, san: 'Nf3', color: 'b', text: 'Nf3' },
  ]);
});

test('captures, disambiguation, promotions, castling and checkmate retain exact SAN', () => {
  for (const san of ['e4', 'exd5', 'Nbd2', 'R1e2', 'Qh4e1', 'Bxc6+', 'O-O', 'O-O-O+', 'e8=Q#', 'bxa1=N+']) {
    for (const color of ['w', 'b']) {
      const writer = createCoachText();
      assert.deepEqual(writer.resolve(writer.move(san, color)), {
        text: san, notation: [{ start: 0, end: san.length, san, color }],
      });
    }
  }
});

test('ordinary prose, square names, HTML and unknown marker text are untouched', () => {
  const writer = createCoachText();
  const text = 'Nf3 <img src=x> attacks c6. \uE000untrusted:0\uE001';
  assert.deepEqual(writer.resolve(text), { text, notation: [] });
  for (const [san, color] of [['Qh4', 'x'], ['<img>', 'w'], ['Nf3 here', 'w'], ['', 'b'], [null, 'w']]) {
    const value = writer.move(san, color);
    assert.deepEqual(writer.resolve(value), { text: typeof san === 'string' ? san : '', notation: [] });
  }
});

test('each answer owns its markers and repeated resolution is deterministic', () => {
  const first = createCoachText(), second = createCoachText();
  const firstMove = first.move('Nf3', 'w'), secondMove = second.move('Qh4#', 'b');
  assert.deepEqual(first.resolve(secondMove), { text: secondMove, notation: [] });
  assert.deepEqual(second.resolve(firstMove), { text: firstMove, notation: [] });
  assert.deepEqual(first.resolve(firstMove), first.resolve(firstMove));
  assert.deepEqual(first.resolve(`${firstMove} then ${firstMove}`), {
    text: 'Nf3 then Nf3', notation: [
      { start: 0, end: 3, san: 'Nf3', color: 'w' },
      { start: 9, end: 12, san: 'Nf3', color: 'w' },
    ],
  });
});
