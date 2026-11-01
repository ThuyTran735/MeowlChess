import { MOVE_LABELS } from './review.js';
import { estimateGameRatings } from './game-rating.js';
import { getPhasePerformance } from './game-performance.js';

const WIDTH = 1200, HEIGHT = 1200;
const COLORS = { text: '#f1f0e9', muted: '#aaa89d', line: '#45443d', green: '#81b64c' };
const LABEL_COLORS = { Brilliant: '#26c2a3', Great: '#749bbf', Best: '#81b64c', Excellent: '#81b64c', Good: '#95b776', Book: '#d5a47d', Inaccuracy: '#f7c631', Mistake: '#ffa459', Blunder: '#fa412d' };
const clean = (value, limit = 180) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
let assetPromise;

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The summary artwork could not be loaded. Try again.'));
    image.src = new URL(path, import.meta.url).href;
  });
}
function assets() {
  assetPromise ??= Promise.all([
    loadImage('../icons/icon128.png'),
    ...MOVE_LABELS.map(label => loadImage(`../move-icons/${label.toLowerCase()}.svg`)),
  ]).then(([logo, ...icons]) => ({ logo, icons: Object.fromEntries(MOVE_LABELS.map((label, index) => [label, icons[index]])) })).catch(error => { assetPromise = null; throw error; });
  return assetPromise;
}
function font(ctx, size, weight = 400) { ctx.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`; }
function text(ctx, value, x, y, size, color = COLORS.text, weight = 400, align = 'left') {
  font(ctx, size, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top'; ctx.fillText(String(value), x, y);
}
function rectangle(ctx, x, y, width, height, radius, fill) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
}
function line(ctx, x, y, width) { ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke(); }
function fitLine(ctx, value, width) {
  if (ctx.measureText(value).width <= width) return value;
  const chars = Array.from(value);
  while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop();
  return chars.join('') + '…';
}
function wrapped(ctx, value, x, y, width, size, color, weight = 400, maxLines = 2, spacing = 1.3) {
  font(ctx, size, weight); ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const chars = Array.from(value), lines = [];
  while (chars.length && lines.length < maxLines) {
    let current = '';
    while (chars.length && ctx.measureText(current + chars[0]).width <= width) current += chars.shift();
    if (!current && chars.length) current = chars.shift();
    // Prefer word boundaries while still supporting long, unbroken usernames.
    const space = current.lastIndexOf(' ');
    if (chars.length && lines.length < maxLines - 1 && space > 0) {
      chars.unshift(...Array.from(current.slice(space + 1)));
      current = current.slice(0, space);
    }
    if (lines.length === maxLines - 1 && chars.length) current = fitLine(ctx, current + chars.join(''), width);
    lines.push(current.trim());
  }
  for (let index = 0; index < lines.length; index++) ctx.fillText(lines[index], x, y + index * size * spacing);
}
function image(ctx, value, x, y, size) { ctx.drawImage(value, x, y, size, size); }
function count(value) { return Number.isInteger(value) && value >= 0 && value <= 1000 ? String(value) : '—'; }
function score(value) { return Number.isFinite(value) && value >= 0 && value <= 100 ? value.toFixed(1) : '—'; }
function filenamePart(value, fallback) { return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || fallback; }

/** Render only the supplied, completed analysis. No engine, storage, or network API is used. */
export async function renderSummaryImage({ game, result, analysis = {} } = {}) {
  const outcome = result?.game?.headers?.Result;
  if (!game || !result?.summary?.w || !result?.summary?.b || !['1-0', '0-1', '1/2-1/2'].includes(outcome)) throw new Error('Complete a game review before sharing its summary.');
  const white = clean(game.white?.username || result.game.headers.White) || 'White';
  const black = clean(game.black?.username || result.game.headers.Black) || 'Black';
  const ratings = estimateGameRatings(result), phases = getPhasePerformance(result);
  const artwork = await assets();
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the summary image.');
  rectangle(ctx, 0, 0, WIDTH, HEIGHT, 0, '#211f1d');
  rectangle(ctx, 24, 24, WIDTH - 48, HEIGHT - 48, 26, '#2c2b27');
  ctx.save(); ctx.beginPath(); ctx.roundRect(56, 54, 68, 68, 14); ctx.clip(); image(ctx, artwork.logo, 56, 54, 68); ctx.restore();
  text(ctx, 'MeowlChess', 142, 57, 38, COLORS.text, 700);
  text(ctx, 'GAME REVIEW', 142, 101, 15, COLORS.muted, 600);
  const source = game.source === 'chesscom' ? 'Chess.com' : game.source === 'lichess' ? 'Lichess' : 'Imported PGN';
  text(ctx, source, 1144, 62, 21, COLORS.muted, 500, 'right');
  const resultText = outcome === '1/2-1/2' ? '½–½ · Draw' : outcome === '1-0' ? '1–0 · White won' : '0–1 · Black won';
  const date = Number.isFinite(game.end_time) && game.end_time > 0 ? new Date(game.end_time * 1000) : null;
  const dateText = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  text(ctx, `${resultText}${dateText ? '   ·   ' + dateText : ''}`, 56, 148, 22, COLORS.muted);

  for (const [index, color, player] of [[0, 'w', white], [1, 'b', black]]) {
    const x = 56 + index * 556, ink = color === 'w' ? '#272620' : COLORS.text;
    const subtle = color === 'w' ? '#66645b' : '#c1beb3';
    rectangle(ctx, x, 194, 532, 232, 16, color === 'w' ? '#eeede5' : '#414039');
    text(ctx, color === 'w' ? 'WHITE' : 'BLACK', x + 24, 212, 14, subtle, 650);
    wrapped(ctx, player, x + 24, 238, 484, 25, ink, 650, 2, 1.12);
    text(ctx, score(result.summary[color].accuracy), x + 24, 306, 67, ink, 700);
    text(ctx, 'Study score', x + 26, 383, 17, subtle, 500);
    const rating = ratings[color].rating;
    text(ctx, Number.isFinite(rating) ? `≈${rating.toLocaleString()}` : '—', x + 508, 324, 31, ink, 650, 'right');
    text(ctx, 'Game rating', x + 508, 383, 17, subtle, 500, 'right');
  }

  text(ctx, 'Game performance', 56, 466, 27, COLORS.text, 650);
  text(ctx, 'White', 365, 516, 18, COLORS.muted, 500, 'center');
  text(ctx, 'Black', 470, 516, 18, COLORS.muted, 500, 'center');
  line(ctx, 56, 548, 455);
  phases.forEach((phase, index) => {
    const y = 572 + index * 72;
    text(ctx, phase.name, 56, y + 8, 22);
    for (const [color, x] of [['w', 365], ['b', 470]]) {
      const label = phase[color]?.label;
      if (artwork.icons[label]) image(ctx, artwork.icons[label], x - 19, y, 38);
      else text(ctx, '—', x, y + 7, 22, COLORS.muted, 400, 'center');
    }
    if (index < 2) line(ctx, 56, y + 53, 455);
  });
  const opening = clean(result.opening?.name, 170);
  if (opening) {
    text(ctx, 'OPENING', 56, 820, 15, COLORS.muted, 600);
    wrapped(ctx, [clean(result.opening?.eco, 8), opening].filter(Boolean).join(' · '), 56, 850, 455, 22, COLORS.text, 500, 3, 1.35);
  }
  wrapped(ctx, 'Game ratings are approximate, not account Elo. A dash means there were not enough eligible moves.', 56, 973, 455, 18, COLORS.muted, 400, 3, 1.35);

  const tableX = 576, tableWidth = 568;
  text(ctx, 'Move ratings', tableX, 466, 27, COLORS.text, 650);
  text(ctx, 'White', 1015, 516, 18, COLORS.muted, 500, 'center');
  text(ctx, 'Black', 1110, 516, 18, COLORS.muted, 500, 'center');
  line(ctx, tableX, 548, tableWidth);
  MOVE_LABELS.forEach((label, index) => {
    const y = 565 + index * 55;
    if (index % 2) rectangle(ctx, tableX - 10, y - 3, tableWidth + 10, 51, 7, '#ffffff04');
    image(ctx, artwork.icons[label], tableX, y + 1, 35);
    text(ctx, label, tableX + 51, y + 6, 22, COLORS.text, 500);
    for (const [color, x] of [['w', 1015], ['b', 1110]]) {
      const value = count(result.summary[color].counts?.[label]);
      text(ctx, value, x, y + 4, 26, value === '0' || value === '—' ? COLORS.muted : LABEL_COLORS[label], value === '0' ? 400 : 650, 'center');
    }
  });

  line(ctx, 56, 1081, 1088);
  const engine = clean(analysis.engineName, 60) || (analysis.engineId === 'lozza' ? 'Lozza 9' : analysis.engineId === 'stockfish' ? 'Stockfish 18' : 'Local analysis');
  const timing = Number.isFinite(analysis.moveTimeMs) && analysis.moveTimeMs > 0 ? ` · ${analysis.moveTimeMs / 1000}s per position` : '';
  text(ctx, `${engine}${timing}`, 56, 1101, 17, COLORS.muted);
  text(ctx, 'Independent study estimates', 1144, 1101, 17, COLORS.muted, 400, 'right');
  text(ctx, 'Meowl likeness: Melonpi Cat (瓜皮)', 56, 1134, 16, COLORS.muted);
  text(ctx, 'github.com/ThuyTran735/MeowlChess', 1144, 1134, 16, COLORS.muted, 400, 'right');
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The summary image could not be created.')), 'image/png'));
  return { blob, width: WIDTH, height: HEIGHT, filename: `MeowlChess-${filenamePart(white, 'white')}-vs-${filenamePart(black, 'black')}.png` };
}

/** One locally generated preview per user action; nothing is uploaded or copied automatically. */
export function createSummaryShare({ getSummary }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'meowl-summary-share'; dialog.className = 'summary-share-dialog'; dialog.dataset.noDrag = '';
  dialog.setAttribute('aria-labelledby', 'summary-share-title');
  dialog.innerHTML = `<div class="summary-share-heading"><div><h2 id="summary-share-title">Share summary</h2><p>A PNG image, created on your device.</p></div><button class="summary-share-close" type="button" aria-label="Close share summary" autofocus>×</button></div><div class="summary-share-preview" aria-busy="true"><img alt="Game summary with player study scores, estimated game ratings, phase performance, and move counts" hidden></div><p class="summary-share-status" role="status" aria-live="polite">Preparing image…</p><div class="summary-share-actions"><button type="button" data-share-copy disabled>Copy image</button><button type="button" data-share-save disabled>Save image</button></div>`;
  document.body.append(dialog);
  const preview = dialog.querySelector('img'), previewBox = dialog.querySelector('.summary-share-preview'), status = dialog.querySelector('.summary-share-status');
  const copy = dialog.querySelector('[data-share-copy]'), save = dialog.querySelector('[data-share-save]');
  preview.draggable = false;
  let generation = 0, destroyed = false, item = null, url = null, opener = null;
  const cleanup = () => {
    generation++; item = null;
    if (url) URL.revokeObjectURL(url);
    url = null; preview.removeAttribute('src'); preview.hidden = true;
    copy.disabled = save.disabled = true;
  };
  const close = () => { cleanup(); if (dialog.open) dialog.close(); };
  dialog.querySelector('.summary-share-close').addEventListener('click', close);
  dialog.addEventListener('close', () => { if (dialog.open) return; cleanup(); opener?.isConnected && opener.focus({ preventScroll: true }); });
  const open = async () => {
    if (destroyed || dialog.open) return;
    cleanup(); const job = generation; opener = document.activeElement;
    status.textContent = 'Preparing image…'; previewBox.setAttribute('aria-busy', 'true');
    dialog.showModal();
    try {
      const snapshot = structuredClone(getSummary());
      const rendered = await renderSummaryImage(snapshot);
      if (destroyed || !dialog.open || job !== generation) return;
      item = rendered; url = URL.createObjectURL(rendered.blob); preview.src = url; preview.hidden = false;
      copy.disabled = save.disabled = false; previewBox.setAttribute('aria-busy', 'false');
      status.textContent = 'Ready to copy or save. Nothing is uploaded.';
    } catch (error) {
      if (!dialog.open || job !== generation) return;
      previewBox.setAttribute('aria-busy', 'false');
      status.textContent = error?.message || 'The summary could not be created. Close this window and try again.';
    }
  };
  copy.addEventListener('click', async () => {
    if (!item || copy.disabled) return;
    const job = generation, blob = item.blob; copy.disabled = true;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') throw new Error('Clipboard unavailable');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      if (job === generation && dialog.open) status.textContent = 'Image copied. Paste it wherever you want to share it.';
    } catch {
      if (job === generation && dialog.open) status.textContent = 'Copy is not available here. Use Save image instead.';
    } finally { if (job === generation && dialog.open) copy.disabled = false; }
  });
  save.addEventListener('click', () => {
    if (!item || !url) return;
    const link = document.createElement('a'); link.href = url; link.download = item.filename; link.hidden = true;
    dialog.append(link); link.click(); link.remove();
    status.textContent = 'Image download started.';
  });
  return { open, close, destroy() { if (destroyed) return; destroyed = true; close(); cleanup(); dialog.remove(); } };
}
