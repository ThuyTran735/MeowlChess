export const UPDATE_PERMISSION = Object.freeze({ origins: ['https://api.github.com/*'] });
export const RELEASES_URL = 'https://github.com/ThuyTran735/MeowlChess/releases/latest';
export const DOWNLOAD_URL = `${RELEASES_URL}/download/MeowlChess.zip`;
export const UPDATE_API = 'https://api.github.com/repos/ThuyTran735/MeowlChess/releases/latest';
export const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL = 60 * 1000;
const FAILURE_INTERVAL = 15 * 60 * 1000;
const CACHE_KEY = 'updateCheckState';
const REPO_URL = 'https://github.com/ThuyTran735/MeowlChess';

export function versionParts(value) {
  if (typeof value !== 'string' || !/^v?(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})(?:\.(0|[1-9]\d{0,4}))?$/.test(value)) return null;
  const parts = value.replace(/^v/, '').split('.').map(Number);
  return parts.some(part => part > 65535) ? null : [...parts, ...Array(4 - parts.length).fill(0)];
}
export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) throw new Error('Invalid extension version.');
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
export function releaseDetails(raw) {
  if (!raw || raw.draft !== false || raw.prerelease !== false || !versionParts(raw.tag_name)) throw new Error('No supported stable release is available.');
  const tag = raw.tag_name, releaseUrl = `${REPO_URL}/releases/tag/${tag}`;
  if (raw.html_url !== releaseUrl) throw new Error('The release address could not be verified.');
  const downloadUrl = `${REPO_URL}/releases/download/${tag}/MeowlChess.zip`;
  if (!Array.isArray(raw.assets) || !raw.assets.some(asset => asset.name === 'MeowlChess.zip' && asset.browser_download_url === downloadUrl && asset.state === 'uploaded' && asset.size > 0)) throw new Error('The release download is not ready yet.');
  return { version: tag.replace(/^v/, ''), releaseUrl, downloadUrl, notes: typeof raw.body === 'string' ? raw.body.slice(0, 8000) : '' };
}
function safeCachedRelease(raw) {
  if (!raw || !versionParts(raw.version)) return null;
  const version = raw.version;
  if (![version, `v${version}`].some(tag => raw.releaseUrl === `${REPO_URL}/releases/tag/${tag}` && raw.downloadUrl === `${REPO_URL}/releases/download/${tag}/MeowlChess.zip`)) return null;
  return { version, releaseUrl: raw.releaseUrl, downloadUrl: raw.downloadUrl, notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 8000) : '' };
}
export function createUpdateService({ storage, hasPermission, fetcher = (...args) => fetch(...args), now = Date.now, version, timeoutMs = 10000 }) {
  let pending;
  async function read() {
    const data = await storage.get([CACHE_KEY, 'updatePreferences']);
    const raw = data[CACHE_KEY] || {}, time = now();
    const timestamp = value => Number.isFinite(value) && value > 0 && value <= time ? value : 0;
    return { automatic: data.updatePreferences?.automatic === true, cache: {
      attemptedAt: timestamp(raw.attemptedAt), checkedAt: timestamp(raw.checkedAt),
      retryAt: Number.isFinite(raw.retryAt) && raw.retryAt <= time + UPDATE_INTERVAL ? raw.retryAt : 0,
      release: safeCachedRelease(raw.release), error: typeof raw.error === 'string' ? raw.error.slice(0, 180) : '',
    } };
  }
  async function snapshot() {
    const { automatic, cache } = await read();
    const allowed = await hasPermission(UPDATE_PERMISSION);
    return { currentVersion: version, automatic: automatic && allowed, permission: allowed, ...cache,
      available: !!cache.release && compareVersions(cache.release.version, version) > 0 };
  }
  async function perform(manual) {
    const { automatic, cache } = await read(), time = now();
    if (!await hasPermission(UPDATE_PERMISSION)) return { ...await snapshot(), status: 'permission' };
    if (!manual && !automatic) return { ...await snapshot(), status: 'disabled' };
    if (cache.retryAt > time || cache.attemptedAt && time - cache.attemptedAt < (manual ? RETRY_INTERVAL : UPDATE_INTERVAL)) return { ...await snapshot(), status: 'cached' };
    const next = { ...cache, attemptedAt: time, error: '', retryAt: time + RETRY_INTERVAL };
    // Persist before fetching, including failed/offline attempts and worker restarts.
    await storage.set({ [CACHE_KEY]: next });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(UPDATE_API, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) {
        const retrySeconds = Number(response.headers?.get('retry-after'));
        const reset = Number(response.headers?.get('x-ratelimit-reset')) * 1000;
        if (response.status === 403 || response.status === 429) next.retryAt = Math.min(time + UPDATE_INTERVAL, Math.max(time + FAILURE_INTERVAL, reset || 0, time + (retrySeconds || 0) * 1000));
        throw new Error('Could not check GitHub. Try again later.');
      }
      if (Number(response.headers?.get('content-length')) > 256 * 1024) throw new Error('The release response was too large.');
      const reader = response.body?.getReader();
      let body = '';
      if (reader) {
        const decoder = new TextDecoder(); let size = 0;
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 256 * 1024) { await reader.cancel(); throw new Error('The release response was too large.'); } body += decoder.decode(value, { stream: true }); } body += decoder.decode(); }
        finally { reader.releaseLock(); }
      } else { body = await response.text(); if (body.length > 256 * 1024) throw new Error('The release response was too large.'); }
      next.release = releaseDetails(JSON.parse(body)); next.checkedAt = now(); next.retryAt = time + RETRY_INTERVAL;
    } catch (error) {
      next.error = error?.name === 'AbortError' ? 'The update check timed out. Try again when you are online.' : 'Could not check for updates. Your reviews still work offline.';
      next.retryAt = Math.max(next.retryAt, time + FAILURE_INTERVAL);
    } finally { clearTimeout(timer); }
    await storage.set({ [CACHE_KEY]: next });
    return { ...await snapshot(), status: next.error ? 'error' : 'checked' };
  }
  return {
    snapshot,
    check({ manual = false } = {}) {
      if (!pending) pending = perform(manual).finally(() => { pending = null; });
      return pending;
    },
    async setAutomatic(enabled) {
      if (enabled && !await hasPermission(UPDATE_PERMISSION)) throw new Error('Allow GitHub update checks first.');
      await storage.set({ updatePreferences: { automatic: enabled === true } });
      return snapshot();
    },
  };
}
