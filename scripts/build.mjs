import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await mkdir(`${root}/extension/vendor`, { recursive: true });
await mkdir(`${root}/extension/licenses`, { recursive: true });
for (const file of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  await copyFile(`${root}/node_modules/stockfish/bin/${file}`, `${root}/extension/vendor/${file}`);
}
// The upstream source map is not needed for runtime and is not packaged.
const chess = await readFile(`${root}/node_modules/chess.js/dist/esm/chess.js`, 'utf8');
await writeFile(`${root}/extension/vendor/chess.js`, chess.replace(/\/\/# sourceMappingURL=.*$/m, ''));
await copyFile(`${root}/node_modules/chess.js/LICENSE`, `${root}/extension/licenses/chess-js.txt`);
await copyFile(`${root}/node_modules/stockfish/Copying.txt`, `${root}/extension/licenses/stockfish.txt`);
await copyFile(`${root}/node_modules/stockfish/Copying.txt`, `${root}/LICENSE`);
console.log('Built extension/ with local chess.js and Stockfish 18 lite.');
