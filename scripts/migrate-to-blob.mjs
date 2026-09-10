import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { get, put } from '@vercel/blob';

const directory = path.resolve(process.env.DATA_DIR || './data');
const state = JSON.parse(await readFile(path.join(directory, 'widgets.json'), 'utf8'));
if (state.version !== 1 || !Array.isArray(state.widgets)) throw new Error('El almacenamiento local no es válido.');
if (await get('state/widgets.json', { access: 'private', useCache: false })) throw new Error('El almacenamiento remoto ya tiene datos. No se sobrescribió.');
let images = 0;
for (const widget of state.widgets) {
  delete widget.refreshLease;
  if (!widget.snapshot) continue;
  const urls = [widget.snapshot.profile.profilePictureUrl, ...widget.snapshot.media.map(item => item.previewUrl)];
  for (const url of new Set(urls)) {
    if (!url?.startsWith('/media/')) continue;
    if (!/^\/media\/[a-f0-9-]{36}\/[\w-]+\.(jpg|png|webp|avif)$/.test(url)) throw new Error('Ruta de imagen no válida.');
    const file = path.resolve(directory, `.${url}`);
    if (!file.startsWith(directory + path.sep)) throw new Error('Ruta fuera del almacenamiento.');
    const extension = path.extname(file).slice(1);
    await put(url.slice(1), await readFile(file), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`, cacheControlMaxAge: 60 });
    images += 1;
  }
}
delete state.runtime;
await put('state/widgets.json', JSON.stringify(state), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 60 });
console.log(JSON.stringify({ widgets: state.widgets.length, images }));
