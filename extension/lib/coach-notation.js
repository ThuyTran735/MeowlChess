import { createMoveNotation } from './move-notation.js';

const SAN = /^(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?$/;
const validMove = (san, color) => typeof san === 'string' && SAN.test(san) && (color === 'w' || color === 'b');

/** Register actual moves while composing an answer; never interpret prose as SAN. */
export function createCoachText() {
  const nonce = globalThis.crypto.getRandomValues(new Uint32Array(4)).join('-');
  const prefix = `\uE000${nonce}:`, suffix = '\uE001';
  const references = [];
  return {
    move(san, color) {
      if (!validMove(san, color)) return typeof san === 'string' ? san : '';
      const index = references.push({ san, color }) - 1;
      return `${prefix}${index}${suffix}`;
    },
    resolve(value) {
      const source = typeof value === 'string' ? value : '';
      const pattern = new RegExp(`${prefix}(\\d+)${suffix}`, 'g');
      const notation = [];
      let text = '', cursor = 0;
      for (const match of source.matchAll(pattern)) {
        const reference = references[Number(match[1])];
        if (!reference) continue;
        text += source.slice(cursor, match.index);
        const start = text.length;
        text += reference.san;
        notation.push({ start, end: text.length, ...reference });
        cursor = match.index + match[0].length;
      }
      text += source.slice(cursor);
      return { text, notation };
    },
  };
}

/** DOM-only presentation. The stored/spoken answer stays ordinary, unchanged text. */
export function renderCoachText(value, references = []) {
  const text = typeof value === 'string' ? value : '';
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const reference of Array.isArray(references) ? references : []) {
    if (!reference || !Number.isInteger(reference.start) || !Number.isInteger(reference.end)
      || reference.start < cursor || reference.end > text.length || reference.end <= reference.start
      || !validMove(reference.san, reference.color) || text.slice(reference.start, reference.end) !== reference.san) continue;
    fragment.append(text.slice(cursor, reference.start), createMoveNotation(reference.san, reference.color, { showPawn: true, showCastleKing: true }));
    cursor = reference.end;
  }
  fragment.append(text.slice(cursor));
  return fragment;
}
