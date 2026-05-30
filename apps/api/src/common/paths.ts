import { resolve, join } from 'path';

/**
 * Resolve the single data directory that holds the SQLite DB and uploads.
 *
 * Electron passes this via READER_DATA_DIR (app.getPath('userData')). When
 * unset (dev / standalone), it falls back to `<cwd>/.reader-data` at the repo
 * root, per the migration contract.
 */
export function getDataDir(): string {
  return process.env.READER_DATA_DIR ?? resolve(process.cwd(), '.reader-data');
}

/** Absolute path to the SQLite database file inside the data dir. */
export function getDbPath(dataDir = getDataDir()): string {
  return join(dataDir, 'reader.db');
}

/** Prisma connection string for the SQLite DB (`file:<abs path>`). */
export function getDatabaseUrl(dataDir = getDataDir()): string {
  return `file:${getDbPath(dataDir)}`;
}

/** Absolute path to the uploads dir (stored .epub files + cover images). */
export function getUploadDir(dataDir = getDataDir()): string {
  return process.env.UPLOAD_DIR ?? join(dataDir, 'uploads');
}
