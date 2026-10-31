(() => {
  if (globalThis.__meowlChessSiteReview) return;
  globalThis.__meowlChessSiteReview = true;
  const source = ['www.chess.com', 'chess.com'].includes(location.hostname) ? 'chesscom' : location.hostname === 'lichess.org' ? 'lichess' : null;
  if (!source || location.protocol !== 'https:' || window !== top) return;
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  const tokenPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const lichessRoutes = new Set(['analysis', 'training', 'practice', 'features', 'insights', 'streamer', 'password', 'bookmark', 'timeline', 'settings', 'checkout', 'registration']);
  let enabled = false, username = '', generation = 0, checking = false, timer, routeTimer, observer, debounce;
  let route = pageKey(), host, shadow, body, frame, message, stageLabel, bar, launcher, token = null, gameUrl = null;
  let selection = null, panelState = 'open', stateRevision = 0, stateWrite = Promise.resolve(), freshSelection = null;
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
    return game && !lichessRoutes.has(game[1].toLowerCase()) ? '/' + game[1].slice(0, 8) : path;
  }
  function liveLobby() { return source === 'chesscom' && !botPage() && /^\/(?:play|live)(?:\/|$)/.test(location.pathname); }
  function gamePage() {
    return source === 'chesscom' ? botPage() || liveLobby() || /^\/(?:analysis\/)?game\//.test(location.pathname) : Boolean(specificGameUrl());
  }
  function send(type, extra = {}) {
    try { return Promise.resolve(chrome.runtime.sendMessage({ type, ...extra })); }
    catch (error) { return Promise.reject(error); } // An extension reload can invalidate this old page helper.
  }
  function release(value) {
    return value ? send('meowl:site-release', { token: value.token, panelGeneration: value.panelGeneration }).catch(() => {}) : Promise.resolve();
  }
  function savePanelState(value) {
    panelState = value; stateRevision++;
    const selected = selection;
    if (!selected) return stateWrite;
    stateWrite = stateWrite.catch(() => {}).then(() => send('meowl:site-panel-state', {
      token: selected.token, panelGeneration: selected.panelGeneration, panelState: value,
    })).catch(() => {});
    return stateWrite;
  }
  function forgetSelection() {
    const previous = selection;
    selection = freshSelection = null; panelState = 'open'; stateRevision++;
    stateWrite = stateWrite.catch(() => {}).then(() => release(previous));
  }
  function collapsed(value) {
    if (!host || !body) return;
    body.hidden = value; host.dataset.collapsed = String(value);
    const toggle = shadow.querySelector('button[aria-expanded]');
    toggle.textContent = value ? '⌄' : '⌃'; toggle.setAttribute('aria-label', value ? 'Expand review' : 'Collapse review');
    toggle.setAttribute('aria-expanded', String(!value));
  }
  function clearPanel() {
    panelMover?.destroy(); panelMover = botForm = null;
    frame?.remove(); frame = null;
    host?.remove(); host = shadow = body = message = stageLabel = bar = null;
    token = gameUrl = null;
  }
  function clearLauncher() { launcher?.remove(); launcher = null; }
  function showLauncher(focus = false) {
    if (!enabled || document.hidden || !dismissed || launcher?.isConnected) return;
    launcher = document.createElement('div'); launcher.id = 'meowlchess-site-launcher';
    launcher.style.cssText = 'all:initial!important;position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483646!important;display:block!important;color-scheme:dark!important;';
    const root = launcher.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = 'button{display:flex;align-items:center;gap:8px;box-sizing:border-box;max-width:calc(100vw - 32px);padding:9px 12px;border:1px solid #65764f;border-radius:24px;background:#292b26;color:#f0efe8;box-shadow:0 4px 18px #0005;font:600 13px Arial,sans-serif;cursor:pointer}button:hover{background:#373d2d}button:focus-visible{outline:2px solid #b2cf8d;outline-offset:3px}img{display:block;width:24px;height:24px;flex:none;border-radius:5px;object-fit:cover}span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
    const open = button('Open MeowlChess review', '', () => { void reopenPanel(); });
    const icon = document.createElement('img'); icon.src = chrome.runtime.getURL('icons/icon48.png'); icon.alt = ''; icon.draggable = false;
    const label = document.createElement('span'); label.textContent = 'MeowlChess'; open.append(icon, label);
    root.append(style, open); document.documentElement.append(launcher);
    if (focus) open.focus({ preventScroll: true });
  }
  function dismiss() {
    dismissed = gameUrl || selection?.gameUrl || 'waiting';
    void savePanelState('closed');
    generation++; clearTimeout(timer); clearPanel(); showLauncher(true);
    schedule();
  }
  async function reopenPanel() {
    if (!enabled || document.hidden) return;
    // A click just after navigation must not bring back the previous bot export.
    inspectPage();
    if (!dismissed) return;
    const started = ++generation;
    await savePanelState('open');
    if (!enabled || document.hidden || started !== generation) return;
    dismissed = null; nextCheck = 0; clearLauncher();
    if (botPage()) { botExportAttempted = Boolean(botSavedPgn); botAttemptPgn = botSavedPgn; }
    if (selection) { showReview({ ...selection, resumed: true }); shadow?.querySelector('.brand')?.focus({ preventScroll: true }); }
    else { waiting(); shadow?.querySelector('.brand')?.focus({ preventScroll: true }); }
    void check();
  }
  function button(label, text, action) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
    element.title = label; element.setAttribute('aria-label', label); element.addEventListener('click', action); return element;
  }
  function ensurePanel() {
    clearLauncher();
    if (host?.isConnected) return;
    host = document.createElement('div'); host.id = 'meowlchess-site-review'; host.dataset.collapsed = 'false';
    if (selection?.resumed) host.dataset.restored = 'true';
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
      .resize-handle:focus{outline:none}
      .resize-handle:focus-visible{outline:2px solid #9dbb74;outline-offset:-3px}
      .resize-handle[data-pointer-focus="true"]:focus{outline:none}
      .waiting .loading-stage{font-size:15px;font-weight:650;line-height:1.3;margin:0 0 10px}
      .brand:focus{outline:none}.brand:focus-visible{outline:2px solid #9dbb74;outline-offset:3px;border-radius:2px}.brand[data-pointer-focus="true"]:focus{outline:none}
      :host([data-restored="true"]) .panel{animation:none}
    `;
    const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label', 'MeowlChess game review');
    const header = document.createElement('div'); header.className = 'head';
    const icon = document.createElement('img'); icon.className = 'brand-icon'; icon.src = chrome.runtime.getURL('icons/icon48.png'); icon.alt = ''; icon.setAttribute('aria-hidden', 'true'); icon.draggable = false; icon.width = icon.height = 24;
    const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = 'Meowl';
    const chess = document.createElement('span'); chess.textContent = 'Chess'; brand.append(chess);
    const settings = button('Page review settings', 'Settings', () => { void send('meowl:site-open-settings').catch(() => {}); }); settings.className = 'settings';
    const collapse = button('Collapse review', '⌃', () => {
      collapsed(!body.hidden); void savePanelState(body.hidden ? 'collapsed' : 'open');
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
      if (!enabled || document.hidden || started !== generation || !botPage()) return;
      if (reply?.status !== 'ready' || reply.kind !== 'bot') throw new Error(reply?.message || 'This game could not be loaded. Choose its finished PGN export.');
      botAttemptPgn = botSavedPgn = pgn; acceptReview(reply); nextCheck = Date.now() + interval;
    } finally { botSubmitting = false; }
  }
  function inspectBot() {
    if (!enabled || document.hidden || !botPage() || dismissed || selection || checking || freshSelection || botSubmitting || botExporting) return;
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
  function waiting(text = 'Looking for this completed game.', error = false) {
    if (frame || dismissed) return;
    if (botPage()) { botPrompt(); if (error) botForm?.feedback(text); return; }
    ensurePanel(); host.dataset.state = error ? 'error' : 'waiting';
    if (!message) {
      const box = document.createElement('div'); box.className = 'waiting';
      stageLabel = document.createElement('h2'); stageLabel.className = 'loading-stage';
      message = document.createElement('p'); message.setAttribute('role', 'status');
      bar = document.createElement('progress'); bar.setAttribute('aria-label', 'Finding game');
      const detail = document.createElement('small'); detail.textContent = 'The summary appears here when the local review finishes.';
      box.append(stageLabel, message, bar, detail); body.replaceChildren(box);
    }
    stageLabel.textContent = error ? 'Game unavailable' : 'Finding game';
    message.textContent = text; bar.hidden = error;
  }
  function showReview(reply) {
    if (!tokenPattern.test(reply.token) || typeof reply.gameUrl !== 'string') return;
    if (token === reply.token && frame?.isConnected) return;
    const keepFocus = Boolean(shadow?.activeElement);
    clearPanel(); token = reply.token; gameUrl = reply.gameUrl;
    ensurePanel(); host.dataset.state = 'review';
    frame = document.createElement('iframe'); frame.title = 'MeowlChess review progress and summary'; frame.referrerPolicy = 'origin';
    frame.src = chrome.runtime.getURL('site-summary.html') + '#' + token; frame.style.height = '270px'; body.replaceChildren(frame);
    collapsed(panelState === 'collapsed');
    if (keepFocus) shadow.querySelector('.brand')?.focus({ preventScroll: true });
  }
  function acceptReview(reply, revision = stateRevision) {
    if (!tokenPattern.test(reply.token) || typeof reply.gameUrl !== 'string') return;
    selection = reply;
    if (revision === stateRevision) panelState = ['open', 'collapsed', 'closed'].includes(reply.panelState) ? reply.panelState : 'open';
    else void savePanelState(panelState);
    if (panelState === 'closed') {
      dismissed = reply.gameUrl; clearPanel(); showLauncher(); return;
    }
    dismissed = null; showReview(reply); collapsed(panelState === 'collapsed');
  }
  function specificGameUrl() {
    const current = pageKey();
    if (source === 'chesscom') return /^\/game\/(?:live|daily)\/\d+$/.test(current) ? 'https://www.chess.com' + current : null;
    return /^\/[a-zA-Z0-9]{8}$/.test(current) && !lichessRoutes.has(current.slice(1).toLowerCase()) ? 'https://lichess.org' + current : null;
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
      generation++; route = current; nextCheck = 0;
      const target = specificGameUrl();
      if (target && target !== selection?.gameUrl) {
        forgetSelection(); clearPanel(); clearLauncher(); dismissed = null;
      }
      baseline = completedUrl = null; baselineKnown = false;
      // A notice already present on the destination is not a newly finished
      // round. First let the broker restore the selected completed review.
      hint = finishedHint(); hintSince = hint ? Date.now() : 0;
      if (!selection) { botExportAttempted = false; botAttemptPgn = botSavedPgn = null; }
      void check();
      return;
    }
    const nextHint = finishedHint();
    if (botPage() && hint && !nextHint) {
      // The bot page reuses its URL for a rematch. Forget the previous result
      // when its final notice disappears rather than showing it as the new game.
      generation++; forgetSelection(); clearPanel(); clearLauncher(); botAttemptPgn = botSavedPgn = null; botExportAttempted = false; dismissed = null; nextCheck = 0;
    }
    if (nextHint && !hint) {
      if (botPage()) { botExportAttempted = false; botAttemptPgn = botSavedPgn = null; }
      if (liveLobby() || botPage()) {
        // A new result notice on the play screen starts with progress, never the old summary.
        baseline = selection?.gameUrl || gameUrl || completedUrl || baseline; completedUrl = null;
        freshSelection = selection; selection = null; panelState = 'open'; stateRevision++;
        generation++; clearPanel(); clearLauncher();
      }
      hintSince = Date.now(); dismissed = null; waiting(); nextCheck = 0; void check();
      if (botPage() && body?.hidden) shadow.querySelector('button[aria-label="Expand review"]')?.click();
    }
    hint = nextHint;
    inspectBot();
  }
  function schedule() {
    clearTimeout(timer);
    if (enabled && !document.hidden && (!dismissed || selection)) timer = setTimeout(() => { void check(); }, Math.max(1000, nextCheck - Date.now()));
  }
  async function check() {
    if (!enabled || document.hidden || checking || botSubmitting || (dismissed && !selection)) return;
    if (Date.now() < nextCheck) { schedule(); return; }
    checking = true; const started = generation, revision = stateRevision, fresh = freshSelection;
    // Cached selections normally return immediately. Show retrieval progress
    // only if there is still no review to restore after that brief handshake.
    const reveal = setTimeout(() => {
      if (enabled && !document.hidden && started === generation && !selection && !host && !dismissed && hint) waiting();
    }, 150);
    try {
      if (host && !frame && !botPage()) waiting();
      await stateWrite;
      if (!enabled || document.hidden || started !== generation) return;
      const reply = await send('meowl:site-check', fresh ? { fresh: true, token: fresh.token, panelGeneration: fresh.panelGeneration } : {});
      if (!enabled || document.hidden || started !== generation) return;
      if (freshSelection === fresh) freshSelection = null;
      interval = Math.max(15000, Math.min(300000, Number(reply?.retryAfterMs) || interval)); nextCheck = Date.now() + interval;
      if (reply?.status === 'disabled') { selection = null; clearPanel(); clearLauncher(); return; }
      if (reply?.status === 'bot') {
        if (selection) { selection = null; panelState = 'open'; dismissed = null; clearPanel(); clearLauncher(); }
        // Keep a small header available even if the site's end-notice layout changes.
        const first = !host; botPrompt();
        if (first && host && !hint) shadow.querySelector('button[aria-label="Collapse review"]')?.click();
        if (botSavedPgn && !dismissed && !botSubmitting) void submitBot(botSavedPgn).catch(error => botForm?.feedback(error.message));
      } else if (reply?.status === 'ready') {
        if (!reply.resumed && botPage() !== (reply.kind === 'bot')) {
          release(reply); if (botPage()) botPrompt(); return;
        }
        if (liveLobby() && !reply.resumed) {
          // Establish a baseline so the previous match never opens as the one just finished.
          if (!baselineKnown) {
            baseline = reply.gameUrl; baselineKnown = true;
            // A fresh final-result notice can predate the very first archive response.
            if (!hintSince || reply.endTime * 1000 < hintSince - 120000) { release(reply); return; }
            completedUrl = reply.gameUrl;
          }
          if (!hintSince || (reply.gameUrl !== completedUrl && (reply.gameUrl === baseline || reply.endTime * 1000 < hintSince - 120000))) { release(reply); return; }
          baseline = completedUrl = reply.gameUrl;
        }
        if (liveLobby() && reply.resumed) {
          baselineKnown = true; baseline = completedUrl = reply.gameUrl;
        }
        if (!reply.resumed && (dismissed === reply.gameUrl || dismissed === 'waiting')) { release(reply); return; }
        acceptReview(reply, revision);
      } else if (reply?.status === 'waiting') {
        if (liveLobby() && !baselineKnown) baselineKnown = true;
        if (hint || host) waiting(reply.message);
      } else if (reply?.status === 'error' && (hint || host)) waiting(reply.message || 'Could not load the game. Retrying shortly…', true);
    } catch {
      nextCheck = Date.now() + interval;
      if (enabled && started === generation && (hint || host)) waiting('Could not connect to MeowlChess. Reload this page to reconnect.', true);
    } finally { clearTimeout(reveal); checking = false; inspectBot(); schedule(); }
  }
  function stop(preserve = false) {
    if (!preserve) forgetSelection();
    enabled = false; generation++; clearTimeout(timer); clearTimeout(debounce); clearInterval(routeTimer); observer?.disconnect(); observer = null; clearPanel(); clearLauncher();
  }
  function configure(raw) {
    const config = raw?.[source], name = typeof config?.username === 'string' ? config.username.trim().toLowerCase() : '';
    if (config?.enabled === true && enabled && name === username) return;
    stop(); username = name;
    if (config?.enabled !== true || !new RegExp(`^[a-z0-9_-]{2,${source === 'lichess' ? 30 : 50}}$`).test(name)) return;
    enabled = true; route = pageKey(); dismissed = baseline = completedUrl = null; baselineKnown = false; hint = finishedHint(); hintSince = hint ? Date.now() : 0; nextCheck = 0; botAttemptPgn = botSavedPgn = null; botExportAttempted = false;
    observer = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(inspectPage, 350); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    routeTimer = setInterval(inspectPage, 1000); void check();
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
    if (document.hidden) { generation++; clearTimeout(timer); clearPanel(); clearLauncher(); }
    else { nextCheck = 0; if (botPage() && !botSavedPgn) botExportAttempted = false; inspectPage(); if (dismissed) showLauncher(); else void check(); }
  });
  window.addEventListener('pagehide', () => stop(true));
  window.addEventListener('pageshow', event => {
    if (event.persisted) void chrome.storage.local.get('siteReviewSettings').then(values => configure(values.siteReviewSettings)).catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.siteReviewSettings) configure(changes.siteReviewSettings.newValue); });
  void chrome.storage.local.get('siteReviewSettings').then(values => configure(values.siteReviewSettings)).catch(() => {});
})();
