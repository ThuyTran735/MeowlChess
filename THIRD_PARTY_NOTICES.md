# Third-party notices

## Stockfish.js 18 / npm stockfish 18.0.5

MeowlChess bundles the upstream, unmodified `stockfish-18-lite-single.js` and `stockfish-18-lite-single.wasm` from npm package `stockfish@18.0.5`.

Stockfish.js copyright © 2026 Chess.com, LLC. Port maintained by Nathan Rugg and contributors. Based on Stockfish by Tord Romstad, Marco Costalba, Joona Kiiski, Gary Linscott, and other contributors. The embedded lite evaluation network is by Linmiao Xu (linrock). Upstream's complete `AUTHORS` file is included in the corresponding-source archive.

License: GNU General Public License, version 3. The full license is included in the extension at `licenses/stockfish.txt` and in the source archive as `Copying.txt`.

- Project: https://github.com/nmrugg/stockfish.js
- Exact npm source revision: `082eeba46b0c5f8f8065e5386750aa0ecfa2062c`
- Pinned source: https://github.com/nmrugg/stockfish.js/tree/082eeba46b0c5f8f8065e5386750aa0ecfa2062c
- Source archive: https://codeload.github.com/nmrugg/stockfish.js/tar.gz/082eeba46b0c5f8f8065e5386750aa0ecfa2062c
- Lite network: https://tests.stockfishchess.org/api/nn/nn-9067e33176e8.nnue

The MeowlChess ZIP includes the pinned upstream source, its build scripts, the required evaluation network, license notices, and build instructions under `third-party-source/`. Keep those source materials alongside the extension binary when redistributing it, with equivalent access. The upstream links supplement the supplied source materials.

This attribution does not imply that Chess.com or any Stockfish contributor endorses MeowlChess.

## Lozza 9

MeowlChess bundles the self-contained JavaScript engine and embedded evaluation network from upstream `examples/lozza9.0.js`. It runs in a local Web Worker, with no runtime downloads. Author: Colin Jenkins (op12no2).

- Project: https://github.com/op12no2/lozza
- Pinned revision: `9822ff0d34ea1f7b57c77a6d8a2453aa19ba702b`
- Original source: https://github.com/op12no2/lozza/blob/9822ff0d34ea1f7b57c77a6d8a2453aa19ba702b/examples/lozza9.0.js
- Upstream license: https://github.com/op12no2/lozza/blob/9822ff0d34ea1f7b57c77a6d8a2453aa19ba702b/LICENCE

The upstream permission notice is included at `extension/licenses/lozza.txt`. The readable source, including its embedded network, is distributed at `extension/vendor/lozza-9.js`. MeowlChess changes only timed-search final-move selection (retain the last completed result), the UCI mate-distance rounding, terminal scores, forced-position searches (complete an evaluation before stopping), and the no-legal-move output (`0000`). These changes are marked in the source header.

Lozza is exposed as a best-move-only option: this upstream version's extra lines are historical root candidates rather than independently searched, coherent MultiPV alternatives. Its small JavaScript package avoids Stockfish's WebAssembly startup, but it is a weaker alternative; the selected per-position time budget still determines review speed.

## chess.js 1.4.0

Project: https://github.com/jhlywa/chess.js

MeowlChess bundles the ESM distribution from `chess.js@1.4.0`, with only its source-map reference removed. License: BSD 2-Clause. Its full notice is reproduced below and included at `licenses/chess-js.txt` in the extension. This license does not require source distribution.

Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

## Chess.com Neo pieces and move symbols

The twelve unmodified 300×300 Neo PNG piece images in `extension/pieces/` are from Chess.com:

- `https://www.chess.com/chess-themes/pieces/neo/300/{piece}.png`, where piece is wp, wn, wb, wr, wq, wk, bp, bn, bb, br, bq, or bk.

The move-badge SVGs in `extension/move-icons/` use symbol contours extracted from Chess.com's public Chess V3 icon font, with circular backgrounds, colors and sizing matching the supplied screenshots:

- Font source: https://www.chess.com/bundles/web/fonts/chessglyph-v3/chessglyph-v3.274864ae.woff
- Palette reference: https://www.chess.com/bundles/app/vite/main-global-styles.HF1rcCqZrQ.css

These third-party artwork files are not authored by MeowlChess and are excluded from MeowlChess's GPL code-license grant. No redistribution permission or other license grant from Chess.com is asserted here. The original font is not bundled; the SVGs contain the used outlines. MeowlChess does not claim endorsement by Chess.com.

## Meowl / Melonpi Cat

The cat likeness behind the Meowl meme is **Melonpi Cat (瓜皮 / Guapi)**. Credit to Melonpi Cat and the photo account **瓜皮的id酱 (@melonpi on Weibo)**.

- Cat/photo account: [Melonpi Cat — 瓜皮的id酱](https://weibo.com/melonpi).
- Original Meowl post: [zhumaokele’s cat/owl images on Weibo, April 28, 2013](https://weibo.com/1505044005/zuePUyE2D), documented in [Know Your Meme’s Meowl history](https://knowyourmeme.com/memes/meowl).

MeowlChess uses a user-supplied chess-themed adaptation of Meowl. The supplied PNG is retained unchanged in `extension/icons/logo.png`; the browser icons are resized copies. MeowlChess does not claim authorship or ownership of Melonpi’s photographs or the underlying Meowl meme. These credits do not grant a license to the underlying third-party artwork.

## Lichess opening names

The local opening reference derives from the lichess-org/chess-openings dataset, released under the CC0 1.0 Universal Public Domain Dedication. The complete dedication is included at `extension/licenses/chess-openings.txt` and alongside the source.

- Project: https://github.com/lichess-org/chess-openings
- Pinned revision: `712a58be746c143f4ab935b68acc50f4bac813eb`
- Source: https://github.com/lichess-org/chess-openings/tree/712a58be746c143f4ab935b68acc50f4bac813eb
- License: https://github.com/lichess-org/chess-openings/blob/712a58be746c143f4ab935b68acc50f4bac813eb/COPYING.txt

The five unmodified TSV source files and provenance are bundled in `third-party-source/chess-openings/`. `scripts/build-openings.mjs` converts their legal mainlines to compact UCI sequences at `extension/data/openings.js`. Opening recognition and Book labels use only exact mainline prefixes from the standard starting position; the dataset is not a complete opening-theory or move-quality oracle. Attribution does not imply endorsement by Lichess.
