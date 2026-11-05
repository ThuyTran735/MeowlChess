import { createCoachPuppet, drawCoachPuppet, coachPoseAt, COACH_REACTION_DURATIONS as DURATIONS } from './coach-puppet.js';
import { coachArtworkId, coachPuppetUrl } from './coach-portraits.js';
import { COACH_ANIMATION_LABELS } from './coach-repertoire.js';
import { createCoachIdleCycle } from './coach-idle-cycle.js';

const COACH_IDS = new Set(['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil', 'baby']);
const MOVE_GRADES = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder']);
const IDLE_DELAYS = Object.freeze({ meowl: 9000, owl: 11000, paws: 8000, mellow: 13000, scout: 10000, evil: 11000, baby: 10000 });
const FRAME_INTERVAL = 1000 / 60;
const COMPACT_FRAME_INTERVAL = 1000 / 30;
const START_WAIT_LIMIT = 2500;
const SETTLE_DURATION = 180;
const AMBIENT_DURATION = 1100;
const AMBIENT_GESTURE_GAP = 450;
const VOICE_WAIT_LIMIT = 15000;
const puppets = new Map(), readyPuppets = new Map();

function ambientPoseAt(elapsed, coachId, take) {
  const pose = { blink: 0, lookX: 0, lookY: 0 };
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= AMBIENT_DURATION) return pose;
  const smooth = (from, to) => {
    const t = Math.max(0, Math.min(1, (elapsed - from) / (to - from)));
    return t * t * (3 - 2 * t);
  };
  const pace = coachId === 'mellow' ? 1.15 : coachId === 'baby' ? 1.1 : 1;
  // Both eyelids close together, pause briefly, then reopen more gently. The
  // small occasional glance happens while closed and returns to eye contact.
  pose.blink = smooth(100, 170 * pace) * (1 - smooth(240 * pace, 370 * pace));
  const direction = [0, -.18, .16, -.12, 0, .18][take % 6];
  const glance = smooth(210, 350) * (1 - smooth(690, 970));
  pose.lookX = direction * glance;
  pose.lookY = (direction ? (take % 2 ? .07 : -.035) : 0) * glance;
  return pose;
}

function loadPuppet(coachId) {
  coachId = coachArtworkId(coachId);
  if (puppets.has(coachId)) return puppets.get(coachId);
  if (typeof globalThis.Image !== 'function') return Promise.resolve(null);
  const pending = new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const done = puppet => {
      if (settled) return;
      settled = true; clearTimeout(loadTimer);
      image.onload = null; image.onerror = null;
      resolve(puppet);
    };
    // A failed local decode must not leave an unresolvable promise in the cache.
    const loadTimer = setTimeout(() => done(null), 4000);
    image.onload = async () => {
      try { if (image.decode) await image.decode(); } catch { /* onload already guarantees a usable image. */ }
      if (settled) return;
      try {
        done(image.naturalWidth === 1254 && image.naturalHeight === 1254 ? createCoachPuppet(image, globalThis.document, coachId) : null);
      } catch { done(null); }
    };
    image.onerror = () => done(null);
    image.src = coachPuppetUrl(coachId);
  }).then(puppet => {
    if (!puppet) puppets.delete(coachId);
    else readyPuppets.set(coachId, puppet);
    return puppet;
  });
  puppets.set(coachId, pending);
  return pending;
}

