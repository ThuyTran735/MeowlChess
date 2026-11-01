import { analyzeGame, ANALYSIS_VERSION, MOVE_LABELS } from './lib/review.js';
import { createEngine, ENGINE_OPTIONS } from './lib/engine.js';
import { reviewIdForGame } from './lib/library.js';
import { parseCompletedPgn, safeOriginalGameUrl } from './lib/pgn.js';
import { isCompletedGame } from './lib/archive.js';
import { installFrameDrag } from './site-frame-drag.js';
import { estimateGameRatings } from './lib/game-rating.js';
import { getPhasePerformance } from './lib/game-performance.js';

const $ = id => document.getElementById(id);
const ORIGINS = { chesscom: ['https://www.chess.com', 'https://chess.com'], lichess: ['https://lichess.org'] };
const TOKEN = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const token = location.hash.slice(1);
const controller = new AbortController();
let source, username, payload, savedId = null, stopped = false, disposed = false, lastHeight = 0, frame = 0, percent = 0;
let parentOrigin = null;
try { const origin = new URL(document.referrer).origin; if (Object.values(ORIGINS).flat().includes(origin)) parentOrigin = origin; } catch { /* A valid payload may supply a verified parent origin. */ }

function sendParent(type, extra = {}) {
  if (parentOrigin && parent !== window && TOKEN.test(token)) parent.postMessage({ type, token, ...extra }, parentOrigin);
}
const panelDrag = installFrameDrag({ send: data => sendParent('meowl:site-frame-drag', data) });
window.addEventListener('message', event => {
  if (event.isTrusted && event.source === parent && event.origin === parentOrigin && event.data?.token === token && event.data.type === 'meowl:site-frame-drag-finished') {
    panelDrag.endFromParent(event.data.pointerId);
  }
});
window.addEventListener('unload', () => panelDrag.destroy());
function reportSize() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const height = Math.max(180, Math.min(680, Math.ceil(document.querySelector('main').getBoundingClientRect().height)));
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    sendParent('meowl:site-frame-size', { height });
  });
}
const observer = new ResizeObserver(reportSize);
observer.observe(document.querySelector('main'));

