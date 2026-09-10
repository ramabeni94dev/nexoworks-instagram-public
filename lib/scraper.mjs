import { chromium } from 'playwright';
import { normalizeUsername, parseInstagramPage, parseInstagramResponse, ScrapeError } from './instagram.mjs';

export async function scrapePublicProfile(input, { timeout = 45000, executablePath = process.env.CHROMIUM_EXECUTABLE_PATH, onDiagnostic } = {}) {
  const username = normalizeUsername(input);
  let browser;
  let lastSnapshot;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    void browser?.close().catch(() => {});
  }, timeout);
  try {
    // First try the public document. No credentials, saved sessions or private API tokens.
    const response = await fetch(`https://www.instagram.com/${username}/`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (response.status === 429) throw new ScrapeError('RATE_LIMITED', 'Instagram limitó las consultas. Se reintentará más tarde.', 429);
    if (response.status === 404) throw new ScrapeError('PROFILE_NOT_FOUND', 'No se encontró ese perfil de Instagram.', 404);
    const renderInBrowser = [301, 302, 303, 307, 308, 401, 403].includes(response.status);
    if (!response.ok && !renderInBrowser) throw new ScrapeError('UPSTREAM_ERROR', `Instagram respondió con un error (${response.status}).`);
    if (response.ok) {
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8_000_000) throw new ScrapeError('RESPONSE_TOO_LARGE', 'La respuesta de Instagram supera el tamaño esperado.');
        chunks.push(chunk);
      }
      const html = Buffer.concat(chunks).toString('utf8');
      try {
        lastSnapshot = parseInstagramPage(html, username);
        if (lastSnapshot.media.length || lastSnapshot.profile.mediaCount === 0) return { ...lastSnapshot, source: 'public-html' };
      } catch (error) {
        if (!['PROFILE_UNAVAILABLE', 'LOGIN_REQUIRED'].includes(error.code)) throw error;
      }
    } else {
      await response.body?.cancel();
    }
    if (controller.signal.aborted) throw new Error('timeout');

    // Render the same public page when posts are loaded with JavaScript.
    let args = [];
    if (process.env.VERCEL && !executablePath) {
      const { default: serverlessChromium } = await import('@sparticuz/chromium');
      executablePath = await serverlessChromium.executablePath();
      args = serverlessChromium.args;
    }
    browser = await chromium.launch({ headless: true, executablePath: executablePath || undefined, args, timeout: Math.min(timeout, 20000) });
    if (controller.signal.aborted) throw new Error('timeout');
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue());
    const payloads = [];
    const responses = [];
    const pending = new Set();
    let limited = false;
    page.on('response', response => {
      const url = new URL(response.url());
      if (!['www.instagram.com', 'i.instagram.com'].includes(url.hostname)) return;
      if (onDiagnostic && responses.length < 50) responses.push({ path: url.pathname, status: response.status(), type: response.headers()['content-type'] });
      if (response.status() === 429) limited = true;
      const contentType = response.headers()['content-type'] || '';
      const isGraphql = /^\/(?:api\/)?graphql(?:\/query)?\/?$/.test(url.pathname);
      if ((!contentType.includes('json') && !(isGraphql && contentType.includes('javascript'))) || payloads.length >= 30) return;
      const job = response.text().then(body => {
        if (body.length < 3_000_000) {
          payloads.push(...parseInstagramResponse(body).slice(0, 30 - payloads.length));
        }
      }).catch(() => {}).finally(() => pending.delete(job));
      pending.add(job);
    });
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout });
    // Cookie choice is optional and never supplies an account or crosses a login wall.
    const consent = page.getByRole('button', { name: /Decline optional cookies|Only allow essential cookies/i }).first();
    if (await consent.isVisible().catch(() => false)) await consent.click();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (limited) throw new ScrapeError('RATE_LIMITED', 'Instagram limitó las consultas. Se reintentará más tarde.', 429);
      if (/\/accounts\/login|\/challenge\/|\/checkpoint\//.test(page.url())) throw new ScrapeError('LOGIN_REQUIRED', 'Instagram pide iniciar sesión o verificar el acceso. No se pudo leer el feed público.', 422);
      await Promise.allSettled([...pending]);
      try {
        lastSnapshot = parseInstagramPage(await page.content(), username, payloads);
        if (lastSnapshot.media.length || lastSnapshot.profile.mediaCount === 0) return { ...lastSnapshot, source: 'public-browser' };
      } catch (error) {
        if (!['PROFILE_UNAVAILABLE', 'LOGIN_REQUIRED'].includes(error.code) || attempt === 11) throw error;
      }
      await page.waitForTimeout(1000);
    }
    if (onDiagnostic) await onDiagnostic({
      responses,
      payloadCount: payloads.length,
      page: await page.evaluate(() => ({
        title: document.title,
        mainCount: document.querySelectorAll('main, [role="main"]').length,
        imageCount: document.querySelectorAll('img').length,
        postLinks: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(href => /\/(p|reel)\//.test(href)).slice(0, 30),
        text: (document.querySelector('main, [role="main"]') || document.body).innerText.slice(0, 3000),
      })),
    });
    throw new ScrapeError('POSTS_UNAVAILABLE', 'Se pudo leer el perfil, pero no se pudieron extraer sus publicaciones. Esto no significa que la cuenta esté vacía.', 422);
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    if (controller.signal.aborted || error.name === 'TimeoutError') throw new ScrapeError('TIMEOUT', 'Instagram tardó demasiado en responder. Probá más tarde.', 504);
    if (/Executable doesn't exist|browserType.launch/.test(error.message)) throw new ScrapeError('BROWSER_UNAVAILABLE', 'Falta el navegador del scraper. Ejecutá npm run install:browser en el servidor.', 503);
    throw new ScrapeError('NETWORK_ERROR', 'No se pudo completar la consulta pública a Instagram. Probá más tarde.');
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}
