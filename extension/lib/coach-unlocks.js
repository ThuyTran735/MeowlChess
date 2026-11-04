export const COACH_REVIEW_UNLOCK_GOAL = 10;
export const COACH_UNLOCK_RECORD_ID = 'coach-review-milestone';
const EVENT = 'MeowlChess-coach-progress';
const CHANNEL = 'MeowlChess-coach-unlocks';
const GAME_KEY = /^(?:game-[a-f0-9]{64}|chesscom:(?:live|daily):\d+|lichess:[a-zA-Z0-9]{8})$/;

export function initializedCoachMilestone(value) {
  return value?.id === COACH_UNLOCK_RECORD_ID && value.version === 1 && value.initialized === true
    && Array.isArray(value.gameKeys) && value.gameKeys.length <= COACH_REVIEW_UNLOCK_GOAL
    && value.gameKeys.every(key => typeof key === 'string' && GAME_KEY.test(key))
    && new Set(value.gameKeys).size === value.gameKeys.length;
}

/** Keep only the first ten distinct games; later reviews need no extra history. */
export function mergeCoachMilestone(value, gameKeys = []) {
  const previous = value?.id === COACH_UNLOCK_RECORD_ID && value.version === 1 && Array.isArray(value.gameKeys) ? value.gameKeys : [];
  const keys = [...new Set([...previous, ...gameKeys].filter(key => typeof key === 'string' && GAME_KEY.test(key)))].slice(0, COACH_REVIEW_UNLOCK_GOAL);
  return { id: COACH_UNLOCK_RECORD_ID, version: 1, initialized: true, gameKeys: keys };
}

export function coachUnlockProgress(value) {
  const count = mergeCoachMilestone(value).gameKeys.length;
  return { count, required: COACH_REVIEW_UNLOCK_GOAL, unlocked: count >= COACH_REVIEW_UNLOCK_GOAL };
}

/** Already validated completed reviews supply the fallback PGN identity. */
export function coachGameMilestoneKey(game, parsed, reviewId) {
  if (game?.sample === true || game?.time_class === 'sample' || !parsed?.moves?.length
    || /^MeowlChess sample$/i.test(String(parsed.headers?.Event || '').trim())
    || /^Local sample$/i.test(String(parsed.headers?.Site || '').trim())) return null;
  for (const value of [game?.url, parsed.headers?.Link, parsed.headers?.Site]) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.port || url.username || url.password) continue;
      const chess = url.pathname.match(/^\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)(?:\/review)?\/?$/);
      if (['chess.com', 'www.chess.com'].includes(url.hostname) && chess) return `chesscom:${chess[1] || 'live'}:${chess[2]}`;
      const lichess = url.pathname.match(/^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4}|\/(?:white|black))?\/?$/);
      if (['lichess.org', 'www.lichess.org'].includes(url.hostname) && lichess) return `lichess:${lichess[1]}`;
    } catch { /* Imported games without a supported link use their normalized PGN identity. */ }
  }
  return GAME_KEY.test(reviewId || '') ? reviewId : null;
}

/** Read and migrate through the library's own committed transaction. */
export async function getCoachUnlockProgress() {
  const { createReviewLibrary } = await import('./library.js');
  const library = createReviewLibrary();
  try { return await library.getCoachUnlockProgress(); }
  finally { await library.close(); }
}

export function notifyCoachUnlockProgress() {
  try { globalThis.dispatchEvent?.(new Event(EVENT)); } catch { /* Storage is already committed. */ }
  try {
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage({ type: 'changed' }); channel.close();
    }
  } catch { /* The next explicit read still sees committed progress. */ }
}

/** Subscribers reread storage rather than trusting another tab's payload. */
export function subscribeCoachUnlockProgress(callback) {
  if (typeof callback !== 'function') throw new TypeError('A progress listener is required.');
  const changed = () => callback();
  globalThis.addEventListener?.(EVENT, changed);
  let channel;
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = event => { if (event.data?.type === 'changed') changed(); };
    }
  } catch { /* Local notifications remain available. */ }
  return () => { globalThis.removeEventListener?.(EVENT, changed); channel?.close(); };
}
