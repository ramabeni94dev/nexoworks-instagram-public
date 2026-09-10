// A short-lived Railway cron container. Extraction and image storage run in Vercel.
try {
  const base = new URL(process.env.APP_URL || 'https://nexoworks-instagram-public.vercel.app');
  if (base.protocol !== 'https:' || base.username || base.password || base.port) throw new Error('APP_URL debe ser una URL HTTPS válida.');
  if (!process.env.CRON_SECRET) throw new Error('Falta CRON_SECRET.');
  const response = await fetch(new URL('/api/cron/refresh', base), {
    redirect: 'error', signal: AbortSignal.timeout(290000),
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const result = await response.json();
  console.log(JSON.stringify({ event: 'cloud-refresh', at: new Date().toISOString(), status: response.status, attempted: result.attempted, failed: result.failed, code: result.code }));
  if (!response.ok || result.failed?.length) process.exitCode = 1;
} catch {
  console.error('No se pudo completar la actualización programada. Revisá la configuración y los registros de Vercel.');
  process.exitCode = 1;
}
