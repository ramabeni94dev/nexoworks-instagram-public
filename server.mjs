import express from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { Store } from './lib/store.mjs';
import { WidgetService, TEMPLATES } from './lib/service.mjs';
import { ScrapeError } from './lib/instagram.mjs';
import { getExtractionProvider } from './lib/provider.mjs';
import { selectRefreshCandidates } from './lib/refresh-batch.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(String(value)).digest();
const equal = (left, right) => timingSafeEqual(digest(left), digest(right));
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback));

function embedOptions(query, widget) {
  const limit = typeof query.limit === 'string' ? Number(query.limit) : NaN;
  return {
    widgetTemplate: TEMPLATES.includes(query.template) ? query.template : widget.template,
    feedLimit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, widget.limit) : widget.limit,
    widgetTitle: typeof query.title === 'string' ? query.title.trim().slice(0, 160) : widget.title,
  };
}

export async function createApp({ dataDirectory = process.env.DATA_DIR || path.join(root, 'data'), adminToken = process.env.ADMIN_TOKEN || '', production = process.env.NODE_ENV === 'production', serviceOptions = {}, scheduler = true, cloud = !!process.env.VERCEL, storage, defer, externalRefresh = process.env.REFRESH_EXECUTOR === 'external' } = {}) {
  if ((production || adminToken) && adminToken.length < 32) throw new Error('ADMIN_TOKEN debe tener al menos 32 caracteres.');
  let blob;
  if (cloud) blob = await import('@vercel/blob');
  const store = storage || (cloud ? new (await import('./lib/blob-store.mjs')).BlobStore() : new Store(dataDirectory));
  await store.init();
  const provider = getExtractionProvider();
  const service = new WidgetService(store, {
    scrape: provider.scrape,
    externalRefresh,
    ttl: number(process.env.CACHE_TTL_MINUTES, 60, 15, 1440) * 60_000,
    timeout: number(process.env.SCRAPE_TIMEOUT_MS, 45000, 10000, 120000),
    ...(cloud ? { cache: (snapshot, id) => import('./lib/assets.mjs').then(({ cacheImages }) => cacheImages(snapshot, id, null, fetch, blob.put)), defer } : {}),
    ...serviceOptions,
  });
  if (scheduler && !cloud && !externalRefresh) service.startScheduler();
  const app = express();
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.cdninstagram.com https://*.fbcdn.net https://*.instagram.com; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    });
    // Local development never grants administrative access through a remote host.
    if (!adminToken && (!loopback(req.socket.remoteAddress) || !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname))) return res.status(403).json({ error: 'Acceso local únicamente. Configurá ADMIN_TOKEN para publicar.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  function authorized(req) {
    if (!adminToken) return true;
    const bearer = req.get('authorization');
    if (bearer?.startsWith('Bearer ') && equal(bearer.slice(7), adminToken)) return true;
    const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('nexo_public_session='))?.slice(20);
    if (!cookie) return false;
    const [expires, signature] = cookie.split('.');
    const expected = createHmac('sha256', adminToken).update(expires || '').digest('hex');
    return /^\d+$/.test(expires) && Number(expires) > Date.now() && Number(expires) <= Date.now() + 86400_000 && equal(signature, expected);
  }
  function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    let validOrigin = true;
    if (origin) {
      try { validOrigin = new URL(origin).host === req.get('host'); } catch { validOrigin = false; }
    }
    if (req.get('x-nexo-request') !== '1' || !validOrigin) return res.status(403).json({ error: 'La solicitud debe venir del panel de esta app.' });
    next();
  }
  const attempts = new Map();
  app.post('/api/login', csrf, (req, res) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const key = req.ip;
    const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
    if (attempt.count >= 10) return res.status(429).json({ error: 'Demasiados intentos. Esperá 15 minutos.' });
    if (adminToken && !equal(req.body?.token, adminToken)) {
      attempt.count += 1;
      attempts.set(key, attempt);
      return res.status(401).json({ error: 'La clave no es correcta.' });
    }
    attempts.delete(key);
    if (adminToken) {
      const expires = String(now + 12 * 3600_000);
      const signature = createHmac('sha256', adminToken).update(expires).digest('hex');
      res.cookie('nexo_public_session', `${expires}.${signature}`, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 12 * 3600_000, path: '/' });
    }
    res.json({ ok: true });
  });
  app.post('/api/logout', csrf, (_req, res) => { res.clearCookie('nexo_public_session', { path: '/' }); res.json({ ok: true }); });
  app.use('/api/admin', csrf, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!authorized(req)) return res.status(401).json({ error: 'Ingresá al panel para continuar.' });
    next();
  });
  app.get('/api/admin/widgets', (_req, res) => res.json({ widgets: service.list(), localMode: !adminToken, refreshMode: provider.name === 'apify' ? 'cloud-apify' : externalRefresh ? 'external' : cloud ? 'daily-and-on-demand' : 'hourly', extraction: { provider: provider.name, configured: provider.configured }, refreshIntervalMinutes: service.ttl / 60000 }));
  app.post('/api/admin/widgets', async (req, res) => res.status(202).json({ widget: await service.create(req.body || {}) }));
  app.patch('/api/admin/widgets/:id', async (req, res) => res.json({ widget: await service.edit(req.params.id, req.body || {}) }));
  app.delete('/api/admin/widgets/:id', async (req, res) => { await service.remove(req.params.id); res.json({ ok: true }); });
  app.post('/api/admin/widgets/:id/refresh', async (req, res) => res.status(202).json(await service.requestRefresh(req.params.id)));
  app.get('/api/public/widgets/:id/feed', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (cloud && !externalRefresh && provider.name !== 'apify') {
      const widget = store.get(req.params.id);
      if (widget && Date.now() - Date.parse(widget.lastAttemptAt || widget.createdAt) >= service.ttl) {
        try { service.refresh(widget.id); } catch { /* a refresh may already be in progress */ }
      }
    }
    res.json(service.feed(req.params.id));
  });
  app.get('/api/cron/refresh', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const secret = process.env.CRON_SECRET;
    if (!secret || !equal(req.get('authorization') || '', `Bearer ${secret}`)) return res.status(401).json({ error: 'No autorizado.' });
    if (externalRefresh) return res.json({ attempted: 0, executor: 'external' });
    if (!provider.configured) return res.status(503).json({ error: 'Falta configurar el proveedor de extracción.', code: 'APIFY_NOT_CONFIGURED' });
    const due = selectRefreshCandidates(store.list(), { ttl: service.ttl });
    const started = Date.now();
    let attempted = 0;
    for (const widget of due) {
      if (Date.now() - started > 100_000 || attempted >= 2) break;
      try { service.refresh(widget.id); await service.tail; attempted += 1; } catch { /* cooldown */ }
    }
    res.json({ attempted, failed: service.list().filter(widget => widget.lastAttemptAt && Date.parse(widget.lastAttemptAt) >= started && widget.error).map(widget => ({ username: widget.username, code: widget.error.code })) });
  });
  app.get('/api/public/widgets/:id/config.js', (req, res) => {
    const widget = store.get(req.params.id);
    if (!widget) throw new ScrapeError('NOT_FOUND', 'El widget no existe.', 404);
    const config = { clientLabel: widget.label, feedUrl: `/api/public/widgets/${widget.id}/feed`, ...embedOptions(req.query, widget), showConnectCta: false };
    res.set('Cache-Control', 'no-store').type('application/javascript').send(`window.__NEXOWORKS_IG_CONFIG=${JSON.stringify(config).replaceAll('<', '\\u003c')};`);
  });
  app.get('/embed/:id', (req, res) => {
    const widget = store.get(req.params.id);
    if (!widget) return res.status(404).type('text').send('El widget no existe.');
    const options = embedOptions(req.query, widget);
    const configQuery = new URLSearchParams({ template: options.widgetTemplate, limit: String(options.feedLimit), title: options.widgetTitle }).toString().replaceAll('&', '&amp;');
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram · NexoWorks</title><link rel="stylesheet" href="/assets/widget.css"><link rel="stylesheet" href="/assets/embed.css"><script src="/api/public/widgets/${widget.id}/config.js?${configQuery}" defer></script><script src="/assets/widget.js" defer></script></head><body><main id="nexoworks-instagram-root"></main></body></html>`);
  });
  app.use('/media', async (req, res, next) => {
    // Expired, deleted or newly private feeds no longer expose their cached media.
    const segments = req.path.split('/');
    let feed;
    try { feed = service.feed(segments[1]); } catch { return res.sendStatus(404); }
    const pathname = `/media${req.path}`;
    const knownImages = [feed.profile.profilePictureUrl, ...feed.media.map(item => item.previewUrl)];
    if (!knownImages.includes(pathname)) return res.sendStatus(404);
    if (!cloud) return next();
    const image = await blob.get(pathname.slice(1), { access: 'private', useCache: false });
    if (!image?.stream) return res.sendStatus(404);
    res.set({ 'Content-Type': image.blob.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=60' });
    Readable.fromWeb(image.stream).on('error', () => res.destroy()).pipe(res);
  }, ...(cloud ? [] : [express.static(path.join(store.directory, 'media'), { maxAge: 60_000, dotfiles: 'deny', index: false })]));
  app.use('/assets', express.static(path.join(root, 'public'), { maxAge: production ? 300_000 : 0, index: false }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
    res.sendFile(path.join(root, 'public', authorized(req) ? 'index.html' : 'login.html'));
  });
  app.use((_req, res) => res.status(404).json({ error: 'La ruta no existe.' }));
  app.use((error, _req, res, _next) => {
    const status = error instanceof ScrapeError ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    if (status === 500) console.error('Error interno:', error.message);
    res.status(status).json({ connected: false, code: error.code || 'REQUEST_ERROR', error: error instanceof ScrapeError ? error.message : status === 400 ? 'El JSON no es válido.' : status === 413 ? 'La solicitud es demasiado grande.' : 'No se pudo completar la solicitud.' });
  });
  return { app, service, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { app, service } = await createApp();
  const token = process.env.ADMIN_TOKEN || '';
  const host = token ? process.env.HOST || '0.0.0.0' : '127.0.0.1';
  const port = number(process.env.PORT, 3107, 1, 65535);
  const server = app.listen(port, host, () => console.log(`NexoWorks Instagram Public: http://${host}:${port}`));
  const close = () => { server.close(); void service.close().then(() => process.exit()); };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
