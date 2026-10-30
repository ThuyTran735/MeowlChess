# MeowlChess privacy notice

MeowlChess is an independent browser extension for local analysis of completed chess games. It is not affiliated with Chess.com or Lichess. This notice describes version 1.2.0.

## Game data

For Chess.com or Lichess retrieval, you enter a public username; Lichess also accepts a completed-game link. The selected site's public API receives that username or game ID directly. Returned data can include player names, ratings, results, dates, game URLs, and moves.

You can also choose or paste a PGN exported from another website. Imported files are read locally and are not uploaded. MeowlChess does not contact an arbitrary website named in a PGN. A completed review retains the game's PGN locally, including its headers and comments; only line endings, a leading byte-order mark, and surrounding whitespace are normalized.

## Local storage and processing

The extension saves website selection, remembered website inputs, engine choice, thinking time, line count, selective recheck setting, board orientation preference, arrow mode, badge/coordinate visibility, and playback speed in `chrome.storage.local`. These preferences are not synced to a MeowlChess account or sent to an analysis service.

Successful full reviews are automatically saved in the extension's **local IndexedDB**. Each record includes the PGN, player/source information, evaluations and engine continuations, move classifications, summary scores, opening metadata, engine settings and analysis version, saved timestamps, and bookmarked positions. Re-reviewing the same game replaces its saved analysis and retains its bookmarks. The Practice list is derived from mistakes and bookmarks in these saved records.

Saved reviews persist after the tab closes. The library is separate for each browser profile; MeowlChess does not sync it between browsers, devices, or accounts. It is capped at **100 reviews**, **40 MiB** of serialized review data in total, and **4 MiB** per record. MeowlChess does not automatically evict old reviews or bookmarks. If its limits or the browser's available storage prevent a save, it reports the failure and keeps the current review open.

Fetched games that have not been reviewed, temporary analysis variations, retry attempts and feedback, and extra position searches remain in the open tab's memory. They are not added to saved records. Returning to the review closes the current variation or retry. Closing the tab discards its remaining in-memory data and stops its active engines. This does not delete an already saved full review.

Stockfish, Lozza, chess.js, opening data, piece images, and icons are bundled. There are no runtime code, model, opening-data, font, or artwork downloads. Game review, selective rechecks, opening recognition, practice grading, and continuation explanations all run on your device.

## Network requests

The installed extension requests public archive data from `api.chess.com` and finished-game exports from `lichess.org/api/games/user/` or `lichess.org/game/export/`. These services receive normal connection information, including your IP address and request headers. Their handling is governed by [Chess.com's privacy policy](https://www.chess.com/legal/privacy) and [Lichess's privacy policy](https://lichess.org/privacy).

Opening an original game, documentation, or policy link makes a normal browser navigation to that site. MeowlChess itself has no developer-operated servers, analytics, advertising, telemetry, or paid analysis APIs. Saved PGNs, reviews, bookmarks, variations, and practice answers are not uploaded by MeowlChess.

## Permissions

- `storage`: local preferences. Saved reviews also use the browser's built-in IndexedDB storage for the extension.
- `https://api.chess.com/*`: public Chess.com game archives.
- `https://lichess.org/api/games/user/*` and `https://lichess.org/game/export/*`: Lichess public game exports.

There are no content scripts or requests for account credentials, private messages, browsing history, or live game-page access. Use only finished games; imported PGN results cannot be independently verified against their original site.

## Control and deletion

- **Delete a saved game:** use its **×** button under Saved reviews. This removes the stored PGN, analysis, and associated bookmarks. If that game is still open, it remains in memory until you close or replace it; reviewing it again will save it again.
- **Remove one bookmark:** open its position and click **Bookmarked** to toggle it off.
- **Update preferences:** change Settings or enter a replacement website username or game link and load games.
- **Remove all local extension data:** uninstall MeowlChess from that browser profile. This removes its local preferences and saved library. Closing or reloading a review tab does not delete saved reviews; reloading the unpacked extension is an update step, not a deletion step.

Deleting local data does not delete public games from Chess.com or Lichess, or remove the original PGN files from your computer. MeowlChess has no server copy from which to restore deleted reviews. Browser profile removal or browser-managed storage loss can also remove local data; MeowlChess's no-eviction rule applies to its own library management. See Chrome's documentation on [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage) and [web storage in extensions](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

Modified versions may behave differently.
