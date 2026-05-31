import { resolve } from 'path';

/**
 * Absolute path to the uploads dir (stored book files + cover images).
 *
 * In Docker this is set via UPLOAD_DIR (a mounted volume, e.g. /data/uploads).
 * When unset (local dev) it falls back to `<cwd>/.local-data/uploads`.
 */
export function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? resolve(process.cwd(), '.local-data', 'uploads');
}
