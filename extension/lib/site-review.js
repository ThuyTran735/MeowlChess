import { isCompletedGame } from './archive.js';
import { importPgn, parseCompletedPgn, safeOriginalGameUrl } from './pgn.js';
import { reviewIdForGame } from './library.js';
import { ENGINE_OPTIONS } from './engine.js';
import { ANALYSIS_VERSION } from './review.js';

export const SITE_CONTENT_SCRIPT = 'site-content.js';
export const SITE_SUMMARY_FRAME = 'site-summary.html';
export const SITE_PROVIDERS = Object.freeze({
  chesscom: Object.freeze({ label: 'Chess.com', origins: ['https://www.chess.com/*', 'https://chess.com/*'], retryAfterMs: 60000, usernameMax: 50 }),
  lichess: Object.freeze({ label: 'Lichess', origins: ['https://lichess.org/*'], retryAfterMs: 30000, usernameMax: 30 }),
});

const LICHESS_ROUTES = new Set(['analysis', 'training', 'practice', 'features', 'insights', 'streamer', 'password', 'bookmark', 'timeline', 'settings', 'checkout', 'registration']);
const JOB_LIFETIME = 10 * 60 * 1000;
const COMPLETION_RETRY_MS = 15000;
const MANUAL_RETRY_MS = 15000;
const MAX_JOBS = 100;
const SESSION_BYTES = 700000;
const TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PANEL_STATES = new Set(['open', 'collapsed', 'closed']);
const documentId = sender => typeof sender?.documentId === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(sender.documentId) ? sender.documentId : null;
const activeDocument = sender => sender?.documentLifecycle === undefined || sender.documentLifecycle === 'active';

export function normalizeSiteSettings(value) {
  return Object.fromEntries(Object.entries(SITE_PROVIDERS).map(([source, provider]) => {
    const raw = value?.[source];
    const input = typeof raw?.username === 'string' ? raw.username.trim().toLowerCase() : '';
    const username = new RegExp(`^[a-z0-9_-]{2,${provider.usernameMax}}$`).test(input) ? input : '';
    return [source, { enabled: raw?.enabled === true && Boolean(username), username }];
  }));
}

function trustedUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url;
  } catch { return null; }
}

export function providerForUrl(value) {
  const url = trustedUrl(value);
  if (['www.chess.com', 'chess.com'].includes(url?.hostname)) return 'chesscom';
  return url?.hostname === 'lichess.org' ? 'lichess' : null;
}

/** Bot exports are private; never substitute a public human game on these pages. */
export function isChessComBotPage(value) {
  const url = trustedUrl(value);
  return providerForUrl(value) === 'chesscom' && Boolean(url && (
    /^\/play\/computer(?:\/|$)/.test(url.pathname) ||
    /^\/(?:analysis\/)?game\/computer\/[^/]+\/?$/.test(url.pathname)
  ));
}

function completedBotGame(pgn, timestamp) {
  if (typeof pgn !== 'string' || pgn.length > 250000 || new TextEncoder().encode(pgn).byteLength > 250000) {
    throw new Error('Choose one completed bot game, up to 250 KB.');
  }
  const game = importPgn(pgn);
  // A local export is an import, not an independently confirmed archive game.
  return { ...game, url: null, end_time: game.end_time || Math.floor(timestamp / 1000) };
}

/** Strip navigation parameters and private Lichess player keys before retaining a URL. */
export function gameUrlForPage(value) {
  const url = trustedUrl(value);
  const source = providerForUrl(value);
  if (!url || !source) return null;
  if (source === 'chesscom') {
    const match = url.pathname.match(/^\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)\/?$/);
    return match ? `https://www.chess.com/game/${match[1] || 'live'}/${match[2]}` : null;
  }
  const match = url.pathname.match(/^\/([a-zA-Z0-9]{8}(?:[a-zA-Z0-9]{4})?)(?:\/(?:white|black))?\/?$/);
  return match && !LICHESS_ROUTES.has(match[1].toLowerCase()) ? `https://lichess.org/${match[1].slice(0, 8)}` : null;
}

export function normalizeSiteAnalysis(value) {
  const engine = ENGINE_OPTIONS.find(option => option.id === value?.engine) || ENGINE_OPTIONS[0];
  const time = Number(value?.time);
  const lines = Number(value?.lines);
  return {
    engineId: engine.id,
    engineName: engine.label,
    moveTimeMs: [50, 150, 500, 1500, 3000].includes(time) ? time : 50,
    multiPV: Number.isInteger(lines) && lines >= 1 && lines <= 3 ? Math.min(lines, engine.maxLines) : 1,
    smartAnalysis: typeof value?.smart === 'boolean' ? value.smart : true,
    analysisVersion: ANALYSIS_VERSION,
  };
}

