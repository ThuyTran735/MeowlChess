import { validateLibraryBackupData } from './library.js';
import { normalizeAccounts, accountUsername } from './accounts.js';
import { normalizeSiteSettings, SITE_PROVIDERS } from './site-review.js';
import { COACHES } from './coach-personalities.js';

export const BACKUP_FORMAT = 'MeowlChess-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 42 * 1024 * 1024;
const SETTINGS_MAX_BYTES = 64 * 1024;
export const BACKUP_SETTING_KEYS = Object.freeze([
  'reviewSettings', 'username', 'usernames', 'savedAccounts', 'siteReviewSettings', 'completionAlerts',
  'coachPreferences', 'tutorialNeverShowAgain', 'supportNeverShowAgain', 'shareHidePlayerNames', 'updatePreferences',
  ...['chesscom', 'lichess'].flatMap(source => [`siteReviewPanelPosition:${source}`, `siteReviewPanelSize:${source}`]),
]);
const encoder = new TextEncoder();
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const string = (value, limit) => typeof value === 'string' && value.length <= limit;
const boolean = value => typeof value === 'boolean';
const choice = choices => value => choices.includes(value);
const preferenceLocks = ['meowlchess-review-preferences', 'meowlchess-username-preferences', 'meowlchess-saved-accounts', 'meowlchess-site-settings', 'MeowlChess-coach-preferences'];

export class BackupError extends Error {
  constructor(code, message, cause) { super(message, cause ? { cause } : undefined); this.name = 'BackupError'; this.code = code; }
}
function invalid(message = 'This is not a supported MeowlChess backup. Nothing was restored.') { throw new BackupError('invalid', message); }
function jsonSize(value) {
  try { return encoder.encode(JSON.stringify(value)).byteLength; }
  catch { invalid('This backup contains invalid data. Nothing was restored.'); }
}
function fields(value, rules) {
  if (!plain(value)) invalid('This backup contains invalid preferences. Nothing was restored.');
  const result = {};
  for (const [key, valid] of Object.entries(rules)) if (own(value, key)) {
    if (!valid(value[key])) invalid('This backup contains invalid preferences. Nothing was restored.');
    result[key] = value[key];
  }
  return result;
}

