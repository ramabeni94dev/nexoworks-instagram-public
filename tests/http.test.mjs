import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { parseInstagramPage } from '../lib/instagram.mjs';
import { cacheImages } from '../lib/assets.mjs';
import { user, html } from './fixtures.mjs';

const token = 'a-test-token-that-is-long-enough-12345';
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nexo-public-http-'));
  const result = await createApp({ dataDirectory: directory, adminToken: token, scheduler: false, serviceOptions: {
    scrape: async () => parseInstagramPage(html({ user }), 'test.brand'),
    cache: async snapshot => ({ snapshot, missed: 0 }),
  }, ...options });
  const server = result.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await result.service.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = 'GET', body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Nexo-Request': '1', Authorization: `Bearer ${token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ...result, base, request };
}
test('anonymous users cannot administer widgets; login uses an HttpOnly signed session', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/admin/widgets', 'GET', undefined, { Authorization: '' })).status, 401);
  assert.equal((await request('/api/login', 'POST', { token: 'wrong' }, { Authorization: '' })).status, 401);
  const login = await request('/api/login', 'POST', { token }, { Authorization: '' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.equal((await request('/api/admin/widgets', 'GET', undefined, { Authorization: '', Cookie: cookie.split(';')[0] })).status, 200);
  assert.equal((await request('/api/admin/widgets', 'GET', undefined, { Authorization: '', Cookie: cookie.split(';')[0] + 'tampered' })).status, 401);
});
test('rejects cross-origin and simple form mutations', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/admin/widgets', 'POST', { username: 'test.brand' }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await request('/api/admin/widgets', 'POST', { username: 'test.brand' }, { 'X-Nexo-Request': '' })).status, 403);
});
test('creates, embeds, edits and deletes a widget through the API', async t => {
  const { request, service } = await setup(t);
  const created = await request('/api/admin/widgets', 'POST', { username: 'test.brand', title: '</script><script>alert(1)</script>' });
  assert.equal(created.status, 202);
  const { widget } = await created.json();
  await service.tail;
  const publicHeaders = { Authorization: '' };
  const feed = await request(`/api/public/widgets/${widget.id}/feed`, 'GET', undefined, publicHeaders);
  assert.equal(feed.status, 200);
  assert.equal((await feed.json()).profile.username, 'test.brand');
  const embed = await request(`/embed/${widget.id}`, 'GET', undefined, publicHeaders);
  assert.equal(embed.status, 200);
  assert.equal(embed.headers.get('x-frame-options'), null);
  const config = await (await request(`/api/public/widgets/${widget.id}/config.js`)).text();
  assert.ok(!config.includes('</script>'));
  assert.equal((await request(`/api/admin/widgets/${widget.id}`, 'PATCH', { template: 'grid', limit: 6 })).status, 200);
  assert.match(await (await request(`/api/public/widgets/${widget.id}/config.js`)).text(), /"widgetTemplate":"grid"/);
  assert.equal((await request(`/api/admin/widgets/${widget.id}`, 'DELETE')).status, 200);
  assert.equal((await request(`/api/public/widgets/${widget.id}/feed`)).status, 404);
});
test('invalid input and unavailable feeds give clear error responses', async t => {
  const { request } = await setup(t);
  const result = await request('/api/admin/widgets', 'POST', { username: 'https://localhost/a' });
  assert.equal(result.status, 400);
  assert.equal((await result.json()).code, 'INVALID_USERNAME');
  assert.equal((await request('/api/public/widgets/missing/feed')).status, 404);
});

