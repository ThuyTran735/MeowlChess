import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachSounds } from '../extension/lib/coach-sounds.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const kinds = ['talk', 'brilliant', 'celebrate', 'curious', 'greeting'];
const clips = Array.from({ length: 6 }, (_, index) => ({ id: `cat-${index}`, file: `MeowlChess-cat-${index}.wav`, kinds }));
function fixture({ state = 'running', resume, fetch, decode, failGain = false, random = () => 0, getVolume = () => 1, catalog = clips } = {}) {
  const nodes = [], sources = [], gains = [], fetches = [], decodes = [];
  const parameter = () => ({ calls: [], setValueAtTime(...args) { this.calls.push(['set', ...args]); }, linearRampToValueAtTime(...args) { this.calls.push(['linear', ...args]); } });
  const node = extra => {
    const value = { connections: [], disconnects: 0, connect(other) { this.connections.push(other); }, disconnect() { this.disconnects++; }, ...extra };
    nodes.push(value); return value;
  };
  const audio = {
    state, currentTime: 8, destination: {}, resumes: 0, closes: 0,
    async resume() { this.resumes++; if (resume) await resume(); this.state = 'running'; },
    async close() { this.closes++; this.state = 'closed'; },
    createBufferSource() {
      const value = node({ playbackRate: parameter(), starts: [], stops: [], start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); } });
      sources.push(value); return value;
    },
    createGain() { if (failGain) throw new Error('Gain unavailable'); const value = node({ gain: parameter() }); gains.push(value); return value; },
    async decodeAudioData(bytes) { decodes.push(bytes); if (decode) return decode(bytes); return { duration: 0.65, recording: new Uint8Array(bytes)[0] }; },
  };
  let enabled = true, visible = true, creations = 0;
  const sounds = createCoachSounds({
    isEnabled: () => enabled, isVisible: () => visible, random, getVolume, clips: catalog,
    createContext() { creations++; if (audio.state === 'closed') audio.state = 'running'; return audio; },
    async fetchAudio(url, options) {
      fetches.push({ url, options });
      if (fetch) return fetch(url, options);
      const id = Number(url.match(/cat-(\d+)\.wav$/)?.[1] ?? 0);
      return { ok: true, async arrayBuffer() { return new Uint8Array([id, 42]).buffer; } };
    },
  });
  return { sounds, audio, nodes, sources, gains, fetches, decodes, enabled(value) { enabled = value; }, visible(value) { visible = value; }, get creations() { return creations; } };
}

test('recorded meows remain opt-in and hidden or muted views allocate nothing', async () => {
  let created = false, fetched = false;
  const silent = createCoachSounds({ clips, createContext() { created = true; }, fetchAudio() { fetched = true; } });
  assert.equal(await silent.play(), false); assert.equal(await silent.unlock(), null); assert.equal(created, false); assert.equal(fetched, false);
  for (const condition of ['enabled', 'visible', 'volume']) {
    const f = fixture({ getVolume: () => condition === 'volume' ? 0 : 1 });
    if (condition !== 'volume') f[condition](false);
    assert.equal(await f.sounds.play(), false); assert.equal(f.creations, 0); assert.equal(f.fetches.length, 0);
    f.sounds.dispose();
  }
});

test('real recordings play at their original speed through the volume envelope', async () => {
  const f = fixture({ getVolume: () => 0.8 });
  assert.equal(await f.sounds.play(), true);
  const source = f.sources[0], envelope = f.gains[0];
  assert.equal(source.buffer.recording, 0);
  assert.equal(source.loop, false); assert.deepEqual(source.playbackRate.calls, [['set', 1, 8]]);
  assert.deepEqual(source.starts, [8]); assert.deepEqual(source.stops, [8.65]);
  assert.deepEqual(source.connections, [envelope]); assert.deepEqual(envelope.connections, [f.audio.destination]);
  assert.equal(Math.max(...envelope.gain.calls.map(([, value]) => value)), 0.52);
  assert.equal(envelope.gain.calls[0][1], 0); assert.equal(envelope.gain.calls.at(-1)[1], 0);
  assert(f.fetches[0].url.endsWith('/sounds/coaches/MeowlChess-cat-0.wav'));
  assert.equal(f.fetches[0].options.cache, 'force-cache');
  assert(f.fetches[0].options.signal instanceof AbortSignal);
  f.sounds.dispose();
});

