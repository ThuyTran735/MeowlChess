import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readSignedInAccount } from '../extension/lib/account-detection.js';

// Structural fixtures use only account-menu markup, not copied personal data.
// Marker provenance is documented in account-detection.js; every function below
// runs through real browser serialization, as chrome.scripting does.
test('signed-in account detection reads only trusted own-account DOM widgets', async t => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true,
  });
  const context = await browser.newContext();
  let markup = '';
  await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>' + (route.request().url().endsWith('/embed') ? '<p>Child frame</p>' : markup) + '</body></html>' }));
  const page = await context.newPage();
  const read = async (html, url = 'https://www.chess.com/game/987654321?username=OtherPlayer') => {
    markup = html; await page.goto(url);
    // Detection must not require cookies, local storage, or page globals.
    await page.evaluate(() => {
      Object.defineProperty(document, 'cookie', { get() { throw new Error('Cookies must not be read'); } });
      Object.defineProperty(window, 'context', { get() { throw new Error('Page state must not be read'); } });
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage must not be read'); } });
    });
    const value = await page.evaluate(readSignedInAccount);
    assert.deepEqual(Object.keys(value).sort(), ['source', 'state', 'username']);
    return value;
  };
  const chessNav = (name, extra = '') => `<nav id="sidebar-main-menu"><a data-interaction="profile" href="/member/${name}"><img alt=""><span>${name}</span></a>${extra}</nav>`;
  const lichessNav = name => `<header id="top"><div class="dasher"><button id="user_tag" class="toggle link">${name}</button><div id="dasher_app"></div></div></header>`;
  const expected = (source, state, username = '') => ({ source, state, username });
  try {
    await t.test('Chess.com own navigation wins over game players, viewed profile, and query parameters', async () => {
      assert.deepEqual(await read(chessNav('PlayerCat') + '<main><a href="/member/OtherPlayer">OtherPlayer</a><div data-test-element="user-tagline-username">OtherPlayer</div></main>', 'https://www.chess.com/member/OtherPlayer?username=OtherPlayer'), expected('chesscom', 'signed-in', 'PlayerCat'));
      assert.deepEqual(await read(chessNav('PlayerCat'), 'https://chess.com/game/123'), expected('chesscom', 'signed-in', 'PlayerCat'));
    });
    await t.test('mobile and desktop duplicates agree, but conflicting widgets fail closed', async () => {
      const mobile = '<div id="mobile-toolbar"><a data-interaction="mobile-profile" href="https://www.chess.com/member/playercat">Profile</a></div>';
      assert.deepEqual(await read(mobile), expected('chesscom', 'signed-in', 'playercat'));
      assert.equal((await read(chessNav('PlayerCat') + mobile)).state, 'signed-in');
      assert.deepEqual(await read(chessNav('AnotherCat') + mobile), expected('chesscom', 'ambiguous'));
      assert.deepEqual(await read('<nav id="sidebar-main-menu"><div data-interaction="profile"><a href="/fr/member/PlayerCat">Profile</a></div></nav>'), expected('chesscom', 'signed-in', 'PlayerCat'));
    });
    await t.test('unscoped players, arbitrary links, and incomplete page hydration are not identities', async () => {
      for (const html of ['', '<a href="/member/PlayerCat">PlayerCat</a>', '<nav id="sidebar-main-menu"><a href="/member/PlayerCat">PlayerCat</a></nav>', '<main><a data-interaction="profile" href="/member/PlayerCat">PlayerCat</a></main>', '<nav id="sidebar-main-menu"><button data-interaction="profile">PlayerCat</button></nav>']) {
        assert.deepEqual(await read(html), expected('chesscom', 'unknown'));
      }
    });
    await t.test('profile targets must stay on the exact provider and contain only a username path', async () => {
      for (const href of ['https://www.chess.com.evil.test/member/PlayerCat', 'https://evil.test/member/PlayerCat', 'https://guest@www.chess.com/member/PlayerCat', 'http://www.chess.com/member/PlayerCat', 'https://www.chess.com:8443/member/PlayerCat', '/member/PlayerCat?username=OtherPlayer', '/member/PlayerCat#details', '/member/PlayerCat/games', '/member/Bad%20Name', '/member/' + 'x'.repeat(51)]) {
        assert.deepEqual(await read(`<nav id="sidebar-main-menu"><a data-interaction="profile" href="${href}">PlayerCat</a></nav>`), expected('chesscom', 'unknown'), href);
      }
    });
    await t.test('signed-out requires the site navigation login control and contradictory auth is ambiguous', async () => {
      const login = '<a class="navbar-login sidebar-auth" href="https://www.chess.com/login_and_go?returnUrl=/">Log In</a>';
      assert.deepEqual(await read(`<nav id="sidebar-main-menu">${login}</nav>`), expected('chesscom', 'signed-out'));
      assert.deepEqual(await read('<main>' + login + '</main>'), expected('chesscom', 'unknown'));
      assert.deepEqual(await read(chessNav('PlayerCat', login)), expected('chesscom', 'ambiguous'));
    });
    await t.test('Lichess reads only its signed-in dasher, including on a different profile', async () => {
      assert.deepEqual(await read(lichessNav('LichessCat') + '<main><a href="/@/Opponent">Opponent</a></main>', 'https://lichess.org/@/Opponent'), expected('lichess', 'signed-in', 'LichessCat'));
      assert.deepEqual(await read('<button id="user_tag">WrongCat</button><div class="dasher"><button id="user_tag">WrongCat</button></div>', 'https://lichess.org'), expected('lichess', 'unknown'));
      assert.deepEqual(await read(lichessNav('LichessCat') + lichessNav('OtherCat'), 'https://lichess.org'), expected('lichess', 'ambiguous'));
      assert.deepEqual(await read(lichessNav('Name With Spaces'), 'https://lichess.org'), expected('lichess', 'unknown'));
    });
    await t.test('Lichess sign-out ignores unrelated sign-in links', async () => {
      const login = '<div class="signin-or-signup"><a class="button signin" href="/login?referrer=/">Sign in</a></div>';
      assert.deepEqual(await read('<header id="top">' + login + '</header>', 'https://lichess.org'), expected('lichess', 'signed-out'));
      assert.deepEqual(await read(login, 'https://lichess.org'), expected('lichess', 'unknown'));
      assert.deepEqual(await read(lichessNav('LichessCat') + '<header id="top">' + login + '</header>', 'https://lichess.org'), expected('lichess', 'ambiguous'));
    });
    await t.test('unsupported, insecure, and embedded pages cannot establish identity', async () => {
      for (const url of ['http://www.chess.com', 'https://www.chess.com.evil.test', 'https://lichess.org.evil.test', 'https://lichess.org:8443', 'https://example.test']) {
        assert.deepEqual(await read(chessNav('PlayerCat') + lichessNav('LichessCat'), url), expected(null, 'unknown'));
      }
      await read(chessNav('PlayerCat') + '<iframe src="/embed"></iframe>');
      const child = page.frames().find(frame => frame !== page.mainFrame());
      assert(child); assert.deepEqual(await child.evaluate(readSignedInAccount), expected('chesscom', 'unknown'));
    });
  } finally { await context.close(); await browser.close(); }
});
