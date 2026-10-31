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
  function readExport() {
    if (!isPage()) return null;
    // Read Chess.com's own export, never infer a starting position from board pieces
    // or reconstruct a partial/virtualized move list. PGN preserves promotions and FEN.
    const fields = document.querySelectorAll('.share-menu-tab-pgn-component textarea, textarea[name="pgn"][aria-label="PGN"], textarea.share-menu-tab-pgn-textarea');
    for (const field of fields) {
      if (!visible(field) || typeof field.value !== 'string' || field.value.length > 250000) continue;
      const pgn = field.value.trim();
      const ending = pgn.replace(/\{[^}]*\}/g, '').replace(/;[^\n]*/g, '').trim().match(finalResult)?.[1];
      if (ending && new RegExp('\\[Result\\s+"' + ending.replaceAll('/', '\\/') + '"\\s*\\]').test(pgn)) return pgn;
    }
    return null;
  }
  async function requestExport(isActive = () => true) {
    if (!isPage() || !isActive()) return null;
    const ready = readExport(); if (ready) return ready;
    // #share-modal itself is a permanent (usually empty) mount point, not an
    // open dialog. Treating it as the modal would prevent the export click.
    const shareModal = () => document.querySelector('.share-menu-modal-header')?.closest('dialog')
      || document.querySelector('dialog#share-modal, #share-modal dialog');
    const currentModal = shareModal();
    const alreadyOpen = visible(currentModal);
    if (!alreadyOpen) {
      // Use the site's normal Share control, never a private endpoint or page global.
      // On the bot page Download opens the Share dialog on its PGN tab; it does
      // not download a file. Share is the fallback when that icon is unavailable.
      const share = [...document.querySelectorAll('.small-controls-leftIcons button[aria-label="Download"]')].find(visible)
        || [...document.querySelectorAll('.small-controls-leftIcons button[aria-label="Share"]')].find(visible);
      if (!share || share.disabled) return null;
      share.click();
    }
    const deadline = Date.now() + 5000;
    let selected = false, openedModal = null;
    try {
      while (Date.now() < deadline && isActive() && isPage()) {
        const modal = shareModal();
        if (visible(modal)) {
          openedModal ||= modal;
          const pgn = readExport();
          if (pgn) return pgn;
          const tab = modal.querySelector('button#tab-pgn, button[aria-controls="tabpanel-pgn"]');
          if (!selected && visible(tab) && !tab.disabled) { tab.click(); selected = true; }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return null;
    } finally {
      // A timeout or canceled review must not strand our native modal above the
      // board. A dialog that the user already had open belongs to the user.
      const ownedModal = openedModal || shareModal();
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
  globalThis.__meowlChessBot = { isPage, readExport, requestExport, createImport };
})();
