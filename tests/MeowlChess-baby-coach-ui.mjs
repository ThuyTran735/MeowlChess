import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), temporaryRoot = resolve(tmpdir());
const profilePrefix = 'MeowlChess-baby-test-', bundlePrefix = 'MeowlChess-baby-bundle-';
const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
const bundle = await mkdtemp(join(temporaryRoot, bundlePrefix)), extension = join(bundle, 'extension');
const output = join(root, 'test-results', 'MeowlChess-baby-coach');
const frames = process.argv.includes('--frames');
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baby Meowl</title><link rel="stylesheet" href="review.css"><link rel="stylesheet" href="coach.css"><link rel="stylesheet" href="coach-motion.css"><link rel="stylesheet" href="workspace.css"><style>body{padding:16px}main{max-width:680px;margin:auto}#coach-root{padding:16px;background:#242920}</style><main><section id="coach-root"></section></main><script type="module" src="MeowlChess-baby-fixture.js"></script></html>';
const fixture = String.raw`
import { parseGame } from './lib/review.js';
import { createCoachView } from './lib/coach-view.js';
const pgn = '[White "Cat"]\n[Black "Owl"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2';
const parsed = parseGame(pgn);
const positions = parsed.positions.map((fen, index) => {
  const next = parsed.moves[index], bestMove = next ? next.from + next.to : null;
  return { cp: 0, mate: null, depth: 16, bestMove, pv: bestMove ? [bestMove] : [] };
});
positions[2] = { cp: 10, mate: null, depth: 16, bestMove: 'f1c4', pv: ['f1c4', 'b8c6', 'g1f3', 'g8f6'] };
const moves = parsed.moves.map((move, index) => ({ ...move, ply: index + 1, label: index === 2 ? 'Mistake' : 'Best', probabilityLoss: index === 2 ? 0.15 : 0, loss: 0, accuracy: 100, evalAfter: positions[index + 1] }));
const state = { game: { pgn }, result: { game: parsed, positions, moves, summary: { w: { accuracy: 90 }, b: { accuracy: 100 } } }, ply: 3, active: true };
const view = createCoachView(document.querySelector('#coach-root'), { onNavigate({ ply }) { state.ply = ply; view.setContext(state); } });
view.setContext(state);
window.fixture = { dispose: () => view.dispose() };
window.fixtureReady = true;
`;
let context, page, stage = 'launch';
const errors = [], external = [];
const roster = ['meowl', 'baby', 'owl', 'paws', 'mellow', 'scout', 'evil'];
try {
  await cp(join(root, 'extension'), extension, { recursive: true });
  await writeFile(join(extension, 'MeowlChess-baby-fixture.html'), html);
  await writeFile(join(extension, 'MeowlChess-baby-fixture.js'), fixture);
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, viewport: { width: 1000, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', item => item.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  await context.addInitScript(() => {
    window.fixtureWorkers = 0; window.fixtureAudio = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.fixtureWorkers++; } };
    const nativeStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) { window.fixtureAudio++; return nativeStart.apply(this, args); };
  });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ coachPreferences: { coach: 'meowl', motion: false, commentary: true } }));
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`, url = `${origin}/MeowlChess-baby-fixture.html`;
  page = await context.newPage(); await page.goto(url); await page.waitForFunction(() => window.fixtureReady);
  await page.locator('.coach-walkthrough').waitFor({ state: 'visible' });
  const choose = async id => {
    if (!await page.locator('.coach-picker').evaluate(details => details.open)) await page.locator('.coach-picker-summary').click();
    await page.locator(`.coach-choice[data-coach="${id}"]`).click();
  };
  const portrait = async id => {
    await page.waitForFunction(id => {
      const image = document.querySelector('.coach-avatar');
      return image?.src.endsWith('MeowlChess-coach-' + id + '.svg') && image.complete && image.naturalWidth === 1254;
    }, id);
  };

  stage = 'unlocked selection and persistence';
  assert.deepEqual(await page.locator('.coach-select option').evaluateAll(options => options.map(option => option.value)), roster);
  assert.equal(await page.locator('.coach-select option[value="baby"]').isDisabled(), false);
  assert.equal(await page.locator('.coach-select option[value="evil"]').isDisabled(), true);
  await choose('baby'); await portrait('baby');
  assert.equal(await page.locator('.coach-selected-name').innerText(), 'Baby Meowl');
  await page.waitForFunction(async () => (await chrome.storage.local.get('coachPreferences')).coachPreferences?.coach === 'baby');
  const second = await context.newPage(); await second.goto(url);
  await second.waitForFunction(() => document.querySelector('.coach-select')?.value === 'baby');
  await page.reload(); await page.waitForFunction(() => document.querySelector('.coach-select')?.value === 'baby');
  await portrait('baby');
  await page.locator('.coach-settings-summary').click();
  assert.equal(await page.locator('.coach-sound-toggle').isChecked(), false, 'New coach keeps sounds off by default.');
  await page.locator('.coach-settings-summary').click();
  await page.locator('.coach-question').fill('What was better than 2. Nf3?');
  await page.locator('.coach-send').click();
  const answer = page.locator('.coach-message[data-role="coach"]').last();
  await answer.waitFor({ state: 'visible' });
  assert((await answer.locator('.move-notation[data-san="Bc4"], .move-notation[data-san="Nf3"]').count()) > 0);
  assert.equal(await answer.locator('.coach-message-avatar').getAttribute('src'), `${origin}/icons/coaches/MeowlChess-coach-baby.svg`);
  assert((await answer.locator('.move-notation').count()) > 0, 'Baby tips retain piece symbols.');
  const chatBefore = await page.locator('.coach-log').innerHTML();
  const briefTip = await page.locator('.coach-walkthrough-text').innerText();
  await page.locator('.coach-explanation-length').selectOption('detailed');
  await page.waitForFunction(() => /The engine continues/.test(document.querySelector('.coach-walkthrough-text').textContent));
  assert((await page.locator('.coach-walkthrough-text').innerText()).length > briefTip.length, 'Baby supports fuller saved continuations.');
  assert.equal(await page.locator('.coach-log').innerHTML(), chatBefore, 'Changing Baby detail keeps the current conversation.');
  await page.locator('.coach-explanation-length').selectOption('brief');
  assert.equal(await page.evaluate(() => window.fixtureWorkers), 0);
  assert.equal(await page.evaluate(() => window.fixtureAudio), 0);
  for (const id of roster.filter(id => id !== 'evil')) { await choose(id); await portrait(id); }
  await choose('baby'); await portrait('baby');
  await second.waitForFunction(() => document.querySelector('.coach-select').value === 'baby');
  await second.close();

  stage = 'small-screen roster and motion controls';
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.coach-picker-summary').click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const babyChoice = await page.locator('.coach-choice[data-coach="baby"]').boundingBox();
  assert(babyChoice?.width >= 44 && babyChoice.height >= 44, 'Baby remains a usable touch target.');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'MeowlChess-baby-mobile.png'), fullPage: true });
  await choose('baby');
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.locator('.coach-settings-summary').click();
  await page.locator('.coach-motion-toggle').check();
  await page.locator('.coach-animation-choice').selectOption('signature');
  await page.locator('.coach-animation-preview').click();
  await page.waitForFunction(() => document.querySelector('.coach-actor[data-coach="baby"] canvas')?.width > 0);
  const activePixels = await page.locator('.coach-actor[data-coach="baby"] canvas').first().evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 200) opaque++; return opaque;
  });
  assert(activePixels > 100, 'The live Baby animation is painted, not a blank sprite.');
  await page.locator('.coach-motion-toggle').uncheck();
  await page.waitForFunction(() => !document.querySelector('.coach-actor[data-coach="baby"] canvas'));
  await portrait('baby');

  stage = 'native artwork and animation preview';
  const art = await page.evaluate(async roster => {
    const { createCoachPuppet, drawCoachPuppet, coachPoseAt, COACH_REACTION_DURATIONS: durations } = await import('./lib/coach-puppet.js');
    const { coachPuppetUrl, coachPortraitUrl } = await import('./lib/coach-portraits.js');
    const { COACH_ANIMATION_LABELS: labels } = await import('./lib/coach-repertoire.js');
    const { babyBodyFrame } = await import('./lib/coach-baby-art.js');
    const { coachGarmentSvg, drawCoachGarment } = await import('./lib/coach-garment-art.js');
    const puppets = {}, sources = {};
    for (const id of roster) { const image = new Image(); image.src = coachPuppetUrl(id); await image.decode(); sources[id] = image; puppets[id] = createCoachPuppet(image, document, id); }
    const paint = (id, pose = {}) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1254; drawCoachPuppet(canvas.getContext('2d'), puppets[id], pose); return canvas; };
    const metrics = canvas => {
      const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 1254, 1254).data;
      let left = 1254, right = 0, top = 1254, bottom = 0, opaque = 0;
      for (let y = 0; y < 1254; y++) for (let x = 0; x < 1254; x++) if (pixels[(y * 1254 + x) * 4 + 3] > 230) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); opaque++;
      }
      return { left, right, top, bottom, height: bottom - top, width: right - left, opaque };
    };
    const diff = (a, b) => {
      const x = a.getContext('2d').getImageData(0, 0, 1254, 1254).data, y = b.getContext('2d').getImageData(0, 0, 1254, 1254).data;
      let changed = 0; for (let i = 0; i < x.length; i += 4) if (Math.max(...[0, 1, 2, 3].map(c => Math.abs(x[i + c] - y[i + c]))) > 12) changed++; return changed;
    };
    const transformProbe = document.createElement('canvas').getContext('2d');
    babyBodyFrame(transformProbe);
    const bodyTransform = transformProbe.getTransform();
    const interior = (canvas, pose) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, 1254, 1254).data, holes = [];
      // Anatomical source coordinates, transformed by Baby's fixed body frame
      // and the whole-character step/tilt. Probe the neck overlap as well as
      // both exposed flanks; moving wings must not supply these pixels.
      const ranges = [[495,580,680],[505,550,710],[520,560,700],[540,530,730],[570,500,760],[620,470,790],[660,458,805],[700,458,807],[740,460,807],[780,465,805],[820,470,800],[860,480,792],[900,494,780],[940,515,758]];
      for (let y = 450; y < 590; y += 1) ranges.push([y, 605, 650]);
      const angle = pose.tilt || 0;
      for (const [y, left, right] of ranges) for (let x = left; x <= right; x += 7) {
        const point = bodyTransform.transformPoint({ x, y });
        const dx = point.x - 626, dy = point.y - 1150;
        const px = Math.round(626 + dx * Math.cos(angle) - dy * Math.sin(angle) + (pose.bodyX || 0));
        const py = Math.round(1150 + dx * Math.sin(angle) + dy * Math.cos(angle) + (pose.lift || 0));
        const alpha = pixels[(py * 1254 + px) * 4 + 3];
        if (alpha < 245 && holes.length < 8) holes.push({ x, y, alpha });
      }
      return holes;
    };
    const detachedParts = canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, 1254, 1254).data;
      const visited = new Uint8Array(1254 * 1254), queue = new Int32Array(visited.length), areas = [];
      for (let start = 0; start < visited.length; start++) {
        if (visited[start] || pixels[start * 4 + 3] < 32) continue;
        let head = 0, tail = 1; queue[0] = start; visited[start] = 1;
        while (head < tail) {
          const point = queue[head++], x = point % 1254;
          for (const next of [x ? point - 1 : -1, x < 1253 ? point + 1 : -1, point - 1254, point + 1254]) {
            if (next < 0 || next >= visited.length || visited[next] || pixels[next * 4 + 3] < 32) continue;
            visited[next] = 1; queue[tail++] = next;
          }
        }
        // Ignore individual painted flecks; ears, paws, head, and wings must
        // remain attached through opaque pixels rather than float separately.
        if (tail >= 512) areas.push(tail);
      }
      return areas.sort((a, b) => b - a).slice(1);
    };
    const rest = paint('baby'), cases = [];
    // Baby is bare-furred now. Its younger anatomy is assembled from the
    // original painted source, with no bib in either portrait or moving body.
    const garment = document.createElement('canvas'); garment.width = garment.height = 1254;
    drawCoachGarment(garment.getContext('2d'), 'baby');
    const sourceDrawing = id => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1254;
      canvas.getContext('2d').drawImage(sources[id], 0, 0); return canvas;
    };
    const originalSourceChanged = diff(sourceDrawing('baby'), sourceDrawing('meowl'));
    const garmentPixels = metrics(garment).opaque, garmentSvg = coachGarmentSvg('baby');
    const portraitImage = new Image(); portraitImage.src = coachPortraitUrl('baby'); await portraitImage.decode();
    const staticCanvas = document.createElement('canvas'); staticCanvas.width = staticCanvas.height = 1254;
    staticCanvas.getContext('2d').drawImage(portraitImage, 0, 0);
    const samples = Object.keys(durations).flatMap(kind => [.2, .45, .7].map(fraction => ({ kind, fraction, take: 0 })));
    for (const take of [1, 2]) for (const kind of ['signature', 'brilliant', 'greeting']) for (const fraction of [.3, .4, .6]) samples.push({ kind, fraction, take });
    for (let take = 0; take < labels.idle.baby.length; take++) samples.push({ kind: 'idle', fraction: .5, take });
    for (const { kind, fraction, take } of samples) {
      const pose = coachPoseAt(kind, durations[kind] * fraction, 'baby', take);
      if (!Object.values(pose).every(Number.isFinite)) throw new Error('Non-finite Baby pose: ' + kind);
      const frame = paint('baby', pose);
      cases.push({ kind, fraction, take, ...metrics(frame), holes: interior(frame, pose), detached: (kind === 'signature' || (kind === 'idle' && take % 5 === 0)) ? detachedParts(frame) : [] });
    }
    const gallery = document.createElement('canvas'); gallery.width = 720; gallery.height = 800;
    const kinds = [['greeting', 'Hello!'], ['signature', 'Playtime'], ['idle', 'Little daydream'], ['brilliant', 'Brilliant!']];
    const previewBounds = cases.reduce((box, pose) => ({ left: Math.min(box.left, pose.left), right: Math.max(box.right, pose.right), top: Math.min(box.top, pose.top), bottom: Math.max(box.bottom, pose.bottom) }), metrics(rest));
    const previewScale = Math.min(330 / (previewBounds.right - previewBounds.left + 24), 300 / (previewBounds.bottom - previewBounds.top + 24));
    const previewCenter = (previewBounds.left + previewBounds.right) / 2;
    window.babyArt = {
      frame(time) {
        const ctx = gallery.getContext('2d'); ctx.fillStyle = '#202320'; ctx.fillRect(0, 0, gallery.width, gallery.height);
        ctx.textAlign = 'center'; ctx.fillStyle = '#f3eee0'; ctx.font = 'bold 25px Segoe UI, sans-serif'; ctx.fillText('Baby Meowl', 360, 38);
        for (let index = 0; index < kinds.length; index++) {
          const [kind, title] = kinds[index], x = (index % 2) * 360, y = Math.floor(index / 2) * 365 + 55;
          const elapsed = Math.max(0, Math.min(durations[kind], (time * 6000) % (durations[kind] + 1300) - 250));
          const pose = coachPoseAt(kind, elapsed, 'baby', 0);
          const frame = paint('baby', pose);
          ctx.drawImage(frame, x + 180 - previewCenter * previewScale, y + 320 - previewBounds.bottom * previewScale, 1254 * previewScale, 1254 * previewScale);
          ctx.fillStyle = '#cbd8be'; ctx.font = '18px Segoe UI, sans-serif'; ctx.fillText(title, x + 180, y + 349);
        }
        return gallery.toDataURL('image/png').split(',')[1];
      },
    };
    return { baby: metrics(rest), adult: metrics(paint('meowl')), originalSourceChanged, garmentPixels, garmentSvg, staticChanged: diff(rest, staticCanvas), blinkChanged: diff(rest, paint('baby', { blink: 1 })), mouthChanged: diff(rest, paint('baby', { mouth: 1 })), cases, idleCount: labels.idle.baby.length, urls: roster.map(coachPortraitUrl) };
  }, roster);
  await writeFile(join(output, 'MeowlChess-baby-art.json'), JSON.stringify(art, null, 2));
  assert(art.baby.height < art.adult.height * .92, 'Baby has distinct smaller body proportions.');
  assert(art.baby.opaque > 100000);
  assert.equal(art.originalSourceChanged, 0, 'Baby keeps the original painted fur and feather source, without a bib.');
  assert.equal(art.garmentPixels, 0, 'Baby does not paint clothing over its torso during animations.');
  assert.equal(art.garmentSvg, '', 'Baby has no static clothing layer.');
  assert(Math.abs((art.baby.left + art.baby.right) / 2 - 626) < 36, 'Baby stays centered horizontally in its portrait.');
  assert(art.blinkChanged > 100, 'Baby closes its eyes.');
  assert(art.mouthChanged > 100, 'Baby moves its mouth.');
  assert(art.staticChanged < 80, 'The static portrait matches the resting animation.');
  assert(art.cases.every(item => item.opaque > 100000), 'Every Baby reaction paints a complete visible character.');
  assert.deepEqual(art.cases.filter(item => item.holes.length), [], 'Baby keeps its neck and torso filled while acting.');
  assert.deepEqual(art.cases.filter(item => item.detached.length), [], 'Baby’s ears, wings, and paws remain attached.');
  assert(art.idleCount >= 30, 'Baby has a varied idle repertoire.');
  assert.equal(new Set(art.urls).size, 7);
  await writeFile(join(output, 'MeowlChess-baby-preview.png'), Buffer.from(await page.evaluate(() => window.babyArt.frame(.26)), 'base64'));
  if (frames) {
    const directory = join(output, 'frames'); await mkdir(directory, { recursive: true });
    for (let index = 0; index < 90; index++) await writeFile(join(directory, `MeowlChess-frame-${String(index).padStart(3, '0')}.png`), Buffer.from(await page.evaluate(time => window.babyArt.frame(time), index / 89), 'base64'));
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ ui: 'Baby selection, storage, chat, mobile, motion controls passed', baby: art.baby, adult: art.adult, blink: art.blinkChanged, mouth: art.mouthChanged, poses: art.cases.length, idles: art.idleCount }));
} catch (error) {
  console.error('Baby coach stage:', stage); throw error;
} finally {
  await closeTestContext(context, profile, profilePrefix);
  const absoluteBundle = resolve(bundle);
  if (dirname(absoluteBundle) === temporaryRoot && basename(absoluteBundle).startsWith(bundlePrefix)) await rm(absoluteBundle, { recursive: true, force: true, maxRetries: 3 });
}