test('both reference layouts share a cached feed without editing the widget or extracting again', async t => {
  const { request, store, service } = await setup(t);
  const { widget } = await (await request('/api/admin/widgets', 'POST', { username: 'test.brand', template: 'photo-wall', limit: 12 })).json();
  await service.tail;
  assert.equal(store.get(widget.id).template, 'photo-wall');
  const before = structuredClone(store.get(widget.id));
  service.scrape = async () => assert.fail('Displaying a layout must not trigger extraction');
  const readConfig = async query => JSON.parse((await (await request(`/api/public/widgets/${widget.id}/config.js?${query}`)).text()).split('=', 2)[1].slice(0, -1));
  const photo = await readConfig('template=photo-wall&limit=10');
  const cards = await readConfig('template=social-cards&limit=12&title=%23tina');
  assert.equal(photo.feedLimit, 10);
  assert.equal(photo.widgetTemplate, 'photo-wall');
  assert.equal(cards.widgetTemplate, 'social-cards');
  assert.equal(cards.widgetTitle, '#tina');
  assert.equal(photo.feedUrl, cards.feedUrl);
  assert.equal((await request(photo.feedUrl)).status, 200);
  const embedded = await (await request(`/embed/${widget.id}?template=social-cards&limit=10&title=%23tina`)).text();
  assert.match(embedded, /config\.js\?template=social-cards&amp;limit=10&amp;title=%23tina/);
  assert.deepEqual(store.get(widget.id), before);
  await request(`/api/admin/widgets/${widget.id}`, 'PATCH', { template: 'social-cards' });
  assert.equal(store.get(widget.id).template, 'social-cards');
});

test('embed overrides reject unknown templates, cap post counts and escape titles', async t => {
  const { request, service } = await setup(t);
  const { widget } = await (await request('/api/admin/widgets', 'POST', { username: 'test.brand', template: 'grid', limit: 6 })).json();
  await service.tail;
  const base = `/api/public/widgets/${widget.id}/config.js`;
  const result = await (await request(base + '?template=unknown&limit=100&title=' + encodeURIComponent('</script><script>alert(1)</script>'))).text();
  assert.ok(!result.includes('</script>'));
  const config = JSON.parse(result.split('=', 2)[1].slice(0, -1));
  assert.equal(config.widgetTemplate, 'grid');
  assert.equal(config.feedLimit, 6);
  for (const limit of ['-1', '0', '1.5', 'NaN']) {
    assert.match(await (await request(base + '?limit=' + limit)).text(), /"feedLimit":6/);
  }
});
test('production cannot start with a missing or short admin token', async () => {
  await assert.rejects(createApp({ adminToken: '', production: true }), /ADMIN_TOKEN/);
  await assert.rejects(createApp({ adminToken: 'short', production: true }), /ADMIN_TOKEN/);
});
test('images are mirrored, while an invalid host is never fetched', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nexo-public-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = parseInstagramPage(html({ user }), 'test.brand');
  snapshot.profile.profilePictureUrl = 'https://evil.test/tracking';
  let calls = 0;
  const assets = await cacheImages(snapshot, '11111111-1111-1111-1111-111111111111', directory, async url => {
    calls += 1; assert.ok(url.startsWith('https://scontent.cdninstagram.com/'));
    return new Response(Buffer.from('test-image-bytes'), { headers: { 'content-type': 'image/jpeg' } });
  });
  assert.equal(calls, 1);
  assert.equal(assets.missed, 1);
  assert.match(assets.snapshot.media[0].previewUrl, /^\/media\//);
  assert.equal(await readFile(path.join(directory, assets.snapshot.media[0].previewUrl), 'utf8'), 'test-image-bytes');
});

test('external mode queues admin requests and public reads never launch an extraction', async t => {
  const { request, store, service } = await setup(t, {
    externalRefresh: true,
    serviceOptions: { scrape: async () => { assert.fail('Unexpected server extraction'); } },
  });
  const created = await request('/api/admin/widgets', 'POST', { username: 'test.brand' });
  const { widget } = await created.json();
  assert.equal(created.status, 202);
  assert.ok(store.get(widget.id).refreshRequestedAt);
  assert.equal((await request(`/api/public/widgets/${widget.id}/feed`)).status, 503);
  const listing = await (await request('/api/admin/widgets')).json();
  assert.equal(listing.refreshMode, 'external');
  assert.equal(listing.widgets[0].refreshQueued, true);
  assert.equal(service.jobs.size, 0);
  const refreshed = await request(`/api/admin/widgets/${widget.id}/refresh`, 'POST', {});
  assert.equal((await refreshed.json()).executor, 'external');
});
