import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachMouthEnvelope } from '../extension/lib/coach-mouth-envelope.js';

const recording = () => {
  const sampleRate = 10000, data = new Float32Array(sampleRate);
  for (let index = 0; index < data.length; index++) {
    const time = index / sampleRate;
    data[index] = ((time > .14 && time < .32) || (time > .62 && time < .8))
      ? .5 * Math.sin(index * .5) : .001 * Math.sin(index);
  }
  return { duration: 1, sampleRate, numberOfChannels: 1, getChannelData: () => data };
};

test('the mouth follows separate recorded calls and closes through quiet gaps', () => {
  const sample = createCoachMouthEnvelope(recording());
  for (const time of [0, .07, .45, .55, .95, 1, 2, NaN]) assert.equal(sample(time), 0);
  for (const time of [.21, .28, .7, .76]) assert(sample(time) > .7, `Recorded call at ${time}s opens the mouth.`);
  const frames = Array.from({ length: 1001 }, (_, index) => sample(index / 1000));
  assert(frames.every(value => Number.isFinite(value) && value >= 0 && value <= .9));
  assert(frames.every((value, index) => !index || Math.abs(value - frames[index - 1]) < .06));
});

test('purring uses a smaller mouth motion than a full meow', () => {
  const buffer = recording(), meow = createCoachMouthEnvelope(buffer), purr = createCoachMouthEnvelope(buffer, 'purr-chirp');
  assert(purr(.25) > .2 && purr(.25) <= .42 && purr(.25) < meow(.25));
});

test('silence and unreadable audio never fabricate talking', () => {
  const silent = { ...recording(), getChannelData: () => new Float32Array(10000) };
  for (const buffer of [null, {}, { duration: 1 }, silent, { ...silent, getChannelData() { throw Error('unavailable'); } }]) {
    const sample = createCoachMouthEnvelope(buffer);
    for (const time of [0, .2, .8, 1]) assert.equal(sample(time), 0);
  }
});
