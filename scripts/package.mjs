import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// Dependency-free ZIP packaging works on Windows, macOS, and Linux.
const root = resolve(import.meta.dirname, '..');
const items = ['extension', 'scripts', 'tests', 'third-party-source', '.gitignore', 'package.json', 'package-lock.json', 'README.md', 'PRIVACY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function filesIn(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Packaging does not accept symbolic links: ${child}`);
  }
  return files;
}
const paths = [];
for (const item of items) {
  const path = join(root, item);
  paths.push(...((await stat(path)).isDirectory() ? await filesIn(path) : [path]));
}
const localRecords = [];
const centralRecords = [];
let offset = 0;
for (const path of paths) {
  const name = Buffer.from(relative(root, path).split(sep).join('/'), 'utf8');
  const raw = await readFile(path);
  const compressed = deflateRawSync(raw, { level: 9 });
  const crc = crc32(raw);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 filenames.
  header.writeUInt16LE(8, 8); // DEFLATE.
  header.writeUInt16LE(33, 12); // 1980-01-01, for reproducible output.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  localRecords.push(header, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centralRecords.push(central, name);
  offset += header.length + name.length + compressed.length;
}
const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(paths.length, 8);
end.writeUInt16LE(paths.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'MeowlChess.zip'), Buffer.concat([...localRecords, ...centralRecords, end]));
console.log(`Created dist/MeowlChess.zip (${paths.length} files; extension, project, and engine sources).`);