/** Only user preferences belong here; never include tokens, sessions, or update caches. */
export function normalizeBackupSettings(raw) {
  if (!plain(raw) || jsonSize(raw) > SETTINGS_MAX_BYTES) invalid('The backup preferences are invalid or too large. Nothing was restored.');
  const result = {};
  const rules = {
    smart: boolean, highlights: boolean, autoOrient: boolean, arrows: boolean, badges: boolean, coordinates: boolean, moveSounds: boolean,
    arrowMode: choice(['best', 'all']), engine: choice(['stockfish', 'lozza']), source: choice(['chesscom', 'lichess']),
    time: choice(['50', '150', '500', '1500', '3000']), lines: choice(['1', '2', '3']), playback: choice(['700', '1200', '2000']),
    boardSize: value => value === 'auto' || Number.isInteger(value) && finite(value, 320, 880),
  };
  if (own(raw, 'reviewSettings')) result.reviewSettings = fields(raw.reviewSettings, rules);
  if (own(raw, 'username')) {
    if (!string(raw.username, 8192)) invalid();
    result.username = raw.username;
  }
  if (own(raw, 'usernames')) result.usernames = fields(raw.usernames, { chesscom: value => string(value, 8192), lichess: value => string(value, 8192) });
  if (own(raw, 'savedAccounts')) {
    if (!plain(raw.savedAccounts)) invalid();
    for (const source of ['chesscom', 'lichess']) if (own(raw.savedAccounts, source)) {
      if (!Array.isArray(raw.savedAccounts[source]) || raw.savedAccounts[source].length > 10
          || raw.savedAccounts[source].some(value => !accountUsername(source, value))) invalid();
    }
    result.savedAccounts = normalizeAccounts(raw.savedAccounts);
  }
  if (own(raw, 'siteReviewSettings')) {
    if (!plain(raw.siteReviewSettings)) invalid();
    for (const source of ['chesscom', 'lichess']) if (own(raw.siteReviewSettings, source)) {
      fields(raw.siteReviewSettings[source], { enabled: boolean, username: value => string(value, SITE_PROVIDERS[source].usernameMax) && (!value || accountUsername(source, value)) });
    }
    result.siteReviewSettings = normalizeSiteSettings(raw.siteReviewSettings);
  }
  if (own(raw, 'coachPreferences')) result.coachPreferences = fields(raw.coachPreferences, {
    coach: choice(COACHES.map(coach => coach.id)), perspective: choice(['w', 'b', 'both']), motion: boolean,
    sounds: boolean, volume: value => finite(value, 0, 1), commentary: boolean,
  });
  if (own(raw, 'updatePreferences')) result.updatePreferences = fields(raw.updatePreferences, { automatic: boolean });
  for (const key of ['completionAlerts', 'tutorialNeverShowAgain', 'supportNeverShowAgain', 'shareHidePlayerNames']) if (own(raw, key)) {
    if (!boolean(raw[key])) invalid();
    result[key] = raw[key];
  }
  for (const source of ['chesscom', 'lichess']) {
    const positionKey = `siteReviewPanelPosition:${source}`, sizeKey = `siteReviewPanelSize:${source}`;
    if (own(raw, positionKey)) {
      result[positionKey] = fields(raw[positionKey], { left: value => finite(value, -999999, 999999), top: value => finite(value, -999999, 999999) });
      if (Object.keys(result[positionKey]).length !== 2) invalid();
    }
    if (own(raw, sizeKey)) {
      result[sizeKey] = fields(raw[sizeKey], { width: value => finite(value, 1, 999999), height: value => finite(value, 1, 999999) });
      if (Object.keys(result[sizeKey]).length !== 2) invalid();
    }
  }
  return result;
}

async function validateBackup(value) {
  if (!plain(value) || value.format !== BACKUP_FORMAT || value.schemaVersion !== BACKUP_VERSION
      || !Number.isSafeInteger(value.createdAt) || value.createdAt < 1
      || !string(value.extensionVersion, 40) || !/^\d+(?:\.\d+){2,3}$/.test(value.extensionVersion)
      || jsonSize(value) > BACKUP_MAX_BYTES) invalid();
  const settings = normalizeBackupSettings(value.settings);
  const library = await validateLibraryBackupData(value.library);
  return { format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, createdAt: value.createdAt, extensionVersion: value.extensionVersion, settings, library };
}

export async function createBackup({ storage = globalThis.chrome?.storage?.local, library, extensionVersion = globalThis.chrome?.runtime?.getManifest?.().version, now = () => Date.now() } = {}) {
  if (!storage?.get || !library?.exportBackupData) throw new BackupError('unavailable', 'Backup is unavailable in this browser. Your saved data has not changed.');
  const [stored, data] = await Promise.all([storage.get(BACKUP_SETTING_KEYS), library.exportBackupData()]);
  // Both readers return copies. No migration or settings write is needed to export.
  return validateBackup({ format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, createdAt: now(), extensionVersion, settings: normalizeBackupSettings(stored), library: data });
}

export async function inspectBackup(text) {
  if (typeof text !== 'string' || text.length > BACKUP_MAX_BYTES || encoder.encode(text).byteLength > BACKUP_MAX_BYTES) {
    throw new BackupError('too-large', 'Choose a MeowlChess backup smaller than 42 MiB. Nothing was restored.');
  }
  let value;
  try { value = JSON.parse(text); } catch { invalid('This file is not valid backup JSON. Nothing was restored.'); }
  const backup = await validateBackup(value);
  return { backup, summary: {
    reviews: backup.library.reviews.length,
    bookmarks: backup.library.reviews.reduce((count, record) => count + record.bookmarks.length, 0),
    settings: Object.keys(backup.settings).length,
    coachGames: backup.library.coachProgress.gameKeys.length,
    createdAt: backup.createdAt, extensionVersion: backup.extensionVersion,
  } };
}

