import { importPgn, safeOriginalGameUrl } from './pgn.js';

const ORIGIN = 'https://lichess.org';
const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'unknownFinish', 'insufficientMaterialClaim']);
const SPEEDS = new Set(['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence']);
const MAX_BYTES = 6000000;

/** API status, result, variant, and timestamp must all describe a finished standard game. */
export function normalizeLichessGame(data) {
  if (!data || !/^[a-zA-Z0-9]{8}$/.test(data.id || '') || data.variant !== 'standard' || !FINISHED.has(data.status)) return null;
  if (!Number.isFinite(data.lastMoveAt) || data.lastMoveAt <= 0 || data.lastMoveAt > Date.now()) return null;
  if (!data.players?.white || !data.players?.black) return null;
  let game;
  try { game = importPgn(data.pgn); } catch { return null; }
  const winner = game.white.result === 'win' ? 'white' : game.black.result === 'win' ? 'black' : undefined;
  if (data.winner !== winner) return null;
  if (['draw', 'stalemate', 'insufficientMaterialClaim'].includes(data.status) && winner) return null;
  if (['mate', 'resign', 'cheat'].includes(data.status) && !winner) return null;
  const player = (color) => {
    const item = data.players[color];
    const name = item.user?.name || (Number.isInteger(item.aiLevel) ? `Stockfish level ${item.aiLevel}` : game[color].username);
    return { ...game[color], username: typeof name === 'string' && name ? name : color, ...(Number.isFinite(item.rating) ? { rating: item.rating } : {}) };
  };
  return { ...game, source: 'lichess', imported: false, url: `${ORIGIN}/${data.id}`, end_time: Math.floor(data.lastMoveAt / 1000), time_class: SPEEDS.has(data.speed) ? data.speed : 'standard', white: player('white'), black: player('black') };
}

async function responseText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('Lichess returned too much game data. Please try again later.');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Lichess returned too much game data. Please try again later.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function fetchExport(url, single) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal, headers: { Accept: single ? 'application/json' : 'application/x-ndjson' } });
    if (response.status === 404) throw new Error('Lichess could not find that player or game. Check the username or game link.');
    if (response.status === 429) throw new Error('Lichess is receiving too many requests. Wait a minute before trying again.');
    if (!response.ok) throw new Error(`Lichess could not load games (HTTP ${response.status}). Please try again later.`);
    const body = await responseText(response);
    try {
      const data = single ? [JSON.parse(body)] : body.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
      if (data.length > 50 || data.some(game => !game || typeof game !== 'object' || Array.isArray(game))) throw new Error('Invalid game data');
      return data;
    } catch { throw new Error('Lichess returned unreadable game data. Please try again later.'); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Lichess took too long to respond. Check your connection and try again.');
    if (error instanceof TypeError) throw new Error('Could not connect to Lichess. Check your internet connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}

/** Public finished-game exports only; no login, current-game, or live-stream access. */
export async function fetchLichessGames(value) {
  if (typeof value !== 'string') throw new Error('Enter a Lichess username or completed game link.');
  const input = value.trim();
  const gameUrl = safeOriginalGameUrl(input);
  const single = Boolean(gameUrl?.startsWith(`${ORIGIN}/`));
  if (!single && !/^[a-zA-Z0-9_-]{2,30}$/.test(input)) throw new Error('Enter a Lichess username or a completed game link such as https://lichess.org/abcdefgh.');
  const path = single ? `/game/export/${gameUrl.slice(ORIGIN.length + 1)}` : `/api/games/user/${encodeURIComponent(input)}`;
  const params = new URLSearchParams({ pgnInJson: 'true', moves: 'true', tags: 'true', clocks: 'false', evals: 'false', opening: 'false' });
  if (!single) {
    params.set('max', '20'); params.set('ongoing', 'false'); params.set('finished', 'true');
    params.set('perfType', 'ultraBullet,bullet,blitz,rapid,classical,correspondence'); params.set('sort', 'dateDesc');
  }
  const raw = await fetchExport(`${ORIGIN}${path}?${params}`, single);
  const games = raw.map(normalizeLichessGame).filter(Boolean);
  if (single && !games.length) throw new Error('Only completed standard games can be reviewed. This game is unfinished, unsupported, or has no moves.');
  const unique = new Map(games.map(game => [game.url, game]));
  return [...unique.values()].sort((a, b) => b.end_time - a.end_time).slice(0, 20);
}
