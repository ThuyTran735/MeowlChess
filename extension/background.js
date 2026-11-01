import { fetchGames } from './lib/games.js';
import { createReviewLibrary, reviewIdForGame } from './lib/library.js';
import { ANALYSIS_VERSION } from './lib/review.js';
import { createCompletionAlertService } from './lib/completion-alert-service.js';
import { createSiteReviewBroker, createSiteReviewLibraryBridge, normalizeSiteSettings, normalizeSiteAnalysis, SITE_CONTENT_SCRIPT, SITE_PROVIDERS } from './lib/site-review.js';

const SETTINGS_KEY = 'siteReviewSettings';
const SCRIPT_PREFIX = 'meowl-site-';
const SITE_SCRIPTS = ['site-panel.js', 'site-bot.js', SITE_CONTENT_SCRIPT];
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

const notificationLibrary = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
const alertsEnabled = async () => {
  if ((await chrome.storage.local.get('completionAlerts')).completionAlerts !== true || !await chrome.permissions.contains({ permissions: ['notifications'] }) || !chrome.notifications) return false;
  return new Promise(resolve => chrome.notifications.getPermissionLevel(level => resolve(!chrome.runtime.lastError && level === 'granted')));
};
const completionAlerts = createCompletionAlertService({
  enabled: alertsEnabled,
  authorize: async (message, sender) => {
    if (sender?.documentLifecycle && sender.documentLifecycle !== 'active') return null;
    if (broker.isSettingsSender(sender)) return notificationLibrary.loadReview(message.reviewId);
    const reply = await broker.handle({ type: 'meowl:site-load-review', token: message.token }, sender);
    return reply?.status === 'ready' ? reply.record : null;
  },
  loadReview: id => notificationLibrary.loadReview(id),
  away: async sender => {
    // The trusted extension page also reports document.hidden. Recheck a known
    // tab just before showing the alert so returning to it suppresses the toast.
    if (!Number.isInteger(sender?.tab?.id)) return true;
    try {
      const tab = await chrome.tabs.get(sender.tab.id);
      if (!tab.active) return true;
      return !(await chrome.windows.get(tab.windowId)).focused;
    } catch { return false; }
  },
  create: (id, options) => new Promise((resolve, reject) => chrome.notifications.create(id, { ...options, iconUrl: chrome.runtime.getURL(options.iconUrl) }, result => {
    const error = chrome.runtime.lastError; if (error) reject(new Error(error.message)); else resolve(result);
  })),
  clear: id => chrome.notifications ? new Promise(resolve => chrome.notifications.clear(id, () => { void chrome.runtime.lastError; resolve(); })) : Promise.resolve(),
  openReview: id => chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?reviewId=${encodeURIComponent(id)}`) }),
  readHistory: async () => (await chrome.storage.session?.get('completionAlertHistory'))?.completionAlertHistory,
  writeHistory: history => chrome.storage.session?.set({ completionAlertHistory: history }),
});
const notificationClicked = id => { void completionAlerts.click(id).catch(() => {}); };
function registerNotificationClicks() {
  if (!chrome.notifications?.onClicked) return;
  chrome.notifications.onClicked.removeListener(notificationClicked);
  chrome.notifications.onClicked.addListener(notificationClicked);
}
registerNotificationClicks();
async function clearCompletionAlerts() {
  if (!chrome.notifications) return;
  chrome.notifications.getAll(items => {
    if (chrome.runtime.lastError) return;
    for (const id of Object.keys(items)) if (id.startsWith('meowl-review-')) chrome.notifications.clear(id, () => { void chrome.runtime.lastError; });
  });
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
});

let reconciliation = Promise.resolve();

async function reconcile({ inject = false } = {}) {
  const checkSettings = async () => {
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
    return enabled;
  };
  const enabled = globalThis.navigator?.locks?.request
    ? await navigator.locks.request('meowlchess-site-settings', checkSettings) : await checkSettings();
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
    const existing = registered.find(script => script.id === id);
    if (!existing) {
      await chrome.scripting.registerContentScripts([{
        id, matches: SITE_PROVIDERS[source].origins, js: SITE_SCRIPTS,
        runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
      }]);
    } else if (JSON.stringify(existing.js) !== JSON.stringify(SITE_SCRIPTS)) {
      await chrome.scripting.updateContentScripts([{ id, js: SITE_SCRIPTS }]);
    }
    if (!inject) continue;
    const tabs = await chrome.tabs.query({ url: SITE_PROVIDERS[source].origins });
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false }, files: SITE_SCRIPTS,
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
  if (changes.completionAlerts && changes.completionAlerts.newValue !== true) void clearCompletionAlerts();
  if (changes[SETTINGS_KEY]) {
    const before = normalizeSiteSettings(changes[SETTINGS_KEY].oldValue), after = normalizeSiteSettings(changes[SETTINGS_KEY].newValue);
    for (const source of Object.keys(SITE_PROVIDERS)) if (JSON.stringify(before[source]) !== JSON.stringify(after[source])) broker.invalidateSource(source);
  }
  if (changes.reviewSettings && JSON.stringify(normalizeSiteAnalysis(changes.reviewSettings.oldValue)) !== JSON.stringify(normalizeSiteAnalysis(changes.reviewSettings.newValue))) {
    for (const source of Object.keys(SITE_PROVIDERS)) broker.invalidateSource(source);
  }
  if (changes[SETTINGS_KEY]) void scheduleReconcile({ inject: true }).catch(() => {});
});
chrome.permissions.onRemoved.addListener(permissions => {
  if (permissions?.permissions?.includes('notifications')) void chrome.storage.local.set({ completionAlerts: false }).catch(() => {});
  void scheduleReconcile({ inject: true }).catch(() => {});
});
chrome.permissions.onAdded.addListener(() => { registerNotificationClicks(); void scheduleReconcile({ inject: true }).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => broker.invalidate(tabId));
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url) broker.pageChanged(tabId, changes.url);
  if (changes.status === 'loading') broker.documentChanged(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'meowl:review-completed') {
    completionAlerts.complete(message, sender).then(sendResponse, () => sendResponse({ status: 'unavailable' }));
    return true;
  }
  if (!['meowl:site-check', 'meowl:site-panel-state', 'meowl:site-bot-import', 'meowl:site-payload', 'meowl:site-load-review', 'meowl:site-save-review', 'meowl:site-release', 'meowl:site-open-review', 'meowl:site-open-settings', 'meowl:site-settings-changed'].includes(message?.type)) return false;
  const response = message.type === 'meowl:site-settings-changed'
    ? broker.isSettingsSender(sender) ? scheduleReconcile({ inject: true }).then(() => ({ status: 'ready' })) : Promise.resolve({ status: 'disabled' })
    : broker.handle(message, sender);
  Promise.resolve(response).then(sendResponse, () => sendResponse({ status: 'error', message: 'Could not update the page review. Try again shortly.', retryAfterMs: 60000 }));
  return true;
});

// Reconcile again when an idle service worker is restarted by a page request.
void scheduleReconcile().catch(() => {});
