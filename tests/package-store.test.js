import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { packageStore } from '../scripts/package-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'MeowlChess-store-'));
  t.after(() => {
    const withinTemp = relative(resolve(tmpdir()), resolve(root));
    assert.ok(!isAbsolute(withinTemp) && !withinTemp.startsWith('..') && withinTemp.startsWith('MeowlChess-store-'));
    return rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'extension', 'icons'), { recursive: true });
  await mkdir(join(root, 'third-party-source'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'extension', 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MeowlChess', version: '1.11.0' }));
  await writeFile(join(root, 'extension', 'review.html'), '<!doctype html><title>MeowlChess</title>');
  await writeFile(join(root, 'extension', 'icons', 'test.png'), Buffer.from([0, 255, 3, 9]));
  for (const path of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'third-party-source/engine-source.txt', 'node_modules/excluded.txt']) await writeFile(join(root, path), path);
  return root;
}
function unzip(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8), compressed = buffer.readUInt32LE(offset + 18);
    const raw = buffer.readUInt32LE(offset + 22), nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    assert.equal(method, 8);
    const data = inflateRawSync(buffer.subarray(start, start + compressed));
    assert.equal(data.length, raw);
    files.set(name, data);
    offset = start + compressed;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  assert.equal(buffer.readUInt16LE(buffer.length - 12), files.size);
  return files;
}

test('store ZIP is installable at its root and carries source and notices without developer files', async t => {
  const root = await fixture(t);
  const result = await packageStore({ root });
  const files = unzip(await readFile(result.output));
  assert.equal(JSON.parse(files.get('manifest.json')).version, '1.11.0');
  assert.equal(files.get('review.html').toString(), '<!doctype html><title>MeowlChess</title>');
  assert.deepEqual(files.get('icons/test.png'), Buffer.from([0, 255, 3, 9]));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'third-party-source/engine-source.txt']) assert.ok(files.has(name));
  assert.ok([...files.keys()].every(name => !name.startsWith('extension/') && !name.startsWith('node_modules/')));
  assert.equal(result.files, files.size);
});

test('the same contents produce the same store ZIP and root filename collisions fail', async t => {
  const root = await fixture(t);
  const first = await packageStore({ root });
  const bytes = await readFile(first.output);
  await packageStore({ root });
  assert.deepEqual(await readFile(first.output), bytes);
  await writeFile(join(root, 'extension', 'LICENSE'), 'colliding license');
  await assert.rejects(packageStore({ root }), /conflicting filenames/);
});
