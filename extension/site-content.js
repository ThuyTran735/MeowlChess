(() => {
  if (globalThis.__meowlChessSiteReview) return;
  globalThis.__meowlChessSiteReview = true;
  const source = ['www.chess.com', 'chess.com'].includes(location.hostname) ? 'chesscom' : location.hostname === 'lichess.org' ? 'lichess' : null;
  if (!source || location.protocol !== 'https:' || window !== top) return;
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  const tokenPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  let enabled = false, username = '', generation = 0, checking = false, timer, routeTimer, observer, debounce;
  let route = pageKey(), host, shadow, body, frame, message, bar, token = null, gameUrl = null;
  let dismissed = null, baseline = null, completedUrl = null, baselineKnown = false, hint = false, hintSince = 0, nextCheck = 0;
  let interval = source === 'chesscom' ? 60000 : 30000;
  const bot = globalThis.__meowlChessBot;
  let panelMover, botForm, botSubmitting = false, botExporting = false, botExportAttempted = false, botAttemptPgn = null, botSavedPgn = null;
  const botPage = () => source === 'chesscom' && bot?.isPage() === true;

  function pageKey() {
    const path = location.pathname;
    if (source === 'chesscom') {
      const game = path.match(/^\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)\/?$/);
      return game ? `/game/${game[1] || 'live'}/${game[2]}` : path;
    }
    const game = path.match(/^\/([a-zA-Z0-9]{8}(?:[a-zA-Z0-9]{4})?)(?:\/(?:white|black))?\/?$/);
    return game ? '/' + game[1].slice(0, 8) : path;
  }
  function liveLobby() { return source === 'chesscom' && !botPage() && /^\/(?:play|live)(?:\/|$)/.test(location.pathname); }
  function gamePage() {
    return source === 'chesscom' ? botPage() || liveLobby() || /^\/(?:analysis\/)?game\//.test(location.pathname) : /^\/[a-zA-Z0-9]{8}(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.test(location.pathname);
  }
  function send(type, extra = {}) {
    try { return Promise.resolve(chrome.runtime.sendMessage({ type, ...extra })); }
    catch (error) { return Promise.reject(error); } // An extension reload can invalidate this old page helper.
  }
  function release(value) { if (value) void send('meowl:site-release', { token: value }).catch(() => {}); }
  function clearPanel() {
    panelMover?.destroy(); panelMover = botForm = null;
    frame?.remove(); frame = null;
    host?.remove(); host = shadow = body = message = bar = null;
    release(token); token = gameUrl = null;
  }
  function dismiss() {
    dismissed = gameUrl || 'waiting';
    generation++; clearPanel();
  }
  function button(label, text, action) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
    element.title = label; element.setAttribute('aria-label', label); element.addEventListener('click', action); return element;
  }
  function ensurePanel() {
    if (host?.isConnected) return;
    host = document.createElement('div'); host.id = 'meowlchess-site-review'; host.dataset.collapsed = 'false';
    // Keep host dimensions out of the chess site's stylesheet.
    host.style.cssText = 'all:initial!important;position:fixed!important;top:76px!important;right:16px!important;width:min(360px,calc(100vw - 24px))!important;z-index:2147483646!important;display:block!important;color-scheme:dark!important;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `:host{font-family:Arial,sans-serif;color:#f0efe8}.panel{background:#292b26;border:1px solid #55594b;border-radius:10px;box-shadow:0 10px 36px #0006;overflow:hidden;font:13px/1.5 Arial,sans-serif;color:#f0efe8}.head{display:flex;align-items:center;gap:7px;padding:9px 10px;border-bottom:1px solid #ffffff14}.brand-icon{width:24px;height:24px;flex:none;border-radius:5px;object-fit:cover;user-select:none;-webkit-user-drag:none}.brand{font-weight:700;flex:1;letter-spacing:-.2px}.brand span{color:#acc880}button{border:0;border-radius:4px;background:transparent;color:#c9ccbf;font:18px Arial,sans-serif;cursor:pointer;width:28px;height:28px}button:hover,button:focus-visible{background:#ffffff14;color:white;outline:2px solid #9dbb74}button.settings{font-size:12px;width:auto;padding:0 7px}.body{max-height:calc(100vh - 140px);overflow:auto}.waiting{padding:18px 16px 20px}.waiting p{margin:0 0 12px;font-size:13px}.waiting small{display:block;color:#aeb3a2;margin-top:10px;font-size:11px}progress{display:block;width:100%;height:7px;accent-color:#a3bf75}iframe{display:block;width:100%;border:0;background:#292b26;min-height:0;max-height:calc(100vh - 140px)} [hidden]{display:none!important}@media(prefers-reduced-motion:no-preference){.panel{animation:appear .18s ease-out}@keyframes appear{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}}`;
    style.textContent += '.bot-import .bot-action{display:block;width:100%;height:auto;padding:9px 12px;margin-top:12px;background:#a3bf75;color:#20241b;font:600 13px Arial,sans-serif}.bot-import details{margin-top:14px}.bot-import summary{cursor:pointer;color:#d0d3c7;font-size:12px}.bot-import textarea,.bot-import input{box-sizing:border-box;width:100%;margin-top:10px;font:12px Arial,sans-serif;color:#eee}.bot-import textarea{resize:vertical;max-height:180px;background:#20221e;border:1px solid #55594b;border-radius:4px;padding:8px}.bot-import .bot-feedback{font-size:12px;margin:12px 0 0;color:#cbd5b9}.bot-feedback:empty{display:none}.bot-import button:disabled{opacity:.6;cursor:wait}';
    style.textContent += `
      .panel{position:relative;display:flex;flex-direction:column;box-sizing:border-box;height:var(--meowl-panel-height,auto)}
      :host(:not([data-resized="true"]):not([data-collapsed="true"])) .panel{min-height:min(220px,calc(100vh - 16px))}
      .head{flex:none}.body{flex:1;min-height:0}.body:has(iframe){overflow:hidden}
      :host([data-resized="true"]) .body{max-height:none}
      :host([data-resized="true"]) iframe{height:100%!important;max-height:none}
      :host([data-collapsed="true"]) .panel{height:auto}
      :host([data-collapsed="true"]) .resize-handle{display:none}
      .resize-handle{position:absolute;z-index:2;touch-action:none;user-select:none}
      .resize-handle[data-resize-direction="n"],.resize-handle[data-resize-direction="s"]{height:6px;left:9px;right:9px;cursor:ns-resize}
      .resize-handle[data-resize-direction="n"]{top:-5px}
      .resize-handle[data-resize-direction="s"]{bottom:-5px;right:20px}
      .resize-handle[data-resize-direction="e"],.resize-handle[data-resize-direction="w"]{width:6px;top:9px;bottom:9px;cursor:ew-resize}
      .resize-handle[data-resize-direction="e"]{right:-5px;bottom:20px}
      .resize-handle[data-resize-direction="w"]{left:-5px}
      .resize-handle[data-resize-direction="nw"],.resize-handle[data-resize-direction="ne"],.resize-handle[data-resize-direction="sw"]{width:14px;height:14px;z-index:3}
      .resize-handle[data-resize-direction="nw"]{top:-5px;left:-5px;cursor:nwse-resize}
      .resize-handle[data-resize-direction="ne"]{top:-5px;right:-5px;cursor:nesw-resize}
      .resize-handle[data-resize-direction="sw"]{bottom:-5px;left:-5px;cursor:nesw-resize}
      .resize-handle[data-resize-direction="se"]{right:0;bottom:0;width:20px;height:20px;z-index:3;cursor:nwse-resize;border-radius:0 0 9px 0}
      .resize-handle[data-resize-direction="se"]::after{content:'';position:absolute;right:4px;bottom:4px;width:10px;height:10px;background:repeating-linear-gradient(135deg,transparent 0 3px,#b7bca8 3px 5px,transparent 5px 7px);clip-path:polygon(100% 0,100% 100%,0 100%);opacity:.7}
      .resize-handle:hover::after,.resize-handle:focus-visible::after{opacity:1}
      .resize-handle:focus-visible{outline:2px solid #9dbb74;outline-offset:-3px}
    `;
    const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label', 'MeowlChess game review');
    const header = document.createElement('div'); header.className = 'head';
    const icon = document.createElement('img'); icon.className = 'brand-icon'; icon.src = chrome.runtime.getURL('icons/icon48.png'); icon.alt = ''; icon.setAttribute('aria-hidden', 'true'); icon.draggable = false; icon.width = icon.height = 24;
    const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = 'Meowl';
    const chess = document.createElement('span'); chess.textContent = 'Chess'; brand.append(chess);
    const settings = button('Page review settings', 'Settings', () => { void send('meowl:site-open-settings').catch(() => {}); }); settings.className = 'settings';
    const collapse = button('Collapse review', '⌃', () => {
      body.hidden = !body.hidden; host.dataset.collapsed = String(body.hidden);
      collapse.textContent = body.hidden ? '⌄' : '⌃'; collapse.setAttribute('aria-label', body.hidden ? 'Expand review' : 'Collapse review'); collapse.setAttribute('aria-expanded', String(!body.hidden));
    }); collapse.setAttribute('aria-expanded', 'true');
    header.append(icon, brand, settings, collapse, button('Close review', '×', dismiss));
    body = document.createElement('div'); body.className = 'body';
    const resizeHandles = ['se', 'n', 's', 'e', 'w', 'ne', 'nw', 'sw'].map(direction => {
      const grip = document.createElement('span'); grip.className = 'resize-handle'; grip.dataset.noDrag = ''; grip.dataset.resizeDirection = direction;
      return grip;
    });
    // Outside the clipped panel, edge targets cover the border without covering its scrollbar.
    panel.append(header, body); shadow.append(style, panel, ...resizeHandles); document.documentElement.append(host);
    panelMover = globalThis.__meowlChessCreatePanelMover?.({ host, handle: brand, source, surface: panel, resizeHandle: resizeHandles[0], resizeHandles,
      onFrameDragEnd: ({ pointerId }) => frame?.contentWindow.postMessage({ type: 'meowl:site-frame-drag-finished', token, pointerId }, extensionOrigin),
    });
  }
  function botPrompt() {
    if (frame || dismissed || !botPage()) return;
    ensurePanel(); host.dataset.state = 'bot';
    if (!botForm) {
      botForm = bot.createImport({ submit: submitBot, getExport: () => {
        const started = generation;
        return bot.requestExport(() => enabled && !document.hidden && started === generation && botPage());
      } });
      body.replaceChildren(botForm.element); message = bar = null;
    }
  }
  async function submitBot(pgn) {
    if (!enabled || document.hidden || !botPage() || botSubmitting) return;
    const started = generation; botSubmitting = true;
    try {
      botPrompt(); botForm?.feedback('Reading the finished game…');
      const reply = await send('meowl:site-bot-import', { pgn });
      if (!enabled || document.hidden || started !== generation || !botPage()) { release(reply?.token); return; }
      if (reply?.status !== 'ready' || reply.kind !== 'bot') throw new Error(reply?.message || 'This game could not be loaded. Choose its finished PGN export.');
      botAttemptPgn = botSavedPgn = pgn; showReview(reply); nextCheck = Date.now() + interval;
    } finally { botSubmitting = false; }
  }
  function inspectBot() {
    if (!enabled || document.hidden || !botPage() || dismissed || botSubmitting || botExporting) return;
    const pgn = bot.readExport();
    if (pgn && pgn !== botAttemptPgn) {
      botAttemptPgn = pgn;
      void submitBot(pgn).catch(error => { botPrompt(); botForm?.feedback(error.message); });
      return;
    }
    if (frame || !finishedHint() || botExportAttempted) return;
    botExportAttempted = true; botExporting = true;
    const started = generation;
    const active = () => enabled && !document.hidden && started === generation && botPage() && !dismissed;
    botPrompt(); botForm?.feedback('Getting the finished game from Chess.com…');
    void bot.requestExport(active).then(async exported => {
      if (!active()) return;
      if (exported) { botAttemptPgn = exported; await submitBot(exported); }
      else botForm?.feedback('Open Share → PGN, or use a PGN file below. Only finished games can be reviewed.');
    }).catch(error => { if (active()) botForm?.feedback(error.message); }).finally(() => { botExporting = false; });
  }
  function waiting(text = 'Waiting for game data…', error = false) {
    if (frame || dismissed) return;
    if (botPage()) { botPrompt(); if (error) botForm?.feedback(text); return; }
    ensurePanel(); host.dataset.state = error ? 'error' : 'waiting';
    if (!message) {
      const box = document.createElement('div'); box.className = 'waiting';
      message = document.createElement('p'); message.setAttribute('role', 'status');
      bar = document.createElement('progress'); bar.setAttribute('aria-label', 'Waiting for completed game data');
      const detail = document.createElement('small'); detail.textContent = 'The summary appears here when the local review finishes.';
      box.append(message, bar, detail); body.replaceChildren(box);
    }
    message.textContent = text; bar.hidden = error;
  }
  function showReview(reply) {
    if (!tokenPattern.test(reply.token) || typeof reply.gameUrl !== 'string') return;
    if (token === reply.token && frame?.isConnected) return;
    clearPanel(); token = reply.token; gameUrl = reply.gameUrl;
    ensurePanel(); host.dataset.state = 'review';
    frame = document.createElement('iframe'); frame.title = 'MeowlChess review progress and summary'; frame.referrerPolicy = 'origin';
    frame.src = chrome.runtime.getURL('site-summary.html') + '#' + token; frame.style.height = '270px'; body.replaceChildren(frame);
  }
  function visible(element) {
    if (!element || !element.getClientRects().length) return false;
    const css = getComputedStyle(element); return css.display !== 'none' && css.visibility !== 'hidden';
  }
  function finishedHint() {
    if (!gamePage()) return false;
    // Human games require an archive entry. Bot hints only open the export UI;
    // the background separately validates a complete, legally replayable PGN.
    const explicit = source === 'chesscom' ? '[class*="game-over-modal"],[data-cy="game-over-modal"],.game-over-component,[data-cy="game-over-component"],.daily-game-footer-game-over' : '.round__app .result,.round__app .gameover,.round__app .follow-up';
    if ([...document.querySelectorAll(explicit)].some(visible)) return true;
    const generic = source === 'chesscom' ? '[data-cy="game-result"],.game-result,.game-result-component' : '.round__app .status,.game__meta .status';
    return [...document.querySelectorAll(generic)].some(element => visible(element) && /(?:1\s*[-–]\s*0|0\s*[-–]\s*1|½\s*[-–]\s*½|1\/2|checkmate|stalemate|draw|resigned|won|wins|game over)/i.test(element.textContent));
  }
  function inspectPage() {
    if (!enabled || document.hidden) return;
    const current = pageKey();
    if (current !== route) {
      generation++; clearPanel(); route = current; dismissed = baseline = completedUrl = null; baselineKnown = false; hint = false; hintSince = 0; nextCheck = 0; botExportAttempted = false; botAttemptPgn = botSavedPgn = null;
      void check();
    }
    const nextHint = finishedHint();
    if (botPage() && hint && !nextHint) {
      // The bot page reuses its URL for a rematch. Forget the previous result
      // when its final notice disappears rather than showing it as the new game.
      generation++; clearPanel(); botAttemptPgn = botSavedPgn = null; botExportAttempted = false; dismissed = null; nextCheck = 0;
    }
    if (nextHint && !hint) {
      if (botPage()) { botExportAttempted = false; botAttemptPgn = botSavedPgn = null; }
      if ((liveLobby() || botPage()) && gameUrl) {
        // A new result notice on the play screen starts with progress, never the old summary.
        baseline = gameUrl; completedUrl = null; generation++; clearPanel();
      }
      hintSince = Date.now(); dismissed = null; waiting(); nextCheck = 0; void check();
      if (botPage() && body?.hidden) shadow.querySelector('button[aria-label="Expand review"]')?.click();
    }
    hint = nextHint;
    inspectBot();
  }
  function schedule() {
    clearTimeout(timer);
    if (enabled && !document.hidden) timer = setTimeout(() => { void check(); }, Math.max(1000, nextCheck - Date.now()));
  }
  async function check() {
    if (!enabled || document.hidden || checking) return;
    if (Date.now() < nextCheck) { schedule(); return; }
    checking = true; const started = generation;
    try {
      const reply = await send('meowl:site-check');
      if (!enabled || document.hidden || started !== generation) return;
      interval = Math.max(15000, Math.min(300000, Number(reply?.retryAfterMs) || interval)); nextCheck = Date.now() + interval;
      if (reply?.status === 'disabled') { clearPanel(); return; }
      if (reply?.status === 'bot') {
        // Keep a small header available even if the site's end-notice layout changes.
        const first = !host; botPrompt();
        if (first && host && !hint) shadow.querySelector('button[aria-label="Collapse review"]')?.click();
        if (botSavedPgn && !dismissed && !botSubmitting) void submitBot(botSavedPgn).catch(error => botForm?.feedback(error.message));
        else inspectBot();
      } else if (reply?.status === 'ready') {
        if (botPage() !== (reply.kind === 'bot')) {
          release(reply.token); if (botPage()) botPrompt(); return;
        }
        if (token === reply.token && frame?.isConnected) return;
        if (liveLobby()) {
          // Establish a baseline so the previous match never opens as the one just finished.
          if (!baselineKnown) {
            baseline = reply.gameUrl; baselineKnown = true;
            // A fresh final-result notice can predate the very first archive response.
            if (!hintSince || reply.endTime * 1000 < hintSince - 120000) { release(reply.token); return; }
            completedUrl = reply.gameUrl;
          }
          if (!hintSince || (reply.gameUrl !== completedUrl && (reply.gameUrl === baseline || reply.endTime * 1000 < hintSince - 120000))) { release(reply.token); return; }
          baseline = completedUrl = reply.gameUrl;
        }
        if (dismissed === reply.gameUrl || dismissed === 'waiting') { release(reply.token); return; }
        dismissed = null; showReview(reply);
      } else if (reply?.status === 'waiting') {
        if (liveLobby() && !baselineKnown) baselineKnown = true;
        if (hint || host) waiting(reply.message);
      } else if (reply?.status === 'error' && (hint || host)) waiting(reply.message || 'Could not load the game. Retrying shortly…', true);
    } catch {
      nextCheck = Date.now() + interval;
      if (enabled && started === generation && (hint || host)) waiting('Could not connect to MeowlChess. Reload this page to reconnect.', true);
    } finally { checking = false; schedule(); }
  }
  function stop() {
    enabled = false; generation++; clearTimeout(timer); clearTimeout(debounce); clearInterval(routeTimer); observer?.disconnect(); observer = null; clearPanel();
  }
  function configure(raw) {
    const config = raw?.[source], name = typeof config?.username === 'string' ? config.username.trim().toLowerCase() : '';
    if (config?.enabled === true && enabled && name === username) return;
    stop(); username = name;
    if (config?.enabled !== true || !new RegExp(`^[a-z0-9_-]{2,${source === 'lichess' ? 30 : 50}}$`).test(name)) return;
    enabled = true; route = pageKey(); dismissed = baseline = completedUrl = null; baselineKnown = false; hint = false; hintSince = 0; nextCheck = 0; botAttemptPgn = botSavedPgn = null; botExportAttempted = false;
    observer = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(inspectPage, 350); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    routeTimer = setInterval(inspectPage, 1000); inspectPage(); void check();
  }
  window.addEventListener('message', event => {
    if (!event.isTrusted || event.origin !== extensionOrigin || !frame || event.source !== frame.contentWindow || event.data?.token !== token) return;
    if (event.data.type === 'meowl:site-frame-drag') {
      const data = event.data;
      if (![data.clientX, data.clientY, data.viewportWidth, data.viewportHeight].every(Number.isFinite) || data.viewportWidth <= 0 || data.viewportHeight <= 0) return;
      const rect = frame.getBoundingClientRect();
      panelMover?.frameDrag({ ...data, parentX: rect.left + data.clientX * rect.width / data.viewportWidth,
        parentY: rect.top + data.clientY * rect.height / data.viewportHeight });
    }
    if (event.data.type === 'meowl:site-frame-size' && Number.isFinite(event.data.height)) frame.style.height = Math.max(180, Math.min(680, event.data.height)) + 'px';
    if (event.data.type === 'meowl:site-frame-close') dismiss();
  });
  document.addEventListener('visibilitychange', () => {
    if (!enabled) return;
    if (document.hidden) { generation++; clearTimeout(timer); clearPanel(); }
    else { nextCheck = 0; if (botPage() && !botSavedPgn) botExportAttempted = false; inspectPage(); void check(); }
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => {
    if (event.persisted) void chrome.storage.local.get('siteReviewSettings').then(values => configure(values.siteReviewSettings)).catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.siteReviewSettings) configure(changes.siteReviewSettings.newValue); });
  void chrome.storage.local.get('siteReviewSettings').then(values => configure(values.siteReviewSettings)).catch(() => {});
})();
