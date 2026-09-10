import { mkdir, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { safeUrl } from './instagram.mjs';

export async function cacheImages(snapshot, id, dataDirectory, fetcher = fetch, upload) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid widget id');
  const directory = upload ? null : path.join(dataDirectory, 'media', id);
  if (directory) await mkdir(directory, { recursive: true });
  const result = structuredClone(snapshot);
  const keep = new Set();
  const targets = [
    { object: result.profile, key: 'profilePictureUrl', name: 'profile' },
    ...result.media.map(item => ({ object: item, key: 'previewUrl', name: item.shortcode })),
  ];
  let missed = 0;
  // Bound parallelism and download size; only Instagram CDN URLs from the scraper.
  const queue = [...targets];
  const worker = async () => {
    while (queue.length) {
      const target = queue.shift();
      if (!target.object[target.key]) continue;
      try {
        const url = safeUrl(target.object[target.key], { media: true });
        if (!url || !/^[\w-]{1,100}$/.test(target.name)) throw new Error('Invalid image');
        const response = await fetcher(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[response.headers.get('content-type')?.split(';')[0]];
        if (!response.ok || !extension) throw new Error('Image unavailable');
        let size = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 4_000_000) throw new Error('Image too large');
          chunks.push(chunk);
        }
        const filename = `${target.name}.${extension}`;
        if (upload) {
          await upload(`media/${id}/${filename}`, Buffer.concat(chunks), {
            access: 'private', contentType: response.headers.get('content-type'),
            addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
          });
        } else {
          const file = path.join(directory, filename);
          await writeFile(`${file}.tmp`, Buffer.concat(chunks));
          await rename(`${file}.tmp`, file);
        }
        keep.add(filename);
        target.object[target.key] = `/media/${id}/${filename}`;
      } catch {
        missed += 1; // Retain the public CDN URL if this individual download fails.
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  // Only remove old managed images after the new snapshot is committed.
  return { snapshot: result, missed, cleanup: async (committed = result) => {
    if (!directory) return;
    // The posts provider can retain a previously cached profile picture.
    // Keep every managed image referenced by the committed snapshot.
    const prefix = `/media/${id}/`;
    for (const url of [committed.profile?.profilePictureUrl, ...committed.media.map(item => item.previewUrl)]) {
      if (typeof url === 'string' && url.startsWith(prefix)) {
        const filename = url.slice(prefix.length);
        if (/^[\w-]+\.(jpg|png|webp|avif)$/.test(filename)) keep.add(filename);
      }
    }
    for (const filename of await readdir(directory)) {
      if (/^[\w-]+\.(jpg|png|webp|avif)$/.test(filename) && !keep.has(filename)) await unlink(path.join(directory, filename));
    }
  } };
}
