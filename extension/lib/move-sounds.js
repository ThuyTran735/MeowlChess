// Short, quiet local tones; nothing is fetched and no audio permission is needed.
export function createMoveSounds({
  isEnabled = () => false,
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
} = {}) {
  let context = null, voice = null, revision = 0;
  const allowed = () => isEnabled() && isVisible();
  function silence() {
    const current = voice; voice = null;
    if (!current) return;
    try { current.oscillator.stop(); } catch { /* It may have ended already. */ }
    current.oscillator.disconnect(); current.gain.disconnect();
  }
  async function ready() {
    if (!allowed()) return null;
    try {
      if (!context || context.state === 'closed') context = createContext();
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running' && allowed() ? context : null;
    } catch { return null; } // Audio restrictions must never prevent navigation.
  }
  return {
    unlock() { return ready(); },
    stop() { revision++; silence(); },
    async play({ capture = false } = {}) {
      if (!allowed()) return false;
      const currentRevision = ++revision;
      const audio = await ready();
      if (!audio || currentRevision !== revision || !allowed()) return false;
      silence();
      try {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        const start = audio.currentTime, length = capture ? 0.11 : 0.075;
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(capture ? 190 : 320, start);
        oscillator.frequency.exponentialRampToValueAtTime(capture ? 70 : 130, start + length);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.035, start + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        oscillator.connect(gain); gain.connect(audio.destination);
        const current = { oscillator, gain }; voice = current;
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (voice === current) voice = null; };
        oscillator.start(start); oscillator.stop(start + length + 0.005);
        return true;
      } catch { silence(); return false; }
    },
    dispose() {
      revision++; silence();
      const previous = context; context = null;
      if (previous) void previous.close().catch(() => {});
    },
  };
}
