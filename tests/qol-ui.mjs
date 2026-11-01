import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { openImport, closeLibrary, closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), extension = join(root, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'meowlchess-qol-test-'));
const pgn = '[Event "Share summary"]\n[White "WhitePlayerWithALongName"]\n[Black "BlackPlayerWithALongName"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 d5 8. exd5 cxd5 9. O-O O-O 10. Bg5 c6 11. Qf3 Be7 12. Rfe1 Be6 13. Rad1 Qc7 14. Kh1 Kh8 15. Re2 Rfe8 1/2-1/2';
let context, page, stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const external = [], errors = [];
  await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.abort(); });
  const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.engineCommands = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(command, ...args) { if (typeof command === 'string') window.engineCommands.push(command); return send.call(this, command, ...args); };
    window.copyCalls = 0; window.copyAllowed = false;
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async items => {
      window.copyCalls++;
      if (!window.copyAllowed) throw new DOMException('Blocked by browser', 'NotAllowedError');
      if (items.length !== 1 || !items[0].types.includes('image/png')) throw new Error('Expected PNG clipboard item');
      const blob = await items[0].getType('image/png');
      if (blob.size < 1000) throw new Error('Empty image');
    }});
    if (globalThis.chrome?.permissions) {
      window.permissionRequests = 0;
      chrome.permissions.request = async () => { window.permissionRequests++; return false; };
    }
  });
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.goto(`${origin}/review.html`);
  await openImport(page); await page.locator('#pgn-text').fill(pgn); await page.locator('#import-button').click(); await closeLibrary(page);
  assert.equal(await page.locator('#share-summary').isDisabled(), true);
  await page.locator('#review-settings > summary').click();
  await page.locator('#depth').selectOption('50'); await page.locator('#smart-analysis').uncheck();
  await page.waitForFunction(() => !document.querySelector('#completion-alerts').disabled);
  assert.equal(await page.locator('#completion-alerts').isChecked(), false);
  assert.equal(await page.evaluate(() => window.permissionRequests), 0, 'Startup must never ask for notification access.');
  await page.locator('#completion-alerts').click();
  await page.waitForFunction(() => /not allowed/.test(document.querySelector('#completion-alert-status').textContent));
  assert.equal(await page.locator('#completion-alerts').isChecked(), false);
  assert.equal(await page.evaluate(() => window.permissionRequests), 1);
  await page.locator('#review-settings > summary').click();
  stage = 'actual completed review';
  await page.locator('#analyze-button').click();
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#save-status').textContent) && !document.querySelector('#analyze-button').disabled, null, { timeout: 60000 });
  assert.equal(await page.locator('#summary-panel').isVisible(), true);
  assert.equal(await page.locator('#share-summary').isEnabled(), true);
  const commands = await page.evaluate(() => window.engineCommands.length);
  stage = 'share from actual main page';
  await page.locator('#share-summary').click();
  const dialog = page.locator('#meowl-summary-share');
  await dialog.locator('[data-share-save]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[data-share-save]').disabled);
  assert.equal(await page.evaluate(() => window.copyCalls), 0, 'Preview never writes the clipboard.');
  assert.deepEqual(await dialog.locator('img').evaluate(image => ({ w: image.naturalWidth, h: image.naturalHeight })), { w: 1200, h: 1200 });
  const position = await page.locator('#position-label').innerText();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('End');
  assert.equal(await page.locator('#position-label').innerText(), position, 'Sharing shortcuts must not move the board.');
  await dialog.locator('[data-share-copy]').click();
  await page.waitForFunction(() => /Use Save image/.test(document.querySelector('.summary-share-status').textContent));
  await page.evaluate(() => window.copyAllowed = true);
  await dialog.locator('[data-share-copy]').click();
  await page.waitForFunction(() => /Image copied/.test(document.querySelector('.summary-share-status').textContent));
  const downloadEvent = page.waitForEvent('download'); await dialog.locator('[data-share-save]').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^MeowlChess-.*\.png$/);
  const output = join(root, 'test-results', 'qol-actual-summary.png'); await download.saveAs(output);
  const png = await readFile(output); assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 1200);
  await page.screenshot({ path: join(root, 'test-results', 'qol-share-desktop.png') });
  await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.locator('#share-summary').evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.engineCommands.length), commands, 'Sharing never starts an engine.');
  stage = 'narrow share dialog and saved preference';
  await page.setViewportSize({ width: 375, height: 600 }); await page.locator('#share-summary').click();
  await page.waitForFunction(() => !document.querySelector('[data-share-save]').disabled);
  assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Dialog has no horizontal overflow.');
  await dialog.locator('[data-share-save]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(root, 'test-results', 'qol-share-mobile.png') });
  await dialog.locator('.summary-share-close').click();
  await page.reload(); await closeLibrary(page);
  await page.waitForFunction(() => !document.querySelector('#completion-alerts').disabled);
  assert.equal(await page.locator('#completion-alerts').isChecked(), false);
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log('QoL UI: opt-in/denied notifications, real summary PNG, copy fallback/success, download, keyboard, responsive layout, and no extra engine/network work passed.');
} catch (error) { console.error('QoL UI stage:', stage); throw error; }
finally { await closeTestContext(context, profile, 'meowlchess-qol-test-'); }
