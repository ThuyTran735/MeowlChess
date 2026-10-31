(() => {
  if (globalThis.__meowlChessCreatePanelMover) return;
  const positions = new Map();
  const loads = new Map();
  const sizes = new Map();
  const sizeLoads = new Map();
  const valid = value => value && Number.isFinite(value.left) && Number.isFinite(value.top) && Math.abs(value.left) < 1000000 && Math.abs(value.top) < 1000000;
  const validSize = value => value && Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0 && value.width < 1000000 && value.height < 1000000;

  // Runs in the extension's isolated content-script world, before site-content.js.
  globalThis.__meowlChessCreatePanelMover = ({ host, handle, source, surface = handle, resizeHandle, resizeHandles, onFrameDragEnd }) => {
    const key = `siteReviewPanelPosition:${source}`;
    const sizeKey = `siteReviewPanelSize:${source}`;
    let preferred = positions.get(key) || null;
    const resizeGrips = [...new Set([...(resizeHandle ? [resizeHandle] : []), ...(Array.isArray(resizeHandles) ? resizeHandles : [])])];
    const directions = { n: ['ns-resize', 'top edge'], s: ['ns-resize', 'bottom edge'], e: ['ew-resize', 'right edge'], w: ['ew-resize', 'left edge'], ne: ['nesw-resize', 'top-right corner'], nw: ['nwse-resize', 'top-left corner'], se: ['nwse-resize', 'bottom-right corner'], sw: ['nesw-resize', 'bottom-left corner'] };
    const directionFor = grip => Object.hasOwn(directions, grip?.dataset.resizeDirection) ? grip.dataset.resizeDirection : 'se';
    const primaryGrip = resizeGrips.find(grip => directionFor(grip) === 'se') || resizeGrips[0];
    let preferredSize = resizeGrips.length ? sizes.get(sizeKey) || null : null;
    let resize = null, sizeChanged = false;
    const originalWidth = { value: host.style.getPropertyValue('width'), priority: host.style.getPropertyPriority('width') };
    const gripOriginal = new Map(resizeGrips.map(grip => [grip, Object.fromEntries(['role', 'tabindex', 'aria-label', 'aria-keyshortcuts', 'title', 'style'].map(name => [name, grip.getAttribute(name)]))]));
    let destroyed = false, changed = false, drag = null, repaint = 0, saveTimer = 0, needsSave = false;
    let shield = null;
    const original = { role: handle.getAttribute('role'), tabindex: handle.getAttribute('tabindex'), label: handle.getAttribute('aria-label'), title: handle.getAttribute('title'), shortcuts: handle.getAttribute('aria-keyshortcuts'), style: handle.getAttribute('style') };
    const surfaceStyle = surface.getAttribute('style');
    const interactive = 'button,a,input,select,textarea,summary,label,iframe,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="slider"],[role="checkbox"],[role="switch"],[role="textbox"],[role="combobox"],[tabindex]:not([tabindex="-1"]),[data-no-drag]';
    surface.style.cursor = 'grab';
    // Vertical touch scrolling remains available outside the keyboard handle.
    // A horizontal touch gesture can still move any noninteractive panel area.
    if (surface !== handle) surface.style.touchAction = 'pan-y';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', 'Move review panel');
    handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Home');
    handle.title = 'Drag to move. Arrow keys move the panel; Home resets its position.';
    handle.style.cursor = 'grab';
    handle.style.touchAction = 'none';
    handle.style.userSelect = 'none';
    for (const grip of resizeGrips) {
      const [cursor, label] = directions[directionFor(grip)];
      grip.tabIndex = grip === primaryGrip ? 0 : -1; grip.setAttribute('role', 'button');
      grip.setAttribute('aria-label', grip === primaryGrip ? 'Resize review panel' : `Resize review panel from ${label}`);
      grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Home');
      grip.title = 'Drag to resize. Arrow keys move this edge; Home or double-click resets the size.';
      grip.style.cursor = cursor; grip.style.touchAction = 'none';
    }

    function viewport() {
      const view = window.visualViewport;
      return { left: view?.offsetLeft || 0, top: view?.offsetTop || 0, width: view?.width || window.innerWidth, height: view?.height || window.innerHeight };
    }
    function place() {
      if (destroyed || !host.isConnected) return;
      const view = viewport();
      if (preferredSize) {
        const size = boundedSize(preferredSize.width, preferredSize.height);
        host.dataset.resized = 'true';
        host.style.setProperty('width', size.width + 'px', 'important');
        host.style.setProperty('--meowl-panel-height', size.height + 'px');
      } else {
        delete host.dataset.resized; host.style.removeProperty('--meowl-panel-height');
        if (originalWidth.value) host.style.setProperty('width', originalWidth.value, originalWidth.priority);
        else host.style.removeProperty('width');
      }
      const rect = host.getBoundingClientRect();
      const left = preferred?.left ?? view.left + view.width - rect.width - 16;
      const top = preferred?.top ?? view.top + 76;
      const maxLeft = view.left + Math.max(8, view.width - rect.width - 8);
      const maxTop = view.top + Math.max(8, view.height - rect.height - 8);
      host.style.setProperty('right', 'auto', 'important');
      host.style.setProperty('bottom', 'auto', 'important');
      host.style.setProperty('left', Math.round(Math.min(maxLeft, Math.max(view.left + 8, left))) + 'px', 'important');
      host.style.setProperty('top', Math.round(Math.min(maxTop, Math.max(view.top + 8, top))) + 'px', 'important');
    }
    function queuePlace() {
      if (repaint || destroyed) return;
      repaint = requestAnimationFrame(() => { repaint = 0; place(); });
    }
    function save() {
      clearTimeout(saveTimer); saveTimer = 0;
      if (!needsSave) return;
      needsSave = false;
      try { void Promise.resolve(chrome.storage.local.set({ [key]: preferred })).catch(() => {}); } catch { /* A reloaded extension can invalidate the old helper. */ }
    }
    function remember() {
      changed = true; needsSave = true;
      positions.set(key, preferred);
      clearTimeout(saveTimer); saveTimer = setTimeout(save, 150);
    }
    function move(left, top) {
      preferred = { left, top }; place();
      const rect = host.getBoundingClientRect();
      preferred = { left: Math.round(rect.left), top: Math.round(rect.top) };
    }
    function boundedSize(width, height) {
      const view = viewport(), maxWidth = Math.max(1, view.width - 16), maxHeight = Math.max(1, view.height - 16);
      return { width: Math.round(Math.max(Math.min(280, maxWidth), Math.min(maxWidth, width))), height: Math.round(Math.max(Math.min(220, maxHeight), Math.min(maxHeight, height))) };
    }
    function rememberSize() {
      sizeChanged = true; sizes.set(sizeKey, preferredSize);
      try { void Promise.resolve(chrome.storage.local.set({ [sizeKey]: preferredSize })).catch(() => {}); } catch { /* Extension reload. */ }
    }
    function resizeTo(rect, direction, dx, dy) {
      const view = viewport(), leftLimit = view.left + 8, topLimit = view.top + 8;
      const rightLimit = view.left + Math.max(9, view.width - 8), bottomLimit = view.top + Math.max(9, view.height - 8);
      const minWidth = Math.min(280, Math.max(1, view.width - 16)), minHeight = Math.min(220, Math.max(1, view.height - 16));
      let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
      if (direction.includes('w')) left = Math.max(leftLimit, Math.min(right - minWidth, left + dx));
      if (direction.includes('e')) right = Math.min(rightLimit, Math.max(left + minWidth, right + dx));
      if (direction.includes('n')) top = Math.max(topLimit, Math.min(bottom - minHeight, top + dy));
      if (direction.includes('s')) bottom = Math.min(bottomLimit, Math.max(top + minHeight, bottom + dy));
      preferred = { left, top }; preferredSize = boundedSize(right - left, bottom - top); place();
    }
    function resizeDown(event) {
      if (destroyed || drag || resize || host.dataset.collapsed === 'true' || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); event.stopPropagation();
      const rect = host.getBoundingClientRect();
      const grip = event.currentTarget, direction = directionFor(grip);
      resize = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, grip, direction, previous: preferredSize, previousPosition: preferred, moved: false };
      preferred = { left: rect.left, top: rect.top }; changed = sizeChanged = true;
      grip.dataset.pointerFocus = 'true';
      grip.focus({ preventScroll: true }); grip.setPointerCapture(event.pointerId);
      host.dataset.resizing = 'true';
      showShield(directions[direction][0], 'meowlchess-resize-shield');
    }
    function resizeMove(event) {
      if (!resize || resize.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const dx = /[we]/.test(resize.direction) ? event.clientX - resize.x : 0, dy = /[ns]/.test(resize.direction) ? event.clientY - resize.y : 0;
      if (!resize.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      resize.moved = true; resizeTo(resize.rect, resize.direction, dx, dy);
    }
    function finishResize(cancel = false) {
      if (!resize) return;
      const prior = resize; resize = null; delete host.dataset.resizing;
      shield?.remove(); shield = null;
      if (prior.grip.hasPointerCapture(prior.id)) prior.grip.releasePointerCapture(prior.id);
      if (cancel || !prior.moved) { preferredSize = prior.previous; preferred = prior.previousPosition; place(); }
      else {
        const rect = host.getBoundingClientRect(); preferred = { left: Math.round(rect.left), top: Math.round(rect.top) };
        rememberSize(); remember(); save();
      }
    }
    function resizeUp(event) {
      if (!resize || resize.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      if (event.type !== 'pointercancel') resizeMove(event);
      finishResize(event.type === 'pointercancel');
    }
    function resizeLost(event) { if (resize?.id === event.pointerId) finishResize(true); }
    function resetSize(event) {
      if (destroyed || host.dataset.collapsed === 'true') return;
      event?.preventDefault(); event?.stopPropagation(); finishResize(true);
      preferredSize = null; rememberSize(); place();
    }
    function resizeKey(event) {
      delete event.currentTarget.dataset.pointerFocus;
      if (event.altKey || event.ctrlKey || event.metaKey || host.dataset.collapsed === 'true' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      const direction = directionFor(event.currentTarget);
      if ((/Arrow(?:Left|Right)/.test(event.key) && !/[we]/.test(direction)) || (/Arrow(?:Up|Down)/.test(event.key) && !/[ns]/.test(direction))) return;
      event.preventDefault(); event.stopPropagation(); finishResize(true); finishDrag(true);
      if (event.key === 'Home') { resetSize(); return; }
      const rect = host.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
      preferred = { left: rect.left, top: rect.top }; changed = true;
      resizeTo(rect, direction, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0, event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
      const placed = host.getBoundingClientRect(); preferred = { left: Math.round(placed.left), top: Math.round(placed.top) };
      rememberSize(); remember(); save();
    }
    function blockedTarget(event) {
      for (const element of event.composedPath()) {
        if (!(element instanceof Element)) continue;
        if (element !== handle && element.matches(interactive)) return true;
        // Native scrollbars must continue to receive their own pointer gesture.
        const rect = element.getBoundingClientRect();
        if (element.scrollHeight > element.clientHeight && element.offsetWidth - element.clientWidth > 2
          && event.clientX >= rect.left + element.clientLeft + element.clientWidth && event.clientX <= rect.right) return true;
        if (element.scrollWidth > element.clientWidth && element.offsetHeight - element.clientHeight > 2
          && event.clientY >= rect.top + element.clientTop + element.clientHeight && event.clientY <= rect.bottom) return true;
        if (element === surface) break;
      }
      return false;
    }
    function beginDrag(id, x, y, remote) {
      const rect = host.getBoundingClientRect();
      drag = { id, x, y, remote, left: rect.left, top: rect.top, previous: preferred };
      surface.style.cursor = handle.style.cursor = 'grabbing'; host.dataset.dragging = 'true';
    }
    function pointerDown(event) {
      if (destroyed || event.button !== 0 || !event.isPrimary || drag || resize || blockedTarget(event)) return;
      event.preventDefault(); event.stopPropagation();
      beginDrag(event.pointerId, event.clientX, event.clientY, false);
      handle.dataset.pointerFocus = 'true';
      handle.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
    }
    function pointerMove(event) {
      if (!drag || drag.remote || event.pointerId !== drag.id) return;
      event.preventDefault(); event.stopPropagation();
      move(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    }
    function finishDrag(cancel = false) {
      if (!drag) return;
      const previous = drag.previous, id = drag.id, remote = drag.remote;
      drag = null; delete host.dataset.dragging; surface.style.cursor = handle.style.cursor = 'grab';
      shield?.remove(); shield = null;
      if (!remote && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
      if (cancel) { preferred = previous; place(); }
      else { remember(); save(); }
      if (remote) { try { onFrameDragEnd?.({ pointerId: id, canceled: cancel }); } catch { /* Teardown may already have removed the frame. */ } }
    }
    function pointerUp(event) {
      if (!drag || drag.remote || event.pointerId !== drag.id) return;
      event.preventDefault(); event.stopPropagation(); finishDrag(event.type === 'pointercancel');
    }
    function lostCapture(event) { if (drag && !drag.remote && event.pointerId === drag.id) finishDrag(); }
    function showShield(cursor, id) {
      shield = document.createElement('div');
      shield.id = id; shield.setAttribute('aria-hidden', 'true');
      shield.style.cssText = `all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;background:transparent!important;cursor:${cursor}!important;pointer-events:auto!important;touch-action:none!important;user-select:none!important;`;
      document.documentElement.append(shield);
    }
    function frameDrag(data) {
      if (destroyed || !data || !['start', 'move', 'end', 'cancel'].includes(data.phase)
        || !Number.isInteger(data.pointerId) || data.pointerId < 0 || data.pointerId > 2147483647
        || !Number.isFinite(data.screenX) || !Number.isFinite(data.screenY)
        || Math.abs(data.screenX) > 1000000 || Math.abs(data.screenY) > 1000000) return false;
      const parentCoords = Number.isFinite(data.parentX) && Number.isFinite(data.parentY) && Math.abs(data.parentX) <= 1000000 && Math.abs(data.parentY) <= 1000000;
      if ((data.parentX !== undefined || data.parentY !== undefined) && !parentCoords) return false;
      if (data.phase === 'start') {
        if (drag || resize) return false;
        beginDrag(data.pointerId, parentCoords ? data.parentX : data.screenX, parentCoords ? data.parentY : data.screenY, true);
        drag.parentCoords = parentCoords;
        if (parentCoords) {
          // Out-of-process frames cannot reliably retain pointer capture after
          // the cursor leaves them. This temporary parent surface takes over
          // without moving keyboard focus away from the originating frame.
          showShield('grabbing', 'meowlchess-drag-shield');
        }
        return true;
      }
      if (!drag?.remote || data.pointerId !== drag.id) return false;
      if (data.phase === 'cancel') finishDrag(true);
      else {
        if (drag.parentCoords !== parentCoords) return false;
        const x = parentCoords ? data.parentX : data.screenX, y = parentCoords ? data.parentY : data.screenY;
        move(drag.left + x - drag.x, drag.top + y - drag.y);
        if (data.phase === 'end') finishDrag();
      }
      return true;
    }
    function parentPointer(event) {
      if (resize && event.pointerId === resize.id) {
        if (event.type === 'pointermove' && event.pointerType === 'mouse' && !(event.buttons & 1)) { finishResize(true); return; }
        if (event.type === 'pointermove') resizeMove(event); else resizeUp(event);
        return;
      }
      if (!drag?.remote || !drag.parentCoords || event.pointerId !== drag.id) return;
      if (event.type === 'pointercancel') { finishDrag(true); return; }
      if (event.type === 'pointermove' && event.pointerType === 'mouse' && !(event.buttons & 1)) { finishDrag(true); return; }
      event.preventDefault(); event.stopPropagation();
      move(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
      if (event.type === 'pointerup') finishDrag();
    }
    function windowBlur() { if (drag) finishDrag(true); if (resize) finishResize(true); }
    function escape(event) {
      if (event.key === 'Escape' && resize) { event.preventDefault(); event.stopPropagation(); finishResize(true); return; }
      if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finishDrag(true); }
    }
    function nativeDrag(event) { if (!blockedTarget(event)) event.preventDefault(); }
    function keyDown(event) {
      if (event.target === handle) delete handle.dataset.pointerFocus;
      if (event.target !== handle || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finishDrag(true); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      finishDrag();
      if (event.key === 'Home') { preferred = null; place(); }
      else {
        const rect = host.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
        move(rect.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), rect.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
      }
      remember();
    }
    function clearPointerFocus(event) { delete event.currentTarget.dataset.pointerFocus; }
    surface.addEventListener('pointerdown', pointerDown);
    surface.addEventListener('pointermove', pointerMove);
    surface.addEventListener('pointerup', pointerUp);
    surface.addEventListener('pointercancel', pointerUp);
    surface.addEventListener('lostpointercapture', lostCapture);
    surface.addEventListener('dragstart', nativeDrag);
    handle.addEventListener('keydown', keyDown);
    handle.addEventListener('blur', clearPointerFocus);
    for (const grip of resizeGrips) for (const [name, listener] of [['pointerdown', resizeDown], ['pointermove', resizeMove], ['pointerup', resizeUp], ['pointercancel', resizeUp], ['lostpointercapture', resizeLost], ['keydown', resizeKey], ['blur', clearPointerFocus], ['dblclick', resetSize]]) grip.addEventListener(name, listener);
    document.addEventListener('keydown', escape, true);
    for (const name of ['pointermove', 'pointerup', 'pointercancel']) document.addEventListener(name, parentPointer, true);
    window.addEventListener('blur', windowBlur);
    window.addEventListener('resize', queuePlace);
    window.visualViewport?.addEventListener('resize', queuePlace);
    window.visualViewport?.addEventListener('scroll', queuePlace);
    const observer = new ResizeObserver(queuePlace); observer.observe(host);
    place();
    if (!positions.has(key)) {
      if (!loads.has(key)) {
        try { loads.set(key, Promise.resolve(chrome.storage.local.get(key)).then(values => valid(values?.[key]) ? { left: values[key].left, top: values[key].top } : null).catch(() => null)); }
        catch { loads.set(key, Promise.resolve(null)); }
      }
      void loads.get(key).then(value => {
        if (!positions.has(key)) positions.set(key, value);
        if (!destroyed && !changed && !drag && !resize) { preferred = positions.get(key); place(); }
      });
    }
    if (resizeGrips.length && !sizes.has(sizeKey)) {
      if (!sizeLoads.has(sizeKey)) {
        try { sizeLoads.set(sizeKey, Promise.resolve(chrome.storage.local.get(sizeKey)).then(values => validSize(values?.[sizeKey]) ? { width: values[sizeKey].width, height: values[sizeKey].height } : null).catch(() => null)); }
        catch { sizeLoads.set(sizeKey, Promise.resolve(null)); }
      }
      void sizeLoads.get(sizeKey).then(value => {
        if (!sizes.has(sizeKey)) sizes.set(sizeKey, value);
        if (!destroyed && !sizeChanged && !resize && !drag) { preferredSize = sizes.get(sizeKey); place(); }
      });
    }
    return {
      frameDrag,
      destroy() {
        if (destroyed) return;
        finishDrag(true); finishResize(true); save(); destroyed = true;
        cancelAnimationFrame(repaint); observer.disconnect();
        window.removeEventListener('resize', queuePlace);
        window.visualViewport?.removeEventListener('resize', queuePlace);
        window.visualViewport?.removeEventListener('scroll', queuePlace);
        for (const [name, listener] of [['pointerdown', pointerDown], ['pointermove', pointerMove], ['pointerup', pointerUp], ['pointercancel', pointerUp], ['lostpointercapture', lostCapture], ['dragstart', nativeDrag]]) surface.removeEventListener(name, listener);
        handle.removeEventListener('keydown', keyDown);
        handle.removeEventListener('blur', clearPointerFocus); delete handle.dataset.pointerFocus;
        for (const grip of resizeGrips) {
          for (const [name, listener] of [['pointerdown', resizeDown], ['pointermove', resizeMove], ['pointerup', resizeUp], ['pointercancel', resizeUp], ['lostpointercapture', resizeLost], ['keydown', resizeKey], ['blur', clearPointerFocus], ['dblclick', resetSize]]) grip.removeEventListener(name, listener);
          delete grip.dataset.pointerFocus;
          for (const [name, value] of Object.entries(gripOriginal.get(grip))) { if (value === null) grip.removeAttribute(name); else grip.setAttribute(name, value); }
        }
        document.removeEventListener('keydown', escape, true);
        for (const name of ['pointermove', 'pointerup', 'pointercancel']) document.removeEventListener(name, parentPointer, true);
        window.removeEventListener('blur', windowBlur);
        if (surface !== handle) { if (surfaceStyle === null) surface.removeAttribute('style'); else surface.setAttribute('style', surfaceStyle); }
        for (const [name, value] of [['role', original.role], ['tabindex', original.tabindex], ['aria-label', original.label], ['title', original.title], ['aria-keyshortcuts', original.shortcuts], ['style', original.style]]) {
          if (value === null) handle.removeAttribute(name); else handle.setAttribute(name, value);
        }
      }
    };
  };
})();
