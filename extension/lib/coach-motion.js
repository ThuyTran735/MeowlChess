import { createCoachPuppet, drawCoachPuppet, coachPoseAt, COACH_REACTION_DURATIONS as DURATIONS } from './coach-puppet.js';
import { coachArtworkId } from './coach-portraits.js';

const COACH_IDS = new Set(['meowl', 'owl', 'paws', 'mellow', 'scout']);
const IDLE_DELAYS = Object.freeze({ meowl: 9000, owl: 11000, paws: 8000, mellow: 13000, scout: 10000 });
const puppets = new Map();

function loadPuppet(coachId) {
  coachId = coachArtworkId(coachId);
  if (puppets.has(coachId)) return puppets.get(coachId);
  if (typeof globalThis.Image !== 'function') return Promise.resolve(null);
  const pending = new Promise(resolve => {
    const image = new Image();
    image.onload = async () => {
      try { if (image.decode) await image.decode(); } catch { /* onload already guarantees a usable image. */ }
      try {
        resolve(image.naturalWidth === 1254 && image.naturalHeight === 1254 ? createCoachPuppet(image, globalThis.document, coachId) : null);
      } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = new URL(`../icons/coaches/MeowlChess-coach-${coachId}.png`, import.meta.url).href;
  }).then(puppet => {
    if (!puppet) puppets.delete(coachId);
    return puppet;
  });
  puppets.set(coachId, pending);
  return pending;
}

/** Animate only the original portrait's mouth, eyelids, and painted wings. */
export function createCoachMotion({ isEnabled = () => true, isVisible = () => true } = {}) {
  const active = new Map(), wrappers = new WeakMap();
  const document = globalThis.document;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
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

  function clearIdle() {
    const previous = idle; idle = null;
    if (previous) {
      clearTimeout(previous.timer);
      const reaction = active.get(previous.image);
      if (reaction?.kind === 'idle') finish(previous.image, reaction);
    }
    syncObserver();
  }

  function scheduleIdle(delay) {
    if (!idle) return;
    clearTimeout(idle.timer); idle.timer = null;
    if (!allowed() || reducedMotion?.matches || !idle.image.isConnected || !idle.image.getClientRects().length) { clearIdle(); return; }
    if (active.has(idle.image)) return;
    const registration = idle;
    registration.timer = setTimeout(() => {
      if (idle !== registration) return;
      registration.timer = null;
      if (!react(registration.image, { kind: 'idle', coachId: registration.coachId })) clearIdle();
    }, delay);
  }

  function setIdle(image, { coachId = 'meowl' } = {}) {
    if (image?.tagName !== 'IMG' || !image.isConnected || !image.getClientRects().length || !allowed() || reducedMotion?.matches) { clearIdle(); return false; }
    coachId = COACH_IDS.has(coachId) ? coachId : 'meowl';
    if (idle?.image === image && idle.coachId === coachId) return true;
    clearIdle(); idle = { image, coachId, timer: null };
    scheduleIdle(6000); syncObserver();
    return true;
  }

  function clearSprite(reaction) {
    reaction.animationVersion++;
    clearTimeout(reaction.frameTimer);
    reaction.frameTimer = null;
    reaction.canvas?.remove();
    reaction.canvas = null;
    delete reaction.actor.dataset.spriteActive;
  }

  function finish(image, reaction) {
    if (active.get(image) !== reaction) return;
    clearTimeout(reaction.timer);
    clearSprite(reaction);
    active.delete(image);
    delete reaction.actor.dataset.reaction;
    delete reaction.actor.dataset.reducedMotion;
    for (const element of reaction.effects) element.remove();
    if (idle?.image === image) scheduleIdle(IDLE_DELAYS[idle.coachId]);
    syncObserver();
  }

  function stop() {
    clearIdle();
    for (const [image, reaction] of active) finish(image, reaction);
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

  function drawFrame(reaction, puppet, elapsed) {
    const { actor } = reaction;
    const bounds = actor.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
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
    drawCoachPuppet(context, puppet, coachPoseAt(reaction.kind, elapsed, reaction.coachId)); context.restore();
    canvas.dataset.frame = String(Math.floor(elapsed / 40));
    actor.dataset.spriteActive = 'true';
    return true;
  }

  async function animate(image, reaction) {
    const version = ++reaction.animationVersion;
    const puppet = await loadPuppet(reaction.coachId);
    if (!puppet || active.get(image) !== reaction || version !== reaction.animationVersion || reducedMotion?.matches) return;
    const next = () => {
      if (active.get(image) !== reaction || version !== reaction.animationVersion) return;
      if (!allowed() || !image.isConnected || !image.getClientRects().length) { finish(image, reaction); return; }
      if (reducedMotion?.matches) { clearSprite(reaction); return; }
      const elapsed = Date.now() - reaction.started;
      if (elapsed >= DURATIONS[reaction.kind]) { finish(image, reaction); return; }
      if (drawFrame(reaction, puppet, elapsed)) reaction.frameTimer = setTimeout(next, Math.min(40, DURATIONS[reaction.kind] - elapsed));
    };
    next();
  }

  function react(image, { kind = 'talk', coachId = 'meowl', grade } = {}) {
    if (!Object.hasOwn(DURATIONS, kind) || image?.tagName !== 'IMG' || !image.isConnected || !image.getClientRects().length || !allowed()) return false;
    if (kind === 'idle' && reducedMotion?.matches) return false;
    const current = active.get(image);
    if (current) finish(image, current);
    if (idle?.image === image) { clearTimeout(idle.timer); idle.timer = null; }
    const actor = actorFor(image);
    coachId = COACH_IDS.has(coachId) ? coachId : 'meowl';
    actor.dataset.coach = coachId;
    actor.dataset.compact = String(image.getBoundingClientRect().width < 50);
    if (reducedMotion?.matches) actor.dataset.reducedMotion = 'true';
    actor.dataset.reaction = kind;
    const effects = [];
    if (kind === 'brilliant' || kind === 'celebrate') {
      const rating = kind === 'brilliant' ? 'Brilliant' : grade === 'Great' ? 'Great' : 'Best';
      const badge = decoration(actor, `coach-reaction-badge${kind === 'celebrate' ? ' coach-reaction-badge-celebrate' : ''}`);
      badge.dataset.rating = rating;
      const icon = actor.ownerDocument.createElement('img');
      icon.src = new URL(`../move-icons/${rating.toLowerCase()}.svg`, import.meta.url).href;
      icon.alt = ''; icon.draggable = false; badge.append(icon); effects.push(badge);
      const stars = decoration(actor, `coach-reaction-stars${kind === 'celebrate' ? ' coach-reaction-stars-celebrate' : ''}`);
      for (let index = 0; index < 3; index++) {
        const star = actor.ownerDocument.createElement('span'); star.textContent = '✦'; stars.append(star);
      }
      effects.push(stars);
      if (kind === 'brilliant' && actor.dataset.compact !== 'true') effects.push(decoration(actor, 'coach-reaction-ring'));
    } else if (kind === 'curious' && actor.dataset.compact !== 'true') {
      effects.push(decoration(actor, 'coach-reaction-thought', '…'));
    }
    const reaction = { actor, effects, coachId, kind, started: Date.now(), timer: null, frameTimer: null, canvas: null, bubble: null, animationVersion: 0 };
    active.set(image, reaction);
    reaction.timer = setTimeout(() => finish(image, reaction), DURATIONS[kind]);
    if (reducedMotion?.matches) staticTalk(reaction); else void animate(image, reaction);
    syncObserver();
    return true;
  }

  const onVisibilityChange = () => { if (document.visibilityState === 'hidden') stop(); };
  const onMotionChange = () => {
    if (reducedMotion.matches) clearIdle();
    for (const [image, reaction] of active) {
      if (reducedMotion.matches) {
        reaction.actor.dataset.reducedMotion = 'true';
        clearSprite(reaction); staticTalk(reaction);
      } else {
        delete reaction.actor.dataset.reducedMotion;
        reaction.bubble?.remove(); reaction.bubble = null;
        void animate(image, reaction);
      }
    }
  };
  document?.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion?.addEventListener?.('change', onMotionChange);
  for (const coachId of COACH_IDS) void loadPuppet(coachId);

  return {
    react,
    setIdle,
    stop,
    dispose() {
      if (disposed) return;
      disposed = true; stop(); observer?.disconnect();
      document?.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion?.removeEventListener?.('change', onMotionChange);
    },
  };
}
