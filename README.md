# MeowlChess

<img src="extension/icons/logo.png" alt="MeowlChess crowned cat and owl mascot on a green-and-cream chessboard" width="180">

Free local reviews of completed chess games, in Brave, Chrome, and Edge. Load games from **Chess.com or Lichess**, or import completed games from PGN files exported by other websites. Stockfish and Lozza run on your device; no subscription, paid analysis service, or chess-site login is required.

**Version 1.3.0.** A simpler review screen, multi-game PGN imports, and a visual promotion chooser. Completed and saved reviews open at move 0 on Summary. Retry mistakes without hints, explore legal variations, and keep reviews and bookmarks in your local library. MeowlChess uses its own cat/owl logo and is independent of Chess.com and Lichess.

## Install or update

1. Extract the project ZIP and keep the folder on your computer.
2. Open `brave://extensions`, `chrome://extensions`, or `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the project's `extension/` folder. It contains `manifest.json`.
4. Pin MeowlChess, then click its toolbar icon to open the review page.

For this working copy, load `C:\Users\thuyv\Downloads\meowlchess\extension`. After updates, click **Reload** on its extension card and reopen the review tab. Make sure the installed extension points to the same folder you edited. This is an unpacked extension, not a Chrome Web Store or Edge Add-ons listing.

## Choose a game

Open **Games** to find, import, or reopen a game. This window closes when you choose one, leaving the board and review in view.

- **Chess.com:** select Chess.com and enter a username. MeowlChess reads its public completed-game archives. Very recent games may take time to appear because of API caching.
- **Lichess:** select Lichess and enter a username or a finished game's URL. The latest 20 completed standard games are requested; unfinished games and variants are excluded.
- **Other websites:** open **Import PGN**, then choose or drop `.pgn` / `.txt` files, drop PGN text, or paste it. A file can contain multiple games. Choose a completed game from the resulting list, then start its review when ready. Finished games with a custom standard-chess starting position are supported.
- **ChessTempo, ICC / Chessclub.com, and Tornelo:** import their PGN exports. The import window includes export guidance; these sites do not have automatic account retrieval in MeowlChess.
- **Sample:** use the four-move demo to try the controls without a network request.
- **Saved reviews:** reopen a previously analyzed game without fetching or analyzing it again. Search by player or recognized opening.

Only standard chess and completed games are supported. A PGN must have a final `1-0`, `0-1`, or `1/2-1/2` result. An import can contain up to **100 games** and **5 MiB** of text in total, with each game limited to 250 KB and 1,000 plies. Invalid or unfinished games are listed as skipped while valid games remain available. Importing does not start engine analysis or save every game automatically. Importing a PGN does not independently verify its result against its original website; import only finished games. The extension does not read live boards or make moves.

## Review engines and speeds

| Engine | Use it for | Engine lines |
| --- | --- | --- |
| Stockfish 18 lite | Stronger analysis and comparisons between alternatives | Up to 3 |
| Lozza 9 | A smaller JavaScript engine with no WebAssembly startup | Best move only |

Both engines are bundled and work offline after a game is loaded. Switching engines does not download a model. Lozza is a different, weaker engine; it is not a faster version of Stockfish. Actual startup and search time depend on your computer.

**Recheck key mistakes is enabled by default.** The first pass uses the selected time, capped at 0.15 seconds per position. The engine then revisits the most important estimated losses or mate changes, searching both sides of each selected move before assigning its final label. Rechecks use the selected time with a minimum of 0.5 seconds and a maximum of 3 seconds per position. The pass is bounded to at most eight moves, and fewer in short games; shared positions are searched once. Progress separates the first pass from these rechecks. You can cancel either stage.

Turn **Recheck key mistakes** off to spend the full selected time on every nonterminal position:

| Speed | Time per position with rechecks off | First-pass time with rechecks on |
| --- | --- | --- |
| Fast | 0.05 seconds | 0.05 seconds |
| Quick | 0.15 seconds | 0.15 seconds |
| Standard | 0.5 seconds | 0.15 seconds |
| Deep | 1.5 seconds | 0.15 seconds |
| Thorough | 3 seconds | 0.15 seconds |

Fast selects one line automatically. For 100 nonterminal positions, its first pass has about five seconds of engine time, plus startup and processing; enabled rechecks add time. Selective rechecks cannot catch every mistake, and short searches can miss tactics. More lines divide the available search time among alternatives and can reduce depth.

Open **Settings** to choose the engine, speed, and display options. Click **Review game**. When it finishes, the board returns to **move 0** and **Summary** opens. Use **Moves** to explore the game, then navigate with the move list, arrow keys, evaluation graph, key-moment buttons, or **Play**. **Summary** shows both players' study scores, move counts, opening, and evaluation graph. **Engine lines** stays collapsed under Moves until you open it. **Quick look** searches the displayed position for 0.15 seconds; **Analyze deeper** spends at least 1.5 seconds on it. Position searches update the displayed evaluation and engine lines. Use **Review again** to recalculate the full game's labels and scores.

## Study a move

- **Try again:** return to the position before a reviewed move and play your own attempt. Engine lines, arrows, move ratings, and the evaluation are hidden while you solve. The engine checks your move; a sound alternative can count even when it differs from its first choice. You can retry, reveal the suggested continuation, move to the next mistake, or return to the review. Inconclusive searches are reported as uncertain.
- **Explore a variation:** click an engine line, click a piece and its destination, or drag a piece. Only legal moves are accepted, and promotions open a piece chooser for queen, rook, bishop, or knight. This includes captures and either color; Cancel or Escape leaves the position unchanged. Step through the line, go back, and try another continuation. **Return to game** restores the original review position; variations do not change the completed game's moves.
- **Show why:** follow a legal continuation associated with the displayed move. MeowlChess checks for concrete evidence such as checkmate, a verified fork, or a lasting material loss. If it cannot verify a simple consequence, it shows the continuation without inventing a tactical explanation. These are observations from a limited engine search, not a human coach's assessment.

In the Moves tab, the board shows the best engine arrow by default. Summary keeps the board free of engine arrows. Hover over or keyboard-focus another engine line to preview its arrow, or select **All engine moves** in Settings. Green is the best move, blue the second, and orange the third. Knight arrows turn at a right angle. Arrows always describe the **displayed position and side to move**; terminal positions have no continuation.

**Face my side** uses the entered or remembered website username to put your pieces at the bottom when it recognizes your side. You can turn it off or flip the board manually. Retry mode faces the player whose move is being retried. Display choices and playback speed are remembered locally. Motion respects the browser's reduced-motion preference, and the game picker closes after you choose a game.

## Saved reviews and practice

Saved reviews reopen at move 0 on Summary; opening a bookmark or practice item goes straight to its position. Successful full reviews are saved automatically in the extension's local IndexedDB library. A saved record contains the game's PGN, player/source information, evaluations and lines, move ratings, scores, opening information, and the engine settings used. It survives closing the tab. Re-reviewing the same game replaces its analysis while keeping its bookmarks. Older analysis is marked so you can choose to review it again.

Use **Bookmark** to save the displayed position. The **Practice** view collects mistakes to retry and bookmarked positions from saved games. Opening a saved mistake starts a fresh attempt with hints hidden. Individual practice attempts, temporary variations, and extra position searches are not saved as part of the full review.

The library holds at most **100 reviews**, **40 MiB** of serialized review data in total, and **4 MiB** per review. MeowlChess never removes old or bookmarked games automatically to make room. If a limit or browser storage error prevents saving, the current review stays open and an error explains what happened. Delete a saved review with its **×** button to remove that game's stored PGN, analysis, and bookmarks. Deletion does not close the current in-memory game; reviewing it again saves another copy. Uninstalling the extension removes its local extension data. Libraries are separate for each browser profile and are not synced between browsers or devices.

## Openings and move ratings

Opening recognition runs locally using **3,865 lines** from the pinned [Lichess opening-name dataset](https://github.com/lichess-org/chess-openings/tree/712a58be746c143f4ab935b68acc50f4bac813eb), released under CC0. It matches the actual move sequence from the standard starting position and reports the deepest named opening and the first departure from a recorded line. Custom starting positions are not matched. The reference is finite: unrecognized continuations and different move orders are not necessarily mistakes.

The dataset also names traps and unsound lines. A move receives **Book** only if it matches a recorded line and the engine otherwise rates it Best, Excellent, or Good. Tactical errors, Brilliant/Great classifications, and checkmate keep their own labels. Recognizing an opening name does not establish that every move in it is sound.

Evaluations, labels, and study scores are MeowlChess estimates. They do not reproduce Chess.com's proprietary accuracy or classification algorithms. Results can change with another engine or longer search.

| Label | MeowlChess meaning |
| --- | --- |
| Brilliant | The preferred piece sacrifice, with compensation and lasting material investment in the engine continuation. |
| Great | The preferred response preserving a substantial opportunity after an opponent's error. |
| Best | The engine's preferred move. |
| Excellent | Almost no estimated loss. |
| Good | Little estimated loss. |
| Book | A recorded opening move without a detected error at the chosen search time. |
| Inaccuracy | A small reduction in estimated chances. |
| Mistake | A significant reduction in estimated chances. |
| Blunder | A large reduction in estimated chances. |

Brilliant and Great require depth 12 or greater in relevant positions. Brilliant also requires at least four legal continuation plies, an accepted non-pawn sacrifice with two pawn-equivalents of lasting investment, near-equal or better prospects, and no meaningful loss. Ordinary exchanges and already decisive wins are excluded. Great requires an opportunity of at least 12 expected-score percentage points, at most one point lost, a nonlosing position, and a legal alternative; automatic same-square recaptures are excluded. These conservative heuristics can miss good moves. Miss artwork is included, but there is no separate missed-win classification.

Study scores average `100 × exp(-5 × expected-score loss)` across a player's **non-Book moves**, with engine-preferred moves scoring 100. Book moves still count in the move totals but are excluded from this average. A player with no scored moves shows **—**. The graph and displayed evaluations use White's perspective; move counts are separated by player.

## Privacy and fair play

Use MeowlChess only after a game is finished, including correspondence and Daily games. The extension uses public completed-game exports; it has no content scripts, live-board access, account credentials, analytics, advertising, or remote analysis server.

Preferences use `chrome.storage.local`; saved PGNs, reviews, and bookmarks use the extension's local IndexedDB. Host access is limited to Chess.com's API and Lichess's game-export endpoints. Nothing from the saved library is uploaded by MeowlChess. See [PRIVACY.md](PRIVACY.md) for retention and deletion details.

Official API documentation: [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api), [Lichess user games](https://lichess.org/api#tag/Games/operation/apiGamesUser), [Lichess game export](https://lichess.org/api#tag/Games/operation/gamePgn). Follow the original site's fair-play rules, including [Chess.com Fair Play](https://www.chess.com/legal/fair-play) and [Lichess fair play](https://lichess.org/page/fair-play).

## Development and packaging

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:browser
npm run test:extension
npm run test:features
npm run test:imports
npm run package
```

