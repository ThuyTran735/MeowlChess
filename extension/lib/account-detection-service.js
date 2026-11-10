import { accountUsername } from './accounts.js';
import { readSignedInAccount } from './account-detection.js';

export const ACCOUNT_ORIGINS = Object.freeze({
  chesscom: ['https://www.chess.com/*', 'https://chess.com/*'],
  lichess: ['https://lichess.org/*'],
});

export function accountSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return ['chess.com', 'www.chess.com'].includes(url.hostname) ? 'chesscom' : url.hostname === 'lichess.org' ? 'lichess' : null;
  } catch { return null; }
}

/** Read only the site's own account widget, with no account API or credentials. */
export function createAccountDetectionService({ storage, tabs, scripting, permissions, now = Date.now, locks = globalThis.navigator?.locks } = {}) {
  const revisions = new Map(), inflight = new Map(), sourceRevisions = new Map();
  let writes = Promise.resolve();
  const supported = source => Object.hasOwn(ACCOUNT_ORIGINS, source);
  const unavailable = source => ({ status: 'unavailable', source });
  const usable = tab => Number.isInteger(tab?.id) && tab.id >= 0 && !tab.incognito && !tab.discarded && accountSource(tab.url);
  const permission = source => permissions.contains({ permissions: ['scripting'], origins: ACCOUNT_ORIGINS[source] }).catch(() => false);
  function requestFor(source) {
    const revision = (sourceRevisions.get(source) || 0) + 1;
    sourceRevisions.set(source, revision);
    return () => sourceRevisions.get(source) === revision;
  }
  const scopedReading = (reading, currentRequest) => reading && ({ ...reading, current: () => reading.current() && currentRequest() });
  function invalidate(tabId) { revisions.set(tabId, (revisions.get(tabId) || 0) + 1); inflight.delete(tabId); }
  async function inspect(tab) {
    if (!usable(tab) || !scripting?.executeScript) return null;
    if (inflight.has(tab.id)) return inflight.get(tab.id);
    const source = accountSource(tab.url), revision = revisions.get(tab.id) || 0;
    const current = () => (revisions.get(tab.id) || 0) === revision;
    const read = async () => {
      for (const pause of [0, 180, 420]) {
        if (pause) await new Promise(resolve => setTimeout(resolve, pause));
        if (!current()) return null;
        let timer;
        const results = await Promise.race([
          scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: readSignedInAccount, world: 'ISOLATED' }).catch(() => null),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 1800); }),
        ]).finally(() => clearTimeout(timer));
        if (!current()) return null;
        const latest = await tabs.get(tab.id).catch(() => null);
        if (!usable(latest) || latest.url !== tab.url || !current()) return null;
        const reply = results?.find(item => item.frameId === 0)?.result;
        if (!reply || reply.source !== source) return null;
        if (reply.state === 'signed-in') {
          const username = accountUsername(source, reply.username);
          return username ? { source, username, state: 'signed-in', current } : null;
        }
        if (['signed-out', 'ambiguous'].includes(reply.state)) return { source, state: reply.state, current };
      }
      return null;
    };
    const pending = read().catch(() => null).finally(() => { if (inflight.get(tab.id) === pending) inflight.delete(tab.id); });
    inflight.set(tab.id, pending);
    return pending;
  }
  function save(reading) {
    const update = async () => {
      if (!reading.current()) return false;
      const raw = (await storage.get('detectedAccounts')).detectedAccounts;
      const detectedAccounts = {};
      for (const source of Object.keys(ACCOUNT_ORIGINS)) {
        const entry = raw?.[source], username = accountUsername(source, entry?.username);
        if (username && Number.isFinite(entry.detectedAt) && entry.detectedAt > 0) detectedAccounts[source] = { username, detectedAt: entry.detectedAt };
      }
      if (!reading.current()) return false;
      const previous = detectedAccounts[reading.source];
      if (reading.state === 'signed-out') {
        if (!detectedAccounts[reading.source]) return true;
        delete detectedAccounts[reading.source];
      } else {
        const old = detectedAccounts[reading.source], stamp = now();
        if (old?.username === reading.username && stamp - old.detectedAt < 300000 && stamp >= old.detectedAt) return true;
        detectedAccounts[reading.source] = { username: reading.username, detectedAt: stamp };
      }
      await storage.set({ detectedAccounts });
      if (reading.current()) return true;
      // A navigation can occur while the browser commits storage. Roll back only
      // our exact write, under the same lock; never erase a newer account.
      const latest = (await storage.get('detectedAccounts')).detectedAccounts || {};
      if (JSON.stringify(latest[reading.source]) === JSON.stringify(detectedAccounts[reading.source])) {
        const restored = { ...latest };
        if (previous) restored[reading.source] = previous;
        else delete restored[reading.source];
        await storage.set({ detectedAccounts: restored });
      }
      return false;
    };
    const next = writes.catch(() => {}).then(() => locks?.request ? locks.request('MeowlChess-detected-accounts', update) : update());
    writes = next;
    return next;
  }
  async function detectTab(tab, { activeGrant = false } = {}) {
    const source = accountSource(tab?.url);
    if (!usable(tab)) return unavailable(source);
    const currentRequest = requestFor(source);
    if (!activeGrant && !await permission(source)) return { status: 'permission-required', source };
    const reading = scopedReading(await inspect(tab), currentRequest);
    if (!reading || !reading.current()) return { status: 'not-found', source };
    if (reading.state === 'ambiguous') return { status: 'ambiguous', source };
    if (!await save(reading)) return unavailable(source);
    return reading.state === 'signed-in' ? { status: 'detected', source, username: reading.username } : { status: 'not-found', source };
  }
  async function detect(source) {
    if (!supported(source) || !scripting?.executeScript) return unavailable(source);
    const currentRequest = requestFor(source);
    if (!await permission(source)) return { status: 'permission-required', source };
    const candidates = (await tabs.query({ url: ACCOUNT_ORIGINS[source] })).filter(usable);
    // An explicit lookup never arbitrarily picks one of two signed-in accounts.
    // Bound the work when a browser has many old chess tabs open.
    if (candidates.length > 10) return { status: 'ambiguous', source };
    const readings = (await Promise.all(candidates.map(inspect))).map(reading => scopedReading(reading, currentRequest)).filter(reading => reading?.current());
    const signed = readings.filter(reading => reading.state === 'signed-in');
    if (readings.some(reading => reading.state === 'ambiguous') || new Set(signed.map(reading => reading.username.toLowerCase())).size > 1) return { status: 'ambiguous', source };
    const reading = signed[0] || (readings.length === candidates.length && readings.every(reading => reading.state === 'signed-out') ? readings[0] : null);
    if (!reading) return { status: 'not-found', source };
    if (!await save(reading)) return unavailable(source);
    return reading.state === 'signed-in' ? { status: 'detected', source, username: reading.username } : { status: 'not-found', source };
  }
  return { detect: source => detect(source).catch(() => unavailable(source)), detectTab: (tab, options) => detectTab(tab, options).catch(() => unavailable(accountSource(tab?.url))), invalidate };
}
