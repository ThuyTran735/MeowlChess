import { Chess } from './vendor/chess.js';
import { fetchRecentGames } from './lib/archive.js';
import { parseGame, analyzeGame, MOVE_LABELS } from './lib/review.js';
import { StockfishEngine } from './lib/engine.js';
import { moveArrowPath } from './lib/board.js';

const $ = (id) => document.getElementById(id);
const state = { games: [], selected: null, parsed: null, result: null, ply: 0, flipped: false, busy: false, loading: false, controller: null, positionController: null, positionAnalysis: new Map(), selectedLine: null, playTimer: null };
const lineColors = ['#87bd43', '#55a7d7', '#efa64a'];
const badgeDescriptions = { Brilliant: 'Sound sacrifice in the engine line', Great: 'Best reply after an opponent’s error', Best: 'The engine’s first choice', Excellent: 'Almost no estimated loss', Good: 'A reasonable move', Inaccuracy: 'A small missed opportunity', Mistake: 'A significant loss of chances', Blunder: 'A large loss of chances' };
function makeBadge(label, extraClass = '') {
  const badge = document.createElement('span'); badge.className = `move-badge ${label.toLowerCase()} ${extraClass}`;
  const icon = document.createElement('img'); icon.src = `move-icons/${label.toLowerCase()}.svg`; icon.alt = ''; icon.draggable = false;
  badge.append(icon); badge.title = label; badge.setAttribute('aria-label', label); return badge;
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
  const unavailable = state.busy || state.loading || !!state.positionController;
  $('load-button').disabled = unavailable;
  $('username').disabled = unavailable;
  $('demo-button').disabled = unavailable;
  $('depth').disabled = state.busy || !!state.positionController;
  $('multipv').disabled = state.busy || !!state.positionController;
  $('analyze-button').disabled = !state.parsed || unavailable;
  $('analyze-button').hidden = state.busy;
  $('cancel-button').hidden = !state.busy;
  $('deepen-button').disabled = !state.parsed || unavailable;
  $('stop-position').hidden = !state.positionController;
  $('play-button').disabled = !state.parsed || state.busy || state.loading || !!state.positionController;
  $('play-button').setAttribute('aria-pressed', String(!!state.playTimer));
  $('play-button').textContent = state.playTimer ? 'Pause' : 'Play';
  $('play-button').setAttribute('aria-label', state.playTimer ? 'Pause playback' : 'Play through the game');
  $('first-button').disabled = !state.parsed || state.ply === 0;
  $('previous-button').disabled = !state.parsed || state.ply === 0;
  $('next-button').disabled = !state.parsed || state.ply >= state.parsed.moves.length;
  $('last-button').disabled = !state.parsed || state.ply >= state.parsed.moves.length;
  const keys = keyPlies();
  $('key-moments').hidden = !keys.length;
  $('previous-key').disabled = !keys.some(ply => ply < state.ply);
  $('next-key').disabled = !keys.some(ply => ply > state.ply);
  for (const button of document.querySelectorAll('.game-card')) button.disabled = unavailable;
  const seconds = (state.parsed?.positions.length || 0) * Number($('depth').value) / 1000;
  $('time-estimate').textContent = seconds ? `About ${seconds < 60 ? `${Math.ceil(seconds)} sec` : `${Math.ceil(seconds / 60)} min`} for this game. More lines split the available search time.` : 'Choose a game to see the estimated review time.';
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
    if ($('show-badges').checked && move?.to === squareName && reviewedMove) square.append(makeBadge(reviewedMove.label, 'board-move-badge'));
    if ($('show-coordinates').checked && row === 7) { const coord = document.createElement('span'); coord.className = 'coordinate'; coord.textContent = files[col]; square.append(coord); }
    if ($('show-coordinates').checked && col === 0) { const coord = document.createElement('span'); coord.className = 'coordinate rank-coordinate'; coord.textContent = ranks[row]; square.append(coord); }
    square.setAttribute('aria-hidden', 'true'); board.append(square);
  }
  board.setAttribute('aria-label', `Chess board ${state.ply ? `after move ${state.ply}: ${move.san}` : 'in starting position'}. FEN: ${chess.fen()}`);
  $('position-label').textContent = state.ply ? `${Math.ceil(state.ply / 2)}${move.color === 'w' ? '.' : '…'} ${move.san}` : 'Starting position';
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
  renderPlayers(); renderInsight(); renderEngineLines(); updateControls();
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
    insightBadge.replaceChildren(makeBadge(reviewMove.label).firstElementChild); insightBadge.setAttribute('aria-label', reviewMove.label);
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
    if (reviewMove && $('show-badges').checked) button.append(makeBadge(reviewMove.label));
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
function currentEvaluation() {
  return state.positionAnalysis.get(state.ply) || state.result?.positions[state.ply];
}
function currentCandidates() {
  if (!state.parsed) return [];
  const evaluation = currentEvaluation();
  if (!evaluation) return [];
  const candidates = evaluation.candidates || (evaluation.bestMove ? [{ ...evaluation, rank: 1 }] : []);
  const seen = new Set();
  return candidates.filter(candidate => {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(candidate.bestMove || '') || seen.has(candidate.bestMove)) return false;
    try {
      const move = candidate.bestMove;
      new Chess(state.parsed.positions[state.ply]).move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
      seen.add(move); return true;
    } catch { return false; }
  }).slice(0, Number($('multipv').value));
}
function lineNotation(candidate) {
  const chess = new Chess(state.parsed.positions[state.ply]);
  const pv = candidate.pv?.[0] === candidate.bestMove ? candidate.pv : [candidate.bestMove];
  const parts = [];
  for (const uci of pv.slice(0, 8)) {
    try {
      const number = chess.fen().split(' ')[5], turn = chess.turn();
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      parts.push(`${turn === 'w' ? `${number}. ` : parts.length ? '' : `${number}… `}${move.san}`);
    } catch { break; }
  }
  return parts.join(' ');
}
function renderEngineLines() {
  const candidates = currentCandidates();
  const container = $('engine-lines'); container.replaceChildren();
  const evaluation = currentEvaluation();
  const side = state.parsed ? new Chess(state.parsed.positions[state.ply]).turn() === 'w' ? 'White' : 'Black' : null;
  $('engine-turn').textContent = side ? `${side} to move · scores from White’s view` : 'Select a completed game';
  if (state.positionController) $('engine-status').textContent = 'Searching this position…';
  else if (evaluation && !candidates.length) $('engine-status').textContent = evaluation.mate === 0 ? 'Checkmate. No legal continuation.' : evaluation.bestMove === null && evaluation.cp === 0 ? 'Drawn position — no further engine analysis.' : 'No engine lines available for this position.';
  else if (evaluation) $('engine-status').textContent = `${state.positionAnalysis.has(state.ply) ? 'Position search' : 'Game review'} · depth ${evaluation.depth} · ${candidates.length} ${candidates.length === 1 ? 'line' : 'lines'}`;
  else $('engine-status').textContent = 'Review the game, or analyze this position.';
  for (const candidate of candidates) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'engine-line'; button.dataset.rank = candidate.rank; button.dataset.uci = candidate.bestMove;
    button.style.setProperty('--line-color', lineColors[candidate.rank - 1] || lineColors[0]);
    button.setAttribute('aria-pressed', String(state.selectedLine === candidate.rank));
    button.title = 'Show this move’s arrow; click again to show all';
    const rank = document.createElement('span'); rank.className = 'line-rank'; rank.textContent = String(candidate.rank);
    const score = document.createElement('strong'); score.className = 'line-score'; score.textContent = displayEvaluation(candidate);
    const notation = document.createElement('span'); notation.className = 'line-notation'; notation.textContent = lineNotation(candidate);
    button.append(rank, score, notation);
    button.addEventListener('click', () => { state.selectedLine = state.selectedLine === candidate.rank ? null : candidate.rank; renderEngineLines(); });
    container.append(button);
  }
  renderEngineArrows(candidates);
}
function renderEngineArrows(candidates) {
  $('board').querySelector('.engine-overlay')?.remove();
  if (!$('show-arrows').checked || !candidates.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.classList.add('engine-overlay'); svg.setAttribute('viewBox', '0 0 800 800'); svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(ns, 'defs'); svg.append(defs);
  const shown = new Set();
  const visible = candidates.filter(candidate => state.selectedLine === null || state.selectedLine === candidate.rank).filter(candidate => {
    // Promotion alternatives can share one arrow; keep the strongest rank.
    const squares = candidate.bestMove.slice(0, 4); if (shown.has(squares)) return false; shown.add(squares); return true;
  });
  for (const candidate of visible.reverse()) {
    const color = lineColors[candidate.rank - 1] || lineColors[0];
    const marker = document.createElementNS(ns, 'marker');
    for (const [key, value] of Object.entries({ id: `engine-head-${candidate.rank}`, markerWidth: '36', markerHeight: '32', refX: '24', refY: '16', orient: 'auto', markerUnits: 'userSpaceOnUse' })) marker.setAttribute(key, value);
    const head = document.createElementNS(ns, 'path'); head.setAttribute('d', 'M 0 0 L 36 16 L 0 32 L 7 16 Z'); head.setAttribute('fill', color); marker.append(head); defs.append(marker);
    const arrow = document.createElementNS(ns, 'path'); arrow.classList.add('engine-arrow'); arrow.dataset.from = candidate.bestMove.slice(0, 2); arrow.dataset.to = candidate.bestMove.slice(2, 4); arrow.dataset.rank = candidate.rank; arrow.dataset.uci = candidate.bestMove;
    arrow.setAttribute('d', moveArrowPath(candidate.bestMove, state.flipped)); arrow.setAttribute('stroke', color); arrow.setAttribute('marker-end', `url(#engine-head-${candidate.rank})`); svg.append(arrow);
  }
  $('board').append(svg);
}
function cancelPositionSearch() {
  if (!state.positionController) return;
  state.positionController.abort(); state.positionController = null;
}
async function deepenPosition() {
  if (!state.parsed || state.busy || state.loading || state.positionController) return;
  stopPlayback(); state.selectedLine = null;
  const game = state.selected, ply = state.ply;
  const controller = new AbortController(); state.positionController = controller;
  const engine = new StockfishEngine();
  renderEngineLines(); updateControls();
  try {
    const replay = new Chess(state.parsed.positions[0]);
    const moves = state.parsed.moves.slice(0, ply).map(move => {
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      return `${move.from}${move.to}${move.promotion || ''}`;
    });
    let evaluation;
    if (replay.isCheckmate()) evaluation = { cp: replay.turn() === 'w' ? -100000 : 100000, mate: 0, depth: 0, pv: [], bestMove: null, candidates: [] };
    else if (replay.isDraw()) evaluation = { cp: 0, mate: null, depth: 0, pv: [], bestMove: null, candidates: [] };
    else evaluation = await engine.evaluate(replay.fen(), { initialFen: state.parsed.positions[0], moves, moveTimeMs: Math.max(1500, Number($('depth').value)), multiPV: Number($('multipv').value), signal: controller.signal });
    if (controller.signal.aborted || state.selected !== game || state.ply !== ply) return;
    state.positionAnalysis.set(ply, evaluation);
  } catch (error) {
    if (error.name !== 'AbortError' && !controller.signal.aborted && state.selected === game && state.ply === ply) showError(error.message || 'Position analysis failed. Try again.');
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
  if (!state.parsed || state.busy || state.loading || state.positionController) return;
  if (state.playTimer) { stopPlayback(); updateControls(); return; }
  if (state.ply >= state.parsed.moves.length) goTo(0);
  state.playTimer = setInterval(() => {
    if (!state.parsed || state.ply >= state.parsed.moves.length) { stopPlayback(); updateControls(); return; }
    goTo(state.ply + 1, { playback: true });
    if (state.ply >= state.parsed.moves.length) { stopPlayback(); updateControls(); }
  }, Number($('play-speed').value));
  updateControls();
}
function savePreferences() {
  const reviewSettings = { time: $('depth').value, lines: $('multipv').value, arrows: $('show-arrows').checked, badges: $('show-badges').checked, coordinates: $('show-coordinates').checked, playback: $('play-speed').value };
  globalThis.chrome?.storage?.local?.set({ reviewSettings }).catch(() => {});
}
function restorePreferences(settings) {
  if (!settings || typeof settings !== 'object') return;
  for (const [id, key] of [['depth', 'time'], ['multipv', 'lines'], ['play-speed', 'playback']]) {
    if ([...$(id).options].some(option => option.value === settings[key])) $(id).value = settings[key];
  }
  for (const [id, key] of [['show-arrows', 'arrows'], ['show-badges', 'badges'], ['show-coordinates', 'coordinates']]) if (typeof settings[key] === 'boolean') $(id).checked = settings[key];
}
function goTo(ply, { playback = false } = {}) {
  if (!state.parsed) return;
  if (!playback) stopPlayback();
  cancelPositionSearch(); state.selectedLine = null;
  state.ply = Math.max(0, Math.min(state.parsed.moves.length, ply)); renderBoard();
}
function selectGame(game) {
  if (state.busy || state.loading) return;
  stopPlayback(); cancelPositionSearch(); state.positionAnalysis.clear(); state.selectedLine = null;
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
  stopPlayback(); cancelPositionSearch(); state.positionAnalysis.clear(); state.selectedLine = null;
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
  stopPlayback(); cancelPositionSearch(); state.positionAnalysis.clear(); state.selectedLine = null;
  const selected = state.selected;
  state.busy = true; state.controller = new AbortController(); state.result = null;
  showError(); renderMoves(); renderSummary(); renderBoard();
  $('progress-area').hidden = false; $('progress').value = 0; $('progress-text').textContent = 'Starting local Stockfish engine…'; $('review-status').textContent = '';
  try {
    const result = await analyzeGame(selected.pgn, {
      moveTimeMs: Number($('depth').value), multiPV: Number($('multipv').value), signal: state.controller.signal,
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
$('deepen-button').addEventListener('click', deepenPosition);
$('stop-position').addEventListener('click', () => { cancelPositionSearch(); renderBoard(); });
$('play-button').addEventListener('click', startPlayback);
for (const id of ['depth', 'multipv', 'show-arrows', 'show-badges', 'show-coordinates', 'play-speed']) {
  $(id).addEventListener('change', () => {
    if (id === 'play-speed' && state.playTimer) { stopPlayback(); startPlayback(); }
    state.selectedLine = null; savePreferences(); renderMoves(); renderBoard();
  });
}
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
window.addEventListener('beforeunload', () => { state.controller?.abort(); cancelPositionSearch(); stopPlayback(); });
renderBoard();
if (globalThis.chrome?.storage?.local) {
  chrome.storage.local.get(['username', 'reviewSettings']).then(({ username, reviewSettings }) => {
    restorePreferences(reviewSettings); renderMoves(); renderBoard();
    if (username && !$('username').value && !state.selected && !state.loading) { $('username').value = username; loadGames(); }
  }).catch(() => {});
}
