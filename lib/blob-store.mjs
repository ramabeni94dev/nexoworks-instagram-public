import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

// A fresh store is loaded per serverless request. Writes use the storage ETag,
// so two function instances cannot silently overwrite each other's widgets.
export class BlobStore {
  constructor({ sdk = { get, put }, pathname = 'state/widgets.json' } = {}) {
    this.sdk = sdk;
    this.pathname = pathname;
    this.state = { version: 1, widgets: [] };
    this.tail = Promise.resolve();
    this.distributed = true;
  }
  async read() {
    // Compressed responses carry a weak W/ ETag, which cannot be used for writes.
    const blob = await this.sdk.get(this.pathname, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } });
    if (!blob) return { state: { version: 1, widgets: [] }, etag: null };
    const state = await new Response(blob.stream).json();
    if (state.version !== 1 || !Array.isArray(state.widgets)) throw new Error('Formato de almacenamiento no compatible.');
    return { state, etag: blob.blob.etag };
  }
  async init() { this.state = (await this.read()).state; }
  list() { return structuredClone(this.state.widgets); }
  get(id) { return structuredClone(this.state.widgets.find(widget => widget.id === id) || null); }
  update(change) {
    const job = this.tail.then(async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { state, etag } = await this.read();
        const result = change(state.widgets, state);
        try {
          await this.sdk.put(this.pathname, JSON.stringify(state), {
            access: 'private', contentType: 'application/json',
            addRandomSuffix: false, allowOverwrite: !!etag,
            cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : {}),
          });
          this.state = state;
          return result;
        } catch (error) {
          if (!(error instanceof BlobPreconditionFailedError) && !['BlobPreconditionFailedError', 'BlobAlreadyExistsError'].includes(error.name) && !/already exists/i.test(error.message)) throw error;
        }
      }
      throw new Error('No se pudo guardar por actualizaciones simultáneas. Reintentá.');
    });
    this.tail = job.catch(() => {});
    return job;
  }
}
