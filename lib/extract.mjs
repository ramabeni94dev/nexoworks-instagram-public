import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeUsername, ScrapeError } from './instagram.mjs';
import { scrapePublicProfile } from './scraper.mjs';
import { cacheImages } from './assets.mjs';

// A standalone run: public profile -> downloaded previews -> a portable dataset.
// It uses the same extractor and image validation as the widgets.
export async function extractProfile(input, {
  outputDirectory = './artifacts/extractions', limit = 12, timeout = 90000,
  scrape = scrapePublicProfile, cache = cacheImages,
} = {}) {
  const username = normalizeUsername(input);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const directory = path.resolve(outputDirectory, `${username}-${runId}`);
  await mkdir(directory, { recursive: true });
  let result;
  try {
    const snapshot = await scrape(username, { timeout });
    if (!snapshot.media.length && snapshot.profile.mediaCount !== 0) {
      throw new ScrapeError('POSTS_UNAVAILABLE', 'Instagram no entregó publicaciones. No se puede confirmar que el perfil esté vacío.', 422);
    }
    snapshot.media = snapshot.media.slice(0, Math.max(1, Math.min(24, Math.floor(Number(limit) || 12))));
    const assets = await cache(snapshot, runId, directory);
    const localFile = url => typeof url === 'string' && url.startsWith(`/media/${runId}/`) ? `.${url}` : null;
    const items = assets.snapshot.media.map(post => ({
      id: post.id,
      shortCode: post.shortcode,
      type: post.mediaType,
      url: post.permalink,
      ownerUsername: username,
      caption: post.caption || null,
      timestamp: post.timestamp || null,
      displayUrl: post.previewUrl.startsWith('/media/') ? null : post.previewUrl,
      imageFile: localFile(post.previewUrl),
      carouselItemCount: post.childCount || null,
    }));
    result = {
      runId, username, status: 'SUCCEEDED', startedAt, finishedAt: new Date().toISOString(),
      source: snapshot.source || 'public-page',
      extractedPosts: items.length, imagesSaved: items.filter(item => item.imageFile).length,
      missedImages: assets.missed,
      profile: { ...assets.snapshot.profile, profilePictureFile: localFile(assets.snapshot.profile.profilePictureUrl) },
      items,
    };
    await writeFile(path.join(directory, 'dataset.json'), JSON.stringify(items, null, 2));
    const columns = ['id', 'shortCode', 'type', 'url', 'ownerUsername', 'caption', 'timestamp', 'displayUrl', 'imageFile', 'carouselItemCount'];
    // Neutralize spreadsheet formulas in text obtained from public profiles.
    const csvCell = value => {
      let cell = value === null || value === undefined ? '' : String(value);
      if (/^[\s]*[=+@-]/.test(cell)) cell = `'${cell}`;
      return `"${cell.replaceAll('"', '""')}"`;
    };
    await writeFile(path.join(directory, 'dataset.csv'), '\uFEFF' + [columns.join(','), ...items.map(item => columns.map(column => csvCell(item[column])).join(','))].join('\r\n'));
    await assets.cleanup?.();
  } catch (error) {
    result = {
      runId, username, status: 'FAILED', startedAt, finishedAt: new Date().toISOString(),
      error: { code: error.code || 'EXTRACT_FAILED', message: error instanceof ScrapeError ? error.message : 'No se pudo completar la extracción.' },
    };
  }
  await writeFile(path.join(directory, 'run.json'), JSON.stringify(result, null, 2));
  return { ...result, directory };
}