test('all kinds and coaches shuffle the recordings without consecutive repeats', async () => {
  let seed = 123;
  const f = fixture({ random: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) });
  let last;
  for (const coach of ['meowl', 'owl', 'paws', 'mellow', 'scout']) {
    for (const kind of kinds) {
      for (let cycle = 0; cycle < 3; cycle++) {
        const heard = new Set();
        for (let index = 0; index < clips.length; index++) {
          assert.equal(await f.sounds.play({ coach, kind }), true);
          const current = f.sources.at(-1).buffer.recording;
          assert.notEqual(current, last); heard.add(current); last = current;
        }
        assert.equal(heard.size, clips.length);
      }
    }
  }
  assert.equal(f.creations, 1); assert.equal(f.fetches.length, clips.length); assert.equal(f.decodes.length, clips.length);
  f.sounds.dispose();
});

test('switching reaction kinds never immediately repeats a recording', async () => {
  const f = fixture(); let last;
  for (let index = 0; index < 50; index++) {
    await f.sounds.play({ kind: kinds[index % kinds.length], coach: ['meowl', 'owl', 'paws', 'mellow', 'scout'][index % 5] });
    const current = f.sources.at(-1).buffer.recording; assert.notEqual(current, last); last = current;
  }
  f.sounds.dispose();
});

test('a single matching clip falls back to other recordings instead of repeating', async () => {
  const f = fixture({ catalog: clips.map((clip, index) => ({ ...clip, kinds: index ? ['talk'] : ['brilliant'] })) });
  await f.sounds.play({ kind: 'brilliant' }); const first = f.sources.at(-1).buffer.recording;
  await f.sounds.play({ kind: 'brilliant' }); assert.notEqual(f.sources.at(-1).buffer.recording, first);
  await f.sounds.play({ kind: 'greeting' }); assert.equal(f.sources.length, 3);
  f.sounds.dispose();
});

test('unknown values, malformed catalogs and broken random generators fail safely', async () => {
  const f = fixture(); await f.sounds.play({ coach: '../remote', kind: 'unknown' });
  assert.equal(f.sources[0].buffer.recording, 0); f.sounds.dispose();
  for (const random of [() => NaN, () => Infinity, () => -9, () => 1, () => { throw new Error('Unavailable'); }]) {
    const item = fixture({ random }); let last;
    for (let index = 0; index < 15; index++) {
      assert.equal(await item.sounds.play(), true);
      const current = item.sources.at(-1).buffer.recording; assert.notEqual(current, last); last = current;
    }
    item.sounds.dispose();
  }
  for (const catalog of [[], null, [{ id: 'bad', file: '../remote.wav' }], [{ id: 'bad', file: 'https://example.com/meow.wav' }]]) {
    const item = fixture({ catalog }); assert.equal(await item.sounds.play(), false); assert.equal(item.creations, 0); item.sounds.dispose();
  }
});

test('volume clamps, scales recordings and is checked again after loading', async () => {
  for (const [level, expected] of [[0.8, 0.52], [0.25, 0.1625], [8, 0.65], [NaN, 0.65], [Infinity, 0.65]]) {
    const f = fixture({ getVolume: () => level }); assert.equal(await f.sounds.play(), true);
    assert(Math.abs(Math.max(...f.gains.at(-1).gain.calls.map(([, value]) => value)) - expected) < 1e-12); f.sounds.dispose();
  }
  let volume = 1; const gate = deferred();
  const f = fixture({ getVolume: () => volume, decode: () => gate.promise });
  const play = f.sounds.play(); await new Promise(resolve => setImmediate(resolve)); volume = 0;
  gate.resolve({ duration: 0.6 }); assert.equal(await play, false); assert.equal(f.sources.length, 0); f.sounds.dispose();
});

