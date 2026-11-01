export const COMPLETION_ALERTS_KEY = 'completionAlerts';

// Called directly from the setting's change event so the optional permission
// request retains the user's gesture. No permission prompt occurs at startup.
export async function installCompletionAlertSetting(checkbox, status, { api = globalThis.chrome } = {}) {
  let pending = false, destroyed = false;
  const enabled = async () => {
    const values = await api.storage.local.get(COMPLETION_ALERTS_KEY);
    return values[COMPLETION_ALERTS_KEY] === true && await api.permissions.contains({ permissions: ['notifications'] });
  };
  const sync = async () => {
    try { const value = await enabled(); if (!destroyed && !pending) checkbox.checked = value; }
    catch { if (!destroyed && !pending) checkbox.checked = false; }
  };
  const change = async () => {
    if (pending || destroyed) return;
    const wanted = checkbox.checked;
    pending = true; checkbox.disabled = true; status.textContent = '';
    try {
      const granted = !wanted || await api.permissions.request({ permissions: ['notifications'] });
      if (destroyed) return;
      const value = wanted && granted;
      await api.storage.local.set({ [COMPLETION_ALERTS_KEY]: value });
      checkbox.checked = value;
      status.textContent = wanted && !granted ? 'Notifications were not allowed. You can enable them here later.'
        : value ? 'Alerts are on for reviews that finish while you are in another tab.' : 'Completion alerts are off.';
    } catch {
      if (!destroyed) { checkbox.checked = false; status.textContent = 'Could not update completion alerts. Please try again.'; }
    } finally {
      pending = false;
      if (!destroyed) { checkbox.disabled = false; await sync(); }
    }
  };
  const storageChanged = (changes, area) => { if (area === 'local' && changes[COMPLETION_ALERTS_KEY]) void sync(); };
  const permissionsChanged = () => { void sync(); };
  checkbox.disabled = true;
  if (!api?.permissions?.request || !api?.storage?.local) {
    checkbox.checked = false; status.textContent = 'Completion alerts are unavailable in this browser.';
    return () => {};
  }
  await sync();
  checkbox.disabled = false;
  checkbox.addEventListener('change', change);
  api.storage.onChanged.addListener(storageChanged);
  api.permissions.onRemoved.addListener(permissionsChanged);
  return () => {
    destroyed = true; checkbox.removeEventListener('change', change);
    api.storage.onChanged.removeListener(storageChanged);
    api.permissions.onRemoved.removeListener(permissionsChanged);
  };
}

// Call only after a newly completed analysis has been saved successfully.
// Reopening a saved review and failed/canceled work never call this helper.
export async function notifyReviewComplete(record, { token, api = globalThis.chrome, hidden = globalThis.document?.hidden === true } = {}) {
  if (!hidden || !record || !/^game-[a-f0-9]{64}$/.test(record.id || '') || !Number.isFinite(record.updatedAt)) return { status: 'skipped' };
  try {
    return await api.runtime.sendMessage({ type: 'meowl:review-completed', reviewId: record.id, updatedAt: record.updatedAt, away: true, ...(token ? { token } : {}) });
  } catch { return { status: 'unavailable' }; }
}
