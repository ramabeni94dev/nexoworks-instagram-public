import { scrapePublicProfile } from '../lib/scraper.mjs';
try {
  if (!process.argv[2]) throw new Error('Uso: npm run scrape -- @usuario');
  console.log(JSON.stringify(await scrapePublicProfile(process.argv[2]), null, 2));
} catch (error) {
  console.error(`${error.code || 'ERROR'}: ${error.message}`);
  process.exitCode = 1;
}
