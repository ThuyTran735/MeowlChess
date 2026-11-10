import { normalizeSiteSettings, SITE_PROVIDERS } from './site-review.js';
import { accountUsername } from './accounts.js';

export function accountDetectionMessage(source, result) {
  const label = SITE_PROVIDERS[source]?.label || 'the chess website';
  if (result?.status === 'ambiguous') return `More than one ${label} account is open. Open MeowlChess from the account you want, or enter its username.`;
  if (result?.status === 'permission-required') return `Allow access to ${label} to detect your account, or enter your username.`;
  if (result?.status === 'not-found') return `Open ${label}, sign in, then try again. You can also enter your username.`;
  return `Could not detect your ${label} account. You can enter your username instead.`;
}

export function createSiteReviewSettings() {
  const status = document.getElementById('site-review-status');
  const supported = Boolean(globalThis.chrome?.permissions?.request && chrome?.storage?.local);
  let settings = normalizeSiteSettings(), ready = false, busy = false, unavailable = true, settingsRevision = 0;
  let detectedAccounts = {}, detectedRevision = 0;
  const edited = new Set(), revisions = { chesscom: 0, lichess: 0 };
  const controls = Object.fromEntries(Object.keys(SITE_PROVIDERS).map(source => [source, {
    toggle: document.getElementById(`site-${source}-enabled`),
    username: document.getElementById(`site-${source}-username`),
    detect: document.getElementById(`site-${source}-detect`),
  }]));
  function prefill(source) {
    const { username } = controls[source];
    if (!ready || busy || settings[source].enabled || edited.has(source) || username.value.trim()) return;
    const name = accountUsername(source, detectedAccounts?.[source]?.username);
    if (name) username.value = name;
  }
  function render() {
    for (const [source, { toggle, username, detect }] of Object.entries(controls)) {
      toggle.checked = settings[source].enabled;
      toggle.disabled = !supported || !ready || busy || unavailable;
      username.disabled = toggle.disabled || settings[source].enabled;
      username.title = settings[source].enabled ? 'Turn this site off to change its username.' : '';
      if (detect) {
        detect.disabled = username.disabled;
        detect.title = settings[source].enabled ? username.title : `Use your signed-in ${SITE_PROVIDERS[source].label} account`;
        detect.setAttribute('aria-label', `Detect signed-in ${SITE_PROVIDERS[source].label} account`);
      }
    }
  }
  async function persist(source, enabled, username) {
    // Serialize provider merges with other review tabs and permission cleanup.
    const update = async () => {
      const latest = normalizeSiteSettings((await chrome.storage.local.get('siteReviewSettings')).siteReviewSettings);
      latest[source] = { enabled, username };
      await chrome.storage.local.set({ siteReviewSettings: latest });
      settings = latest;
    };
    if (globalThis.navigator?.locks?.request) await navigator.locks.request('meowlchess-site-settings', update);
    else await update();
    // Saving is complete; do not hold the controls while existing tabs are injected.
    void chrome.runtime.sendMessage({ type: 'meowl:site-settings-changed' }).catch(() => {
      status.textContent = 'Your setting is saved. Reload the chess website to reconnect its panel.';
    });
  }
  for (const [source, { toggle, username, detect }] of Object.entries(controls)) {
    username.addEventListener('input', () => { edited.add(source); revisions[source]++; });
    detect?.addEventListener('click', async () => {
      if (!supported || !ready || busy || unavailable || settings[source].enabled) return;
      const revision = revisions[source], original = username.value, provider = SITE_PROVIDERS[source];
      let request;
      try { request = chrome.permissions.request({ permissions: ['scripting'], origins: provider.origins }); }
      catch { status.textContent = accountDetectionMessage(source, null); return; }
      busy = true; render(); status.textContent = `Looking for your signed-in ${provider.label} account…`;
      try {
        if (!await request) { status.textContent = accountDetectionMessage(source, { status: 'permission-required' }); return; }
        const result = await chrome.runtime.sendMessage({ type: 'meowl:detect-account', source });
        if (revision !== revisions[source] || original !== username.value || unavailable || settings[source].enabled) return;
        const name = result?.status === 'detected' && result.source === source && accountUsername(source, result.username);
        if (!name) { status.textContent = accountDetectionMessage(source, result); return; }
        username.value = name; edited.add(source); revisions[source]++;
        status.textContent = `Detected ${name}. Turn on ${provider.label} when you want automatic reviews.`;
      } catch { status.textContent = accountDetectionMessage(source, null); }
      finally { busy = false; render(); }
    });
    toggle.addEventListener('change', async () => {
      const enabled = toggle.checked;
      let name = username.value.trim().toLowerCase();
      const revision = revisions[source], original = username.value;
      const provider = SITE_PROVIDERS[source];
      if (enabled && name && !accountUsername(source, name)) {
        toggle.checked = false;
        status.textContent = `Enter your ${provider.label} username first (not a game link).`;
        username.focus(); return;
      }
      // The permission request must start in the checkbox's user gesture.
      let request;
      try { if (enabled) request = chrome.permissions.request({ permissions: ['scripting'], origins: provider.origins }); }
      catch (error) { toggle.checked = settings[source].enabled; status.textContent = error.message; return; }
      busy = true; render(); status.textContent = enabled ? 'Waiting for browser permission…' : 'Turning off page reviews…';
      try {
        if (enabled && !await request) {
          status.textContent = `Permission was not granted. ${provider.label} page reviews remain off.`;
          return;
        }
        if (revision !== revisions[source] || original !== username.value || unavailable) return;
        if (enabled && !name) {
          status.textContent = `Looking for your signed-in ${provider.label} account…`;
          const result = await chrome.runtime.sendMessage({ type: 'meowl:detect-account', source });
          if (revision !== revisions[source] || original !== username.value || unavailable) return;
          name = result?.status === 'detected' && result.source === source && accountUsername(source, result.username);
          if (!name) { status.textContent = accountDetectionMessage(source, result); return; }
          name = name.toLowerCase();
        }
        await persist(source, enabled, enabled ? name : settings[source].username);
        username.value = settings[source].username;
        status.textContent = enabled ? `${provider.label} is on. Finish a game to see progress, then its summary.` : `${provider.label} page reviews are off.`;
      } catch {
        status.textContent = 'Could not update page reviews. Reload MeowlChess and try again.';
      } finally { busy = false; render(); }
    });
  }
  if (supported) chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.detectedAccounts) {
      detectedRevision++; detectedAccounts = changes.detectedAccounts.newValue || {};
      for (const source of Object.keys(controls)) prefill(source);
    }
    if (!changes.siteReviewSettings) return;
    settingsRevision++;
    const previous = settings;
    settings = normalizeSiteSettings(changes.siteReviewSettings.newValue);
    for (const [source, { username }] of Object.entries(controls)) {
      if (settings[source].username !== previous[source].username || settings[source].enabled !== previous[source].enabled) {
        username.value = settings[source].username; revisions[source]++; edited.add(source);
      }
    }
    render();
  });
  async function initialize() {
    const revision = settingsRevision;
    const identityRevision = detectedRevision;
    try {
      if (!supported) { status.textContent = 'Page reviews are available in the installed browser extension.'; return; }
      const values = await chrome.storage.local.get(['siteReviewSettings', 'usernames', 'username', 'detectedAccounts']);
      if (identityRevision === detectedRevision) detectedAccounts = values.detectedAccounts || {};
      // Storage events can arrive before an older initialization read resolves.
      if (revision !== settingsRevision) return;
      settings = normalizeSiteSettings(values.siteReviewSettings);
      for (const [source, { username }] of Object.entries(controls)) {
        const hasUsernames = values.usernames && typeof values.usernames === 'object';
        const remembered = hasUsernames ? values.usernames[source] : source === 'chesscom' ? values.username : '';
        const candidate = normalizeSiteSettings({ [source]: { username: remembered } })[source].username;
        const detected = accountUsername(source, detectedAccounts?.[source]?.username);
        const explicitlyEmpty = values.siteReviewSettings?.[source]?.username === '' || (hasUsernames && values.usernames[source] === '') || (!hasUsernames && source === 'chesscom' && values.username === '');
        if (explicitlyEmpty) edited.add(source);
        username.value = settings[source].username || (!explicitlyEmpty && detected) || candidate || '';
      }
    } catch { status.textContent = 'Page review settings could not be loaded. Reload to try again.'; }
    finally { ready = true; render(); }
  }
  void initialize(); render();
  return { setBusy(value) { unavailable = Boolean(value); render(); } };
}
