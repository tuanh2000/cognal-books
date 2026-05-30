import 'reflect-metadata';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getDataDir, getDatabaseUrl, getUploadDir } from './common/paths';
import { LOCAL_USER_ID, LOCAL_USER_EMAIL } from './common/local-user';

/**
 * Build the runtime SQLite connection string and ensure data dirs exist BEFORE
 * Nest creates the PrismaClient. The DB path is dynamic (Electron passes
 * READER_DATA_DIR = app.getPath('userData')); we derive everything from it.
 */
function prepareDataDir(): { dataDir: string; databaseUrl: string } {
  const dataDir = getDataDir();
  const uploadsDir = getUploadDir(dataDir);
  // Recursive mkdir is idempotent — both the data dir and uploads/ subdir.
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });

  const databaseUrl = getDatabaseUrl(dataDir);
  // Set before any PrismaClient is constructed (datasource reads env at init).
  process.env.DATABASE_URL = databaseUrl;
  return { dataDir, databaseUrl };
}

/**
 * Locate the prisma/migrations directory at runtime.
 *
 * __dirname is `<api root>/dist` (packaged & built) or `<api root>/src` (ts-node
 * dev); the migrations live at `<api root>/prisma/migrations` either way.
 */
function migrationsDir(): string {
  return join(__dirname, '..', 'prisma', 'migrations');
}

/**
 * Apply pending migrations by executing the committed `migration.sql` files
 * directly through the Prisma client — NO prisma CLI or schema-engine binary at
 * runtime. That keeps the packaged Electron app small and avoids the fragility
 * of spawning the CLI with the right engine paths. Applied migrations are
 * tracked in a small `_local_migrations` table so this is idempotent.
 *
 * Our SQLite migration files contain only CREATE TABLE / CREATE INDEX
 * statements (no string literals with embedded `;`), so splitting on `;` is
 * safe; comment-only lines are stripped before execution.
 */
async function applyMigrations(prisma: {
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: <T = unknown>(sql: string, ...args: unknown[]) => Promise<T>;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_local_migrations" (` +
      `"name" TEXT PRIMARY KEY, "applied_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );

  const dir = migrationsDir();
  if (!existsSync(dir)) {
    throw new Error(`migrations dir not found at ${dir}`);
  }
  const names = readdirSync(dir)
    .filter((n) => existsSync(join(dir, n, 'migration.sql')))
    .sort();

  for (const name of names) {
    const already = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT "name" FROM "_local_migrations" WHERE "name" = ?`,
      name,
    );
    if (already.length > 0) continue;

    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
    const statements = sql
      .split(';')
      .map((s) =>
        s
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (err) {
        // Idempotency / baseline adoption: a DB created by an earlier migration
        // system (or a partially-applied run) may already contain these objects.
        // CREATE TABLE/INDEX statements are safe to skip when the object exists;
        // anything else is a real error and rethrows.
        const message = (err as Error).message ?? '';
        if (/already exists/i.test(message)) {
          Logger.warn(`Skipping existing object in ${name}: ${message}`, 'Bootstrap');
          continue;
        }
        throw err;
      }
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "_local_migrations" ("name") VALUES (?)`, name);
    Logger.log(`Applied migration ${name}`, 'Bootstrap');
  }
}

/**
 * Run migrations and ensure the single local user row exists (so userId foreign
 * keys resolve). Shares one PrismaClient, constructed lazily AFTER DATABASE_URL
 * is set.
 */
async function initDatabase(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await applyMigrations(prisma);
    await prisma.user.upsert({
      where: { id: LOCAL_USER_ID },
      create: { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, passwordHash: '' },
      update: {},
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function bootstrap() {
  const { dataDir } = prepareDataDir();
  Logger.log(`Data dir: ${dataDir}`, 'Bootstrap');

  await initDatabase();

  const app = await NestFactory.create(AppModuleRef(), { cors: false });

  // All routes prefixed with /api.
  app.setGlobalPrefix('api');

  // Localhost-only desktop app: reflect any origin (dev http://localhost:3000
  // and Electron file:// loads). Safe because the server binds 127.0.0.1 only.
  app.enableCors({ origin: true, credentials: true });

  const port = Number(process.env.API_PORT ?? 4317);
  // Bind 127.0.0.1 ONLY — never expose the embedded server on the network.
  await app.listen(port, '127.0.0.1');
  Logger.log(`API listening on http://127.0.0.1:${port}/api`, 'Bootstrap');
}

// Defer the AppModule import until after DATABASE_URL is set (it transitively
// pulls in Prisma-backed providers).
function AppModuleRef() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./app.module').AppModule;
}

void bootstrap();
