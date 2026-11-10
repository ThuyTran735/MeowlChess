import { COACHES, answerCoach, createCoachWalkthrough } from './coach.js';
import { coachPortraitUrl } from './coach-portraits.js';
import { createCoachMotion } from './coach-motion.js';
import { createCoachPlayCycle } from './coach-play.js';
import { createCoachSounds } from './coach-sounds.js';
import { getCoachSoundProfile } from './coach-sound-profiles.js';
import { COACH_ANIMATION_LABELS } from './coach-repertoire.js';
import { getCoachUnlockProgress, subscribeCoachUnlockProgress, COACH_REVIEW_UNLOCK_GOAL } from './coach-unlocks.js';
import { renderCoachText } from './coach-notation.js';
import { createMoveNotation } from './move-notation.js';
import { normalizeCoachPerspective, resolveCoachFocus, detectCoachPlayerSide } from './coach-focus.js';

const STORAGE_KEY = 'coachPreferences';
const IDENTITY_KEYS = ['username', 'usernames', 'siteReviewSettings', 'savedAccounts', 'detectedAccounts'];
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
function ratedHeading(element, text, rating, notation, prefix = '') {
  const icon = ratingIcon(rating);
  const label = node('span', 'coach-move-label');
  label.append(prefix, renderCoachText(text, notation));
  element.replaceChildren(...(icon ? [icon] : []), label);
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

function actionIcon(name) {
  const paths = {
    send: 'M12 19V5m-6 6 6-6 6 6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    settings: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
    clear: 'M8 5h8m-11 3h14M9 8v11m6-11v11M7 8l1 13h8l1-13',
    recap: 'M6 4h12v16H6zM9 8h6m-6 4h6m-6 4h3',
    focus: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M9 12h6m-3-3v6',
    flag: 'M5 21V3m0 1h13l-3 4 3 4H5',
    lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4m-4 5v2',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.classList.add('coach-action-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.arrow); svg.append(path);
  return svg;
}

const COACH_SHORT_NAMES = { meowl: 'Meowl', baby: 'Baby Meowl', owl: 'Professor', paws: 'Captain', mellow: 'Mellow', scout: 'Scout', evil: 'Evil Meowl' };
const ANIMATION_KINDS = [['signature','Signature action'],['greeting','Hello'],['talk','Talking'],['think','Thinking'],['curious','Looking closer'],['brilliant','Brilliant'],['great','Great'],['celebrate','Best'],['approve','Good move'],['encourage','Encouragement'],['idle','While waiting']];
const QUESTION_LABELS = {
  'Summarize this game': ['Game recap', 'recap'],
  'What was the biggest mistake?': ['Biggest mistake', 'flag'],
  'What should I practice?': ['Practice plan', 'focus'],
  'Show Brilliant and Great moves': ['Standout moves', 'flag'],
  'Explain this position': ['This position', 'focus'],
  'Next key moment': ['Next key moment', 'arrow'],
  'What was better?': ['A better move?', 'recap'],
  'How were the phases?': ['Game phases', 'recap'],
  'What opening is this?': ['Opening', 'flag'],
  'What is the material?': ['Material count', 'focus'],
};

function storedPreferences(value, evilUnlocked = false) {
  return {
    coach: COACHES.some(coach => coach.id === value?.coach) && (value.coach !== 'evil' || evilUnlocked) ? value.coach : COACHES[0].id,
    perspective: normalizeCoachPerspective(value?.perspective),
    motion: typeof value?.motion === 'boolean' ? value.motion : true,
    sounds: value?.sounds === true,
    volume: typeof value?.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 0.8,
    commentary: typeof value?.commentary === 'boolean' ? value.commentary : true,
    explanationLength: value?.explanationLength === 'detailed' ? 'detailed' : 'brief',
  };
}

function moveLabel(move) {
  const number = Number(move?.before?.split(' ')[5]);
  return `${Number.isInteger(number) && number > 0 ? number : '?'}${move?.color === 'b' ? '...' : '.'} ${move?.san || ''}`;
}

function speakingDuration(text) {
  const words = String(text || '').trim().split(/\s+/).length;
  return Math.min(3600, Math.max(1800, words * 55));
}

/** A bounded, local conversation about one completed review. Chats are not persisted. */
export function createCoachView(root, { onNavigate, onOpen, moveReactionTarget = null, companionTarget = null } = {}) {
  if (!(root instanceof HTMLElement)) throw new TypeError('A coach container is required.');
  const companion = companionTarget?.container instanceof HTMLElement && companionTarget.image instanceof HTMLImageElement
    && companionTarget.bubble instanceof HTMLElement && companionTarget.heading instanceof HTMLElement && companionTarget.text instanceof HTMLElement ? companionTarget : null;
  const id = `MeowlChess-coach-${++nextId}`;
  const events = new AbortController();
  const listen = (element, type, listener) => element.addEventListener(type, listener, { signal: events.signal });
  const storage = globalThis.chrome?.storage?.local;
  const storageEvents = globalThis.chrome?.storage?.onChanged;
  let unlockProgress = { count: 0, required: COACH_REVIEW_UNLOCK_GOAL, unlocked: false }, unlockLoaded = false, unlockFailed = false, unlockReadVersion = 0;
  const preferences = value => storedPreferences(value, unlockProgress.unlocked);
  let selected = preferences(), context = { game: null, result: null, ply: 0, blockedReason: '', active: false, moveReactionsActive: false };
  let identityPgn = '', identityResult = null, revision = 0, disposed = false, submitting = false;
  let pendingPreferences = {}, preferenceQueue = Promise.resolve(), conversation = [];
  const accountIdentity = {}, changedIdentityKeys = new Set();
  let manualPlayerSide = null, resolvedPlayerSide = null;
  const focusedSide = () => resolveCoachFocus(selected.perspective, resolvedPlayerSide);
  let previousPly = null, celebratedPly = null;
  let lastPreview = -Infinity;
  const playCycle = createCoachPlayCycle();
  let playTimer = null, playing = false;
  let soundRevision = 0, soundPending = false, soundBusyUntil = 0;
  let walkthroughTimer = null, walkthroughToken = 0, walkthroughPending = '', walkthroughKey = '', walkthroughAnswer = null, walkthroughSource = null;
  const reactionsVisible = () => !disposed && !document.hidden && !unavailableReason() && (context.active || context.moveReactionsActive);
  const companionReady = () => !!companion && !companion.container.hidden && !disposed && !document.hidden && !unavailableReason();
  const portraitReady = () => !disposed && !document.hidden && !context.blockedReason
    && avatar.isConnected && !!avatar.getClientRects().length
    && (companion ? !companion.container.hidden : context.active);
  const effectsVisible = () => reactionsVisible() || companionReady() || portraitReady();
  const motion = createCoachMotion({ isEnabled: () => selected.motion, isVisible: effectsVisible });
  const sounds = createCoachSounds({ isEnabled: () => selected.sounds, isVisible: effectsVisible, getVolume: () => selected.volume });
  function syncIdle() {
    if (!companion) return;
    if (companionReady() && selected.motion) motion.setIdle(companion.image, { coachId: selected.coach });
    else motion.stop();
  }
  function clearPlay() {
    clearTimeout(playTimer); playTimer = null; playing = false;
    playStatus.textContent = ''; playHint.hidden = false;
    playButton?.removeAttribute('aria-busy');
  }
  function stopSounds() {
    soundRevision++; soundPending = false; soundBusyUntil = 0; sounds.stop();
  }
  function stopReactions(options) { clearPlay(); motion.stop(options); stopSounds(); syncIdle(); }
  function playSound(kind, targets) {
    const coachId = selected.coach;
    const images = [...new Set(targets)].filter(image => image?.isConnected);
    const token = ++soundRevision;
    soundPending = true;
    void sounds.play({ kind, coach: coachId,
      async beforeStart() {
        const ready = await Promise.all(images.map(image => motion.prepareVoice(image, { coachId })));
        return !disposed && selected.coach === coachId && ready.some(Boolean);
      },
      onStart(playback) {
        if (disposed || selected.coach !== coachId) return;
        soundBusyUntil = performance.now() + playback.durationMs;
        for (const image of images) if (image?.isConnected) motion.setVoice(image, { coachId, ...playback });
      },
    }).finally(() => { if (token === soundRevision) soundPending = false; });
  }
  function reactionForMove(ply) {
    const move = context.result?.moves?.[ply - 1];
    const focus = focusedSide();
    if (!move || (focus !== 'both' && focus !== move.color)) return 'talk';
    if (move.label === 'Brilliant') return 'brilliant';
    if (move.label === 'Great') return 'great';
    if (move.label === 'Best') return 'celebrate';
    if (['Inaccuracy', 'Mistake', 'Miss', 'Blunder'].includes(move.label)) return 'encourage';
    if (['Excellent', 'Good', 'Book'].includes(move.label)) return 'approve';
    return 'talk';
  }
  function brilliantMove(ply) {
    const move = context.result?.moves?.[ply - 1];
    const focus = focusedSide();
    return move?.label === 'Brilliant' && (focus === 'both' || focus === move.color);
  }
  function reactToAnswer(answer, reply) {
    if (!context.active || !reactionsVisible()) return;
    stopReactions({ settle: true });
    const kind = Number.isInteger(answer.subjectPly) ? reactionForMove(answer.subjectPly) : 'talk';
    const grade = context.result?.moves?.[answer.subjectPly - 1]?.label;
    const durationMs = kind === 'talk' ? speakingDuration(answer.text) : undefined;
    motion.react(avatar, { kind, coachId: selected.coach, grade, durationMs, waitForVoice: selected.sounds && selected.volume > 0 });
    const image = reply.querySelector('.coach-message-avatar');
    if (image) motion.react(image, { kind, coachId: selected.coach, grade, durationMs, waitForVoice: selected.sounds && selected.volume > 0 });
    playSound(kind, [avatar, image]);
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
    stopReactions({ settle: true });
    motion.react(image, { kind: 'brilliant', coachId: selected.coach, grade: 'Brilliant', waitForVoice: selected.sounds && selected.volume > 0 });
    playSound('brilliant', [image]);
  }

  root.classList.add('coach-view');
  const heading = node('div', 'coach-heading');
  const avatar = companion?.image || portrait(selected.coach, 'coach-avatar', 72);
  const portraitControl = companion ? null : node('div', 'coach-portrait-control');
  const playButton = companion?.container.querySelector('.coach-companion-greet') || node('button', 'coach-portrait-play');
  playButton.type = 'button'; playButton.classList.add('coach-portrait-play');
  const playHint = node('span', 'coach-play-hint', 'Tap to play');
  const playStatus = node('span', 'coach-play-status');
  playStatus.setAttribute('role', 'status'); playStatus.setAttribute('aria-live', 'polite'); playStatus.setAttribute('aria-atomic', 'true');
  const playFeedback = node('span', 'coach-play-feedback'); playFeedback.append(playHint, playStatus);
  if (portraitControl) { playButton.append(avatar); portraitControl.append(playButton, playFeedback); }
  else companion.container.querySelector('.coach-companion-figure')?.append(playFeedback);
  const identity = node('div', 'coach-identity');
  const coachLabel = node('label', 'coach-label', 'Your coach');
  coachLabel.htmlFor = `${id}-choice`;
  const coachName = node('strong', 'coach-selected-name');
  const choice = node('select', 'coach-select'); choice.id = coachLabel.htmlFor; choice.hidden = true;
  for (const coach of COACHES) {
    const option = node('option', '', coach.name); option.value = coach.id; choice.append(option);
  }
  // The visual choices are native buttons; the hidden select keeps stored-value compatibility.
  coachLabel.removeAttribute('for');
  identity.append(coachLabel, coachName, choice);
  const clear = node('button', 'coach-clear', 'Clear'); clear.type = 'button';
  clear.prepend(actionIcon('clear')); clear.setAttribute('aria-label', 'Clear chat'); clear.title = 'Clear this conversation';
  if (!companion) heading.append(portraitControl);
  heading.append(identity, clear);
  const description = node('p', 'coach-description');
  const roster = node('div', 'coach-roster'); roster.setAttribute('role', 'group'); roster.setAttribute('aria-label', 'Choose your coach');
  const coachChoices = new Map();
  for (const coach of COACHES) {
    const button = node('button', 'coach-choice'); button.type = 'button'; button.dataset.coach = coach.id;
    button.setAttribute('aria-label', `${coach.name}: ${coach.description}`); button.title = `${coach.name} — ${coach.description}`;
    const artwork = node('span', 'coach-choice-art'); artwork.append(portrait(coach.id, 'coach-choice-portrait', 48));
    if (coach.id === 'evil') {
      const lock = node('span', 'coach-choice-lock'); lock.append(actionIcon('lock')); artwork.append(lock);
    }
    button.append(artwork, node('span', 'coach-choice-name', COACH_SHORT_NAMES[coach.id] || coach.name));
    roster.append(button); coachChoices.set(coach.id, button);
  }
  const unlockDetails = node('details', 'coach-unlock');
  const unlockSummary = node('summary', 'coach-unlock-summary'); unlockSummary.id = `${id}-unlock-summary`;
  const unlockCount = node('span', 'coach-unlock-count', 'Checking progress…');
  unlockSummary.append(actionIcon('lock'), node('span', '', 'Evil Meowl'), unlockCount);
  const unlockExplanation = node('p', 'coach-unlock-explanation', `Review ${COACH_REVIEW_UNLOCK_GOAL} different completed games to unlock Evil Meowl. Your progress stays saved on this device, even if you delete a saved review.`);
  unlockExplanation.id = `${id}-unlock-explanation`;
  const unlockRetry = node('button', 'coach-unlock-retry', 'Try again'); unlockRetry.type = 'button'; unlockRetry.hidden = true;
  unlockDetails.append(unlockSummary, unlockExplanation, unlockRetry);
  const unlockStatus = node('p', 'coach-unlock-status'); unlockStatus.setAttribute('role', 'status'); unlockStatus.hidden = true;
  const picker = node('details', 'coach-picker');
  const pickerSummary = node('summary', 'coach-picker-summary', 'Change coach');
  picker.append(pickerSummary, roster, unlockDetails, unlockStatus);
  listen(unlockRetry, 'click', () => { void refreshUnlockProgress(); });
  const controls = node('div', 'coach-controls');
  const sideLabel = node('label', 'coach-label', 'Focus on'); sideLabel.htmlFor = `${id}-perspective`;
  const side = node('select', 'coach-perspective'); side.id = sideLabel.htmlFor;
  for (const [value, label] of [['both', 'Both players'], ['me', 'Me'], ['opponent', 'Opponent'], ['w', 'White'], ['b', 'Black']]) {
    const option = node('option', '', label); option.value = value; side.append(option);
  }
  const focusControl = node('div', 'coach-focus-control'); focusControl.append(sideLabel, side);
  const lengthControl = node('div', 'coach-length-control');
  const lengthLabel = node('label', 'coach-label coach-length-label', 'Explanation length'); lengthLabel.htmlFor = `${id}-length`;
  const explanationLength = node('select', 'coach-explanation-length'); explanationLength.id = lengthLabel.htmlFor;
  for (const [value, label] of [['brief', 'Brief'], ['detailed', 'Detailed']]) {
    const option = node('option', '', label); option.value = value; explanationLength.append(option);
  }
  lengthControl.append(lengthLabel, explanationLength);
  controls.append(focusControl, lengthControl);
  const playerControl = node('div', 'coach-player-control');
  const playerLabel = node('label', 'coach-label', 'You played as'); playerLabel.htmlFor = `${id}-player-side`;
  const playerSide = node('select', 'coach-player-side'); playerSide.id = playerLabel.htmlFor;
  for (const [value, label] of [['', 'Choose your player'], ['w', 'White'], ['b', 'Black']]) {
    const option = node('option', '', label); option.value = value; playerSide.append(option);
  }
  const focusHint = node('p', 'coach-focus-hint'); focusHint.id = `${id}-focus-hint`;
  focusHint.setAttribute('role', 'status'); side.setAttribute('aria-describedby', focusHint.id);
  playerControl.append(playerLabel, playerSide, focusHint); controls.append(playerControl);
  const settings = node('details', 'coach-settings');
  const settingsSummary = node('summary', 'coach-settings-summary');
  const settingsState = node('span', 'coach-settings-state');
  settingsSummary.append(actionIcon('settings'), node('span', '', 'Coach settings'), settingsState);
  settings.append(settingsSummary);
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
  const soundProfile = node('p', 'coach-sound-profile');
  volumeControls.append(soundProfile);
  const preferenceStatus = node('p', 'coach-preference-status'); preferenceStatus.setAttribute('role', 'status');
  const animationControls = node('div', 'coach-animation-controls');
  const animationLabel = node('label', 'coach-label', 'Animation preview'); animationLabel.htmlFor = `${id}-animation`;
  const animationChoice = node('select', 'coach-animation-choice'); animationChoice.id = animationLabel.htmlFor;
  for (const [value, label] of ANIMATION_KINDS) {
    const option = node('option', '', label); option.value = value; animationChoice.append(option);
  }
  const animationPreview = node('button', 'coach-animation-preview', 'Play'); animationPreview.type = 'button';
  animationPreview.setAttribute('aria-label', 'Play selected coach animation');
  animationControls.append(animationLabel, animationChoice, animationPreview);
  const animationHint = node('p', 'coach-animation-hint', 'Play again to see the next action. Idle gestures happen automatically between comments.');
  animationControls.append(animationHint);
  settings.append(reactionSettings, animationControls, volumeControls);
  const positionCard = node('section', 'coach-position-card'); positionCard.setAttribute('aria-label', 'Current board position');
  const positionInfo = node('div', 'coach-position-info');
  const position = node('p', 'coach-context');
  const positionKicker = node('span', 'coach-position-kicker', 'On the board');
  positionInfo.append(positionKicker, position);
  const explainPosition = node('button', 'coach-position-action', 'Explain'); explainPosition.type = 'button';
  explainPosition.append(actionIcon('arrow'));
  positionCard.append(positionInfo, explainPosition);
  const walkthrough = node('section', 'coach-walkthrough'); walkthrough.hidden = true;
  walkthrough.setAttribute('aria-label', 'Coach on this move'); walkthrough.setAttribute('aria-live', 'polite'); walkthrough.setAttribute('aria-atomic', 'true');
  const walkthroughHeading = node('strong', 'coach-walkthrough-heading');
  const walkthroughText = node('p', 'coach-walkthrough-text');
  const walkthroughActions = node('div', 'coach-walkthrough-actions');
  const walkthroughFollowup = node('button', 'coach-walkthrough-followup', 'Explore this move'); walkthroughFollowup.type = 'button';
  const walkthroughNext = node('button', 'coach-walkthrough-next'); walkthroughNext.type = 'button';
  walkthroughActions.append(walkthroughFollowup, walkthroughNext);
  walkthrough.append(walkthroughHeading, walkthroughText, walkthroughActions);
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
  welcome.append(node('h3', '', 'Find your next improvement'), node('p', '', 'Explore a turning point, understand a move, or choose one thing to practice.'));
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
  const send = node('button', 'coach-send', 'Ask'); send.type = 'submit'; send.append(actionIcon('send'));
  formActions.append(keyboardHint, send); form.append(questionLabel, question, formActions);
  const status = node('p', 'coach-status'); status.setAttribute('role', 'status');
  const scope = node('p', 'coach-scope', 'Based on your saved engine review. Chats stay in this tab and clear when you change games.');
  scope.id = `${id}-scope`;
  root.replaceChildren(heading, description, picker, controls, settings, preferenceStatus, positionCard, blocked, walkthrough, welcome, log, suggestions, form, status, scope);
  const companionPersonality = companion ? node('span', 'coach-companion-personality') : null;
  if (companionPersonality) companion.container.querySelector('.coach-companion-figure')?.append(companionPersonality);
  const companionToolbar = companion ? node('div', 'coach-companion-toolbar') : null;
  const companionChoice = companion ? node('select', 'coach-companion-choice') : null;
  const companionUnlock = companion ? node('button', 'coach-companion-unlock') : null;
  const companionSettings = companion && typeof onOpen === 'function' ? node('button', 'coach-companion-settings') : null;
  const companionFooter = companion ? node('div', 'coach-companion-footer') : null;
  const companionHint = companion ? node('p', 'coach-companion-hint') : null;
  const companionTips = companion ? node('button', 'coach-companion-toggle') : null;
  const companionSound = companion ? node('button', 'coach-companion-toggle') : null;
  if (companionToolbar) {
    const label = node('label', 'coach-companion-label', 'Your coach');
    label.htmlFor = `${id}-companion-choice`; companionChoice.id = label.htmlFor;
    for (const coach of COACHES) {
      const option = node('option', '', coach.name); option.value = coach.id; companionChoice.append(option);
    }
    companionToolbar.append(label, companionChoice);
    companionUnlock.type = 'button'; companionToolbar.append(companionUnlock);
    listen(companionUnlock, 'click', () => {
      onOpen?.(); picker.open = true; unlockDetails.open = true;
      unlockSummary.scrollIntoView({ block: 'nearest', behavior: 'instant' }); unlockSummary.focus({ preventScroll: true });
    });
    if (companionSettings) {
      companionSettings.type = 'button'; companionSettings.append(actionIcon('settings'));
      companionSettings.setAttribute('aria-label', 'Open coach settings'); companionSettings.title = 'Coach settings';
      companionToolbar.append(companionSettings);
      listen(companionSettings, 'click', () => {
        if (disposed) return;
        onOpen(); settings.open = true;
        settingsSummary.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        settingsSummary.focus({ preventScroll: true });
      });
    }
    companion.container.prepend(companionToolbar);
    companionTips.type = companionSound.type = 'button';
    companionTips.setAttribute('aria-label', 'Automatic move tips');
    companionSound.setAttribute('aria-label', 'Meow sounds');
    const quickControls = node('div', 'coach-companion-quick-controls');
    quickControls.append(companionTips, companionSound);
    companionFooter.append(companionHint, quickControls); companion.container.append(companionFooter);
    listen(companionChoice, 'change', () => chooseCoach(companionChoice.value));
    listen(companionChoice, 'keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.stopPropagation();
    });
    listen(companionTips, 'click', () => commentaryToggle.click());
    listen(companionSound, 'click', () => soundToggle.click());
  }
  const companionAsk = companion && typeof onOpen === 'function' ? node('button', 'coach-companion-ask', 'Ask about this move') : null;
  if (companionAsk) {
    companionAsk.type = 'button'; companionAsk.append(actionIcon('arrow')); companionFooter.append(companionAsk);
    listen(companionAsk, 'click', () => {
      if (unavailableReason() || disposed) return;
      onOpen(); submit(companionAsk.dataset.question || (context.ply ? 'Explain this position' : 'Summarize this game'));
    });
  }

  function unavailableReason() {
    if (context.blockedReason) return String(context.blockedReason);
    if (!context.result || !Array.isArray(context.result.moves) || !FINAL_RESULTS.has(context.result.game?.headers?.Result)) {
      return 'Finish reviewing a completed game to talk with your coach.';
    }
    if (focusedSide() === null) return 'Choose which player is you under “You played as” to focus on you or your opponent.';
    return '';
  }

  function playerName(color) {
    const name = context.game?.[color === 'w' ? 'white' : 'black']?.username
      || context.result?.game?.headers?.[color === 'w' ? 'White' : 'Black'];
    return typeof name === 'string' && name.trim() ? name.trim() : color === 'w' ? 'White' : 'Black';
  }

  function playerDescription(color) {
    const label = color === 'w' ? 'White' : 'Black', name = playerName(color);
    return name === label ? label : `${name} (${label})`;
  }

  function renderFocus() {
    const detected = detectCoachPlayerSide({ ...context.game, headers: context.result?.game?.headers }, accountIdentity);
    const resolved = manualPlayerSide || detected;
    if (resolved !== resolvedPlayerSide) {
      resolvedPlayerSide = resolved;
      stopReactions(); cancelWalkthrough(); walkthroughKey = ''; walkthroughAnswer = null; previousPly = null;
    }
    playerControl.hidden = !['me', 'opponent'].includes(selected.perspective);
    playerSide.options[0].textContent = detected ? `Auto · ${playerDescription(detected)}` : 'Choose your player';
    playerSide.options[0].disabled = !detected;
    for (const color of ['w', 'b']) playerSide.querySelector(`[value="${color}"]`).textContent = playerDescription(color);
    playerSide.value = manualPlayerSide || '';
    playerSide.title = resolved ? `You played as ${playerDescription(resolved)}` : 'Choose your player for this game';
    const focus = focusedSide();
    focusHint.textContent = ['w', 'b'].includes(focus) ? `Focusing on ${playerDescription(focus)}.` : '';
    focusHint.hidden = !focusHint.textContent;
  }

  function renderCompanion() {
    if (!companion) return;
    const completed = !!context.result && Array.isArray(context.result.moves) && context.result.moves.length > 0
      && FINAL_RESULTS.has(context.result.game?.headers?.Result);
    companion.container.hidden = !completed;
    if (!completed || !reactionsVisible()) companion.bubble.hidden = true;
    playButton.disabled = !portraitReady();
    if (companionHint) {
      companionHint.hidden = showingWalkthrough();
      companionHint.textContent = context.blockedReason ? 'Your coach will be back when you return to the review.'
        : !selected.commentary ? 'Move tips are paused. You can still ask a question.'
        : 'Step through Moves to explore the game together.';
    }
    if (companionAsk) {
      const prompt = context.ply ? 'Explain this position' : 'Summarize this game';
      companionAsk.dataset.question = prompt;
      companionAsk.replaceChildren(document.createTextNode(context.ply ? 'Ask about this move' : 'Talk about this game'), actionIcon('arrow'));
      companionAsk.setAttribute('aria-label', prompt);
    }
    syncIdle();
  }

  function cancelWalkthrough() {
    clearTimeout(walkthroughTimer); walkthroughTimer = null; walkthroughPending = ''; walkthroughToken++;
  }

  function showingWalkthrough() {
    const move = context.result?.moves?.[context.ply - 1];
    const focus = focusedSide();
    return selected.commentary && reactionsVisible() && !!move && (focus === 'both' || focus === move.color);
  }

  function showWalkthrough(answer) {
    const coach = COACHES.find(item => item.id === selected.coach) || COACHES[0];
    ratedHeading(walkthroughHeading, answer.heading, answer.label, answer.headingNotation);
    walkthroughText.replaceChildren(renderCoachText(answer.text, answer.notation));
    walkthroughFollowup.dataset.question = answer.suggestion || 'Explain this position';
    walkthroughFollowup.setAttribute('aria-label', walkthroughFollowup.dataset.question);
    walkthroughNext.hidden = !answer.nextMoment || typeof onNavigate !== 'function';
    if (answer.nextMoment) {
      walkthroughNext.dataset.ply = String(answer.nextMoment.ply);
      walkthroughNext.dataset.label = `Next: ${answer.nextMoment.label}`;
      const nextLabel = node('span', 'coach-move-label');
      nextLabel.append('Next: ', renderCoachText(answer.nextMoment.label, answer.nextMoment.notation));
      walkthroughNext.replaceChildren(nextLabel, actionIcon('arrow'));
      walkthroughNext.setAttribute('aria-label', `Next key moment: ${answer.nextMoment.label}, ${answer.nextMoment.rating}`);
    }
    walkthrough.dataset.ply = String(answer.subjectPly);
    walkthrough.hidden = !!companion || !context.active;
    if (companion) {
      if (companionHint) companionHint.hidden = true;
      ratedHeading(companion.heading, answer.heading, answer.label, answer.headingNotation);
      companion.text.replaceChildren(renderCoachText(answer.text, answer.notation));
      companion.bubble.dataset.ply = String(answer.subjectPly);
      companion.bubble.hidden = false;
      if (companionAsk) { companionAsk.dataset.question = answer.suggestion || 'Explain this position'; companionAsk.setAttribute('aria-label', companionAsk.dataset.question); }
    }
    if (moveReactionTarget?.container) {
      ratedHeading(moveHeading, answer.heading, answer.label, answer.headingNotation, `${coach.name} · `);
      moveText.replaceChildren(renderCoachText(answer.text, answer.notation));
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
      if (companionHint) companionHint.hidden = false;
      return;
    }
    const key = `${context.ply}:${selected.coach}:${focusedSide()}:${selected.explanationLength}`;
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
      const answer = walkthroughSource.describe({ ply: context.ply, coach: selected.coach, perspective: focusedSide(), explanationLength: selected.explanationLength });
      if (!answer) return;
      walkthroughKey = key; walkthroughAnswer = answer;
      showWalkthrough(answer);
      // Brilliant uses the existing immediate celebration; never replay it for the comment.
      if (maySpeak && !brilliantMove(context.ply)) {
        const image = companion?.image || (context.active ? avatar : moveReactionTarget?.image);
        if (image) {
          stopReactions({ settle: true });
          const kind = reactionForMove(context.ply);
          motion.react(image, { kind, coachId: selected.coach, grade: answer.label, durationMs: kind === 'talk' ? speakingDuration(answer.text) : undefined, waitForVoice: selected.sounds && selected.volume > 0 });
          playSound(kind, [image]);
        }
      }
    }, 180);
  }

  function renderUnlockProgress() {
    const locked = !unlockProgress.unlocked;
    const progressText = !unlockLoaded ? unlockFailed ? 'Progress unavailable' : 'Checking progress…'
      : `${unlockProgress.count}/${unlockProgress.required} games reviewed`;
    unlockDetails.hidden = !locked; unlockCount.textContent = progressText;
    unlockRetry.hidden = !unlockFailed || !locked;
    const button = coachChoices.get('evil'), coach = COACHES.find(item => item.id === 'evil');
    if (button && coach) {
      button.setAttribute('aria-disabled', String(locked));
      button.dataset.locked = String(locked); button.querySelector('.coach-choice-lock').hidden = !locked;
      if (locked) {
        button.setAttribute('aria-describedby', `${unlockSummary.id} ${unlockExplanation.id}`);
        button.setAttribute('aria-label', `${coach.name}, locked. ${progressText}. Unlock after ${COACH_REVIEW_UNLOCK_GOAL} different completed game reviews.`);
        button.title = `${coach.name} — ${progressText}. Review ${COACH_REVIEW_UNLOCK_GOAL} different completed games to unlock.`;
      } else {
        button.removeAttribute('aria-describedby'); button.setAttribute('aria-label', `${coach.name}: ${coach.description}`);
        button.title = `${coach.name} — ${coach.description}`;
      }
    }
    for (const select of [choice, companionChoice]) {
      const option = select?.querySelector('option[value="evil"]');
      if (option) { option.disabled = locked; option.textContent = locked ? `Evil Meowl · Locked` : 'Evil Meowl'; }
    }
    if (companionUnlock) {
      companionUnlock.hidden = !locked;
      companionUnlock.replaceChildren(actionIcon('lock'), node('span', '', `Evil Meowl · ${progressText}`));
      companionUnlock.setAttribute('aria-label', `How to unlock Evil Meowl. ${progressText}.`);
    }
  }

  async function refreshUnlockProgress() {
    const token = ++unlockReadVersion;
    try {
      const next = await getCoachUnlockProgress();
      if (disposed) return;
      const justUnlocked = unlockLoaded && !unlockProgress.unlocked && next.unlocked === true;
      unlockProgress = {
        count: Math.max(unlockProgress.count, Math.max(0, Math.min(COACH_REVIEW_UNLOCK_GOAL, Math.floor(Number(next.count) || 0)))),
        required: COACH_REVIEW_UNLOCK_GOAL, unlocked: unlockProgress.unlocked || next.unlocked === true,
      };
      unlockLoaded = true; unlockFailed = false;
      if (justUnlocked) { unlockStatus.textContent = 'Evil Meowl unlocked. Choose him above.'; unlockStatus.hidden = false; }
      renderPreferences();
    } catch {
      if (disposed || token !== unlockReadVersion) return;
      unlockFailed = true;
      renderUnlockProgress();
    }
  }

  function renderPreferences() {
    selected = preferences(selected);
    renderFocus();
    const personalityChanged = root.dataset.coach !== selected.coach;
    choice.value = selected.coach; side.value = selected.perspective;
    explanationLength.value = selected.explanationLength;
    motionToggle.checked = selected.motion; soundToggle.checked = selected.sounds; commentaryToggle.checked = selected.commentary;
    volumeControls.hidden = false;
    volume.value = String(Math.round(selected.volume * 100)); volumeValue.textContent = `${volume.value}%`;
    volume.setAttribute('aria-valuetext', selected.volume ? `${volume.value} percent` : 'Muted');
    soundPreview.disabled = !selected.sounds || !selected.volume || !effectsVisible();
    animationPreview.disabled = !selected.motion || !effectsVisible();
    animationChoice.disabled = animationPreview.disabled;
    animationPreview.title = !selected.motion ? 'Turn on Coach animations to preview' : 'Play a gesture without changing the review';
    soundPreview.title = !selected.sounds ? 'Turn on Meow sounds to preview' : !selected.volume ? 'Raise the volume to preview' : 'Play a cat sound at this volume';
    if (!selected.motion) motion.stop();
    if (!selected.sounds) stopSounds();
    root.dataset.coach = selected.coach;
    const coach = COACHES.find(item => item.id === selected.coach) || COACHES[0];
    coachName.textContent = coach.name;
    playButton.setAttribute('aria-label', `Play with ${coach.name}`);
    playButton.title = `Tap to play with ${coach.name} while idle`;
    soundProfile.textContent = getCoachSoundProfile(coach.id).description;
    soundPreview.setAttribute('aria-label', `Preview ${coach.name}'s voice at this volume`);
    for (const [kind, label] of ANIMATION_KINDS) {
      const names = COACH_ANIMATION_LABELS[kind]?.[coach.id] || [label];
      const option = animationChoice.querySelector(`[value="${kind}"]`);
      option.textContent = kind === 'signature' ? names[0] : kind === 'idle' ? `${label} · ${names.length} actions` : `${label} · ${names[0]}`;
      option.title = kind === 'idle' ? `${names.length} shuffled idle actions. Play again to see another.` : names.join(' · ');
    }
    for (const [coachId, button] of coachChoices) {
      const current = coachId === selected.coach;
      button.setAttribute('aria-pressed', String(current)); button.tabIndex = current || (coachId === 'evil' && !unlockProgress.unlocked) ? 0 : -1;
    }
    renderUnlockProgress();
    settingsState.textContent = selected.sounds && selected.volume ? 'Sound on' : 'Sound off';
    const portraitUrl = coachPortraitUrl(coach.id);
    if (avatar.src !== portraitUrl) { stopReactions(); avatar.src = portraitUrl; }
    if (moveReactionTarget?.image && moveReactionTarget.image.src !== portraitUrl) moveReactionTarget.image.src = portraitUrl;
    description.textContent = coach.description;
    if (companion) {
      companion.container.dataset.coach = selected.coach;
      companionChoice.value = selected.coach;
      companionTips.textContent = selected.commentary ? 'Tips on' : 'Tips off';
      companionTips.setAttribute('aria-pressed', String(selected.commentary));
      companionSound.textContent = selected.sounds ? selected.volume ? 'Sound on' : 'Muted' : 'Sound off';
      companionSound.setAttribute('aria-pressed', String(selected.sounds));
      if (companion.name) companion.name.textContent = coach.name;
      if (companionPersonality) companionPersonality.textContent = (coach.traits || []).join(' · ');
    }
    if (personalityChanged) renderSuggestions();
    renderCompanion(); renderWalkthrough(); renderMoveReaction(); renderControls();
  }

  function renderControls() {
    const reason = unavailableReason(), available = !reason;
    playButton.disabled = !portraitReady();
    soundPreview.disabled = !selected.sounds || !selected.volume || !effectsVisible();
    animationPreview.disabled = !selected.motion || !effectsVisible();
    animationChoice.disabled = animationPreview.disabled;
    blocked.textContent = reason; blocked.hidden = available;
    positionCard.hidden = !available; welcome.hidden = !available || !!conversation.length || context.ply > 0;
    log.hidden = !available || !conversation.length;
    form.hidden = !available; suggestions.hidden = !available;
    question.disabled = !available || submitting;
    send.disabled = !available || submitting || !question.value.trim();
    clear.disabled = !conversation.length && !question.value;
    explainPosition.disabled = !available || submitting;
    if (companionAsk) companionAsk.disabled = !available;
    if (available) {
      const move = context.result.moves[context.ply - 1];
      const label = node('span', 'coach-move-label');
      if (move && typeof move.san === 'string' && move.san) label.append(`After ${moveLabel(move).slice(0, -move.san.length)}`, createMoveNotation(move.san, move.color, { showPawn: true, showCastleKing: true }));
      else label.textContent = move ? `After ${moveLabel(move)}` : 'Starting position';
      position.replaceChildren(label);
      const icon = ratingIcon(move?.label); if (icon) position.prepend(icon);
      positionKicker.textContent = move ? `${move.color === 'w' ? 'White' : 'Black'} · ${move.label}` : 'Game overview';
      explainPosition.replaceChildren(document.createTextNode(move ? 'Explain' : 'Recap'), actionIcon('arrow'));
      explainPosition.setAttribute('aria-label', move ? `Explain the position after ${moveLabel(move)}` : 'Summarize this game');
      question.placeholder = move ? `Ask about ${moveLabel(move)}…` : 'Ask about this game…';
    } else position.textContent = '';
  }

  function renderSuggestions(values, notations = []) {
    const coach = COACHES.find(item => item.id === selected.coach) || COACHES[0];
    values ??= context.ply > 0 ? ['Explain this position', 'What was better?', 'Next key moment', 'What should I practice?'] : coach.suggestions || DEFAULT_QUESTIONS;
    const safe = Array.isArray(values) ? [...new Set(values.filter(value => typeof value === 'string' && value.trim() && value.length <= 100))].slice(0, 4) : [];
    suggestions.replaceChildren();
    for (const value of safe.length ? safe : DEFAULT_QUESTIONS) {
      const [label, symbol] = QUESTION_LABELS[value] || [value, 'arrow'];
      const button = node('button', 'coach-suggestion'); button.type = 'button'; button.dataset.question = value;
      const content = node('span', 'coach-move-label');
      content.append(renderCoachText(label, label === value ? notations[values.indexOf(value)] : []));
      button.append(actionIcon(symbol), content); button.title = value; button.setAttribute('aria-label', value);
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

  function message(role, name, text, coachId = null, notation) {
    const article = node('article', 'coach-message'); article.dataset.role = role;
    const heading = node('div', 'coach-message-heading');
    if (role === 'coach' && COACHES.some(item => item.id === coachId)) {
      const icon = node('span', 'coach-message-portrait'); icon.append(portrait(coachId, 'coach-message-avatar', 36)); heading.append(icon);
    }
    heading.append(node('strong', 'coach-message-name', name));
    const body = node('p', 'coach-message-text');
    if (role === 'coach') body.append(renderCoachText(text, notation));
    else body.textContent = text;
    article.append(heading, body);
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
        ply: context.ply, perspective: focusedSide(), playerSide: resolvedPlayerSide,
        coach: selected.coach, previousPly, explanationLength: selected.explanationLength,
      });
      if (!answer || typeof answer.text !== 'string') throw new Error('No answer.');
      const user = message('user', 'You', prompt);
      const coach = COACHES.find(item => item.id === selected.coach) || COACHES[0];
      const reply = message('coach', coach.name, answer.text, coach.id, answer.notation);
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
          const jump = node('button', 'coach-jump'); jump.type = 'button'; jump.dataset.ply = String(item.ply);
          jump.dataset.label = item.label;
          const content = node('span', 'coach-move-label'); content.append(renderCoachText(label, item.notation)); jump.append(content);
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
      question.value = ''; renderSuggestions(answer.suggestions, answer.suggestionsNotation);
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

  function chooseCoach(coachId, { collapsePicker = false } = {}) {
    if (coachId === 'evil' && !unlockProgress.unlocked) {
      choice.value = selected.coach; if (companionChoice) companionChoice.value = selected.coach;
      picker.open = true; unlockDetails.open = true; unlockSummary.focus({ preventScroll: true });
      return;
    }
    unlockStatus.hidden = true;
    selected = preferences({ ...selected, coach: coachId }); revision++;
    renderPreferences(); void writePreferences({ coach: selected.coach });
    if (collapsePicker && picker.open) {
      const restoreFocus = picker.contains(document.activeElement);
      picker.open = false;
      if (restoreFocus) pickerSummary.focus({ preventScroll: true });
    }
  }
  listen(choice, 'change', () => chooseCoach(choice.value, { collapsePicker: true }));
  listen(roster, 'click', event => {
    const button = event.target.closest('.coach-choice');
    if (button && roster.contains(button)) chooseCoach(button.dataset.coach, { collapsePicker: true });
  });
  listen(roster, 'keydown', event => {
    const button = event.target.closest('.coach-choice');
    if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const available = COACHES.filter(item => item.id !== 'evil' || unlockProgress.unlocked);
    const index = available.findIndex(item => item.id === button.dataset.coach);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
      : index < 0 ? event.key === 'ArrowRight' ? 0 : available.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
    chooseCoach(available[next].id); coachChoices.get(available[next].id).focus({ preventScroll: true });
  });
  listen(side, 'change', () => {
    stopReactions();
    selected = preferences({ ...selected, perspective: side.value }); revision++;
    renderPreferences(); void writePreferences({ perspective: selected.perspective });
  });
  listen(playerSide, 'change', () => {
    manualPlayerSide = ['w', 'b'].includes(playerSide.value) ? playerSide.value : null;
    renderPreferences();
  });
  listen(motionToggle, 'change', () => {
    selected = preferences({ ...selected, motion: motionToggle.checked }); revision++;
    motion.stop(); renderPreferences(); void writePreferences({ motion: selected.motion });
  });
  listen(soundToggle, 'change', () => {
    selected = preferences({ ...selected, sounds: soundToggle.checked }); revision++;
    stopSounds(); renderPreferences(); void writePreferences({ sounds: selected.sounds });
    if (selected.sounds && reactionsVisible()) void sounds.unlock();
  });
  listen(volume, 'input', () => {
    selected = preferences({ ...selected, volume: Number(volume.value) / 100 }); revision++;
    // Protect the in-progress slider value from another window's preference event.
    pendingPreferences = { ...pendingPreferences, volume: selected.volume };
    stopSounds();
    volumeValue.textContent = `${Math.round(selected.volume * 100)}%`;
    volume.setAttribute('aria-valuetext', selected.volume ? `${Math.round(selected.volume * 100)} percent` : 'Muted');
    soundPreview.disabled = !selected.sounds || !selected.volume || !effectsVisible();
  });
  listen(volume, 'change', () => { void writePreferences({ volume: selected.volume }); });
  listen(soundPreview, 'click', () => {
    if (!effectsVisible() || !selected.sounds || !selected.volume || Date.now() - lastPreview < 1200) return;
    lastPreview = Date.now(); stopReactions({ settle: true });
    motion.react(avatar, { kind: 'greeting', coachId: selected.coach, waitForVoice: true });
    playSound('greeting', [avatar]);
  });
  listen(animationPreview, 'click', () => {
    if (!selected.motion || !effectsVisible()) return;
    stopReactions({ settle: true });
    const bounds = avatar.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > innerHeight) avatar.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const kind = animationChoice.value;
    const grade = { brilliant: 'Brilliant', great: 'Great', celebrate: 'Best', approve: 'Good' }[kind];
    motion.react(avatar, { kind, grade, coachId: selected.coach, durationMs: kind === 'talk' ? 3000 : undefined,
      waitForVoice: kind !== 'idle' && selected.sounds && selected.volume > 0 });
    if (kind !== 'idle') playSound(kind, [avatar]);
  });
  listen(playButton, 'click', event => {
    event.stopPropagation();
    if (!portraitReady() || submitting || walkthroughPending || playing || soundPending
      || performance.now() < soundBusyUntil || motion.isBusy(avatar)) return;
    const interaction = playCycle.next(selected.coach);
    playing = true; playButton.setAttribute('aria-busy', 'true');
    playHint.hidden = true; playStatus.textContent = interaction.text;
    motion.play(avatar, { coachId: selected.coach, variant: interaction.variant,
      waitForVoice: selected.sounds && selected.volume > 0 });
    playSound(interaction.soundKind, [avatar]);
    playTimer = setTimeout(clearPlay, Math.max(3600, interaction.durationMs + 300));
  });
  listen(playButton, 'keydown', event => {
    // Keep native Enter/Space activation without also navigating the game.
    if (['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.stopPropagation();
  });
  listen(commentaryToggle, 'change', () => {
    selected = preferences({ ...selected, commentary: commentaryToggle.checked }); revision++;
    stopReactions(); cancelWalkthrough(); renderPreferences(); renderControls();
    void writePreferences({ commentary: selected.commentary });
  });
  listen(explanationLength, 'change', () => {
    selected = preferences({ ...selected, explanationLength: explanationLength.value }); revision++;
    // Refresh only the current tip. Earlier replies keep their wording and no reaction is replayed.
    cancelWalkthrough(); renderPreferences();
    void writePreferences({ explanationLength: selected.explanationLength });
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
  listen(explainPosition, 'click', () => submit(context.ply ? 'Explain this position' : 'Summarize this game'));
  listen(walkthroughFollowup, 'click', () => submit(walkthroughFollowup.dataset.question));
  listen(walkthroughNext, 'click', () => {
    if (!unavailableReason() && Number.isInteger(Number(walkthroughNext.dataset.ply))) onNavigate?.({ ply: Number(walkthroughNext.dataset.ply), label: walkthroughNext.dataset.label });
  });
  listen(suggestions, 'click', event => {
    const button = event.target.closest('button[data-question]');
    if (button && suggestions.contains(button)) submit(button.dataset.question);
  });
  listen(log, 'click', event => {
    const button = event.target.closest('button.coach-jump');
    if (!button || !log.contains(button) || unavailableReason()) return;
    onNavigate?.({ ply: Number(button.dataset.ply), label: button.dataset.label });
  });

  function storageChanged(changes, area) {
    if (disposed || area !== 'local') return;
    const identityChanged = IDENTITY_KEYS.filter(key => Object.hasOwn(changes, key));
    if (!changes[STORAGE_KEY] && !identityChanged.length) return;
    for (const key of identityChanged) { accountIdentity[key] = changes[key].newValue; changedIdentityKeys.add(key); }
    if (changes[STORAGE_KEY]) {
      revision++;
      const next = preferences({ ...preferences(changes[STORAGE_KEY].newValue), ...pendingPreferences });
      if (Object.keys(next).some(key => next[key] !== selected[key])) stopReactions();
      selected = next;
    }
    renderPreferences();
  }
  storageEvents?.addListener?.(storageChanged);
  const unsubscribeUnlock = subscribeCoachUnlockProgress(() => { void refreshUnlockProgress(); });
  renderPreferences(); renderSuggestions(); renderControls();
  const initialRevision = revision;
  const unlockReady = refreshUnlockProgress();
  const savedSettings = storage && Promise.resolve().then(() => storage.get([STORAGE_KEY, ...IDENTITY_KEYS]));
  if (savedSettings) savedSettings.then(values => {
    if (disposed) return;
    for (const key of IDENTITY_KEYS) if (!changedIdentityKeys.has(key)) accountIdentity[key] = values[key];
    renderPreferences();
  }).catch(() => { /* Relative focus still offers an explicit player choice. */ });
  if (savedSettings) Promise.all([savedSettings, unlockReady]).then(([values]) => {
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
      if (positionChanged || surfaceChanged || blockingChanged) {
        stopReactions({ settle: positionChanged && !changed && !surfaceChanged && !blockingChanged && !blockedReason && !document.hidden });
        cancelWalkthrough();
      }
      if (positionChanged) { walkthroughKey = ''; walkthroughAnswer = null; }
      if (changed) walkthroughSource = null;
      if (changed) manualPlayerSide = null;
      if (positionChanged) celebratedPly = null;
      if (blockedReason || document.hidden) celebratedPly = ply;
      context = { game, result, ply, blockedReason, active, moveReactionsActive };
      renderFocus();
      renderCompanion();
      if (changed) resetConversation();
      else renderControls();
      if (positionChanged && !changed) renderSuggestions();
      renderWalkthrough({ maySpeak: positionChanged });
      renderMoveReaction({ mayCelebrate: positionChanged || surfaceChanged });
    },
    dispose() {
      disposed = true; clearPlay(); cancelWalkthrough(); walkthroughSource = null; motion.dispose(); sounds.dispose();
      unsubscribeUnlock(); unlockReadVersion++;
      if (moveReactionTarget?.container) moveReactionTarget.container.hidden = true;
      if (companion) { companion.container.hidden = true; companion.bubble.hidden = true; }
      companionAsk?.remove();
      companionPersonality?.remove();
      playFeedback.remove();
      companionToolbar?.remove(); companionFooter?.remove();
      events.abort(); storageEvents?.removeListener?.(storageChanged);
      conversation = []; context = { game: null, result: null, ply: 0, blockedReason: '', active: false, moveReactionsActive: false };
    },
  };
}
