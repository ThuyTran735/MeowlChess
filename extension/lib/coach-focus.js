import { accountUsername } from './accounts.js';

const PERSPECTIVES = new Set(['both', 'w', 'b', 'me', 'opponent']);
const SOURCES = new Set(['chesscom', 'lichess']);
const opposite = side => side === 'w' ? 'b' : 'w';

export function normalizeCoachPerspective(value) {
  return PERSPECTIVES.has(value) ? value : 'both';
}

/** Relative choices follow the account in this game, never board orientation. */
export function resolveCoachFocus(perspective, playerSide) {
  const focus = normalizeCoachPerspective(perspective);
  if (focus !== 'me' && focus !== 'opponent') return focus;
  if (playerSide !== 'w' && playerSide !== 'b') return null;
  return focus === 'me' ? playerSide : opposite(playerSide);
}

function sourceFromSite(value) {
  if (typeof value !== 'string') return null;
  const site = value.trim().toLowerCase();
  if (site === 'chess.com' || site === 'www.chess.com') return 'chesscom';
  if (site === 'lichess' || site === 'lichess.org' || site === 'www.lichess.org') return 'lichess';
  try {
    const url = new URL(site);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'chess.com' || url.hostname === 'www.chess.com') return 'chesscom';
    if (url.hostname === 'lichess.org' || url.hostname === 'www.lichess.org') return 'lichess';
  } catch { /* Unknown sites cannot establish an account's provider. */ }
  return null;
}

function headersFor(game) {
  const headers = {};
  // Only the leading PGN tag section is metadata. Comments and move text must
  // not introduce a fake player or provider, and no chess replay is needed.
  if (typeof game?.pgn === 'string' && game.pgn.length <= 250000) {
    const pgn = game.pgn.replace(/^\uFEFF/, '');
    const tag = /\s*\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\]|\\["\\])*)"\s*\]/y;
    let match;
    while ((match = tag.exec(pgn))) {
      if (['White', 'Black', 'Site', 'Link'].includes(match[1])) headers[match[1]] = match[2].replace(/\\(["\\])/g, '$1');
    }
  }
  if (game?.headers && typeof game.headers === 'object' && !Array.isArray(game.headers)) {
    for (const key of ['White', 'Black', 'Site', 'Link']) if (typeof game.headers[key] === 'string') headers[key] = game.headers[key];
  }
  return headers;
}

/** Match only names saved for the game's verified provider. No match means unknown. */
export function detectCoachPlayerSide(game, stored = {}) {
  if (!game || typeof game !== 'object') return null;
  const headers = headersFor(game);
  const sources = new Set([SOURCES.has(game.source) ? game.source : null,
    sourceFromSite(game.url), sourceFromSite(headers.Link), sourceFromSite(headers.Site)].filter(Boolean));
  if (sources.size !== 1) return null;
  const source = [...sources][0];
  const name = value => accountUsername(source, value)?.toLowerCase() || null;
  const white = name(game.white?.username) || name(headers.White);
  const black = name(game.black?.username) || name(headers.Black);
  if (!white || !black || white === black) return null;
  const match = value => {
    const username = name(value);
    return username === white ? 'w' : username === black ? 'b' : null;
  };
  // A detected signed-in account identifies the viewer, whereas the game picker
  // may contain an opponent or another account being studied. If that viewer is
  // not in this game, keep "me" unknown until they choose their player manually.
  const detected = stored?.detectedAccounts?.[source];
  if (detected && typeof detected === 'object' && !Array.isArray(detected)
    && name(detected.username) && Number.isFinite(detected.detectedAt) && detected.detectedAt > 0) {
    return match(detected.username);
  }
  // The legacy field belonged to Chess.com before per-site inputs existed.
  // An unrelated Lichess account must never inherit that name.
  const preferred = [stored?.usernames?.[source], source === 'chesscom' ? stored?.username : null,
    stored?.siteReviewSettings?.[source]?.username];
  for (const username of preferred) {
    const side = match(username);
    if (side) return side;
  }
  const accounts = Array.isArray(stored?.savedAccounts?.[source]) ? stored.savedAccounts[source].slice(0, 10) : [];
  const matches = new Set(accounts.map(match).filter(Boolean));
  return matches.size === 1 ? [...matches][0] : null;
}
