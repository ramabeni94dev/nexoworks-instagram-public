import { scrapeWithApify } from './apify.mjs';
import { ScrapeError } from './instagram.mjs';

export function getExtractionProvider(env = process.env) {
  const name = env.SCRAPE_PROVIDER || 'direct';
  if (name === 'direct') return { name, configured: true, scrape: (...args) => import('./scraper.mjs').then(({ scrapePublicProfile }) => scrapePublicProfile(...args)) };
  if (name === 'apify') return {
    name, configured: !!env.APIFY_TOKEN?.trim(),
    scrape: (username, options) => scrapeWithApify(username, {
      ...options, token: env.APIFY_TOKEN, maxChargeUsd: Number(env.APIFY_MAX_CHARGE_USD || '0.10'),
    }),
  };
  throw new ScrapeError('INVALID_PROVIDER', 'SCRAPE_PROVIDER debe ser direct o apify.', 503);
}
