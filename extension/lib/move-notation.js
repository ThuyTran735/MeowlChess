import { PIECE_SYMBOLS } from './figurine-paths.js';

/** Render figurine notation while retaining the original SAN for assistive tools. */
export function createMoveNotation(san, color) {
  const text = typeof san === 'string' ? san : '';
  const notation = document.createElement('span');
  notation.className = 'move-notation';
  notation.dataset.san = text;
  notation.setAttribute('role', 'img');
  notation.setAttribute('aria-label', text);
  notation.title = text;
  const shapes = PIECE_SYMBOLS[color];
  const piece = letter => {
    const type = letter.toLowerCase(), shape = shapes?.[type];
    if (!shape) return document.createTextNode(letter);
    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg');
    icon.classList.add('notation-piece');
    icon.dataset.piece = type; icon.dataset.color = color;
    icon.setAttribute('viewBox', shape.viewBox);
    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', shape.path); path.setAttribute('fill', 'currentColor');
    icon.append(path);
    return icon;
  };
  let rest = text;
  if (shapes && /^[KQRBN]/.test(rest)) {
    notation.append(piece(rest[0])); rest = rest.slice(1);
  }
  const promotion = shapes ? /=([QRBN])/.exec(rest) : null;
  if (promotion) notation.append(rest.slice(0, promotion.index + 1), piece(promotion[1]), rest.slice(promotion.index + 2));
  else notation.append(rest);
  return notation;
}
