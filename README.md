# MeowlChess

<img src="extension/icons/logo.png" alt="MeowlChess cat and owl mascot on a chessboard" width="180">

A free Brave, Chrome, and Edge extension for reviewing completed Chess.com games. MeowlChess opens a separate review tab and runs Stockfish locally on your computer. No subscription, paid analysis API, or Chess.com login is required.

**Version 1.0.0 — first release.** A focused dark interface, green-and-cream board, original vector pieces, move badges on the board and move list, estimated study scores, an interactive evaluation graph, and key-moment navigation. The cat/owl logo is MeowlChess's own branding.

**Independent project. Not affiliated with, endorsed by, or approved by Chess.com.** This is a locally installable extension, not a Chrome Web Store or Edge Add-ons release.

## Install

1. Extract the packaged extension ZIP into a folder. Keep that folder on your computer.
2. Open `brave://extensions` in Brave, `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the `extension/` folder inside the extracted download (it contains `manifest.json`).
4. Pin MeowlChess from your browser's extensions menu if you want easy access.

The download is ready to load; no build step is needed. To change the source, use the commands below.

## Review a finished game

1. Finish your game on Chess.com, then click the MeowlChess toolbar icon.
2. Enter your Chess.com username and fetch your recent games.
3. Choose a completed game, select quick or deeper analysis, and start the review.
4. Step through the board and move list to inspect evaluations and suggested alternatives. Use the left/right arrow keys, click the evaluation graph, or jump between key moments. You can flip the board or cancel an analysis in progress.

Use the demo to try the review without fetching a username's games. Only standard chess is supported. The extension does not accept arbitrary FEN positions or pasted PGNs, read Chess.com pages, or automatically detect the end of a game.

Newly completed games may take time to appear. Chess.com's API documentation describes cache refresh windows of up to 12 or 24 hours, depending on the endpoint and guidance; this extension cannot force a fresh archive. Try again later if your latest game is missing.

## What the review means

Stockfish 18's lite, single-threaded build evaluates positions inside a browser worker. Its code and WebAssembly are bundled with the extension; the installed extension does not download executable code from a CDN. Game retrieval needs an internet connection; the analysis itself runs locally.

Evaluations, move classifications, and any summary scores are estimates based on limited engine searches. They are not Chess.com's proprietary accuracy scores or classifications. Short searches and the lite engine can miss tactics, change their assessment with more thinking time, or recommend a move that is difficult for a human to understand. Deeper analysis takes longer and uses more CPU and battery. This is an engine review, not an automated human coach.

### Move labels

| Badge | Label | MeowlChess meaning |
| --- | --- | --- |
| Teal `!!` | Brilliant | The engine's preferred piece sacrifice, with compensation and a material investment that remains at the end of its continuation. |
| Blue `!` | Great | The engine's preferred response preserving a substantial opportunity created by the opponent's previous move. |
| Green star | Best | The engine's preferred move. |
| Green check | Excellent / Good | Little estimated loss compared with the previous position. |
| Yellow `?!` | Inaccuracy | A small reduction in estimated chances. |
| Orange `?` | Mistake | A significant reduction in estimated chances. |
| Red `??` | Blunder | A large reduction in estimated chances. |

Brilliant and Great require engine depth of at least 12 in the relevant positions. Brilliant checks a legal continuation of at least four plies, an accepted non-pawn sacrifice, at least two pawn-equivalents of lasting material investment, near-equal or better prospects, and no meaningful loss. It rejects ordinary exchanges and already decisive winning positions. Great requires an opportunity of at least 12 expected-score percentage points, at most one point lost, a nonlosing position, and a legal alternative; automatic same-square recaptures are excluded. These intentionally narrow heuristics can miss good sacrifices or critical moves. They do not reproduce Chess.com's classification algorithm or claim a move was the only good choice.

The study score averages `100 × exp(-5 × expected-score loss)` across a player's moves, with engine-preferred moves scoring 100. It is a local study aid, not a Chess.com accuracy score. The evaluation graph is from White's perspective and compresses large advantages for readability.

## Fair play and Chess.com terms

Use MeowlChess only for studying finished games. Engine assistance for a game still in progress is prohibited, including analysis of earlier positions from that game. This also applies to ongoing Daily games, not just live games.

MeowlChess retrieves finished games through Chess.com's documented public monthly archives. It does not inject content scripts, access live boards, submit moves, scrape website pages, call undocumented endpoints, or unlock paid Chess.com review features. Its interface and engine are independent of Chess.com's products.

Relevant official sources, checked October 2026:

- [Fair Play Policy](https://www.chess.com/legal/fair-play): prohibits engine or extension assistance during play and automated analysis of games in progress.
- [PubAPI and third-party extension guidance](https://support.chess.com/en/articles/9650547-what-is-the-pubapi-and-how-do-i-use-it): explains permitted public API access, original branding/design, independence from Chess.com, and fair-play requirements. It also distinguishes standalone API clients from extensions operating on Chess.com pages.
- [Published-Data API documentation](https://www.chess.com/news/view/published-data-api): documents completed-game archives, caching, and request limits.
- [User Agreement](https://www.chess.com/legal/user-agreement): contains broader restrictions on unauthorized automation, modifications, and competing products or uses of service content.

The design follows the published guidance, but these documents do not amount to approval of this specific extension. Policies may change, and MeowlChess cannot guarantee Chess.com's interpretation or account decisions. Ask Chess.com for clarification before a public or commercial release if the intended use is uncertain.

## Permissions and privacy

- `storage`: remembers local preferences such as your entered username.
- `https://api.chess.com/*`: fetches public game archive data directly from Chess.com.

