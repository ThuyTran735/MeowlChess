(() => {
  if (globalThis.__meowlChessBot) return;
  const finalResult = /(?:^|\s)(1-0|0-1|1\/2-1\/2)\s*$/;
  const visible = element => {
    const rect = element?.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0) && getComputedStyle(element).visibility !== 'hidden';
  };
  function isPage() {
    return ['www.chess.com', 'chess.com'].includes(location.hostname) && location.protocol === 'https:'
      && (/^\/play\/computer(?:\/|$)/.test(location.pathname) || /^\/(?:analysis\/)?game\/computer\/[^/]+\/?$/.test(location.pathname));
  }
  function isGamePage() {
    const path = location.pathname.replace(/^(\/analysis\/game\/(?:(?:live|daily)\/)?\d+)\/review\/?$/, '$1');
    return ['www.chess.com', 'chess.com'].includes(location.hostname) && location.protocol === 'https:'
      && /^\/(?:analysis\/)?game\/(?:(?:live|daily)\/)?\d+\/?$/.test(path);
  }
  function exportReason(pgn) {
    const tag = /\s*\[\s*([A-Za-z]+)\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\]/y;
    let match;
    while ((match = tag.exec(pgn))) {
      if (match[1] === 'Termination' && /^Game aborted$/i.test(match[2].trim())) return 'aborted';
    }
    return null;
  }
  function inspectExportFor(eligible) {
    if (!eligible()) return { pgn: null, reason: 'pgn' };
    // Read Chess.com's own export, never infer a starting position from board pieces
    // or reconstruct a partial/virtualized move list. PGN preserves promotions and FEN.
    const fields = document.querySelectorAll('.share-menu-tab-pgn-component textarea, textarea[name="pgn"][aria-label="PGN"], textarea.share-menu-tab-pgn-textarea');
    let reason = 'pgn';
    for (const field of fields) {
      if (!visible(field) || typeof field.value !== 'string' || field.value.length > 250000) continue;
      const pgn = field.value.trim();
      if (pgn) reason = 'unfinished';
      const ending = pgn.replace(/\{[^}]*\}/g, '').replace(/;[^\n]*/g, '').trim().match(finalResult)?.[1];
      if (ending && new RegExp('\\[Result\\s+"' + ending.replaceAll('/', '\\/') + '"\\s*\\]').test(pgn)) return { pgn, reason: exportReason(pgn) };
    }
    return { pgn: null, reason };
  }
  function readExportFor(eligible) {
    return inspectExportFor(eligible).pgn;
  }
  async function requestExportFor(eligible, isActive = () => true, { onAttempt, onOutcome } = {}) {
    const finish = (status, reason = null, pgn = null) => {
      onOutcome?.({ status, reason });
      return pgn;
    };
    const originalPage = location.origin + location.pathname;
    const active = () => eligible() && isActive() && originalPage === location.origin + location.pathname;
    if (!active()) return finish('canceled');
    const ready = inspectExportFor(eligible); if (ready.pgn) return finish('ready', ready.reason, ready.pgn);
    // #share-modal itself is a permanent (usually empty) mount point, not an
    // open dialog. Treating it as the modal would prevent the export click.
    const shareModal = () => document.querySelector('.share-menu-modal-header')?.closest('dialog')
      || document.querySelector('dialog#share-modal, #share-modal dialog');
    const currentModal = shareModal();
    const alreadyOpen = visible(currentModal);
    if (!alreadyOpen) {
      // Use the site's normal Share control, never a private endpoint or page global.
      // Download opens the Share dialog on its PGN tab; it does
      // not download a file. Share is the fallback when that icon is unavailable.
      const usable = element => visible(element) && !element.disabled;
      const share = [...document.querySelectorAll('.small-controls-leftIcons button[aria-label="Download"]')].find(usable)
        || [...document.querySelectorAll('.small-controls-leftIcons button[aria-label="Share"]')].find(usable);
      if (!share) return finish('unavailable', 'controls');
      share.click();
      // Missing controls are not an attempted dialog. Let the caller retain
      // its retry budget until Chess.com has actually accepted an opening click.
      onAttempt?.();
    }
    // Share and its PGN tab can load separately on a cold page. Give the whole
    // read one bounded window, independent of wall-clock changes.
    const deadline = performance.now() + 30000;
    let selected = false, openedModal = null, lastExportReason = 'pgn';
    try {
      while (performance.now() < deadline && active()) {
        const modal = shareModal();
        if (visible(modal)) {
          openedModal ||= modal;
          const exported = inspectExportFor(eligible);
          if (exported.pgn) return finish('ready', exported.reason, exported.pgn);
          lastExportReason = exported.reason;
          const tab = modal.querySelector('button#tab-pgn, button[aria-controls="tabpanel-pgn"]');
          if (!selected && visible(tab) && !tab.disabled) { tab.click(); selected = true; }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return active() ? finish('timeout', openedModal ? lastExportReason : 'modal') : finish('canceled');
    } finally {
      // A timeout or canceled review must not strand our native modal above the
      // board. A dialog that the user already had open belongs to the user.
      // Before a dialog has been observed, a new route may already own a
      // different Share dialog. Do not mistake that destination for our export.
      const ownedModal = openedModal || (originalPage === location.origin + location.pathname ? shareModal() : null);
      if (!alreadyOpen && visible(ownedModal) && ownedModal === shareModal()) {
        const close = ownedModal.querySelector('.share-menu-modal-header .cc-modal-header-close');
        if (visible(close)) close.click();
      }
    }
  }
  function createImport({ submit, getExport }) {
    const box = document.createElement('div'); box.className = 'waiting bot-import';
    const title = document.createElement('h2'); title.className = 'loading-stage'; title.textContent = 'Finding game';
    const detail = document.createElement('small');
    detail.textContent = 'Bot games are private. Open Share → PGN on Chess.com to review the finished game here.';
    const read = document.createElement('button'); read.type = 'button'; read.className = 'bot-action'; read.textContent = 'Get finished game';
    const feedback = document.createElement('p'); feedback.className = 'bot-feedback'; feedback.setAttribute('role', 'status');
    const more = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Use a PGN file or paste';
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.pgn,.txt'; file.setAttribute('aria-label', 'Choose a finished bot game PGN');
    const text = document.createElement('textarea'); text.maxLength = 250000; text.rows = 4; text.placeholder = 'Paste the finished game PGN'; text.setAttribute('aria-label', 'Finished bot game PGN'); text.spellcheck = false;
    const review = document.createElement('button'); review.type = 'button'; review.className = 'bot-action'; review.textContent = 'Review PGN';
    const pending = value => { read.disabled = file.disabled = text.disabled = review.disabled = value; };
    async function run(getPgn) {
      pending(true); feedback.textContent = '';
      try {
        const pgn = await getPgn();
        if (pgn) await submit(pgn);
        else feedback.textContent = 'Finish the game, then open Share → PGN. You can also choose or paste its exported PGN below.';
      } catch (error) { feedback.textContent = error?.message || 'Could not read this game. Try its PGN export.'; }
      finally { pending(false); }
    }
    read.addEventListener('click', () => { void run(getExport); });
    review.addEventListener('click', () => { void run(() => text.value); });
    file.addEventListener('change', () => {
      const selected = file.files?.[0]; if (!selected) return;
      void run(async () => {
        if (selected.size > 250000) throw new Error('Choose one finished game PGN up to 250 KB.');
        return selected.text();
      });
    });
    more.append(summary, file, text, review); box.append(title, detail, read, more, feedback);
    return { element: box, feedback: message => { feedback.textContent = message; } };
  }
  globalThis.__meowlChessBot = {
    isPage, createImport,
    readExport: () => readExportFor(isPage),
    requestExport: (isActive, options) => requestExportFor(isPage, isActive, options),
    readGameExport: () => readExportFor(isGamePage),
    requestGameExport: (isActive, options) => requestExportFor(isGamePage, isActive, options),
  };
})();
