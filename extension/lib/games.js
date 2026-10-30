import { fetchRecentGames } from './archive.js';
import { fetchLichessGames } from './lichess.js';
export { importPgn, safeOriginalGameUrl } from './pgn.js';
export { fetchLichessGames } from './lichess.js';

export async function fetchGames(source, value) {
  if (source === 'lichess') return fetchLichessGames(value);
  if (source === 'chesscom') return (await fetchRecentGames(value)).map(game => ({ ...game, source: 'chesscom' }));
  throw new Error('Choose Chess.com or Lichess to fetch completed games.');
}
