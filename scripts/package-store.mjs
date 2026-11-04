import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function collect(path, base, entries) {
  const info = await lstat(path);
  if (info.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await collect(join(path, name), base, entries);
  } else if (info.isFile()) {
    entries.push({ path, name: relative(base, path).split(sep).join('/') });
  } else throw new Error(`Store packaging does not accept symbolic links or special files: ${path}`);
}

export async function packageStore({ root = projectRoot, output = join(root, 'dist', 'MeowlChess-store.zip') } = {}) {
  const extension = join(root, 'extension');
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3 || typeof manifest.version !== 'string' || !manifest.name) throw new Error('The store package needs a valid Manifest V3 extension.');
  const entries = [];
  await collect(extension, extension, entries);
  // Keep complete engine source access and attribution with every distributed binary.
  for (const item of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'third-party-source']) {
    await collect(join(root, item), root, entries);
  }
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (let index = entries.length - 1; index > 0; index--) {
    if (entries[index].name !== entries[index - 1].name) continue;
    const [left, right] = await Promise.all([readFile(entries[index].path), readFile(entries[index - 1].path)]);
    if (!left.equals(right)) throw new Error('The store package contains conflicting filenames.');
    entries.splice(index, 1);
  }
  if (entries.length > 65535) throw new Error('Too many files for this ZIP format.');
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'), raw = await readFile(entry.path);
    const compressed = deflateRawSync(raw, { level: 9 }), crc = crc32(raw);
    if (name.length > 65535 || raw.length > 0xffffffff || compressed.length > 0xffffffff) throw new Error('A file exceeds the ZIP format limit.');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // Fixed 1980-01-01 timestamp for reproducible packages.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
    if (offset > 0xffffffff) throw new Error('The store package exceeds the ZIP format limit.');
  }
  const centralSize = central.reduce((sum, record) => sum + record.length, 0);
  if (offset + centralSize > 0xffffffff) throw new Error('The store package exceeds the ZIP format limit.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...local, ...central, end]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, archive);
  return { output, version: manifest.version, files: entries.length, bytes: archive.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await packageStore();
  console.log(`Created dist/MeowlChess-store.zip (${result.files} files; manifest at ZIP root). This prepares a package; it does not publish a store listing.`);
}