function status(message = '', error = false) {
  $('summary-status').textContent = message;
  $('summary-status').classList.toggle('error', error);
}
function showStage(stage, label, detail = '') {
  assertActive();
  const main = document.querySelector('main');
  main.dataset.stage = stage;
  main.setAttribute('aria-busy', 'true');
  const stages = ['finding-game', 'analyzing', 'saving'];
  for (const step of document.querySelectorAll('.review-steps [data-step]')) {
    const current = step.dataset.step === stage;
    step.classList.toggle('is-current', current);
    step.classList.toggle('is-complete', stages.indexOf(step.dataset.step) < stages.indexOf(stage));
    if (current) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
  $('summary-title').textContent = { 'finding-game': 'Finding game', analyzing: 'Analyzing', saving: 'Saving' }[stage];
  $('summary-progress-area').hidden = false;
  $('summary-progress-label').textContent = label;
  $('summary-progress-detail').textContent = detail;
  $('summary-progress').removeAttribute('value');
  $('summary-progress').setAttribute('aria-label', $('summary-title').textContent);
  $('summary-percent').textContent = '';
  $('summary-percent').hidden = stage !== 'analyzing';
  reportSize();
}
function finishStage(stage) {
  const main = document.querySelector('main');
  main.dataset.stage = stage;
  main.setAttribute('aria-busy', 'false');
  $('summary-progress-area').hidden = true;
}
function cancel(message = 'Review canceled. Close this panel, then select MeowlChess to start again.') {
  if (stopped) return;
  stopped = true; controller.abort();
  finishStage($('summary-result').hidden ? 'stopped' : 'summary');
  $('summary-cancel').hidden = true;
  if ($('summary-result').hidden) $('summary-title').textContent = 'Review stopped';
  $('summary-close').hidden = false;
  status(message);
  dispose(); reportSize();
}
function dispose() {
  if (disposed) return;
  disposed = true; stopped = true; controller.abort(); observer.disconnect(); cancelAnimationFrame(frame);
  $('summary-open-review').disabled = true;
}
function assertActive() {
  if (stopped || disposed || controller.signal.aborted) throw new DOMException('Review canceled.', 'AbortError');
}
async function checkEnabled() {
  assertActive();
  const settings = (await chrome.storage.local.get('siteReviewSettings')).siteReviewSettings?.[source];
  assertActive();
  if (settings?.enabled !== true || typeof settings.username !== 'string' || settings.username.trim().toLowerCase() !== username) {
    cancel('Automatic review is turned off or the account has changed.');
    throw new DOMException('Review canceled.', 'AbortError');
  }
}
function validatePayload(value) {
  if (value?.status !== 'ready' || value.token !== token || !ORIGINS[value.source]) throw new Error(value?.status === 'expired' ? 'This panel has expired. Reload this page to try again.' : value?.message || 'This panel could not start. Reload this page to try again.');
  const game = value.game;
  const bot = value.kind === 'bot';
  if (!game || game.rules !== 'chess' || !Number.isFinite(game.end_time) || game.end_time <= 0 || game.end_time > Date.now() / 1000) throw new Error('A finished game is not available yet.');
  if (bot) {
    if (value.source !== 'chesscom' || game.source !== 'pgn' || game.imported !== true || game.url !== null || !/^pgn:game-[a-f0-9]{64}$/.test(value.gameKey || '')) throw new Error('This bot game export is invalid.');
  } else {
    const url = safeOriginalGameUrl(game.url);
    if (value.kind !== undefined || game.source !== value.source || !url || !ORIGINS[value.source].includes(new URL(url).origin)) throw new Error('This game is not from the selected site.');
    if (value.source === 'chesscom' && !isCompletedGame(game)) throw new Error('Only confirmed finished games can be reviewed.');
  }
  const parsed = parseCompletedPgn(game.pgn);
  if (!game.white?.username || !game.black?.username || typeof game.white.username !== 'string' || typeof game.black.username !== 'string') throw new Error('This game is missing its players.');
  const analysis = value.analysis;
  const engine = ENGINE_OPTIONS.find(item => item.id === analysis?.engineId);
  if (!engine || ![50, 150, 500, 1500, 3000].includes(analysis.moveTimeMs) || !Number.isInteger(analysis.multiPV) || analysis.multiPV < 1 || analysis.multiPV > engine.maxLines || typeof analysis.smartAnalysis !== 'boolean' || analysis.analysisVersion !== ANALYSIS_VERSION) throw new Error('The review settings have changed. Reload this page to try again.');
  return { ...value, parsed, analysis: { ...analysis, engineName: engine.label } };
}
function showGame(game, parsed) {
  $('summary-source').textContent = payload.kind === 'bot' ? 'Chess.com · bot game' : source === 'chesscom' ? 'Chess.com' : 'Lichess';
  $('summary-players').textContent = `${game.white.username} vs ${game.black.username}`; $('summary-players').title = $('summary-players').textContent;
  const result = parsed.result === '1/2-1/2' ? '½–½' : parsed.result.replace('-', '–');
  const date = new Date(game.end_time * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('summary-game-detail').textContent = `${result} · ${date}`;
}
function renderPerformance(result) {
  const ratings = estimateGameRatings(result);
  for (const color of ['w', 'b']) {
    const estimate = ratings[color], cell = $(`summary-rating-${color}`);
    const side = color === 'w' ? 'White' : 'Black';
    const available = Number.isFinite(estimate.rating);
    cell.textContent = available ? `≈${estimate.rating.toLocaleString()}` : '—';
    cell.classList.toggle('unavailable', !available);
    const description = available
      ? `${side} game rating: approximately ${estimate.rating.toLocaleString()}, from ${estimate.eligibleMoves} eligible moves. A rough estimate for this game, not an account rating.`
      : `${side} game rating unavailable: ${estimate.reason || 'Not enough moves'}.`;
    cell.title = description;
    cell.setAttribute('aria-label', description);
  }
  const body = $('summary-phase-performance');
  body.replaceChildren();
  for (const phase of getPhasePerformance(result)) {
    const row = document.createElement('tr'); row.dataset.phase = phase.id;
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = phase.name; row.append(name);
    for (const color of ['w', 'b']) {
      const cell = document.createElement('td'), performance = phase[color];
      const side = color === 'w' ? 'White' : 'Black';
      const description = performance.label
        ? `${side} ${phase.name.toLowerCase()}: ${performance.label}, ${performance.total} ${performance.total === 1 ? 'move' : 'moves'} in this phase.`
        : `${side} ${phase.name.toLowerCase()}: ${performance.total ? 'No rated moves in this phase' : 'No moves in this phase'}.`;
      cell.title = description;
      cell.setAttribute('aria-label', description);
      if (performance.label) {
        const icon = document.createElement('img');
        icon.src = `move-icons/${performance.label.toLowerCase()}.svg`;
        icon.alt = ''; icon.draggable = false;
        cell.append(icon);
      } else {
        cell.textContent = '—'; cell.className = 'unavailable';
      }
      row.append(cell);
    }
    body.append(row);
  }
}
function renderSummary(result, analysis, reused = false) {
  assertActive();
  finishStage('summary');
  $('summary-title').textContent = 'Summary';
  $('summary-result').hidden = false;
  $('summary-scores').replaceChildren(); $('summary-counts').replaceChildren();
  for (const color of ['w', 'b']) {
    const card = document.createElement('div'); card.className = `score-card score-${color}`;
    const side = document.createElement('span'); side.className = 'score-side'; side.textContent = color === 'w' ? 'White' : 'Black';
    const value = document.createElement('span'); value.className = 'score-value';
    value.textContent = result.summary[color].accuracy?.toFixed(1) ?? '—';
    const player = document.createElement('span'); player.className = 'score-player'; player.textContent = payload.game[color === 'w' ? 'white' : 'black'].username; player.title = player.textContent;
    card.append(side, value, player); $('summary-scores').append(card);
  }
  renderPerformance(result);
  for (const label of MOVE_LABELS) {
    const row = document.createElement('div'); row.className = `count-row ${label.toLowerCase()}`;
    const name = document.createElement('span'); name.textContent = label;
    const white = document.createElement('strong'); white.textContent = String(result.summary.w.counts[label] || 0); white.setAttribute('aria-label', `White: ${white.textContent}`);
    const black = document.createElement('strong'); black.textContent = String(result.summary.b.counts[label] || 0); black.setAttribute('aria-label', `Black: ${black.textContent}`);
    const icon = document.createElement('img'); icon.src = `move-icons/${label.toLowerCase()}.svg`; icon.alt = ''; icon.draggable = false;
    white.classList.toggle('zero', !result.summary.w.counts[label]);
    black.classList.toggle('zero', !result.summary.b.counts[label]);
    row.append(name, white, icon, black); $('summary-counts').append(row);
  }
  $('summary-engine').textContent = `${analysis.engineName} · ${analysis.moveTimeMs / 1000}s per position${analysis.smartAnalysis ? ' · key mistakes rechecked' : ''}${reused ? ' · saved review' : ''}`;
  $('summary-open-review').hidden = false;
  $('summary-open-review').disabled = !savedId;
  $('summary-close').hidden = false;
  reportSize();
}
function onProgress({ completed, total, phase, phaseCompleted, phaseTotal }) {
  if (stopped || disposed) return;
  percent = Math.max(percent, Math.min(99, total > 0 ? completed / total * 100 : 0));
  $('summary-progress').value = percent;
  $('summary-percent').textContent = `${Math.round(percent)}%`;
  $('summary-progress-label').textContent = phase === 'recheck' ? 'Rechecking key moves' : 'Reviewing positions';
  $('summary-progress-detail').textContent = `${phaseCompleted ?? completed} of ${phaseTotal ?? total} positions · ${payload.analysis.engineName}, on your device`;
}
async function readSaved(id) {
  const reply = await chrome.runtime.sendMessage({ type: 'meowl:site-load-review', token });
  assertActive();
  if (reply?.status === 'expired' || reply?.status === 'disabled') throw new Error('This panel has expired. Reload this page to try again.');
  // A failed read need not prevent a local analysis. Saving reports its own error.
  if (reply?.status !== 'ready') return null;
  if (reply.record && reply.record.id !== id) throw new Error('The saved review does not match this game. Reload this page to try again.');
  return reply.record;
}
async function runReview(id) {
  await checkEnabled();
  showStage('finding-game', 'Checking saved reviews…');
  const saved = await readSaved(id);
  await checkEnabled();
  if (saved && !saved.stale) {
    savedId = saved.id; renderSummary(saved.result, saved.analysis, true); status('Saved review loaded.'); return;
  }
  showStage('analyzing', 'Starting the local engine…', `${payload.analysis.engineName} · running on this device`);
  const result = await analyzeGame(payload.game.pgn, { engineFactory: () => createEngine(payload.analysis.engineId), moveTimeMs: payload.analysis.moveTimeMs, multiPV: payload.analysis.multiPV, smartAnalysis: payload.analysis.smartAnalysis, signal: controller.signal, onProgress });
  showStage('saving', 'Checking for an existing review…', 'Analysis is complete.');
  await checkEnabled();
  // A full review may have been saved elsewhere while this automatic pass ran.
  const newer = await readSaved(id);
  await checkEnabled();
  if (newer && !newer.stale) {
    savedId = newer.id; renderSummary(newer.result, newer.analysis, true); status('Saved review loaded.'); return;
  }
  let saveMessage = 'Review complete. Saved on this device.';
  let displayedResult = result, displayedAnalysis = payload.analysis;
  try {
    showStage('saving', 'Saving on this device…', 'Analysis is complete.');
    const reply = await chrome.runtime.sendMessage({ type: 'meowl:site-save-review', token, result });
    assertActive();
    if (reply?.status !== 'saved') throw new Error(reply?.status === 'expired' ? 'This panel has expired. Reload this page to try again.' : reply?.message || 'Saved reviews are unavailable. Reload this page to try again.');
    if (reply.record?.id !== id) throw new Error('The saved review does not match this game. Reload this page to try again.');
    savedId = reply.record.id;
    // A deeper review saved in another tab wins over this automatic pass.
    displayedResult = reply.record.result; displayedAnalysis = reply.record.analysis;
  } catch (error) {
    assertActive(); saveMessage = `Review complete, but it could not be saved: ${error.message || 'Local storage is unavailable.'}`;
  }
  assertActive(); renderSummary(displayedResult, displayedAnalysis); status(saveMessage, !savedId);
}
async function start() {
  try {
    if (parent === window || !TOKEN.test(token)) throw new Error('Open this summary from the MeowlChess panel on your game page.');
    payload = validatePayload(await chrome.runtime.sendMessage({ type: 'meowl:site-payload', token }));
    source = payload.source;
    if (!parentOrigin && ORIGINS[source].includes(payload.parentOrigin)) parentOrigin = payload.parentOrigin;
    if (!ORIGINS[source].includes(parentOrigin)) throw new Error('This summary is not connected to the selected game site.');
    const settings = (await chrome.storage.local.get('siteReviewSettings')).siteReviewSettings?.[source];
    username = typeof settings?.username === 'string' ? settings.username.trim().toLowerCase() : '';
    if (!username || (payload.kind !== 'bot' && ![payload.game.white.username, payload.game.black.username].some(name => name.toLowerCase() === username))) throw new Error('This completed game does not belong to the configured player.');
    await checkEnabled(); showGame(payload.game, payload.parsed); reportSize();
    const id = await reviewIdForGame(payload.game);
    if (payload.kind === 'bot' && payload.gameKey !== `pgn:${id}`) throw new Error('This bot export does not match the selected game.');
    assertActive();
    if (navigator.locks?.request) {
      showStage('finding-game', 'Checking saved reviews…');
      let acquired = false;
      try {
        await navigator.locks.request(`meowlchess-site-review-${id}`, { signal: controller.signal }, () => { acquired = true; return runReview(id); });
      } catch (error) {
        // Some browsers deny Web Locks to embedded extension pages. Deduplication
        // is optional; an analysis failure after acquiring the lock must not retry.
        if (acquired || error?.name === 'AbortError' || controller.signal.aborted) throw error;
        assertActive(); await runReview(id);
      }
    } else await runReview(id);
  } catch (error) {
    if (stopped || disposed || error?.name === 'AbortError') return;
    finishStage('error');
    $('summary-title').textContent = 'Summary unavailable'; $('summary-close').hidden = false;
    status(error?.message || 'This panel could not start. Reload this page to try again.', true);
  }
}

$('summary-cancel').addEventListener('click', () => cancel());
$('summary-close').addEventListener('click', () => sendParent('meowl:site-frame-close'));
$('summary-open-review').addEventListener('click', async () => {
  if (!savedId || stopped) return;
  $('summary-open-review').disabled = true;
  $('summary-open-label').textContent = 'Opening…';
  $('summary-open-review').setAttribute('aria-busy', 'true');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'meowl:site-open-review', token, reviewId: savedId });
    if (result?.status !== 'opened') throw new Error(result?.status === 'expired' ? 'This panel has expired. Reload this page to open the saved review.' : result?.message || 'The full review could not be opened. Reload this page to try again.');
  } catch (error) { status(error.message || 'The full review could not be opened.', true); }
  finally {
    $('summary-open-review').disabled = !savedId || stopped;
    $('summary-open-label').textContent = 'Open full review';
    $('summary-open-review').removeAttribute('aria-busy');
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.siteReviewSettings || !source) return;
  const settings = changes.siteReviewSettings.newValue?.[source];
  if (settings?.enabled !== true || typeof settings.username !== 'string' || settings.username.trim().toLowerCase() !== username) { cancel('Automatic review is turned off or the account has changed.'); dispose(); sendParent('meowl:site-frame-close'); }
});
window.addEventListener('pagehide', dispose);
window.addEventListener('unload', dispose);
window.addEventListener('pageshow', event => {
  if (!event.persisted || !disposed) return;
  // A restored document must not resume an engine or reuse an expired page handle.
  finishStage($('summary-result').hidden ? 'stopped' : 'summary');
  if ($('summary-result').hidden) $('summary-title').textContent = 'Review stopped';
  $('summary-open-review').disabled = true;
  $('summary-close').hidden = false;
  status('Reload this page to reconnect the summary.');
  reportSize();
});
reportSize();
start();
