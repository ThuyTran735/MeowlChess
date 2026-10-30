# MeowlChess privacy notice

MeowlChess is an independent browser extension for local analysis of completed chess games. It is not affiliated with or endorsed by Chess.com.

## Information used

You enter a Chess.com username to request that player's publicly available completed games. Those records can include player usernames, ratings, results, timestamps, and the moves of each game. The username is part of the request URL sent directly to `api.chess.com`.

The extension remembers your entered username in local browser storage. Game data and computed analysis are processed in your browser. They are not uploaded to a MeowlChess server or an external analysis service.

## Network requests

The installed extension contacts Chess.com's published API to retrieve public archive data. Chess.com receives the requested username and normal connection information, such as your IP address and browser request headers. Its handling of those requests is governed by [Chess.com's privacy policy](https://www.chess.com/legal/privacy).

Stockfish and the other runtime code are bundled with the extension. Engine calculations happen locally; no runtime CDN, paid API, or remote engine is used. Opening an external help or policy link makes an ordinary browser navigation to that website, subject to that website's policies.

## What MeowlChess does not collect

MeowlChess does not request Chess.com passwords, authentication tokens, payment details, or private messages. It does not read Chess.com page content or your browsing history. It has no developer-operated data collection service, analytics, advertising, or telemetry.

## Browser permissions

- `storage` is used for local preferences.
- Access to `https://api.chess.com/*` is used to request public game archive data.

The extension does not use content scripts or request permission to read live game pages.

## Control and deletion

You can replace the saved username by entering another one. Uninstalling the extension removes its local extension storage. Public games remain on Chess.com; removing MeowlChess does not change or delete those records. Close the review tab to end its active analysis and discard its in-memory review state.

This notice describes the source supplied with this local build. If you modify the extension or install a modified version, review that version's behavior and privacy notice separately.
