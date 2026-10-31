import { normalizeSiteSettings, SITE_PROVIDERS } from './site-review.js';

export function createSiteReviewSettings() {
  const status = document.getElementById('site-review-status');
  const supported = Boolean(globalThis.chrome?.permissions?.request && chrome?.storage?.local);
  let settings = normalizeSiteSettings(), ready = false, busy = false, unavailable = true;
  const controls = Object.fromEntries(Object.keys(SITE_PROVIDERS).map(source => [source, {
    toggle: document.getElementById(`site-${source}-enabled`),
    username: document.getElementById(`site-${source}-username`),
  }]));
  function render() {
    for (const [source, { toggle, username }] of Object.entries(controls)) {
      toggle.checked = settings[source].enabled;
      toggle.disabled = !supported || !ready || busy || unavailable;
      username.disabled = toggle.disabled || settings[source].enabled;
      username.title = settings[source].enabled ? 'Turn this site off to change its username.' : '';
    }
  }
  async function persist(source, enabled, username) {
    // Read again so an independently changed provider is not overwritten.
    const latest = normalizeSiteSettings((await chrome.storage.local.get('siteReviewSettings')).siteReviewSettings);
    latest[source] = { enabled, username };
    await chrome.storage.local.set({ siteReviewSettings: latest });
    settings = latest;
    // Saving is complete; do not hold the controls while existing tabs are injected.
    void chrome.runtime.sendMessage({ type: 'meowl:site-settings-changed' }).catch(() => {
      status.textContent = 'Your setting is saved. Reload the chess website to reconnect its panel.';
    });
  }
  for (const [source, { toggle, username }] of Object.entries(controls)) {
    toggle.addEventListener('change', async () => {
      const enabled = toggle.checked;
      const name = username.value.trim().toLowerCase();
      const provider = SITE_PROVIDERS[source];
      if (enabled && !new RegExp(`^[a-z0-9_-]{2,${provider.usernameMax}}$`).test(name)) {
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
        await persist(source, enabled, enabled ? name : settings[source].username);
        username.value = settings[source].username;
        status.textContent = enabled ? `${provider.label} is on. Finish a game to see progress, then its summary.` : `${provider.label} page reviews are off.`;
      } catch {
        status.textContent = 'Could not update page reviews. Reload MeowlChess and try again.';
      } finally { busy = false; render(); }
    });
  }
  async function initialize() {
    try {
      if (!supported) { status.textContent = 'Page reviews are available in the installed browser extension.'; return; }
      const values = await chrome.storage.local.get(['siteReviewSettings', 'usernames', 'username']);
      settings = normalizeSiteSettings(values.siteReviewSettings);
      for (const [source, { username }] of Object.entries(controls)) {
        const hasUsernames = values.usernames && typeof values.usernames === 'object';
        const remembered = hasUsernames ? values.usernames[source] : source === 'chesscom' ? values.username : '';
        const candidate = normalizeSiteSettings({ [source]: { username: remembered } })[source].username;
        // Empty normalized site defaults may use picker history; an empty picker entry stays empty.
        username.value = settings[source].username || candidate;
      }
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.siteReviewSettings) return;
        settings = normalizeSiteSettings(changes.siteReviewSettings.newValue);
        for (const [source, { username }] of Object.entries(controls)) if (settings[source].username) username.value = settings[source].username;
        render();
      });
    } catch { status.textContent = 'Page review settings could not be loaded. Reload to try again.'; }
    finally { ready = true; render(); }
  }
  void initialize(); render();
  return { setBusy(value) { unavailable = Boolean(value); render(); } };
}
