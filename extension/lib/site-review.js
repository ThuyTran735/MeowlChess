import { isCompletedGame } from './archive.js';
import { parseCompletedPgn, safeOriginalGameUrl } from './pgn.js';
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
const MAX_JOBS = 100;
const SESSION_BYTES = 700000;
const TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

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

/** Strip navigation parameters and private Lichess player keys before retaining a URL. */
export function gameUrlForPage(value) {
  const url = trustedUrl(value);
  const source = providerForUrl(value);
  if (!url || !source) return null;
  if (source === 'chesscom') {
    const match = url.pathname.match(/^\/(?:analysis\/)?game\/(live|daily)\/(\d+)\/?$/);
    return match ? `https://www.chess.com/game/${match[1]}/${match[2]}` : null;
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
        if (saved && !saved.stale) return saved;
        // saveReview validates complete PGN/result correspondence, every line, and storage limits.
        await library.saveReview(job.game, result, job.analysis, { preserveCurrent: true });
        return library.loadReview(id);
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
  const sourceEpochs = new Map();
  let generation = 0;
  let restorePromise, restored = false, persistence = Promise.resolve();

  const disabled = () => ({ status: 'disabled', message: 'Turn on page reviews in MeowlChess settings.' });
  const expired = () => ({ status: 'expired', message: 'This review has expired. Open the dropdown again.' });

  function prune() {
    for (const [token, job] of jobs) if (job.expiresAt <= now()) jobs.delete(token);
    while (jobs.size >= MAX_JOBS) jobs.delete(jobs.keys().next().value);
    while (cache.size > 20) cache.delete(cache.keys().next().value);
  }

  function contentContext(sender) {
    if (sender?.id !== extensionId || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0) return null;
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
    for (const job of [...jobs.values()].reverse().filter(item => item.expiresAt > now()).sort((a, b) => b.expiresAt - a.expiresAt).slice(0, MAX_JOBS)) add(snapshot.jobs, job);
    for (const [key, entry] of cache) {
      if (!entry.pending && entry.expiresAt > now() && entry.value) add(snapshot.cache, { key, expiresAt: entry.expiresAt, value: entry.value });
    }
    // Clone now so later mutations cannot change a queued write's snapshot.
    const value = structuredClone(snapshot);
    persistence = persistence.catch(() => {}).then(() => writeSession(value)).catch(() => {});
    return persistence;
  }

  async function restoreSession() {
    const startedGeneration = generation;
    const startedSources = new Map(sourceEpochs);
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
        if (!Number.isFinite(item.expiresAt) || item.expiresAt <= now() || item.expiresAt > now() + JOB_LIFETIME) continue;
        if (typeof item.pageKey !== 'string' || pageKey(item.pageKey) !== item.pageKey || providerForUrl(item.pageKey) !== item.source) continue;
        if (providerForUrl(item.parentOrigin) !== item.source || trustedUrl(item.parentOrigin)?.origin !== item.parentOrigin) continue;
        const [game] = completedSiteGames([item.game], item.source, config.username, now());
        if (!game) continue;
        const job = { token: item.token, source: item.source, tabId: item.tabId, pageKey: item.pageKey, parentOrigin: item.parentOrigin, game, analysis: config.analysis, configKey: config.key, expiresAt: item.expiresAt };
        jobs.set(job.token, job); tabPages.set(job.tabId, job.pageKey);
      }
      for (const item of snapshot.cache.slice(0, 20)) {
        if (typeof item?.key !== 'string') continue;
        const [source, username, extra] = item.key.split(':');
        const config = configurations.get(source);
        if (!config || username !== config.username || extra !== undefined || !Number.isFinite(item.expiresAt) || item.expiresAt <= now() || item.expiresAt > now() + SITE_PROVIDERS[source].retryAfterMs) continue;
        let value;
        if (Array.isArray(item.value?.games)) value = { games: completedSiteGames(item.value.games, source, username, now()) };
        else if (typeof item.value?.error === 'string') value = { error: item.value.error.slice(0, 240) };
        if (value) cache.set(item.key, { expiresAt: item.expiresAt, value });
      }
    } catch { /* Session storage is optional; a fresh completed-game check can recover. */ }
    finally { restored = true; }
  }

  function ready() {
    restorePromise ||= restoreSession();
    return restorePromise;
  }

  async function archive(source, username) {
    const key = `${source}:${username}`;
    let entry = cache.get(key);
    if (entry && (entry.pending || entry.expiresAt > now())) return entry.pending || entry.value;
    entry = { expiresAt: 0 };
    entry.pending = (async () => {
      try {
        return { games: completedSiteGames(await fetchGames(source, username), source, username, now()) };
      } catch (error) {
        return { error: error instanceof Error ? error.message.slice(0, 240) : 'Could not load completed games. Try again shortly.' };
      }
    })().then(value => {
      entry.value = value;
      entry.expiresAt = now() + SITE_PROVIDERS[source].retryAfterMs;
      entry.pending = null;
      return value;
    });
    cache.set(key, entry);
    return entry.pending;
  }

  async function check(sender) {
    const context = contentContext(sender);
    if (!context) return disabled();
    const { source, tabId } = context;
    pageChanged(tabId, context.pageKey);
    const epoch = tabEpochs.get(tabId) || 0;
    const sourceEpoch = sourceEpochs.get(source) || 0;
    const startedGeneration = generation;
    const config = await configuration(source);
    if (!config) return disabled();
    prune();
    const retryAfterMs = SITE_PROVIDERS[source].retryAfterMs;
    const data = await archive(source, config.username);
    const current = await configuration(source);
    if (!current || current.key !== config.key || startedGeneration !== generation || (tabEpochs.get(tabId) || 0) !== epoch || (sourceEpochs.get(source) || 0) !== sourceEpoch) return disabled();
    if (data.error) return { status: 'error', source, message: data.error, retryAfterMs };
    const currentGame = gameUrlForPage(context.pageKey);
    const game = currentGame ? data.games.find(item => item.url === currentGame) : data.games[0];
    if (!game) return {
      status: 'waiting', source, retryAfterMs,
      message: currentGame ? 'Waiting for this completed game to appear in the public archive.' : 'Waiting for your latest completed game.',
    };
    let job = [...jobs.values()].find(item => item.tabId === tabId && item.source === source && item.pageKey === context.pageKey && item.parentOrigin === context.parentOrigin && item.game.url === game.url && item.configKey === config.key);
    if (!job) {
      for (const [token, item] of jobs) if (item.tabId === tabId) jobs.delete(token);
      prune();
      job = { ...context, token: makeToken(), game, analysis: config.analysis, configKey: config.key };
      jobs.set(job.token, job);
    }
    job.expiresAt = now() + JOB_LIFETIME;
    return { status: 'ready', token: job.token, gameUrl: game.url, source, endTime: game.end_time, retryAfterMs };
  }

  async function frameJob(sender, token) {
    if (!isExtensionPage(sender, SITE_SUMMARY_FRAME, token) || !Number.isInteger(sender.frameId) || sender.frameId <= 0 || !Number.isInteger(sender.tab?.id)) return null;
    if (typeof token !== 'string' || token.length > 100) return null;
    const job = jobs.get(token);
    if (!job || job.expiresAt <= now() || job.tabId !== sender.tab.id || job.pageKey !== pageKey(sender.tab.url) || job.source !== providerForUrl(sender.tab.url)) return null;
    if (trustedUrl(sender.tab.url)?.origin !== job.parentOrigin) return null;
    const config = await configuration(job.source);
    if (!config || config.key !== job.configKey || jobs.get(token) !== job) return null;
    return job;
  }

  function invalidate(tabId) {
    if (Number.isInteger(tabId)) {
      tabEpochs.set(tabId, (tabEpochs.get(tabId) || 0) + 1);
      tabPages.delete(tabId);
      for (const [token, job] of jobs) if (job.tabId === tabId) jobs.delete(token);
      if (tabEpochs.size > 200) tabEpochs.delete(tabEpochs.keys().next().value);
    } else {
      generation++;
      jobs.clear();
      cache.clear();
    }
    void saveSession();
  }

  function pageChanged(tabId, url) {
    const key = pageKey(url);
    if (tabPages.get(tabId) === key) return;
    invalidate(tabId);
    tabPages.set(tabId, key);
    if (tabPages.size > 200) tabPages.delete(tabPages.keys().next().value);
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
        case 'meowl:site-check': return check(sender);
        case 'meowl:site-open-settings': {
          const context = contentContext(sender);
          if (!context || !await configuration(context.source)) return disabled();
          await openReview(extensionUrl('review.html?siteSettings=1'));
          return { status: 'opened' };
        }
        case 'meowl:site-payload': {
          const job = await frameJob(sender, message.token);
          return job ? { status: 'ready', token: job.token, source: job.source, parentOrigin: job.parentOrigin, game: job.game, analysis: job.analysis } : expired();
        }
        case 'meowl:site-load-review':
        case 'meowl:site-save-review': {
          const job = await frameJob(sender, message.token);
          if (!job) return expired();
          const assertActive = async () => {
            if (await frameJob(sender, message.token) !== job) throw new Error('This page review was canceled or its settings changed.');
          };
          if (message.type === 'meowl:site-load-review') {
            if (!loadReview) throw new Error('Saved reviews are unavailable in this browser session.');
            const record = await loadReview(job, assertActive);
            await assertActive();
            return { status: 'ready', record };
          }
          if (!saveReview) throw new Error('Saved reviews are unavailable in this browser session.');
          const record = await saveReview(job, message.result, assertActive);
          return { status: 'saved', record };
        }
        case 'meowl:site-release': {
          const context = contentContext(sender), job = jobs.get(message.token);
          if (!context || !job || context.tabId !== job.tabId || context.source !== job.source || context.pageKey !== job.pageKey) return expired();
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