There are no content scripts, account credentials, analytics, advertising, or developer-operated analysis servers. See [PRIVACY.md](PRIVACY.md) for details.

## Build and test from source

Use a current Node.js LTS release with npm:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:browser
npm run package
```

The build copies the pinned chess library and Stockfish assets into `extension/`. Load that directory as an unpacked extension. The package command creates `dist/meowlchess.zip` with the ready-to-load `extension/` folder, project source, tests, and corresponding engine source materials. Extract it and select its `extension/` folder with **Load unpacked**.

Browser checks use Playwright. Install its Chromium with `npx playwright-core install chromium`, then run `npm run test:browser`. An optional `CHROMIUM_PATH` selects a compatible Chromium executable. Tests exercise the implementation; they do not certify Chess.com approval, Chrome Web Store review, or compatibility with every browser version.

Validation: 32 unit tests cover completed-game filtering, API URL validation, UCI engine behavior, scoring, conservative Brilliant/Great labels, terminal positions, and cancellation. Brave and Edge browser checks exercised bundled WASM, SVG pieces, badges, graph navigation, flipping, cancellation/retry, responsive layout, and sample archive responses. An isolated Brave profile loaded the real unpacked extension, completed a demo review, retrieved 20 completed games from Chess.com's live API, opened the first game, and saved the username preference locally. The user also confirmed successful installation in their usual Brave profile. Chrome has not been tested directly. Tests used Node 24 and the environment's available Playwright 1.62.1; the project lockfile retains Playwright 1.56.1.

To test the actual extension in a disposable profile, run `npm run test:extension`. Set `CHROMIUM_PATH` to Brave or a Chromium build that supports unpacked-extension flags. Set `LIVE_API_USERNAME` to a public Chess.com username to include real archive retrieval; this optional check needs network access. The test does not install anything into your usual browser profile. For environments blocking loopback connections, `BROWSER_OFFLINE_ASSETS=1 npm run test:browser` fulfills local test-page assets directly while preserving the extension's content security policy.

After rebuilding, click **Reload** on the extension's card in the browser's extensions page and reopen the review tab.

## Upload to GitHub without a terminal

Installing the extension and uploading its source are separate steps. GitHub stores the project; it does not install the extension in your browser. The download already includes everything needed for installation.

1. Extract `meowlchess.zip` on your computer. Open the extracted project folder: it contains `README.md`, `package.json`, and the `extension/` folder.
2. Sign in at [github.com/new](https://github.com/new). Name your repository `meowlchess`. Choose **Private** to keep it to yourself, or **Public** if you want to share it.
3. Leave the options to add a README, `.gitignore`, or license unchecked; the project already includes them. Click **Create repository**.
4. On the empty repository page, click **uploading an existing file**. For an existing repository, use **Add file → Upload files**.
5. Drag the **contents of the extracted project folder** into the upload area, including `extension/`, `scripts/`, `tests/`, `third-party-source/`, and the root files. Upload the extracted files, not just the ZIP. `README.md` and `package.json` should be at the repository's top level.
6. Enter a commit message such as `Add MeowlChess extension` and click **Commit changes**.

Keep `LICENSE`, both third-party notices, and `third-party-source/` with the project. The provided files are all below GitHub's 25 MB per-file browser-upload limit. Do not upload `node_modules/`, `dist/`, or `test-results/` if you have built or tested the project locally; those generated folders are already excluded from the download and ignored by Git.

The `.gitignore` file may be hidden by your file manager. On macOS, press Command–Shift–period to show hidden files. If it was omitted from your upload, use **Add file → Create new file**, name it `.gitignore`, and copy the provided file's contents.

To offer an easy download, open your repository's **Releases**, choose **Create a new release**, use tag `v1.0.0`, and attach the complete `meowlchess.zip` file. The ZIP includes both the ready-to-load extension and its corresponding source materials. This does not publish it to the Chrome Web Store or Edge Add-ons.

## License

MeowlChess is provided under GPL-3.0-or-later. Stockfish is GPL-licensed, and chess.js uses the BSD 2-Clause license. Keep the bundled license notices and corresponding source materials with redistributions; see the included license and third-party notices for details.
