import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachSounds } from '../extension/lib/coach-sounds.js';
import { COACH_MEOW_CLIPS } from '../extension/lib/coach-audio-clips.js';
import { COACH_SOUND_PROFILES, coachSoundBank, coachSoundKind, getCoachSoundProfile } from '../extension/lib/coach-sound-profiles.js';

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
      const file = new URL(url).pathname.split('/').at(-1);
      const id = catalog.findIndex(clip => clip.file === file);
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

test('Evil uses real chirps for asides and meows for celebrations without pitch alteration', async () => {
  const f=fixture({catalog:clips.map((clip,index)=>({...clip,sound:index<3?'chirp':'meow'}))});
  for(const kind of ['talk','curious','greeting','brilliant','celebrate']){
    const heard=new Set();
    for(let index=0;index<3;index++){
      assert.equal(await f.sounds.play({coach:'evil',kind}),true);
      const source=f.sources.at(-1),recording=source.buffer.recording;
      assert.equal(recording<3,!['brilliant','celebrate'].includes(kind));heard.add(recording);
      assert.deepEqual(source.playbackRate.calls,[['set',1,8]]);
    }
    assert.equal(heard.size,3);
  }
  f.sounds.dispose();
});

test('Baby favors varied real chirps and purr-chirps at the original pitch and selected volume', async () => {
  const f=fixture({getVolume:()=>.6,catalog:clips.map((clip,index)=>({...clip,sound:index<3?'chirp':index===3?'purr-chirp':'meow'}))});
  let last;
  for(const kind of kinds){
    const heard=new Set();
    for(let index=0;index<4;index++){
      assert.equal(await f.sounds.play({coach:'baby',kind}),true);
      const source=f.sources.at(-1),recording=source.buffer.recording;
      assert(recording<4);assert.notEqual(recording,last);heard.add(recording);last=recording;
      assert.deepEqual(source.playbackRate.calls,[['set',1,8]]);
      assert.equal(Math.max(...f.gains.at(-1).gain.calls.map(([,value])=>value)),.39);
    }
    assert.equal(heard.size,4);
  }
  f.sounds.dispose();
});

test('all seven coaches have distinct immutable recording banks with gentle alternatives to celebrations', () => {
  const voices = new Set(), descriptions = new Set();
  const supported = ['talk','greeting','curious','encourage','approve','great','celebrate','brilliant'];
  assert.equal(Object.keys(COACH_SOUND_PROFILES).length,7);
  for (const [coach, profile] of Object.entries(COACH_SOUND_PROFILES)) {
    assert(Object.isFrozen(profile));assert(Object.isFrozen(profile.banks));assert(Object.isFrozen(profile.sounds));
    assert.equal(getCoachSoundProfile(coach),profile);descriptions.add(profile.description);
    for (const ids of Object.values(profile.banks)) {
      assert(Object.isFrozen(ids));assert(ids.length>=3);assert.equal(new Set(ids).size,ids.length);
      for(const id of ids)assert(COACH_MEOW_CLIPS.some(clip=>clip.id===id),`${coach} references a bundled recording`);
    }
    const talk = coachSoundBank(COACH_MEOW_CLIPS,coach,'talk').map(clip=>clip.id).sort();voices.add(talk.join(','));
    assert(talk.length>=2&&talk.length<COACH_MEOW_CLIPS.length,`${coach} has its own speech bank`);
    for(const kind of supported) {
      const bank=coachSoundBank(COACH_MEOW_CLIPS,coach,kind);
      assert(bank.length>=2);assert.equal(new Set(bank.map(clip=>clip.id)).size,bank.length);
    }
    assert.notDeepEqual(coachSoundBank(COACH_MEOW_CLIPS,coach,'encourage').map(clip=>clip.id),coachSoundBank(COACH_MEOW_CLIPS,coach,'brilliant').map(clip=>clip.id));
  }
  assert.equal(voices.size,7);assert.equal(descriptions.size,7);
  assert.equal(getCoachSoundProfile('__proto__'),COACH_SOUND_PROFILES.meowl);
});

