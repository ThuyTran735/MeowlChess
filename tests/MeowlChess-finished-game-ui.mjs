import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeTestContext } from './ui-helpers.mjs';

const root = resolve(import.meta.dirname, '..'), prefix = 'MeowlChess-finished-test-';
const profile = await mkdtemp(join(tmpdir(), prefix));
const scripts = await Promise.all(['site-panel.js', 'site-bot.js', 'site-content.js'].map(name => readFile(join(root, 'extension', name), 'utf8')));
const HOST = '#meowlchess-site-review';
const canonical = id => `https://www.chess.com/game/live/${id}`;
const aborted = id => ({ status: 'unavailable', reason: 'aborted', gameUrl: canonical(id) });
const ready = id => ({ status: 'ready', kind: 'export', token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gameUrl: canonical(id), panelGeneration: 1 });
const pgn = (id, termination = 'Game drawn by agreement') => `[Event "Finished game fixture"]\n[Site "Chess.com"]\n[White "sitecat"]\n[Black "siteowl"]\n[Result "1/2-1/2"]\n[Termination "${termination}"]\n[Link "https://www.chess.com/game/${id}?username=sitecat"]\n\n1. e4 1/2-1/2`;
let context, stage = 'launch';
const poll = async (fn, label) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Timed out (${stage}): ${label}`);
};
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1100, height: 800 },
  });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#302e2b;color:white}textarea{width:400px;height:160px}dialog{padding:24px}</style><div id="fixture-result" class="game-over-component">Game over</div><div class="small-controls-leftIcons"></div><div id="share-modal"></div>' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function setup({ id = '991122334', result = true, exportPgn = null, importReply = null, checkReply = null, controls = false, failImports = 0 } = {}) {
    await page.goto(`https://www.chess.com/game/${id}?username=sitecat`);
    await page.evaluate(options => {
      if (!options.result) document.getElementById('fixture-result').remove();
      const roots = new WeakMap(), attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(...args) { const root = attach.apply(this, args); roots.set(this, root); return root; };
      window.fixture = {
        calls: [], imports: [], downloads: 0, closes: 0, engineStarts: 0, reads: [],
        exportPgn: options.exportPgn, importReply: options.importReply, checkReply: options.checkReply, failImports: options.failImports,
        shadow: (id = 'meowlchess-site-review') => roots.get(document.getElementById(id)),
        mountExport() {
          const wrapper = document.createElement('div'); wrapper.className = 'share-menu-tab-pgn-component';
          const field = document.createElement('textarea'); field.value = fixture.exportPgn; wrapper.append(field); document.body.append(wrapper);
        },
        mountControls() {
          const button = document.createElement('button'); button.setAttribute('aria-label', 'Download'); button.textContent = 'Download';
          button.onclick = () => {
            fixture.downloads++;
            const dialog = document.createElement('dialog');
            const header = document.createElement('header'); header.className = 'share-menu-modal-header';
            const close = document.createElement('button'); close.className = 'cc-modal-header-close'; close.textContent = 'Close';
            close.onclick = () => { fixture.closes++; dialog.close(); dialog.remove(); }; header.append(close);
            const tab = document.createElement('button'); tab.id = 'tab-pgn'; tab.textContent = 'PGN';
            tab.onclick = () => {
              if (dialog.querySelector('textarea')) return;
              const wrapper = document.createElement('div'); wrapper.className = 'share-menu-tab-pgn-component';
              const field = document.createElement('textarea'); field.value = fixture.exportPgn; wrapper.append(field); dialog.append(wrapper);
            };
            dialog.append(header, tab); document.getElementById('share-modal').append(dialog); dialog.showModal();
          };
          document.querySelector('.small-controls-leftIcons').append(button);
        },
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker { constructor(...args) { super(...args); fixture.engineStarts++; } };
      window.chrome ??= {};
      chrome.runtime = {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getURL: path => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path,
        sendMessage: async message => {
          fixture.calls.push(message);
          if (message.type === 'meowl:site-check') return fixture.checkReply || { status: 'waiting', retryAfterMs: 15000, message: 'Waiting for this completed game.' };
          if (message.type === 'meowl:site-game-import') {
            fixture.imports.push(message.pgn);
            if (fixture.holdImport) await new Promise(resolve => { fixture.resolveImport = resolve; });
            if (fixture.failImports > 0) { fixture.failImports--; throw new Error('Temporary broker disconnect'); }
            return fixture.importReply || { status: 'error', message: 'Fixture rejects this export.' };
          }
          return { status: 'ok' };
        },
      };
      chrome.storage = { local: { get: keys => Array.isArray(keys) ? new Promise(resolve => fixture.reads.push(resolve)) : Promise.resolve({}), set: async () => {} }, onChanged: { addListener() {} } };
      if (options.controls) fixture.mountControls();
    }, { result, exportPgn, importReply, checkReply, controls, failImports });
    for (const source of scripts) await page.addScriptTag({ content: source });
  }
  async function start() {
    await page.evaluate(() => fixture.reads.shift()({ siteReviewSettings: { chesscom: { enabled: true, username: 'sitecat' } } }));
    await poll(() => page.evaluate(() => fixture.calls.some(call => call.type === 'meowl:site-check')), 'first archive lookup');
  }
  async function visiblePoll() {
    const count = await page.evaluate(() => fixture.calls.filter(call => call.type === 'meowl:site-check').length);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await poll(() => page.evaluate(before => fixture.calls.filter(call => call.type === 'meowl:site-check').length > before, count), 'next automatic lookup');
    await page.waitForTimeout(100);
  }
  async function terminal() {
    await page.locator(`${HOST}[data-state="unavailable"]`).waitFor();
    assert.deepEqual(await page.evaluate(() => {
      const root = fixture.shadow();
      return { title: root.querySelector('h2').textContent, progressHidden: root.querySelector('progress').hidden,
        stepsHidden: root.querySelector('.loading-steps').hidden, retryHidden: root.querySelector('.retry-loading').hidden,
        frames: root.querySelectorAll('iframe').length, engines: fixture.engineStarts };
    }), { title: 'Aborted game', progressHidden: true, stepsHidden: true, retryHidden: true, frames: 0, engines: 0 });
  }

  stage = 'aborted state stops polling and survives close/reopen';
  await setup({ checkReply: aborted('991122334') }); await start(); await terminal();
  const terminalCalls = await page.evaluate(() => fixture.calls.filter(call => call.type === 'meowl:site-check').length);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => fixture.calls.filter(call => call.type === 'meowl:site-check').length), terminalCalls, 'An aborted game does not resume the archive loop.');
  await page.evaluate(() => fixture.shadow().querySelector('[aria-label="Close review"]').click());
  await page.locator('#meowlchess-site-launcher').waitFor();
  await page.evaluate(() => fixture.shadow('meowlchess-site-launcher').querySelector('button').click());
  await terminal();
  assert.equal(await page.evaluate(() => fixture.calls.filter(call => call.type === 'meowl:site-check').length), terminalCalls, 'Reopening uses the terminal state without another lookup.');

  stage = 'next game is not blocked by an aborted game';
  await page.evaluate(reply => { fixture.checkReply = reply; history.pushState({}, '', '/game/991122335'); }, ready('991122335'));
  await page.locator(`${HOST}[data-state="review"]`).waitFor();
  assert.equal(await page.evaluate(() => fixture.shadow().querySelector('iframe')?.getAttribute('src').includes('site-summary.html#')), true);

  stage = 'already-open export works without a result popup';
  await setup({ result: false, exportPgn: pgn('991122334', 'Game aborted'), importReply: aborted('991122334') });
  await page.evaluate(() => fixture.mountExport()); await start(); await terminal();
  assert.equal(await page.evaluate(() => fixture.imports.length), 1);
  assert.equal(await page.evaluate(() => fixture.downloads), 0, 'The user-owned export is read without opening another dialog.');
  assert.equal(await page.locator('textarea').count(), 1, 'The user-owned export remains open.');

  stage = 'late Share controls do not exhaust the automatic budget';
  await setup({ exportPgn: pgn('991122334'), importReply: ready('991122334') }); await start();
  await page.locator(`${HOST}[data-state="waiting"]`).waitFor();
  await visiblePoll(); await visiblePoll();
  assert.equal(await page.evaluate(() => fixture.downloads), 0);
  assert.match(await page.evaluate(() => fixture.shadow().querySelector('[role="status"]').textContent), /Share button/);
  await page.evaluate(() => fixture.mountControls()); await visiblePoll();
  await page.locator(`${HOST}[data-state="review"]`).waitFor();
  assert.equal(await page.evaluate(() => fixture.downloads), 1);
  assert.equal(await page.evaluate(() => fixture.closes), 1);
  assert.equal(await page.evaluate(() => fixture.imports.length), 1);

  stage = 'an identical PGN retries after a transient broker failure';
  await setup({ exportPgn: pgn('991122334'), importReply: ready('991122334'), failImports: 1, controls: true }); await start();
  await poll(() => page.evaluate(() => fixture.imports.length === 1), 'first import fails');
  await poll(() => page.evaluate(() => /Retry loading/.test(fixture.shadow()?.querySelector('[role="status"]')?.textContent)), 'actionable retry feedback');
  await visiblePoll(); await page.locator(`${HOST}[data-state="review"]`).waitFor();
  assert.equal(await page.evaluate(() => fixture.imports.length), 2);
  assert.equal(await page.evaluate(() => fixture.imports[0] === fixture.imports[1]), true, 'The same export can be submitted again.');

  stage = 'a foreign aborted response cannot stop the current game';
  await setup({ exportPgn: pgn('991122334'), importReply: aborted('991122335'), controls: true }); await start();
  await poll(() => page.evaluate(() => fixture.imports.length === 1), 'foreign import reply');
  assert.equal(await page.locator(`${HOST}[data-state="unavailable"]`).count(), 0);
  await visiblePoll();
  assert.equal(await page.locator(`${HOST}[data-state="unavailable"]`).count(), 0);

  stage = 'a late aborted import cannot affect a new route';
  await setup({ exportPgn: pgn('991122334', 'Game aborted'), importReply: aborted('991122334'), controls: true });
  await page.evaluate(() => { fixture.holdImport = true; }); await start();
  await poll(() => page.evaluate(() => typeof fixture.resolveImport === 'function'), 'held export reply');
  await page.evaluate(() => { history.pushState({}, '', '/game/991122335'); });
  await page.waitForTimeout(1200);
  await page.evaluate(reply => { fixture.checkReply = reply; fixture.holdImport = false; fixture.resolveImport(); }, ready('991122335'));
  await page.locator(`${HOST}[data-state="review"]`).waitFor();
  assert.equal(await page.locator(`${HOST}[data-state="unavailable"]`).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Finished-game UI assertions passed.');
} finally { await closeTestContext(context, profile, prefix); }
