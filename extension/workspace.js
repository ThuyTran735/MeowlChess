// Navigation and disclosure behavior for the review workspace. Review state
// remains owned by review.js; these controls only reveal existing UI.
const settings = document.getElementById('review-settings');
const trigger = settings.querySelector('summary');
function closeSettings(restoreFocus = false) {
  settings.open = false;
  if (restoreFocus) trigger.focus({ preventScroll: true });
}
document.getElementById('close-settings').addEventListener('click', () => closeSettings(true));
document.addEventListener('pointerdown', event => {
  if (settings.open && !settings.contains(event.target)) closeSettings();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && settings.open) {
    event.preventDefault(); event.stopPropagation(); closeSettings(true);
  }
});
document.addEventListener('focusin', event => {
  if (settings.open && !settings.contains(event.target)) closeSettings();
});
settings.addEventListener('toggle', () => {
  trigger.setAttribute('aria-expanded', String(settings.open));
});
trigger.setAttribute('aria-expanded', String(settings.open));

for (const button of document.querySelectorAll('[data-library-jump]')) {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.libraryJump);
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    const control = target.querySelector('summary, input, select, button');
    control?.focus({ preventScroll: true });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      target.animate([{ outlineColor: '#a8bd94aa' }, { outlineColor: 'transparent' }], { duration: 650 });
    }
  });
}
