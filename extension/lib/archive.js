const API_ORIGIN = 'https://api.chess.com';
const WIN_RESULTS = new Set(['checkmated', 'timeout', 'resigned', 'lose', 'abandoned']);
const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

function safeGameUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.chess.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/game\/(?:live|daily)\/\d+$/.test(url.pathname);
  } catch { return false; }
}

/** The archive, final PGN, player outcomes, and timestamp must all describe a finished game. */
export function isCompletedGame(game) {
  if (!game || game.rules !== 'chess' || typeof game.pgn !== 'string' || game.pgn.length > 250000 || !safeGameUrl(game.url)) return false;
  if (!Number.isFinite(game.end_time) || game.end_time <= 0 || game.end_time > Date.now() / 1000) return false;
  if (typeof game.white?.username !== 'string' || typeof game.black?.username !== 'string') return false;
  const resultHeaders = [...game.pgn.matchAll(/^\s*\[Result\s+"(1-0|0-1|1\/2-1\/2)"\]\s*$/gm)];
  if (resultHeaders.length !== 1) return false;
  const result = resultHeaders[0][1];
  const withoutComments = game.pgn.replace(/\{[^}]*\}/g, '').replace(/;[^\n]*/g, '').trim();
  const ending = withoutComments.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)\s*$/)?.[1];
  if (ending !== result) return false;
  const white = game.white.result;
  const black = game.black.result;
  if (result === '1-0') return white === 'win' && WIN_RESULTS.has(black);
  if (result === '0-1') return black === 'win' && WIN_RESULTS.has(white);
  if (DRAW_RESULTS.has(white) && DRAW_RESULTS.has(black)) return true;
  return (white === 'timevsinsufficient' && black === 'timeout') || (black === 'timevsinsufficient' && white === 'timeout');
}

function validateArchiveUrl(value, username) {
  try {
    const url = new URL(value);
    const prefix = `/pub/player/${encodeURIComponent(username)}/games/`;
    if (url.origin !== API_ORIGIN || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) return false;
    return /^(?:19|20)\d{2}\/(?:0[1-9]|1[0-2])$/.test(url.pathname.slice(prefix.length));
  } catch { return false; }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal, redirect: 'error' });
    if (response.status === 404) throw new Error('Chess.com could not find that player or game archive. Check the username and try again.');
    if (response.status === 429) throw new Error('Chess.com is receiving too many requests. Wait a minute before trying again.');
    if (!response.ok) throw new Error(`Chess.com could not load the archive (HTTP ${response.status}). Please try again later.`);
    try { return await response.json(); }
    catch { throw new Error('Chess.com returned an unreadable game archive. Please try again later.'); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Chess.com took too long to respond. Check your connection and try again.');
    if (error instanceof TypeError) throw new Error('Could not connect to Chess.com. Check your internet connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}

/** Read completed archives only; no live-game endpoints or Chess.com page access. */
export async function fetchRecentGames(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{2,50}$/.test(value.trim())) {
    throw new Error('Enter a Chess.com username with 2–50 letters, numbers, underscores, or hyphens.');
  }
  const username = value.trim().toLowerCase();
  const listing = await fetchJson(`${API_ORIGIN}/pub/player/${encodeURIComponent(username)}/games/archives`);
  if (!Array.isArray(listing?.archives) || listing.archives.some(url => !validateArchiveUrl(url, username))) {
    throw new Error('Chess.com returned an invalid archive list. Please try again later.');
  }
  const archives = [...new Set(listing.archives)].sort().reverse().slice(0, 3);
  const games = [];
  for (const archive of archives) {
    const data = await fetchJson(archive);
    if (!Array.isArray(data?.games)) throw new Error('Chess.com returned an invalid game archive. Please try again later.');
    games.push(...data.games.filter(isCompletedGame));
    if (games.length >= 20) break;
  }
  const unique = new Map(games.map(game => [game.url, game]));
  return [...unique.values()].sort((a, b) => b.end_time - a.end_time).slice(0, 20);
}
