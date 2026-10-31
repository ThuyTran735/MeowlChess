const PREFERENCE = 'supportNeverShowAgain';
const WEB_PREFERENCE = 'meowlchess.supportNeverShowAgain';

async function readPreference() {
  if (globalThis.chrome?.storage?.local) {
    return (await chrome.storage.local.get(PREFERENCE))[PREFERENCE] === true;
  }
  return localStorage.getItem(WEB_PREFERENCE) === 'true';
}

async function writePreference(value) {
  if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [PREFERENCE]: value });
  else localStorage.setItem(WEB_PREFERENCE, String(value));
}

/** An optional invitation; the repository opens only through the user's link click. */
export function createSupportPrompt({ onSaveError = () => {} } = {}) {
  const dialog = document.getElementById('support-dialog');
  const never = document.getElementById('support-never');
  const status = document.getElementById('support-storage-status');
  let saveQueue = Promise.resolve(), resolveCompletion = null, closing = false, saveError = '';

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  async function dismiss() {
    if (closing || !dialog.open) return;
    closing = true; never.disabled = true;
    await saveQueue;
    dialog.close();
  }

  never.addEventListener('change', () => {
    const choice = never.checked;
    saveQueue = saveQueue.then(async () => {
      try { await writePreference(choice); saveError = ''; showStatus(''); }
      catch {
        saveError = 'Your choice could not be saved. This message may appear again next time.';
        showStatus(saveError);
      }
    });
  });
  document.getElementById('support-skip').addEventListener('click', dismiss);
  // Keep the native link's new-tab behavior and continue onboarding in this tab.
  document.getElementById('support-github').addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); void dismiss(); });
  dialog.addEventListener('close', () => {
    closing = false; never.disabled = false;
    if (saveError) onSaveError(saveError);
    const resolve = resolveCompletion;
    resolveCompletion = null;
    resolve?.();
  });

  return {
    async start({ autoOpen = true } = {}) {
      if (!autoOpen) return;
      try { if (await readPreference()) return; }
      catch { showStatus('Your saved choice could not be read. You can still skip this message.'); }
      const completion = new Promise(resolve => { resolveCompletion = resolve; });
      dialog.showModal();
      document.getElementById('support-title').focus({ preventScroll: true });
      await completion;
    }
  };
}