The build refreshes the pinned chess.js and Stockfish assets. Lozza, artwork, and the generated opening data are checked in. To regenerate opening data from its bundled, pinned TSV sources, run `node scripts/build-openings.mjs`. Packaging creates `dist/meowlchess.zip`, containing the ready-to-load extension, project source, tests, notices, opening sources, and Stockfish's corresponding source and evaluation network. It excludes dependencies, generated test results, and Git data.

Browser checks use Playwright. Set `CHROMIUM_PATH` to a compatible Brave/Chromium executable, or install Playwright's Chromium with `npx playwright-core install chromium`. `test:imports` covers multi-game imports, file/text drops, promotion choices, and the review landing view. `test:features` exercises the study and saved-library flows in a disposable extension profile. `BROWSER_OFFLINE_ASSETS=1` makes the page tests serve local assets directly. Extension tests do not change your usual browser installation. `LIVE_API_USERNAME` optionally enables a real Chess.com lookup. `LIVE_LICHESS_USERNAME` checks a live Lichess archive and game URL; pair it with `HEADED_EXT_TEST=1` to use a normal minimized browser, since Lichess rejects headless browser user-agents. Chrome compatibility has not been checked directly.

Source repository: [ThuyTran735/MeowlChess](https://github.com/ThuyTran735/MeowlChess).

## Licenses and artwork

MeowlChess code is GPL-3.0-or-later. Stockfish is GPL-licensed; chess.js is BSD-2-Clause; Lozza has its own permissive license; the Lichess opening dataset is CC0. Keep the included notices and engine source materials with redistributions.

The Neo piece images and move-icon outlines are sourced from Chess.com to match the supplied visual references. They are not original MeowlChess artwork and are not covered by MeowlChess's code license. Their inclusion does not imply affiliation or a license grant from Chess.com. The cat/owl project logo is separate MeowlChess branding. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for sources and license details.
