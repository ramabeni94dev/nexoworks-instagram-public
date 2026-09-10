import { readdir, mkdir, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const directory of ['.', 'api', 'lib', 'public', 'scripts', 'tests']) {
  for (const file of await readdir(directory)) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript verificado. La app no necesita compilación.');
// Only public assets enter the CDN output. The panel and login HTML are served
// through the authenticated app, never as a static index.html.
await mkdir('static-build/assets', { recursive: true });
for (const file of await readdir('public')) {
  if (!file.endsWith('.html')) await cp(`public/${file}`, `static-build/assets/${file}`, { recursive: true });
}
