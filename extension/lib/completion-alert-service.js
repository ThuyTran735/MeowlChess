const ID = /^game-[a-f0-9]{64}$/;
const PREFIX = 'meowl-review-';
const MAX_HISTORY = 100;
const FRESH_FOR = 10 * 60 * 1000;
const validRevision = value => Number.isSafeInteger(value) && value > 0;
const name = value => typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) : '';

// The browser adapter supplies authenticated records, notification permission,
// and storage. Keeping this boundary pure makes denial and races testable.
export function createCompletionAlertService({ authorize, loadReview, enabled, away = async () => true,
  create, clear, openReview, readHistory = async () => [], writeHistory = async () => {}, now = Date.now }) {
  let history, tail = Promise.resolve();
  const serial = operation => {
    const work = tail.catch(() => {}).then(operation);
    tail = work.catch(() => {});
    return work;
  };
  async function entries() {
    if (!history) {
      let raw; try { raw = await readHistory(); } catch { raw = []; }
      history = new Map((Array.isArray(raw) ? raw : []).filter(item => Array.isArray(item) && ID.test(item[0]) && validRevision(item[1])).slice(-MAX_HISTORY));
    }
    return history;
  }
  return {
    complete(message, sender) {
      return serial(async () => {
        if (message?.type !== 'meowl:review-completed' || message.away !== true || !ID.test(message.reviewId || '') || !validRevision(message.updatedAt)) return { status: 'skipped' };
        if (!await enabled()) return { status: 'disabled' };
        const record = await authorize(message, sender);
        if (!record || record.stale || record.id !== message.reviewId || record.updatedAt !== message.updatedAt || now() - record.updatedAt > FRESH_FOR || record.updatedAt > now() + 1000) return { status: 'skipped' };
        const sent = await entries();
        if ((sent.get(record.id) || 0) >= record.updatedAt) return { status: 'duplicate' };
        if (!await away(sender) || !await enabled()) return { status: 'skipped' };
        const white = name(record.game?.white?.username), black = name(record.game?.black?.username);
        await create(PREFIX + record.id, {
          type: 'basic', iconUrl: 'icons/icon128.png', title: 'Your MeowlChess review is ready',
          message: `${white || 'White'} vs ${black || 'Black'}\nOpen your saved game review.`,
          priority: 0, silent: true,
        });
        sent.delete(record.id); sent.set(record.id, record.updatedAt);
        while (sent.size > MAX_HISTORY) sent.delete(sent.keys().next().value);
        try { await writeHistory([...sent]); } catch { /* In-memory deduplication still protects this worker. */ }
        return { status: 'notified' };
      });
    },
    click(notificationId) {
      return serial(async () => {
        const id = typeof notificationId === 'string' && notificationId.startsWith(PREFIX) ? notificationId.slice(PREFIX.length) : '';
        if (!ID.test(id) || !(await entries()).has(id) || !await enabled()) return { status: 'skipped' };
        let record; try { record = await loadReview(id); } catch { record = null; }
        if (!record || record.id !== id) { await clear(notificationId); return { status: 'missing' }; }
        await openReview(id); await clear(notificationId);
        return { status: 'opened' };
      });
    },
  };
}
