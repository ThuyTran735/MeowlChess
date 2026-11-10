# MeowlChess store submission

The repository can generate a store upload package. MeowlChess has **not** been submitted to or published in either extension store by this command.

## Package

Run from the project folder:

```sh
npm run package:store
```

The output is `dist/MeowlChess-store.zip`. Its `manifest.json` is at the archive root, as required by the [Chrome Web Store packaging guide](https://developer.chrome.com/docs/webstore/prepare#zip-your-extension-files). It contains the extension files, licenses, attribution and privacy documents, and the bundled engine source materials. It excludes the development dependency folder, tests, Git data, and project tooling. No credentials or developer-account details are embedded.

The normal `npm run package` command still produces `dist/MeowlChess.zip` for GitHub users, with the existing `extension/` folder and full project source. Keep both downloads clearly named; the store ZIP has a different folder layout.

Store submission and approval are separate steps in the [Chrome Web Store dashboard](https://developer.chrome.com/docs/webstore/publish) or [Microsoft Partner Center](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension). A Chrome Web Store listing can also serve [Brave users](https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave).

## Suggested listing

**Name:** MeowlChess — Free Post-Game Analysis

**Short description:** Review completed Chess.com, Lichess, and imported PGN games locally with Stockfish or Lozza. Free, with no account needed.

**Description:**

Study your finished games with free analysis that runs on your own device.

- Review completed Chess.com and Lichess games, or import a PGN.
- Explore move ratings, turning points, engine arrows, and practice positions.
- Choose a local Meowl coach to explain the review in its own personality.
- Optionally show a movable summary panel after games on Chess.com or Lichess.
- Keep saved reviews and bookmarks in your browser, with local backup and restore.

No subscription or analysis-service account is required. Stockfish and Lozza are bundled; game analysis and coaching run locally. Public game retrieval contacts the selected chess website. Optional release checks contact GitHub for version information only. Saved games and coach questions are not uploaded by MeowlChess.

MeowlChess is independent of Chess.com and Lichess. Use it only for completed games. Move labels, study scores, and game-rating estimates are MeowlChess's own estimates and may differ from the original website's review.

Meowl's cat likeness comes from Melonpi Cat (瓜皮 / Guapi). Full artwork and software credits are included with the extension.

**Website:** https://github.com/ThuyTran735/MeowlChess

**Support:** https://github.com/ThuyTran735/MeowlChess/issues

**Privacy:** https://github.com/ThuyTran735/MeowlChess/blob/main/PRIVACY.md

## Permission explanations

Use the final manifest and [privacy notice](../PRIVACY.md) when completing the store's privacy form.

| Access | Purpose |
| --- | --- |
| Storage | Remember preferences and accounts; keep local reviews and update-check preferences. |
| Chess.com public API | Retrieve completed public games selected by the user. |
| Lichess export API | Retrieve completed public games and PGNs selected by the user. |
| Active tab | Read the signed-in account label on the Chess.com or Lichess page when the toolbar icon is clicked. |
| Scripting | Run the local account-label reader and, when enabled, the on-site review panel. Website access is granted separately. |
| Optional chess-site access | Detect signed-in usernames on open chess tabs; display the opt-in on-site panel and read completed-game exports when enabled. |
| Optional notifications | Tell the user when a newly saved review finishes while they are away. |
| Optional GitHub API access | Fetch public release metadata for manually requested or opt-in update checks. |

The extension includes its executable JavaScript and WebAssembly locally. GitHub update checks fetch release metadata, not executable code. Browser-managed store updates replace the installed package through the store's normal process.

## Before submitting

The current [third-party notices](../THIRD_PARTY_NOTICES.md) record that the Chess.com piece artwork and icon contours have no asserted redistribution grant, and that Meowl attribution does not grant rights to the underlying imagery. Resolve the distribution rights for those assets or replace them with licensed artwork before submission; attribution alone is not evidence of permission. The [Chrome Web Store intellectual-property policy](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property) applies to the package and listing.

Prepare current screenshots of the main review, coach, and on-site summary, using a sample game or permission to display player names. Add the store's requested promotional images and publisher/contact details. Confirm the published privacy URL describes the exact package being submitted.

Submit through your own developer account after the package and listing are ready. Retain each store's assigned extension identity for later updates and increase the manifest version with every submitted update.

## Existing-user migration

Normal updates to the same installation preserve its local storage. An unpacked installation and a store installation may have different identities, with separate saved data. Give existing users this migration path:

1. In the existing MeowlChess installation, open **Updates & backups** and save a backup.
2. Install the approved store version without removing the old installation yet.
3. In the store version, restore the backup and confirm that the saved reviews are available.
4. Re-enable optional site reviews and completion alerts in Settings, granting the browser permissions again when requested.
5. Only then remove the old unpacked installation.

Keep the store version installed for future browser-managed updates. No GitHub sign-in is needed to back up or restore local study data.
