// This notice never reloads a page on its own or steals focus from a review.
export function createRefreshMonitor({ runtime, isBusy = () => false, onNotice = () => {}, reload = () => {}, version } = {}) {
  let disposed = false, checking = false, reason = null, shown = false;
  let loadedVersion = version;
  try { loadedVersion ??= runtime?.getManifest?.()?.version; } catch { /* A stale page can fail before its first check. */ }
  const publish = () => {
    if (!disposed && reason && !isBusy()) { shown = true; onNotice(reason); }
  };
  const mark = value => { reason = value; shown = false; publish(); };
  return {
    mark,
    get pending() { return Boolean(reason); },
    async check() {
      if (disposed || checking) return;
      if (reason) { publish(); return; }
      checking = true;
      try {
        if (!runtime?.id) { mark('updated'); return; }
        const reply = await runtime.sendMessage({ type: 'meowl:version' });
        if (reply?.version && loadedVersion && reply.version !== loadedVersion) mark('updated');
      } catch (error) {
        // A background worker waking up can briefly reject a request. Only an
        // invalidated context means the current page itself needs refreshing.
        if (!runtime?.id || /extension context invalidated/i.test(error?.message || '')) mark('updated');
      } finally { checking = false; }
    },
    refresh() {
      if (disposed || !shown || isBusy()) return false;
      reload(); return true;
    },
    destroy() { disposed = true; },
  };
}

export function installRefreshPrompt({ isBusy = () => false, runtime = globalThis.chrome?.runtime,
  storage = globalThis.chrome?.storage, document = globalThis.document, window = globalThis.window } = {}) {
  if (!document || !window || !runtime || (window.location?.protocol !== 'chrome-extension:' && !runtime.id)) return { check() {}, destroy() {} };
  let notice, dismissed = false, recheck;
  const monitor = createRefreshMonitor({ runtime, isBusy, reload: () => window.location.reload(), onNotice(reason) {
    if (dismissed) return;
    if (!notice) {
      notice = document.createElement('aside'); notice.id = 'MeowlChess-refresh-notice';
      notice.setAttribute('aria-label', 'MeowlChess refresh notice');
      notice.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:1000;box-sizing:border-box;width:min(560px,calc(100% - 24px));border:1px solid #64735b;border-radius:12px;padding:14px 16px;background:#252b23;color:#f1f2ec;box-shadow:0 8px 32px #0006;font:14px/1.5 system-ui,sans-serif;';
      const text = document.createElement('p'); text.dataset.message = ''; text.setAttribute('role', 'status'); text.style.cssText = 'margin:0 0 10px';
      const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
      const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh review';
      refresh.style.cssText = 'background:#a8bd94;color:#20291c;border:0;border-radius:7px;padding:8px 12px;font:600 13px system-ui;cursor:pointer';
      refresh.addEventListener('click', () => {
        if (!monitor.refresh()) text.textContent = 'Finish the current review or import first, then refresh this tab.';
      });
      const later = document.createElement('button'); later.type = 'button'; later.textContent = 'Later';
      later.style.cssText = 'background:transparent;color:inherit;border:1px solid #77836e;border-radius:7px;padding:8px 12px;font:13px system-ui;cursor:pointer';
      later.addEventListener('click', () => { dismissed = true; notice.remove(); notice = null; });
      actions.append(refresh, later); notice.append(text, actions); document.body.append(notice);
    }
    notice.querySelector('[data-message]').textContent = reason === 'restored'
      ? 'Backup restored. Refresh this review tab to load your preferences.'
      : 'MeowlChess was updated or reloaded. Refresh this tab when you’re ready to reconnect. Saved reviews are kept.';
  } });
  const check = () => {
    clearTimeout(recheck);
    if (document.hidden) return;
    void monitor.check().finally(() => { if (monitor.pending && isBusy()) recheck = setTimeout(check, 2000); });
    // Only a deferred local notice is retried; ordinary version checks happen
    // on focus, visibility, or an explicit caller request, not on a timer.
  };
  const changed = (changes, area) => {
    if (area !== 'local' || !changes.backupRestoredAt?.newValue) return;
    dismissed = false; monitor.mark('restored');
    check();
  };
  const onFocus = check;
  window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
  storage?.onChanged?.addListener(changed);
  const destroy = () => { clearTimeout(recheck); monitor.destroy(); notice?.remove(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); storage?.onChanged?.removeListener(changed); window.removeEventListener('pagehide', destroy); };
  window.addEventListener('pagehide', destroy, { once: true });
  check();
  return { check, destroy };
}
