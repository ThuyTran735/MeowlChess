// The summary lives in a separate extension frame. Hand the gesture to the
// parent's temporary drag surface so it continues outside this frame.
export function installFrameDrag({ send, active = () => true }) {
  const root = document.documentElement;
  const controls = 'button,a,input,select,textarea,summary,label,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="slider"],[role="scrollbar"],[role="checkbox"],[role="switch"],[role="textbox"],[role="combobox"],[tabindex]:not([tabindex="-1"]),[data-no-drag]';
  let pointer = null, destroyed = false;
  function scrollbar(event) {
    if (event.clientX >= root.clientWidth || event.clientY >= root.clientHeight) return true;
    for (let element = event.target; element instanceof Element; element = element.parentElement) {
      const rect = element.getBoundingClientRect();
      if (element.scrollHeight > element.clientHeight && element.offsetWidth > element.clientWidth + element.clientLeft * 2
        && event.clientX >= rect.left + element.clientLeft + element.clientWidth) return true;
      if (element.scrollWidth > element.clientWidth && element.offsetHeight > element.clientHeight + element.clientTop * 2
        && event.clientY >= rect.top + element.clientTop + element.clientHeight) return true;
    }
    return false;
  }
  function post(phase, event) {
    send({ phase, pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY,
      clientX: event.clientX, clientY: event.clientY, viewportWidth: innerWidth, viewportHeight: innerHeight });
  }
  function down(event) {
    if (destroyed || !active() || !event.isTrusted || !event.isPrimary || event.button !== 0 || pointer
      || !(event.target instanceof Element) || event.target.closest(controls) || scrollbar(event)) return;
    event.preventDefault(); event.stopPropagation();
    pointer = { pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY };
    root.dataset.panelDragging = 'true';
    post('start', event);
  }
  function move(event) {
    if (event.pointerId !== pointer?.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    pointer.screenX = event.screenX; pointer.screenY = event.screenY;
    pointer.clientX = event.clientX; pointer.clientY = event.clientY;
    post('move', event);
  }
  function finish(cancel, event = pointer) {
    if (!pointer || event?.pointerId !== pointer.pointerId) return;
    post(cancel ? 'cancel' : 'end', event);
    pointer = null; delete root.dataset.panelDragging;
  }
  function up(event) { if (event.pointerId === pointer?.pointerId) { event.preventDefault(); event.stopPropagation(); finish(false, event); } }
  function cancel(event) { finish(true, event?.pointerId === undefined ? pointer : event); }
  function key(event) {
    if (event.key === 'Escape' && pointer) { event.preventDefault(); event.stopPropagation(); finish(true); }
  }
  const events = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['lostpointercapture', cancel], ['keydown', key]];
  for (const [name, listener] of events) document.addEventListener(name, listener, true);
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  return {
    endFromParent(pointerId) {
      if (pointerId !== pointer?.pointerId) return;
      pointer = null; delete root.dataset.panelDragging;
    },
    destroy() {
      if (destroyed) return;
      finish(true); destroyed = true;
      for (const [name, listener] of events) document.removeEventListener(name, listener, true);
      window.removeEventListener('blur', cancel); window.removeEventListener('pagehide', cancel);
    },
  };
}
