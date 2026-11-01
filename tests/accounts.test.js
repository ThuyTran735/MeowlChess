import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_LIMIT, accountUsername, normalizeAccounts, rememberAccount, forgetAccount } from '../extension/lib/accounts.js';

test('only valid provider usernames enter account history, never URLs or credentials', () => {
  assert.equal(accountUsername('chesscom', '  Cat_Name-9  '), 'Cat_Name-9');
  assert.equal(accountUsername('lichess', 'Owl_Name-9'), 'Owl_Name-9');
  for (const source of ['chesscom', 'lichess']) {
    for (const value of ['', 'a', null, {}, ['cat'], 123, 'white cat', '<cat>', 'cat@example.org', 'https://lichess.org/abcdefgh', 'https://www.chess.com/game/live/123', 'cat:password']) {
      assert.equal(accountUsername(source, value), null, `${source}: ${value}`);
    }
  }
  assert.equal(accountUsername('chesscom', 'c'.repeat(50)), 'c'.repeat(50));
  assert.equal(accountUsername('chesscom', 'c'.repeat(51)), null);
  assert.equal(accountUsername('lichess', 'c'.repeat(30)), 'c'.repeat(30));
  assert.equal(accountUsername('lichess', 'c'.repeat(31)), null);
  for (const source of ['unknown', '__proto__', 'constructor', undefined]) assert.equal(accountUsername(source, 'Cat'), null);
});

test('normalization deduplicates case-insensitively, retains spelling and provider separation', () => {
  assert.deepEqual(normalizeAccounts({ chesscom: [' Cat ', 'cat', 'CAT', 'Fox', false, ''], lichess: ['Cat', 'owl', 'OWL'], unknown: ['Dog'] }), {
    chesscom: ['Cat', 'Fox'], lichess: ['Cat', 'owl'],
  });
  for (const value of [null, undefined, 'cat', [], 1]) assert.deepEqual(normalizeAccounts(value), { chesscom: [], lichess: [] });
  assert.deepEqual(normalizeAccounts({ chesscom: 'cat', lichess: {} }), { chesscom: [], lichess: [] });
  assert.deepEqual(normalizeAccounts(Object.create({ chesscom: ['Inherited'] })), { chesscom: [], lichess: [] });
});

test('history caps each source at ten unique usernames after discarding invalid entries', () => {
  const names = Array.from({ length: 15 }, (_, index) => `Cat${index}`);
  assert.equal(ACCOUNT_LIMIT, 10);
  assert.deepEqual(normalizeAccounts({ chesscom: ['', 'a', ...names], lichess: names }).chesscom, names.slice(0, 10));
  assert.equal(normalizeAccounts({ chesscom: names, lichess: names }).lichess.length, 10);
});

test('remembering promotes latest spelling, preserves another provider, and evicts only the oldest', () => {
  const original = { chesscom: ['Cat', 'Fox'], lichess: ['Owl'] };
  const result = rememberAccount(original, 'chesscom', ' fOX ');
  assert.deepEqual(result, { chesscom: ['fOX', 'Cat'], lichess: ['Owl'] });
  assert.deepEqual(original, { chesscom: ['Cat', 'Fox'], lichess: ['Owl'] });
  const full = { chesscom: Array.from({ length: 10 }, (_, index) => `Cat${index}`), lichess: ['Owl'] };
  const extended = rememberAccount(full, 'chesscom', 'NewCat');
  assert.deepEqual(extended.chesscom, ['NewCat', ...full.chesscom.slice(0, 9)]);
  assert.deepEqual(extended.lichess, ['Owl']);
  assert.deepEqual(rememberAccount(original, 'chesscom', 'https://lichess.org/abcdefgh'), original);
  assert.deepEqual(rememberAccount(original, 'unknown', 'NewCat'), original);
});

test('forget removes only the selected provider identity and never modifies the input', () => {
  const original = { chesscom: ['Cat', 'Fox'], lichess: ['Cat', 'Owl'] };
  assert.deepEqual(forgetAccount(original, 'chesscom', ' cAT '), { chesscom: ['Fox'], lichess: ['Cat', 'Owl'] });
  assert.deepEqual(original, { chesscom: ['Cat', 'Fox'], lichess: ['Cat', 'Owl'] });
  assert.deepEqual(forgetAccount(original, 'chesscom', 'Missing'), original);
  assert.deepEqual(forgetAccount(original, 'constructor', 'Cat'), original);
  assert.deepEqual(forgetAccount({ chesscom: ['Cat'] }, 'chesscom', 'Cat'), { chesscom: [], lichess: [] });
});
