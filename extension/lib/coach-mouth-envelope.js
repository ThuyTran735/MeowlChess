// Read the bundled recording once; mouth frames then follow its audio clock.
// Quiet gaps close the mouth instead of cycling a generic talking animation.
export function createCoachMouthEnvelope(buffer, sound = 'meow') {
  const duration = Number(buffer?.duration), rate = Number(buffer?.sampleRate);
  if (!(duration > 0 && duration <= 5 && rate > 0) || typeof buffer?.getChannelData !== 'function') return () => 0;
  const channels = [];
  try {
    for (let index = 0; index < Math.min(2, buffer.numberOfChannels || 1); index++) channels.push(buffer.getChannelData(index));
  } catch { return () => 0; }
  const length = Math.min(...channels.map(channel => channel.length));
  if (!length || !Number.isFinite(length)) return () => 0;
  const window = Math.max(1, Math.round(rate * .02)), step = window / rate;
  const levels = [];
  for (let start = 0; start < length; start += window) {
    const end = Math.min(length, start + window);
    let energy = 0;
    for (const channel of channels) for (let index = start; index < end; index++) {
      const sample = Number.isFinite(channel[index]) ? channel[index] : 0;
      energy += sample * sample;
    }
    levels.push(Math.sqrt(energy / ((end - start) * channels.length)));
  }
  const peak = Math.max(...levels), gate = Math.max(.006, peak * .12);
  if (!(peak > gate)) return () => 0;
  const maximum = String(sound).includes('purr') ? .42 : .9;
  let previous = 0;
  const openings = levels.map(level => {
    const target = Math.pow(Math.max(0, Math.min(1, (level - gate) / (peak - gate))), .65) * maximum;
    const value = previous + (target - previous) * (target > previous ? .85 : .6);
    previous = value < .025 ? 0 : value;
    return previous;
  });
  return seconds => {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds >= duration) return 0;
    const frame = seconds / step - .5, index = Math.floor(frame), mix = frame - index;
    const value = (openings[index] || 0) * (1 - mix) + (openings[index + 1] || 0) * mix;
    return value * Math.min(1, seconds / .025, (duration - seconds) / .05);
  };
}