function pageKey(value) {
  const url = trustedUrl(value);
  return providerForUrl(value) ? gameUrlForPage(value) || `${url.origin}${url.pathname}` : null;
}

function unrecognizedChessGamePage(value) {
  const url = trustedUrl(value);
  return providerForUrl(value) === 'chesscom' && /^\/(?:analysis\/)?game(?:\/|$)/.test(url.pathname) && !gameUrlForPage(value);
}

function savedBotPage(value) {
  const url = trustedUrl(value);
  const match = providerForUrl(value) === 'chesscom' && url.pathname.match(/^\/(?:analysis\/)?game\/computer\/([^/]+)\/?$/);
  return match ? `${url.origin}/game/computer/${match[1]}` : null;
}

function canCarryJob(job, value) {
  if (providerForUrl(value) !== job.source || trustedUrl(value)?.origin !== job.parentOrigin) return false;
  const target = gameUrlForPage(value), botTarget = savedBotPage(value);
  if (target) return job.kind !== 'bot' && job.game.url === target;
  if (botTarget) return job.kind === 'bot' && savedBotPage(job.selectionPageKey) === botTarget;
  return !unrecognizedChessGamePage(value);
}

const pageAtOrigin = (key, origin) => trustedUrl(key) ? `${origin}${new URL(key).pathname}` : key;

/** An archive result is still untrusted: require the configured player and legal finished PGN. */
export function completedSiteGames(games, source, username, now = Date.now()) {
  if (!Array.isArray(games)) return [];
  const accepted = new Map();
  for (const game of games.slice(0, 50)) {
    if (!game || game.source !== source || game.rules !== 'chess') continue;
    if (!Number.isFinite(game.end_time) || game.end_time <= 0 || game.end_time * 1000 > now) continue;
    if (![game.white?.username, game.black?.username].some(name => typeof name === 'string' && name.toLowerCase() === username)) continue;
    const url = safeOriginalGameUrl(game.url);
    if (!url || providerForUrl(url) !== source || gameUrlForPage(url) !== url) continue;
    if (source === 'chesscom' && !isCompletedGame(game)) continue;
    try {
      const { pgn } = parseCompletedPgn(game.pgn);
      accepted.set(url, { ...game, url, pgn });
    } catch { /* An incomplete or illegal archive game cannot authorize engine analysis. */ }
  }
  return [...accepted.values()].sort((a, b) => b.end_time - a.end_time);
}

/** Serialize automatic saves and preserve an existing current review, including deeper analysis. */
export function createSiteReviewLibraryBridge({ library, idForGame }) {
  const pending = new Map();
  return {
    async loadReview(job, assertActive) {
      const id = await idForGame(job.game);
      await assertActive();
      return library.loadReview(id);
    },
    async saveReview(job, result, assertActive) {
      const id = await idForGame(job.game);
      const previous = pending.get(id) || Promise.resolve();
      const operation = previous.catch(() => {}).then(async () => {
        await assertActive();
        const saved = await library.loadReview(id);
        await assertActive();
        if (saved && !saved.stale) return { ...saved, savedFresh: false };
        // Return the atomic save outcome: another tab may have won the race.
        // saveReview validates complete PGN/result correspondence, every line, and storage limits.
        const outcome = await library.saveReview(job.game, result, job.analysis, { preserveCurrent: true, reportOutcome: true });
        await assertActive();
        return { ...outcome.record, savedFresh: outcome.savedFresh === true };
      });
      pending.set(id, operation);
      try { return await operation; }
      finally { if (pending.get(id) === operation) pending.delete(id); }
    },
  };
}

