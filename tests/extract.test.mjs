import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractProfile } from '../lib/extract.mjs';
import { parseInstagramPage, ScrapeError } from '../lib/instagram.mjs';
import { cacheImages } from '../lib/assets.mjs';
import { user, html } from './fixtures.mjs';

async function directory(t) {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'nexo-extract-'));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  return outputDirectory;
}

test('standalone extraction creates a portable dataset and downloads its image files', async t => {
  const outputDirectory = await directory(t);
  const snapshot = parseInstagramPage(html({ user }), 'test.brand');
  snapshot.media[0].caption = '=HYPERLINK("https://example.test")';
  const result = await extractProfile('@test.brand', {
    outputDirectory,
    scrape: async () => snapshot,
    cache: (data, id, root) => cacheImages(data, id, root, async () => new Response('image-bytes', { headers: { 'content-type': 'image/jpeg' } })),
  });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.imagesSaved, 1);
  const items = JSON.parse(await readFile(path.join(result.directory, 'dataset.json'), 'utf8'));
  assert.equal(await readFile(path.resolve(result.directory, items[0].imageFile), 'utf8'), 'image-bytes');
  assert.equal(items[0].displayUrl, null);
  assert.match(await readFile(path.join(result.directory, 'dataset.csv'), 'utf8'), /'=HYPERLINK/);
});

test('restricted access creates a failed run instead of a successful empty dataset', async t => {
  const outputDirectory = await directory(t);
  const result = await extractProfile('test.brand', { outputDirectory, scrape: async () => { throw new ScrapeError('LOGIN_REQUIRED', 'Acceso restringido'); } });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'LOGIN_REQUIRED');
  assert.equal(JSON.parse(await readFile(path.join(result.directory, 'run.json'), 'utf8')).status, 'FAILED');
  await assert.rejects(readFile(path.join(result.directory, 'dataset.json')), { code: 'ENOENT' });
});

test('missing posts are not treated as an empty account without an explicit zero count', async t => {
  const result = await extractProfile('test.brand', {
    outputDirectory: await directory(t),
    scrape: async () => ({ profile: { username: 'test.brand', mediaCount: null }, media: [] }),
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'POSTS_UNAVAILABLE');
});
