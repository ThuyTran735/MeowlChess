const PROVIDERS = ['chesscom', 'lichess'];
export const ACCOUNT_LIMIT = 10;

/** Only usernames belong in this list; completed-game URLs stay in last-entry preferences. */
export function accountUsername(source, value) {
  if (!PROVIDERS.includes(source) || typeof value !== 'string') return null;
  const username = value.trim();
  const pattern = source === 'lichess' ? /^[a-zA-Z0-9_-]{2,30}$/ : /^[a-zA-Z0-9_-]{2,50}$/;
  return pattern.test(username) ? username : null;
}

/** Return a small, independent list for each provider, newest first. */
export function normalizeAccounts(value) {
  const result = { chesscom: [], lichess: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const source of PROVIDERS) {
    if (!Object.hasOwn(value, source) || !Array.isArray(value[source])) continue;
    const seen = new Set();
    for (const candidate of value[source]) {
      const username = accountUsername(source, candidate);
      if (!username || seen.has(username.toLowerCase())) continue;
      result[source].push(username); seen.add(username.toLowerCase());
      if (result[source].length === ACCOUNT_LIMIT) break;
    }
  }
  return result;
}

export function rememberAccount(value, source, candidate) {
  const result = normalizeAccounts(value), username = accountUsername(source, candidate);
  if (!username) return result;
  result[source] = [username, ...result[source].filter(item => item.toLowerCase() !== username.toLowerCase())].slice(0, ACCOUNT_LIMIT);
  return result;
}

export function forgetAccount(value, source, candidate) {
  const result = normalizeAccounts(value), username = accountUsername(source, candidate);
  if (!username) return result;
  result[source] = result[source].filter(item => item.toLowerCase() !== username.toLowerCase());
  return result;
}
