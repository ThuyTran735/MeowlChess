# MeowlChess privacy notice

MeowlChess is an independent browser extension for local analysis of completed chess games. It is not affiliated with Chess.com or Lichess. This notice describes version 1.5.1.

## Game data

For Chess.com or Lichess retrieval, you enter a public username; Lichess also accepts a completed-game link. The selected site's public API receives that username or game ID directly. Returned data can include player names, ratings, results, dates, game URLs, and moves.

You can also choose, drag and drop, or paste PGNs exported from other websites, including files containing several games. The import picker remains in tab memory; a game is saved only after its full review completes. Imported files are read locally and are not uploaded. MeowlChess does not contact an arbitrary website named in a PGN. A completed review retains the game's PGN locally, including its headers and comments; only line endings, a leading byte-order mark, and surrounding whitespace are normalized.

## Local storage and processing

The extension saves website selection, remembered website inputs, engine choice, thinking time, line count, selective recheck setting, board orientation preference, arrow mode, badge/coordinate visibility, playback speed, the tutorial’s **Never show again** choice, the panel position and size for each site, and separate on-site review toggles and usernames in `chrome.storage.local`. A browser preview without extension storage keeps the tutorial choice in localStorage instead. These preferences are not synced to a MeowlChess account or sent to an analysis service.

Successful full reviews are automatically saved in the extension's **local IndexedDB**. Each record includes the PGN, player/source information, evaluations and engine continuations, move classifications, summary scores, opening metadata, engine settings and analysis version, saved timestamps, and bookmarked positions. Re-reviewing the same game replaces its saved analysis and retains its bookmarks. The Practice list is derived from mistakes and bookmarks in these saved records.

Saved reviews persist after the tab closes. The library is separate for each browser profile; MeowlChess does not sync it between browsers, devices, or accounts. It is capped at **100 reviews**, **40 MiB** of serialized review data in total, and **4 MiB** per record. MeowlChess does not automatically evict old reviews or bookmarks. If its limits or the browser's available storage prevent a save, it reports the failure and keeps the current review open.

Completed-game API responses and temporary handles for optional page reviews are kept in the extension's browser session storage, capped at 700 KB and cleared when the browser restarts. This can include completed-game PGNs and player information, but not private Lichess player keys. It lets an open summary survive an extension background restart. This temporary data is not uploaded or added to the saved library unless a review finishes. Games fetched in the full review page that have not been reviewed, temporary analysis variations, retry attempts and feedback, and extra position searches remain in the open tab's memory. They are not added to saved records. Returning to the review closes the current variation or retry. Closing the tab discards its remaining in-memory data and stops its active engines. This does not delete an already saved full review.

Stockfish, Lozza, chess.js, opening data, piece images, and icons are bundled. There are no runtime code, model, opening-data, font, or artwork downloads. Game review, selective rechecks, opening recognition, practice grading, and continuation explanations all run on your device.

## Network requests

The installed extension requests public archive data from `api.chess.com` and finished-game exports from `lichess.org/api/games/user/` or `lichess.org/game/export/`. These services receive normal connection information, including your IP address and request headers. Their handling is governed by [Chess.com's privacy policy](https://www.chess.com/legal/privacy) and [Lichess's privacy policy](https://lichess.org/privacy).

Opening an original game, documentation, or policy link makes a normal browser navigation to that site. MeowlChess itself has no developer-operated servers, analytics, advertising, telemetry, or paid analysis APIs. Saved PGNs, reviews, bookmarks, variations, and practice answers are not uploaded by MeowlChess.

## Permissions

- `storage`: local preferences. Saved reviews also use the browser's built-in IndexedDB storage for the extension.
- `https://api.chess.com/*`: public Chess.com game archives.
- `https://lichess.org/api/games/user/*` and `https://lichess.org/game/export/*`: Lichess public game exports. Chrome host permissions apply to the origin, even when a manifest entry includes a path.
- Optional `scripting`, `https://www.chess.com/*`, `https://chess.com/*`, and `https://lichess.org/*`: requested when you enable the corresponding on-site review setting. These allow the extension to show its dropdown on that site.

On-site reviews are off by default. With your setting and browser permission, an isolated content script runs on the selected site. It checks the current URL and visible game-end notices, then displays a dropdown. For finished Chess.com bot games, it can open the site's normal PGN export dialog and read the completed PGN from that dialog. You may also explicitly choose a PGN file or paste one into the panel. These exports are read locally; no private bot-game API or account cookie is used. It does not read live board positions, clocks, account credentials, private messages, or browsing history. Lichess private player suffixes are stripped before game URLs are retained or matched. Public API requests omit login credentials.

For public archive games, only a matching, legally replayable completed-game archive entry can start analysis. Bot reviews use a separate PGN-import path: the export must contain legal standard-chess moves and a matching final result in its header and movetext. The export result cannot be independently confirmed through the public API. Bot PGNs and temporary review handles have the same session-storage limits as archive games; completed reviews use the same local saved library. The engine runs inside an extension-origin frame. That frame loads and saves completed reviews through the extension background service worker, which verifies the page review and writes to the same local IndexedDB library used by the full review page. The website receives no PGN, analysis, or engine lines through messaging. The frame sends its height, close requests, and pointer coordinates while you drag the panel to the page helper. Drag coordinates are used only to move the panel; only its final position and chosen size are retained in local preferences. The dropdown replaces its progress indicator with a completed summary. Successful automatic reviews use the same local library described above and reuse a current saved review when available.

Turning a site off removes its dropdown and stops future injection. Closing the panel, hiding or leaving its page, or disabling it stops its active engine. No partial review is saved. Use only finished games; imported PGN results cannot be independently verified against their original site.

## Control and deletion

- **Delete a saved game:** use its **×** button under Saved reviews. This removes the stored PGN, analysis, and associated bookmarks. If that game is still open, it remains in memory until you close or replace it; reviewing it again will save it again.
- **Remove one bookmark:** open its position and click **Bookmarked** to toggle it off.
- **Turn off on-site reviews:** uncheck the site in Settings → On-site reviews. Existing saved reviews remain in your local library. You can also revoke the optional site access through the browser's extension settings.
- **Update preferences:** change Settings or enter a replacement website username or game link and load games.
- **Remove all local extension data:** uninstall MeowlChess from that browser profile. This removes its local preferences and saved library. Closing or reloading a review tab does not delete saved reviews; reloading the unpacked extension is an update step, not a deletion step.

Deleting local data does not delete public games from Chess.com or Lichess, or remove the original PGN files from your computer. MeowlChess has no server copy from which to restore deleted reviews. Browser profile removal or browser-managed storage loss can also remove local data; MeowlChess's no-eviction rule applies to its own library management. See Chrome's documentation on [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage) and [web storage in extensions](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

Modified versions may behave differently.
