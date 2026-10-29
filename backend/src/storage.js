import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local-disk image storage. The interface (put / get / remove by key) is kept
 * small so it can be swapped for S3 or another object store in production.
 */
export function createDiskStorage(rootDir) {
  const resolve = (key) => {
    const full = path.resolve(rootDir, key);
    if (!full.startsWith(path.resolve(rootDir) + path.sep)) throw new Error('Invalid storage key');
    return full;
  };
  return {
    async put(key, buffer) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, buffer, { flag: 'wx' });
    },
    async get(key) {
      return readFile(resolve(key));
    },
    async remove(key) {
      await unlink(resolve(key)).catch(() => {});
    },
  };
}

export const IMAGE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
});
