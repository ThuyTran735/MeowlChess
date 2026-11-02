import { COACHES, answerCoach, createCoachWalkthrough } from './coach.js';
import { coachPortraitUrl } from './coach-portraits.js';
import { createCoachMotion } from './coach-motion.js';
import { createCoachSounds } from './coach-sounds.js';

const STORAGE_KEY = 'coachPreferences';
const DEFAULT_QUESTIONS = ['Summarize this game', 'What was the biggest mistake?', 'What should I practice?', 'Show Brilliant and Great moves'];
const FINAL_RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);
const MAX_PAIRS = 12;
const RATINGS = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder']);
function ratingIcon(rating) {
  if (!RATINGS.has(rating)) return null;
  const image = node('img', 'coach-rating-icon');
  image.src = new URL(`../move-icons/${rating.toLowerCase()}.svg`, import.meta.url).href;
  image.alt = ''; image.width = 18; image.height = 18; image.draggable = false;
  return image;
}
function ratedHeading(element, text, rating) {
  const icon = ratingIcon(rating);
  if (icon) element.replaceChildren(icon, document.createTextNode(text));
  else element.textContent = text;
}
function portrait(coachId, className, size) {
  const image = node('img', className);
  image.src = coachPortraitUrl(coachId);
  image.width = size; image.height = size; image.alt = ''; image.draggable = false;
  return image;
}
let nextId = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function preferences(value) {
  return {
    coach: COACHES.some(coach => coach.id === value?.coach) ? value.coach : COACHES[0].id,
    perspective: ['w', 'b', 'both'].includes(value?.perspective) ? value.perspective : 'both',
    motion: typeof value?.motion === 'boolean' ? value.motion : true,
    sounds: value?.sounds === true,
    volume: typeof value?.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 0.8,
    commentary: typeof value?.commentary === 'boolean' ? value.commentary : true,
  };
}

function moveLabel(move) {
  const number = Number(move?.before?.split(' ')[5]);
  return `${Number.isInteger(number) && number > 0 ? number : '?'}${move?.color === 'b' ? '...' : '.'} ${move?.san || ''}`;
}

