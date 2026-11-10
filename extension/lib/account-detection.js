/**
 * Read the site's own signed-in account widget, never a game/profile participant.
 * Kept self-contained so chrome.scripting can run it in the top frame's isolated
 * world. No cookies, page state, account endpoints, or page mutations are used.
 *
 * Navigation markers verified from first-party sources on 2026-11-09:
 * https://www.chess.com/r2/client-packages/navigation/2026.10.6/navigation.js
 * https://raw.githubusercontent.com/lichess-org/lila/master/modules/web/src/main/ui/layout.scala
 * Chess.com: data-interaction profile/mobile-profile in the primary nav;
 * Lichess: header/dasher renders button#user_tag from me.username.
 */
export function readSignedInAccount() {
  let source = null;
  const reply = (state = 'unknown', username = '') => ({ source, username, state });
  try {
    const page = new URL(globalThis.location.href);
    if (page.protocol !== 'https:' || page.username || page.password || page.port) return reply();
    if (page.hostname === 'chess.com' || page.hostname === 'www.chess.com') source = 'chesscom';
    else if (page.hostname === 'lichess.org') source = 'lichess';
    else return reply();
    if (globalThis.window !== globalThis.window.top) return reply();

    const names = new Map();
    const validName = value => {
      if (typeof value !== 'string' || value.length > 100) return null;
      const name = value.trim();
      return (source === 'lichess' ? /^[a-zA-Z0-9_-]{2,30}$/ : /^[a-zA-Z0-9_-]{2,50}$/).test(name) ? name : null;
    };
    const add = value => { const name = validName(value); if (name) names.set(name.toLowerCase(), name); };
    const sameSiteUrl = value => {
      if (typeof value !== 'string' || value.length > 2048) return null;
      try {
        const url = new URL(value, page.origin);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
        const hosts = source === 'lichess' ? ['lichess.org'] : ['chess.com', 'www.chess.com'];
        return hosts.includes(url.hostname) ? url : null;
      } catch { return null; }
    };
    let signedOut = false;
    if (source === 'lichess') {
      // The header's dasher is the account menu, including on another player's
      // profile and on spectator pages. Board player labels are never read.
      const widgets = document.querySelectorAll('header#top .dasher button#user_tag');
      if (widgets.length > 8) return reply('ambiguous');
      for (const widget of widgets) add(widget.textContent);
      signedOut = [...document.querySelectorAll('header#top .signin-or-signup a.signin')].slice(0, 8)
        .some(link => sameSiteUrl(link.getAttribute('href'))?.pathname === '/login');
    } else {
      const widgets = document.querySelectorAll(
        '#sidebar-main-menu [data-interaction="profile"], #mobile-toolbar [data-interaction="mobile-profile"]'
      );
      if (widgets.length > 8) return reply('ambiguous');
      for (const widget of widgets) {
        const links = widget.matches('a[href]') ? [widget] : [...widget.querySelectorAll('a[href]')].slice(0, 8);
        for (const link of links) {
          const url = sameSiteUrl(link.getAttribute('href'));
          // A localized own-profile link may include one language segment.
          const match = url && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?member\/([a-zA-Z0-9_-]{2,50})\/?$/.exec(url.pathname);
          if (match && !url.hash && !url.search) add(match[1]);
        }
      }
      signedOut = [...document.querySelectorAll('#sidebar-main-menu a.navbar-login, #mobile-toolbar a.login.mobile-auth-action')].slice(0, 8)
        .some(link => /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:login|login_and_go)\/?$/.test(sameSiteUrl(link.getAttribute('href'))?.pathname || ''));
    }
    if (names.size > 1 || (names.size && signedOut)) return reply('ambiguous');
    if (names.size === 1) return reply('signed-in', names.values().next().value);
    return reply(signedOut ? 'signed-out' : 'unknown');
  } catch { return reply(); }
}
