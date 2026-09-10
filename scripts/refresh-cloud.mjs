import { parseArgs } from 'node:util';
import { put } from '@vercel/blob';
import { BlobStore } from '../lib/blob-store.mjs';
import { WidgetService } from '../lib/service.mjs';
import { cacheImages } from '../lib/assets.mjs';
import { normalizeUsername } from '../lib/instagram.mjs';
import { selectRefreshCandidates } from '../lib/refresh-batch.mjs';

// Run from a machine that can access the public profile. No web server stays open.
// Conditional writes and the shared lease protect concurrent edits in Vercel.
try {
  const { values } = parseArgs({ options: { username: { type: 'string' } } });
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Falta BLOB_READ_WRITE_TOKEN para actualizar los widgets publicados.');
  const username = values.username ? normalizeUsername(values.username) : null;
  const store = new BlobStore();
  await store.init();
  const service = new WidgetService(store, {
    ttl: Math.max(15, Math.min(1440, Number(process.env.CACHE_TTL_MINUTES) || 360)) * 60000,
    timeout: 90000,
    cache: (snapshot, id) => cacheImages(snapshot, id, null, fetch, put),
  });
  const candidates = selectRefreshCandidates(store.list(), { username, ttl: service.ttl });
  if (username && !candidates.length) throw new Error('No existe un widget publicado para ese usuario.');
  const started = Date.now();
  let attempted = 0;
  try {
    for (const widget of candidates.slice(0, 4)) {
      if (Date.now() - started > 150000) break;
      const previousAttempt = widget.lastAttemptAt;
      await service.run(widget.id);
      const current = store.get(widget.id);
      const attemptedNow = !!current && current.lastAttemptAt !== previousAttempt;
      if (attemptedNow) attempted += 1;
      const status = !current ? 'DELETED' : !attemptedNow ? 'SKIPPED' : current.error ? 'FAILED' : 'SUCCEEDED';
      console.log(JSON.stringify({ username: widget.username, status, posts: current?.snapshot?.media.length || 0, fetchedAt: current?.fetchedAt, error: current?.error, imageWarning: current?.imageWarning }));
      if (status === 'FAILED') process.exitCode = 1;
      if (current?.error?.code === 'RATE_LIMITED' || service.blockedUntil > Date.now()) break;
    }
  } finally { await service.close(); }
  console.log(JSON.stringify({ event: 'batch-complete', attempted, elapsedMs: Date.now() - started }));
} catch (error) {
  console.error(`No se pudo completar la actualización: ${error.message}`);
  process.exitCode = 1;
}
