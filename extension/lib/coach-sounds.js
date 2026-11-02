import { COACH_MEOW_CLIPS } from './coach-audio-clips.js';

// Real cat recordings bundled with the extension. No microphone or remote audio.
const KINDS = new Set(['talk', 'brilliant', 'celebrate', 'curious', 'greeting']);
const COACHES = new Set(['meowl', 'owl', 'paws', 'mellow', 'scout']);
const MASTER_GAIN = 0.65;

export function createCoachSounds({
  isEnabled = () => false,
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  fetchAudio = (...args) => globalThis.fetch(...args),
  random = Math.random,
  getVolume = () => 1,
  clips = COACH_MEOW_CLIPS,
} = {}) {
  const catalog = Array.isArray(clips) ? clips.filter((clip, index, all) =>
    clip && typeof clip.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:wav|mp3|ogg)$/i.test(clip.file)
    && all.findIndex(item => item?.id === clip.id) === index
  ).map(clip => ({ ...clip, kinds: Array.isArray(clip.kinds) ? [...clip.kinds] : [] })) : [];
  let context = null, voice = null, pendingLoad = null, revision = 0, disposed = false, lastClip = null;
  const buffers = new Map(), variations = new Map(), lastByCoach = new Map();
  const allowed = () => !disposed && isEnabled() && isVisible() && globalThis.document?.visibilityState !== 'hidden';

  function volumeLevel() {
    try {
      const value = Number(getVolume());
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    } catch { return 1; }
  }

  function shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      let sample;
      try { sample = Number(random()); } catch { sample = 0; }
      const unit = Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : 0;
      const other = Math.floor(unit * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function nextClip(coach, kind) {
    const matching = catalog.filter(clip => clip.kinds.includes(kind));
    const bank = matching.length ? matching : catalog;
    if (!bank.length) return null;
    const key = `${coach}:${kind}`;
    let remaining = variations.get(key);
    if (!remaining?.length) { remaining = shuffled(bank); variations.set(key, remaining); }
    let index = remaining.findLastIndex(clip => clip.id !== lastClip && clip.id !== lastByCoach.get(coach));
    if (index < 0) index = remaining.findLastIndex(clip => clip.id !== lastClip);
    if (index >= 0) return remaining.splice(index, 1)[0];
    // A different reaction may have just used the final clip in this bag.
    // Prefer a fresh recording over repeating that sound across categories.
    const alternatives = bank.filter(clip => clip.id !== lastClip);
    const fallback = alternatives.length ? alternatives : catalog.filter(clip => clip.id !== lastClip);
    return fallback.length ? shuffled(fallback).pop() : remaining.pop();
  }

  function release(current, stop = false) {
    if (!current || current.released) return;
    current.released = true;
    if (stop && current.source) {
      try { current.source.stop(); } catch { /* A partial or ended source is harmless. */ }
    }
    for (const node of current.nodes) {
      try { node.disconnect(); } catch { /* Already disconnected or unavailable. */ }
    }
    if (voice === current) voice = null;
  }

  function stop() {
    revision++;
    pendingLoad?.abort(); pendingLoad = null;
    release(voice, true);
  }

  async function ready() {
    if (!allowed() || !catalog.length) return null;
    try {
      if (!context || context.state === 'closed') { context = createContext(); buffers.clear(); }
      const audio = context;
      if (audio.state === 'suspended') await audio.resume();
      return allowed() && context === audio && audio.state === 'running' ? audio : null;
    } catch { return null; }
  }

  async function decoded(clip, audio, currentRevision) {
    if (buffers.has(clip.id)) return buffers.get(clip.id);
    const controller = new AbortController(); pendingLoad = controller;
    const current = () => !controller.signal.aborted && currentRevision === revision && context === audio && allowed();
    try {
      const url = new URL(`../sounds/coaches/${clip.file}`, import.meta.url);
      const response = await fetchAudio(url.href, { signal: controller.signal, cache: 'force-cache' });
      if (!response?.ok || !current()) return null;
      const bytes = await response.arrayBuffer();
      if (!current() || !bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) return null;
      const buffer = await audio.decodeAudioData(bytes);
      if (!current() || !Number.isFinite(buffer?.duration) || buffer.duration <= 0 || buffer.duration > 5) return null;
      buffers.set(clip.id, buffer);
      return buffer;
    } catch { return null; }
    finally { if (pendingLoad === controller) pendingLoad = null; }
  }

  const visibilityChanged = () => { if (!allowed()) stop(); };
  globalThis.document?.addEventListener?.('visibilitychange', visibilityChanged);

  return {
    unlock() { return ready(); },
    stop,
    async play({ kind = 'talk', coach = 'meowl' } = {}) {
      stop();
      if (!allowed() || !volumeLevel() || !catalog.length) return false;
      const currentRevision = revision;
      const audio = await ready();
      if (!audio || currentRevision !== revision || !allowed()) return false;
      coach = COACHES.has(coach) ? coach : 'meowl';
      kind = KINDS.has(kind) ? kind : 'talk';
      const clip = nextClip(coach, kind);
      const buffer = clip && await decoded(clip, audio, currentRevision);
      if (!buffer || currentRevision !== revision || !allowed()) return false;
      const volume = volumeLevel();
      if (!volume) return false;
      const current = { nodes: [], source: null, released: false }; voice = current;
      const track = node => { current.nodes.push(node); return node; };
      try {
        const source = track(audio.createBufferSource()); current.source = source;
        const envelope = track(audio.createGain());
        const start = audio.currentTime, end = start + buffer.duration;
        const fade = Math.min(0.012, buffer.duration / 4), gain = MASTER_GAIN * volume;
        source.buffer = buffer; source.loop = false;
        source.playbackRate.setValueAtTime(1, start);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(gain, start + fade);
        envelope.gain.setValueAtTime(gain, end - fade);
        envelope.gain.linearRampToValueAtTime(0, end);
        source.connect(envelope); envelope.connect(audio.destination);
        source.onended = () => release(current);
        source.start(start); source.stop(end);
        lastClip = clip.id; lastByCoach.set(coach, clip.id);
        return true;
      } catch {
        release(current, true);
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; stop(); buffers.clear(); variations.clear(); lastByCoach.clear();
      globalThis.document?.removeEventListener?.('visibilitychange', visibilityChanged);
      const previous = context; context = null;
      try { if (previous) Promise.resolve(previous.close()).catch(() => {}); } catch { /* Shutdown is best effort. */ }
    },
  };
}
