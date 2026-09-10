import { randomUUID } from 'node:crypto';
import { normalizeUsername, ScrapeError } from './instagram.mjs';
import { cacheImages } from './assets.mjs';

export const TEMPLATES = ['slider', 'grid', 'collage', 'post-slider', 'single-post', 'hashtag-show', 'photo-wall', 'social-cards'];
const MIN_REFRESH = 60_000;
const MAX_STALE = 24 * 60 * 60_000;
const scrapePublicProfile = (...args) => import('./scraper.mjs').then(module => module.scrapePublicProfile(...args));

export class WidgetService {
  constructor(store, { scrape = scrapePublicProfile, cache = cacheImages, ttl = 60 * 60_000, timeout = 45000, now = () => Date.now(), defer, externalRefresh = false } = {}) {
    Object.assign(this, { store, scrape, cache, ttl, timeout, now, defer, externalRefresh });
    this.jobs = new Map();
    this.tail = Promise.resolve();
    this.blockedUntil = 0;
  }
  list() {
    return this.store.list().map(widget => ({ ...widget, refreshQueued: !!widget.refreshRequestedAt, refreshing: this.jobs.has(widget.id) || Number(widget.refreshLease?.expiresAt) > this.now(), available: !!widget.snapshot && this.now() - Date.parse(widget.fetchedAt) <= MAX_STALE, stale: !!widget.fetchedAt && this.now() - Date.parse(widget.fetchedAt) > this.ttl }));
  }
  async create(input) {
    const username = normalizeUsername(input.username);
    const widget = {
      id: randomUUID(), username,
      label: String(input.label || username).trim().slice(0, 120),
      title: String(input.title || 'Follow us on Instagram').trim().slice(0, 160),
      template: TEMPLATES.includes(input.template) ? input.template : 'slider',
      limit: Math.max(1, Math.min(24, Math.round(Number(input.limit) || 12))),
      createdAt: new Date(this.now()).toISOString(), fetchedAt: null, lastAttemptAt: null,
      error: null, snapshot: null, autoRefresh: true,
    };
    await this.store.update(widgets => {
      if (widgets.length >= 100) throw new ScrapeError('WIDGET_LIMIT', 'Esta instalación admite hasta 100 widgets.', 409);
      if (widgets.some(item => item.username === username)) throw new ScrapeError('DUPLICATE_PROFILE', 'Ya existe un widget para ese usuario.', 409);
      widgets.push(widget);
    });
    try { await this.requestRefresh(widget.id); } catch (error) {
      await this.store.update(widgets => {
        const current = widgets.find(item => item.id === widget.id);
        if (current) current.error = { code: error.code, message: error.message, at: new Date(this.now()).toISOString() };
      });
    }
    return widget;
  }
  async remove(id) {
    await this.store.update(widgets => {
      const index = widgets.findIndex(widget => widget.id === id);
      if (index < 0) throw new ScrapeError('NOT_FOUND', 'El widget no existe.', 404);
      widgets.splice(index, 1);
    });
  }
  async edit(id, input) {
    await this.store.update(widgets => {
      const widget = widgets.find(item => item.id === id);
      if (!widget) throw new ScrapeError('NOT_FOUND', 'El widget no existe.', 404);
      if ('label' in input) widget.label = String(input.label).trim().slice(0, 120) || widget.username;
      if ('title' in input) widget.title = String(input.title).trim().slice(0, 160) || 'Follow us on Instagram';
      if ('template' in input && TEMPLATES.includes(input.template)) widget.template = input.template;
      if ('limit' in input) widget.limit = Math.max(1, Math.min(24, Math.round(Number(input.limit) || 12)));
      if (typeof input.autoRefresh === 'boolean') widget.autoRefresh = input.autoRefresh;
    });
    return this.store.get(id);
  }
  refresh(id) {
    const widget = this.store.get(id);
    if (!widget) throw new ScrapeError('NOT_FOUND', 'El widget no existe.', 404);
    if (this.jobs.has(id)) return { queued: true };
    if (this.blockedUntil > this.now()) throw new ScrapeError('COOLDOWN', 'Las consultas están en pausa durante 15 minutos por un límite de Instagram.', 429);
    if (widget.lastAttemptAt && this.now() - Date.parse(widget.lastAttemptAt) < MIN_REFRESH) throw new ScrapeError('COOLDOWN', 'Esperá un minuto antes de volver a actualizar este perfil.', 429);
    const job = this.tail.then(() => this.run(id)).catch(error => {
      console.error('No se pudo guardar la actualización:', error.message);
    }).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
    this.tail = job;
    this.defer?.(job);
    return { queued: true };
  }
  async requestRefresh(id) {
    if (!this.externalRefresh) return this.refresh(id);
    await this.store.update(widgets => {
      const current = widgets.find(widget => widget.id === id);
      if (!current) throw new ScrapeError('NOT_FOUND', 'El widget no existe.', 404);
      if (current.refreshRequestedAt || current.refreshLease?.expiresAt > this.now()) return;
      if (current.lastAttemptAt && this.now() - Date.parse(current.lastAttemptAt) < MIN_REFRESH) {
        throw new ScrapeError('COOLDOWN', 'Esperá un minuto antes de volver a actualizar este perfil.', 429);
      }
      current.refreshRequestedAt = new Date(this.now()).toISOString();
    });
    return { queued: true, executor: 'external' };
  }
  async run(id) {
    const widget = this.store.get(id);
    if (!widget || this.blockedUntil > this.now()) return;
    const owner = randomUUID();
    const claimed = await this.store.update((widgets, state) => {
      const current = widgets.find(item => item.id === id);
      if (!current) return false;
      if (this.store.distributed) {
        state.runtime ||= {};
        if (current.lastAttemptAt && this.now() - Date.parse(current.lastAttemptAt) < MIN_REFRESH) return false;
        if (state.runtime.blockedUntil > this.now() || state.runtime.scrapeLease?.expiresAt > this.now()) {
          current.error = { code: 'COOLDOWN', message: 'Hay otra consulta en curso o una pausa de Instagram. Reintentá en unos minutos.', at: new Date(this.now()).toISOString() };
          return false;
        }
        state.runtime.scrapeLease = { owner, expiresAt: this.now() + 240_000 };
        current.refreshLease = { owner, expiresAt: this.now() + 240_000 };
      }
      current.lastAttemptAt = new Date(this.now()).toISOString();
      delete current.refreshRequestedAt;
      return true;
    });
    if (!claimed) return;
    try {
      const raw = await this.scrape(widget.username, { timeout: this.timeout, limit: widget.limit });
      const assets = await this.cache(raw, id, this.store.directory);
      await this.store.update((widgets, state) => {
        const current = widgets.find(item => item.id === id);
        if (current && (!this.store.distributed || current.refreshLease?.owner === owner)) {
          if (assets.snapshot.incompleteProfile && current.snapshot?.profile?.username === assets.snapshot.profile.username) {
            for (const field of ['biography', 'website', 'profilePictureUrl', 'followersCount', 'followsCount', 'mediaCount']) {
              if (assets.snapshot.profile[field] === '' || assets.snapshot.profile[field] == null) assets.snapshot.profile[field] = current.snapshot.profile[field];
            }
          }
          Object.assign(current, { snapshot: assets.snapshot, fetchedAt: new Date(this.now()).toISOString(), error: null, imageWarning: assets.missed ? `${assets.missed} imágenes usan enlaces de Instagram que pueden vencer.` : null });
          delete current.refreshLease;
        }
        if (state.runtime?.scrapeLease?.owner === owner) delete state.runtime.scrapeLease;
      });
      await assets.cleanup?.(assets.snapshot).catch(() => {});
    } catch (error) {
      if (error.code === 'RATE_LIMITED') this.blockedUntil = this.now() + 15 * 60_000;
      await this.store.update((widgets, state) => {
        if (state.runtime?.scrapeLease?.owner === owner) delete state.runtime.scrapeLease;
        if (this.store.distributed && error.code === 'RATE_LIMITED') {
          state.runtime ||= {};
          state.runtime.blockedUntil = this.blockedUntil;
        }
        const current = widgets.find(item => item.id === id);
        if (!current || (this.store.distributed && current.refreshLease?.owner !== owner)) return;
        delete current.refreshLease;
        current.error = { code: error.code || 'SCRAPE_FAILED', message: error instanceof ScrapeError ? error.message : 'No se pudo actualizar el perfil.', at: new Date(this.now()).toISOString() };
        if (['PRIVATE_PROFILE', 'PROFILE_NOT_FOUND'].includes(error.code)) {
          current.snapshot = null;
          current.fetchedAt = null;
        }
      });
    }
  }
  feed(id) {
    const widget = this.store.get(id);
    if (!widget) throw new ScrapeError('NOT_FOUND', 'El widget no existe.', 404);
    if (!widget.snapshot || this.now() - Date.parse(widget.fetchedAt) > MAX_STALE) throw new ScrapeError('FEED_UNAVAILABLE', 'Las publicaciones no están disponibles en este momento.', 503);
    const media = widget.snapshot.media.slice(0, widget.limit);
    return { connected: true, ...widget.snapshot, media, fetchedAt: widget.fetchedAt, stale: this.now() - Date.parse(widget.fetchedAt) > this.ttl };
  }
  startScheduler() {
    const tick = () => {
      for (const widget of this.store.list()) {
        if (widget.autoRefresh === false) continue;
        const last = Date.parse(widget.lastAttemptAt || widget.createdAt);
        const interval = widget.error ? Math.max(this.ttl, 15 * 60_000) : this.ttl;
        if (this.now() - last >= interval) {
          try { this.refresh(widget.id); } catch { /* cooldown or already deleted */ }
        }
      }
    };
    tick();
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
  }
  async close() { clearInterval(this.timer); await this.tail; }
}
