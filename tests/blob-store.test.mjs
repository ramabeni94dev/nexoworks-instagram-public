import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobStore } from '../lib/blob-store.mjs';
import { WidgetService } from '../lib/service.mjs';
import { parseInstagramPage } from '../lib/instagram.mjs';
import { user, html } from './fixtures.mjs';
import { BlobPreconditionFailedError } from '@vercel/blob';

function memoryBlob(initial = { version: 1, widgets: [] }) {
  let body = JSON.stringify(initial);
  let version = 1;
  return {
    async get(_path, options) {
      assert.equal(options.useCache, false);
      assert.equal(options.headers['Accept-Encoding'], 'identity');
      const result = { stream: new Response(body).body, blob: { etag: String(version) } };
      await new Promise(resolve => setImmediate(resolve));
      return result;
    },
    async put(_path, value, options) {
      if (options.ifMatch !== String(version)) {
        throw new BlobPreconditionFailedError();
      }
      body = value;
      version += 1;
      return { etag: String(version) };
    },
  };
}

test('concurrent function instances preserve both changes through conditional writes', async () => {
  const sdk = memoryBlob();
  const first = new BlobStore({ sdk });
  const second = new BlobStore({ sdk });
  await Promise.all([first.init(), second.init()]);
  await Promise.all([
    first.update(widgets => widgets.push({ id: 'one' })),
    second.update(widgets => widgets.push({ id: 'two' })),
  ]);
  const restarted = new BlobStore({ sdk });
  await restarted.init();
  assert.deepEqual(restarted.list().map(widget => widget.id).sort(), ['one', 'two']);
});

test('two serverless requests cannot scrape the same profile simultaneously', async () => {
  const sdk = memoryBlob({ version: 1, widgets: [{ id: 'one', username: 'test.brand', createdAt: new Date().toISOString(), limit: 12 }] });
  const stores = [new BlobStore({ sdk }), new BlobStore({ sdk })];
  await Promise.all(stores.map(store => store.init()));
  let calls = 0;
  const services = stores.map(store => new WidgetService(store, {
    scrape: async () => { calls += 1; return parseInstagramPage(html({ user }), 'test.brand'); },
    cache: async snapshot => ({ snapshot, missed: 0 }),
  }));
  await Promise.all(services.map(service => service.run('one')));
  assert.equal(calls, 1);
  const restarted = new BlobStore({ sdk }); await restarted.init();
  assert.equal(restarted.get('one').snapshot.media.length, 1);
  assert.equal(restarted.get('one').refreshLease, undefined);
});

test('the serverless lifecycle retains a scheduled refresh until completion', async () => {
  const store = new BlobStore({ sdk: memoryBlob() }); await store.init();
  let retained;
  const service = new WidgetService(store, {
    defer: promise => { retained = promise; },
    scrape: async () => parseInstagramPage(html({ user }), 'test.brand'),
    cache: async snapshot => ({ snapshot, missed: 0 }),
  });
  const widget = await service.create({ username: 'test.brand' });
  assert.ok(retained instanceof Promise);
  await retained;
  assert.equal(service.feed(widget.id).media.length, 1);
});

test('an external refresh persists across instances and is consumed by the worker', async () => {
  const sdk = memoryBlob();
  const store = new BlobStore({ sdk }); await store.init();
  const panel = new WidgetService(store, {
    externalRefresh: true,
    scrape: async () => { assert.fail('The panel must not scrape'); },
  });
  const widget = await panel.create({ username: 'test.brand' });
  const requestedAt = store.get(widget.id).refreshRequestedAt;
  assert.ok(requestedAt);
  assert.equal(panel.list()[0].refreshQueued, true);
  assert.equal(panel.list()[0].refreshing, false);
  await panel.requestRefresh(widget.id);
  assert.equal(store.get(widget.id).refreshRequestedAt, requestedAt);
  const workerStore = new BlobStore({ sdk }); await workerStore.init();
  const worker = new WidgetService(workerStore, {
    scrape: async () => parseInstagramPage(html({ user }), 'test.brand'),
    cache: async snapshot => ({ snapshot, missed: 0 }),
  });
  await worker.run(widget.id);
  await store.init();
  assert.equal(panel.list()[0].refreshQueued, false);
  assert.equal(panel.feed(widget.id).media.length, 1);
  await assert.rejects(panel.requestRefresh(widget.id), { code: 'COOLDOWN' });
});
