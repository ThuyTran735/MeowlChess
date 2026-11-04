import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { completedPageGame } from '../extension/lib/site-review.js';

const source = await readFile(new URL('../extension/site-bot.js', import.meta.url), 'utf8');
const gameUrl = 'https://www.chess.com/game/live/186378605424';
// Public completed game, copied from Chess.com's Share → PGN interface. Its
// navigation parameters and promotion are retained as a realistic export input.
const exportedPgn = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.02"]
[Round "?"]
[White "NaGmOr-5"]
[Black "DillPickleChips1"]
[Result "0-1"]
[TimeControl "600"]
[WhiteElo "958"]
[BlackElo "988"]
[Termination "DillPickleChips1 won by resignation"]
[ECO "D30"]
[EndTime "5:26:44 GMT+0000"]
[Link "https://www.chess.com/game/live/186378605424?username=dillpicklechips1&move=0"]

1. d4 d5 2. c4 e6 3. Nf3 Nf6 4. e3 Bb4+ 5. Nc3 O-O 6. Qc2 Nc6 7. a3 Bxc3+ 8.
bxc3 Re8 9. a4 e5 10. Ba3 e4 11. Nd2 Na5 12. Be2 Bg4 13. Nb1 Bxe2 14. Qxe2 Nxc4
15. O-O c6 16. Nd2 Nxa3 17. Rxa3 a5 18. c4 b6 19. Rd1 Qd6 20. Raa1 Rab8 21. Nf1
dxc4 22. Qxc4 b5 23. Qc2 b4 24. Ng3 Nd5 25. Nxe4 Qg6 26. f3 Nxe3 27. Qf2 Nxd1
28. Rxd1 b3 29. Rb1 Rb4 30. Nc3 Reb8 31. Qe3 Rxa4 32. Nxa4 Qxb1+ 33. Kf2 Qa2+
34. Kg3 Qxa4 35. h4 b2 36. h5 b1=Q 37. h6 Qbb3 38. Qe7 Qe6 0-1`;

function exportFixture(options = {}) {
  const { modalAt = 0, tabAt = 0, pgnAt = 0, pgn = exportedPgn, alreadyOpen = false,
    cancelAt = Infinity, navigateAt = Infinity, navigateOnOpen = false, wallClock = elapsed => elapsed,
    initialPath = '/game/live/186378605424', controlsAvailable = true, controlsDisabled = false,
    shareAvailable = false } = options;
  let elapsed = 0, clicked = false, closed = false, destinationClosed = false, controlsPresent = controlsAvailable, attempts = 0;
  const outcomes = [];
  const calls = { downloads: 0, tabs: 0, closes: 0, destinationCloses: 0 };
  const location = { hostname: 'www.chess.com', protocol: 'https:', origin: 'https://www.chess.com', pathname: initialPath };
  const rectangle = () => ({ width: 100, height: 40 });
  const close = { getBoundingClientRect: rectangle, click() { closed = true; calls.closes++; } };
  const destinationClose = { getBoundingClientRect: rectangle, click() { destinationClosed = true; calls.destinationCloses++; } };
  const tab = { getBoundingClientRect: rectangle, disabled: false, click() { calls.tabs++; } };
  const modal = { getBoundingClientRect: rectangle, querySelector(selector) {
    if (selector.includes('cc-modal-header-close')) return close;
    return elapsed >= tabAt ? tab : null;
  } };
  const destinationModal = { getBoundingClientRect: rectangle, querySelector() { return destinationClose; } };
  const isDestination = () => location.pathname !== initialPath;
  const currentModal = () => isDestination() ? destinationClosed ? null : destinationModal
    : (clicked || alreadyOpen) && !closed && elapsed >= modalAt ? modal : null;
  const download = { getBoundingClientRect: rectangle, disabled: controlsDisabled, click() {
    clicked = true; calls.downloads++;
    if (navigateOnOpen) location.pathname = '/game/live/186378605425';
  } };
  const share = { ...download, disabled: false };
  const field = { getBoundingClientRect: rectangle, value: pgn };
  const document = {
    querySelector(selector) {
      const current = currentModal();
      if (!current) return null;
      return selector.includes('share-menu-modal-header') ? { closest: () => current } : current;
    },
    querySelectorAll(selector) {
      if (selector.includes('textarea')) return !isDestination() && currentModal() && elapsed >= pgnAt && calls.tabs ? [field] : [];
      if (!controlsPresent) return [];
      return selector.includes('[aria-label="Share"]') ? shareAvailable ? [share] : [] : [download];
    },
  };
  const context = { location, document, getComputedStyle: () => ({ visibility: 'visible' }),
    performance: { now: () => elapsed }, Date: { now: () => wallClock(elapsed) },
    setTimeout(callback, delay) {
      elapsed += delay;
      if (elapsed >= navigateAt) location.pathname = '/game/live/186378605425';
      callback();
    },
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { calls, outcomes, attempts: () => attempts, elapsed: () => elapsed, modal: currentModal,
    setControls: value => { controlsPresent = value; },
    request: () => context.__meowlChessBot.requestGameExport(() => elapsed < cancelAt, {
      onAttempt: () => { attempts++; }, onOutcome: outcome => outcomes.push({ ...outcome }),
    }) };
}

test('missing controls preserve the dialog budget until they mount', async () => {
  const fixture = exportFixture({ controlsAvailable: false });
  for (let index = 0; index < 3; index++) assert.equal(await fixture.request(), null);
  assert.equal(fixture.attempts(), 0);
  assert.equal(fixture.calls.downloads, 0);
  assert.equal(fixture.elapsed(), 0);
  assert.deepEqual(fixture.outcomes, Array.from({ length: 3 }, () => ({ status: 'unavailable', reason: 'controls' })));
  fixture.setControls(true);
  assert.equal(await fixture.request(), exportedPgn);
  assert.equal(fixture.attempts(), 1);
  assert.deepEqual(fixture.outcomes.at(-1), { status: 'ready', reason: null });
});

test('disabled Download waits without spending a retry or uses the available Share control', async () => {
  const unavailable = exportFixture({ controlsDisabled: true });
  assert.equal(await unavailable.request(), null);
  assert.equal(unavailable.attempts(), 0);
  assert.deepEqual(unavailable.outcomes, [{ status: 'unavailable', reason: 'controls' }]);
  const available = exportFixture({ controlsDisabled: true, shareAvailable: true });
  assert.equal(await available.request(), exportedPgn);
  assert.equal(available.attempts(), 1);
});

test('a one-ply draw is a completed export and does not require archive publication', async () => {
  const pgn = `[Event "Live Chess"]\n[Site "Chess.com"]\n[White "Samuellove33"]\n[Black "DillPickleChips1"]\n[Result "1/2-1/2"]\n[Link "https://www.chess.com/game/186549203536?username=dillpicklechips1"]\n\n1. e4 1/2-1/2`;
  const fixture = exportFixture({ pgn, initialPath: '/game/186549203536' });
  const result = await fixture.request();
  assert.equal(result, pgn);
  assert.equal(completedPageGame(result, 'https://www.chess.com/game/live/186549203536', 'dillpicklechips1').white.result, 'draw');
  assert.deepEqual(fixture.outcomes, [{ status: 'ready', reason: null }]);
});

test('an aborted-game export is returned for exact identity validation instead of silently timing out', async () => {
  const pgn = `[Event "Live Chess"]\n[Site "Chess.com"]\n[White "Samuellove33"]\n[Black "DillPickleChips1"]\n[Result "1/2-1/2"]\n[Termination "Game aborted"]\n[Link "https://www.chess.com/game/186549203536?username=dillpicklechips1"]\n\n1. e4 1/2-1/2`;
  const fixture = exportFixture({ pgn, initialPath: '/game/186549203536' });
  assert.equal(await fixture.request(), pgn, 'The broker must still verify the game link and player before showing an aborted status.');
  assert.deepEqual(fixture.outcomes, [{ status: 'ready', reason: 'aborted' }]);
  assert.equal(fixture.attempts(), 1);
  assert.equal(fixture.calls.closes, 1);
  const commentedPgn = pgn.replace('[Termination "Game aborted"]\n', '').replace('1. e4', '{[Termination "Game aborted"]} 1. e4');
  const comment = exportFixture({ pgn: commentedPgn });
  assert.equal(await comment.request(), commentedPgn);
  assert.deepEqual(comment.outcomes, [{ status: 'ready', reason: null }], 'A movetext comment is not a termination header.');
});

test('bounded export outcomes distinguish missing dialog, missing PGN and unfinished export', async () => {
  for (const [options, reason] of [
    [{ modalAt: Infinity }, 'modal'],
    [{ pgnAt: Infinity }, 'pgn'],
    [{ pgn: '' }, 'pgn'],
    [{ pgn: exportedPgn.replace(/0-1$/, '*') }, 'unfinished'],
    [{ pgn: exportedPgn.replace('[Result "0-1"]', '[Result "1-0"]') }, 'unfinished'],
  ]) {
    const fixture = exportFixture(options);
    assert.equal(await fixture.request(), null);
    assert.equal(fixture.attempts(), 1);
    assert.equal(fixture.elapsed(), 30000);
    assert.deepEqual(fixture.outcomes, [{ status: 'timeout', reason }]);
  }
});

test('cancellation has its own outcome and a user-opened dialog does not consume an attempt', async () => {
  for (const alreadyOpen of [false, true]) {
    const fixture = exportFixture({ alreadyOpen, pgnAt: 6000, cancelAt: 250 });
    assert.equal(await fixture.request(), null);
    assert.equal(fixture.attempts(), Number(!alreadyOpen));
    assert.deepEqual(fixture.outcomes, [{ status: 'canceled', reason: null }]);
    assert.equal(fixture.calls.closes, Number(!alreadyOpen));
  }
  const fixture = exportFixture({ cancelAt: 0 });
  assert.equal(await fixture.request(), null);
  assert.equal(fixture.attempts(), 0);
  assert.deepEqual(fixture.outcomes, [{ status: 'canceled', reason: null }]);
});

test('a completed public export survives delayed dialog, tab, and PGN mounting', async () => {
  for (const delays of [
    { modalAt: 6000, tabAt: 6000, pgnAt: 6100 },
    { modalAt: 0, tabAt: 6000, pgnAt: 6100 },
    { modalAt: 0, tabAt: 0, pgnAt: 6000 },
    { modalAt: 20000, tabAt: 21000, pgnAt: 22000 },
  ]) {
    const fixture = exportFixture(delays);
    const pgn = await fixture.request();
    assert.equal(pgn, exportedPgn, JSON.stringify(delays));
    assert.equal(completedPageGame(pgn, gameUrl, 'dillpicklechips1').url, gameUrl);
    assert(fixture.elapsed() >= delays.pgnAt && fixture.elapsed() <= delays.pgnAt + 100);
    assert.deepEqual(fixture.calls, { downloads: 1, tabs: 1, closes: 1, destinationCloses: 0 });
  }
});

test('completed analysis review routes can read the exact exported game', async () => {
  for (const initialPath of ['/analysis/game/live/186378605424/review', '/analysis/game/186378605424/review/', '/analysis/game/daily/186378605424/review']) {
    const fixture = exportFixture({ initialPath });
    assert.equal(await fixture.request(), exportedPgn);
    assert.deepEqual(fixture.calls, { downloads: 1, tabs: 1, closes: 1, destinationCloses: 0 });
  }
});

test('malformed review routes do not open the export dialog', async () => {
  for (const initialPath of ['/analysis/game/live/186378605424/review/extra', '/analysis/game/live/186378605424/review/review', '/analysis/game/computer/186378605424/review', '/game/live/186378605424/review']) {
    const fixture = exportFixture({ initialPath });
    assert.equal(await fixture.request(), null);
    assert.equal(fixture.calls.downloads, 0);
  }
});

test('the entire export attempt stays bounded at thirty seconds even when a phase mounts late', async () => {
  for (const delays of [
    { modalAt: Infinity },
    { tabAt: Infinity, pgnAt: Infinity },
    { pgnAt: Infinity },
    { modalAt: 29000, tabAt: 29500, pgnAt: 31000 },
  ]) {
    const fixture = exportFixture(delays);
    assert.equal(await fixture.request(), null);
    assert.equal(fixture.elapsed(), 30000);
    assert.equal(fixture.calls.downloads, 1);
    assert(fixture.calls.tabs <= 1);
    assert.equal(fixture.calls.closes, Number(delays.modalAt !== Infinity));
  }
});

test('wall-clock jumps neither expire nor prolong the export window', async () => {
  for (const wallClock of [elapsed => elapsed * 1000000, elapsed => -elapsed * 1000000]) {
    const delayed = exportFixture({ pgnAt: 6000, wallClock });
    assert.equal(await delayed.request(), exportedPgn); assert.equal(delayed.elapsed(), 6000);
    const absent = exportFixture({ pgnAt: Infinity, wallClock });
    assert.equal(await absent.request(), null); assert.equal(absent.elapsed(), 30000);
  }
});

test('unfinished or conflicting-result exports never return a PGN', async () => {
  for (const pgn of [exportedPgn.replace(/0-1$/, '*'), exportedPgn.replace('[Result "0-1"]', '[Result "1-0"]'), '']) {
    const fixture = exportFixture({ pgn });
    assert.equal(await fixture.request(), null);
    assert.equal(fixture.elapsed(), 30000); assert.equal(fixture.calls.closes, 1);
  }
});

test('reading a foreign completed PGN cannot authorize a review for the current game', async () => {
  const fixture = exportFixture({ pgn: exportedPgn.replace('186378605424', '186378605425') });
  const pgn = await fixture.request();
  assert.equal(typeof pgn, 'string', 'DOM extraction leaves game identity authorization to the broker.');
  assert.throws(() => completedPageGame(pgn, gameUrl, 'dillpicklechips1'), /matching link/);
});

test('canceling a delayed export stops promptly and closes only an owned dialog', async () => {
  for (const alreadyOpen of [false, true]) {
    const fixture = exportFixture({ alreadyOpen, pgnAt: 6000, cancelAt: 250 });
    assert.equal(await fixture.request(), null); assert.equal(fixture.elapsed(), 300);
    assert.equal(fixture.calls.downloads, Number(!alreadyOpen));
    assert.equal(fixture.calls.closes, Number(!alreadyOpen));
    assert.equal(Boolean(fixture.modal()), alreadyOpen);
  }
});

test('navigation never submits the old PGN or closes the destination dialog', async () => {
  for (const navigation of [{ navigateOnOpen: true }, { navigateAt: 200 }]) {
    const fixture = exportFixture({ ...navigation, pgnAt: 6000 });
    assert.equal(await fixture.request(), null);
    assert(fixture.elapsed() <= 200);
    assert.equal(fixture.calls.closes, 0); assert.equal(fixture.calls.destinationCloses, 0);
    assert(fixture.modal());
  }
});
