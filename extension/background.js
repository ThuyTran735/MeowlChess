import { fetchGames } from './lib/games.js';
import { createReviewLibrary, reviewIdForGame } from './lib/library.js';
import { ANALYSIS_VERSION } from './lib/review.js';
import { createSiteReviewBroker, createSiteReviewLibraryBridge, normalizeSiteSettings, normalizeSiteAnalysis, SITE_CONTENT_SCRIPT, SITE_PROVIDERS } from './lib/site-review.js';

const SETTINGS_KEY = 'siteReviewSettings';
const SCRIPT_PREFIX = 'meowl-site-';
const permissionFor = source => ({ permissions: ['scripting'], origins: SITE_PROVIDERS[source].origins });
const hasPermission = source => chrome.permissions.contains(permissionFor(source));
const libraryBridge = createSiteReviewLibraryBridge({ library: createReviewLibrary({ analysisVersion: ANALYSIS_VERSION }), idForGame: reviewIdForGame });

const broker = createSiteReviewBroker({
  extensionId: chrome.runtime.id,
  extensionUrl: path => chrome.runtime.getURL(path),
  readSettings: () => chrome.storage.local.get([SETTINGS_KEY, 'reviewSettings']),
  hasPermission,
  fetchGames,
  ...libraryBridge,
  openReview: url => chrome.tabs.create({ url }),
  readSession: async () => (await chrome.storage.session?.get('siteReviewSession'))?.siteReviewSession,
  writeSession: value => chrome.storage.session?.set({ siteReviewSession: value }),
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
});

let reconciliation = Promise.resolve();

async function reconcile({ inject = false } = {}) {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = normalizeSiteSettings(raw[SETTINGS_KEY]);
  let disabled = false;
  const enabled = [];
  for (const source of Object.keys(SITE_PROVIDERS)) {
    if (!settings[source].enabled) continue;
    if (await hasPermission(source)) enabled.push(source);
    else { settings[source].enabled = false; disabled = true; broker.invalidateSource(source); }
  }
  if (disabled) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }
  // Optional permissions can remove access to chrome.scripting itself.
  if (!chrome.scripting) return;
  let registered;
  try { registered = await chrome.scripting.getRegisteredContentScripts(); }
  catch { return; }
  const wanted = new Set(enabled.map(source => SCRIPT_PREFIX + source));
  const obsolete = registered.filter(script => script.id.startsWith(SCRIPT_PREFIX) && !wanted.has(script.id)).map(script => script.id);
  if (obsolete.length) await chrome.scripting.unregisterContentScripts({ ids: obsolete });
  for (const source of enabled) {
    const id = SCRIPT_PREFIX + source;
    if (!registered.some(script => script.id === id)) {
      await chrome.scripting.registerContentScripts([{
        id, matches: SITE_PROVIDERS[source].origins, js: [SITE_CONTENT_SCRIPT],
        runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
      }]);
    }
    if (!inject) continue;
    const tabs = await chrome.tabs.query({ url: SITE_PROVIDERS[source].origins });
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false }, files: [SITE_CONTENT_SCRIPT],
    })));
  }
}

function scheduleReconcile(options) {
  reconciliation = reconciliation.catch(() => {}).then(() => reconcile(options));
  return reconciliation;
}

chrome.runtime.onInstalled.addListener(() => { void scheduleReconcile({ inject: true }).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void scheduleReconcile({ inject: true }).catch(() => {}); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SETTINGS_KEY]) {
    const before = normalizeSiteSettings(changes[SETTINGS_KEY].oldValue), after = normalizeSiteSettings(changes[SETTINGS_KEY].newValue);
    for (const source of Object.keys(SITE_PROVIDERS)) if (JSON.stringify(before[source]) !== JSON.stringify(after[source])) broker.invalidateSource(source);
  }
  if (changes.reviewSettings && JSON.stringify(normalizeSiteAnalysis(changes.reviewSettings.oldValue)) !== JSON.stringify(normalizeSiteAnalysis(changes.reviewSettings.newValue))) {
    for (const source of Object.keys(SITE_PROVIDERS)) broker.invalidateSource(source);
  }
  if (changes[SETTINGS_KEY]) void scheduleReconcile({ inject: true }).catch(() => {});
});
chrome.permissions.onRemoved.addListener(() => {
  void scheduleReconcile({ inject: true }).catch(() => {});
});
chrome.permissions.onAdded.addListener(() => { void scheduleReconcile({ inject: true }).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => broker.invalidate(tabId));
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url) broker.pageChanged(tabId, changes.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['meowl:site-check', 'meowl:site-payload', 'meowl:site-load-review', 'meowl:site-save-review', 'meowl:site-release', 'meowl:site-open-review', 'meowl:site-open-settings', 'meowl:site-settings-changed'].includes(message?.type)) return false;
  const response = message.type === 'meowl:site-settings-changed'
    ? broker.isSettingsSender(sender) ? scheduleReconcile({ inject: true }).then(() => ({ status: 'ready' })) : Promise.resolve({ status: 'disabled' })
    : broker.handle(message, sender);
  Promise.resolve(response).then(sendResponse, () => sendResponse({ status: 'error', message: 'Could not update the page review. Try again shortly.', retryAfterMs: 60000 }));
  return true;
});

// Reconcile again when an idle service worker is restarted by a page request.
void scheduleReconcile().catch(() => {});
