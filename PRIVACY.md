# MeowlChess privacy notice

MeowlChess is an independent browser extension for local analysis of completed chess games. It is not affiliated with Chess.com or Lichess. This notice describes the extension distributed with this document.

## Game data

For Chess.com or Lichess retrieval, you enter a public username; Lichess also accepts a completed-game link. The selected site's public API receives that username or game ID directly. Returned data can include player names, ratings, results, dates, game URLs, and moves.

You can also choose, drag and drop, or paste PGNs exported from other websites, including files containing several games. The import picker remains in tab memory; a game is saved only after its full review completes. Imported files are read locally and are not uploaded. MeowlChess does not contact an arbitrary website named in a PGN. A completed review retains the game's PGN locally, including its headers and comments; only line endings, a leading byte-order mark, and surrounding whitespace are normalized.

## Local storage and processing

The extension saves website selection, remembered website inputs, up to 10 saved username shortcuts per website, engine choice, thinking time, line count, selective recheck setting, board orientation preference, arrow mode, badge/coordinate visibility, playback speed, the move-sound preference, the sharing privacy preference, separate **Never show again** choices for the tutorial and GitHub support popup, the preferred review-board size, the panel position and size for each site, the completion-alert preference, and separate on-site review toggles and usernames in `chrome.storage.local`. A browser preview without extension storage keeps the tutorial, support-popup, and sharing privacy choices in localStorage instead. These preferences are not synced to a MeowlChess account or sent to an analysis service.

Successful full reviews are automatically saved in the extension's **local IndexedDB**. Each record includes the PGN, player/source information, evaluations and engine continuations, move classifications, summary scores, opening metadata, engine settings and analysis version, recorded local analysis duration for new reviews, saved timestamps, and bookmarked positions. Re-reviewing the same game replaces its saved analysis and retains its bookmarks. The Practice list is derived from mistakes and bookmarks in these saved records.

Saved reviews persist after the tab closes. The library is separate for each browser profile; MeowlChess does not sync it between browsers, devices, or accounts. It is capped at **100 reviews**, **40 MiB** of serialized review data in total, and **4 MiB** per record. MeowlChess does not automatically evict old reviews or bookmarks. If its limits or the browser's available storage prevent a save, it reports the failure and keeps the current review open.

Completed-game API responses, temporary review handles, and per-tab review selections are kept in the extension's browser session storage, capped at 700 KB and cleared when the browser restarts. This can include completed-game PGNs, player information, the selected review's identity, the current page route, and whether its panel is open, collapsed, or closed. It does not include private Lichess player keys or a history of page visits; the route records only the current page context. This state restores the current review across same-site navigation and extension background restarts. The temporary data is not uploaded or added to the saved library unless a review finishes. Games fetched in the full review page that have not been reviewed, temporary analysis variations, retry attempts and feedback, and extra position searches remain in the open tab's memory. They are not added to saved records. Returning to the review closes the current variation or retry. Closing the tab discards its remaining in-memory data and stops its active engines. This does not delete an already saved full review.

Optional move sounds are generated locally using browser audio, without downloading audio files or recording sound. Stockfish, Lozza, chess.js, opening data, piece images, and icons are bundled. There are no runtime code, model, opening-data, font, or artwork downloads. Game review, selective rechecks, opening recognition, practice grading, and continuation explanations all run on your device.

## Local coach

Evil Meowl unlock progress is stored locally in IndexedDB. It keeps at most 10 normalized game identifiers for successfully saved completed reviews, so reviewing the same game twice does not add progress. Existing valid saved reviews contribute to the milestone. This small progress record survives deletion of individual saved reviews and resets when the extension's data is cleared. It is not uploaded, and no GitHub account, star check, or authentication is involved.

The Coach tab answers supported questions using built-in rules and the selected completed review. It does not use a remote AI service, download a language model, or start additional engine searches. Questions, responses, and conversation context remain in the open tab's memory, limited to the latest 12 question-and-answer pairs. They are not written to the saved-game library or uploaded. Switching games, re-reviewing, reloading or closing the tab, or choosing **Clear chat** discards the conversation.