test('muted calls do not consume a variation and unlock never fetches or plays', async () => {
  let volume = 0; const f = fixture({ state: 'suspended', getVolume: () => volume }), reference = fixture();
  assert.equal(await f.sounds.unlock(), f.audio); assert.equal(f.audio.resumes, 1); assert.equal(f.fetches.length, 0);
  assert.equal(await f.sounds.play(), false); volume = 1; await f.sounds.play(); await reference.sounds.play();
  assert.equal(f.sources[0].buffer.recording, reference.sources[0].buffer.recording);
  f.sounds.dispose(); reference.sounds.dispose();
});

test('stop and replacement abort pending local fetches without late sound', async () => {
  const gate = deferred(), f = fixture({ fetch: () => gate.promise });
  const playing = f.sounds.play(); await new Promise(resolve => setImmediate(resolve));
  f.sounds.stop(); assert.equal(f.fetches[0].options.signal.aborted, true);
  gate.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) });
  assert.equal(await playing, false); assert.equal(f.decodes.length, 0); assert.equal(f.sources.length, 0); f.sounds.dispose();
});

test('stop, opt-out, hiding and disposal prevent late decodes from playing', async () => {
  for (const action of ['stop', 'enabled', 'visible', 'dispose']) {
    const gate = deferred(), f = fixture({ decode: () => gate.promise });
    const playing = f.sounds.play(); await new Promise(resolve => setImmediate(resolve));
    if (action === 'enabled' || action === 'visible') f[action](false); else f.sounds[action]();
    gate.resolve({ duration: 0.6 }); assert.equal(await playing, false); assert.equal(f.sources.length, 0); f.sounds.dispose();
  }
});

test('rapid requests and delayed resume only allow the newest voice', async () => {
  const f = fixture(); const first = f.sounds.play(), second = f.sounds.play({ kind: 'brilliant' });
  assert.equal(await first, false); assert.equal(await second, true); assert.equal(f.sources.length, 1); f.sounds.dispose();
  const gate = deferred(), delayed = fixture({ state: 'suspended', resume: () => gate.promise });
  const playing = delayed.sounds.play(); delayed.sounds.stop(); gate.resolve();
  assert.equal(await playing, false); assert.equal(delayed.fetches.length, 0); delayed.sounds.dispose();
});

test('missing or invalid recordings stay silent without synthesized fallback', async () => {
  for (const fetch of [async () => { throw new Error('Missing'); }, async () => ({ ok: false }), async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }), async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(5 * 1024 * 1024 + 1) })]) {
    const f = fixture({ fetch }); assert.equal(await f.sounds.play(), false); assert.equal(f.sources.length, 0); f.sounds.dispose();
  }
  for (const decode of [async () => { throw new Error('Unsupported'); }, async () => ({ duration: NaN }), async () => ({ duration: 0 }), async () => ({ duration: 60 })]) {
    const f = fixture({ decode }); assert.equal(await f.sounds.play(), false); assert.equal(f.sources.length, 0); f.sounds.dispose();
  }
  const f = fixture({ failGain: true }); assert.equal(await f.sounds.play(), false); assert(f.nodes.every(node => node.disconnects === 1)); f.sounds.dispose();
});

test('ended callbacks and stop release nodes once without disrupting a new recording', async () => {
  const f = fixture(); await f.sounds.play(); const old = f.sources[0]; await f.sounds.play();
  const current = f.sources[1]; old.onended(); assert.equal(current.disconnects, 0);
  current.onended(); assert(f.nodes.every(node => node.disconnects === 1)); f.sounds.stop(); assert(f.nodes.every(node => node.disconnects === 1)); f.sounds.dispose();
});

test('closed contexts clear decoded buffers and dispose cannot revive audio', async () => {
  const f = fixture({ catalog: [clips[0]] }); await f.sounds.play(); assert.equal(f.decodes.length, 1);
  f.audio.state = 'closed';
  const waiting = f.sounds.play(); f.audio.state = 'running'; await waiting;
  assert.equal(f.creations, 2); assert.equal(f.decodes.length, 2);
  f.sounds.dispose(); f.sounds.dispose(); assert.equal(f.audio.closes, 1);
  assert.equal(await f.sounds.play(), false); assert.equal(await f.sounds.unlock(), null);
});
