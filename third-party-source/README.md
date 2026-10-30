# Stockfish corresponding source

These materials accompany MeowlChess's unmodified Stockfish 18 lite single-threaded JavaScript/WebAssembly engine from npm `stockfish@18.0.5`.

## Included materials

| File | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `stockfish.js-082eeba46b0c5f8f8065e5386750aa0ecfa2062c.tar.gz` | 585331 | `8e047428efde3b856dddd163dd8bd1a019b97956792d284d1cca8ef8417b5635` |
| `nn-9067e33176e8.nnue` | 6617595 | `9067e33176e8c5edb7aa8db6a3aedd012f84a1f39872e86357c6c2d0993f314d` |

Source origin:

https://codeload.github.com/nmrugg/stockfish.js/tar.gz/082eeba46b0c5f8f8065e5386750aa0ecfa2062c

Network origin:

https://tests.stockfishchess.org/api/nn/nn-9067e33176e8.nnue

The commit is the npm 18.0.5 release's `gitHead`. The source archive contains the C++ and JavaScript sources, Makefile, `build.js`, build helper scripts, the bundled UglifyJS build dependency and its license, `Copying.txt`, and `AUTHORS`. The evaluation network is not part of upstream's Git archive, so it is supplied separately here. `src/lite_nets.h` requires `nn-9067e33176e8.nnue` as its big network and defines an empty small-network name; no second network is needed for this flavor. The network's SHA-256 prefix matches its filename.

## Rebuilding this flavor

The pinned upstream [README](https://github.com/nmrugg/stockfish.js/blob/082eeba46b0c5f8f8065e5386750aa0ecfa2062c/README.md) and `build.js` specify Emscripten **3.1.7**. Install that toolchain following the [Emscripten SDK instructions](https://emscripten.org/docs/getting_started/downloads.html), activate it, and ensure `emcc`, `em++`, Node.js, Python, and GNU Make are on your path. The SDK and ordinary build tools are not included in this source bundle.

From this `third-party-source/` directory:

```sh
sha256sum -c SHA256SUMS
tar -xzf stockfish.js-082eeba46b0c5f8f8065e5386750aa0ecfa2062c.tar.gz
cp nn-9067e33176e8.nnue stockfish.js-082eeba46b0c5f8f8065e5386750aa0ecfa2062c/src/
cd stockfish.js-082eeba46b0c5f8f8065e5386750aa0ecfa2062c
node build.js --lite --single-threaded --no-split
```

The build outputs `src/stockfish-18-lite-single.js` and `src/stockfish-18-lite-single.wasm`. Copy both into MeowlChess's `extension/vendor/` directory to use your build. MeowlChess's ordinary `npm run build` copies the pinned prebuilt npm assets, so running it afterward replaces those local engine builds.

The source and network have been retrieved and checksum-verified; this delivery does not claim that the C++/WebAssembly engine was rebuilt or that a local rebuild is byte-for-byte reproducible. Generated timestamps, toolchain differences, and build metadata may change binary bytes.

## Distributed upstream engine checksums

For comparison, MeowlChess's unmodified npm engine files have these hashes:

```text
2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe  stockfish-18-lite-single.js
a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1  stockfish-18-lite-single.wasm
```

## License and attribution

Stockfish.js copyright © 2026 Chess.com, LLC; maintained by Nathan Rugg and contributors. Based on Stockfish by Tord Romstad, Marco Costalba, Joona Kiiski, Gary Linscott, and other contributors. The lite network is by Linmiao Xu (linrock). The full author list and GNU GPL version 3 license are in the upstream archive's `AUTHORS` and `Copying.txt` files; copies are also provided alongside this README.

Keep these source materials available alongside any redistributed extension binary. See the parent `THIRD_PARTY_NOTICES.md` for chess.js attribution; chess.js uses BSD 2-Clause and does not require corresponding source distribution.