test('real profile playback stays in each coach’s reaction bank without repeats or pitch changes', async () => {
  let seed=73,last;
  const f=fixture({catalog:COACH_MEOW_CLIPS,random:()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),getVolume:()=>.5});
  for(const coach of Object.keys(COACH_SOUND_PROFILES))for(const kind of ['talk','encourage','great','brilliant','greeting','approve','curious','celebrate']) {
    const bank=coachSoundBank(COACH_MEOW_CLIPS,coach,kind),allowed=new Set(bank.map(clip=>clip.id)),heard=new Set();
    for(let index=0;index<bank.length*2;index++) {
      assert.equal(await f.sounds.play({coach,kind}),true);
      const source=f.sources.at(-1),clip=COACH_MEOW_CLIPS[source.buffer.recording];
      assert(allowed.has(clip.id),`${coach}/${kind} keeps its character bank`);assert.notEqual(clip.id,last);heard.add(clip.id);last=clip.id;
      assert.deepEqual(source.playbackRate.calls,[['set',1,8]]);
      assert.equal(Math.max(...f.gains.at(-1).gain.calls.map(([,value])=>value)),.325);
    }
    assert.equal(heard.size,bank.length,`${coach}/${kind} reaches every recording`);
  }
  f.sounds.dispose();
});

test('tagged new recordings join only their intended coach and reaction, while older banks still work', () => {
  const extra={id:'new-purr',file:'MeowlChess-new-purr.wav',sound:'purr',coaches:['mellow'],kinds:['encourage']};
  const extended=[...COACH_MEOW_CLIPS,extra],before=JSON.stringify(extended);
  assert(coachSoundBank(extended,'mellow','encourage').some(clip=>clip===extra));
  assert(!coachSoundBank(extended,'mellow','brilliant').some(clip=>clip===extra));
  assert(!coachSoundBank(extended,'baby','encourage').some(clip=>clip===extra));
  assert.equal(JSON.stringify(extended),before);
  assert.equal(coachSoundKind('think'),'curious');assert.equal(coachSoundKind('signature'),'greeting');
  for(const kind of ['encourage','great','approve'])assert.equal(coachSoundKind(kind),kind);
  assert.deepEqual(coachSoundBank(extended,'mellow','idle'),[]);
  assert.deepEqual(coachSoundBank(null,'baby','talk'),[]);
  assert.deepEqual(coachSoundBank(clips,'baby','talk'),clips);
  assert.deepEqual(coachSoundBank(clips,'__proto__','unknown'),clips);
});

test('Baby prefers genuine kitten calls and Mellow prefers real purring without shrinking to a repeating single clip', () => {
  const kittens=Array.from({length:3},(_,i)=>({id:`kitten-${i}`,file:`MeowlChess-kitten-${i}.wav`,sound:'kitten-meow',coaches:['baby'],kinds:['talk','encourage','brilliant']}));
  const purrs=Array.from({length:2},(_,i)=>({id:`purr-${i}`,file:`MeowlChess-purr-${i}.wav`,sound:'purr',coaches:['mellow'],kinds:['talk','greeting','encourage']}));
  const extended=[...COACH_MEOW_CLIPS.filter(clip=>!clip.coaches),...kittens,...purrs];
  for(const kind of ['talk','encourage','brilliant'])assert.deepEqual(coachSoundBank(extended,'baby',kind),kittens);
  const mellow=[COACH_MEOW_CLIPS.find(clip=>clip.id==='meow-25'),...purrs];
  for(const kind of ['talk','greeting','encourage'])assert.deepEqual(coachSoundBank(extended,'mellow',kind),mellow);
  const partial=extended.filter(clip=>!['kitten-1','kitten-2','purr-1'].includes(clip.id));
  assert(coachSoundBank(partial,'baby','talk').length>=3);assert(coachSoundBank(partial,'mellow','talk').length>=2);
});

test('idle never allocates or plays audio, even when sound is enabled for Evil', async () => {
  const f=fixture();
  for(const coach of ['evil','meowl','owl','paws','mellow','scout','baby'])assert.equal(await f.sounds.play({coach,kind:'idle'}),false);
  assert.equal(f.creations,0);assert.equal(f.fetches.length,0);assert.equal(f.sources.length,0);
  f.sounds.dispose();
});

