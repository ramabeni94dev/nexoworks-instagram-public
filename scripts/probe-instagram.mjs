import { scrapePublicProfile } from '../lib/scraper.mjs';

// One extraction without changing widget storage. Suitable for a one-off container.
const username = process.argv[2] || process.env.PROBE_USERNAME;
const started = Date.now();
const hardTimeout = setTimeout(() => {
  console.error(JSON.stringify({ event: 'probe-result', ok: false, code: 'JOB_TIMEOUT', elapsedMs: Date.now() - started }));
  process.exit(1);
}, 120_000);

try {
  if (!username) throw new Error('Indicá el usuario con npm run probe -- @usuario o PROBE_USERNAME.');
  console.log(JSON.stringify({ event: 'probe-start', username, at: new Date().toISOString(), environment: process.env.RAILWAY_SERVICE_ID ? 'railway' : 'local' }));
  const snapshot = await scrapePublicProfile(username, {
    timeout: 90_000,
    onDiagnostic: data => console.log(JSON.stringify({ event: 'probe-diagnostic', ...data })),
  });
  console.log(JSON.stringify({
    event: 'probe-result', ok: true, username: snapshot.profile.username,
    source: snapshot.source, mediaCount: snapshot.profile.mediaCount,
    extractedPosts: snapshot.media.length,
    posts: snapshot.media.map(post => ({ shortcode: post.shortcode, type: post.mediaType })),
    elapsedMs: Date.now() - started,
  }));
} catch (error) {
  console.error(JSON.stringify({ event: 'probe-result', ok: false, username, code: error.code || 'ERROR', message: error.message, elapsedMs: Date.now() - started }));
  process.exitCode = 1;
} finally {
  clearTimeout(hardTimeout);
}
