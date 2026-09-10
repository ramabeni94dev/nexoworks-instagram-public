import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApifyPosts, scrapeWithApify } from '../lib/apify.mjs';
import { getExtractionProvider } from '../lib/provider.mjs';

const image = 'https://scontent.cdninstagram.com/post.jpg';
const post = { id: '123', shortCode: 'POST_01', ownerUsername: 'test.brand', ownerFullName: 'Test Brand', ownerId: '456', type: 'Image', displayUrl: image, caption: 'Texto\n#ejemplo', timestamp: '2026-09-01T12:00:00Z' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('Apify results retain captions and dates while rejecting unknown owners and unsafe images', () => {
  const result = parseApifyPosts([post, { ...post, shortCode: 'OTHER', ownerUsername: 'other.brand' }, { ...post, shortCode: 'UNSAFE', displayUrl: 'https://evil.test/image' }, { ...post, shortCode: 'NO_OWNER', ownerUsername: undefined }], '@test.brand');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].caption, post.caption);
  assert.equal(result.media[0].timestamp, '2026-09-01T12:00:00.000Z');
  assert.equal(result.profile.mediaCount, null);
  assert.equal(result.source, 'apify');
});

test('empty datasets are errors and carousel previews can come from a child', () => {
  assert.throws(() => parseApifyPosts([], 'test.brand'), { code: 'POSTS_UNAVAILABLE' });
  assert.throws(() => parseApifyPosts([{ error: 'no_items' }], 'test.brand'), { code: 'POSTS_UNAVAILABLE' });
  assert.throws(() => parseApifyPosts([{ ...post, isPrivate: true }], 'test.brand'), { code: 'PRIVATE_PROFILE' });
  const result = parseApifyPosts([{ ...post, type: 'Sidecar', displayUrl: null, childPosts: [{ displayUrl: image }] }], 'test.brand');
  assert.equal(result.media[0].mediaType, 'carousel');
  assert.equal(result.media[0].previewUrl, image);
});

test('a bounded Apify run uses header auth, requests the basic package, and returns its dataset', async () => {
  const calls = [];
  const responses = [
    { data: { id: 'run123', status: 'READY' } },
    { data: { id: 'run123', status: 'SUCCEEDED', defaultDatasetId: 'dataset123' } },
    [post],
  ];
  const result = await scrapeWithApify('test.brand', {
    token: 'secret-test-token', limit: 12,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.headers.Authorization, 'Bearer secret-test-token');
      assert.ok(!url.includes('secret-test-token'));
      return json(responses.shift());
    },
  });
  assert.equal(result.media.length, 1);
  assert.equal(calls.length, 3);
  const start = new URL(calls[0].url);
  assert.equal(start.searchParams.get('maxTotalChargeUsd'), '0.1');
  assert.equal(start.searchParams.get('restartOnError'), 'false');
  assert.deepEqual(JSON.parse(calls[0].options.body), { username: ['test.brand'], resultsLimit: 12, skipPinnedPosts: false, dataDetailLevel: 'basicData' });
  assert.equal(result.providerRunId, undefined);
});

test('missing credentials never make a network request and provider selection is explicit', async () => {
  await assert.rejects(scrapeWithApify('test.brand', { token: '', fetcher: () => assert.fail('unexpected request') }), { code: 'APIFY_NOT_CONFIGURED' });
  assert.equal(getExtractionProvider({ SCRAPE_PROVIDER: 'apify' }).configured, false);
  assert.equal(getExtractionProvider({ SCRAPE_PROVIDER: 'apify', APIFY_TOKEN: 'token' }).name, 'apify');
  assert.throws(() => getExtractionProvider({ SCRAPE_PROVIDER: 'typo' }), { code: 'INVALID_PROVIDER' });
});

test('an interrupted run is aborted; an ambiguous start is never retried', async () => {
  const calls = [];
  await assert.rejects(scrapeWithApify('test.brand', {
    token: 'token', fetcher: async (url, options) => {
      calls.push(url);
      if (calls.length === 1) return json({ data: { id: 'run123', status: 'RUNNING' } });
      if (url.endsWith('/abort')) { assert.equal(options.method, 'POST'); return json({ data: { id: 'run123', status: 'ABORTED' } }); }
      throw new DOMException('timeout', 'TimeoutError');
    },
  }), { code: 'APIFY_TIMEOUT' });
  assert.equal(calls.length, 3);
  assert.ok(calls[2].endsWith('/abort'));
  let starts = 0;
  await assert.rejects(scrapeWithApify('test.brand', { token: 'token', fetcher: async () => { starts += 1; throw new Error('connection lost'); } }), { code: 'APIFY_REQUEST_FAILED' });
  assert.equal(starts, 1);
});

test('provider authentication errors and failed runs never become a successful empty feed', async () => {
  await assert.rejects(scrapeWithApify('test.brand', { token: 'token', fetcher: async () => new Response('', { status: 401 }) }), { code: 'APIFY_AUTH' });
  await assert.rejects(scrapeWithApify('test.brand', { token: 'token', fetcher: async () => json({ data: { id: 'run123', status: 'FAILED' } }) }), { code: 'APIFY_RUN_FAILED' });
});