async function prepareSettings(incoming, stored, hasPermission) {
  const values = structuredClone(incoming), disabledSites = [];
  if (values.usernames) values.usernames = { ...fields(plain(stored.usernames) ? stored.usernames : {}, { chesscom: value => string(value, 8192), lichess: value => string(value, 8192) }), ...values.usernames };
  if (values.savedAccounts) {
    const previous = normalizeAccounts(stored.savedAccounts);
    values.savedAccounts = normalizeAccounts(Object.fromEntries(['chesscom', 'lichess'].map(source => [source, [...values.savedAccounts[source], ...previous[source]]])));
  }
  const allowed = async descriptor => { try { return await hasPermission(descriptor) === true; } catch { return false; } };
  if (values.siteReviewSettings) for (const [source, settings] of Object.entries(values.siteReviewSettings)) {
    if (settings.enabled && !await allowed({ permissions: ['scripting'], origins: SITE_PROVIDERS[source].origins })) {
      settings.enabled = false; disabledSites.push(source);
    }
  }
  const needsNotificationPermission = values.completionAlerts === true && !await allowed({ permissions: ['notifications'] });
  if (needsNotificationPermission) values.completionAlerts = false;
  const needsUpdatePermission = values.updatePreferences?.automatic === true && !await allowed({ origins: ['https://api.github.com/*'] });
  if (needsUpdatePermission) values.updatePreferences.automatic = false;
  return { values, disabledSites, needsNotificationPermission, needsUpdatePermission };
}

/** Review/milestone merge is atomic. Preferences use a separate browser storage API. */
export async function restoreBackup(input, { storage = globalThis.chrome?.storage?.local, library, hasPermission = () => false, restoreSettings = true, locks = globalThis.navigator?.locks } = {}) {
  const backup = await validateBackup(input);
  if (!library?.mergeBackupData || restoreSettings && (!storage?.get || !storage?.set)) {
    throw new BackupError('unavailable', 'Restore is unavailable in this browser. Nothing was restored.');
  }
  const run = async () => {
    const prepared = restoreSettings ? await prepareSettings(backup.settings, await storage.get(BACKUP_SETTING_KEYS), hasPermission)
      : { values: {}, disabledSites: [], needsNotificationPermission: false, needsUpdatePermission: false };
    const merged = await library.mergeBackupData(backup.library);
    const result = { ...merged, settingsRestored: false, settingsCount: Object.keys(prepared.values).length,
      disabledSites: prepared.disabledSites, needsNotificationPermission: prepared.needsNotificationPermission,
      needsUpdatePermission: prepared.needsUpdatePermission, warnings: [] };
    if (restoreSettings) {
      try {
        if (result.settingsCount) await storage.set(prepared.values);
        result.settingsRestored = true;
        if (prepared.disabledSites.length) result.warnings.push('On-site reviews remain off where browser permission is missing. Enable them in Settings when ready.');
        if (prepared.needsNotificationPermission) result.warnings.push('Completion alerts remain off until you enable their browser permission in Settings.');
        if (prepared.needsUpdatePermission) result.warnings.push('Automatic update checks remain off until you enable GitHub access in Updates.');
      } catch {
        result.warnings.push('Your reviews, bookmarks, and coach progress were restored, but preferences could not be saved. Retry this backup to finish; duplicate reviews will be kept.');
      }
    }
    return result;
  };
  // Share the settings writers' locks so a restore cannot overwrite a queued edit.
  const locked = index => locks?.request && restoreSettings && index < preferenceLocks.length
    ? locks.request(preferenceLocks[index], () => locked(index + 1)) : run();
  return locked(0);
}
