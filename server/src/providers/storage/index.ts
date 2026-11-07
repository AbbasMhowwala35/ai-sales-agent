import fs from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';

/** Local disk object storage. Keys are namespaced per business: <businessId>/<kind>/<file>. Swap for S3/GCS by implementing the same API. */
const root = path.resolve(env.STORAGE_DIR);

function safePath(key: string) {
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return p;
}

export const storage = {
  async put(key: string, data: Buffer | Uint8Array) {
    const p = safePath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o600 });
    return { key, size: data.length };
  },
  exists(key: string) { return existsSync(safePath(key)); },
  stat(key: string) { return statSync(safePath(key)); },
  stream(key: string, range?: { start: number; end: number }) { return createReadStream(safePath(key), range); },
  async remove(key: string) { await fs.rm(safePath(key), { force: true }); },
};