test('all kinds and coaches shuffle the recordings without consecutive repeats', async () => {
  let seed = 123;
  const f = fixture({ random: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) });
  let last;
  for (const coach of ['meowl', 'owl', 'paws', 'mellow', 'scout', 'evil', 'baby']) {
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

test('mouth playback begins with actual sound and follows its clock through stop and replacement', async () => {
  const gate = deferred(), sampleRate = 10000, data = Float32Array.from({ length: 10000 }, (_, index) =>
    index > 1500 && index < 4500 ? Math.sin(index * .5) * .5 : 0);
  const f = fixture({ decode: () => gate.promise });
  const callbacks = [];
  const playing = f.sounds.play({ onStart(playback) { callbacks.push(playback); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(callbacks.length, 0, 'A pending decode has no voice or mouth to animate.');
  gate.resolve({ duration: 1, sampleRate, numberOfChannels: 1, getChannelData: () => data });
  assert.equal(await playing, true);
  const first = callbacks[0];
  assert.equal(first.durationMs, 1000); assert(first.isPlaying());
  f.audio.currentTime = 8.05; assert.equal(first.getMouth(), 0);
  f.audio.currentTime = 8.3; assert(first.getMouth() > .7);
  f.audio.currentTime = 8.7; assert.equal(first.getMouth(), 0);
  f.sounds.stop(); assert.equal(first.isPlaying(), false); assert.equal(first.getMouth(), 0);
  await f.sounds.play({ onStart(playback) { callbacks.push(playback); } });
  assert.equal(callbacks.length, 2); assert(callbacks[1].isPlaying());
  f.sources[0].onended(); assert(callbacks[1].isPlaying(), 'An old ended callback cannot close a newer mouth.');
  f.audio.currentTime = 9; assert(callbacks[1].getMouth() > .7);
  f.sources[1].onended(); assert.equal(callbacks[1].getMouth(), 0);
  f.sounds.dispose();
});

test('blocked or canceled sound never notifies the mouth; a view callback failure leaves sound usable', async () => {
  let called = 0;
  const f = fixture(); f.enabled(false);
  assert.equal(await f.sounds.play({ onStart() { called++; } }), false);
  assert.equal(called, 0); f.enabled(true);
  assert.equal(await f.sounds.play({ onStart() { throw Error('View removed'); } }), true);
  f.sounds.dispose();
});

test('a short call waits for its visible mouth and uses the playback clock after preparation', async () => {
  const gate = deferred(), f = fixture();
  let notified = false;
  const playing = f.sounds.play({ beforeStart: () => gate.promise, onStart() { notified = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.decodes.length, 1);
  assert.equal(f.sources.length, 0);
  assert.equal(notified, false);
  f.audio.currentTime = 12;
  gate.resolve(true);
  assert.equal(await playing, true);
  assert.deepEqual(f.sources[0].starts, [12]);
  assert.equal(notified, true);
  f.sounds.dispose();
});

test('waiting for artwork cannot revive a canceled, replaced, muted or hidden call', async () => {
  for (const action of ['stop', 'dispose', 'replace', 'enabled', 'visible', 'volume', 'suspended']) {
    let volume = 1, notified = 0;
    const gate = deferred(), f = fixture({ getVolume: () => volume });
    const playing = f.sounds.play({ beforeStart: () => gate.promise, onStart() { notified++; } });
    await new Promise(resolve => setImmediate(resolve));
    if (action === 'replace') assert.equal(await f.sounds.play(), true);
    else if (action === 'enabled' || action === 'visible') f[action](false);
    else if (action === 'volume') volume = 0;
    else if (action === 'suspended') f.audio.state = 'suspended';
    else f.sounds[action]();
    gate.resolve(true);
    assert.equal(await playing, false, action);
    assert.equal(notified, 0, action);
    assert.equal(f.sources.length, action === 'replace' ? 1 : 0, action);
    f.sounds.dispose();
  }
});

test('a missing mouth stays silent and a failed preparation does not poison later previews', async () => {
  const f = fixture();
  for (const beforeStart of [() => false, () => { throw Error('Artwork unavailable'); }]) {
    assert.equal(await f.sounds.play({ beforeStart }), false);
    assert.equal(f.sources.length, 0);
  }
  assert.equal(await f.sounds.play({ beforeStart: () => true }), true);
  f.sounds.dispose();
});
