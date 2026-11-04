import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateService, compareVersions, releaseDetails, UPDATE_API, UPDATE_INTERVAL } from '../extension/lib/updates.js';
const release = () => ({ draft: false, prerelease: false, tag_name: 'v1.12.0', html_url: 'https://github.com/ThuyTran735/MeowlChess/releases/tag/v1.12.0', body: 'Better updates', assets: [{ name: 'MeowlChess.zip', state: 'uploaded', size: 123, browser_download_url: 'https://github.com/ThuyTran735/MeowlChess/releases/download/v1.12.0/MeowlChess.zip' }] });
function harness(overrides = {}) {
  const data = {}, requests = []; let time = 100000000, allowed = true;
  const storage = { async get(keys) { return Object.fromEntries(keys.filter(key => key in data).map(key => [key, structuredClone(data[key])])); }, async set(values) { Object.assign(data, structuredClone(values)); } };
  const fetcher = async (...args) => { requests.push(args); return new Response(JSON.stringify(release())); };
  const options = { storage, hasPermission: async () => allowed, now: () => time, version: '1.11.0', fetcher, ...overrides };
  return { data, requests, options, service: createUpdateService(options), advance: value => { time += value; }, allow: value => { allowed = value; } };
}
test('versions compare numerically and reject malformed release tags', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1); assert.equal(compareVersions('v1.2.3', '1.2.3.0'), 0);
  for (const tag of ['v1.2.3-beta', '../v1.2.3', '1.01.0', '70000.1.0']) assert.throws(() => compareVersions(tag, '1.0.0'));
});
test('only a stable release and the exact official asset are accepted', () => {
  assert.equal(releaseDetails(release()).version, '1.12.0');
  for (const changes of [{ prerelease: true }, { draft: true }, { html_url: 'https://evil.example/' }, { assets: [] }]) assert.throws(() => releaseDetails({ ...release(), ...changes }));
  const bad = release(); bad.assets[0].browser_download_url += '?redirect=evil'; assert.throws(() => releaseDetails(bad));
});
test('network checks are opt-in, manual checks omit credentials and games', async () => {
  const h = harness(); assert.equal((await h.service.check()).status, 'disabled'); assert.equal(h.requests.length, 0);
  const result = await h.service.check({ manual: true }); assert.equal(result.available, true); assert.equal(h.requests.length, 1);
  const [url, options] = h.requests[0]; assert.equal(url, UPDATE_API); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.body, undefined);
  h.allow(false); h.advance(UPDATE_INTERVAL); assert.equal((await h.service.check({ manual: true })).status, 'permission'); assert.equal(h.requests.length, 1);
});
test('one daily automatic check and cache survive worker restarts', async () => {
  const h = harness(); await h.service.setAutomatic(true); await h.service.check(); h.advance(61000);
  await createUpdateService(h.options).check(); assert.equal(h.requests.length, 1);
  h.advance(UPDATE_INTERVAL); await h.service.check(); assert.equal(h.requests.length, 2);
  await h.service.setAutomatic(false); h.advance(UPDATE_INTERVAL); await h.service.check(); assert.equal(h.requests.length, 2);
});
test('manual spam and simultaneous page checks share one request', async () => {
  const h = harness(); await Promise.all([h.service.check({ manual: true }), h.service.check({ manual: true })]); assert.equal(h.requests.length, 1);
  await h.service.check({ manual: true }); assert.equal(h.requests.length, 1);
  h.advance(60001); await h.service.check({ manual: true }); assert.equal(h.requests.length, 2);
});
test('rate-limit failures retain good metadata and back off persistently', async () => {
  const h = harness(); await h.service.check({ manual: true }); h.advance(60001);
  const failed = createUpdateService({ ...h.options, fetcher: async () => new Response('{}', { status: 429, headers: { 'retry-after': '3600' } }) });
  const result = await failed.check({ manual: true }); assert.equal(result.status, 'error'); assert.equal(result.available, true);
  h.advance(61000); assert.equal((await h.service.check({ manual: true })).status, 'cached'); assert.equal(h.requests.length, 1);
});
test('permission cannot be enabled by settings alone; unsafe cached URLs discarded', async () => {
  const h = harness(); h.allow(false); await assert.rejects(h.service.setAutomatic(true));
  h.data.updateCheckState = { release: { version: '1.12.0', releaseUrl: 'https://evil.example/', downloadUrl: 'javascript:alert(1)' } };
  assert.equal((await h.service.snapshot()).release, null);
});
test('oversized metadata never becomes a release; timeout does not hang', async () => {
  const h = harness({ fetcher: async () => new Response('a'.repeat(300000)) }); assert.equal((await h.service.check({ manual: true })).status, 'error');
  const timed = harness({ timeoutMs: 10, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')))) });
  const result = await timed.service.check({ manual: true }); assert.equal(result.status, 'error'); assert.match(result.error, /timed out/);
});
