import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class Store {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'widgets.json');
    this.state = { version: 1, widgets: [] };
    this.tail = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.widgets)) throw new Error('Formato de almacenamiento no compatible.');
      this.state = data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  list() { return structuredClone(this.state.widgets); }
  get(id) { return structuredClone(this.state.widgets.find(widget => widget.id === id) || null); }
  async update(change) {
    const run = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = change(next.widgets, next);
      await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
