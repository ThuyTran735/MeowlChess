import { Chess } from './vendor/chess.js';
import { fetchRecentGames } from './lib/archive.js';
import { parseGame, analyzeGame, MOVE_LABELS } from './lib/review.js';

const $ = (id) => document.getElementById(id);
const state = { games: [], selected: null, parsed: null, result: null, ply: 0, flipped: false, busy: false, loading: false, controller: null };
const badgeSymbols = { Brilliant: '!!', Great: '!', Best: '★', Excellent: '✓', Good: '✓', Inaccuracy: '?!', Mistake: '?', Blunder: '??' };
const badgeDescriptions = { Brilliant: 'Sound sacrifice in the engine line', Great: 'Best reply after an opponent’s error', Best: 'The engine’s first choice', Excellent: 'Almost no estimated loss', Good: 'A reasonable move', Inaccuracy: 'A small missed opportunity', Mistake: 'A significant loss of chances', Blunder: 'A large loss of chances' };
function makeBadge(label, extraClass = '') {
  const badge = document.createElement('span'); badge.className = `move-badge ${label.toLowerCase()} ${extraClass}`;
  badge.textContent = badgeSymbols[label] || '•'; badge.title = label; badge.setAttribute('aria-label', label); return badge;
}
function pieceImage(color, type) {
  const image = document.createElement('img'); image.className = 'piece'; image.src = `pieces/${color}${type}.svg`; image.alt = ''; image.draggable = false; return image;
}
function keyPlies() { return state.result?.moves.filter(move => ['Brilliant', 'Great', 'Mistake', 'Blunder'].includes(move.label)).map(move => move.ply) || []; }
const sample = {
  pgn: '[Event "MeowlChess sample"]\n[Site "Local sample"]\n[Date "2026.01.01"]\n[White "Curious player"]\n[Black "A sharp reply"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
  white: { username: 'Curious player', result: 'checkmated' }, black: { username: 'A sharp reply', result: 'win' },
  time_class: 'sample', end_time: 1767225600, rules: 'chess', sample: true
};
function showError(message = '') { $('error').hidden = !message; $('error').textContent = message; }
function displayEvaluation(evaluation) {
  if (!evaluation) return '—';
  if (evaluation.mate !== null && evaluation.mate !== undefined) return `${evaluation.cp < 0 ? '−' : ''}M${Math.abs(evaluation.mate)}`;
  return `${evaluation.cp > 0 ? '+' : ''}${(evaluation.cp / 100).toFixed(1)}`;
}
function updateControls() {
  const unavailable = state.busy || state.loading;
  $('load-button').disabled = unavailable;
  $('username').disabled = unavailable;
  $('demo-button').disabled = unavailable;
  $('depth').disabled = state.busy;
  $('analyze-button').disabled = !state.parsed || unavailable;
  $('analyze-button').hidden = state.busy;
  $('cancel-button').hidden = !state.busy;
  $('first-button').disabled = !state.parsed || state.ply === 0;
  $('previous-button').disabled = !state.parsed || state.ply === 0;
  $('next-button').disabled = !state.parsed || state.ply >= state.parsed.moves.length;
  $('last-button').disabled = !state.parsed || state.ply >= state.parsed.moves.length;
  const keys = keyPlies();
  $('key-moments').hidden = !keys.length;
  $('previous-key').disabled = !keys.some(ply => ply < state.ply);
  $('next-key').disabled = !keys.some(ply => ply > state.ply);
  for (const button of document.querySelectorAll('.game-card')) button.disabled = unavailable;
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
  const fen = state.parsed?.positions[state.ply];
  const chess = fen ? new Chess(fen) : new Chess();
  const board = $('board'); board.replaceChildren();
  const files = state.flipped ? 'hgfedcba' : 'abcdefgh';
  const ranks = state.flipped ? '12345678' : '87654321';
  const move = state.parsed?.moves[state.ply - 1];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const squareName = files[col] + ranks[row];
    const piece = chess.get(squareName);
    const square = document.createElement('div');
    square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
    square.dataset.square = squareName;
    if (piece) square.append(pieceImage(piece.color, piece.type));
    if (move && (move.from === squareName || move.to === squareName)) square.classList.add('last-move');
    const reviewedMove = state.result?.moves[state.ply - 1];
    if (move?.to === squareName && reviewedMove) square.append(makeBadge(reviewedMove.label, 'board-move-badge'));
    if (row === 7) { const coord = document.createElement('span'); coord.className = 'coordinate'; coord.textContent = files[col]; square.append(coord); }
    if (col === 0) { const coord = document.createElement('span'); coord.className = 'coordinate rank-coordinate'; coord.textContent = ranks[row]; square.append(coord); }
    square.setAttribute('aria-hidden', 'true'); board.append(square);
  }
  board.setAttribute('aria-label', `Chess board ${state.ply ? `after move ${state.ply}: ${move.san}` : 'in starting position'}. FEN: ${chess.fen()}`);
  $('position-label').textContent = state.ply ? `${Math.ceil(state.ply / 2)}${move.color === 'w' ? '.' : '…'} ${move.san}` : 'Starting position';
  const evaluation = state.result?.positions[state.ply];
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
  renderPlayers(); renderInsight(); updateControls();
  for (const button of document.querySelectorAll('.move-button, .chart-hit button')) {
    const active = Number(button.dataset.ply) === state.ply;
    button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'step' : 'false');
    if (button.closest('.chart-hit')) button.tabIndex = active ? 0 : -1;
  }
  const activeMove = document.querySelector('.move-button.active');
  if (activeMove) {
    const list = $('move-list'); const top = activeMove.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top < list.scrollTop || top + activeMove.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 2);
  }
}
function renderInsight() {
  const reviewMove = state.result?.moves[state.ply - 1];
  const insightBadge = $('insight-badge'); insightBadge.hidden = !reviewMove;
  if (reviewMove) {
    insightBadge.className = `move-badge insight-badge ${reviewMove.label.toLowerCase()}`;
    insightBadge.textContent = badgeSymbols[reviewMove.label]; insightBadge.setAttribute('aria-label', reviewMove.label);
  }
  $('best-move').hidden = !reviewMove?.bestSan;
  if (reviewMove) {
    $('insight-title').textContent = `${reviewMove.san} · ${reviewMove.label}`;
    $('insight-text').textContent = reviewMove.explanation || `Estimated evaluation loss: ${(reviewMove.loss / 100).toFixed(2)} pawns.`;
    $('best-move').textContent = `Engine's choice: ${reviewMove.bestSan}`;
  } else if (state.result) {
    $('insight-title').textContent = 'Starting position';
    $('insight-text').textContent = 'Select a move or use the arrows to step through the game. Evaluations are from White’s perspective.';
  } else {
    $('insight-title').textContent = state.parsed ? 'Ready to review' : 'No game selected';
    $('insight-text').textContent = state.parsed ? 'Run Stockfish to see move ratings, evaluations, and suggested moves.' : 'Enter a Chess.com username to load completed games, or try the sample.';
  }
}
function renderMoves() {
  const container = $('move-list'); container.replaceChildren();
  const moves = state.parsed?.moves || [];
  $('move-count').textContent = `${Math.ceil(moves.length / 2)} moves`;
  if (!moves.length) { const p = document.createElement('p'); p.className = 'muted move-empty'; p.textContent = "Your game's moves will appear here."; container.append(p); return; }
  let row;
  moves.forEach((move, index) => {
    if (index % 2 === 0) {
      row = document.createElement('div'); row.className = 'move-row';
      const number = document.createElement('span'); number.className = 'move-number'; number.textContent = `${Math.floor(index / 2) + 1}.`; row.append(number); container.append(row);
    }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'move-button'; button.dataset.ply = String(index + 1);
    const san = document.createElement('span'); san.textContent = move.san; button.append(san);
    const reviewMove = state.result?.moves[index];
    if (reviewMove) button.append(makeBadge(reviewMove.label));
    button.setAttribute('aria-label', `Move ${Math.floor(index / 2) + 1}, ${move.color === 'w' ? 'White' : 'Black'}: ${move.san}${reviewMove ? `, ${reviewMove.label}` : ''}`);
    button.addEventListener('click', () => goTo(index + 1)); row.append(button);
  });
}
function renderSummary() {
  const summary = $('summary'); summary.replaceChildren(); summary.hidden = !state.result;
  renderChart();
  if (!state.result) return;
  const scores = document.createElement('div'); scores.className = 'score-row';
  for (const color of ['w', 'b']) {
    const card = document.createElement('div'); card.className = 'score-card';
    const value = document.createElement('span'); value.className = 'score-value'; value.textContent = state.result.summary[color].accuracy?.toFixed(1) ?? '—';
    const info = document.createElement('div'); info.className = 'score-info';
    const name = document.createElement('strong'); name.textContent = state.selected[color === 'w' ? 'white' : 'black'].username;
    const caption = document.createElement('small'); caption.textContent = 'Study score · est.';
    info.append(name, caption); card.append(value, info); scores.append(card);
  }
  summary.append(scores);
  const totalsLabel = document.createElement('p'); totalsLabel.className = 'summary-caption'; totalsLabel.textContent = 'Move ratings · both players'; summary.append(totalsLabel);
  const counts = document.createElement('div'); counts.className = 'classification-counts';
  for (const label of MOVE_LABELS) {
    const total = (state.result.summary.w.counts[label] || 0) + (state.result.summary.b.counts[label] || 0);
    const row = document.createElement('div'); row.className = 'classification-count';
    const name = document.createElement('span'); name.textContent = label;
    const number = document.createElement('strong'); number.textContent = String(total);
    row.append(makeBadge(label), name, number); counts.append(row);
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
    const move = state.parsed.moves[ply - 1]; const label = `${ply ? `${Math.ceil(ply / 2)}${move.color === 'w' ? '.' : '…'} ${move.san}` : 'Starting position'}: ${displayEvaluation(evaluation)}`;
    button.title = label; button.setAttribute('aria-label', label); button.addEventListener('click', () => goTo(ply)); hit.append(button);
  }); chart.append(hit);
}
function goTo(ply) { if (!state.parsed) return; state.ply = Math.max(0, Math.min(state.parsed.moves.length, ply)); renderBoard(); }
function selectGame(game) {
  if (state.busy || state.loading) return;
  showError();
  try {
    const parsed = parseGame(game.pgn);
    state.selected = game; state.parsed = parsed; state.result = null; state.ply = 0;
    $('game-title').textContent = `${game.white.username} vs ${game.black.username}`;
    $('game-subtitle').replaceChildren();
    const subtitle = document.createElement('span'); subtitle.textContent = game.sample ? 'Sample · Fool’s mate · 0–1' : `${new Date(game.end_time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${parsed.headers?.Result || 'Completed'} · `;
    $('game-subtitle').append(subtitle);
    if (game.url && /^https:\/\/(www\.)?chess\.com\//.test(game.url)) {
      const link = document.createElement('a'); link.href = game.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'external-game'; link.textContent = 'View original game ↗'; $('game-subtitle').append(link);
    }
    $('game-kind').textContent = `${game.time_class || 'STANDARD'} · COMPLETED`;
    $('review-status').textContent = '';
    $('progress-area').hidden = true;
    $('analyze-button').replaceChildren(document.createTextNode('Review game ')); const arrow = document.createElement('span'); arrow.textContent = '↗'; $('analyze-button').append(arrow);
    for (const button of document.querySelectorAll('.game-card')) {
      const selected = state.games[Number(button.dataset.index)] === game;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    }
    renderMoves(); renderSummary(); renderBoard();
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
  const username = $('username').value.trim();
  if (!username) return;
  state.loading = true; state.games = []; state.selected = null; state.parsed = null; state.result = null; state.ply = 0;
  showError(); renderGames(); renderMoves(); renderSummary(); renderBoard();
  $('game-title').textContent = 'Loading games…'; $('game-subtitle').textContent = 'Looking up completed games in the public archive.'; $('game-kind').textContent = 'LOADING ARCHIVE';
  $('review-status').textContent = ''; $('progress-area').hidden = true;
  $('library-status').textContent = 'Finding your completed games…';
  try {
    state.games = await fetchRecentGames(username);
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ username }).catch(() => {});
    renderGames();
    $('library-status').textContent = state.games.length ? 'Choose a game to explore.' : 'No recent completed standard games found. Newly finished games may take time to appear.';
    state.loading = false;
    if (state.games.length) selectGame(state.games[0]);
    else { $('game-title').textContent = 'No games found'; $('game-subtitle').textContent = 'Try another username or the sample game.'; $('game-kind').textContent = 'NO GAMES FOUND'; }
  } catch (error) {
    $('library-status').textContent = 'Could not load games. Please try again.';
    $('game-title').textContent = 'Could not load games'; $('game-subtitle').textContent = 'Check the username and your connection.'; $('game-kind').textContent = 'ARCHIVE UNAVAILABLE';
    showError(error.message || 'The public game archive is unavailable. Please try again.');
  } finally { state.loading = false; updateControls(); }
}
async function review() {
  if (!state.parsed || state.busy || state.loading) return;
  const selected = state.selected;
  state.busy = true; state.controller = new AbortController(); state.result = null;
  showError(); renderMoves(); renderSummary(); renderBoard();
  $('progress-area').hidden = false; $('progress').value = 0; $('progress-text').textContent = 'Starting local Stockfish engine…'; $('review-status').textContent = '';
  try {
    const result = await analyzeGame(selected.pgn, {
      moveTimeMs: Number($('depth').value), signal: state.controller.signal,
      onProgress: ({ completed, total }) => {
        $('progress').value = total ? completed / total * 100 : 0;
        $('progress-text').textContent = `Reviewing position ${completed} of ${total}…`;
      }
    });
    state.result = result;
    $('progress-area').hidden = true;
    $('review-status').textContent = 'Review complete. Scores are estimates; deeper analysis may change them.';
    $('analyze-button').replaceChildren(document.createTextNode('Review again ')); const arrow = document.createElement('span'); arrow.textContent = '↗'; $('analyze-button').append(arrow);
    renderMoves(); renderSummary();
    const turningPoint = result.moves.find(move => move.label === 'Blunder') || result.moves.find(move => move.label === 'Mistake');
    state.ply = turningPoint?.ply || Math.min(1, state.parsed.moves.length);
    renderBoard();
  } catch (error) {
    $('progress-area').hidden = true;
    if (error.name === 'AbortError' || state.controller.signal.aborted) $('review-status').textContent = 'Review canceled. You can start again whenever you like.';
    else { $('review-status').textContent = 'Review could not finish.'; showError(error.message || 'The local engine could not start. Please reload and try again.'); }
  } finally { state.busy = false; state.controller = null; updateControls(); }
}
$('username-form').addEventListener('submit', event => { event.preventDefault(); loadGames(); });
$('demo-button').addEventListener('click', () => selectGame(sample));
$('analyze-button').addEventListener('click', review);
$('cancel-button').addEventListener('click', () => state.controller?.abort());
$('flip-button').addEventListener('click', () => { state.flipped = !state.flipped; renderBoard(); });
$('first-button').addEventListener('click', () => goTo(0));
$('previous-button').addEventListener('click', () => goTo(state.ply - 1));
$('next-button').addEventListener('click', () => goTo(state.ply + 1));
$('last-button').addEventListener('click', () => goTo(state.parsed?.moves.length || 0));
$('previous-key').addEventListener('click', () => { const ply = keyPlies().filter(p => p < state.ply).at(-1); if (ply != null) goTo(ply); });
$('next-key').addEventListener('click', () => { const ply = keyPlies().find(p => p > state.ply); if (ply != null) goTo(ply); });
for (const label of MOVE_LABELS) {
  const row = document.createElement('div'); row.className = 'legend-row';
  const name = document.createElement('strong'); name.textContent = label;
  const description = document.createElement('span'); description.textContent = badgeDescriptions[label];
  row.append(makeBadge(label), name, description); $('classification-legend').append(row);
}
document.addEventListener('keydown', event => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(state.ply - 1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); goTo(state.ply + 1); }
  if (event.key === 'Home') { event.preventDefault(); goTo(0); }
  if (event.key === 'End') { event.preventDefault(); goTo(state.parsed?.moves.length || 0); }
  if (event.target.closest('.chart-hit') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) document.querySelector('.chart-hit button.active')?.focus({ preventScroll: true });
});
window.addEventListener('beforeunload', () => state.controller?.abort());
renderBoard();
if (globalThis.chrome?.storage?.local) {
  chrome.storage.local.get('username').then(({ username }) => { if (username && !$('username').value && !state.selected && !state.loading) { $('username').value = username; loadGames(); } }).catch(() => {});
}