/** A bounded, local conversation about one completed review. Chats are not persisted. */
export function createCoachView(root, { onNavigate, moveReactionTarget = null, companionTarget = null } = {}) {
  if (!(root instanceof HTMLElement)) throw new TypeError('A coach container is required.');
  const companion = companionTarget?.container instanceof HTMLElement && companionTarget.image instanceof HTMLImageElement
    && companionTarget.bubble instanceof HTMLElement && companionTarget.heading instanceof HTMLElement && companionTarget.text instanceof HTMLElement ? companionTarget : null;
  const id = `MeowlChess-coach-${++nextId}`;
  const events = new AbortController();
  const listen = (element, type, listener) => element.addEventListener(type, listener, { signal: events.signal });
  const storage = globalThis.chrome?.storage?.local;
  const storageEvents = globalThis.chrome?.storage?.onChanged;
  let selected = preferences(), context = { game: null, result: null, ply: 0, blockedReason: '', active: false, moveReactionsActive: false };
  let identityPgn = '', identityResult = null, revision = 0, disposed = false, submitting = false;
  let pendingPreferences = {}, preferenceQueue = Promise.resolve(), conversation = [];
  let previousPly = null, celebratedPly = null;
  let lastGreeting = -Infinity, lastPreview = -Infinity;
  let walkthroughTimer = null, walkthroughToken = 0, walkthroughPending = '', walkthroughKey = '', walkthroughAnswer = null, walkthroughSource = null;
  const reactionsVisible = () => !disposed && !document.hidden && !unavailableReason() && (context.active || context.moveReactionsActive);
  const companionReady = () => !!companion && !companion.container.hidden && !disposed && !document.hidden && !unavailableReason();
  const effectsVisible = () => reactionsVisible() || companionReady();
  const motion = createCoachMotion({ isEnabled: () => selected.motion, isVisible: effectsVisible });
  const sounds = createCoachSounds({ isEnabled: () => selected.sounds, isVisible: effectsVisible, getVolume: () => selected.volume });
  function syncIdle() {
    if (!companion) return;
    if (companionReady() && selected.motion) motion.setIdle(companion.image, { coachId: selected.coach });
    else motion.stop();
  }
  function stopReactions() { motion.stop(); sounds.stop(); syncIdle(); }
  function reactionForMove(ply) {
    const move = context.result?.moves?.[ply - 1];
    if (!move || (selected.perspective !== 'both' && selected.perspective !== move.color)) return 'talk';
    if (move.label === 'Brilliant') return 'brilliant';
    if (['Great', 'Best'].includes(move.label)) return 'celebrate';
    if (['Inaccuracy', 'Mistake', 'Miss', 'Blunder'].includes(move.label)) return 'curious';
    return 'talk';
  }
  function brilliantMove(ply) {
    const move = context.result?.moves?.[ply - 1];
    return move?.label === 'Brilliant' && (selected.perspective === 'both' || selected.perspective === move.color);
  }
  function reactToAnswer(answer, reply) {
    if (!context.active || !reactionsVisible()) return;
    stopReactions();
    const kind = Number.isInteger(answer.subjectPly) ? reactionForMove(answer.subjectPly) : 'talk';
    const grade = context.result?.moves?.[answer.subjectPly - 1]?.label;
    motion.react(avatar, { kind, coachId: selected.coach, grade });
    const image = reply.querySelector('.coach-message-avatar');
    if (image) motion.react(image, { kind, coachId: selected.coach, grade });
    void sounds.play({ kind, coach: selected.coach });
  }
  function renderMoveReaction({ mayCelebrate = false } = {}) {
    const eligible = !unavailableReason() && brilliantMove(context.ply);
    if (moveReactionTarget?.container && (moveContent.hidden || !showingWalkthrough())) {
      moveReactionTarget.container.hidden = !(eligible && context.moveReactionsActive && selected.motion);
      moveContent.hidden = true; moveFallback.hidden = false;
    }
    if (!reactionsVisible()) { stopReactions(); return; }
    if (!eligible) {
      if (mayCelebrate) celebratedPly = context.ply;
      return;
    }
    if (!mayCelebrate || celebratedPly === context.ply) return;
    celebratedPly = context.ply;
    const image = companion?.image || (context.active ? avatar : moveReactionTarget?.image);
    if (!image) return;
    stopReactions();
    motion.react(image, { kind: 'brilliant', coachId: selected.coach, grade: 'Brilliant' });
    void sounds.play({ kind: 'brilliant', coach: selected.coach });
  }

  root.classList.add('coach-view');
  const heading = node('div', 'coach-heading');
  const avatar = companion?.image || portrait(selected.coach, 'coach-avatar', 72);
  const identity = node('div', 'coach-identity');
  const coachLabel = node('label', 'coach-label', 'Your coach');
  coachLabel.htmlFor = `${id}-choice`;
  const choice = node('select', 'coach-select'); choice.id = coachLabel.htmlFor;
  for (const coach of COACHES) {
    const option = node('option', '', coach.name); option.value = coach.id; choice.append(option);
  }
  identity.append(coachLabel, choice);
  const clear = node('button', 'coach-clear', 'Clear chat'); clear.type = 'button';
  clear.title = 'Clear this conversation';
  if (!companion) heading.append(avatar);
  heading.append(identity, clear);
  const description = node('p', 'coach-description');
  const controls = node('div', 'coach-controls');
  const sideLabel = node('label', 'coach-label', 'Focus on'); sideLabel.htmlFor = `${id}-perspective`;
  const side = node('select', 'coach-perspective'); side.id = sideLabel.htmlFor;
  for (const [value, label] of [['both', 'Both players'], ['w', 'White'], ['b', 'Black']]) {
    const option = node('option', '', label); option.value = value; side.append(option);
  }
  controls.append(sideLabel, side);
  const reactionSettings = node('div', 'coach-reaction-settings');
  const motionLabel = node('label', '', '');
  const motionToggle = node('input', 'coach-motion-toggle'); motionToggle.type = 'checkbox';
  motionLabel.append(motionToggle, document.createTextNode('Coach animations'));
  const soundLabel = node('label', '', '');
  const soundToggle = node('input', 'coach-sound-toggle'); soundToggle.type = 'checkbox';
  soundLabel.append(soundToggle, document.createTextNode('Meow sounds'));
  const commentaryLabel = node('label');
  const commentaryToggle = node('input', 'coach-commentary-toggle'); commentaryToggle.type = 'checkbox';
  commentaryLabel.append(commentaryToggle, document.createTextNode('Explain moves automatically'));
  reactionSettings.append(commentaryLabel, motionLabel, soundLabel);
  const volumeControls = node('div', 'coach-volume-controls');
  const volumeLabel = node('label', 'coach-label', 'Meow volume'); volumeLabel.htmlFor = `${id}-volume`;
  const volume = node('input', 'coach-volume'); volume.type = 'range'; volume.id = volumeLabel.htmlFor;
  volume.min = '0'; volume.max = '100'; volume.step = '5';
  const volumeValue = node('output', 'coach-volume-value'); volumeValue.htmlFor = volume.id;
  const soundPreview = node('button', 'coach-sound-preview', 'Preview'); soundPreview.type = 'button';
  soundPreview.setAttribute('aria-label', 'Preview a meow at this volume');
  volumeControls.append(volumeLabel, volume, volumeValue, soundPreview);
  const preferenceStatus = node('p', 'coach-preference-status'); preferenceStatus.setAttribute('role', 'status');
  const position = node('p', 'coach-context');
  const walkthrough = node('section', 'coach-walkthrough'); walkthrough.hidden = true;
  walkthrough.setAttribute('aria-label', 'Coach on this move'); walkthrough.setAttribute('aria-live', 'polite'); walkthrough.setAttribute('aria-atomic', 'true');
  const walkthroughHeading = node('strong', 'coach-walkthrough-heading');
  const walkthroughText = node('p', 'coach-walkthrough-text');
  walkthrough.append(walkthroughHeading, walkthroughText);
  const moveContent = node('div', 'move-coach-comment'); moveContent.hidden = true;
  const moveHeading = node('strong', 'coach-walkthrough-heading');
  const moveText = node('p', 'coach-walkthrough-text');
  moveContent.append(moveHeading, moveText);
  const moveFallback = node('span', '', 'Brilliant!');
  if (moveReactionTarget?.container && moveReactionTarget.image) {
    moveReactionTarget.container.removeAttribute('aria-hidden');
    moveReactionTarget.container.setAttribute('aria-label', 'Coach on this move');
    moveReactionTarget.container.setAttribute('aria-live', 'polite');
    moveReactionTarget.container.setAttribute('aria-atomic', 'true');
    moveReactionTarget.container.replaceChildren(moveReactionTarget.image, moveContent, moveFallback);
  }
  const blocked = node('p', 'coach-blocked'); blocked.setAttribute('role', 'status');
  const welcome = node('div', 'coach-welcome');
  welcome.append(node('h3', '', 'Let’s look at your game'), node('p', '', 'Ask about a move, an opening, or a turning point. Your coach uses the engine review already on your device.'));
  const log = node('div', 'coach-log');
  log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Conversation with your coach');
  log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-relevant', 'additions'); log.tabIndex = 0;
  const suggestions = node('div', 'coach-suggestions'); suggestions.setAttribute('aria-label', 'Suggested questions');
  const form = node('form', 'coach-form');
  const questionLabel = node('label', 'coach-label', 'Ask your coach'); questionLabel.htmlFor = `${id}-question`;
  const question = node('textarea', 'coach-question'); question.id = questionLabel.htmlFor;
  question.rows = 2; question.maxLength = 500; question.placeholder = 'Ask about this game…';
  question.autocomplete = 'off'; question.setAttribute('aria-describedby', `${id}-scope`);
  const formActions = node('div', 'coach-form-actions');
  const keyboardHint = node('span', 'coach-key-hint', 'Enter to send · Shift + Enter for a new line');
  const send = node('button', 'coach-send', 'Ask'); send.type = 'submit';
  formActions.append(keyboardHint, send); form.append(questionLabel, question, formActions);
  const status = node('p', 'coach-status'); status.setAttribute('role', 'status');
  const scope = node('p', 'coach-scope', 'Local answers to common game questions, not a general AI chat. Messages stay in this tab and clear when you change games.');
  scope.id = `${id}-scope`;
  root.replaceChildren(heading, description, controls, reactionSettings, volumeControls, preferenceStatus, position, blocked, walkthrough, welcome, log, suggestions, form, status, scope);
  const greet = companion?.container.querySelector('.coach-companion-greet');

  function unavailableReason() {
    if (context.blockedReason) return String(context.blockedReason);
    if (!context.result || !Array.isArray(context.result.moves) || !FINAL_RESULTS.has(context.result.game?.headers?.Result)) {
      return 'Finish reviewing a completed game to talk with your coach.';
    }
    return '';
  }

  function renderCompanion() {
    if (!companion) return;
    const completed = !!context.result && Array.isArray(context.result.moves) && context.result.moves.length > 0
      && FINAL_RESULTS.has(context.result.game?.headers?.Result);
    companion.container.hidden = !completed;
    if (!completed || !reactionsVisible()) companion.bubble.hidden = true;
    if (greet) greet.disabled = !companionReady();
    syncIdle();
  }

  function cancelWalkthrough() {
    clearTimeout(walkthroughTimer); walkthroughTimer = null; walkthroughPending = ''; walkthroughToken++;
  }

  function showingWalkthrough() {
    const move = context.result?.moves?.[context.ply - 1];
    return selected.commentary && reactionsVisible() && !!move && (selected.perspective === 'both' || selected.perspective === move.color);
  }

  function showWalkthrough(answer) {
    const coach = COACHES.find(item => item.id === selected.coach) || COACHES[0];
    ratedHeading(walkthroughHeading, answer.heading, answer.label);
    walkthroughText.textContent = answer.text;
    walkthrough.dataset.ply = String(answer.subjectPly);
    walkthrough.hidden = !!companion || !context.active;
    if (companion) {
      ratedHeading(companion.heading, answer.heading, answer.label);
      companion.text.textContent = answer.text;
      companion.bubble.dataset.ply = String(answer.subjectPly);
      companion.bubble.hidden = false;
    }
    if (moveReactionTarget?.container) {
      ratedHeading(moveHeading, `${coach.name} · ${answer.heading}`, answer.label);
      moveText.textContent = answer.text;
      moveContent.dataset.ply = String(answer.subjectPly);
      moveContent.hidden = false; moveFallback.hidden = true;
      moveReactionTarget.container.hidden = !context.moveReactionsActive;
    }
    welcome.hidden = true;
  }

  function renderWalkthrough({ maySpeak = false } = {}) {
    if (!showingWalkthrough()) {
      cancelWalkthrough(); walkthrough.hidden = true;
      if (companion) companion.bubble.hidden = true;
      return;
    }
    const key = `${context.ply}:${selected.coach}:${selected.perspective}`;
    if (walkthroughKey === key && walkthroughAnswer) { showWalkthrough(walkthroughAnswer); return; }
    if (walkthroughPending === key) return;
    cancelWalkthrough();
    walkthrough.hidden = true; moveContent.hidden = true; moveFallback.hidden = false;
    if (companion) companion.bubble.hidden = true;
    if (moveReactionTarget?.container && !brilliantMove(context.ply)) moveReactionTarget.container.hidden = true;
    walkthroughPending = key;
    const token = walkthroughToken;
    walkthroughTimer = setTimeout(() => {
      walkthroughTimer = null; walkthroughPending = '';
      if (disposed || token !== walkthroughToken || !showingWalkthrough()) return;
      walkthroughSource ||= createCoachWalkthrough({ result: context.result, game: context.game });
      const answer = walkthroughSource.describe({ ply: context.ply, coach: selected.coach, perspective: selected.perspective });
      if (!answer) return;
      walkthroughKey = key; walkthroughAnswer = answer;
      showWalkthrough(answer);
      // Brilliant uses the existing immediate celebration; never replay it for the comment.
      if (maySpeak && !brilliantMove(context.ply)) {
        const image = companion?.image || (context.active ? avatar : moveReactionTarget?.image);
        if (image) {
          stopReactions();
          const kind = reactionForMove(context.ply);
          motion.react(image, { kind, coachId: selected.coach, grade: answer.label });
          void sounds.play({ kind, coach: selected.coach });
        }
      }
    }, 180);
  }

  function renderPreferences() {
    choice.value = selected.coach; side.value = selected.perspective;
    motionToggle.checked = selected.motion; soundToggle.checked = selected.sounds; commentaryToggle.checked = selected.commentary;
    volumeControls.hidden = false;
    volume.value = String(Math.round(selected.volume * 100)); volumeValue.textContent = `${volume.value}%`;
    volume.setAttribute('aria-valuetext', selected.volume ? `${volume.value} percent` : 'Muted');
    soundPreview.disabled = !selected.sounds || !selected.volume || !effectsVisible();
    soundPreview.title = !selected.sounds ? 'Turn on Meow sounds to preview' : !selected.volume ? 'Raise the volume to preview' : 'Play a cat sound at this volume';
    if (!selected.motion) motion.stop();
    if (!selected.sounds) sounds.stop();
    root.dataset.coach = selected.coach;
    const coach = COACHES.find(item => item.id === selected.coach) || COACHES[0];
    const portraitUrl = coachPortraitUrl(coach.id);
    if (avatar.src !== portraitUrl) { stopReactions(); avatar.src = portraitUrl; }
    if (moveReactionTarget?.image && moveReactionTarget.image.src !== portraitUrl) moveReactionTarget.image.src = portraitUrl;
    description.textContent = coach.description;
    if (companion) {
      companion.container.dataset.coach = selected.coach;
      if (companion.name) companion.name.textContent = coach.name;
      if (greet) { greet.setAttribute('aria-label', `Say hello to ${coach.name}`); greet.title = `Tap to say hello to ${coach.name}`; }
    }
    renderCompanion(); renderWalkthrough(); renderMoveReaction();
  }

  function renderControls() {
    const reason = unavailableReason(), available = !reason;
    soundPreview.disabled = !selected.sounds || !selected.volume || !effectsVisible();
    blocked.textContent = reason; blocked.hidden = available;
    position.hidden = !available; welcome.hidden = !available || !!conversation.length || (showingWalkthrough() && !!walkthroughAnswer && walkthroughAnswer.subjectPly === context.ply);
    log.hidden = !available || !conversation.length;
    form.hidden = !available; suggestions.hidden = !available;
    question.disabled = !available || submitting;
    send.disabled = !available || submitting || !question.value.trim();
    clear.disabled = !conversation.length && !question.value;
    if (available) {
      const move = context.result.moves[context.ply - 1];
      position.textContent = move ? `Board: after ${moveLabel(move)}` : 'Board: starting position';
    } else position.textContent = '';
  }

  function renderSuggestions(values = DEFAULT_QUESTIONS) {
    const safe = Array.isArray(values) ? [...new Set(values.filter(value => typeof value === 'string' && value.trim() && value.length <= 100))].slice(0, 4) : [];
    suggestions.replaceChildren();
    for (const value of safe.length ? safe : DEFAULT_QUESTIONS) {
      const button = node('button', 'coach-suggestion', value); button.type = 'button'; button.dataset.question = value;
      // Delegated listeners below keep removed suggestion buttons collectible.
      suggestions.append(button);
    }
  }

  function resetConversation(announce = false) {
    stopReactions(); cancelWalkthrough(); conversation = []; previousPly = null;
    log.replaceChildren(); question.value = '';
    status.textContent = announce ? 'Chat cleared.' : '';
    renderSuggestions(); renderControls();
  }

  function message(role, name, text, coachId = null) {
    const article = node('article', 'coach-message'); article.dataset.role = role;
    const heading = node('div', 'coach-message-heading');
    if (role === 'coach' && COACHES.some(item => item.id === coachId)) heading.append(portrait(coachId, 'coach-message-avatar', 36));
    heading.append(node('strong', 'coach-message-name', name));
    article.append(heading, node('p', 'coach-message-text', text));
    return article;
  }

  function submit(value) {
    if (disposed || submitting || unavailableReason()) return;
    const prompt = String(value || '').trim().slice(0, 500);
    if (!prompt) return;
    cancelWalkthrough(); renderWalkthrough();
    submitting = true; status.textContent = ''; renderControls();
    try {
      const answer = answerCoach({
        question: prompt, result: context.result, game: context.game,
        ply: context.ply, perspective: selected.perspective, coach: selected.coach, previousPly,
      });
      if (!answer || typeof answer.text !== 'string') throw new Error('No answer.');
      const user = message('user', 'You', prompt);
      const coach = COACHES.find(item => item.id === selected.coach) || COACHES[0];
      const reply = message('coach', coach.name, answer.text, coach.id);
      reply.dataset.coach = selected.coach;
      const subject = Number.isInteger(answer.subjectPly) ? context.result.moves[answer.subjectPly - 1] : null;
      if (subject && RATINGS.has(subject.label)) {
        const chip = node('span', 'coach-grade-chip'); chip.dataset.rating = subject.label;
        chip.append(ratingIcon(subject.label), document.createTextNode(subject.label));
        reply.querySelector('.coach-message-heading').append(chip);
      }
      if (typeof onNavigate === 'function' && Array.isArray(answer.moves)) {
        const jumps = node('div', 'coach-jumps');
        for (const item of answer.moves.slice(0, 4)) {
          if (!Number.isInteger(item?.ply) || item.ply < 0 || item.ply > context.result.moves.length) continue;
          const label = typeof item.label === 'string' ? item.label.slice(0, 100) : item.ply ? moveLabel(context.result.moves[item.ply - 1]) : 'Starting position';
          const jump = node('button', 'coach-jump', label); jump.type = 'button'; jump.dataset.ply = String(item.ply);
          const grade = context.result.moves[item.ply - 1]?.label;
          const icon = ratingIcon(grade);
          if (icon) jump.prepend(icon);
          jump.setAttribute('aria-label', `Show ${label}${icon ? `, rated ${grade},` : ''} on the board`); jumps.append(jump);
        }
        if (jumps.childElementCount) reply.append(jumps);
      }
      conversation.push({ user, reply });
      if (conversation.length > MAX_PAIRS) {
        const removed = conversation.shift(); removed.user.remove(); removed.reply.remove();
      }
      log.append(user, reply);
      previousPly = Number.isInteger(answer.subjectPly) ? answer.subjectPly : null;
      question.value = ''; renderSuggestions(answer.suggestions);
      renderControls(); log.scrollTop = log.scrollHeight;
      reactToAnswer(answer, reply);
    } catch {
      status.textContent = 'That answer could not be prepared. Try a suggested question or review the game again.';
    } finally {
      submitting = false; renderControls(); question.focus({ preventScroll: true });
    }
  }

  async function writePreferences(patch) {
    pendingPreferences = { ...pendingPreferences, ...patch };
    if (!storage) {
      preferenceStatus.textContent = 'Coach choices are remembered for this tab only.';
      return;
    }
    const update = async () => {
      const pending = { ...pendingPreferences };
      if (!Object.keys(pending).length) return;
      const latest = preferences((await storage.get(STORAGE_KEY))[STORAGE_KEY]);
      const next = preferences({ ...latest, ...pending });
      await storage.set({ [STORAGE_KEY]: next });
      for (const [key, value] of Object.entries(pending)) if (pendingPreferences[key] === value) delete pendingPreferences[key];
      if (!disposed) {
        selected = preferences({ ...next, ...pendingPreferences }); renderPreferences();
        preferenceStatus.textContent = '';
      }
    };
    preferenceQueue = preferenceQueue.catch(() => {}).then(() => globalThis.navigator?.locks?.request
      ? navigator.locks.request('MeowlChess-coach-preferences', update) : update()).catch(() => {
      if (!disposed) preferenceStatus.textContent = 'Your choice works in this tab, but could not be saved. Change it again to retry.';
    });
    await preferenceQueue;
  }

  listen(choice, 'change', () => {
    selected = preferences({ ...selected, coach: choice.value }); revision++;
    renderPreferences(); void writePreferences({ coach: selected.coach });
  });
  listen(side, 'change', () => {
    stopReactions();
    selected = preferences({ ...selected, perspective: side.value }); revision++;
    renderPreferences(); void writePreferences({ perspective: selected.perspective });
  });
  listen(motionToggle, 'change', () => {
    selected = preferences({ ...selected, motion: motionToggle.checked }); revision++;
    motion.stop(); renderPreferences(); void writePreferences({ motion: selected.motion });
  });
  listen(soundToggle, 'change', () => {
    selected = preferences({ ...selected, sounds: soundToggle.checked }); revision++;
    sounds.stop(); renderPreferences(); void writePreferences({ sounds: selected.sounds });
    if (selected.sounds && reactionsVisible()) void sounds.unlock();
  });
  listen(volume, 'input', () => {
    selected = preferences({ ...selected, volume: Number(volume.value) / 100 }); revision++;
    // Protect the in-progress slider value from another window's preference event.
    pendingPreferences = { ...pendingPreferences, volume: selected.volume };
    sounds.stop();
    volumeValue.textContent = `${Math.round(selected.volume * 100)}%`;
    volume.setAttribute('aria-valuetext', selected.volume ? `${Math.round(selected.volume * 100)} percent` : 'Muted');
    soundPreview.disabled = !selected.sounds || !selected.volume || !effectsVisible();
  });
  listen(volume, 'change', () => { void writePreferences({ volume: selected.volume }); });
  listen(soundPreview, 'click', () => {
    if (!effectsVisible() || !selected.sounds || !selected.volume || Date.now() - lastPreview < 1200) return;
    lastPreview = Date.now(); stopReactions();
    motion.react(avatar, { kind: 'greeting', coachId: selected.coach });
    void sounds.play({ kind: 'greeting', coach: selected.coach });
  });
  if (greet) listen(greet, 'click', () => {
    if (!companionReady() || Date.now() - lastGreeting < 1800) return;
    lastGreeting = Date.now(); stopReactions();
    motion.react(avatar, { kind: 'greeting', coachId: selected.coach });
    void sounds.play({ kind: 'greeting', coach: selected.coach });
  });
  listen(commentaryToggle, 'change', () => {
    selected = preferences({ ...selected, commentary: commentaryToggle.checked }); revision++;
    stopReactions(); cancelWalkthrough(); renderPreferences(); renderControls();
    void writePreferences({ commentary: selected.commentary });
  });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { stopReactions(); cancelWalkthrough(); celebratedPly = context.ply; walkthrough.hidden = true; if (companion) companion.bubble.hidden = true; }
    else { syncIdle(); renderWalkthrough(); }
  });
  listen(form, 'submit', event => { event.preventDefault(); submit(question.value); });
  listen(question, 'input', renderControls);
  listen(question, 'keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(question.value); }
  });
  listen(root, 'keydown', event => {
    // Keep typing and native selection/navigation inside the coach from moving the board.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.stopPropagation();
  });
  listen(clear, 'click', () => { resetConversation(true); renderWalkthrough(); if (!unavailableReason()) question.focus({ preventScroll: true }); });
  listen(suggestions, 'click', event => {
    const button = event.target.closest('button[data-question]');
    if (button && suggestions.contains(button)) submit(button.dataset.question);
  });
  listen(log, 'click', event => {
    const button = event.target.closest('button.coach-jump');
    if (!button || !log.contains(button) || unavailableReason()) return;
    onNavigate?.({ ply: Number(button.dataset.ply), label: button.textContent });
  });

  function storageChanged(changes, area) {
    if (disposed || area !== 'local' || !changes[STORAGE_KEY]) return;
    revision++;
    const next = preferences({ ...preferences(changes[STORAGE_KEY].newValue), ...pendingPreferences });
    if (Object.keys(next).some(key => next[key] !== selected[key])) stopReactions();
    selected = next;
    renderPreferences();
  }
  storageEvents?.addListener?.(storageChanged);
  renderPreferences(); renderSuggestions(); renderControls();
  const initialRevision = revision;
  if (storage) Promise.resolve().then(() => storage.get(STORAGE_KEY)).then(values => {
    if (disposed || revision !== initialRevision) return;
    selected = preferences(values[STORAGE_KEY]); renderPreferences();
  }).catch(() => {
    if (!disposed && revision === initialRevision) preferenceStatus.textContent = 'Saved coach choices could not be loaded. You can still choose a coach for this tab.';
  });

  return {
    setContext(next = {}) {
      if (disposed) return;
      const result = next.result || null, game = next.game || null;
      const pgn = typeof game?.pgn === 'string' ? game.pgn : '';
      const changed = result !== identityResult || pgn !== identityPgn;
      identityResult = result; identityPgn = pgn;
      const maximum = result?.moves?.length || 0;
      const ply = Number.isInteger(next.ply) ? Math.max(0, Math.min(maximum, next.ply)) : 0;
      const positionChanged = changed || ply !== context.ply;
      const active = next.active === true, moveReactionsActive = next.moveReactionsActive === true;
      const blockedReason = next.blockedReason || '';
      const surfaceChanged = active !== context.active || moveReactionsActive !== context.moveReactionsActive;
      const blockingChanged = blockedReason !== context.blockedReason;
      if (positionChanged || surfaceChanged || blockingChanged) { stopReactions(); cancelWalkthrough(); }
      if (positionChanged) { walkthroughKey = ''; walkthroughAnswer = null; }
      if (changed) walkthroughSource = null;
      if (positionChanged) celebratedPly = null;
      if (blockedReason || document.hidden) celebratedPly = ply;
      context = { game, result, ply, blockedReason, active, moveReactionsActive };
      renderCompanion();
      if (changed) resetConversation();
      else renderControls();
      renderWalkthrough({ maySpeak: positionChanged });
      renderMoveReaction({ mayCelebrate: positionChanged || surfaceChanged });
    },
    dispose() {
      disposed = true; cancelWalkthrough(); walkthroughSource = null; motion.dispose(); sounds.dispose();
      if (moveReactionTarget?.container) moveReactionTarget.container.hidden = true;
      if (companion) { companion.container.hidden = true; companion.bubble.hidden = true; }
      events.abort(); storageEvents?.removeListener?.(storageChanged);
      conversation = []; context = { game: null, result: null, ply: 0, blockedReason: '', active: false, moveReactionsActive: false };
    },
  };
}
