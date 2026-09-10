import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, safeUrl, parseInstagramPage, parseInstagramResponse } from '../lib/instagram.mjs';
import { user, post, html } from './fixtures.mjs';

test('accepts public profile usernames and canonical URLs', () => {
  for (const value of ['@Test.Brand', 'test.brand', 'https://www.instagram.com/Test.Brand/?igsh=abc']) assert.equal(normalizeUsername(value), 'test.brand');
});
test('rejects arbitrary hosts, posts, paths and invalid usernames', () => {
  for (const value of ['https://evil.test/test.brand', 'https://instagram.com.evil.test/a', 'https://instagram.com@evil.test/a', 'https://instagram.com:443@evil.test/a', 'https://instagram.com:81/a', 'http://127.0.0.1', '../secret', 'a/b', 'a..b', 'a.', '.a', '@@a', 'https://instagram.com/p/abc/', 'a'.repeat(31), '']) assert.throws(() => normalizeUsername(value), { code: 'INVALID_USERNAME' }, value);
});
test('extracts public profile, counts and feed from embedded JSON', () => {
  const result = parseInstagramPage(html({ data: { user } }), 'test.brand');
  assert.equal(result.profile.followersCount, 123);
  assert.equal(result.profile.biography, user.biography);
  assert.equal(result.media[0].caption, 'Texto de prueba\n#diseño');
  assert.equal(result.media[0].timestamp, '2023-11-14T22:13:20.000Z');
  assert.equal(result.summary.totalMedia, 1);
});
test('extracts browser profile feed and excludes other owners', () => {
  const result = parseInstagramPage(html({}), 'test.brand', [{ data: { xdt_api__v1__feed__user_timeline_graphql_connection: { edges: [
    { node: { code: 'REEL_01', media_type: 2, product_type: 'clips', image_versions2: { candidates: [{ url: post.display_url }] }, caption: { text: 'Reel público' }, user: { username: 'test.brand' } } },
    { node: { ...post, shortcode: 'OTHER', owner: { username: 'other.brand' } } },
  ] } } }]);
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].mediaType, 'reel');
  assert.equal(result.media[0].permalink, 'https://www.instagram.com/reel/REEL_01/');
});
test('carousel preview falls back to its first child without making up missing data', () => {
  const result = parseInstagramPage(html({ user: { ...user, edge_owner_to_timeline_media: { edges: [{ node: { shortcode: 'CAROUSEL', __typename: 'GraphSidecar', edge_sidecar_to_children: { edges: [{ node: { display_url: post.display_url } }] } } }] } } }), 'test.brand');
  assert.equal(result.media[0].mediaType, 'carousel');
  assert.equal(result.media[0].childCount, 1);
  assert.equal(result.media[0].timestamp, '');
});
test('private accounts are rejected even when metadata and posts are present', () => {
  assert.throws(() => parseInstagramPage(html({ user: { ...user, is_private: true } }), 'test.brand'), { code: 'PRIVATE_PROFILE' });
});
test('classifies login walls and missing profiles', () => {
  assert.throws(() => parseInstagramPage('<main><input name="username">Log in</main>', 'test.brand'), { code: 'LOGIN_REQUIRED' });
  assert.throws(() => parseInstagramPage('<main>Sorry, this page isn\'t available.</main>', 'test.brand'), { code: 'PROFILE_NOT_FOUND' });
});
test('metadata decoding retains unknown counts as null', () => {
  const result = parseInstagramPage(html({}).replace('</head>', '<meta property="og:description" content="1.2K Followers, 10 Following, 30 Posts"><meta name="description" content="Brand on Instagram: &quot;A &amp; B&quot;"></head>'), 'test.brand');
  assert.equal(result.profile.followersCount, null);
  assert.equal(result.profile.biography, 'A & B');
});
test('does not turn markup or untrusted URLs into executable media', () => {
  for (const value of ['javascript:alert(1)', 'http://localhost/a', 'https://evil.test/x', 'https://cdninstagram.com.evil.test/x', 'https://user:pass@cdninstagram.com/x']) assert.equal(safeUrl(value, { media: true }), '');
  assert.equal(parseInstagramPage(html({ user: { ...user, edge_owner_to_timeline_media: { edges: [{ node: { ...post, display_url: 'javascript:alert(1)' } }] } } }), 'test.brand').media.length, 0);
});

test('recognizes current public post URLs containing the profile username', () => {
  const document = html({}).replace('<main></main>', `<div role="main">
    <a href="/test.brand/p/CURRENT_POST/"><img src="${post.display_url}"></a>
    <a href="/test.brand/reel/CURRENT_REEL/"><img src="${post.display_url}"></a>
    <a href="/other.brand/p/UNRELATED/"><img src="${post.display_url}"></a>
    <a href="/p/LEGACY_POST/"><img src="${post.display_url}"></a>
  </div>`);
  const result = parseInstagramPage(document, 'test.brand');
  assert.deepEqual(result.media.map(item => item.shortcode), ['CURRENT_POST', 'CURRENT_REEL', 'LEGACY_POST']);
  assert.equal(result.media[1].mediaType, 'reel');
});

test('reads GraphQL JSON delivered as JavaScript with an anti-XSSI prefix', () => {
  const result = parseInstagramResponse(`for (;;);${JSON.stringify({ data: { user } })}`);
  assert.equal(parseInstagramPage(html({}), 'test.brand', result).media.length, 1);
});

test('reads streamed GraphQL records without executing JavaScript', () => {
  assert.deepEqual(parseInstagramResponse('for (;;);{"data":{"a":1}}\n{"data":{"b":2}}'), [{ data: { a: 1 } }, { data: { b: 2 } }]);
  assert.deepEqual(parseInstagramResponse('alert("not JSON");'), []);
});
