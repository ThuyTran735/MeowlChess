import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { openImport, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), extension = join(root, 'extension');
const profilePrefix = 'meowlchess-sounds-test-', profile = await mkdtemp(join(tmpdir(), profilePrefix));
const pgn = '[Event "Sound navigation"]\n[White "White"]\n[Black "Black"]\n[Result "1/2-1/2"]\n\n1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. Nf3 Nf6 1/2-1/2';
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 950 }, reducedMotion: 'reduce',
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--mute-audio'],
  });
  context.setDefaultTimeout(15000);
  const errors = [], external = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.soundTelemetry = { contexts: 0, starts: [], stops: 0, gains: [] };
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args); soundTelemetry.contexts++;
        const oscillator = this.createOscillator.bind(this), gain = this.createGain.bind(this);
        this.createOscillator = () => {
          const node = oscillator(), start = node.start.bind(node), stop = node.stop.bind(node), frequency = node.frequency.setValueAtTime.bind(node.frequency);
          let scheduledFrequency;
          node.frequency.setValueAtTime = (value, time) => { scheduledFrequency = value; return frequency(value, time); };
          node.start = (...values) => { soundTelemetry.starts.push({ frequency: scheduledFrequency, visible: document.visibilityState }); return start(...values); };
          node.stop = (...values) => { soundTelemetry.stops++; return stop(...values); };
          return node;
        };
        this.createGain = () => {
          const node = gain(), ramp = node.gain.linearRampToValueAtTime.bind(node.gain);
          node.gain.linearRampToValueAtTime = (value, time) => { soundTelemetry.gains.push(value); return ramp(value, time); };
          return node;
        };
      }
    };
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  const page = await context.newPage(); await page.goto(`${origin}/review.html`);
  const settings = async open => {
    await closeLibrary(page);
    if (await page.locator('#review-settings').evaluate(el => el.open) !== open) await page.locator('#review-settings > summary').click();
  };
  const importGame = async () => { await openImport(page); await page.locator('#pgn-text').fill(pgn); await page.locator('#import-button').click(); await closeLibrary(page); };
  const count = () => page.evaluate(() => soundTelemetry.starts.length);
  const quiet = async (action, label) => {
    const before = await count(); await action(); await page.waitForTimeout(130);
    assert.equal(await count(), before, label);
  };
  const audible = async (action, label) => {
    const before = await count(); await action();
    await page.waitForFunction(before => soundTelemetry.starts.length > before, before);
    assert.equal(await count(), before + 1, label);
  };
  await importGame(); await settings(true);
  assert.equal(await page.locator('#move-sounds').isChecked(), false);
  await settings(false); await quiet(() => page.locator('#next-button').click(), 'Default-off navigation is silent.');
  assert.equal(await page.evaluate(() => soundTelemetry.contexts), 0, 'No context is created while disabled.');
  await settings(true); await quiet(() => page.locator('#move-sounds').check(), 'Enabling sounds does not play a move.');
  await page.waitForFunction(async () => (await chrome.storage.local.get('reviewSettings')).reviewSettings.moveSounds === true);
  await settings(false);
  await audible(() => page.locator('#next-button').click(), 'Step forward sounds once.');
  await audible(() => page.locator('#next-button').click(), 'Capture sounds once.');
  assert((await page.evaluate(() => soundTelemetry.starts)).some(item => item.frequency < 250), 'Capture has its lower tone.');
  await audible(() => page.locator('#previous-button').click(), 'Step backward sounds once.');
  await quiet(() => page.locator('#flip-button').click(), 'Flip is silent.');
  await settings(true);
  await quiet(() => page.locator('#show-coordinates').uncheck(), 'Display changes are silent.');
  await page.locator('#play-speed').selectOption('700'); await settings(false);
  await quiet(() => page.locator('#board [data-square="e4"]').click(), 'Selecting a piece is silent.');
  await audible(() => page.locator('#board [data-square="d5"]').click(), 'Playing a capture in a variation sounds once.');
  await audible(() => page.locator('#undo-variation').click(), 'Undoing a variation sounds once.');
  await quiet(() => page.locator('#return-game').click(), 'Returning to the same position is silent.');
  await importGame(); const afterLoad = await count(); await page.waitForTimeout(130); assert.equal(await count(), afterLoad, 'Importing a game is silent.');
  const beforePlayback = await count(); await page.locator('#play-button').click();
  await page.waitForFunction(before => soundTelemetry.starts.length >= before + 2, beforePlayback);
  await page.locator('#play-button').click();
  assert((await page.evaluate(() => soundTelemetry.gains)).every(value => value <= 0.035), 'Real context uses quiet gain.');
  await settings(true); await page.locator('#move-sounds').uncheck(); await settings(false);
  await quiet(() => page.locator('#next-button').click(), 'Turning sounds off silences navigation.');
  await settings(true); await page.locator('#move-sounds').check(); await settings(false);
  await page.reload(); await settings(true); assert.equal(await page.locator('#move-sounds').isChecked(), true, 'Sound preference survives reload.');
  assert.equal(await count(), 0, 'Reloading does not play a sound.');
  await settings(false); await importGame(); assert.equal(await count(), 0, 'Loading a game does not play a sound.');
  // Headless Brave reports all tabs visible. Exercise the actual visibility
  // handler with a controlled visibility value; no background sound is emitted.
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await quiet(() => page.locator('#next-button').click(), 'Hidden-page navigation is silent.');
  assert.equal(await page.evaluate(() => soundTelemetry.contexts), 0, 'Hidden navigation does not allocate audio.');
  await page.evaluate(() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await audible(() => page.locator('#next-button').click(), 'Visible navigation resumes sound.');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Move sounds: real muted AudioContext, default/persisted option, move/capture/variation/playback navigation, silent non-move actions and hidden state passed.');
} finally { await closeTestContext(context, profile, profilePrefix); }
