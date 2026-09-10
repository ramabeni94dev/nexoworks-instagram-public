import { waitUntil } from '@vercel/functions';
import { createApp } from '../server.mjs';

export default async function handler(req, res) {
  try {
    const { app } = await createApp({ cloud: true, production: true, scheduler: false, defer: waitUntil });
    await new Promise(resolve => {
      res.once('finish', resolve);
      res.once('close', resolve);
      app(req, res);
    });
  } catch (error) {
    console.error('No se pudo iniciar la app:', error.message);
    if (!res.headersSent) res.status(503).json({ error: 'No se pudo acceder al almacenamiento de la app.' });
  }
}
