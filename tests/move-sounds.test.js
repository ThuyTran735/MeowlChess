import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoveSounds } from '../extension/lib/move-sounds.js';

function fixture({ state = 'running', resume } = {}) {
  const oscillators = [], gains = [];
  const parameter = () => ({ calls: [], setValueAtTime(...args) { this.calls.push(['set', ...args]); }, linearRampToValueAtTime(...args) { this.calls.push(['linear', ...args]); }, exponentialRampToValueAtTime(...args) { this.calls.push(['exponential', ...args]); } });
  const context = {
    state, currentTime: 12, destination: {}, resumes: 0, closes: 0,
    async resume() { this.resumes++; if (resume) await resume(); this.state = 'running'; },
    async close() { this.closes++; this.state = 'closed'; },
    createOscillator() {
      const oscillator = { frequency: parameter(), connections: [], starts: [], stops: [], disconnects: 0,
        connect(node) { this.connections.push(node); }, disconnect() { this.disconnects++; },
        start(...args) { this.starts.push(args); }, stop(...args) { this.stops.push(args); } };
      oscillators.push(oscillator); return oscillator;
    },
    createGain() {
      const gain = { gain: parameter(), connections: [], disconnects: 0, connect(node) { this.connections.push(node); }, disconnect() { this.disconnects++; } };
      gains.push(gain); return gain;
    },
  };
  let enabled = true, visible = true, creations = 0;
  const sounds = createMoveSounds({ isEnabled: () => enabled, isVisible: () => visible, createContext: () => { creations++; return context; } });
  return { context, oscillators, gains, sounds, enabled(value) { enabled = value; }, visible(value) { visible = value; }, get creations() { return creations; } };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('disabled and hidden views do not allocate or resume audio', async () => {
  const f = fixture({ state: 'suspended' }); f.enabled(false);
  assert.equal(await f.sounds.play(), false); assert.equal(await f.sounds.unlock(), null);
  f.enabled(true); f.visible(false);
  assert.equal(await f.sounds.play(), false); assert.equal(await f.sounds.unlock(), null);
  assert.equal(f.creations, 0); assert.equal(f.context.resumes, 0);
});

test('move and capture tones use bounded quiet gain and short schedules', async () => {
  const f = fixture(); assert.equal(await f.sounds.play(), true);
  const move = f.oscillators[0], moveGain = f.gains[0];
  assert.equal(move.type, 'triangle'); assert.deepEqual(move.starts, [[12]]);
  assert.deepEqual(move.frequency.calls, [['set', 320, 12], ['exponential', 130, 12.075]]);
  assert.deepEqual(moveGain.gain.calls, [['set', 0, 12], ['linear', 0.035, 12.003], ['exponential', 0.0001, 12.075]]);
  assert.equal(move.connections[0], moveGain); assert.equal(moveGain.connections[0], f.context.destination);
  assert.equal(await f.sounds.play({ capture: true }), true);
  const capture = f.oscillators[1];
  assert.deepEqual(capture.frequency.calls, [['set', 190, 12], ['exponential', 70, 12.11]]);
  assert(capture.stops[0][0] - 12 < 0.12); assert(move.stops[0][0] - 12 < 0.09);
  assert.equal(f.creations, 1, 'Reuse one local context.');
});

test('suspended context resumes without playing an unlock tone', async () => {
  const f = fixture({ state: 'suspended' });
  assert.equal(await f.sounds.unlock(), f.context);
  assert.equal(f.context.resumes, 1); assert.equal(f.oscillators.length, 0);
  assert.equal(await f.sounds.play(), true); assert.equal(f.context.resumes, 1);
});

test('unavailable audio and denied resume fail quietly', async () => {
  const unavailable = createMoveSounds({ isEnabled: () => true, isVisible: () => true, createContext() { throw new Error('Unavailable'); } });
  assert.equal(await unavailable.play(), false); assert.equal(await unavailable.unlock(), null);
  const f = fixture({ state: 'suspended', resume: async () => { throw new Error('Gesture required'); } });
  assert.equal(await f.sounds.play(), false); assert.equal(f.oscillators.length, 0);
});

test('stop cancels a sound waiting for audio resume', async () => {
  const gate = deferred(), f = fixture({ state: 'suspended', resume: () => gate.promise });
  const playing = f.sounds.play(); f.sounds.stop(); gate.resolve();
  assert.equal(await playing, false); assert.equal(f.oscillators.length, 0);
});

test('disabling sounds or hiding a page while resume waits prevents playback', async () => {
  for (const change of ['enabled', 'visible']) {
    const gate = deferred(), f = fixture({ state: 'suspended', resume: () => gate.promise });
    const playing = f.sounds.play(); f[change](false); gate.resolve();
    assert.equal(await playing, false); assert.equal(f.oscillators.length, 0);
  }
});

test('rapid navigation plays only the latest pending move', async () => {
  const f = fixture();
  const first = f.sounds.play(), second = f.sounds.play({ capture: true });
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(f.oscillators.length, 1); assert.equal(f.oscillators[0].frequency.calls[0][1], 190);
});

test('replacement and stop disconnect voices without stale ended callbacks clearing the latest', async () => {
  const f = fixture(); await f.sounds.play(); const first = f.oscillators[0];
  await f.sounds.play(); const second = f.oscillators[1];
  assert.equal(first.stops.length, 2); assert(first.disconnects > 0); assert(f.gains[0].disconnects > 0);
  first.onended(); f.sounds.stop();
  assert.equal(second.stops.length, 2); assert(second.disconnects > 0); assert(f.gains[1].disconnects > 0);
});

test('dispose closes the context and cancels a pending tone', async () => {
  const gate = deferred(), f = fixture({ state: 'suspended', resume: () => gate.promise });
  const playing = f.sounds.play(); f.sounds.dispose(); gate.resolve();
  assert.equal(await playing, false); assert.equal(f.context.closes, 1); assert.equal(f.oscillators.length, 0);
});
