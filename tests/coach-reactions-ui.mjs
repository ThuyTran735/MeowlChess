import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const audioOnly = process.argv.includes('--audio-only');
const labelsOnly = process.argv.includes('--labels-only');
const profilePrefix = 'MeowlChess-coach-reactions-test-', bundlePrefix = 'MeowlChess-coach-reactions-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const fixtureHtml = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coach reaction fixture</title><link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><style>body{padding:16px}#coach-fixture{max-width:370px;margin:auto;background:#2c2b27;border-radius:10px}#move-fixture{width:160px;margin:12px auto;padding:16px;background:#2c2b27}#move-fixture img{width:72px;height:72px;object-fit:contain}</style><div id="coach-fixture"></div><div id="move-fixture" hidden><img alt=""></div><script type="module" src="reactions-fixture.js"></script>`;
const fixtureScript = `
import { Chess } from './vendor/chess.js';
import { analyzeGame } from './lib/review.js';
import { createCoachView } from './lib/coach-view.js';
import { coachPortraitUrl } from './lib/coach-portraits.js';
const pgn = '[Event "Coach reaction presentation fixture"]\\n[White "Reaction Cat"]\\n[Black "Reaction Owl"]\\n[Result "1/2-1/2"]\\n\\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 1/2-1/2';
const game = { pgn, white: { username: 'Reaction Cat' }, black: { username: 'Reaction Owl' } };
const result = await analyzeGame(pgn, {
  smartAnalysis: false, moveTimeMs: 50, multiPV: 1,
  engineFactory: () => ({ async init() {}, dispose() {}, async evaluate(fen) {
    const board = new Chess(fen), legal = board.moves({ verbose: true })[0];
    const move = legal ? legal.from + legal.to + (legal.promotion || '') : null;
    return { cp: 0, mate: null, bestMove: move, pv: move ? [move] : [], candidates: [], depth: 8 };
  } }),
});
// Deliberately synthetic presentation grades. Engine classification is tested elsewhere.
const grades = ['Brilliant', 'Brilliant', 'Great', 'Mistake', 'Good', 'Best', 'Excellent', 'Book', 'Inaccuracy', 'Blunder', 'Great', 'Best'];
result.moves.forEach((move, index) => { move.label = grades[index]; });
const root = document.querySelector('#coach-fixture'), mini = document.querySelector('#move-fixture');
mini.querySelector('img').src = coachPortraitUrl('meowl');
const state = { game, result, ply: 0, active: true, moveReactionsActive: false, blockedReason: '' };
const view = createCoachView(root, { moveReactionTarget: { image: mini.querySelector('img'), container: mini }, onNavigate: ({ ply }) => { state.ply = ply; view.setContext(state); } });
let hidden = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
window.reactionFixture = {
  update(patch) { Object.assign(state, patch); root.hidden = !state.active; mini.hidden = !state.moveReactionsActive; view.setContext(state); },
  switchGame() { state.game = { ...game, pgn: pgn.replace('presentation fixture', 'second game') }; state.result = structuredClone(result); state.ply = 0; view.setContext(state); },
  hide(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
  dispose() { view.dispose(); },
  async restoreSaved() { await chrome.storage.local.set({ coachSavedFixture: { game: state.game, result: state.result } }); const saved = (await chrome.storage.local.get('coachSavedFixture')).coachSavedFixture; state.game = saved.game; state.result = saved.result; view.setContext(state); },
  snapshot() { return { ply: state.ply, active: state.active }; },
};
view.setContext(state); window.fixtureReady = true;
`;
let context, page, worker, stage = 'launch';
const errors = [], external = [];
async function chooseCoach(id) { await page.locator(`.coach-choice[data-coach="${id}"]`).click(); }
async function poll(read, label, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Timed out: ${label}`);
}

try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'reactions-fixture.html'), fixtureHtml);
  await writeFile(join(extension, 'reactions-fixture.js'), fixtureScript);
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1000, height: 950 }, reducedMotion: 'no-preference',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12000);
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.coachAudioEvents = { contexts: 0, starts: 0, closes: 0 };
    window.coachBufferEvents = []; window.coachGainEvents = []; window.coachAudioStops = 0; window.coachOscillatorStarts = 0;
    const NativeAudioContext = window.AudioContext;
    if (!NativeAudioContext) return;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.coachAudioEvents.contexts++; }
      createBufferSource() {
        const source = super.createBufferSource(), start = source.start.bind(source), stop = source.stop.bind(source);
        source.start = (...args) => {
          window.coachAudioEvents.starts++;
          window.coachBufferEvents.push({ rate: source.playbackRate.value, detune: source.detune.value, length: source.buffer?.length, channels: source.buffer?.numberOfChannels, duration: source.buffer?.duration });
          return start(...args);
        };
        source.stop = (...args) => { window.coachAudioStops++; return stop(...args); };
        return source;
      }
      createGain() {
        const gain = super.createGain(), ramp = gain.gain.linearRampToValueAtTime.bind(gain.gain);
        gain.gain.linearRampToValueAtTime = (value, time) => { window.coachGainEvents.push(value); return ramp(value, time); };
        return gain;
      }
      createOscillator() {
        const oscillator = super.createOscillator(), start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => { window.coachOscillatorStarts++; return start(...args); }; return oscillator;
      }
      close() { window.coachAudioEvents.closes++; return super.close(); }
    };
  });
  worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  // Keep automatic move commentary off here; its debounce and navigation have a separate suite.
  await worker.evaluate(() => chrome.storage.local.set({ coachPreferences: { coach: 'meowl', perspective: 'both', motion: true, sounds: false, commentary: false } }));
  page = await context.newPage(); await page.goto(`${origin}/reactions-fixture.html`);
  await page.waitForFunction(() => window.fixtureReady);
  await page.locator('.coach-settings-summary').click();
  const update = patch => page.evaluate(patch => window.reactionFixture.update(patch), patch);
  const active = kind => page.locator(`.coach-actor[data-reaction="${kind}"]`);
  const idle = () => poll(async () => await page.locator('.coach-actor[data-reaction]').count() === 0, 'reaction returns to idle', 4000);
  const ask = async question => {
    await page.locator('.coach-question').fill(question);
    await page.locator('.coach-send').click();
    await poll(async () => (await page.locator('.coach-message[data-role="coach"]').last().textContent()).length > 10, 'local reply');
  };
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assertIdle = async label => {
    await delay(50); assert.equal(await page.locator('.coach-actor[data-reaction]').count(), 0, label);
  };
  const renderedPuppet = async () => {
    const canvas = page.locator('.coach-heading .coach-reaction-puppet');
    await canvas.waitFor({ state: 'visible', timeout: 1200 });
    const painted = await canvas.evaluate(element => {
      const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      window.reactionFrameProbe = { frame: Number(element.dataset.frame), pixels };
      return pixels.filter((value, index) => index % 4 === 3 && value > 32).length;
    });
    assert(painted > 100, 'The reaction draws the original portrait.');
    await page.waitForFunction(() => {
      const before = window.reactionFrameProbe;
      const element = document.querySelector('.coach-heading .coach-reaction-puppet');
      if (!element || Number(element.dataset.frame) <= before.frame) return false;
      const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      let changed = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if ([0, 1, 2, 3].some(channel => Math.abs(pixels[index + channel] - before.pixels[index + channel]) > 16)) changed++;
      }
      return changed >= 3;
    }, null, { timeout: 1200 });
    await page.evaluate(() => { delete window.reactionFrameProbe; });
  };

  if (labelsOnly) {
    const expected = { Brilliant: [1, 2], Great: [3, 11], Best: [6, 12], Excellent: [7], Good: [5], Book: [8], Inaccuracy: [9], Mistake: [4], Blunder: [10] };
    const kinds = { Brilliant: 'brilliant', Great: 'celebrate', Best: 'celebrate', Excellent: 'approve', Good: 'approve', Book: 'approve', Inaccuracy: 'encourage', Mistake: 'encourage', Blunder: 'encourage' };
    const reply = () => page.locator('.coach-message[data-role="coach"]').last();
    const checkCategory = async (question, label, plies = expected[label]) => {
      await ask(question);
      const text = await reply().innerText();
      assert(text.includes(label), `${question} answers the requested ${label} category: ${text}`);
      assert.deepEqual(await reply().locator('.coach-jump').evaluateAll(buttons => buttons.map(button => Number(button.dataset.ply))), plies.slice(0, 4), `${question} links only saved matching moves.`);
      if (plies.length) {
        assert.equal(await reply().locator('.coach-grade-chip').getAttribute('data-rating'), label, 'Reply grade is its actual subject, not the board cursor.');
        assert(await active(kinds[label]).count() > 0, `A ${label} answer has the appropriate reaction.`);
        for (const aria of await reply().locator('.coach-jump').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))) assert(aria.includes(label));
      }
      return text;
    };
    stage = 'plural grade questions while the board cursor is Best';
    await update({ ply: 6 });
    await checkCategory('Show brilliant moves', 'Brilliant');
    await checkCategory('Any greats?', 'Great');
    assert.equal(await page.locator('.coach-heading .coach-reaction-badge').getAttribute('data-rating'), 'Great');
    assert((await page.locator('.coach-heading .coach-reaction-badge img').getAttribute('src')).endsWith('/great.svg'), 'Great uses its own badge, not the Best star.');
    for (const label of Object.keys(expected)) await checkCategory(`Show moves rated ${label}`, label);
    await ask('How many of each?');
    const countsText = await reply().innerText();
    for (const [label, plies] of Object.entries(expected)) assert(new RegExp(`${label}[^\\n]*\\b${plies.length}\\b`, 'i').test(countsText), `${label} has its saved count in the complete breakdown: ${countsText}`);

    stage = 'category focus, no invented grades and saved review restore';
    await page.locator('.coach-perspective').selectOption('b');
    const noGreat = await checkCategory('Show great moves', 'Great', []);
    assert(/no|0|none/i.test(noGreat));
    await page.locator('.coach-perspective').selectOption('w');
    await checkCategory('Did I have any brilliants?', 'Brilliant', [1]);
    await page.locator('.coach-perspective').selectOption('both');
    await page.evaluate(() => window.reactionFixture.restoreSaved());
    await ask('Show Brilliant and Great moves');
    assert((await reply().innerText()).includes('Brilliant') && (await reply().innerText()).includes('Great'));
    assert.deepEqual(await reply().locator('.coach-jump').evaluateAll(buttons => buttons.map(button => Number(button.dataset.ply))), [1, 2, 3, 11]);

    stage = 'all saved grades are visible while navigating';
    await page.locator('.coach-commentary-toggle').check();
    for (const [label, plies] of Object.entries(expected)) {
      const ply = plies[0]; await update({ ply });
      await poll(async () => await page.locator(`.coach-walkthrough[data-ply="${ply}"]`).isVisible(), `${label} walkthrough`);
      assert((await page.locator('.coach-walkthrough .coach-walkthrough-heading').textContent()).includes(label));
      assert.equal(await page.locator('.coach-walkthrough .coach-rating-icon').count(), 1, 'The walkthrough shows its saved rating icon.');
      assert(await active(kinds[label]).count() > 0, `${label} navigation reaction matches the saved grade.`);
      if (['Brilliant', 'Great', 'Best'].includes(label)) {
        const badge = page.locator('.coach-heading .coach-reaction-badge');
        assert.equal(await badge.getAttribute('data-rating'), label);
        assert((await badge.locator('img').getAttribute('src')).endsWith(`/${label.toLowerCase()}.svg`));
      }
    }
    await page.setViewportSize({ width: 320, height: 812 });
    await ask('Why was 2. Nf3 rated Great?');
    assert.equal(await reply().locator('.coach-grade-chip').getAttribute('data-rating'), 'Great');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Rating chips fit320px.');
    const chip = await reply().locator('.coach-grade-chip').boundingBox();
    assert(chip && chip.x >= 0 && chip.x + chip.width <= 321);
    stage = 'new coach personalities preserve saved facts and fit320px';
    assert.equal(await page.locator('.coach-select option[value="owl"]').textContent(), 'Professor Meowl');
    for (const id of ['mellow', 'scout']) {
      await chooseCoach(id);
      await poll(async () => (await stored()).coach === id, `${id} personality saved`);
      await poll(() => page.locator('.coach-avatar').evaluate(image => image.complete && image.naturalWidth > 0), `${id} portrait loaded`);
      assert((await page.locator('.coach-avatar').getAttribute('src')).endsWith(`/MeowlChess-coach-${id}.svg`), 'New personalities have distinct bundled outfits.');
      await ask('Why was 2. Nf3 rated Great?');
      const answer = await reply().innerText();
      assert(answer.includes('Great') && !answer.includes('undefined'), `${id} keeps the actual saved grade and has complete copy.`);
      assert.equal(await reply().locator('.coach-grade-chip').getAttribute('data-rating'), 'Great');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${id} fits320px.`);
    }
    await mkdir(join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-ratings-mobile.png'), fullPage: true });
    await page.evaluate(() => window.reactionFixture.dispose());
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    console.log('PASS: all9 saved grades, plural category queries, exact grade links/icons/reactions, player focus, restored review and320px chips');
  } else if (audioOnly) {
    stage = 'recorded clips decode locally';
    assert.equal(await page.locator('.coach-sound-toggle').isChecked(), false);
    assert(await page.locator('.coach-volume-controls').isVisible());
    assert(await page.locator('.coach-sound-preview').isDisabled());
    await ask('Summarize this game');
    assert.equal(await page.evaluate(() => window.coachAudioEvents.contexts), 0, 'Silent default does not create an audio context.');
    const files = (await readdir(join(root, 'extension', 'sounds', 'coaches'))).filter(file => file.endsWith('.wav')).sort();
    assert(files.length >= 20, 'The expanded bank includes at least20 real recordings.');
    const decoded = await page.evaluate(async files => {
      const { COACH_MEOW_CLIPS } = await import('./lib/coach-audio-clips.js');
      const audio = new AudioContext(), metadata = [];
      try {
        for (const file of files) {
          const url = new URL(`./sounds/coaches/${file}`, location.href);
          const response = await fetch(url); if (!response.ok) throw new Error(`Missing clip: ${file}`);
          const buffer = await audio.decodeAudioData(await response.arrayBuffer());
          let peak = 0, energy = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (const value of samples) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
          }
          const digest = await crypto.subtle.digest('SHA-256', buffer.getChannelData(0).buffer);
          const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
          metadata.push({ file, duration: buffer.duration, length: buffer.length, channels: buffer.numberOfChannels, peak, energy, hash });
        }
        return { metadata, catalogFiles: [...new Set(COACH_MEOW_CLIPS.map(clip => clip.file))].sort() };
      } finally { await audio.close(); }
    }, files);
    assert.deepEqual(decoded.catalogFiles, files, 'The catalog and bundled clips agree.');
    assert.equal(new Set(decoded.metadata.map(clip => clip.hash)).size, files.length, 'The recorded variations contain distinct decoded audio.');
    for (const clip of decoded.metadata) {
      assert(clip.duration > 0.05 && clip.duration < 5 && clip.length > 0 && clip.channels > 0, `${clip.file} is a short decodable clip.`);
      assert(clip.peak > 0.001 && clip.energy > 0.001, `${clip.file} contains audible samples.`);
    }

    stage = 'recorded UI playback and volume';
    await page.locator('.coach-motion-toggle').uncheck();
    await page.locator('.coach-sound-toggle').check();
    const setVolume = async value => {
      await page.locator('.coach-volume').evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, value);
      await poll(async () => (await stored()).volume === value / 100, 'recorded meow volume saved');
    };
    const previewGain = async value => {
      await setVolume(value);
      const before = await page.evaluate(() => ({ starts: window.coachAudioEvents.starts, gains: window.coachGainEvents.length }));
      await page.locator('.coach-sound-preview').click();
      await poll(async () => await page.evaluate(() => window.coachAudioEvents.starts) > before.starts, 'AudioBufferSource starts');
      return page.evaluate(index => Math.max(...window.coachGainEvents.slice(index)), before.gains);
    };
    const quietGain = await previewGain(20);
    await delay(1300);
    const louderGain = await previewGain(80);
    assert(quietGain > 0 && Math.abs(louderGain / quietGain - 4) < 0.05, 'Volume slider controls recorded playback gain.');
    let starts = await page.evaluate(() => window.coachAudioEvents.starts);
    await setVolume(0); assert(await page.locator('.coach-sound-preview').isDisabled());
    await ask('Summarize this game'); await delay(100);
    assert.equal(await page.evaluate(() => window.coachAudioEvents.starts), starts, 'Zero volume does not start a recorded voice.');
    await setVolume(80);
    await page.locator('.coach-sound-toggle').uncheck(); await ask('Summarize this game'); await delay(100);
    assert.equal(await page.evaluate(() => window.coachAudioEvents.starts), starts, 'Disabled sound does not start a recorded voice.');
    await page.locator('.coach-sound-toggle').check();
    await ask('Summarize this game');
    await poll(async () => await page.evaluate(() => window.coachAudioEvents.starts) > starts, 'recorded reply starts');
    const stops = await page.evaluate(() => window.coachAudioStops);
    await page.evaluate(() => window.reactionFixture.hide(true));
    await poll(async () => await page.evaluate(() => window.coachAudioStops) > stops, 'hidden tab stops recorded voice');
    starts = await page.evaluate(() => window.coachAudioEvents.starts);
    await update({ ply: 1 }); await delay(150);
    assert.equal(await page.evaluate(() => window.coachAudioEvents.starts), starts, 'Hidden positions do not start audio.');
    await page.evaluate(() => window.reactionFixture.hide(false));

    stage = 'every recording plays naturally and stops';
    const playedFiles = await page.evaluate(async () => {
      const { createCoachSounds } = await import('./lib/coach-sounds.js');
      const { COACH_MEOW_CLIPS } = await import('./lib/coach-audio-clips.js');
      const played = [];
      for (const clip of COACH_MEOW_CLIPS) {
        const sound = createCoachSounds({ isEnabled: () => true, getVolume: () => 0.8, clips: [clip] });
        try {
          if (!await sound.play({ kind: clip.kinds[0], coach: 'meowl' })) throw new Error(`Clip did not play: ${clip.file}`);
          played.push(clip.file); sound.stop();
        } finally { sound.dispose(); }
      }
      return played.sort();
    });
    assert.deepEqual([...new Set(playedFiles)], files);
    const voices = await page.evaluate(() => window.coachBufferEvents);
    assert(voices.length >= files.length + 3);
    assert(voices.every(voice => voice.rate === 1 && voice.detune === 0 && voice.length > 0 && voice.channels > 0), 'All recorded voices retain their natural pitch/rate and a decoded buffer.');
    assert.equal(await page.evaluate(() => window.coachOscillatorStarts), 0, 'Recorded meows never use an oscillator.');
    await page.evaluate(() => window.reactionFixture.dispose());
    assert.deepEqual(external, [], 'Playback only reads bundled extension assets.');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${files.length} local recorded clips decode and play at natural rate; volume, disabled/hidden cancellation and stop respected`);
  } else {
  stage = 'quiet defaults and short reply reaction';
  assert(await page.locator('.coach-motion-toggle').isChecked());
  assert.equal(await page.locator('.coach-sound-toggle').isChecked(), false);
  assert(await page.locator('.coach-volume-controls').isVisible(), 'Volume stays discoverable while sounds are off.');
  assert(await page.locator('.coach-sound-preview').isDisabled(), 'Preview still requires sound opt-in.');
  assert.equal(await page.locator('.coach-volume').inputValue(), '80', 'Missing stored volume defaults to80percent.');
  await ask('Summarize this game');
  assert(await active('talk').count() > 0, 'Coach reacts to the completed local reply.');
  assert(await active('talk').count() <= 2, 'Only the header and latest reply react.');
  assert.deepEqual(await page.evaluate(() => window.coachAudioEvents), { contexts: 0, starts: 0, closes: 0 }, 'Silent default does not allocate audio.');
  await idle();
  assert.equal(await page.locator('.coach-message[data-role="user"]').count(), 1);
  assert.equal(await page.locator('.coach-message[data-role="coach"]').count(), 1);

  stage = 'original-art puppet renders and changes pixels for every coach';
  for (const coachId of ['meowl', 'owl', 'paws']) {
    await chooseCoach(coachId);
    await poll(async () => (await stored()).coach === coachId, 'saved puppet coach');
    await ask('Summarize this game');
    const canvas = page.locator('.coach-heading .coach-reaction-puppet');
    await canvas.waitFor({ state: 'visible', timeout: 1200 });
    const first = await canvas.evaluate(element => ({
      frame: Number(element.dataset.frame), width: element.width, height: element.height,
      pixels: Array.from(element.getContext('2d').getImageData(0, 0, element.width, element.height).data),
    }));
    assert(first.pixels.filter((value, index) => index % 4 === 3 && value > 32).length > 100, `${coachId} draws the portrait, not an empty canvas.`);
    assert.equal(await page.locator('.coach-avatar').evaluate(image => getComputedStyle(image).visibility), 'hidden', 'Rendered puppet replaces its idle portrait.');
    await page.waitForFunction(before => {
      const element = document.querySelector('.coach-heading .coach-reaction-puppet');
      if (!element || Number(element.dataset.frame) <= before.frame) return false;
      const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      let changed = 0;
      // Ignore Brave's low-amplitude canvas privacy noise; demand actual painted-pixel changes.
      for (let index = 0; index < pixels.length; index += 4) {
        if (Math.max(...[0, 1, 2, 3].map(channel => Math.abs(pixels[index + channel] - before.pixels[index + channel]))) > 16) changed++;
      }
      return changed >= 3;
    }, first, { timeout: 1000 });
    await idle();
    assert.equal(await canvas.count(), 0, 'The puppet canvas is removed after talking.');
    assert.equal(await page.locator('.coach-avatar').evaluate(image => getComputedStyle(image).visibility), 'visible', 'Idle portrait returns unchanged.');
  }
  await chooseCoach('meowl');
  await poll(async () => (await stored()).coach === 'meowl', 'restore initial coach');

  stage = 'Brilliant context, side filtering and redraw deduplication';
  await page.locator('.coach-perspective').selectOption('w');
  await update({ ply: 1 }); assert(await active('brilliant').count() > 0, 'Reviewed White Brilliant celebrates.');
  await idle();
  for (let i = 0; i < 6; i++) await update({ ply: 1 });
  await assertIdle('Redraws on the same move do not replay celebration.');
  await chooseCoach('owl'); await assertIdle('Changing coach does not replay the same Brilliant.');
  await update({ ply: 2 }); await assertIdle('Opponent Brilliant stays quiet when focusing White.');
  await page.locator('.coach-perspective').selectOption('both'); await assertIdle('Changing focus does not replay current position.');
  await update({ active: false }); await update({ active: true });
  await assertIdle('Changing focus then returning to Coach does not revive the same suppressed Brilliant.');
  await update({ ply: 3 }); await assertIdle('An ordinary move has no special reaction.');
  await update({ ply: 2 }); assert(await active('brilliant').count() > 0, 'Re-entering a Brilliant can celebrate for Both.');
  await idle();
  await update({ active: false }); await update({ active: true }); await assertIdle('Switching tabs does not replay a previous Brilliant.');
  await ask('Why was 1... e5 rated this way?'); assert(await active('brilliant').count() > 0, 'Reply about an eligible Brilliant has a special reaction.');
  await idle();
  await ask('Why was 2. Nf3 rated this way?'); assert(await active('celebrate').count() > 0, 'A Great move receives a positive reaction.');
  await renderedPuppet(); await idle();
  await ask('Why was 2... Nc6 rated this way?'); assert(await active('encourage').count() > 0, 'A mistake receives a reassuring reaction.');
  await renderedPuppet(); await idle();
  await ask('Why was 3. Bb5 rated this way?'); assert(await active('approve').count() > 0, 'A Good move receives a small approving gesture.');
  await idle();

  stage = 'motion preference and quiet sound opt-in';
  await page.locator('.coach-motion-toggle').uncheck();
  await poll(async () => (await stored()).motion === false, 'saved motion preference');
  await ask('Summarize this game'); await assertIdle('Disabling reactions leaves the answer static.');
  assert.equal(await page.evaluate(() => window.coachAudioEvents.contexts), 0);
  await page.locator('.coach-sound-toggle').check();
  await poll(async () => (await stored()).sounds === true, 'saved sound preference');
  const beforeAudio = await page.evaluate(() => window.coachAudioEvents.starts);
  await ask('Summarize this game');
  await poll(async () => await page.evaluate(() => window.coachAudioEvents.starts) > beforeAudio, 'opted-in local meow');
  await assertIdle('Motion-off remains static even when sound is enabled.');
  stage = 'volume slider, explicit preview and mute';
  assert(await page.locator('.coach-volume-controls').isVisible());
  const changeVolume = async value => {
    await page.locator('.coach-volume').evaluate((input, value) => {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await poll(async () => (await stored()).volume === value / 100, `saved ${value}percent volume`);
  };
  await changeVolume(45);
  assert.equal(await page.locator('.coach-volume-value').textContent(), '45%');
  const beforePreview = await page.evaluate(() => window.coachAudioEvents.starts);
  await page.locator('.coach-sound-preview').click();
  await poll(async () => await page.evaluate(() => window.coachAudioEvents.starts) > beforePreview, 'explicit sound preview');
  const previewStarts = await page.evaluate(() => window.coachAudioEvents.starts);
  await page.locator('.coach-sound-preview').evaluate(button => { button.click(); button.click(); });
  await delay(100);
  assert.equal(await page.evaluate(() => window.coachAudioEvents.starts), previewStarts, 'Rapid preview clicks respect the cooldown.');
  await changeVolume(0);
  assert(await page.locator('.coach-sound-preview').isDisabled(), 'Zero volume disables Preview.');
  assert.equal(await page.locator('.coach-volume').getAttribute('aria-valuetext'), 'Muted');
  await ask('Summarize this game'); await delay(100);
  assert.equal(await page.evaluate(() => window.coachAudioEvents.starts), previewStarts, 'Zero volume does not start an audible voice.');
  await changeVolume(100); assert.equal(await page.locator('.coach-volume-value').textContent(), '100%');
  await changeVolume(80);
  await page.locator('.coach-sound-toggle').uncheck();
  await page.locator('.coach-motion-toggle').check();
  await poll(async () => { const value = await stored(); return value.motion === true && value.sounds === false && value.coach === 'owl' && value.perspective === 'both' && value.commentary === false && value.volume === 0.8; }, 'independent merged coach choices');
  assert(await page.locator('.coach-volume-controls').isVisible());
  assert(await page.locator('.coach-sound-preview').isDisabled());

  stage = 'blocking, visibility and game-switch cancellation';
  await ask('Summarize this game'); assert(await active('talk').count() > 0);
  await page.locator('.coach-question').fill('Keep my draft');
  const chatCount = await page.locator('.coach-message').count();
  await update({ blockedReason: 'Finish your practice attempt first.' }); await assertIdle('Practice stops active reaction.');
  assert.equal(await page.locator('.coach-log').isVisible(), false, 'Practice hides answers.');
  assert.equal(await page.locator('.coach-form').isVisible(), false);
  await update({ blockedReason: '' }); await assertIdle('Returning from practice does not replay reaction.');
  assert.equal(await page.locator('.coach-question').inputValue(), 'Keep my draft');
  assert.equal(await page.locator('.coach-message').count(), chatCount);
  await ask('Summarize this game');
  await page.evaluate(() => window.reactionFixture.hide(true)); await assertIdle('Hidden document stops reaction.');
  const audioWhenHidden = await page.evaluate(() => window.coachAudioEvents.starts);
  await update({ ply: 0 }); await update({ ply: 1 }); await assertIdle('Hidden Brilliant has no reaction.');
  await page.evaluate(() => window.reactionFixture.hide(false)); await assertIdle('Visibility restoration does not replay hidden reaction.');
  assert.equal(await page.evaluate(() => window.coachAudioEvents.starts), audioWhenHidden);
  await ask('Summarize this game'); await update({ active: false }); await assertIdle('Leaving Coach stops talking.');
  await update({ active: true }); await assertIdle('Returning Coach does not replay reply.');
  await ask('Summarize this game'); await page.evaluate(() => window.reactionFixture.switchGame()); await assertIdle('New game stops previous reaction.');
  assert.equal(await page.locator('.coach-message').count(), 0, 'New game clears conversation.');

  stage = 'Brilliant reaction beside the Moves explanation';
  await update({ active: false, moveReactionsActive: true, ply: 2 });
  assert(await page.locator('#move-fixture .coach-actor[data-reaction="brilliant"]').count() > 0, 'Visible Moves coach celebrates the displayed Brilliant.');
  assert.equal(await page.locator('#coach-fixture .coach-actor[data-reaction]').count(), 0, 'Hidden chat portrait stays idle.');
  await idle(); await update({ moveReactionsActive: false }); await update({ active: true, ply: 3 });

  stage = 'automatic current-move commentary';
  const priorChatCount = await page.locator('.coach-message').count();
  await page.locator('.coach-commentary-toggle').check();
  await poll(async () => (await stored()).commentary === true, 'saved automatic commentary');
  await poll(async () => await page.locator('.coach-walkthrough[data-ply="3"]').isVisible(), 'current move comment');
  await assertIdle('Turning commentary on shows text without replaying the current move.');
  await page.evaluate(() => { window.reactionFixture.update({ ply: 4 }); window.reactionFixture.update({ ply: 5 }); });
  await poll(async () => await page.locator('.coach-walkthrough[data-ply="5"]').isVisible(), 'latest scrubbed move comment');
  assert.equal(await page.locator('.coach-walkthrough .coach-walkthrough-heading .move-notation').getAttribute('data-san'), 'Bb5');
  assert(await active('approve').count() > 0, 'Coach acknowledges a Good move automatically.');
  assert.equal(await page.locator('.coach-message').count(), priorChatCount, 'Move commentary never fills chat history.');
  await idle();
  for (let i = 0; i < 6; i++) await update({ ply: 5 });
  await delay(250); await assertIdle('Repeated context renders do not speak again.');
  await page.locator('.coach-perspective').selectOption('w');
  await update({ ply: 6 }); await delay(250);
  assert.equal(await page.locator('.coach-walkthrough').isVisible(), false, 'Opponent move commentary respects focus.');
  await page.locator('.coach-perspective').selectOption('both');
  await poll(async () => await page.locator('.coach-walkthrough[data-ply="6"]').isVisible(), 'comment after focus change');
  await assertIdle('Focus settings do not replay an existing comment aloud.');
  await update({ ply: 3 }); await page.evaluate(() => window.reactionFixture.hide(true)); await delay(250);
  await assertIdle('Hidden tabs cancel queued walkthrough speech.');
  assert.equal(await page.locator('.coach-walkthrough').isVisible(), false);
  await page.evaluate(() => window.reactionFixture.hide(false));
  await poll(async () => await page.locator('.coach-walkthrough[data-ply="3"]').isVisible(), 'silent return to current move');
  await assertIdle('Returning from a hidden tab does not speak an old move.');
  await update({ ply: 4, blockedReason: 'Finish your practice attempt first.' }); await delay(250);
  assert.equal(await page.locator('.coach-walkthrough').isVisible(), false, 'Practice hides walkthrough evidence.');
  await update({ blockedReason: '' });
  await poll(async () => await page.locator('.coach-walkthrough[data-ply="4"]').isVisible(), 'restored comment after practice');
  await assertIdle('Returning from practice does not replay automatic speech.');
  await update({ active: false, moveReactionsActive: true, ply: 5 });
  await poll(async () => await page.locator('#move-fixture .move-coach-comment[data-ply="5"]').isVisible(), 'Moves comment follows the selected move');
  assert(await page.locator('#move-fixture .coach-actor[data-reaction="approve"]').count() > 0);
  await update({ moveReactionsActive: false }); await delay(250); await assertIdle('Summary stops automatic speech.');
  assert.equal(await page.locator('#move-fixture').isVisible(), false);
  await update({ active: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Automatic commentary fits a narrow view.');
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-walkthrough-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1000, height: 950 });
  await page.locator('.coach-commentary-toggle').uncheck();
  await poll(async () => (await stored()).commentary === false, 'saved commentary disabled');
  await update({ ply: 3 }); await delay(250); await assertIdle('Disabled commentary leaves ordinary moves quiet.');
  assert.equal(await page.locator('.coach-walkthrough').isVisible(), false);

  stage = 'reduced motion and narrow-screen layout';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ask('Summarize this game');
  const transforms = await page.locator('.coach-heading .coach-actor, .coach-heading .coach-avatar').evaluateAll(items => items.map(item => getComputedStyle(item).transform));
  assert(transforms.every(value => value === 'none'), 'Reduced motion leaves the full portrait still.');
  // Chat portraits use a fixed centering translation to crop the face; that is layout.
  assert.equal(await page.locator('.coach-reaction-puppet').count(), 0, 'Reduced motion never paints an animated portrait.');
  assert(await page.evaluate(() => document.getAnimations().every(animation => !animation.effect?.target?.closest?.('.coach-actor'))), 'Reduced motion has no actor animation timeline.');
  await idle();
  await page.setViewportSize({ width: 375, height: 812 });
  await update({ ply: 1 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile view has no horizontal overflow.');
  const portrait = await page.locator('.coach-avatar').boundingBox();
  assert(portrait && portrait.x >= 0 && portrait.x + portrait.width <= 375);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-reactions-mobile.png'), fullPage: true });
  await idle();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ask('Summarize this game');
  await page.evaluate(() => window.reactionFixture.dispose()); await assertIdle('Disposing coach stops all decoration.');
  assert.deepEqual(external, [], 'Coach reactions do not contact any external service.');
  assert.deepEqual(errors, [], 'No browser page errors.');
  console.log('PASS: local talk/Brilliant reactions, side filtering, deduplication, optional meows, cancellation, preferences, reduced motion and mobile fit');
  }
} catch (error) {
  console.error(`Coach reactions failed during ${stage}:`, error);
  if (page) {
    await mkdir(join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: join(root, 'test-results', 'MeowlChess-coach-reactions-failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (context) await closeTestContext(context, profile, profilePrefix);
  for (const [directory, prefix] of [[profile, profilePrefix], [bundle, bundlePrefix]]) {
    const target = resolve(directory);
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup path.');
    await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}
