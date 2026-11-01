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
  let completionRefresh = null, completionAlerts = false;
  let retryButton, retryTimer, manualRetryUntil = 0, manualRetryPending = false;
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
    toggle.replaceChildren(controlIcon(value ? 'expand' : 'collapse')); toggle.setAttribute('aria-label', value ? 'Expand review' : 'Collapse review');
    toggle.title = value ? 'Expand review' : 'Collapse review';
    toggle.setAttribute('aria-expanded', String(!value));
  }
  function clearPanel() {
    panelMover?.destroy(); panelMover = botForm = null;
    frame?.remove(); frame = null;
    host?.remove(); host = shadow = body = message = stageLabel = bar = retryButton = null;
    clearTimeout(retryTimer);
    token = gameUrl = null;
  }
  function clearLauncher() { launcher?.remove(); launcher = null; }
  function showLauncher(focus = false) {
    if (!enabled || document.hidden || !dismissed || launcher?.isConnected) return;
    launcher = document.createElement('div'); launcher.id = 'meowlchess-site-launcher';
    launcher.style.cssText = 'all:initial!important;position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483646!important;display:block!important;color-scheme:dark!important;';
    const root = launcher.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `button{display:flex;align-items:center;gap:9px;box-sizing:border-box;max-width:calc(100vw - 32px);padding:8px 13px 8px 8px;border:1px solid #ffffff26;border-radius:28px;background:#2c2b27;color:#f1f0e9;box-shadow:0 4px 20px #0005;font:600 13px/1.4 'Segoe UI',Arial,sans-serif;cursor:pointer;transition:background-color .16s,border-color .16s}button:hover{background:#393832;border-color:#ffffff40}button:focus-visible{outline:2px solid #a4ce77;outline-offset:3px}button:focus:not(:focus-visible){outline:none}img{display:block;width:28px;height:28px;flex:none;border-radius:50%;object-fit:cover}span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(prefers-reduced-motion:reduce){button{transition:none}}`;
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
  function controlIcon(name) {
    const paths = {
      settings: ['M4 3v6m0 4v8M12 3v11m0 4v3M20 3v3m0 4v11', 'M1 9h6M9 14h6M17 6h6'],
      collapse: ['m6 15 6-6 6 6'], expand: ['m6 9 6 6 6-6'], close: ['m6 6 12 12M6 18 18 6'],
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'control-icon');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    for (const value of paths[name]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', value); svg.append(path); }
    return svg;
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
    style.textContent = `
      :host{font-family:'Segoe UI',Arial,sans-serif;color:#f1f0e9}
      .panel{background:#2c2b27;border:1px solid #ffffff26;border-radius:12px;box-shadow:0 12px 40px #0005,0 2px 7px #0003;overflow:hidden;font:13px/1.5 'Segoe UI',Arial,sans-serif;color:#f1f0e9;-webkit-font-smoothing:antialiased}
      .head{display:flex;align-items:center;gap:8px;padding:11px 12px;background:#252420;border-bottom:1px solid #ffffff12}
      .brand-icon{width:28px;height:28px;flex:none;border-radius:7px;object-fit:cover;user-select:none;-webkit-user-drag:none}
      .brand{font-size:14px;font-weight:650;flex:1;min-width:0;letter-spacing:-.25px;white-space:nowrap}
      .brand span{color:#a4c580}
      button{display:inline-flex;align-items:center;justify-content:center;flex:none;border:0;border-radius:6px;background:transparent;color:#b2afa5;font:inherit;cursor:pointer;width:28px;height:28px;padding:0;transition:background-color .16s,color .16s}
      button:hover{background:#ffffff0c;color:#f1f0e9}
      button:focus-visible{outline:2px solid #a4ce77;outline-offset:2px;background:#ffffff0c;color:#f1f0e9}
      button:focus:not(:focus-visible){outline:none}
      .control-icon{display:block;width:16px;height:16px;pointer-events:none;flex:none}
      button.settings{margin-right:2px}
      .body{max-height:calc(100vh - 140px);overflow:auto;scrollbar-color:#66645d transparent;scrollbar-width:thin;overscroll-behavior:contain}
      .waiting{padding:20px}
      .waiting p{margin:0 0 16px;font-size:12px;line-height:1.65;color:#d3d0c6;overflow-wrap:anywhere}
      .waiting .retry-loading{width:auto;height:auto;min-height:34px;padding:7px 11px;margin-top:14px;border:1px solid #ffffff26;color:#e0dfd5;font-size:11px;font-weight:600}
      .waiting .retry-loading:disabled{opacity:.55;cursor:default}
      .waiting small{display:block;color:#99968b;margin-top:12px;font-size:11px;line-height:1.6}
      .loading-steps{display:flex;justify-content:space-between;gap:8px;padding:0;margin:0 0 23px;list-style:none}
      .loading-steps li{display:flex;align-items:center;gap:5px;color:#99968b;font-size:10px;white-space:nowrap}
      .loading-steps .step-number{display:grid;place-items:center;box-sizing:border-box;width:20px;height:20px;border:1px solid #ffffff20;border-radius:50%;font-size:9px;font-weight:600}
      .loading-steps [aria-current]{color:#f1f0e9}
      .loading-steps [aria-current] .step-number{background:#a1c97b;border-color:#a1c97b;color:#18220e}
      :host([data-state="error"]) .loading-steps{display:none}
      :host([data-state="error"]) .waiting p{color:#eab98f}
      progress{display:block;width:100%;height:6px;border:0;border-radius:6px;overflow:hidden;accent-color:#81b64c;background:#1e1e1b}
      progress::-webkit-progress-bar{background:#1e1e1b;border-radius:6px}
      progress::-webkit-progress-value{background:#81b64c;border-radius:6px}
      iframe{display:block;width:100%;border:0;background:#2c2b27;min-height:0;max-height:calc(100vh - 140px)}
      [hidden]{display:none!important}
      .bot-import .bot-action{display:flex;width:100%;height:auto;min-height:38px;padding:9px 12px;margin-top:12px;background:#81b64c;color:#17210d;font:650 12px/1.5 'Segoe UI',Arial,sans-serif}
      .bot-import .bot-action:hover:enabled{background:#92c45e}
      .bot-import details{margin-top:16px;padding-top:14px;border-top:1px solid #ffffff12}
      .bot-import summary{cursor:pointer;color:#b2afa5;font-size:11px}
      .bot-import summary:hover{color:#f1f0e9}
      .bot-import textarea,.bot-import input{box-sizing:border-box;width:100%;margin-top:10px;font:12px/1.5 'Segoe UI',Arial,sans-serif;color:#f1f0e9}
      .bot-import textarea{resize:vertical;max-height:180px;background:#252420;border:1px solid #ffffff26;border-radius:6px;padding:10px}
      .bot-import input::file-selector-button{padding:7px 9px;margin-right:9px;border:1px solid #ffffff26;border-radius:5px;background:#34332f;color:#f1f0e9;font:inherit;cursor:pointer}
      .bot-import :is(summary,textarea,input):focus-visible{outline:2px solid #a4ce77;outline-offset:3px}
      .bot-import .bot-feedback{font-size:11px;margin:12px 0 0;color:#b7c7a5}
      .bot-feedback:empty{display:none}
      .bot-import button:disabled{opacity:.5;cursor:wait}
      @media(max-width:340px){.head{gap:6px;padding:10px}.waiting{padding:16px}.loading-steps{gap:5px}.loading-steps li{font-size:9px}}
      @media(prefers-reduced-motion:no-preference){.panel{animation:appear .18s ease-out}@keyframes appear{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}}
      @media(prefers-reduced-motion:reduce){button{transition:none}}
    `;
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
      .resize-handle[data-resize-direction="se"]{right:0;bottom:0;width:20px;height:20px;z-index:3;cursor:nwse-resize;border-radius:0 0 11px 0}
      .resize-handle[data-resize-direction="se"]::after{content:'';position:absolute;right:4px;bottom:4px;width:10px;height:10px;background:repeating-linear-gradient(135deg,transparent 0 3px,#99968b 3px 5px,transparent 5px 7px);clip-path:polygon(100% 0,100% 100%,0 100%);opacity:.7}
      .resize-handle:hover::after,.resize-handle:focus-visible::after{opacity:1}
      .resize-handle:focus{outline:none}
      .resize-handle:focus-visible{outline:2px solid #a4ce77;outline-offset:-3px}
      .resize-handle[data-pointer-focus="true"]:focus{outline:none}
      .waiting .loading-stage{font-size:19px;font-weight:650;letter-spacing:-.35px;line-height:1.3;margin:0 0 9px}
      .brand:focus{outline:none}.brand:focus-visible{outline:2px solid #a4ce77;outline-offset:3px;border-radius:2px}.brand[data-pointer-focus="true"]:focus{outline:none}
      :host([data-restored="true"]) .panel{animation:none}
    `;
    const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label', 'MeowlChess game review');
    const header = document.createElement('div'); header.className = 'head';
    const icon = document.createElement('img'); icon.className = 'brand-icon'; icon.src = chrome.runtime.getURL('icons/icon48.png'); icon.alt = ''; icon.setAttribute('aria-hidden', 'true'); icon.draggable = false; icon.width = icon.height = 28;
    const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = 'Meowl';
    const chess = document.createElement('span'); chess.textContent = 'Chess'; brand.append(chess);
    const settings = button('Page review settings', '', () => { void send('meowl:site-open-settings').catch(() => {}); }); settings.className = 'settings'; settings.append(controlIcon('settings'));
    const collapse = button('Collapse review', '', () => {
      collapsed(!body.hidden); void savePanelState(body.hidden ? 'collapsed' : 'open');
    }); collapse.setAttribute('aria-expanded', 'true'); collapse.append(controlIcon('collapse'));
    const close = button('Close review', '', dismiss); close.append(controlIcon('close'));
    header.append(icon, brand, settings, collapse, close);
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
      const steps = document.createElement('ol'); steps.className = 'loading-steps'; steps.setAttribute('aria-label', 'Review stages');
      for (const [index, name] of ['Find game', 'Analyze', 'Save'].entries()) {
        const step = document.createElement('li'), number = document.createElement('span'), label = document.createElement('span');
        number.className = 'step-number'; number.textContent = String(index + 1); number.setAttribute('aria-hidden', 'true'); label.textContent = name;
        if (!index) step.setAttribute('aria-current', 'step');
        step.append(number, label); steps.append(step);
      }
      retryButton = button('Retry loading this game', 'Retry loading', () => { void retryLoading(); }); retryButton.className = 'retry-loading';
      box.append(steps, stageLabel, message, bar, retryButton, detail); body.replaceChildren(box);
    }
    stageLabel.textContent = error ? 'Game unavailable' : 'Finding game';
    message.textContent = text; bar.hidden = error; updateRetryButton();
  }
  function updateRetryButton() {
    clearTimeout(retryTimer);
    if (!retryButton) return;
    const seconds = Math.max(0, Math.ceil((manualRetryUntil - Date.now()) / 1000));
    retryButton.disabled = checking || seconds > 0;
    retryButton.textContent = checking ? 'Checking…' : seconds ? `Retry in ${seconds}s` : 'Retry loading';
    if (seconds && !document.hidden) retryTimer = setTimeout(updateRetryButton, 1000);
  }
  function resetRetry() {
    manualRetryPending = false; manualRetryUntil = 0; clearTimeout(retryTimer);
  }
  async function retryLoading(fromFrame = false) {
    if (!enabled || document.hidden || dismissed || (!fromFrame && (Date.now() < manualRetryUntil || checking))) return;
    inspectPage();
    const started = ++generation;
    manualRetryUntil = Date.now() + 15000;
    // Retire the failed iframe before a new one can use the same game handle.
    if (fromFrame && selection) { await savePanelState('closed'); await savePanelState('open'); }
    if (!enabled || document.hidden || started !== generation) return;
    if (fromFrame) clearPanel();
    manualRetryPending = true; nextCheck = 0;
    waiting('Checking for this completed game again…'); updateRetryButton();
    if (!checking) void check();
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
    selection = reply; completionRefresh = null;
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
  function refreshFinishedGame() {
    // A finished-game notice must not reuse the lookup made while it was live.
    // Keep publication retries brief and bounded; the broker still validates
    // completed archive data and enforces its own request cooldown.
    if (source === 'chesscom' && !botPage() && gamePage()) completionRefresh = { until: Date.now() + 120000 };
  }
  function inspectPage() {
    if (!enabled || document.hidden) return;
    const current = pageKey();
    if (current !== route) {
      generation++; route = current; nextCheck = 0; completionRefresh = null; resetRetry();
      const target = specificGameUrl();
      if (target && target !== selection?.gameUrl) {
        forgetSelection(); clearPanel(); clearLauncher(); dismissed = null;
      }
      baseline = completedUrl = null; baselineKnown = false;
      // A notice already present on the destination is not a newly finished
      // round. First let the broker restore the selected completed review.
      hint = finishedHint(); hintSince = hint ? Date.now() : 0;
      if (hint) refreshFinishedGame();
      if (!selection) { botExportAttempted = false; botAttemptPgn = botSavedPgn = null; }
      void check();
      return;
    }
    const nextHint = finishedHint();
    if (hint && !nextHint) completionRefresh = null;
    if (botPage() && hint && !nextHint) {
      // The bot page reuses its URL for a rematch. Forget the previous result
      // when its final notice disappears rather than showing it as the new game.
      generation++; forgetSelection(); clearPanel(); clearLauncher(); botAttemptPgn = botSavedPgn = null; botExportAttempted = false; dismissed = null; nextCheck = 0; resetRetry();
    }
    if (nextHint && !hint) {
      if (botPage()) { botExportAttempted = false; botAttemptPgn = botSavedPgn = null; }
      if (liveLobby() || botPage()) {
        // A new result notice on the play screen starts with progress, never the old summary.
        baseline = selection?.gameUrl || gameUrl || completedUrl || baseline; completedUrl = null;
        freshSelection = selection; selection = null; panelState = 'open'; stateRevision++;
        generation++; clearPanel(); clearLauncher();
      }
      resetRetry(); hintSince = Date.now(); refreshFinishedGame(); dismissed = null; waiting(); nextCheck = 0; void check();
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
    if (completionRefresh && completionRefresh.until <= Date.now()) completionRefresh = null;
    checking = true; const started = generation, revision = stateRevision, fresh = freshSelection, completion = completionRefresh, manualRetry = manualRetryPending;
    manualRetryPending = false; updateRetryButton();
    const checkedRoute = route, checkedUsername = username;
    // Cached selections normally return immediately. Show retrieval progress
    // only if there is still no review to restore after that brief handshake.
    const reveal = setTimeout(() => {
      if (enabled && !document.hidden && started === generation && !selection && !host && !dismissed && hint) waiting();
    }, 150);
    try {
      if (host && !frame && !botPage()) waiting();
      await stateWrite;
      if (!enabled || document.hidden || started !== generation) return;
      const reply = await send('meowl:site-check', {
        ...(fresh ? { fresh: true, token: fresh.token, panelGeneration: fresh.panelGeneration } : {}),
        ...(completion ? { refreshCompleted: true } : {}),
        ...(manualRetry ? { manualRetry: true } : {}),
      });
      if (enabled && started !== generation && completionRefresh && completionRefresh !== completion &&
          checkedRoute === route && checkedUsername === username && liveLobby() && reply?.status === 'ready') {
        // The initial lobby lookup can create an older-game job after the new
        // finish notice. Carry its issued handle into the queued fresh check
        // so that job is replaced, rather than resumed as the new result.
        freshSelection = reply;
      }
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
    } finally {
      clearTimeout(reveal); checking = false;
      // If the finish notice arrived during an older lookup, give it its own
      // fresh check instead of losing it to that lookup's normal poll timer.
      if ((completionRefresh && completionRefresh !== completion) || manualRetryPending) nextCheck = 0;
      updateRetryButton(); inspectBot(); schedule();
    }
  }
  function stop(preserve = false) {
    if (!preserve) forgetSelection();
    resetRetry(); completionRefresh = null; enabled = false; generation++; clearTimeout(timer); clearTimeout(debounce); clearInterval(routeTimer); observer?.disconnect(); observer = null; clearPanel(); clearLauncher();
  }
  function configure(raw) {
    const config = raw?.[source], name = typeof config?.username === 'string' ? config.username.trim().toLowerCase() : '';
    if (config?.enabled === true && enabled && name === username) return;
    stop(); username = name;
    if (config?.enabled !== true || !new RegExp(`^[a-z0-9_-]{2,${source === 'lichess' ? 30 : 50}}$`).test(name)) return;
    enabled = true; route = pageKey(); dismissed = baseline = completedUrl = null; baselineKnown = false; hint = finishedHint(); hintSince = hint ? Date.now() : 0; nextCheck = 0; botAttemptPgn = botSavedPgn = null; botExportAttempted = false;
    if (hint) refreshFinishedGame();
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
    if (event.data.type === 'meowl:site-frame-retry') void retryLoading(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (!enabled) return;
    if (document.hidden) {
      clearTimeout(timer); clearTimeout(retryTimer);
      // Only an already accepted completed game may continue for an opt-in alert.
      if (!completionAlerts || !frame) { generation++; clearPanel(); }
      clearLauncher();
    }
    else { nextCheck = 0; if (botPage() && !botSavedPgn) botExportAttempted = false; inspectPage(); if (dismissed) showLauncher(); else void check(); }
  });
  window.addEventListener('pagehide', () => stop(true));
  window.addEventListener('pageshow', event => {
    if (event.persisted) void chrome.storage.local.get(['siteReviewSettings', 'completionAlerts']).then(values => { completionAlerts = values.completionAlerts === true; configure(values.siteReviewSettings); }).catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.completionAlerts) {
      completionAlerts = changes.completionAlerts.newValue === true;
      if (!completionAlerts && document.hidden) { generation++; clearPanel(); }
    }
    if (changes.siteReviewSettings) configure(changes.siteReviewSettings.newValue);
  });
  void chrome.storage.local.get(['siteReviewSettings', 'completionAlerts']).then(values => { completionAlerts = values.completionAlerts === true; configure(values.siteReviewSettings); }).catch(() => {});
})();