Optional coach meows use short cat recordings bundled with the extension and played locally using browser audio. They are off by default and require no microphone access, remote audio downloads, or speech service. Coach reactions animate the bundled drawings on your device and respect reduced-motion preferences. Sound variations are selected locally; no sound is recorded from your device or uploaded.

Automatic move comments use the same saved review and stay in the open tab; they do not add entries to the conversation or start new analysis.

The selected coach personality, side, automatic-commentary, animation, meow-sound, and volume preferences are stored in `chrome.storage.local` under `coachPreferences`; browser previews without extension storage keep these choices only in the open tab. These choices are separate from the review settings and do not change engine results. **Ask coach** on the game-page panel opens that game's saved review in an extension tab. It does not send chat content to the chess website.

## Completion alerts and summary images

Completion alerts are off by default and require optional notification permission. When enabled, a newly completed and saved review may display a desktop notification while its tab is hidden. It contains the player names and a prompt to open the saved review, without moves or engine lines. Clicking it opens that game in MeowlChess. Up to 100 saved-review identifiers and timestamps are retained in browser session storage to avoid duplicate alerts; this history is cleared when the browser session ends. These alerts do not contact a MeowlChess server.

Summary images are rendered locally from the selected review and bundled artwork. The preview includes player names, game details, scores, estimated game ratings, phase performance, and move counts. Enabling **Hide player names** replaces usernames with White and Black in the preview and exported PNG, and removes usernames from the download filename. This option does not remove names from your locally saved game. Choosing **Copy image** writes the PNG to your clipboard; choosing **Save image** downloads a PNG file. Neither action uploads the image or shares it with another person. You choose where to paste or send it.

## Network requests

