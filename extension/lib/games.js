import { fetchRecentGames, fetchGameFromArchives } from './archive.js';
import { fetchLichessGames } from './lichess.js';
import { safeOriginalGameUrl } from './pgn.js';
export { importPgn, safeOriginalGameUrl } from './pgn.js';
export { fetchLichessGames } from './lichess.js';

export async function fetchGames(source, value, options = {}) {
  const gameUrl = options?.gameUrl;
  if (source === 'lichess') {
    if (gameUrl !== undefined && (typeof gameUrl !== 'string' || safeOriginalGameUrl(gameUrl) !== gameUrl || !/^https:\/\/lichess\.org\/[a-zA-Z0-9]{8}$/.test(gameUrl))) {
      throw new Error('Choose a canonical completed Lichess game link.');
    }
    return fetchLichessGames(gameUrl === undefined ? value : gameUrl);
  }
  if (source === 'chesscom') return (await (gameUrl === undefined ? fetchRecentGames(value) : fetchGameFromArchives(value, gameUrl))).map(game => ({ ...game, source: 'chesscom' }));
  throw new Error('Choose Chess.com or Lichess to fetch completed games.');
}
