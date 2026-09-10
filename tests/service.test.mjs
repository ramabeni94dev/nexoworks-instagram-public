import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { WidgetService } from '../lib/service.mjs';
import { parseInstagramPage, ScrapeError } from '../lib/instagram.mjs';
import { user, html } from './fixtures.mjs';
import { cacheImages } from '../lib/assets.mjs';
const snapshot = parseInstagramPage(html({ user }), 'test.brand');
const cache = async snapshot => ({ snapshot, missed: 0 });

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nexo-public-test-'));
  const store = new Store(directory);
  await store.init();
  const service = new WidgetService(store, { scrape: async () => snapshot, cache, ...options });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, service, directory };
}
test('persists widgets and snapshots across restarts', async t => {
  const { service, directory } = await setup(t);
  const widget = await service.create({ username: 'test.brand' });
  await service.tail;
  const restarted = new Store(directory); await restarted.init();
  assert.equal(restarted.get(widget.id).snapshot.media.length, 1);
  assert.equal(restarted.get(widget.id).username, 'test.brand');
});
test('concurrent duplicate creates store exactly one widget', async t => {
  const { service, store } = await setup(t);
  const results = await Promise.allSettled([service.create({ username: 'test.brand' }), service.create({ username: '@TEST.BRAND' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(store.list().length, 1);
});
test('deduplicates refresh jobs and enforces cooldown', async t => {
  let resolve;
  let calls = 0;
  const { service } = await setup(t, { scrape: () => { calls += 1; return new Promise(done => { resolve = done; }); } });
  const widget = await service.create({ username: 'test.brand' });
  service.refresh(widget.id); service.refresh(widget.id);
  while (!resolve) await new Promise(done => setImmediate(done));
  resolve(snapshot);
  await service.tail;
  assert.equal(calls, 1);
  assert.throws(() => service.refresh(widget.id), { code: 'COOLDOWN' });
});
test('public reads use the cache without triggering a scrape', async t => {
  let calls = 0;
  const { service } = await setup(t, { scrape: async () => { calls += 1; return snapshot; } });
  const widget = await service.create({ username: 'test.brand', limit: 1 });
  await service.tail;
  for (let index = 0; index < 10; index += 1) assert.equal(service.feed(widget.id).media.length, 1);
  assert.equal(calls, 1);
});
test('failed refresh keeps the last feed but expires it after 24 hours', async t => {
  let now = Date.now();
  const { service, store } = await setup(t, { now: () => now });
  const widget = await service.create({ username: 'test.brand' }); await service.tail;
  now += 61 * 60_000;
  service.scrape = async () => { throw new ScrapeError('TIMEOUT', 'Timeout'); };
  service.refresh(widget.id); await service.tail;
  assert.equal(service.feed(widget.id).stale, true);
  assert.equal(store.get(widget.id).error.code, 'TIMEOUT');
  now += 24 * 60 * 60_000;
  assert.throws(() => service.feed(widget.id), { code: 'FEED_UNAVAILABLE' });
});
test('a profile becoming private immediately withdraws its cached feed', async t => {
  let now = Date.now();
  const { service } = await setup(t, { now: () => now });
  const widget = await service.create({ username: 'test.brand' }); await service.tail;
  now += 61_000;
  service.scrape = async () => { throw new ScrapeError('PRIVATE_PROFILE', 'Private'); };
  service.refresh(widget.id); await service.tail;
  assert.throws(() => service.feed(widget.id), { code: 'FEED_UNAVAILABLE' });
});
test('deleting during a scrape cannot recreate the widget', async t => {
  let resolve;
  const { service, store } = await setup(t, { scrape: () => new Promise(done => { resolve = done; }) });
  const widget = await service.create({ username: 'test.brand' });
  while (!resolve) await new Promise(done => setImmediate(done));
  await service.remove(widget.id); resolve(snapshot); await service.tail;
  assert.equal(store.get(widget.id), null);
});

test('the scheduler skips paused profiles while allowing manual updates', async t => {
  let now = Date.now();
  const calls = [];
  const { service, store } = await setup(t, { now: () => now, scrape: async username => { calls.push(username); return snapshot; } });
  const active = await service.create({ username: 'active.brand' }); await service.tail;
  const paused = await service.create({ username: 'paused.brand' }); await service.tail;
  await service.edit(paused.id, { autoRefresh: false });
  now += 7 * 3600000;
  calls.length = 0;
  service.startScheduler(); await service.tail;
  assert.deepEqual(calls, ['active.brand']);
  assert.equal(store.get(paused.id).autoRefresh, false);
  await service.requestRefresh(paused.id); await service.tail;
  assert.deepEqual(calls, ['active.brand', 'paused.brand']);
  assert.ok(store.get(active.id).fetchedAt);
});

test('an incomplete Apify profile retains its cached avatar on persistent storage', async t => {
  let now = Date.now();
  const imageBytes = Buffer.from('cached-image');
  const { service, store, directory } = await setup(t, { now: () => now, cache: (data, id, root) => cacheImages(data, id, root, async () => new Response(imageBytes, { headers: { 'content-type': 'image/jpeg' } })) });
  const widget = await service.create({ username: 'test.brand' }); await service.tail;
  const original = store.get(widget.id).snapshot.profile;
  const incomplete = structuredClone(snapshot);
  incomplete.source = 'apify'; incomplete.incompleteProfile = true;
  incomplete.profile.profilePictureUrl = ''; incomplete.profile.biography = '';
  service.scrape = async () => incomplete;
  now += 61000;
  await service.requestRefresh(widget.id); await service.tail;
  const saved = store.get(widget.id);
  assert.equal(saved.error, null);
  assert.equal(saved.snapshot.profile.profilePictureUrl, original.profilePictureUrl);
  assert.equal(saved.snapshot.profile.biography, original.biography);
  assert.deepEqual(await readFile(path.join(directory, original.profilePictureUrl)), imageBytes);
});