The installed extension requests public archive data from `api.chess.com` and finished-game exports from `lichess.org/api/games/user/` or `lichess.org/game/export/`. These services receive normal connection information, including your IP address and request headers. Their handling is governed by [Chess.com's privacy policy](https://www.chess.com/legal/privacy) and [Lichess's privacy policy](https://lichess.org/privacy).

The support popup does not contact GitHub automatically or check whether you have starred the project. **Star on GitHub** opens the public repository in a new tab, where starring is your choice.

### Optional update checks

The **Updates & backups** page can request the latest public release metadata from `api.github.com/repos/ThuyTran735/MeowlChess/releases/latest`. **Check now** starts a manual request after optional API permission is granted. **Check for updates automatically** is off by default; enabling it allows a check when you open MeowlChess, at most once a day. Failed or rate-limited requests are delayed before another attempt. GitHub receives ordinary connection information, including your IP address, but no game PGNs, reviews, player names, coach questions, or backup files. Requests omit account cookies and authentication tokens. GitHub's handling is described in its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The extension keeps the update preference, last-check information, cached release details, and a dismissed-release choice locally. Turning automatic checks off stops future automatic checks. Download and release-note links open GitHub in your browser when selected. An update check does not install code, alter saved reviews, or reload a game page. Browser-managed store updates, if the extension is installed from a store in the future, use the browser's own update service.

### Backup and restore

Choosing to save a backup downloads a JSON file to your computer. It contains saved review records and bookmarks, coach unlock progress, and supported preferences, including remembered usernames and on-site review account entries. The file contains personal game details and is not encrypted. It stays local unless you choose to share it or save it in a folder synced by another service.

Restoring reads the file locally and shows a summary before you confirm. Analysis already present is retained; missing bookmarks are added while existing bookmark notes are kept. Preferences are restored only if selected, and remembered accounts are merged. Browser permission grants, cached release metadata, and temporary review/session data are not included. A new installation may require you to grant optional site, notification, or GitHub API permissions again. Neither export nor restore uploads the backup or contacts a chess website. Coach chat conversations and unfinished reviews are not part of a backup.

Opening an original game, the GitHub repository, documentation, or policy link makes a normal browser navigation to that site. MeowlChess itself has no developer-operated servers, analytics, advertising, telemetry, or paid analysis APIs. Saved PGNs, reviews, bookmarks, variations, and practice answers are not uploaded by MeowlChess.

## Permissions

- Optional `notifications`: requested only when you enable completion alerts. Used for newly saved reviews that finish while you are away from their tab.
- Optional `https://api.github.com/*`: requested when you choose to check for updates or enable automatic update checks. Used only to retrieve public MeowlChess release metadata.
- `storage`: local preferences. Saved reviews also use the browser's built-in IndexedDB storage for the extension.
- `https://api.chess.com/*`: public Chess.com game archives.
- `https://lichess.org/api/games/user/*` and `https://lichess.org/game/export/*`: Lichess public game exports. Chrome host permissions apply to the origin, even when a manifest entry includes a path.
- Optional `scripting`, `https://www.chess.com/*`, `https://chess.com/*`, and `https://lichess.org/*`: requested when you enable the corresponding on-site review setting. These allow the extension to show its dropdown on that site.

On-site reviews are off by default. With your setting and browser permission, an isolated content script runs on the selected site. It checks the current URL and visible game-end notices, then displays a dropdown. For finished Chess.com bot games, or an exact completed multiplayer game whose public archive entry is delayed, it can open the site's normal **Share → PGN** dialog and read the completed PGN locally. It closes only the export dialog it opened. You may also explicitly choose a PGN file or paste one into the panel. MeowlChess does not use private game APIs or read account cookies. It does not read live board positions, clocks, account credentials, private messages, or browsing history. Lichess private player suffixes are stripped before game URLs are retained or matched. Public API requests omit login credentials.

Archive reviews require a matching, legally replayable completed-game record. A completed Chess.com page export can also start a review when it links to the exact current game and names the configured player. Page and bot exports must contain legal standard-chess moves and a matching final result in the header and movetext; their result comes from the export rather than an independent public-archive confirmation. These PGNs and temporary review handles have the same session-storage limits as archive games; completed reviews use the same local saved library. Page exports retain the original game link and use the same local saved-review library. The engine runs inside an extension-origin frame. That frame loads and saves completed reviews through the extension background service worker, which verifies the page review and writes to the same local IndexedDB library used by the full review page. The website receives no PGN, analysis, or engine lines through messaging. The frame sends its height, close/retry requests, and pointer coordinates while you drag the panel to the page helper. Drag coordinates are used only to move the panel; only its final position and chosen size are retained in local preferences. The dropdown replaces its progress indicator with a completed summary. Successful automatic reviews use the same local library described above and reuse a current saved review when available.

Turning a site off removes its panel and reopen button and stops future injection. Moving between views on the same site without a full page load keeps analysis of the already-completed game running. Closing the panel or tab, loading a new document, leaving the site, or disabling it stops the active engine. Hiding the tab also stops it by default. With completion alerts enabled, an already-accepted completed-game review may finish while hidden; no new archive lookup or page export starts there. Turning alerts off while the page is hidden stops that background review. No partial review is saved. Use only finished games; imported PGN results cannot be independently verified against their original site.

## Control and deletion

- **Delete a saved game:** use its **×** button under Saved reviews. This removes the stored PGN, analysis, and associated bookmarks. If that game is still open, it remains in memory until you close or replace it; reviewing it again will save it again.
- **Remove one bookmark:** open its position and click **Bookmarked** to toggle it off.
- **Turn off on-site reviews:** uncheck the site in Settings → On-site reviews. Existing saved reviews remain in your local library. You can also revoke the optional site access through the browser's extension settings.
- **Turn off completion alerts:** uncheck the setting or revoke the optional notification permission. Existing saved reviews remain available.
- **Update preferences:** change Settings or enter a replacement website username or game link and load games.
- **Turn off automatic update checks:** disable the option in Updates & backups, or revoke the optional GitHub API access in your browser's extension settings.
- **Keep a portable copy:** use Updates & backups to export or restore your study data. Delete an exported backup through your file manager when you no longer need it; removing the extension does not delete downloaded backup files.
- **Remove all local extension data:** uninstall MeowlChess from that browser profile. This removes its local preferences and saved library. Closing or reloading a review tab does not delete saved reviews; reloading the unpacked extension is an update step, not a deletion step.

Deleting local data does not delete public games from Chess.com or Lichess, or remove the original PGN files or exported backups from your computer. MeowlChess has no server copy from which to restore deleted reviews; recovery requires a backup you previously exported. Browser profile removal or browser-managed storage loss can also remove local data; MeowlChess's no-eviction rule applies to its own library management. See Chrome's documentation on [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage) and [web storage in extensions](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

Modified versions may behave differently.
