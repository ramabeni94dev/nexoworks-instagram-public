import { setTimeout as delay } from 'node:timers/promises';
import { normalizeUsername, parseInstagramPage, safeUrl, ScrapeError } from './instagram.mjs';

const endpoint = 'https://api.apify.com/v2';
const terminal = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(value);

export function parseApifyPosts(items, input) {
  const username = normalizeUsername(input);
  if (!Array.isArray(items)) throw new ScrapeError('APIFY_INVALID_RESULT', 'Apify devolvió un resultado no reconocible.');
  const owned = items.filter(item => item && typeof item.ownerUsername === 'string' && item.ownerUsername.toLowerCase() === username && !item.error);
  if (owned.some(item => item.isPrivate === true)) throw new ScrapeError('PRIVATE_PROFILE', 'Apify identificó el perfil como privado.', 422);
  const nodes = owned.map(item => ({
    id: item.id, code: item.shortCode,
    owner: { username },
    display_url: safeUrl(item.displayUrl, { media: true }),
    caption: typeof item.caption === 'string' ? item.caption : '',
    taken_at: typeof item.timestamp === 'string' ? Date.parse(item.timestamp) / 1000 : undefined,
    product_type: item.productType,
    is_video: item.type === 'Video',
    __typename: item.type === 'Sidecar' ? 'GraphSidecar' : undefined,
    carousel_media: Array.isArray(item.childPosts) ? item.childPosts.slice(0, 20).map(child => ({ display_url: safeUrl(child?.displayUrl, { media: true }) })) : undefined,
  }));
  const first = owned[0];
  // The post Actor does not provide a complete profile. Unknown counts stay null.
  const profile = { username, full_name: first?.ownerFullName || '', id: first?.ownerId || '' };
  const snapshot = parseInstagramPage('', username, [{ profile, posts: nodes }]);
  if (!snapshot.media.length) throw new ScrapeError('POSTS_UNAVAILABLE', 'Apify no entregó publicaciones con imágenes para este usuario. No se puede confirmar que el perfil esté vacío.', 422);
  return { ...snapshot, source: 'apify', incompleteProfile: true };
}

export async function scrapeWithApify(input, {
  token = process.env.APIFY_TOKEN, timeout = 90000, limit = 12,
  maxChargeUsd = Number(process.env.APIFY_MAX_CHARGE_USD || '0.10'),
  fetcher = fetch, now = () => Date.now(), wait = delay,
} = {}) {
  const username = normalizeUsername(input);
  if (!token?.trim()) throw new ScrapeError('APIFY_NOT_CONFIGURED', 'Falta conectar Apify: agregá APIFY_TOKEN en las variables del servicio.', 503);
  if (!Number.isFinite(maxChargeUsd) || maxChargeUsd <= 0 || maxChargeUsd > 1) throw new ScrapeError('APIFY_INVALID_CONFIG', 'APIFY_MAX_CHARGE_USD debe estar entre 0 y 1 USD por ejecución, sin incluir cero.', 503);
  const resultsLimit = Math.max(1, Math.min(24, Math.floor(Number(limit) || 12)));
  const budget = Math.max(10000, Math.min(120000, Number(timeout) || 90000));
  const deadline = now() + budget;
  let run;
  const request = async (pathname, { method = 'GET', body, cleanup = false } = {}) => {
    const remaining = cleanup ? 5000 : deadline - now();
    if (remaining <= 0) throw new ScrapeError('APIFY_TIMEOUT', 'Apify tardó demasiado en completar la extracción.', 504);
    const response = await fetcher(endpoint + pathname, {
      method, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.ceil(remaining))),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new ScrapeError('APIFY_AUTH', 'El token de Apify no es válido o no tiene los permisos necesarios.', 503);
      if (response.status === 402) throw new ScrapeError('APIFY_CREDITS', 'Revisá el saldo o el plan de la cuenta de Apify.', 503);
      if (response.status === 429) throw new ScrapeError('RATE_LIMITED', 'Apify limitó las consultas. Se reintentará más tarde.', 429);
      throw new ScrapeError('APIFY_REQUEST_FAILED', `Apify rechazó la consulta (HTTP ${response.status}). Revisá la configuración del Actor.`, 502);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 8000000) throw new ScrapeError('APIFY_INVALID_RESULT', 'La respuesta de Apify supera el tamaño esperado.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  try {
    const query = new URLSearchParams({
      timeout: String(Math.max(1, Math.floor(budget / 1000) - 5)),
      waitForFinish: '0', maxTotalChargeUsd: String(maxChargeUsd), restartOnError: 'false',
    });
    // Starting a paid run is deliberately not retried on ambiguous network errors.
    run = (await request(`/actors/apify~instagram-post-scraper/runs?${query}`, {
      method: 'POST', body: { username: [username], resultsLimit, skipPinnedPosts: false, dataDetailLevel: 'basicData' },
    })).data;
    if (!validId(run?.id)) throw new ScrapeError('APIFY_INVALID_RESULT', 'Apify no devolvió un identificador de ejecución válido.');
    while (!terminal.has(run.status)) {
      const seconds = Math.max(1, Math.min(60, Math.floor((deadline - now()) / 1000)));
      const next = (await request(`/actor-runs/${run.id}?waitForFinish=${seconds}`)).data;
      if (next?.id !== run.id) throw new ScrapeError('APIFY_INVALID_RESULT', 'Apify devolvió una ejecución diferente a la solicitada.');
      run = next;
      if (!terminal.has(run.status)) await wait(Math.min(1000, Math.max(0, deadline - now())));
    }
    if (run.status !== 'SUCCEEDED') throw new ScrapeError(run.status === 'TIMED-OUT' ? 'APIFY_TIMEOUT' : 'APIFY_RUN_FAILED', `La extracción de Apify terminó con estado ${run.status}. Revisá la ejecución en Apify.`, 502);
    if (!validId(run.defaultDatasetId)) throw new ScrapeError('APIFY_INVALID_RESULT', 'Apify no devolvió un dataset válido.');
    const items = await request(`/datasets/${run.defaultDatasetId}/items?format=json&clean=true&limit=${resultsLimit}`);
    return parseApifyPosts(items, username);
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    if (['AbortError', 'TimeoutError'].includes(error.name)) throw new ScrapeError('APIFY_TIMEOUT', 'Apify tardó demasiado en completar la extracción.', 504);
    throw new ScrapeError('APIFY_REQUEST_FAILED', 'No se pudo completar la consulta a Apify. Revisá la ejecución antes de reintentar.', 502);
  } finally {
    if (validId(run?.id) && !terminal.has(run.status)) {
      await request(`/actor-runs/${run.id}/abort`, { method: 'POST', cleanup: true }).catch(() => {});
    }
  }
}
