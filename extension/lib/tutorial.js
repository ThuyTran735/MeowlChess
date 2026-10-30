import { createGuidedTour } from './guided-tour.js';

const PREFERENCE = 'tutorialNeverShowAgain';
const WEB_PREFERENCE = 'meowlchess.tutorialNeverShowAgain';

async function readPreference() {
  if (globalThis.chrome?.storage?.local) {
    const stored = await chrome.storage.local.get(PREFERENCE);
    return stored[PREFERENCE] === true;
  }
  return localStorage.getItem(WEB_PREFERENCE) === 'true';
}

async function writePreference(value) {
  if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [PREFERENCE]: value });
  else localStorage.setItem(WEB_PREFERENCE, String(value));
}

/** A short, optional guide. Opening it never selects or analyzes a game. */
export function createTutorial({ onOpen = () => {}, onSaveError = () => {} } = {}) {
  const dialog = document.getElementById('tutorial-dialog');
  const guide = createGuidedTour(dialog);
  const opener = document.getElementById('open-tutorial');
  const progress = document.getElementById('tutorial-progress');
  const never = document.getElementById('tutorial-never');
  const back = document.getElementById('tutorial-back');
  const next = document.getElementById('tutorial-next');
  const status = document.getElementById('tutorial-storage-status');
  const steps = [...dialog.querySelectorAll('[data-tutorial-step]')];
  let step = 0, ready = false, optedOut = false, closing = false;
  let saveQueue = Promise.resolve(), completion = null, resolveCompletion = null;
  let saveError = '';

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function renderStep(focus = false) {
    steps.forEach((section, index) => { section.hidden = index !== step; });
    progress.textContent = `${step + 1} of ${steps.length}`;
    back.hidden = step === 0;
    next.textContent = step === steps.length - 1 ? 'Get started' : 'Next';
    if (dialog.open) guide.showStep(step);
    if (focus) steps[step].querySelector('h3').focus({ preventScroll: true });
  }

  function open() {
    if (!ready) return Promise.resolve();
    if (dialog.open) return completion;
    step = 0; closing = false; never.disabled = false; never.checked = optedOut;
    renderStep();
    completion = new Promise(resolve => { resolveCompletion = resolve; });
    onOpen();
    dialog.showModal();
    guide.open(step);
    steps[0].querySelector('h3').focus({ preventScroll: true });
    return completion;
  }

  async function dismiss() {
    if (closing || !dialog.open) return;
    closing = true; never.disabled = true;
    // Finish the last checkbox write before startup continues or the page reloads.
    await saveQueue;
    dialog.close();
  }

  never.addEventListener('change', () => {
    const choice = never.checked;
    optedOut = choice;
    saveQueue = saveQueue.then(async () => {
      try { await writePreference(choice); saveError = ''; showStatus(''); }
      catch {
        saveError = 'Your tutorial preference could not be saved. It may appear again next time.';
        showStatus(saveError);
      }
    });
  });
  back.addEventListener('click', () => { if (!closing && step > 0) { step--; renderStep(true); } });
  next.addEventListener('click', () => {
    if (closing) return;
    if (step < steps.length - 1) { step++; renderStep(true); }
    else dismiss();
  });
  document.getElementById('tutorial-skip').addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => {
    closing = false; never.disabled = false;
    guide.close();
    if (saveError) onSaveError(saveError);
    const resolve = resolveCompletion;
    resolveCompletion = null; completion = null;
    resolve?.();
  });
  opener.addEventListener('click', open);

  return {
    get ready() { return ready; },
    async start() {
      try { optedOut = await readPreference(); }
      catch { showStatus('Your saved tutorial preference could not be read. You can still skip this guide.'); }
      ready = true;
      dialog.dataset.ready = 'true';
      if (!optedOut) await open();
    }
  };
}
