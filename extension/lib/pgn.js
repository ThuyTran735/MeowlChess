import { parseGame } from './review.js';

const FINAL_RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);

/** Only link to known game pages; imported PGN metadata is untrusted text. */
export function safeOriginalGameUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search) return null;
    const chess = url.pathname.match(/^\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)\/?$/);
    if (['www.chess.com', 'chess.com'].includes(url.hostname) && !url.hash && chess) {
      return `https://www.chess.com/game/${chess[1] || 'live'}/${chess[2]}`;
    }
    const lichess = url.pathname.match(/^\/([a-zA-Z0-9]{8})(?:\/(?:white|black))?\/?$/);
    if (url.hostname === 'lichess.org' && lichess && (!url.hash || /^#\d+$/.test(url.hash))) return `https://lichess.org/${lichess[1]}`;
  } catch { /* Not a supported game URL. */ }
  return null;
}

// Read the leading tag section rather than looking for whole header lines.
// PGN allows adjacent tags; comments and variations in movetext are not tags.
function readHeaderResults(pgn) {
  const tag = /\s*\[\s*([A-Za-z]+)\s*"([^"]*)"\s*\]/y;
  const results = [];
  let end = 0;
  let match;
  while ((match = tag.exec(pgn))) {
    end = tag.lastIndex;
    if (match[1] === 'Result') results.push(match[2]);
  }
  return { results, movetext: pgn.slice(end) };
}

/** Require a final movetext result as well as legal moves; a header alone is not completion. */
export function parseCompletedPgn(pgn) {
  if (typeof pgn !== 'string' || !pgn.trim() || pgn.length > 250000) throw new Error('Choose a PGN containing one completed game, up to 250 KB.');
  const normalized = pgn.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const { results: headers, movetext } = readHeaderResults(normalized);
  const uncommented = movetext.replace(/\{[^}]*\}/g, '').replace(/;[^\n]*/g, '').trim();
  const result = uncommented.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)\s*$/)?.[1];
  if (!FINAL_RESULTS.has(result)) throw new Error('Only completed games can be reviewed. The PGN must end with 1-0, 0-1, or 1/2-1/2.');
  if (headers.length > 1) throw new Error('Import one completed game at a time.');
  if (headers.length && headers[0] !== result) throw new Error('The PGN result header and final result do not match.');
  const parsed = parseGame(normalized);
  if (parsed.headers.Result !== result) throw new Error('The PGN result header and final result do not match.');
  return { pgn: normalized, parsed, result };
}

function gameDate(headers) {
  const date = headers.UTCDate || headers.Date;
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date || '')) return null;
  const time = /^\d{2}:\d{2}:\d{2}$/.test(headers.UTCTime || '') ? headers.UTCTime : '00:00:00';
  const iso = `${date.replaceAll('.', '-')}T${time}Z`;
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis) || millis <= 0 || millis > Date.now() || new Date(millis).toISOString().slice(0, 10) !== iso.slice(0, 10)) return null;
  return Math.floor(millis / 1000);
}

export function importPgn(value) {
  const { pgn, parsed, result } = parseCompletedPgn(value);
  const { headers } = parsed;
  const player = (color, result) => ({
    username: headers[color] && headers[color] !== '?' ? headers[color] : color,
    ...(Number.isFinite(Number(headers[`${color}Elo`])) && Number(headers[`${color}Elo`]) > 0 ? { rating: Number(headers[`${color}Elo`]) } : {}),
    result,
  });
  return {
    source: 'pgn', imported: true, rules: 'chess', pgn,
    url: safeOriginalGameUrl(headers.Link) || safeOriginalGameUrl(headers.Site),
    end_time: gameDate(headers), time_class: 'imported',
    white: player('White', result === '1-0' ? 'win' : result === '0-1' ? 'lose' : 'agreed'),
    black: player('Black', result === '0-1' ? 'win' : result === '1-0' ? 'lose' : 'agreed'),
  };
}