/** The page receives only an opaque handle; game moves stay inside extension contexts. */
export function createSiteReviewBroker({ extensionId, extensionUrl, readSettings, hasPermission, fetchGames, openReview, loadReview, saveReview,
  now = () => Date.now(), makeToken = () => crypto.randomUUID(), readSession, writeSession }) {
  const jobs = new Map();
  const cache = new Map();
  const tabEpochs = new Map();
  const tabPages = new Map();
  const tabOrigins = new Map();
  const pendingDocuments = new Set();
  const invalidatedTabs = new Set();
  const sourceEpochs = new Map();
  const botImports = new Map();
  let generation = 0;
  let restorePromise, restored = false, persistence = Promise.resolve();

  const disabled = () => ({ status: 'disabled', message: 'Turn on page reviews in MeowlChess settings.' });
  const expired = () => ({ status: 'expired', message: 'This review has expired. Open the dropdown again.' });

  function prune() {
    // Selection and panel state live for the tab/session; only iframe access has
    // a short lease. A returning content document renews its selected job.
    while (jobs.size >= MAX_JOBS) jobs.delete(jobs.keys().next().value);
    while (cache.size > 20) cache.delete(cache.keys().next().value);
  }

  function contentContext(sender) {
    if (!activeDocument(sender) || sender?.id !== extensionId || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0) return null;
    const source = providerForUrl(sender.url);
    const documentUrl = trustedUrl(sender.url), currentUrl = trustedUrl(sender.tab.url);
    // Chromium can retain the original document URL after history.pushState.
    // The browser's top-tab URL tracks SPA navigation; never trust a page-supplied URL.
    if (!source || !currentUrl || providerForUrl(sender.tab.url) !== source || currentUrl.origin !== documentUrl.origin) return null;
    return { source, tabId: sender.tab.id, pageKey: pageKey(sender.tab.url), parentOrigin: currentUrl.origin };
  }

  function isExtensionPage(sender, filename, token) {
    if (sender?.id !== extensionId || typeof sender.url !== 'string') return false;
    try {
      const actual = new URL(sender.url), expected = new URL(extensionUrl(filename));
      const validHash = !actual.hash || (filename === SITE_SUMMARY_FRAME && TOKEN.test(token || '') && actual.hash === `#${token}`);
      return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password && validHash;
    } catch { return false; }
  }

  async function configuration(source) {
    const raw = await readSettings();
    const settings = normalizeSiteSettings(raw?.siteReviewSettings)[source];
    if (!settings?.enabled || !await hasPermission(source)) return null;
    const analysis = normalizeSiteAnalysis(raw?.reviewSettings);
    return { ...settings, analysis, key: JSON.stringify([settings.username, analysis]) };
  }

  // storage.session survives MV3 worker suspension without writing game data to disk.
  // Keep even the older 1 MiB session quota in mind; active job handles take priority.
  function saveSession() {
    if (!restored || !writeSession) return Promise.resolve();
    const snapshot = { version: 1, jobs: [], cache: [] };
    const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    let size = bytes(snapshot);
    const add = (collection, value) => {
      const length = bytes(value) + 1;
      if (size + length > SESSION_BYTES) return;
      collection.push(value); size += length;
    };
    for (const job of [...jobs.values()].reverse().sort((a, b) => b.expiresAt - a.expiresAt).slice(0, MAX_JOBS)) add(snapshot.jobs, job);
    for (const [key, entry] of cache) {
      if (!entry.pending && entry.expiresAt > now() && entry.value) add(snapshot.cache, { key, expiresAt: entry.expiresAt, value: entry.value,
        ...(Number.isFinite(entry.completionRefreshAt) ? { completionRefreshAt: entry.completionRefreshAt } : {}),
        ...(Number.isFinite(entry.manualRetryAt) ? { manualRetryAt: entry.manualRetryAt } : {}) });
    }
    // Clone now so later mutations cannot change a queued write's snapshot.
    const value = structuredClone(snapshot);
    persistence = persistence.catch(() => {}).then(() => writeSession(value)).catch(() => {});
    return persistence;
  }

  async function restoreSession() {
    const startedGeneration = generation;
    const startedSources = new Map(sourceEpochs);
    const startedTabs = new Map(tabEpochs);
    try {
      const snapshot = await readSession?.();
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.jobs) || !Array.isArray(snapshot.cache)) return;
      const configurations = new Map();
      for (const source of Object.keys(SITE_PROVIDERS)) configurations.set(source, await configuration(source));
      if (generation !== startedGeneration) return;
      for (const source of Object.keys(SITE_PROVIDERS)) if ((sourceEpochs.get(source) || 0) !== (startedSources.get(source) || 0)) configurations.set(source, null);
      for (const item of snapshot.jobs.slice(0, MAX_JOBS)) {
        const config = configurations.get(item?.source);
        if (!config || !TOKEN.test(item.token || '') || !Number.isInteger(item.tabId) || item.tabId < 0 || item.configKey !== config.key) continue;
        if (invalidatedTabs.has(item.tabId)) continue;
        if (!Number.isFinite(item.expiresAt) || item.expiresAt <= 0 || item.expiresAt > now() + JOB_LIFETIME) continue;
        if (typeof item.pageKey !== 'string' || pageKey(item.pageKey) !== item.pageKey || providerForUrl(item.pageKey) !== item.source) continue;
        if (providerForUrl(item.parentOrigin) !== item.source || trustedUrl(item.parentOrigin)?.origin !== item.parentOrigin) continue;
        let game, bot = {};
        if (item.kind === 'bot') {
          if (item.source !== 'chesscom' || !isChessComBotPage(item.selectionPageKey || item.pageKey) || item.game?.source !== 'pgn' || item.game?.imported !== true || item.game.url !== null) continue;
          if (!Number.isFinite(item.game.end_time) || item.game.end_time <= 0 || item.game.end_time * 1000 > now()) continue;
          try {
            game = completedBotGame(item.game.pgn, item.game.end_time * 1000);
            const gameKey = `pgn:${await reviewIdForGame(game)}`;
            if (gameKey !== item.gameKey) continue;
            bot = { kind: 'bot', gameKey };
          } catch { continue; }
          // Parsing and hashing yield; revocation/navigation must still win.
          if (generation !== startedGeneration || (sourceEpochs.get(item.source) || 0) !== (startedSources.get(item.source) || 0)) continue;
        } else {
          const selection = item.selectionPageKey || item.pageKey;
          if (item.kind !== undefined || isChessComBotPage(selection) || unrecognizedChessGamePage(selection)) continue;
          [game] = completedSiteGames([item.game], item.source, config.username, now());
          const currentGame = gameUrlForPage(selection);
          if (currentGame && game?.url !== currentGame) continue;
        }
        if (!game) continue;
        const selectionPageKey = item.selectionPageKey || item.pageKey;
        if (pageKey(selectionPageKey) !== selectionPageKey || providerForUrl(selectionPageKey) !== item.source) continue;
        const job = { token: item.token, source: item.source, tabId: item.tabId, pageKey: item.pageKey, selectionPageKey, parentOrigin: item.parentOrigin, game, ...bot, analysis: config.analysis, configKey: config.key, expiresAt: item.expiresAt,
          panelState: PANEL_STATES.has(item.panelState) ? item.panelState : 'open',
          panelGeneration: Number.isSafeInteger(item.panelGeneration) && item.panelGeneration > 0 ? item.panelGeneration : 1,
          documentId: documentId(item), frameDocumentId: documentId({ documentId: item.frameDocumentId }),
          retiredDocuments: (Array.isArray(item.retiredDocuments) ? item.retiredDocuments : []).filter(id => documentId({ documentId: id })).slice(-8),
          retiredFrames: (Array.isArray(item.retiredFrames) ? item.retiredFrames : []).filter(id => documentId({ documentId: id })).slice(-8),
          documentPending: item.documentPending === true, accessRevision: 0 };
        if (!canCarryJob(job, pageAtOrigin(item.pageKey, job.parentOrigin))) continue;
        if (tabPages.has(job.tabId)) {
          const currentPage = tabPages.get(job.tabId);
          if (!canCarryJob(job, pageAtOrigin(currentPage, tabOrigins.get(job.tabId))) || tabOrigins.get(job.tabId) !== job.parentOrigin) continue;
          job.pageKey = currentPage;
        } else if ((tabEpochs.get(job.tabId) || 0) !== (startedTabs.get(job.tabId) || 0)) continue;
        if (pendingDocuments.has(job.tabId)) suspendDocument(job);
        jobs.set(job.token, job); tabPages.set(job.tabId, job.pageKey); tabOrigins.set(job.tabId, job.parentOrigin);
      }
      for (const item of snapshot.cache.slice(0, 20)) {
        if (typeof item?.key !== 'string') continue;
        const [source, username, encodedGame, ...extra] = item.key.split(':');
        const config = configurations.get(source);
        if (!config || username !== config.username || extra.length || !Number.isFinite(item.expiresAt) || item.expiresAt <= now() || item.expiresAt > now() + SITE_PROVIDERS[source].retryAfterMs) continue;
        let target = null;
        if (encodedGame !== undefined) {
          try { target = decodeURIComponent(encodedGame); } catch { continue; }
          if (!target || encodeURIComponent(target) !== encodedGame || providerForUrl(target) !== source || gameUrlForPage(target) !== target) continue;
        }
        let value;
        if (Array.isArray(item.value?.games)) value = { games: completedSiteGames(item.value.games, source, username, now()).filter(game => !target || game.url === target) };
        else if (typeof item.value?.error === 'string') value = { error: item.value.error.slice(0, 240) };
        const completionRefreshAt = source === 'chesscom' && Number.isFinite(item.completionRefreshAt) && item.completionRefreshAt <= now() && item.completionRefreshAt >= now() - SITE_PROVIDERS[source].retryAfterMs ? item.completionRefreshAt : undefined;
        const manualRetryAt = Number.isFinite(item.manualRetryAt) && item.manualRetryAt <= now() && item.manualRetryAt >= now() - MANUAL_RETRY_MS ? item.manualRetryAt : undefined;
        if (value) cache.set(item.key, { expiresAt: item.expiresAt, value, completionRefreshAt, manualRetryAt });
      }
    } catch { /* Session storage is optional; a fresh completed-game check can recover. */ }
    finally { restored = true; }
  }

  function ready() {
    restorePromise ||= restoreSession();
    return restorePromise;
  }

  async function archive(source, username, target = null, refreshCompleted = false, manualRetry = false) {
    // A recent-game list must never satisfy an exact game-page lookup: that game
    // can be outside the picker limit or in an older monthly archive.
    const key = `${source}:${username}${target ? ':' + encodeURIComponent(target) : ''}`;
    let entry = cache.get(key);
    if (entry?.pending) {
      if ((manualRetry && !entry.retryingManually) || (refreshCompleted && !entry.refreshingCompleted)) {
        // The game can finish while an earlier archive response is in flight.
        // Wait for that request, then share one fresh completed-game lookup.
        const startedGeneration = generation, startedSourceEpoch = sourceEpochs.get(source) || 0;
        const value = await entry.pending;
        if (generation !== startedGeneration || (sourceEpochs.get(source) || 0) !== startedSourceEpoch) return value;
        return archive(source, username, target, refreshCompleted, manualRetry);
      }
      return entry.pending;
    }
    if (entry && entry.expiresAt > now()) {
      // A deliberate retry can recover a cached miss/network error immediately.
      // Share its cooldown across tabs and preserve explicit server-rate backoff.
      const rateLimited = /too many requests|rate limit|HTTP 429/i.test(entry.value?.error || '');
      const throttled = Number.isFinite(entry.manualRetryAt) && now() - entry.manualRetryAt < MANUAL_RETRY_MS;
      if (manualRetry ? throttled || rateLimited : !refreshCompleted || entry.value?.error ||
        (Number.isFinite(entry.completionRefreshAt) && now() - entry.completionRefreshAt < COMPLETION_RETRY_MS)) return entry.value;
    }
    entry = { expiresAt: 0, refreshingCompleted: refreshCompleted || manualRetry, retryingManually: manualRetry,
      completionRefreshAt: refreshCompleted || manualRetry ? now() : entry?.completionRefreshAt,
      manualRetryAt: manualRetry ? now() : entry?.manualRetryAt };
    entry.pending = (async () => {
      try {
        const options = target || refreshCompleted || manualRetry ? { ...(target ? { gameUrl: target } : {}), ...(refreshCompleted || manualRetry ? { revalidate: true } : {}) } : undefined;
        const games = completedSiteGames(await fetchGames(source, username, options), source, username, now());
        return { games: games.filter(game => !target || game.url === target) };
      } catch (error) {
        return { error: error instanceof Error ? error.message.slice(0, 240) : 'Could not load completed games. Try again shortly.' };
      }
    })().then(value => {
      entry.value = value;
      entry.expiresAt = now() + ((refreshCompleted || manualRetry) && !value.error ? COMPLETION_RETRY_MS : SITE_PROVIDERS[source].retryAfterMs);
      entry.pending = null;
      return value;
    });
    cache.set(key, entry);
    return entry.pending;
  }

  function tabJob(tabId) { return [...jobs.values()].find(job => job.tabId === tabId); }

  function retireFrame(job) {
    if (job.frameDocumentId) job.retiredFrames = [...(job.retiredFrames || []), job.frameDocumentId].slice(-8);
    job.frameDocumentId = null;
    job.accessRevision = (job.accessRevision || 0) + 1;
  }

  function suspendDocument(job) {
    if (job.documentPending) return;
    job.documentPending = true;
    job.panelGeneration++;
    retireFrame(job);
  }

  function claimDocument(job, sender) {
    const id = documentId(sender);
    // A bfcache return may reuse a formerly active document, but an old document
    // cannot claim the current panel after its replacement has checked in.
    if (id && job.retiredDocuments?.includes(id) && !job.documentPending) return false;
    if (id && job.documentId && id !== job.documentId) {
      job.retiredDocuments = [...(job.retiredDocuments || []), job.documentId].slice(-8);
      if (!job.documentPending) {
        job.panelGeneration++; retireFrame(job);
        tabEpochs.set(job.tabId, (tabEpochs.get(job.tabId) || 0) + 1);
      }
    }
    if (id) {
      job.documentId = id;
      job.retiredDocuments = (job.retiredDocuments || []).filter(value => value !== id);
    }
    job.documentPending = false;
    pendingDocuments.delete(job.tabId);
    return true;
  }

  function ownsPanel(context, sender, message, job) {
    return Boolean(context && job && activeDocument(sender) && context.tabId === job.tabId && context.source === job.source && context.parentOrigin === job.parentOrigin && context.pageKey === job.pageKey &&
      message.token === job.token && Number.isSafeInteger(message.panelGeneration) && message.panelGeneration === job.panelGeneration && !job.documentPending &&
      (!job.documentId || documentId(sender) === job.documentId));
  }

  function jobReady(job, resumed = false, retryAfterMs = SITE_PROVIDERS[job.source].retryAfterMs) {
    return { status: 'ready', token: job.token, gameUrl: job.kind === 'bot' ? job.gameKey : job.game.url, source: job.source,
      endTime: job.game.end_time, retryAfterMs,
      panelState: job.panelState, panelGeneration: job.panelGeneration, resumed,
      ...(job.kind === 'bot' ? { kind: 'bot', gameKey: job.gameKey } : {}) };
  }

  function newJob(context, sender, config, game, extra = {}) {
    return { ...context, token: makeToken(), game, ...extra, selectionPageKey: context.pageKey, analysis: config.analysis, configKey: config.key,
      panelState: 'open', panelGeneration: 1, documentId: documentId(sender), frameDocumentId: null, retiredDocuments: [], retiredFrames: [], documentPending: false, accessRevision: 0 };
  }

  async function check(sender, message = {}) {
    const context = contentContext(sender);
    if (!context) return disabled();
    const { source, tabId } = context;
    pageChanged(tabId, sender.tab.url);
    const epoch = tabEpochs.get(tabId) || 0;
    const sourceEpoch = sourceEpochs.get(source) || 0;
    const startedGeneration = generation;
    const config = await configuration(source);
    if (!config) return disabled();
    if (startedGeneration !== generation || (tabEpochs.get(tabId) || 0) !== epoch || (sourceEpochs.get(source) || 0) !== sourceEpoch) return disabled();
    prune();
    const refreshCompleted = source === 'chesscom' && message.refreshCompleted === true;
    const manualRetry = message.manualRetry === true;
    const retryAfterMs = refreshCompleted ? COMPLETION_RETRY_MS : SITE_PROVIDERS[source].retryAfterMs;
    const retained = tabJob(tabId);
    if (retained && retained.configKey === config.key && canCarryJob(retained, sender.tab.url)) {
      if (message.fresh === true && !ownsPanel(context, sender, message, retained)) return expired();
      if (!claimDocument(retained, sender)) return expired();
      if (message.fresh !== true) {
        retained.expiresAt = now() + JOB_LIFETIME;
        return jobReady(retained, true);
      }
        // A confirmed new round ends the previous selection even when its new
        // archive entry/export is delayed. Never resume that old game afterward.
        retireFrame(retained);
        jobs.delete(retained.token);
    }
    if (isChessComBotPage(context.pageKey)) {
      const current = await configuration(source);
      if (!current || current.key !== config.key || startedGeneration !== generation || (tabEpochs.get(tabId) || 0) !== epoch || (sourceEpochs.get(source) || 0) !== sourceEpoch) return disabled();
      return { status: 'bot', source, retryAfterMs, message: 'Bot games are private. Open Share → PGN after the game, or import its finished PGN here.' };
    }
    if (unrecognizedChessGamePage(context.pageKey)) return {
      status: 'waiting', source, retryAfterMs,
      message: 'This game link could not be recognized. Open its full game link or import the finished PGN.',
    };
    const currentGame = gameUrlForPage(context.pageKey);
    const data = await archive(source, config.username, currentGame, refreshCompleted, manualRetry);
    const current = await configuration(source);
    if (!current || current.key !== config.key || startedGeneration !== generation || (tabEpochs.get(tabId) || 0) !== epoch || (sourceEpochs.get(source) || 0) !== sourceEpoch) return disabled();
    if (data.error) return { status: 'error', source, message: data.error, retryAfterMs: SITE_PROVIDERS[source].retryAfterMs };
    const game = currentGame ? data.games.find(item => item.url === currentGame) : data.games[0];
    if (!game) return {
      status: 'waiting', source, retryAfterMs,
      message: currentGame ? 'Waiting for this completed game to appear in the public archive.' : 'Waiting for your latest completed game.',
    };
    let job = [...jobs.values()].find(item => item.kind !== 'bot' && item.tabId === tabId && item.source === source && item.parentOrigin === context.parentOrigin && item.game.url === game.url && item.configKey === config.key);
    if (!job) {
      for (const [token, item] of jobs) if (item.tabId === tabId) jobs.delete(token);
      prune();
      job = newJob(context, sender, config, game);
      jobs.set(job.token, job);
    }
    if (!claimDocument(job, sender)) return expired();
    job.expiresAt = now() + JOB_LIFETIME;
    return jobReady(job, false, retryAfterMs);
  }

  async function importBot(sender, pgn) {
    const context = contentContext(sender);
    if (!context || !isChessComBotPage(context.pageKey)) return disabled();
    const { source, tabId } = context;
    pageChanged(tabId, sender.tab.url);
    const retained = tabJob(tabId);
    if (retained && (retained.documentPending || (retained.documentId && documentId(sender) !== retained.documentId))) return expired();
    const epoch = tabEpochs.get(tabId) || 0, sourceEpoch = sourceEpochs.get(source) || 0, startedGeneration = generation;
    const revision = (botImports.get(tabId) || 0) + 1;
    botImports.set(tabId, revision);
    if (botImports.size > 200) botImports.delete(botImports.keys().next().value);
    const config = await configuration(source);
    if (!config) return disabled();
    const game = completedBotGame(pgn, now());
    const gameKey = `pgn:${await reviewIdForGame(game)}`;
    const current = await configuration(source);
    if (!current || current.key !== config.key || startedGeneration !== generation || (tabEpochs.get(tabId) || 0) !== epoch || (sourceEpochs.get(source) || 0) !== sourceEpoch || botImports.get(tabId) !== revision) return disabled();
    prune();
    let job = [...jobs.values()].find(item => item.kind === 'bot' && item.tabId === tabId && item.pageKey === context.pageKey && item.parentOrigin === context.parentOrigin && item.gameKey === gameKey && item.configKey === config.key);
    if (!job) {
      for (const [token, item] of jobs) if (item.tabId === tabId) jobs.delete(token);
      job = newJob(context, sender, config, game, { kind: 'bot', gameKey });
      jobs.set(job.token, job);
    }
    if (!claimDocument(job, sender)) return expired();
    job.expiresAt = now() + JOB_LIFETIME;
    return jobReady(job);
  }

  async function frameJob(sender, token) {
    if (!activeDocument(sender) || !isExtensionPage(sender, SITE_SUMMARY_FRAME, token) || !Number.isInteger(sender.frameId) || sender.frameId <= 0 || !Number.isInteger(sender.tab?.id)) return null;
    if (typeof token !== 'string' || token.length > 100) return null;
    const job = jobs.get(token);
    if (!job || job.expiresAt <= now() || job.documentPending || job.panelState === 'closed' || job.tabId !== sender.tab.id || !canCarryJob(job, sender.tab.url)) return null;
    if (trustedUrl(sender.tab.url)?.origin !== job.parentOrigin) return null;
    const id = documentId(sender), revision = job.accessRevision;
    if (id && job.retiredFrames?.includes(id)) return null;
    const config = await configuration(job.source);
    if (!config || config.key !== job.configKey || jobs.get(token) !== job || job.accessRevision !== revision || job.documentPending || job.panelState === 'closed') return null;
    if (id) job.frameDocumentId = id;
    return job;
  }

  function invalidate(tabId) {
    if (Number.isInteger(tabId)) {
      tabEpochs.set(tabId, (tabEpochs.get(tabId) || 0) + 1);
      tabPages.delete(tabId);
      tabOrigins.delete(tabId);
      pendingDocuments.delete(tabId);
      invalidatedTabs.add(tabId);
      if (invalidatedTabs.size > 200) invalidatedTabs.delete(invalidatedTabs.values().next().value);
      for (const [token, job] of jobs) if (job.tabId === tabId) jobs.delete(token);
      if (tabEpochs.size > 200) tabEpochs.delete(tabEpochs.keys().next().value);
    } else {
      generation++;
      jobs.clear();
      cache.clear();
      pendingDocuments.clear();
    }
    void saveSession();
  }

  function pageChanged(tabId, url) {
    const key = pageKey(url), origin = trustedUrl(url)?.origin;
    if (tabPages.get(tabId) === key && tabOrigins.get(tabId) === origin) return;
    const retained = tabJob(tabId);
    if (retained && canCarryJob(retained, url)) {
      tabEpochs.set(tabId, (tabEpochs.get(tabId) || 0) + 1);
      retained.pageKey = key;
    } else invalidate(tabId);
    tabPages.set(tabId, key);
    tabOrigins.set(tabId, origin);
    invalidatedTabs.delete(tabId);
    if (tabPages.size > 200) tabPages.delete(tabPages.keys().next().value);
    void saveSession();
  }

  function documentChanged(tabId) {
    if (!Number.isInteger(tabId)) return;
    tabEpochs.set(tabId, (tabEpochs.get(tabId) || 0) + 1);
    pendingDocuments.add(tabId);
    if (pendingDocuments.size > 200) pendingDocuments.delete(pendingDocuments.values().next().value);
    const job = tabJob(tabId);
    if (job) suspendDocument(job);
    void saveSession();
  }

  function invalidateSource(source) {
    if (!Object.hasOwn(SITE_PROVIDERS, source)) return;
    sourceEpochs.set(source, (sourceEpochs.get(source) || 0) + 1);
    for (const [token, job] of jobs) if (job.source === source) jobs.delete(token);
    for (const key of cache.keys()) if (key.startsWith(`${source}:`)) cache.delete(key);
    void saveSession();
  }

  return {
    invalidate,
    invalidateSource,
    pageChanged,
    documentChanged,
    isSettingsSender: sender => isExtensionPage(sender, 'review.html') && (!Number.isInteger(sender.frameId) || sender.frameId === 0),
    async handle(message, sender) {
      await ready();
      try { return await dispatch(message, sender); }
      catch (error) { return { status: 'error', message: error instanceof Error ? error.message.slice(0, 240) : 'Saved reviews are unavailable. Try again shortly.' }; }
      finally { await saveSession(); }
    },
  };

  async function dispatch(message, sender) {
      switch (message?.type) {
        case 'meowl:site-check': return check(sender, message);
        case 'meowl:site-bot-import': return importBot(sender, message.pgn);
        case 'meowl:site-open-settings': {
          const context = contentContext(sender);
          if (!context || !await configuration(context.source)) return disabled();
          await openReview(extensionUrl('review.html?siteSettings=1'));
          return { status: 'opened' };
        }
        case 'meowl:site-payload': {
          const job = await frameJob(sender, message.token);
          return job ? { status: 'ready', token: job.token, source: job.source, parentOrigin: job.parentOrigin, game: job.game, analysis: job.analysis, ...(job.kind === 'bot' ? { kind: 'bot', gameKey: job.gameKey } : {}) } : expired();
        }
        case 'meowl:site-load-review':
        case 'meowl:site-save-review': {
          const job = await frameJob(sender, message.token);
          if (!job) return expired();
          const revision = job.accessRevision;
          const assertActive = async () => {
            if (await frameJob(sender, message.token) !== job || job.accessRevision !== revision) throw new Error('This page review was canceled or its settings changed.');
          };
          if (message.type === 'meowl:site-load-review') {
            if (!loadReview) throw new Error('Saved reviews are unavailable in this browser session.');
            const record = await loadReview(job, assertActive);
            await assertActive();
            return { status: 'ready', record };
          }
          if (!saveReview) throw new Error('Saved reviews are unavailable in this browser session.');
          const saved = await saveReview(job, message.result, assertActive);
          await assertActive();
          const { savedFresh, ...record } = saved;
          return { status: 'saved', record, savedFresh: savedFresh === true };
        }
        case 'meowl:site-panel-state':
        case 'meowl:site-release': {
          const context = contentContext(sender), job = jobs.get(message.token);
          if (!ownsPanel(context, sender, message, job)) return expired();
          const config = await configuration(job.source);
          if (!config || config.key !== job.configKey || jobs.get(job.token) !== job || !ownsPanel(context, sender, message, job)) return expired();
          if (message.type === 'meowl:site-panel-state') {
            if (!PANEL_STATES.has(message.panelState)) return expired();
            if (message.panelState === 'closed' && job.panelState !== 'closed') retireFrame(job);
            job.panelState = message.panelState;
            job.expiresAt = now() + JOB_LIFETIME;
            return { status: 'updated', panelState: job.panelState, panelGeneration: job.panelGeneration };
          }
          jobs.delete(message.token);
          return { status: 'released' };
        }
        case 'meowl:site-open-review': {
          const job = await frameJob(sender, message.token);
          if (!job || typeof message.reviewId !== 'string' || !/^game-[a-f0-9]{64}$/.test(message.reviewId)) return expired();
          await openReview(extensionUrl(`review.html?reviewId=${encodeURIComponent(message.reviewId)}`));
          return { status: 'opened' };
        }
        default: return undefined;
      }
  }
}