/** Animate the existing drawing, with finite gestures and no background render loop. */
export function createCoachMotion({ isEnabled = () => true, isVisible = () => true } = {}) {
  const active = new Map(), wrappers = new WeakMap(), variations = new Map(), voices = new Map();
  const idleCycle = createCoachIdleCycle();
  const document = globalThis.document;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) || (callback => setTimeout(callback, FRAME_INTERVAL));
  const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout;
  let disposed = false, observing = false, idle = null;

  const allowed = () => !disposed && isEnabled() && isVisible() && document?.visibilityState !== 'hidden';
  const observer = typeof MutationObserver === 'function' && document
    ? new MutationObserver(() => {
      if (idle && !idle.image.isConnected) clearIdle();
      for (const [image, reaction] of active) if (!image.isConnected) finish(image, reaction);
    }) : null;

  function syncObserver() {
    if (!observer) return;
    if ((active.size || idle) && !observing) {
      observer.observe(document.documentElement, { childList: true, subtree: true }); observing = true;
    } else if (!active.size && !idle && observing) { observer.disconnect(); observing = false; }
  }

  function clearVoice(image) {
    const voice = voices.get(image);
    if (voice) clearTimeout(voice.timer);
    voices.delete(image);
  }

  function currentVoice(image) {
    const voice = voices.get(image);
    if (!voice) return null;
    try { if (now() < voice.expiresAt && voice.isPlaying()) return voice; } catch { /* A stopped audio context is no longer a voice. */ }
    clearVoice(image);
    return null;
  }

  function startVoice(image, voice, handoff = {}) {
    const actor = actorFor(image);
    actor.dataset.coach = voice.coachId;
    actor.dataset.compact = String(image.getBoundingClientRect().width < 50);
    actor.dataset.reaction = 'voice';
    const reaction = { actor, image, effects: [], pausedEffects: [], coachId: voice.coachId, kind: 'voice', poseKind: null,
      duration: Math.max(1, voice.expiresAt - now()), variation: 0, voiceControlled: true,
      started: null, timer: null, frameHandle: null, frameInterval: FRAME_INTERVAL,
      canvas: handoff.canvas || null, puppet: handoff.puppet || readyPuppets.get(voice.coachId) || null, lastPose: null,
      transition: null, ending: false, bubble: null, animationVersion: 0 };
    active.set(image, reaction);
    reaction.timer = setTimeout(() => finish(image, reaction), START_WAIT_LIMIT);
    void animate(image, reaction); syncObserver();
  }

  /** Prepare the visible mouth before a short recording starts. */
  async function prepareVoice(image, { coachId = 'meowl' } = {}) {
    const visible = () => !disposed && isVisible() && document?.visibilityState !== 'hidden'
      && image?.tagName === 'IMG' && image.isConnected && image.getClientRects().length > 0;
    if (!visible()) return false;
    // Sound remains independent when the user explicitly disables movement.
    if (!isEnabled() || reducedMotion?.matches) return true;
    coachId = COACH_IDS.has(coachId) ? coachId : 'meowl';
    const puppet = await loadPuppet(coachId);
    return !!puppet && visible();
  }

  /** Attach a real audio playback clock without replacing the current gesture. */
  function setVoice(image, { coachId = 'meowl', getMouth, isPlaying, durationMs } = {}) {
    if (image?.tagName !== 'IMG' || !image.isConnected || !image.getClientRects().length || !allowed() || reducedMotion?.matches
      || typeof getMouth !== 'function' || typeof isPlaying !== 'function' || !Number.isFinite(durationMs) || durationMs <= 0) return false;
    coachId = COACH_IDS.has(coachId) ? coachId : 'meowl';
    const reaction = active.get(image);
    if (reaction && reaction.coachId !== coachId) return false;
    try { if (!isPlaying()) return false; } catch { return false; }
    clearVoice(image);
    const voice = { coachId, getMouth, isPlaying, expiresAt: now() + Math.min(VOICE_WAIT_LIMIT, durationMs + 250), timer: null };
    voices.set(image, voice);
    voice.timer = setTimeout(() => {
      if (voices.get(image) !== voice) return;
      clearVoice(image);
      const current = active.get(image);
      if (current?.kind === 'voice') complete(image, current);
    }, voice.expiresAt - now());
    if (idle?.image === image) {
      clearTimeout(idle.timer); idle.timer = null;
      clearTimeout(idle.ambientTimer); idle.ambientTimer = null;
    }
    if (reaction) reaction.voiceControlled = true;
    else startVoice(image, voice);
    return true;
  }

  function clearIdle(finishReaction = true) {
    const previous = idle; idle = null;
    if (previous) {
      clearTimeout(previous.timer);
      clearTimeout(previous.ambientTimer);
      const reaction = active.get(previous.image);
      if (finishReaction && (reaction?.kind === 'idle' || reaction?.kind === 'ambient')) finish(previous.image, reaction);
    }
    syncObserver();
  }

  function scheduleIdle(delay) {
    if (!idle) return;
    clearTimeout(idle.timer); idle.timer = null;
    clearTimeout(idle.ambientTimer); idle.ambientTimer = null;
    if (!allowed() || reducedMotion?.matches || !idle.image.isConnected || !idle.image.getClientRects().length) { clearIdle(); return; }
    if (active.has(idle.image)) return;
    const registration = idle;
    registration.dueAt = now() + delay;
    registration.timer = setTimeout(() => {
      if (idle !== registration) return;
      registration.timer = null;
      if (!react(registration.image, { kind: 'idle', coachId: registration.coachId })) clearIdle();
    }, delay);
    scheduleAmbient(registration);
  }

  function scheduleAmbient(registration) {
    if (idle !== registration) return;
    clearTimeout(registration.ambientTimer); registration.ambientTimer = null;
    if (!allowed() || reducedMotion?.matches || !registration.image.isConnected || !registration.image.getClientRects().length) { clearIdle(); return; }
    if (active.has(registration.image) || registration.timer === null) return;
    const delay = 2100 + Math.round(Math.random() * 1400);
    // The full-body deadline remains owned by scheduleIdle. Face activity can
    // neither postpone that gesture nor start too close to its anticipation.
    if (now() + delay + AMBIENT_DURATION + AMBIENT_GESTURE_GAP > registration.dueAt) return;
    registration.ambientTimer = setTimeout(() => {
      if (idle !== registration) return;
      registration.ambientTimer = null;
      if (!allowed() || reducedMotion?.matches || !registration.image.isConnected || !registration.image.getClientRects().length) { clearIdle(); return; }
      if (active.has(registration.image)) return;
      const image = registration.image, actor = actorFor(image);
      actor.dataset.coach = registration.coachId;
      actor.dataset.compact = String(image.getBoundingClientRect().width < 50);
      actor.dataset.reaction = 'ambient';
      const reaction = { actor, image, effects: [], pausedEffects: [], coachId: registration.coachId, kind: 'ambient', poseKind: null,
        duration: AMBIENT_DURATION, variation: registration.faceTake++, started: null, timer: null, frameHandle: null,
        frameInterval: COMPACT_FRAME_INTERVAL, canvas: null, puppet: null, lastPose: null, transition: null, ending: false, bubble: null, animationVersion: 0 };
      active.set(image, reaction);
      reaction.timer = setTimeout(() => finish(image, reaction), START_WAIT_LIMIT);
      void animate(image, reaction); syncObserver();
    }, delay);
  }

  function setIdle(image, { coachId = 'meowl' } = {}) {
    if (image?.tagName !== 'IMG' || !image.isConnected || !image.getClientRects().length || !allowed() || reducedMotion?.matches) { clearIdle(); return false; }
    coachId = COACH_IDS.has(coachId) ? coachId : 'meowl';
    if (idle?.image === image && idle.coachId === coachId) return true;
    // Warm only the visible selected companion. Other coaches build their
    // cached layers on first use; hidden/disabled views need no canvas artwork.
    void loadPuppet(coachId);
    clearIdle(); idle = { image, coachId, timer: null, ambientTimer: null, dueAt: 0, faceTake: 0 };
    scheduleIdle(6000); syncObserver();
    return true;
  }

  function clearSprite(reaction, keepCanvas = false) {
    reaction.animationVersion++;
    if (reaction.frameHandle !== null) cancelFrame(reaction.frameHandle);
    reaction.frameHandle = null;
    if (!keepCanvas) reaction.canvas?.remove();
    reaction.canvas = null;
    reaction.transition = null;
    delete reaction.actor.dataset.transition;
    if (!keepCanvas) delete reaction.actor.dataset.spriteActive;
  }

  function finish(image, reaction, { keepCanvas = false, resumeIdle = true, resumeVoice = true } = {}) {
    if (active.get(image) !== reaction) return;
    const voice = resumeVoice && allowed() && !reducedMotion?.matches && image.isConnected && image.getClientRects().length ? currentVoice(image) : null;
    const voiceHandoff = voice ? { canvas: reaction.canvas, puppet: reaction.puppet } : null;
    clearTimeout(reaction.timer);
    clearSprite(reaction, keepCanvas || !!voice);
    active.delete(image);
    delete reaction.actor.dataset.reaction;
    delete reaction.actor.dataset.reducedMotion;
    delete reaction.actor.dataset.grade;
    delete reaction.actor.dataset.variation;
    reaction.actor.style.removeProperty('--coach-reaction-duration');
    for (const element of reaction.effects) element.remove();
    if (voice) { startVoice(image, voice, voiceHandoff); return; }
    if (resumeVoice && (!allowed() || reducedMotion?.matches || !image.isConnected || !image.getClientRects().length)) clearVoice(image);
    if (resumeIdle && idle?.image === image) {
      if (reaction.kind === 'ambient' && idle.timer !== null) scheduleAmbient(idle);
      else scheduleIdle(IDLE_DELAYS[idle.coachId] + Math.round((Math.random() * 2 - 1) * 1800));
    }
    syncObserver();
  }

  function stop({ settle = false } = {}) {
    for (const image of voices.keys()) clearVoice(image);
    clearIdle(!settle);
    for (const [image, reaction] of active) {
      if (!settle || !allowed() || reducedMotion?.matches || !reaction.canvas || !reaction.puppet || !reaction.lastPose || !image.isConnected) {
        finish(image, reaction); continue;
      }
      const stamp = now(), endsAt = reaction.transition?.endsAt ?? stamp + SETTLE_DURATION;
      clearTimeout(reaction.timer);
      if (reaction.frameHandle !== null) cancelFrame(reaction.frameHandle);
      reaction.frameHandle = null;
      for (const element of reaction.effects) element.remove();
      reaction.effects.length = 0; reaction.pausedEffects.length = 0; reaction.bubble = null;
      reaction.transition = { from: reaction.lastPose, started: stamp, endsAt, rest: true };
      reaction.actor.dataset.transition = 'settle';
      reaction.started = null; reaction.ending = false;
      reaction.timer = setTimeout(() => finish(image, reaction), Math.max(0, endsAt - stamp) + 500);
      void animate(image, reaction);
    }
  }

  function actorFor(image) {
    let actor = wrappers.get(image);
    if (actor?.isConnected && image.parentElement === actor) return actor;
    actor = image.ownerDocument.createElement('span');
    actor.className = 'coach-actor';
    actor.setAttribute('aria-hidden', 'true');
    image.replaceWith(actor); actor.append(image);
    wrappers.set(image, actor);
    return actor;
  }

  function decoration(actor, className, text) {
    const element = actor.ownerDocument.createElement('span');
    element.className = className; element.setAttribute('aria-hidden', 'true');
    if (text) element.textContent = text;
    actor.append(element);
    return element;
  }

  function staticTalk(reaction) {
    if (reaction.kind === 'talk' && reaction.actor.dataset.compact !== 'true' && !reaction.bubble) {
      reaction.bubble = decoration(reaction.actor, 'coach-reaction-bubble', 'meow');
      reaction.effects.push(reaction.bubble);
    }
  }

  function begin(image, reaction) {
    if (active.get(image) !== reaction) return false;
    if (!allowed() || !image.isConnected || !image.getClientRects().length) { finish(image, reaction); return false; }
    if (reaction.started === null) {
      // The first visible frame owns time zero, so a cold SVG decode cannot
      // swallow the anticipation at the beginning of a character's routine.
      reaction.started = now();
      clearTimeout(reaction.timer);
      reaction.timer = setTimeout(() => complete(image, reaction), reaction.duration);
      for (const element of reaction.pausedEffects) element.style.removeProperty('animation-play-state');
      reaction.pausedEffects.length = 0;
    }
    return true;
  }

  function drawFrame(reaction, puppet, elapsed, poseOverride) {
    const { actor } = reaction;
    const bounds = actor.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    // The large companion gets full display cadence; tiny message portraits
    // spend half as much paint work while retaining the same gesture timing.
    reaction.frameInterval = reaction.kind !== 'ambient' && bounds.width >= 100 ? FRAME_INTERVAL : COMPACT_FRAME_INTERVAL;
    let canvas = reaction.canvas;
    if (!canvas) {
      canvas = actor.ownerDocument.createElement('canvas');
      canvas.className = 'coach-reaction-sprite coach-reaction-puppet';
      canvas.setAttribute('aria-hidden', 'true');
      actor.prepend(canvas); reaction.canvas = canvas;
    }
    const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    const width = Math.round(bounds.width * ratio), height = Math.round(bounds.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d');
    if (!context) { clearSprite(reaction); return false; }
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.save(); context.scale(width / puppet.width, height / puppet.height);
    // Fit complete talking phrases to the reply duration. Every phrase begins and
    // ends with a closed mouth, so a longer answer never snaps midway through a syllable.
    let poseTime = elapsed;
    let phrase = 0;
    if (reaction.kind === 'talk' && reaction.duration !== DURATIONS.talk) {
      const phrases = Math.max(1, Math.round(reaction.duration / DURATIONS.talk));
      phrase = Math.floor((elapsed / reaction.duration) * phrases);
      poseTime = ((elapsed / reaction.duration) * phrases % 1) * DURATIONS.talk;
    }
    let pose = poseOverride ?? (reaction.kind === 'ambient'
      ? ambientPoseAt(elapsed, reaction.coachId, reaction.variation)
      : reaction.kind === 'voice' ? {} : coachPoseAt(reaction.poseKind, poseTime, reaction.coachId, reaction.variation + phrase));
    if (reaction.voiceControlled) {
      const voice = currentVoice(reaction.image);
      let mouth = 0;
      try { const value = voice?.getMouth(); if (Number.isFinite(value)) mouth = Math.max(0, Math.min(1, value)); } catch { /* Closed mouth is the safe fallback for a finished source. */ }
      pose = { ...pose, mouth };
    }
    drawCoachPuppet(context, puppet, pose); context.restore();
    reaction.lastPose = pose;
    canvas.dataset.frame = String(Math.floor(elapsed / FRAME_INTERVAL));
    actor.dataset.spriteActive = 'true';
    return true;
  }

  function complete(image, reaction) {
    if (active.get(image) !== reaction || reaction.ending) return;
    clearTimeout(reaction.timer);
    if (reaction.frameHandle !== null) cancelFrame(reaction.frameHandle);
    reaction.frameHandle = null;
    if (!allowed() || reducedMotion?.matches || !image.isConnected || !reaction.puppet || !reaction.canvas) { finish(image, reaction); return; }
    // Paint the exact resting artwork before returning ownership to the IMG.
    // This avoids swapping a still-moving last frame for the resting portrait.
    if (!drawFrame(reaction, reaction.puppet, reaction.duration, {})) { finish(image, reaction); return; }
    reaction.ending = true;
    reaction.frameHandle = requestFrame(() => finish(image, reaction));
  }

  function settlingPose(from, progress) {
    const t = Math.max(0, Math.min(1, progress)), remaining = 1 - t * t * (3 - 2 * t);
    const pose = {};
    // Keep spatial prop coordinates in place as their visibility closes down;
    // interpolating a feather's Y toward zero would fling it past the head.
    const held = { featherX: 'feather', featherY: 'feather', featherAngle: 'feather', pageTurn: 'book', steamPhase: 'steam', glassAngle: 'magnifier', flagFlutter: 'pennant' };
    for (const [key, value] of Object.entries(from)) if (Number.isFinite(value)) {
      pose[key] = remaining && held[key] && from[held[key]] > 0 ? value : value * remaining;
    }
    return pose;
  }

  async function animate(image, reaction) {
    const version = ++reaction.animationVersion;
    const puppet = reaction.puppet || await loadPuppet(reaction.coachId);
    if (active.get(image) !== reaction || version !== reaction.animationVersion || reducedMotion?.matches) return;
    reaction.puppet = puppet;
    if (!puppet) { if (begin(image, reaction)) staticTalk(reaction); return; }
    let lastPaint = -Infinity;
    const next = () => {
      reaction.frameHandle = null;
      if (active.get(image) !== reaction || version !== reaction.animationVersion) return;
      if (!allowed() || !image.isConnected || !image.getClientRects().length) { finish(image, reaction); return; }
      if (reducedMotion?.matches) {
        if (reaction.transition?.rest) { finish(image, reaction); return; }
        reaction.actor.dataset.reducedMotion = 'true';
        clearSprite(reaction); if (begin(image, reaction)) staticTalk(reaction);
        return;
      }
      if (reaction.kind === 'voice' && !currentVoice(image)) { complete(image, reaction); return; }
      const stamp = now();
      if (reaction.transition) {
        const transition = reaction.transition;
        const progress = (stamp - transition.started) / Math.max(1, transition.endsAt - transition.started);
        if (progress < 1) {
          if (stamp - lastPaint >= reaction.frameInterval - 1) {
            if (!drawFrame(reaction, puppet, 0, settlingPose(transition.from, progress))) { finish(image, reaction); return; }
            lastPaint = stamp;
          }
          reaction.frameHandle = requestFrame(next); return;
        }
        reaction.transition = null; delete reaction.actor.dataset.transition;
        if (transition.rest) { complete(image, reaction); return; }
        lastPaint = -Infinity;
      }
      if (!begin(image, reaction)) return;
      const elapsed = now() - reaction.started;
      if (elapsed >= reaction.duration) { complete(image, reaction); return; }
      if (elapsed - lastPaint >= reaction.frameInterval - 1) {
        if (!drawFrame(reaction, puppet, elapsed)) { finish(image, reaction); return; }
        lastPaint = Number.isFinite(lastPaint)
          ? lastPaint + reaction.frameInterval * Math.max(1, Math.floor((elapsed - lastPaint) / reaction.frameInterval)) : elapsed;
      }
      reaction.frameHandle = requestFrame(next);
    };
    next();
  }

  function react(image, { kind = 'talk', coachId = 'meowl', grade, durationMs, waitForVoice = false } = {}) {
    if (!Object.hasOwn(DURATIONS, kind) || image?.tagName !== 'IMG' || !image.isConnected || !image.getClientRects().length || !allowed()) return false;
    if (kind === 'idle' && reducedMotion?.matches) return false;
    coachId = COACH_IDS.has(coachId) ? coachId : 'meowl';
    const stamp = now(), current = active.get(image);
    const handoff = current?.coachId === coachId && !reducedMotion?.matches && current.canvas?.isConnected && current.puppet && current.lastPose
      ? { canvas: current.canvas, puppet: current.puppet, from: current.lastPose, started: stamp, endsAt: current.transition?.endsAt ?? stamp + SETTLE_DURATION } : null;
    if (current) finish(image, current, { keepCanvas: !!handoff, resumeIdle: false, resumeVoice: false });
    if (voices.get(image)?.coachId !== coachId) clearVoice(image);
    if (idle?.image === image) {
      clearTimeout(idle.timer); idle.timer = null;
      clearTimeout(idle.ambientTimer); idle.ambientTimer = null;
    }
    const actor = actorFor(image);
    const poseKind = kind === 'celebrate' && grade === 'Great' ? 'great' : kind;
    const key = `${coachId}:${poseKind}`, previous = variations.get(key);
    // The companion and its new chat portrait share one gesture. Later replies
    // cycle through complete routines, never randomized frames within a movement.
    const takeCount = COACH_ANIMATION_LABELS[poseKind]?.[coachId]?.length || 3;
    const variation = previous && stamp - previous.at < 100 ? previous.variation
      : poseKind === 'idle' ? idleCycle.next(coachId, takeCount)
      : previous ? (previous.variation + 1) % takeCount : 0;
    variations.set(key, { at: stamp, variation });
    actor.dataset.coach = coachId;
    actor.dataset.variation = String(variation);
    actor.dataset.compact = String(image.getBoundingClientRect().width < 50);
    if (reducedMotion?.matches) actor.dataset.reducedMotion = 'true';
    actor.dataset.reaction = kind;
    if (MOVE_GRADES.has(grade)) actor.dataset.grade = grade;
    const duration = kind === 'talk' && Number.isFinite(durationMs)
      ? Math.min(6000, Math.max(DURATIONS.talk, durationMs)) : DURATIONS[kind];
    actor.style.setProperty('--coach-reaction-duration', `${duration}ms`);
    const effects = [];
    const rating = kind === 'brilliant' ? 'Brilliant' : MOVE_GRADES.has(grade) ? grade : kind === 'great' ? 'Great' : kind === 'celebrate' ? 'Best' : null;
    if (rating && kind !== 'idle' && kind !== 'think') {
      const badge = decoration(actor, `coach-reaction-badge${kind === 'celebrate' ? ' coach-reaction-badge-celebrate' : ''}`);
      badge.dataset.rating = rating;
      const icon = actor.ownerDocument.createElement('img');
      icon.src = new URL(`../move-icons/${rating.toLowerCase()}.svg`, import.meta.url).href;
      icon.alt = ''; icon.draggable = false; badge.append(icon); effects.push(badge);
    }
    if (kind === 'brilliant' || kind === 'celebrate' || kind === 'great') {
      const stars = decoration(actor, `coach-reaction-stars${kind === 'celebrate' ? ' coach-reaction-stars-celebrate' : ''}`);
      for (let index = 0; index < (kind === 'brilliant' ? 3 : 2); index++) {
        const star = actor.ownerDocument.createElement('span');
        const sparkle = actor.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sparkle.setAttribute('viewBox', '0 0 24 24');
        const path = actor.ownerDocument.createElementNS(sparkle.namespaceURI, 'path');
        path.setAttribute('d', 'M12 1l3 8 8 3-8 3-3 8-3-8-8-3 8-3z');
        path.setAttribute('fill', 'currentColor'); sparkle.append(path); star.append(sparkle); stars.append(star);
      }
      effects.push(stars);
      if (kind === 'brilliant' && actor.dataset.compact !== 'true') effects.push(decoration(actor, 'coach-reaction-ring'));
    } else if ((kind === 'curious' || kind === 'think') && actor.dataset.compact !== 'true') {
      const thought = decoration(actor, 'coach-reaction-thought');
      for (let index = 0; index < 3; index++) thought.append(actor.ownerDocument.createElement('i'));
      effects.push(thought);
    }
    const pausedEffects = effects.flatMap(element => [element, ...element.querySelectorAll('*')]);
    for (const element of pausedEffects) element.style.animationPlayState = 'paused';
    const transition = handoff && Object.values(handoff.from).some(value => Number.isFinite(value) && Math.abs(value) > .0001) ? handoff : null;
    const reaction = { actor, image, effects, pausedEffects, coachId, kind, poseKind, duration, variation, voiceControlled: waitForVoice || !!currentVoice(image), started: null, timer: null, frameHandle: null, frameInterval: FRAME_INTERVAL, canvas: handoff?.canvas || null, puppet: handoff?.puppet || null, lastPose: handoff?.from || null, transition, ending: false, bubble: null, animationVersion: 0 };
    if (transition) actor.dataset.transition = 'settle';
    active.set(image, reaction);
    // Keep loading finite too. Replacing or stopping this reaction clears the
    // same timer, and its pending decode cannot resurrect an old gesture.
    reaction.timer = setTimeout(() => finish(image, reaction), START_WAIT_LIMIT);
    if (reducedMotion?.matches) { if (begin(image, reaction)) staticTalk(reaction); } else void animate(image, reaction);
    syncObserver();
    return true;
  }

  const onVisibilityChange = () => { if (document.visibilityState === 'hidden') stop(); };
  const onMotionChange = () => {
    if (reducedMotion.matches) { for (const image of voices.keys()) clearVoice(image); clearIdle(); }
    for (const [image, reaction] of active) {
      if (reducedMotion.matches && reaction.kind === 'voice') { finish(image, reaction); continue; }
      if (reaction.ending || reaction.transition?.rest) { finish(image, reaction); continue; }
      if (reducedMotion.matches) {
        reaction.actor.dataset.reducedMotion = 'true';
        clearSprite(reaction); if (begin(image, reaction)) staticTalk(reaction);
      } else {
        delete reaction.actor.dataset.reducedMotion;
        reaction.bubble?.remove(); reaction.bubble = null;
        void animate(image, reaction);
      }
    }
  };
  document?.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion?.addEventListener?.('change', onMotionChange);
  return {
    react,
    prepareVoice,
    setVoice,
    setIdle,
    stop,
    dispose() {
      if (disposed) return;
      disposed = true; stop(); variations.clear(); idleCycle.clear(); observer?.disconnect();
      document?.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion?.removeEventListener?.('change', onMotionChange);
    },
  };
}
