import { Chess } from '../vendor/chess.js';
import { OPENING_DATA_VERSION, OPENING_LINES } from '../data/openings.js';

export { OPENING_DATA_VERSION };
const START = new Chess().fen();
let tree;

function openingTree() {
  if (tree) return tree;
  tree = { children: new Map(), opening: null };
  for (const [eco, name, line] of OPENING_LINES) {
    let node = tree;
    for (const uci of line.split(' ')) {
      if (!node.children.has(uci)) node.children.set(uci, { children: new Map(), opening: null });
      node = node.children.get(uci);
    }
    // The source ordering gives deterministic naming if synonyms share one line.
    if (!node.opening) node.opening = { eco, name };
  }
  return tree;
}

/** Exact mainline-prefix matching; no guessed names or transposition claims. */
export function recognizeOpening(game) {
  if (game?.positions?.[0] !== START || !Array.isArray(game.moves)) return null;
  let node = openingTree();
  let named = null;
  let namedPly = 0;
  let lastBookPly = 0;
  const byPly = [];
  for (let index = 0; index < game.moves.length; index++) {
    const move = game.moves[index];
    const uci = move.from + move.to + (move.promotion || '');
    node = node.children.get(uci);
    if (!node) break;
    lastBookPly = index + 1;
    if (node.opening) { named = node.opening; namedPly = lastBookPly; }
    byPly.push(named ? { ...named, ply: namedPly } : null);
  }
  if (!lastBookPly) return null;
  return {
    name: named?.name || null,
    eco: named?.eco || null,
    ply: namedPly,
    lastBookPly,
    departurePly: lastBookPly < game.moves.length ? lastBookPly + 1 : null,
    source: 'lichess',
    datasetVersion: OPENING_DATA_VERSION,
    byPly,
  };
}
