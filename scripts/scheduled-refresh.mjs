import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const logDirectory = path.join(root, 'artifacts', 'worker-logs');
await mkdir(logDirectory, { recursive: true });
const logFile = path.join(logDirectory, `${new Date().toISOString().slice(0, 10)}.log`);
let output = `${new Date().toISOString()} worker-start\n`;
const child = spawn(process.execPath, [path.join(root, 'scripts', 'refresh-cloud.mjs')], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  if (output.length < 1000000) output += chunk.toString();
});
let failedToStart = false;
child.on('error', () => { failedToStart = true; output += 'No se pudo iniciar el proceso de actualización.\n'; });
child.on('close', async code => {
  output += `${new Date().toISOString()} worker-end exit=${code}\n`;
  try { await appendFile(logFile, output); }
  catch { console.error('No se pudo guardar el registro de ejecución.'); process.exitCode = 1; }
  if (failedToStart || code !== 0) process.exitCode = 1;
});
