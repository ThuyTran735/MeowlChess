export function installUpdateNotice({ root = document, runtime = globalThis.chrome?.runtime, storage = globalThis.chrome?.storage, isBusy = () => false } = {}) {
  if (!runtime?.sendMessage) return;
  const banner = root.createElement('aside'); banner.className = 'update-notice'; banner.hidden = true; banner.setAttribute('aria-label', 'MeowlChess update');
  const text = root.createElement('span'), link = root.createElement('a'), close = root.createElement('button');
  link.href = 'updates.html'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'View update';
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss update notice');
  banner.append(text, link, close); root.querySelector('.topbar')?.after(banner);
  let info, dismissed = '', timer;
  function render() {
    clearTimeout(timer);
    if (!info?.available || dismissed === info.release.version) { banner.hidden = true; return; }
    if (isBusy()) { banner.hidden = true; timer = setTimeout(render, 2000); return; }
    text.textContent = `MeowlChess v${info.release.version} is available.`; banner.hidden = false;
  }
  close.addEventListener('click', () => {
    dismissed = info?.release?.version; banner.hidden = true;
    void storage?.local?.set({ updateDismissedVersion: dismissed }).catch(() => {});
  });
  async function refresh(check = false) {
    try {
      dismissed = (await storage?.local?.get('updateDismissedVersion'))?.updateDismissedVersion || dismissed;
      info = await runtime.sendMessage({ type: check ? 'meowl:update-check' : 'meowl:update-state' }); render();
    } catch { /* Refresh prompts handle an outdated extension context. */ }
  }
  storage?.onChanged?.addListener((changes, area) => { if (area === 'local' && (changes.updateCheckState || changes.updatePreferences || changes.updateDismissedVersion)) void refresh(); });
  root.defaultView?.addEventListener('focus', () => { void refresh(true); });
  void refresh(true);
}
