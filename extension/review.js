import { Chess } from './vendor/chess.js';
import { fetchGames, safeOriginalGameUrl } from './lib/games.js';
import { parseGame, analyzeGame, MOVE_LABELS, ANALYSIS_VERSION } from './lib/review.js';
import { createEngine, ENGINE_OPTIONS } from './lib/engine.js';
import { moveArrowPath } from './lib/board.js';
import { recognizeOpening } from './lib/openings.js';
import { createStudyLine } from './lib/study.js';
import { gradeRetry } from './lib/practice.js';
import { explainConsequence } from './lib/tactics.js';
import { importPgnCollection, importPgnFiles, PGN_IMPORT_MAX_BYTES } from './lib/pgn-import.js';
import { createTutorial } from './lib/tutorial.js';
import { createSupportPrompt } from './lib/support-prompt.js';
import { createMoveNotation } from './lib/move-notation.js';
import { createSiteReviewSettings } from './lib/site-settings.js';
import { createReviewLibrary } from './lib/library.js';
const reviewLibrary = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });

const $ = (id) => document.getElementById(id);
const state = { starting: true, reviewTab: 'moves', importGames: [], importing: false, games: [], selected: null, parsed: null, result: null, ply: 0, flipped: false, busy: false, loading: false, controller: null, positionController: null, positionAnalysis: new Map(), selectedLine: null, playTimer: null, study: null, retry: null, selectedSquare: null, focusSquare: 'a8', pendingPromotion: null, hoverLine: null, reviewId: null, bookmarks: [], savedReviews: [], practiceItems: [], bookmarkItems: [], libraryBusy: false, branchAnalysis: new Map(), opening: null, recordMeta: null };
const supportPrompt = createSupportPrompt({ onSaveError: message => { $('save-status').textContent = message; } });
const tutorial = createTutorial({
  onOpen: () => { stopPlayback(); updateControls(); },
  onSaveError: message => { $('save-status').textContent = message; }
});
const siteSettings = createSiteReviewSettings();
const lineColors = ['#96bc4b', '#55a7d7', '#efa64a'];
const badgeDescriptions = { Book: 'A recorded opening move without a detected tactical error', Brilliant: 'Sound sacrifice in the engine line', Great: 'Best reply after an opponent’s error', Best: 'The engine’s first choice', Excellent: 'Almost no estimated loss', Good: 'A reasonable move', Inaccuracy: 'A small missed opportunity', Mistake: 'A significant loss of chances', Blunder: 'A large loss of chances' };
function makeBadge(label, extraClass = '') {
  const badge = document.createElement('span'); badge.className = `move-badge ${label.toLowerCase()} ${extraClass}`;
  const icon = document.createElement('img'); icon.src = `move-icons/${label.toLowerCase()}.svg`; icon.alt = ''; icon.draggable = false;
  badge.append(icon); badge.title = label; badge.setAttribute('aria-label', label); return badge;
}
function pieceImage(color, type) {
  const image = document.createElement('img'); image.className = 'piece'; image.src = `pieces/${color}${type}.png`; image.alt = ''; image.draggable = false; return image;
}
let renderedBoard = null;
const savedUsernames = {};
let usernameSource = 'chesscom', usernameSaveQueue = Promise.resolve();
function rememberUsername(source, value) {
  const username = value.trim();
  savedUsernames[source] = username;
  if (!globalThis.chrome?.storage?.local) return Promise.resolve();
  // Merge the latest provider entries so another review tab's input is retained.
  usernameSaveQueue = usernameSaveQueue.then(async () => {
    const stored = await chrome.storage.local.get(['username', 'usernames']);
    const usernames = {};
    if (stored.usernames && typeof stored.usernames === 'object') {
      for (const provider of ['chesscom', 'lichess']) if (typeof stored.usernames[provider] === 'string') usernames[provider] = stored.usernames[provider];
    } else if (typeof stored.username === 'string') usernames.chesscom = stored.username;
    usernames[source] = username;
    await chrome.storage.local.set({ usernames, ...(source === 'chesscom' ? { username } : {}) });
  }).catch(() => {});
  return usernameSaveQueue;
}
function selectedEngine() { return ENGINE_OPTIONS.find(engine => engine.id === $('engine').value) || ENGINE_OPTIONS[0]; }
function syncEngine() {
  const engine = selectedEngine();
  for (const option of $('multipv').options) option.disabled = Number(option.value) > engine.maxLines;
  if (Number($('multipv').value) > engine.maxLines) $('multipv').value = String(engine.maxLines);
  $('review-engine').textContent = `${engine.label} · local`;
  $('engine-help').textContent = engine.description;
}
function syncSource() {
  const lichess = $('game-source').value === 'lichess';
  $('username-label').textContent = lichess ? 'Lichess username or game URL' : 'Chess.com username';
  $('username').placeholder = lichess ? 'Username or finished game URL' : 'Username';
}
function setLibraryOpen(open) {
  const dialog = $('library-dialog');
  if (open && !dialog.open) { stopPlayback(); updateControls(); dialog.showModal(); }
  else if (!open && dialog.open) dialog.close();
  $('library-toggle').setAttribute('aria-expanded', String(dialog.open));
}
function keyPlies() { return state.result?.moves.filter(move => ['Brilliant', 'Great', 'Mistake', 'Blunder'].includes(move.label)).map(move => move.ply) || []; }
const sample = {
  pgn: '[Event "MeowlChess sample"]\n[Site "Local sample"]\n[Date "2026.01.01"]\n[White "White"]\n[Black "Black"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
  white: { username: 'White', result: 'checkmated' }, black: { username: 'Black', result: 'win' },
  time_class: 'sample', end_time: 1767225600, rules: 'chess', sample: true
};
function showError(message = '') {
  $('error').hidden = !message; $('error').textContent = message;
  if (message) requestAnimationFrame(() => $('error').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
}
function setReviewTab(name, focus = false) {
  if (name === 'summary' && !state.result) return;
  state.reviewTab = name;
  for (const view of ['moves', 'summary', 'practice']) {
    const active = view === name;
    $(`${view}-panel`).hidden = !active;
    $(`${view}-tab`).setAttribute('aria-selected', String(active));
    $(`${view}-tab`).tabIndex = active ? 0 : -1;
  }
  state.hoverLine = null;
  renderEngineArrows(currentCandidates());
  if (name === 'moves') keepSelectedMoveVisible();
  if (focus) $(`${name}-tab`).focus();
}

function displayEvaluation(evaluation) {
  if (!evaluation || !Number.isFinite(evaluation.cp)) return '—';
  if (evaluation.mate !== null && evaluation.mate !== undefined) return `${evaluation.cp < 0 ? '−' : ''}M${Math.abs(evaluation.mate)}`;
  return `${evaluation.cp > 0 ? '+' : ''}${(evaluation.cp / 100).toFixed(1)}`;
}
function updateControls() {
  const unavailable = state.starting || state.busy || state.loading || !!state.positionController || !!state.retry?.controller || state.libraryBusy || state.importing;
  siteSettings.setBusy(unavailable);
  $('library-toggle').disabled = unavailable;
  $('open-tutorial').disabled = unavailable || !tutorial.ready || !!state.retry;
  $('summary-tab').disabled = !state.result || !!state.retry;
  $('practice-tab').disabled = !!state.retry;
  $('smart-analysis').disabled = unavailable;
  $('retry-move').disabled = !state.result || !state.ply || unavailable || !!state.study || !!state.retry;
  $('show-why').disabled = !state.result || !state.ply || unavailable || !!state.study || !!state.retry;
  $('bookmark-position').disabled = !state.reviewId || unavailable || !!state.study || !!state.retry;
  const bookmarked = state.bookmarks.some(item => item.ply === state.ply);
  $('bookmark-position').setAttribute('aria-pressed', String(bookmarked));
  $('bookmark-position').textContent = bookmarked ? 'Bookmarked' : 'Bookmark';
  const lines = Number($('multipv').value);
  const speed = $('depth').selectedOptions[0].textContent.split(' · ')[0];
  $('review-config').textContent = `${selectedEngine().label} · ${speed} · ${lines === 1 ? 'Best move' : `${lines} lines`}`;
  $('load-button').disabled = unavailable;
  $('username').disabled = unavailable;
  $('demo-button').disabled = unavailable;
  $('depth').disabled = unavailable;
  $('multipv').disabled = unavailable || selectedEngine().maxLines === 1;
  $('engine').disabled = unavailable;
  for (const id of ['game-source', 'pgn-file', 'pgn-text', 'import-button']) $(id).disabled = unavailable;
  $('quick-position').disabled = !state.parsed || unavailable || answersHidden();
  document.querySelector('.engine-panel').setAttribute('aria-busy', String(!!state.positionController));
  $('games').classList.toggle('loading-games', state.loading);
  document.querySelector('.analysis-box').classList.toggle('is-analyzing', state.busy);
  document.querySelector('.engine-panel').classList.toggle('is-searching', !!state.positionController);
  $('analyze-button').disabled = !state.parsed || unavailable || !!state.retry;
  $('analyze-button').hidden = state.busy;
  $('cancel-button').hidden = !state.busy;
  $('deepen-button').disabled = !state.parsed || unavailable || answersHidden();
  $('stop-position').hidden = !state.positionController;
  $('play-button').disabled = !state.parsed || state.busy || state.loading || !!state.positionController || answersHidden();
  $('play-button').setAttribute('aria-pressed', String(!!state.playTimer));
  $('play-button').textContent = state.playTimer ? 'Pause' : 'Play';
  $('play-button').setAttribute('aria-label', state.playTimer ? 'Pause playback' : 'Play through the game');
  $('first-button').disabled = !state.parsed || positionIndex() === 0 || answersHidden();
  $('previous-button').disabled = !state.parsed || positionIndex() === 0 || answersHidden();
  $('next-button').disabled = !state.parsed || positionIndex() >= positionCount() || answersHidden();
  $('last-button').disabled = !state.parsed || positionIndex() >= positionCount() || answersHidden();
  const keys = keyPlies();
  $('key-moments').hidden = !keys.length;
  $('previous-key').disabled = !keys.some(ply => ply < state.ply);
  $('next-key').disabled = !keys.some(ply => ply > state.ply);
  for (const button of document.querySelectorAll('.game-card, .notebook-item, .saved-open, .saved-delete, .import-game')) button.disabled = unavailable || button.dataset.invalid === 'true';
  const seconds = (state.parsed?.positions.length || 0) * ($('smart-analysis').checked ? Math.min(150, Number($('depth').value)) : Number($('depth').value)) / 1000;
  $('time-estimate').textContent = seconds ? `About ${seconds < 60 ? `${Math.ceil(seconds)} sec` : `${Math.ceil(seconds / 60)} min`} for the first pass.${$('smart-analysis').checked ? ' Key mistakes get extra thinking time.' : ' More lines split the search time.'}` : 'Choose a game to see the estimated review time.';
}
function renderPlayers() {
  const white = state.selected?.white || { username: 'White' };
  const black = state.selected?.black || { username: 'Black' };
  for (const [place, player, color] of state.flipped ? [['top', white, 'w'], ['bottom', black, 'b']] : [['top', black, 'b'], ['bottom', white, 'w']]) {
    $(`${place}-player`).textContent = player.username;
    $(`${place}-rating`).textContent = player.rating ? `(${player.rating})` : '';
    const summary = state.result?.summary[color];
    $(`${place}-score`).textContent = summary && summary.accuracy != null ? `${summary.accuracy.toFixed(1)}% est.` : '';
    $(`${place}-score`).title = 'Estimated MeowlChess study score';
    const avatar = $(`${place}-player`).previousElementSibling;
    avatar.replaceChildren(pieceImage(color, 'k'));
    avatar.classList.toggle('white-avatar', color === 'w');
  }
}
function renderBoard() {
  const fen = currentFen();
  const chess = fen ? new Chess(fen) : new Chess();
  const board = $('board');
  const previous = renderedBoard;
  const hadFocus = board.contains(document.activeElement);
  const interaction = canMovePieces() && !state.study?.line.terminal;
  const legalTargets = new Set(state.selectedSquare ? chess.moves({ square: state.selectedSquare, verbose: true }).map(move => move.to) : []);
  board.classList.toggle('interactive', interaction);
  const animateMove = previous && previous.game === state.selected && previous.flipped === state.flipped && previous.study === state.study?.line && Math.abs(previous.ply - positionIndex()) === 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const oldPieces = animateMove ? [...board.querySelectorAll('.square .piece')].map(image => ({ square: image.parentElement.dataset.square, src: image.getAttribute('src'), x: image.parentElement.offsetLeft, y: image.parentElement.offsetTop })) : [];
  board.replaceChildren();
  const files = state.flipped ? 'hgfedcba' : 'abcdefgh';
  const ranks = state.flipped ? '12345678' : '87654321';
  const move = currentMove();
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const squareName = files[col] + ranks[row];
    const piece = chess.get(squareName);
    const square = document.createElement('button'); square.type = 'button';
    square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
    square.dataset.square = squareName;
    if (piece) {
      const image = pieceImage(piece.color, piece.type); image.draggable = interaction && piece.color === chess.turn();
      image.addEventListener('dragstart', event => { if (!canMovePieces()) { event.preventDefault(); return; } state.selectedSquare = squareName; event.dataTransfer.setData('text/plain', squareName); event.dataTransfer.effectAllowed = 'move'; });
      square.append(image);
    }
    square.classList.toggle('selected-square', state.selectedSquare === squareName);
    square.classList.toggle('legal-target', legalTargets.has(squareName));
    const highlights = state.study?.evidence?.highlights || [];
    square.classList.toggle('consequence-target', highlights.some(item => item.square === squareName && item.at === state.study.line.cursor));
    square.addEventListener('click', () => chooseSquare(squareName));
    square.addEventListener('dragover', event => { if (canMovePieces()) event.preventDefault(); });
    square.addEventListener('drop', event => { event.preventDefault(); if (canMovePieces()) playBoardMove(event.dataTransfer.getData('text/plain'), squareName); });
    if (move && (move.from === squareName || move.to === squareName)) square.classList.add('last-move');
    const reviewedMove = !state.study && !answersHidden() ? state.result?.moves[state.ply - 1] : null;
    if (row === 0) square.classList.add('top-edge');
    if (col === 7) square.classList.add('right-edge');
    if ($('show-badges').checked && reviewedMove && move && (move.from === squareName || move.to === squareName)) square.classList.add(`rated-${reviewedMove.label.toLowerCase()}`);
    if ($('show-badges').checked && move?.to === squareName && reviewedMove) square.append(makeBadge(reviewedMove.label, 'board-move-badge'));
    if (!state.study && !answersHidden() && $('show-badges').checked && piece?.type === 'k' && state.parsed?.headers.Result === '1/2-1/2' && state.ply === state.parsed.moves.length) square.append(makeBadge('Draw', 'board-move-badge'));
    if ($('show-coordinates').checked && row === 7) { const coord = document.createElement('span'); coord.className = 'coordinate'; coord.textContent = files[col]; square.append(coord); }
    if ($('show-coordinates').checked && col === 0) { const coord = document.createElement('span'); coord.className = 'coordinate rank-coordinate'; coord.textContent = ranks[row]; square.append(coord); }
    const pieces = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    square.setAttribute('role', 'gridcell'); square.setAttribute('aria-label', `${squareName}${piece ? `, ${piece.color === 'w' ? 'White' : 'Black'} ${pieces[piece.type]}` : ', empty'}`);
    square.setAttribute('aria-selected', String(state.selectedSquare === squareName)); square.tabIndex = state.focusSquare === squareName ? 0 : -1;
    square.disabled = !state.parsed || state.busy || !!state.retry?.controller;
    board.append(square);
  }
  if (animateMove) {
    const images = [...board.querySelectorAll('.square .piece')];
    const unchanged = new Set(images.filter(image => oldPieces.some(old => old.square === image.parentElement.dataset.square && old.src === image.getAttribute('src'))).map(image => image.parentElement.dataset.square));
    const available = oldPieces.filter(old => !unchanged.has(old.square));
    for (const image of images.filter(image => !unchanged.has(image.parentElement.dataset.square))) {
      const source = available.find(old => old.src === image.getAttribute('src'));
      if (!source) continue;
      available.splice(available.indexOf(source), 1);
      image.style.zIndex = '4';
      const animation = image.animate([{ transform: `translate(${source.x - image.parentElement.offsetLeft}px, ${source.y - image.parentElement.offsetTop}px)` }, { transform: 'translate(0, 0)' }], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
      animation.onfinish = () => { image.style.zIndex = ''; };
    }
  }
  renderedBoard = { game: state.selected, ply: positionIndex(), flipped: state.flipped, study: state.study?.line };
  board.setAttribute('aria-label', `Chess board ${state.study ? `in ${state.retry ? 'practice' : 'variation'}, step ${state.study.line.cursor}` : state.ply ? `after move ${state.ply}: ${move.san}` : 'in starting position'}. FEN: ${chess.fen()}`);
  if (move) $('position-label').replaceChildren(`${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '…'} `, createMoveNotation(move.san, move.color));
  else $('position-label').textContent = state.study ? 'Line starts here' : 'Starting position';
  const evaluation = currentEvaluation();
  $('eval-text').textContent = displayEvaluation(evaluation);
  const cp = evaluation?.cp || 0;
  const whitePercent = 100 / (1 + Math.exp(-cp / 350));
  $('eval-white').style.height = `${whitePercent}%`;
  $('eval-white').parentElement.style.alignItems = state.flipped ? 'flex-start' : 'flex-end';
  $('eval-text').style.color = cp < 0 ? '#f5f6ef' : '#40553e';
  const labelAtTop = (cp < 0) !== state.flipped;
  $('eval-text').style.top = labelAtTop ? '6px' : 'auto';
  $('eval-text').style.bottom = labelAtTop ? 'auto' : '6px';
  $('eval-white').parentElement.setAttribute('aria-label', evaluation ? `White perspective evaluation: ${displayEvaluation(evaluation)}` : 'Position not analyzed');
  renderPlayers(); renderInsight(); renderStudyControls(); renderEngineLines(); updateControls();
  if (hadFocus) board.querySelector(`[data-square="${state.focusSquare}"]`)?.focus({ preventScroll: true });
  for (const button of document.querySelectorAll('.move-button, .chart-hit button')) {
    const active = Number(button.dataset.ply) === state.ply;
    button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'step' : 'false');
    if (button.closest('.chart-hit')) button.tabIndex = active ? 0 : -1;
  }
  keepSelectedMoveVisible();
}
function keepSelectedMoveVisible() {
  const activeMove = document.querySelector('.move-button.active');
  const list = $('move-list');
  if (!activeMove || !list.clientHeight) return;
  const top = activeMove.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  if (top < list.scrollTop || top + activeMove.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 2);
}
function renderInsight() {
  $('review-engine').textContent = `${state.result ? state.reviewEngine : selectedEngine().label} · local`;
  if (state.study) {
    $('insight-badge').hidden = true; $('best-move').hidden = true;
    $('insight-title').textContent = state.retry ? state.retry.revealed ? 'Suggested answer' : state.retry.status === 'checking' ? 'Checking your move' : 'Find a better move' : state.study.kind === 'consequence' ? 'Follow the continuation' : 'Try a different line';
    $('insight-text').textContent = state.study.message || (state.retry ? 'Move a piece on the board. The engine hints are hidden while you solve.' : 'These moves are a variation. Your completed game is unchanged.');
    return;
  }
  const reviewMove = state.result?.moves[state.ply - 1];
  const insightBadge = $('insight-badge'); insightBadge.hidden = !reviewMove;
  if (reviewMove) {
    insightBadge.className = `move-badge insight-badge ${reviewMove.label.toLowerCase()}`;
    insightBadge.replaceChildren(makeBadge(reviewMove.label).firstElementChild); insightBadge.setAttribute('aria-label', reviewMove.label);
  }
  $('best-move').hidden = !reviewMove?.bestSan || reviewMove.bestSan === reviewMove.san;
  if (reviewMove) {
    $('insight-title').replaceChildren(createMoveNotation(reviewMove.san, reviewMove.color), ` · ${reviewMove.label}`);
    $('insight-text').textContent = reviewMove.explanation || `Estimated evaluation loss: ${(reviewMove.loss / 100).toFixed(2)} pawns.`;
    $('best-move').replaceChildren("Engine's choice: ", createMoveNotation(reviewMove.bestSan, reviewMove.color));
  } else if (state.result) {
    $('insight-title').textContent = 'Starting position';
    $('insight-text').textContent = 'Select a move or use the arrows to step through the game. Evaluations are from White’s perspective.';
  } else {
    $('insight-title').textContent = state.parsed ? 'Ready to review' : 'Choose a game';
    $('insight-text').textContent = state.parsed ? 'Review this game to see move ratings, evaluations, and suggested moves.' : 'Find a completed game on Chess.com or Lichess, import a PGN, or try the sample.';
  }
}
function renderMoves() {
  const container = $('move-list'); container.replaceChildren();
  const moves = state.parsed?.moves || [];
  $('move-count').textContent = `${Math.ceil(moves.length / 2)} moves`;
  if (!moves.length) { const p = document.createElement('p'); p.className = 'muted move-empty'; p.textContent = "Your game's moves will appear here."; container.append(p); return; }
  let row, previousNumber;
  moves.forEach((move, index) => {
    const moveNumber = move.before.split(' ')[5];
    if (!row || moveNumber !== previousNumber) {
      row = document.createElement('div'); row.className = 'move-row';
      const number = document.createElement('span'); number.className = 'move-number'; number.textContent = `${moveNumber}.`; row.append(number); container.append(row);
      if (move.color === 'b') { const empty = document.createElement('span'); empty.className = 'move-placeholder'; row.append(empty); }
      previousNumber = moveNumber;
    }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'move-button'; button.dataset.ply = String(index + 1);
    button.append(createMoveNotation(move.san, move.color));
    const reviewMove = state.result?.moves[index];
    if (reviewMove && $('show-badges').checked) button.append(makeBadge(reviewMove.label));
    button.setAttribute('aria-label', `Move ${moveNumber}, ${move.color === 'w' ? 'White' : 'Black'}: ${move.san}${reviewMove ? `, ${reviewMove.label}` : ''}`);
    button.addEventListener('click', () => goTo(index + 1)); row.append(button);
  });
}
function renderSummary() {
  const summary = $('summary'); summary.replaceChildren(); summary.hidden = !state.result;
  if (!state.result) setReviewTab('moves');
  renderChart();
  if (!state.result) return;
  const scores = document.createElement('div'); scores.className = 'score-row';
  for (const color of ['w', 'b']) {
    const card = document.createElement('div'); card.className = `score-card score-${color}`;
    const value = document.createElement('span'); value.className = 'score-value'; value.textContent = state.result.summary[color].accuracy?.toFixed(1) ?? '—';
    const info = document.createElement('div'); info.className = 'score-info';
    const name = document.createElement('strong'); name.textContent = state.selected[color === 'w' ? 'white' : 'black'].username;
    const caption = document.createElement('small'); caption.textContent = 'Study score · est.';
    info.append(name, caption); card.append(value, info); scores.append(card);
  }
  summary.append(scores);
  const totalsLabel = document.createElement('p'); totalsLabel.className = 'summary-caption'; totalsLabel.textContent = 'Move ratings · White / Black'; summary.append(totalsLabel);
  const counts = document.createElement('div'); counts.className = 'classification-counts';
  for (const label of MOVE_LABELS) {
    const row = document.createElement('div'); row.className = `classification-count ${label.toLowerCase()}`;
    const name = document.createElement('span'); name.textContent = label;
    const white = document.createElement('strong'); white.textContent = String(state.result.summary.w.counts[label] || 0); white.setAttribute('aria-label', `White: ${white.textContent}`);
    const black = document.createElement('strong'); black.textContent = String(state.result.summary.b.counts[label] || 0); black.setAttribute('aria-label', `Black: ${black.textContent}`);
    row.append(name, white, makeBadge(label), black); counts.append(row);
  }
  summary.append(counts);
}
function renderChart() {
  const chart = $('eval-chart'); chart.replaceChildren();
  if (!state.result) { const p = document.createElement('p'); p.textContent = 'Evaluation graph appears after review.'; chart.append(p); return; }
  const evaluations = state.result.positions;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 1000 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const points = evaluations.map((evaluation, index) => `${(index + 0.5) / evaluations.length * 1000},${50 - Math.tanh(evaluation.cp / 500) * 46}`);
  const area = document.createElementNS(ns, 'polygon'); area.setAttribute('points', `0,100 0,${points[0].split(',')[1]} ${points.join(' ')} 1000,${points.at(-1).split(',')[1]} 1000,100`); area.setAttribute('fill', '#c8c7b8');
  const line = document.createElementNS(ns, 'polyline'); line.setAttribute('points', points.join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#a3c77e'); line.setAttribute('stroke-width', '2'); line.setAttribute('vector-effect', 'non-scaling-stroke');
  const middle = document.createElementNS(ns, 'line'); middle.setAttribute('x1', '0'); middle.setAttribute('x2', '1000'); middle.setAttribute('y1', '50'); middle.setAttribute('y2', '50'); middle.setAttribute('stroke', '#6b685e'); middle.setAttribute('stroke-dasharray', '5 5');
  svg.append(area, middle, line); chart.append(svg);
  const hit = document.createElement('div'); hit.className = 'chart-hit';
  evaluations.forEach((evaluation, ply) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.ply = String(ply);
    const move = state.parsed.moves[ply - 1]; const label = `${ply ? `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '…'} ${move.san}` : 'Starting position'}: ${displayEvaluation(evaluation)}`;
    button.title = label; button.setAttribute('aria-label', label); button.addEventListener('click', () => goTo(ply)); hit.append(button);
  }); chart.append(hit);
}
function currentEvaluation() {
  if (answersHidden()) return null;
  if (state.study) return state.branchAnalysis.get(positionKey());
  return state.positionAnalysis.get(state.ply) || state.result?.positions[state.ply];
}
function currentCandidates() {
  if (!state.parsed || answersHidden()) return [];
  const evaluation = currentEvaluation();
  if (!evaluation) {
    const next = state.study?.line.moves[state.study.line.cursor];
    return next ? [{ rank: 1, bestMove: next.uci, pv: state.study.line.moves.slice(state.study.line.cursor).map(move => move.uci), depth: 0 }] : [];
  }
  const candidates = evaluation.candidates || (evaluation.bestMove ? [{ ...evaluation, rank: 1 }] : []);
  const seen = new Set();
  return candidates.filter(candidate => {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(candidate.bestMove || '') || seen.has(candidate.bestMove)) return false;
    try {
      const move = candidate.bestMove;
      new Chess(currentFen()).move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
      seen.add(move); return true;
    } catch { return false; }
  }).slice(0, Number($('multipv').value));
}
function lineNotation(candidate) {
  const chess = new Chess(currentFen());
  const pv = candidate.pv?.[0] === candidate.bestMove ? candidate.pv : [candidate.bestMove];
  const parts = [];
  for (const uci of pv.slice(0, 8)) {
    try {
      const number = chess.fen().split(' ')[5], turn = chess.turn();
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      parts.push({ prefix: turn === 'w' ? `${number}. ` : parts.length ? '' : `${number}… `, san: move.san, color: move.color });
    } catch { break; }
  }
  const fragment = document.createDocumentFragment();
  parts.forEach((move, index) => fragment.append(index ? ' ' : '', move.prefix, createMoveNotation(move.san, move.color)));
  return fragment;
}
function renderEngineLines() {
  const candidates = currentCandidates();
  const container = $('engine-lines'); container.replaceChildren();
  const evaluation = currentEvaluation();
  const side = state.parsed ? new Chess(currentFen()).turn() === 'w' ? 'White' : 'Black' : null;
  $('engine-turn').textContent = side ? `${side} to move · scores from White’s view` : 'Select a completed game';
  if (answersHidden()) { renderEngineArrows([]); return; }
  if (state.positionController) $('engine-status').textContent = 'Searching this position…';
  else if (evaluation && !candidates.length) $('engine-status').textContent = evaluation.mate === 0 ? 'Checkmate. No legal continuation.' : evaluation.bestMove === null && evaluation.cp === 0 ? 'Drawn position — no further engine analysis.' : 'No engine lines available for this position.';
  else if (evaluation) $('engine-status').textContent = `${evaluation.engineName || state.reviewEngine || selectedEngine().label} · ${state.study || state.positionAnalysis.has(state.ply) ? 'Position search' : 'Game review'} · depth ${evaluation.depth} · ${candidates.length} ${candidates.length === 1 ? 'line' : 'lines'}`;
  else $('engine-status').textContent = state.study ? 'Step through this line, or analyze the displayed position.' : 'Review the game, or analyze this position.';
  for (const candidate of candidates) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'engine-line'; button.dataset.rank = candidate.rank; button.dataset.uci = candidate.bestMove;
    button.style.setProperty('--line-color', lineColors[candidate.rank - 1] || lineColors[0]);
    button.setAttribute('aria-pressed', String(state.selectedLine === candidate.rank));
    button.title = 'Hover for its arrow; click to play through this line';
    const rank = document.createElement('span'); rank.className = 'line-rank'; rank.textContent = String(candidate.rank);
    const score = document.createElement('strong'); score.className = 'line-score'; score.textContent = displayEvaluation(candidate);
    const notation = document.createElement('span'); notation.className = 'line-notation'; notation.append(lineNotation(candidate));
    button.append(rank, score, notation);
    const preview = () => { state.hoverLine = candidate.rank; renderEngineArrows(currentCandidates()); };
    const clear = () => { state.hoverLine = null; renderEngineArrows(currentCandidates()); };
    button.addEventListener('pointerenter', preview); button.addEventListener('pointerleave', clear); button.addEventListener('focus', preview); button.addEventListener('blur', clear);
    button.addEventListener('click', () => startVariation(candidate));
    container.append(button);
  }
  renderEngineArrows(candidates);
}
function renderEngineArrows(candidates) {
  $('board').querySelector('.engine-overlay')?.remove();
  if (state.reviewTab !== 'moves' || answersHidden() || !$('show-arrows').checked || !candidates.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.classList.add('engine-overlay'); svg.setAttribute('viewBox', '0 0 800 800'); svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(ns, 'defs'); svg.append(defs);
  const shown = new Set();
  const visible = candidates.filter(candidate => state.hoverLine !== null ? candidate.rank === state.hoverLine : $('arrow-mode').value === 'all' || candidate.rank === 1).filter(candidate => {
    // Promotion alternatives can share one arrow; keep the strongest rank.
    const squares = candidate.bestMove.slice(0, 4); if (shown.has(squares)) return false; shown.add(squares); return true;
  });
  for (const candidate of visible.reverse()) {
    const color = lineColors[candidate.rank - 1] || lineColors[0];
    const marker = document.createElementNS(ns, 'marker');
    for (const [key, value] of Object.entries({ id: `engine-head-${candidate.rank}`, markerWidth: '44', markerHeight: '48', refX: '0', refY: '24', orient: 'auto', markerUnits: 'userSpaceOnUse' })) marker.setAttribute(key, value);
    const head = document.createElementNS(ns, 'path'); head.setAttribute('d', 'M 0 0 L 42 24 L 0 48 Z'); head.setAttribute('fill', color); marker.append(head); defs.append(marker);
    const arrow = document.createElementNS(ns, 'path'); arrow.classList.add('engine-arrow'); arrow.dataset.from = candidate.bestMove.slice(0, 2); arrow.dataset.to = candidate.bestMove.slice(2, 4); arrow.dataset.rank = candidate.rank; arrow.dataset.uci = candidate.bestMove;
    arrow.setAttribute('d', moveArrowPath(candidate.bestMove, state.flipped, 42)); arrow.setAttribute('stroke', color); arrow.setAttribute('marker-end', `url(#engine-head-${candidate.rank})`); svg.append(arrow);
  }
  $('board').append(svg);
}
function cancelPositionSearch() {
  if (!state.positionController) return;
  state.positionController.abort(); state.positionController = null;
}
async function deepenPosition(quick = false) {
  if (!state.parsed || state.busy || state.loading || state.positionController || answersHidden()) return;
  stopPlayback(); state.selectedLine = null;
  const game = state.selected, ply = state.ply, study = state.study, key = positionKey();
  const controller = new AbortController(); state.positionController = controller;
  const choice = selectedEngine();
  const engine = createEngine(choice.id);
  renderEngineLines(); updateControls();
  try {
    const replay = new Chess(state.parsed.positions[0]);
    const moves = study ? study.line.history : state.parsed.moves.slice(0, ply).map(move => `${move.from}${move.to}${move.promotion || ''}`);
    for (const uci of moves) replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    let evaluation;
    if (replay.isCheckmate()) evaluation = { cp: replay.turn() === 'w' ? -100000 : 100000, mate: 0, depth: 0, pv: [], bestMove: null, candidates: [] };
    else if (replay.isDraw()) evaluation = { cp: 0, mate: null, depth: 0, pv: [], bestMove: null, candidates: [] };
    else evaluation = await engine.evaluate(replay.fen(), { initialFen: state.parsed.positions[0], moves, moveTimeMs: quick ? 150 : Math.max(1500, Number($('depth').value)), multiPV: Number($('multipv').value), signal: controller.signal });
    if (controller.signal.aborted || state.selected !== game || state.study !== study || positionKey() !== key) return;
    evaluation.engineName = choice.label;
    if (study) state.branchAnalysis.set(key, evaluation); else state.positionAnalysis.set(ply, evaluation);
  } catch (error) {
    if (error.name !== 'AbortError' && !controller.signal.aborted && state.selected === game && state.study === study && positionKey() === key) showError(error.message || 'Position analysis failed. Try again.');
  } finally {
    engine.dispose();
    if (state.positionController === controller) { state.positionController = null; renderBoard(); }
  }
}
function stopPlayback() {
  if (state.playTimer) clearInterval(state.playTimer);
  state.playTimer = null;
}
function startPlayback() {
  if (!state.parsed || state.busy || state.loading || state.positionController || answersHidden()) return;
  if (state.playTimer) { stopPlayback(); updateControls(); return; }
  if (positionIndex() >= positionCount()) navigatePosition(0);
  state.playTimer = setInterval(() => {
    if (!state.parsed || positionIndex() >= positionCount()) { stopPlayback(); updateControls(); return; }
    navigatePosition(positionIndex() + 1, { playback: true });
    if (positionIndex() >= positionCount()) { stopPlayback(); updateControls(); }
  }, Number($('play-speed').value));
  updateControls();
}
function savePreferences() {
  const reviewSettings = { smart: $('smart-analysis').checked, autoOrient: $('auto-orient').checked, arrowMode: $('arrow-mode').value, engine: $('engine').value, source: $('game-source').value, time: $('depth').value, lines: $('multipv').value, arrows: $('show-arrows').checked, badges: $('show-badges').checked, coordinates: $('show-coordinates').checked, playback: $('play-speed').value };
  globalThis.chrome?.storage?.local?.set({ reviewSettings }).catch(() => {});
}
function restorePreferences(settings) {
  if (!settings || typeof settings !== 'object') return;
  for (const [id, key] of [['arrow-mode', 'arrowMode'], ['engine', 'engine'], ['game-source', 'source'], ['depth', 'time'], ['multipv', 'lines'], ['play-speed', 'playback']]) {
    if ([...$(id).options].some(option => option.value === settings[key])) $(id).value = settings[key];
  }
  for (const [id, key] of [['smart-analysis', 'smart'], ['auto-orient', 'autoOrient'], ['show-arrows', 'arrows'], ['show-badges', 'badges'], ['show-coordinates', 'coordinates']]) if (typeof settings[key] === 'boolean') $(id).checked = settings[key];
}
function goTo(ply, { playback = false } = {}) {
  if (!state.parsed) return;
  if (!playback) stopPlayback();
  cancelPositionSearch(); resetExploration(); state.selectedLine = null;
  state.ply = Math.max(0, Math.min(state.parsed.moves.length, ply)); setReviewTab('moves'); renderBoard();
}
function selectGame(game) {
  if (state.busy || state.loading) return;
  stopPlayback(); cancelPositionSearch(); resetExploration(); state.positionAnalysis.clear(); state.branchAnalysis.clear(); state.selectedLine = null;
  showError();
  try {
    const parsed = parseGame(game.pgn);
    state.selected = game; state.parsed = parsed; state.result = null; state.ply = 0; state.reviewId = null; state.bookmarks = []; state.recordMeta = null; state.opening = recognizeOpening(parsed);
    orientToPlayer(game); $('save-status').textContent = '';
    $('game-title').textContent = `${game.white.username} vs ${game.black.username}`;
    $('game-subtitle').replaceChildren();
    const subtitle = document.createElement('span'); subtitle.textContent = game.sample ? 'Sample · Fool’s mate · 0–1' : `${game.source === 'pgn' ? 'Imported PGN' : game.source === 'lichess' ? 'Lichess' : 'Chess.com'}${game.end_time ? ` · ${new Date(game.end_time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''} · ${parsed.headers?.Result || 'Completed'} · `;
    $('game-subtitle').append(subtitle);
    if (game.url && safeOriginalGameUrl(game.url)) {
      const link = document.createElement('a'); link.href = safeOriginalGameUrl(game.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'external-game'; link.textContent = 'View original game ↗'; $('game-subtitle').append(link);
    }
    $('game-kind').textContent = `${game.time_class || 'STANDARD'} · COMPLETED`;
    $('review-status').textContent = '';
    $('progress-area').hidden = true;
    $('analyze-button').textContent = 'Review game';
    for (const button of document.querySelectorAll('.game-card')) {
      const selected = (button.classList.contains('import-game') ? state.importGames : state.games)[Number(button.dataset.index)] === game;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    }
    renderMoves(); renderSummary(); renderBoard();
    $('engine-panel').open = false;
    setLibraryOpen(false);
  } catch (error) { showError(error.message || 'This game could not be opened.'); }
}
function renderGames() {
  $('games').replaceChildren();
  $('game-count').textContent = String(state.games.length);
  state.games.forEach((game, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'game-card'; button.dataset.index = String(index);
    button.setAttribute('aria-pressed', 'false');
    const names = document.createElement('strong'); names.textContent = `${game.white.username} vs ${game.black.username}`;
    const meta = document.createElement('span'); meta.className = 'game-meta';
    const date = document.createElement('span'); date.textContent = `${new Date(game.end_time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${game.time_class || 'chess'}`;
    const result = document.createElement('span'); result.className = 'game-result'; result.textContent = game.white.result === 'win' ? '1–0' : game.black.result === 'win' ? '0–1' : '½–½';
    meta.append(date, result); button.append(names, meta); button.addEventListener('click', () => selectGame(game)); $('games').append(button);
  });
}
async function loadGames() {
  if (state.busy || state.loading) return;
  const source = $('game-source').value, username = $('username').value.trim();
  void rememberUsername(source, username);
  if (!username) return;
  stopPlayback(); cancelPositionSearch(); resetExploration(); state.positionAnalysis.clear(); state.branchAnalysis.clear(); state.selectedLine = null;
  state.loading = true; state.games = []; state.selected = null; state.parsed = null; state.result = null; state.ply = 0; state.opening = null; state.reviewId = null; state.bookmarks = [];
  showError(); renderGames(); renderMoves(); renderSummary(); renderBoard();
  $('game-title').textContent = 'Loading games…'; $('game-subtitle').textContent = 'Looking up completed games in the public archive.'; $('game-kind').textContent = 'LOADING ARCHIVE';
  $('review-status').textContent = ''; $('progress-area').hidden = true;
  $('library-status').textContent = 'Finding your completed games…';
  try {
    state.games = await fetchGames(source, username);
    savePreferences();
    renderGames();
    $('library-status').textContent = state.games.length ? 'Choose a game to explore.' : 'No recent completed standard games found. Newly finished games may take time to appear.';
    state.loading = false;
    if (state.games.length) selectGame(state.games[0]);
    else { $('game-title').textContent = 'No games found'; $('game-subtitle').textContent = 'Try another username or the sample game.'; $('game-kind').textContent = 'NO GAMES FOUND'; }
  } catch (error) {
    $('library-status').textContent = error.message || 'Could not load games. Please try again.';
    $('game-title').textContent = 'Could not load games'; $('game-subtitle').textContent = 'Check the username and your connection.'; $('game-kind').textContent = 'ARCHIVE UNAVAILABLE';
    showError(error.message || 'The public game archive is unavailable. Please try again.');
  } finally { state.loading = false; updateControls(); }
}
async function review() {
  if (!state.parsed || state.busy || state.loading) return;
  stopPlayback(); cancelPositionSearch(); resetExploration(); state.positionAnalysis.clear(); state.branchAnalysis.clear(); state.selectedLine = null;
  const selected = state.selected;
  const choice = selectedEngine(); state.reviewEngine = choice.label;
  const startedAt = performance.now();
  const analysis = { engineId: choice.id, engineName: choice.label, moveTimeMs: Number($('depth').value), multiPV: Number($('multipv').value), smartAnalysis: $('smart-analysis').checked };
  $('save-status').textContent = '';
  state.busy = true; state.controller = new AbortController(); state.result = null;
  showError(); renderMoves(); renderSummary(); renderBoard();
  $('progress-area').hidden = false; $('progress').value = 0; $('progress-text').textContent = `Starting ${choice.label}…`; $('review-status').textContent = '';
  try {
    const result = await analyzeGame(selected.pgn, {
      engineFactory: () => createEngine(choice.id), smartAnalysis: analysis.smartAnalysis, moveTimeMs: Number($('depth').value), multiPV: Number($('multipv').value), signal: state.controller.signal,
      onProgress: ({ completed, total, phase, phaseCompleted, phaseTotal }) => {
        $('progress').value = total ? completed / total * 100 : 0;
        $('progress-text').textContent = `${phase === 'recheck' ? `Rechecking key positions ${phaseCompleted} of ${phaseTotal}` : `First pass ${phaseCompleted ?? completed} of ${phaseTotal ?? total}`} · ${Math.floor((performance.now() - startedAt) / 1000)}s elapsed`;
      }
    });
    state.result = result; state.opening = result.opening || state.opening;
    $('progress-area').hidden = true;
    $('review-status').textContent = 'Review complete.';
    $('analyze-button').textContent = 'Review again';
    renderMoves(); renderSummary();
    state.ply = 0;
    $('engine-panel').open = false;
    setReviewTab('summary');
    renderBoard();
    await persistReview(selected, result, analysis);
  } catch (error) {
    $('progress-area').hidden = true;
    if (error.name === 'AbortError' || state.controller.signal.aborted) $('review-status').textContent = 'Review canceled.';
    else { $('review-status').textContent = 'Review could not finish.'; showError(error.message || 'The local engine could not start. Please reload and try again.'); }
  } finally { state.busy = false; state.controller = null; renderBoard(); }
}
function currentFen() { return state.study?.line.fen || state.parsed?.positions[state.ply] || new Chess().fen(); }
function currentMove() { return state.study ? state.study.line.moves[state.study.line.cursor - 1] : state.parsed?.moves[state.ply - 1]; }
function positionIndex() { return state.study ? state.study.line.cursor : state.ply; }
function positionCount() { return state.study ? state.study.line.moves.length : state.parsed?.moves.length || 0; }
function answersHidden() { return !!state.retry && !state.retry.revealed; }
function positionKey() { return state.study ? `${state.study.line.initialFen}|${state.study.line.history.join(' ')}` : state.ply; }
function canMovePieces() { return !!state.parsed && !state.busy && !state.loading && !state.libraryBusy && !state.importing && !state.positionController && !state.pendingPromotion && (!state.retry || state.retry.status === 'solve'); }
function cancelRetry() { state.retry?.controller?.abort(); state.retry = null; }
function resetExploration() {
  if (state.retry?.oldFlipped !== undefined) state.flipped = state.retry.oldFlipped;
  cancelRetry(); state.study = null; state.selectedSquare = null; state.pendingPromotion = null; state.hoverLine = null;
  $('promotion-picker').close();
}
function orientToPlayer(game) {
  if (!$('auto-orient').checked) return;
  const source = game.source || 'chesscom';
  const identity = source === $('game-source').value ? $('username').value.trim() : savedUsernames[source];
  const candidates = [identity, savedUsernames[source]].filter(value => typeof value === 'string' && /^[\w-]{2,50}$/.test(value)).map(value => value.toLowerCase());
  state.flipped = candidates.includes(game.black.username.toLowerCase()) && !candidates.includes(game.white.username.toLowerCase());
}
function renderOpening() {
  const opening = state.opening;
  $('opening-info').hidden = !opening || !!state.study;
  if (!opening) return;
  $('opening-name').textContent = opening.name ? `${opening.eco} · ${opening.name}` : 'Known opening line';
  const move = opening.departurePly ? state.parsed.moves[opening.departurePly - 1] : null;
  $('opening-detail').textContent = move ? `Left the recorded line at ${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '…'} ${move.san}` : `${opening.lastBookPly} opening plies matched`;
}
function renderStudyControls() {
  const study = state.study;
  $('study-controls').hidden = !study;
  if (!state.pendingPromotion && $('promotion-picker').open) $('promotion-picker').close();
  if (study) {
    $('study-title').textContent = state.retry ? state.retry.revealed ? 'Puzzle answer' : 'Retry this move' : study.kind === 'consequence' ? 'What happens next' : 'Analysis variation';
    $('study-message').textContent = study.message || (answersHidden() ? 'Choose a piece, then its destination. You can also drag it.' : 'Step through the line, or move a piece to try an alternative.');
    $('study-moves').replaceChildren();
    if (!answersHidden()) {
      const start = document.createElement('button'); start.type = 'button'; start.textContent = 'Start'; start.classList.toggle('active', study.line.cursor === 0); start.addEventListener('click', () => navigatePosition(0)); $('study-moves').append(start);
      study.line.moves.forEach((move, index) => {
        const button = document.createElement('button'); button.type = 'button';
        button.append(`${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '…'} `, createMoveNotation(move.san, move.color));
        button.setAttribute('aria-label', `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '…'} ${move.san}`);
        button.classList.toggle('active', study.line.cursor === index + 1); button.addEventListener('click', () => navigatePosition(index + 1)); $('study-moves').append(button);
      });
    }
    $('undo-variation').hidden = !!state.retry;
    $('undo-variation').disabled = !study.line.canBack || !!state.positionController;
  }
  document.querySelector('.insight-actions').hidden = !!study || !state.result || !state.ply;
  const hide = answersHidden();
  document.querySelector('.board-column').classList.toggle('retry-hidden', hide);
  for (const selector of ['.chart-panel', '.keyboard-hint', '.review-tabs', '.move-section', '#summary-panel', '#practice-panel', '.engine-panel', '.player-score']) {
    for (const element of document.querySelectorAll(selector)) element.classList.toggle('review-hidden', hide);
  }
  $('retry-panel').hidden = !state.retry;
  if (state.retry) {
    $('retry-feedback').textContent = state.retry.feedback || `${state.parsed.moves[state.retry.targetPly - 1].color === 'w' ? 'White' : 'Black'} to move. Find a better move without the engine hints.`;
    $('retry-reset').hidden = state.retry.status === 'solve';
    $('retry-reset').disabled = !!state.retry.controller;
    $('retry-reveal').disabled = !!state.retry.controller || state.retry.revealed;
    $('retry-next').disabled = !!state.retry.controller || !nextMistakePly(state.retry.targetPly);
  }
  renderOpening();
}
function showPromotion(from, to, choices) {
  stopPlayback();
  const fen = currentFen(), color = new Chess(fen).turn();
  state.pendingPromotion = { from, to, fen };
  const picker = $('promotion-picker');
  picker.hidden = false;
  for (const button of picker.querySelectorAll('[data-promotion]')) {
    button.hidden = !choices.includes(button.dataset.promotion);
    button.querySelector('img').src = `pieces/${color}${button.dataset.promotion}.png`;
  }
  picker.showModal();
  picker.querySelector('[data-promotion]:not([hidden])')?.focus();
}
function cancelPromotion() {
  const from = state.pendingPromotion?.from;
  state.pendingPromotion = null;
  $('promotion-picker').close();
  if (from) { state.selectedSquare = from; state.focusSquare = from; }
  renderBoard();
  if (from) $('board').querySelector(`[data-square="${from}"]`)?.focus({ preventScroll: true });
}
function chooseSquare(square) {
  if (!canMovePieces()) return;
  const chess = new Chess(currentFen());
  if (state.selectedSquare === square) { state.selectedSquare = null; renderBoard(); return; }
  if (state.selectedSquare) {
    const legal = chess.moves({ square: state.selectedSquare, verbose: true }).filter(move => move.to === square);
    if (legal.length) { playBoardMove(state.selectedSquare, square); return; }
  }
  state.selectedSquare = chess.get(square)?.color === chess.turn() ? square : null;
  state.focusSquare = square; renderBoard();
}
async function playBoardMove(from, to, promotion) {
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return;
  if (!state.parsed || state.busy || state.loading || state.positionController || state.retry?.controller || (state.pendingPromotion && !promotion)) return;
  if (state.retry && state.retry.status !== 'solve') return;
  if (state.pendingPromotion && (state.pendingPromotion.fen !== currentFen() || state.pendingPromotion.from !== from || state.pendingPromotion.to !== to)) { cancelPromotion(); return; }
  const choices = new Chess(currentFen()).moves({ square: from, verbose: true }).filter(move => move.to === to);
  if (!choices.length) return;
  const promotions = choices.map(move => move.promotion).filter(Boolean);
  if (promotions.length && !promotion) { showPromotion(from, to, promotions); return; }
  if (promotion && !promotions.includes(promotion)) return;
  try {
    setReviewTab('moves');
    stopPlayback(); state.pendingPromotion = null;
    $('promotion-picker').close(); state.hoverLine = null; state.selectedSquare = null; state.focusSquare = to;
    if (!state.study) state.study = { line: createStudyLine(state.selected.pgn, state.ply), returnPly: state.ply, kind: 'variation' };
    const move = state.study.line.play({ from, to, ...(promotion ? { promotion } : {}) });
    state.study.message = '';
    renderBoard();
    if (state.retry) await checkRetry(move.uci);
  } catch (error) { showError(error.message || 'That move could not be played.'); }
}
function startVariation(candidate) {
  if (!state.parsed || state.busy || state.loading || state.retry) return;
  stopPlayback(); cancelPositionSearch(); state.selectedSquare = null; state.hoverLine = null; state.pendingPromotion = null;
  setReviewTab('moves');
  const existing = state.study;
  const prefix = existing ? existing.line.moves.slice(0, existing.line.cursor).map(move => move.uci) : [];
  const line = candidate.pv?.[0] === candidate.bestMove ? candidate.pv : [candidate.bestMove];
  const study = createStudyLine(state.selected.pgn, existing?.line.basePly ?? state.ply, [...prefix, ...line]);
  study.goTo(Math.min(prefix.length + 1, study.moves.length));
  state.study = { line: study, returnPly: existing?.returnPly ?? state.ply, kind: 'variation', message: study.truncated ? 'The legal part of this engine line is shown.' : '' };
  renderBoard();
}
function returnToGame() {
  const returnPly = state.retry?.targetPly ?? state.study?.returnPly ?? state.ply;
  if (state.retry?.oldFlipped !== undefined) state.flipped = state.retry.oldFlipped;
  stopPlayback(); cancelPositionSearch(); resetExploration();
  state.ply = returnPly; renderBoard();
}
function navigatePosition(ply, { playback = false } = {}) {
  if (!state.parsed || (state.retry && !state.retry.revealed)) return;
  if (!state.study) { goTo(ply, { playback }); return; }
  if (!playback) stopPlayback();
  cancelPositionSearch(); state.hoverLine = null; state.selectedSquare = null; state.pendingPromotion = null;
  state.study.line.goTo(Math.max(0, Math.min(state.study.line.moves.length, ply)));
  renderBoard();
}
function nextMistakePly(after) { return state.result?.moves.find(move => move.ply > after && ['Inaccuracy', 'Mistake', 'Blunder'].includes(move.label))?.ply; }
function startRetry(ply = state.ply) {
  if (!state.result || state.busy || state.loading || !state.parsed.moves[ply - 1]) return;
  setReviewTab('moves');
  const originalFlip = state.retry?.oldFlipped ?? state.flipped;
  stopPlayback(); cancelPositionSearch(); resetExploration();
  state.retry = { targetPly: ply, status: 'solve', revealed: false, result: null, controller: null, oldFlipped: originalFlip };
  state.study = { line: createStudyLine(state.selected.pgn, ply - 1), returnPly: ply, kind: 'retry' };
  state.ply = ply - 1; state.flipped = state.parsed.moves[ply - 1].color === 'b';
  $('review-settings').open = false; showError(); renderBoard();
}
async function checkRetry(uci) {
  const retry = state.retry, selected = state.selected;
  if (!retry) return;
  const controller = new AbortController(); retry.controller = controller; retry.status = 'checking'; retry.feedback = 'Checking your move…';
  const engineId = selectedEngine().id;
  renderBoard();
  try {
    const result = await gradeRetry(selected.pgn, retry.targetPly, uci, { engineFactory: () => createEngine(engineId), moveTimeMs: Math.max(1000, Number($('depth').value)), signal: controller.signal });
    if (state.retry !== retry || state.selected !== selected || controller.signal.aborted) return;
    retry.result = result; retry.status = result.status; retry.feedback = result.accepted === true ? `Good move. ${result.feedback}` : result.feedback;
  } catch (error) {
    if (!controller.signal.aborted && state.retry === retry) { retry.status = 'uncertain'; retry.feedback = error.message || 'Could not check this attempt. Try again.'; }
  } finally {
    if (state.retry === retry) { retry.controller = null; renderBoard(); }
  }
}
function revealRetry() {
  const retry = state.retry;
  if (!retry || retry.controller) return;
  const evaluation = retry.result?.before || state.result.positions[retry.targetPly - 1];
  if (!evaluation?.bestMove) { retry.feedback = 'No reliable continuation is available here. Review more deeply or choose another move.'; renderBoard(); return; }
  const line = evaluation.pv?.[0] === evaluation.bestMove ? evaluation.pv : [evaluation.bestMove];
  state.study = { line: createStudyLine(state.selected.pgn, retry.targetPly - 1, line), returnPly: retry.targetPly, kind: 'retry-answer', message: 'Step through the suggested continuation, then return to the game.' };
  state.study.line.forward(); retry.revealed = true; retry.status = 'revealed';
  retry.feedback = `The engine's suggestion: ${state.study.line.moves[0]?.san || evaluation.bestMove}. This is a limited-search estimate.`;
  state.selectedSquare = null; renderBoard();
}
function showConsequence() {
  if (!state.result || state.study || state.retry || !state.ply) return;
  setReviewTab('moves');
  const move = state.result.moves[state.ply - 1];
  const evaluation = state.positionAnalysis.get(state.ply) || state.result.positions[state.ply];
  stopPlayback(); cancelPositionSearch();
  // Check the original game's history before describing the continuation: a
  // FEN alone cannot tell when a line ends through threefold repetition.
  const line = createStudyLine(state.selected.pgn, state.ply, Array.isArray(evaluation?.pv) ? evaluation.pv.slice(0, 24) : []);
  line.goTo(line.moves.length);
  const draw = line.terminal && line.terminalReason !== 'Checkmate' ? line.terminalReason : null;
  const evidence = draw
    ? { type: 'draw', text: `${line.moves.length ? 'This continuation ends in a draw' : 'This position is drawn'}: ${draw.toLowerCase()}.`, highlights: [] }
    : explainConsequence(move, { ...evaluation, pv: line.moves.map(item => item.uci) });
  line.goTo(Math.min(1, line.moves.length));
  state.study = { line, returnPly: state.ply, kind: 'consequence', message: evidence.text, evidence };
  state.selectedSquare = null; state.hoverLine = null; renderBoard();
}

function savedTitle(game) { return `${game?.white?.username || 'White'} vs ${game?.black?.username || 'Black'}`; }
async function refreshLibrary() {
  try {
    const [reviews, practice, bookmarks] = await Promise.all([reviewLibrary.listReviews(), reviewLibrary.listPracticePositions(), reviewLibrary.listBookmarks()]);
    state.savedReviews = reviews; state.practiceItems = practice; state.bookmarkItems = bookmarks;
    $('saved-status').textContent = reviews.length ? 'Stored only on this device.' : 'Completed reviews will be saved here.';
    renderSavedReviews(); renderNotebook();
  } catch (error) { $('saved-status').textContent = error.message || 'Local review storage is unavailable.'; }
}
function renderSavedReviews() {
  $('saved-count').textContent = String(state.savedReviews.length);
  const query = $('saved-search').value.trim().toLowerCase();
  $('saved-games').replaceChildren();
  for (const record of state.savedReviews.filter(item => !query || `${savedTitle(item.game)} ${item.opening?.name || ''} ${item.game?.pgn || ''}`.toLowerCase().includes(query))) {
    const row = document.createElement('div'); row.className = 'saved-row';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'saved-open'; open.dataset.reviewId = record.id; open.dataset.invalid = String(!!record.invalid); open.disabled = !!record.invalid || state.busy || state.loading;
    const name = document.createElement('strong'); name.textContent = record.invalid ? 'Unreadable saved review' : savedTitle(record.game);
    const detail = document.createElement('small'); detail.textContent = record.invalid ? 'Remove this record to free space.' : `${record.analysis?.engineName || 'Local review'}${record.stale ? ' · older analysis' : ''} · ${record.bookmarkCount || 0} saved positions`;
    open.append(name, detail); open.addEventListener('click', () => openSavedReview(record.id));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'saved-delete'; remove.textContent = '×'; remove.title = 'Delete saved review'; remove.setAttribute('aria-label', `Delete saved review ${savedTitle(record.game)}`); remove.disabled = state.busy;
    remove.addEventListener('click', async () => { remove.disabled = true; try { await reviewLibrary.deleteReview(record.id); if (state.reviewId === record.id) { state.reviewId = null; state.bookmarks = []; $('save-status').textContent = 'Saved copy deleted.'; renderBoard(); } await refreshLibrary(); } catch (error) { $('saved-status').textContent = error.message; remove.disabled = false; } });
    row.append(open, remove); $('saved-games').append(row);
  }
}
async function persistReview(game, result, analysis) {
  try {
    const record = await reviewLibrary.saveReview(game, result, { ...analysis, analysisVersion: ANALYSIS_VERSION });
    if (state.selected === game && state.result === result) { state.reviewId = record.id; state.bookmarks = record.bookmarks || []; state.recordMeta = analysis; $('save-status').textContent = 'Saved on this device.'; updateControls(); }
    await refreshLibrary();
  } catch (error) { if (state.selected === game) $('save-status').textContent = `Review kept open, but not saved: ${error.message}`; }
}
async function openSavedReview(id, options = {}) {
  const { ply = 0, practice = false } = options;
  if (state.busy || state.loading || state.libraryBusy || state.retry?.controller) return;
  state.libraryBusy = true; updateControls();
  try {
    const record = await reviewLibrary.loadReview(id);
    if (!record) throw new Error('This saved review was removed.');
    selectGame(record.game);
    if (state.selected !== record.game) return;
    state.result = record.result; state.opening = Object.hasOwn(record.result, 'opening') ? record.result.opening : state.opening; state.reviewEngine = record.analysis.engineName || record.analysis.engineId; state.reviewId = record.id; state.bookmarks = record.bookmarks || []; state.recordMeta = record.analysis;
    state.ply = Math.max(0, Math.min(state.parsed.moves.length, ply));
    $('analyze-button').textContent = 'Review again'; $('review-status').textContent = record.stale ? 'Saved review from an older analysis version. Review again to update it.' : 'Saved review loaded.'; $('save-status').textContent = 'Stored on this device.';
    renderMoves(); renderSummary(); setReviewTab(Object.hasOwn(options, 'ply') ? 'moves' : 'summary'); renderBoard();
    if (practice) startRetry(ply);
  } catch (error) { showError(error.message || 'The saved review could not be opened.'); }
  finally { state.libraryBusy = false; renderBoard(); }
}
async function toggleBookmark() {
  if (!state.reviewId || state.study || state.retry || state.busy) return;
  const id = state.reviewId, ply = state.ply;
  $('bookmark-position').disabled = true;
  try {
    const change = await reviewLibrary.toggleBookmark(id, ply);
    if (state.reviewId === id) {
      state.bookmarks = state.bookmarks.filter(item => item.ply !== ply);
      if (change.bookmarked) state.bookmarks.push(change.bookmark);
      $('save-status').textContent = change.bookmarked ? 'Position bookmarked.' : 'Bookmark removed.'; updateControls();
    }
    await refreshLibrary();
  } catch (error) { $('save-status').textContent = error.message; updateControls(); }
}
function renderNotebook() {
  $('notebook-count').textContent = String(state.practiceItems.length + state.bookmarkItems.length);
  for (const [id, entries, practice] of [['practice-items', state.practiceItems, true], ['bookmark-items', state.bookmarkItems, false]]) {
    const container = $(id); container.replaceChildren();
    const heading = document.createElement('h4'); heading.textContent = practice ? 'Mistakes to retry' : 'Bookmarked positions'; container.append(heading);
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'notebook-empty'; empty.textContent = practice ? 'Review a game to collect mistakes for practice.' : 'Use Bookmark on any reviewed position.'; container.append(empty); }
    for (const entry of entries) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'notebook-item'; button.dataset.ply = entry.ply; button.dataset.reviewId = entry.reviewId;
      const name = document.createElement('strong'); name.textContent = savedTitle(entry.game);
      const detail = document.createElement('span'); detail.textContent = `${entry.ply ? `Move ${Math.ceil(entry.ply / 2)}` : 'Starting position'} · ${practice ? entry.label : 'Bookmark'}${entry.stale ? ' · older review' : ''}`;
      button.append(name, detail); button.disabled = state.busy || state.loading; button.addEventListener('click', () => openSavedReview(entry.reviewId, { ply: entry.ply, practice })); container.append(button);
    }
  }
}

for (const view of ['moves', 'summary', 'practice']) $(`${view}-tab`).addEventListener('click', () => { if (state.study && view !== 'moves') returnToGame(); setReviewTab(view); });
document.querySelector('.review-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const names = state.result ? ['summary', 'moves', 'practice'] : ['moves', 'practice'];
  const current = names.indexOf(event.target.id.replace('-tab', ''));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
  if (state.study && names[next] !== 'moves') returnToGame();
  setReviewTab(names[next], true);
});
$('library-toggle').addEventListener('click', () => setLibraryOpen($('library-toggle').getAttribute('aria-expanded') !== 'true'));
$('close-library').addEventListener('click', () => setLibraryOpen(false));
$('library-dialog').addEventListener('close', () => $('library-toggle').setAttribute('aria-expanded', 'false'));
$('username').addEventListener('change', () => { void rememberUsername(usernameSource, $('username').value); });
$('username-form').addEventListener('submit', event => { event.preventDefault(); loadGames(); });
$('demo-button').addEventListener('click', () => selectGame(sample));
$('analyze-button').addEventListener('click', review);
$('cancel-button').addEventListener('click', () => state.controller?.abort());
$('flip-button').addEventListener('click', () => { state.flipped = !state.flipped; renderBoard(); });
$('first-button').addEventListener('click', () => navigatePosition(0));
$('previous-button').addEventListener('click', () => navigatePosition(positionIndex() - 1));
$('next-button').addEventListener('click', () => navigatePosition(positionIndex() + 1));
$('last-button').addEventListener('click', () => navigatePosition(positionCount()));
$('previous-key').addEventListener('click', () => { const ply = keyPlies().filter(p => p < state.ply).at(-1); if (ply != null) goTo(ply); });
$('next-key').addEventListener('click', () => { const ply = keyPlies().find(p => p > state.ply); if (ply != null) goTo(ply); });
$('deepen-button').addEventListener('click', () => deepenPosition(false));
$('quick-position').addEventListener('click', () => deepenPosition(true));
$('game-source').addEventListener('change', () => {
  void rememberUsername(usernameSource, $('username').value);
  usernameSource = $('game-source').value;
  syncSource(); $('username').value = savedUsernames[usernameSource] ?? ''; savePreferences();
  $('library-status').textContent = 'Enter a username to find completed games.';
});
function importUnavailable() { return state.busy || state.loading || state.importing || state.libraryBusy || state.positionController || state.retry?.controller; }
function renderImportedGames(collection) {
  state.importGames = collection.games;
  $('import-games').replaceChildren(); $('import-error-list').replaceChildren();
  $('import-results').hidden = !collection.games.length && !collection.rejected.length;
  $('import-errors').hidden = !collection.rejected.length;
  $('import-errors').open = !collection.games.length;
  for (const [index, game] of collection.games.entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'game-card import-game'; button.dataset.index = index;
    const name = document.createElement('strong'); name.textContent = savedTitle(game);
    const detail = document.createElement('span'); detail.className = 'game-meta'; detail.textContent = game.white.result === 'win' ? '1–0' : game.black.result === 'win' ? '0–1' : '½–½';
    button.append(name, detail); button.addEventListener('click', () => { if (!importUnavailable()) { selectGame(game); $('import-status').textContent = 'Game opened. Choose Review game when ready.'; } });
    $('import-games').append(button);
  }
  for (const rejected of collection.rejected) {
    const item = document.createElement('li'); item.textContent = `Game ${rejected.index}: ${rejected.message}`; $('import-error-list').append(item);
  }
  $('import-status').textContent = `${collection.games.length} ${collection.games.length === 1 ? 'game' : 'games'} ready${collection.rejected.length ? ` · ${collection.rejected.length} skipped` : ''}. Choose a game to open.`;
  if (!collection.games.length) $('import-status').textContent = 'No completed games could be opened. See the skipped games below.';
}
function openImportedGames(pgn, files = false) {
  if (importUnavailable()) return;
  showError();
  try {
    const collection = files ? importPgnFiles(pgn) : importPgnCollection(pgn);
    renderImportedGames(collection);
    if (collection.games.length === 1 && !collection.rejected.length) {
      selectGame(collection.games[0]); $('import-status').textContent = 'Game opened. The PGN stays on your device.';
    }
  } catch (error) {
    renderImportedGames({ games: [], rejected: [] });
    $('import-status').textContent = error.message || 'Could not read this PGN.';
  }
}
async function readPgnFiles(files) {
  if (importUnavailable() || !files.length) return;
  showError();
  if (files.some(file => !/\.(pgn|txt)$/i.test(file.name))) { $('import-status').textContent = 'Choose PGN or plain text files.'; return; }
  if (files.reduce((total, file) => total + file.size, 0) > PGN_IMPORT_MAX_BYTES) { $('import-status').textContent = 'These files are too large. Import up to 5 MiB at a time.'; return; }
  state.importing = true; updateControls(); $('import-status').textContent = 'Reading games…';
  try {
    const texts = await Promise.all(files.map(file => file.text()));
    state.importing = false;
    openImportedGames(texts, true);
  } catch { $('import-status').textContent = 'Could not read this file. Try pasting its PGN instead.'; }
  finally { state.importing = false; $('pgn-file').value = ''; updateControls(); }
}
$('import-button').addEventListener('click', () => openImportedGames($('pgn-text').value));
$('pgn-file').addEventListener('change', () => { const files = [...$('pgn-file').files]; $('pgn-file').value = ''; readPgnFiles(files); });
$('pgn-dropzone').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('pgn-dropzone').classList.add('drag-over'); });
$('pgn-dropzone').addEventListener('dragleave', event => { if (!$('pgn-dropzone').contains(event.relatedTarget)) $('pgn-dropzone').classList.remove('drag-over'); });
$('pgn-dropzone').addEventListener('drop', event => {
  event.preventDefault(); $('pgn-dropzone').classList.remove('drag-over');
  if (event.dataTransfer.files.length) readPgnFiles([...event.dataTransfer.files]);
  else openImportedGames(event.dataTransfer.getData('text/plain'));
});
$('pgn-dropzone').addEventListener('keydown', event => { if (event.target === $('pgn-dropzone') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); $('pgn-file').click(); } });
// Prevent a misplaced file drop from navigating away from the review.
for (const type of ['dragover', 'drop']) document.addEventListener(type, event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
$('stop-position').addEventListener('click', () => { cancelPositionSearch(); renderBoard(); });
$('play-button').addEventListener('click', startPlayback);
for (const id of ['engine', 'depth', 'multipv', 'arrow-mode', 'smart-analysis', 'auto-orient', 'show-arrows', 'show-badges', 'show-coordinates', 'play-speed']) {
  $(id).addEventListener('change', () => {
    if (id === 'engine') syncEngine();
    if (id === 'auto-orient' && state.selected && !state.retry) orientToPlayer(state.selected);
    if (id === 'depth' && $('depth').value === '50') $('multipv').value = '1';
    if (id === 'play-speed' && state.playTimer) { stopPlayback(); startPlayback(); }
    state.selectedLine = null; savePreferences(); renderMoves(); renderBoard();
  });
}

$('return-game').addEventListener('click', returnToGame);
$('undo-variation').addEventListener('click', () => navigatePosition(positionIndex() - 1));
$('retry-move').addEventListener('click', () => startRetry());
$('retry-reset').addEventListener('click', () => { if (state.retry && !state.retry.controller) startRetry(state.retry.targetPly); });
$('retry-reveal').addEventListener('click', revealRetry);
$('retry-next').addEventListener('click', () => { const ply = nextMistakePly(state.retry?.targetPly || 0); if (ply) startRetry(ply); });
$('retry-exit').addEventListener('click', returnToGame);
$('show-why').addEventListener('click', showConsequence);
$('bookmark-position').addEventListener('click', toggleBookmark);
$('saved-search').addEventListener('input', renderSavedReviews);
$('open-notebook').addEventListener('click', () => { if (!state.retry) { setReviewTab('practice'); setLibraryOpen(false); $('practice-panel').scrollIntoView({ block: 'nearest' }); } });
$('cancel-promotion').addEventListener('click', cancelPromotion);
$('promotion-picker').addEventListener('cancel', event => { event.preventDefault(); cancelPromotion(); });
for (const button of $('promotion-picker').querySelectorAll('[data-promotion]')) button.addEventListener('click', () => { const pending = state.pendingPromotion; if (pending) playBoardMove(pending.from, pending.to, button.dataset.promotion); });
$('board').addEventListener('keydown', event => {
  const directions = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
  if (event.key === 'Escape') { state.selectedSquare = null; state.pendingPromotion = null; renderBoard(); return; }
  if (!(event.key in directions)) return;
  event.preventDefault(); event.stopPropagation();
  const squares = [...$('board').querySelectorAll('.square')]; const index = squares.indexOf(event.target.closest('.square'));
  if (index < 0) return;
  const next = Math.max(0, Math.min(63, index + directions[event.key])); state.focusSquare = squares[next].dataset.square;
  squares.forEach((square, i) => { square.tabIndex = i === next ? 0 : -1; }); squares[next].focus();
});

for (const label of MOVE_LABELS) {
  const row = document.createElement('div'); row.className = 'legend-row';
  const name = document.createElement('strong'); name.textContent = label;
  const description = document.createElement('span'); description.textContent = badgeDescriptions[label];
  row.append(makeBadge(label), name, description); $('classification-legend').append(row);
}
document.addEventListener('keydown', event => {
  if ($('support-dialog').open || $('tutorial-dialog').open || $('library-dialog').open || $('promotion-picker').open || answersHidden() || event.target.closest('#board') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); navigatePosition(positionIndex() - 1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); navigatePosition(positionIndex() + 1); }
  if (event.key === 'Home') { event.preventDefault(); navigatePosition(0); }
  if (event.key === 'End') { event.preventDefault(); navigatePosition(positionCount()); }
  if (event.target.closest('.chart-hit') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) document.querySelector('.chart-hit button.active')?.focus({ preventScroll: true });
});
window.addEventListener('beforeunload', () => { state.controller?.abort(); cancelPositionSearch(); cancelRetry(); stopPlayback(); reviewLibrary.close().catch(() => {}); });
syncEngine(); syncSource(); renderBoard(); refreshLibrary();
async function initializeReview() {
  let remembered;
  try {
    if (globalThis.chrome?.storage?.local) {
      const { username, usernames, reviewSettings } = await chrome.storage.local.get(['username', 'usernames', 'reviewSettings']);
      if (usernames && typeof usernames === 'object') for (const source of ['chesscom', 'lichess']) if (typeof usernames[source] === 'string') savedUsernames[source] = usernames[source];
      if (username && !savedUsernames.chesscom && !usernames) savedUsernames.chesscom = username;
      restorePreferences(reviewSettings);
      remembered = savedUsernames[$('game-source').value];
    }
  } catch { /* The game picker remains usable when preferences are unavailable. */ }
  usernameSource = $('game-source').value;
  $('username').value = remembered ?? '';
  syncEngine(); syncSource(); renderMoves(); renderBoard();
  // Finish the optional support prompt and guide before opening Games or fetching a remembered account.
  const query = new URLSearchParams(location.search);
  const requestedReview = query.get('reviewId');
  const openSiteSettings = query.get('siteSettings') === '1';
  const validReview = /^game-[a-f0-9]{64}$/.test(requestedReview || '');
  const autoOpen = !validReview && !openSiteSettings;
  await supportPrompt.start({ autoOpen });
  await tutorial.start({ autoOpen });
  state.starting = false; updateControls();
  if (validReview) { await openSavedReview(requestedReview); return; }
  if (openSiteSettings) {
    $('review-settings').open = true;
    document.querySelector('.site-review-settings').scrollIntoView({ block: 'center' });
    $('site-chesscom-enabled').focus({ preventScroll: true });
    return;
  }
  if (remembered && !state.selected && !state.loading) {
    setLibraryOpen(true); loadGames();
  } else if (!state.selected) setLibraryOpen(true);
}
initializeReview();
