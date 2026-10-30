const TARGETS = ['#library-toggle', '#analyze-button', '.review-tabs'];
const NS = 'http://www.w3.org/2000/svg';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function svgElement(name, attributes) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

// A visual copy lets the spotlight zoom a control without moving or enabling it.
function controlPreview(target) {
  const clone = target.cloneNode(true);
  const originals = [target, ...target.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  copies.forEach((copy, index) => {
    const style = getComputedStyle(originals[index]);
    for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property));
    copy.removeAttribute('id');
    copy.removeAttribute('autofocus');
    copy.removeAttribute('aria-controls');
    copy.tabIndex = -1;
    copy.style.animation = 'none'; copy.style.transition = 'none';
    if ('disabled' in copy) copy.disabled = true;
  });
  Object.assign(clone.style, { position: 'static', margin: '0', minWidth: '0', maxWidth: 'none', minHeight: '0', maxHeight: 'none', opacity: '1', transformOrigin: 'top left' });
  return clone;
}

export function createGuidedTour(dialog) {
  const card = document.getElementById('tutorial-card');
  const highlight = document.getElementById('tutorial-highlight');
  const overlay = document.getElementById('tutorial-overlay');
  let step = 0, frame = 0, savedView = null;

  function place(animate = false) {
    if (!dialog.open || !savedView) return;
    const target = document.querySelector(TARGETS[step]);
    const rect = target.getBoundingClientRect();
    const width = innerWidth, height = innerHeight;
    const scale = Math.min(1.12, (width - 32) / rect.width, (height - 32) / rect.height);
    const box = { width: rect.width * scale, height: rect.height * scale };
    box.left = clamp(rect.left - (box.width - rect.width) / 2, 12, width - box.width - 12);
    box.top = clamp(rect.top - (box.height - rect.height) / 2, 12, height - box.height - 12);
    box.right = box.left + box.width; box.bottom = box.top + box.height;
    highlight.dataset.target = TARGETS[step];
    Object.assign(highlight.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    const clone = controlPreview(target);
    Object.assign(clone.style, { width: `${rect.width}px`, height: `${rect.height}px`, transform: `scale(${scale})` });
    highlight.replaceChildren(clone);

    const gap = height < 550 ? 32 : 46;
    const cardWidth = Math.min(440, width - 32);
    const cardTop = box.bottom + gap;
    Object.assign(card.style, { width: `${cardWidth}px`, left: `${clamp(box.left + box.width / 2 - cardWidth / 2, 16, width - cardWidth - 16)}px`, top: `${cardTop}px`, maxHeight: `${Math.max(0, height - cardTop - 16)}px` });
    const cardRect = card.getBoundingClientRect();
    const startX = clamp(box.left + box.width / 2, cardRect.left + 24, cardRect.right - 24);
    const startY = cardRect.top - 8;
    const endX = box.left + box.width / 2, endY = box.bottom + 9;
    const midY = (startY + endY) / 2;

    overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const defs = svgElement('defs', {});
    const mask = svgElement('mask', { id: 'tutorial-cutout', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width, height });
    mask.append(svgElement('rect', { width, height, fill: 'white' }), svgElement('rect', { x: box.left - 7, y: box.top - 7, width: box.width + 14, height: box.height + 14, rx: 9, fill: 'black' }));
    const marker = svgElement('marker', { id: 'tutorial-arrowhead', markerWidth: 9, markerHeight: 9, refX: 7, refY: 4.5, orient: 'auto', markerUnits: 'userSpaceOnUse' });
    marker.append(svgElement('path', { d: 'M 1 1 L 7 4.5 L 1 8', fill: 'none', stroke: '#b7d888', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    defs.append(mask, marker);
    const arrow = svgElement('path', { id: 'tutorial-arrow', d: `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`, fill: 'none', stroke: '#b7d888', 'stroke-width': 3, 'stroke-linecap': 'round', 'marker-end': 'url(#tutorial-arrowhead)' });
    overlay.replaceChildren(defs, svgElement('rect', { width, height, fill: '#090a07', opacity: .73, mask: 'url(#tutorial-cutout)' }), arrow);
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.classList.remove('tutorial-enter'); highlight.classList.remove('tutorial-enter');
      void card.offsetWidth;
      card.classList.add('tutorial-enter'); highlight.classList.add('tutorial-enter');
      arrow.style.setProperty('--tutorial-arrow-length', arrow.getTotalLength());
      arrow.classList.add('tutorial-arrow');
    }
  }

  function showStep(index) {
    step = index;
    if (!dialog.open || !savedView) return;
    // Extra temporary scroll space keeps every target near the top on phones.
    document.body.style.paddingBottom = `${innerHeight}px`;
    const target = document.querySelector(TARGETS[step]);
    const top = target.getBoundingClientRect().top + scrollY;
    window.scrollTo({ top: Math.max(0, top - 24), left: savedView.x, behavior: 'instant' });
    cancelAnimationFrame(frame); frame = 0;
    place(true);
  }

  window.addEventListener('resize', () => {
    if (!dialog.open || !savedView) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; showStep(step); });
  });
  return {
    open(index) {
      savedView = { x: scrollX, y: scrollY, padding: document.body.style.getPropertyValue('padding-bottom'), priority: document.body.style.getPropertyPriority('padding-bottom') };
      showStep(index);
    },
    showStep,
    close() {
      cancelAnimationFrame(frame); frame = 0;
      if (!savedView) return;
      const original = savedView; savedView = null;
      if (original.padding) document.body.style.setProperty('padding-bottom', original.padding, original.priority);
      else document.body.style.removeProperty('padding-bottom');
      window.scrollTo({ left: original.x, top: original.y, behavior: 'instant' });
      highlight.replaceChildren(); overlay.replaceChildren();
      card.classList.remove('tutorial-enter'); highlight.classList.remove('tutorial-enter');
    }
  };
}
