# Lichess opening names

Pinned from https://github.com/lichess-org/chess-openings/tree/712a58be746c143f4ab935b68acc50f4bac813eb.

These five unmodified TSV files contain the ECO code, name, and mainline PGN for each opening. The collection is released under CC0; see COPYING.txt.

Run `node scripts/build-openings.mjs` from the project root to validate the source lines with the bundled chess.js and regenerate `extension/data/openings.js`. The output stores legal UCI move sequences and is loaded locally; no runtime opening service is contacted.

MeowlChess matches exact move prefixes from the standard start. The first move outside every known mainline ends its Book section. This is a finite naming reference, not an exhaustive theory or move-quality database, and different move orders can remain unrecognized.
