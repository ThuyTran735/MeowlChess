import { UPDATE_PERMISSION, RELEASES_URL } from './lib/updates.js';
import { createBackup, inspectBackup, restoreBackup, BACKUP_MAX_BYTES } from './lib/backup.js';
import { createReviewLibrary } from './lib/library.js';
import { ANALYSIS_VERSION } from './lib/review.js';
const $ = id => document.getElementById(id);
const runtime = globalThis.chrome?.runtime, storage = globalThis.chrome?.storage?.local;
const library = createReviewLibrary({ analysisVersion: ANALYSIS_VERSION });
let working = false, checking = false, inspected = null, updateInfo;
const currentVersion = runtime?.getManifest?.().version || '';
const storeInstalled = !!runtime?.getManifest?.().update_url;
$('current-version').textContent = currentVersion ? `v${currentVersion}` : 'Preview';
if (storeInstalled) {
  $('guide-heading').textContent = 'Your browser handles updates';
  $('install-kind').textContent = 'Updates arrive through the store after publication. Finish your reviews and close MeowlChess tabs when convenient so a downloaded update can apply, or restart the browser. Keep MeowlChess installed to preserve saved data.';
  $('manual-guide').hidden = true;
}
const send = message => runtime.sendMessage(message);
function renderUpdate(info) {
  updateInfo = info;
  $('automatic-updates').checked = info.automatic === true;
  $('release-link').href = info.release?.releaseUrl || RELEASES_URL;
  $('download-update').hidden = !info.available || storeInstalled;
  if (info.available) $('download-update').href = info.release.downloadUrl;
  $('release-details').hidden = !info.release?.notes;
  $('release-notes').textContent = info.release?.notes || '';
  $('last-checked').textContent = info.checkedAt ? `Last successful check: ${new Date(info.checkedAt).toLocaleString()}` : '';
  if (info.available) {
    $('update-heading').textContent = `v${info.release.version} is available`;
    $('update-status').textContent = info.error ? `${info.error} The last known release is listed below.` : storeInstalled ? 'A newer GitHub release exists. Store availability can follow later; your browser will handle its installation.' : 'Download the new version, then follow the guide below. Your saved data stays in place.';
  } else if (info.error) { $('update-heading').textContent = 'Check again later'; $('update-status').textContent = info.error; }
  else if (info.checkedAt) { $('update-heading').textContent = 'You’re up to date'; $('update-status').textContent = 'No newer stable release was found at the last check.'; }
  else { $('update-heading').textContent = 'Ready when you are'; $('update-status').textContent = 'Choose Check now to look for the latest release on GitHub.'; }
  if (info.status === 'cached' && info.retryAt > Date.now()) $('update-status').textContent += ` You can check again after ${new Date(info.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
}
async function checkUpdate() {
  if (checking) return;
  checking = true; $('check-update').disabled = true; $('automatic-updates').disabled = true;
  try {
    // Request from the click event so Chrome can show its optional access prompt.
    const granted = await chrome.permissions.request(UPDATE_PERMISSION);
    if (!granted) { $('update-status').textContent = 'GitHub access was not enabled. You can still open Release notes and download manually.'; return; }
    $('update-status').textContent = 'Checking the latest release…';
    renderUpdate(await send({ type: 'meowl:update-check', manual: true }));
  } catch { $('update-status').textContent = 'Could not check for updates. Reopen this page or use Release notes.'; }
  finally { checking = false; $('check-update').disabled = false; $('automatic-updates').disabled = false; }
}
$('check-update').addEventListener('click', checkUpdate);
$('automatic-updates').addEventListener('change', async () => {
  const enabled = $('automatic-updates').checked; $('automatic-updates').disabled = true;
  try {
    if (enabled && !await chrome.permissions.request(UPDATE_PERMISSION)) { $('automatic-updates').checked = false; $('update-status').textContent = 'Automatic checks stay off without GitHub access.'; return; }
    renderUpdate(await send({ type: 'meowl:update-preference', enabled }));
    if (enabled) renderUpdate(await send({ type: 'meowl:update-check' }));
  } catch { $('automatic-updates').checked = updateInfo?.automatic === true; $('update-status').textContent = 'Could not save this choice. Try reopening this page.'; }
  finally { $('automatic-updates').disabled = false; }
});
function busy(value) {
  working = value; document.body.dataset.working = String(value);
  for (const id of ['export-backup', 'choose-backup', 'guide-backup', 'confirm-restore', 'cancel-restore']) $(id).disabled = value;
}
function saveFile(contents, name) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function downloadBackup() {
  if (working) return;
  busy(true); $('backup-status').textContent = 'Preparing your backup…';
  try {
    const backup = await createBackup({ storage, library, extensionVersion: currentVersion });
    saveFile(JSON.stringify(backup), `MeowlChess-backup-${new Date().toISOString().slice(0, 10)}.json`);
    $('backup-status').textContent = 'Backup download started. Keep the file somewhere safe; it contains your saved games and usernames.';
  } catch (error) { $('backup-status').textContent = error.message || 'Could not create a backup. Your saved data has not changed.'; }
  finally { busy(false); }
}
$('export-backup').addEventListener('click', downloadBackup); $('guide-backup').addEventListener('click', downloadBackup);
$('choose-backup').addEventListener('click', () => { if (!working) $('backup-file').click(); });
$('backup-file').addEventListener('change', async () => {
  const file = $('backup-file').files[0]; $('backup-file').value = ''; if (!file || working) return;
  busy(true); inspected = null; $('backup-status').textContent = 'Reading backup…';
  try {
    if (file.size > BACKUP_MAX_BYTES) throw new Error('This backup is too large to restore.');
    inspected = await inspectBackup(await file.text());
    const summary = inspected.summary;
    $('restore-summary').textContent = `${summary.reviews} saved reviews · ${summary.bookmarks} bookmarks · ${summary.coachGames} games toward coach unlocks`;
    $('restore-origin').textContent = `Created ${new Date(summary.createdAt).toLocaleString()} with MeowlChess v${summary.extensionVersion}.`;
    $('restore-settings').checked = true; $('restore-status').textContent = '';
    $('backup-status').textContent = 'Backup ready. Review the details before restoring.';
    $('restore-dialog').showModal();
  } catch (error) { $('backup-status').textContent = error.message || 'This backup could not be read. Your saved data has not changed.'; }
  finally { busy(false); }
});
$('cancel-restore').addEventListener('click', () => { if (!working) { inspected = null; $('restore-dialog').close(); } });
$('restore-dialog').addEventListener('cancel', event => { if (working) event.preventDefault(); else inspected = null; });
$('confirm-restore').addEventListener('click', async () => {
  if (working || !inspected) return;
  busy(true); $('restore-status').textContent = 'Restoring your saved data…';
  try {
    const result = await restoreBackup(inspected.backup, { storage, library, restoreSettings: $('restore-settings').checked, hasPermission: descriptor => chrome.permissions.contains(descriptor) });
    const warnings = result.warnings || [];
    try { await storage.set({ backupRestoredAt: Date.now() }); } catch { warnings.push('Refresh other MeowlChess tabs to load restored preferences.'); }
    $('backup-status').textContent = `Restored ${result.added} reviews; kept ${result.kept} existing reviews. ${warnings.join(' ')} Refresh other MeowlChess tabs when you are ready.`;
    inspected = null; $('restore-dialog').close();
    void send({ type: 'meowl:update-state' }).then(renderUpdate).catch(() => {});
  } catch (error) { $('restore-status').textContent = error.message || 'Could not restore this backup. Please try again.'; }
  finally { busy(false); }
});
const addresses = { brave: 'brave://extensions', chrome: 'chrome://extensions', edge: 'edge://extensions' };
if (/Edg\//.test(navigator.userAgent)) $('browser').value = 'edge';
else if (!navigator.brave) $('browser').value = 'chrome';
function address() { $('extensions-address').textContent = addresses[$('browser').value]; }
$('browser').addEventListener('change', address); address();
$('copy-address').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(addresses[$('browser').value]); $('copy-status').textContent = 'Copied. Paste it into your browser’s address bar.'; }
  catch { $('copy-status').textContent = `Select and copy ${addresses[$('browser').value]}, then paste it into the address bar.`; }
});
window.addEventListener('beforeunload', event => { if (working) { event.preventDefault(); event.returnValue = ''; } });
if (runtime?.sendMessage && storage) {
  send({ type: 'meowl:update-check' }).then(renderUpdate).catch(() => { $('update-status').textContent = 'Reopen this page after reloading MeowlChess.'; });
} else {
  for (const id of ['check-update', 'automatic-updates', 'export-backup', 'choose-backup', 'guide-backup']) $(id).disabled = true;
  $('backup-status').textContent = 'Open this screen from your installed MeowlChess extension.';
}
