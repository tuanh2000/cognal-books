#!/usr/bin/env node
/**
 * Produce a self-contained, symlink-free copy of the NestJS API for packaging
 * into the Electron app. Output: apps/desktop/.api-bundle/
 *
 * Why this exists: the API lives in a pnpm workspace, so apps/api/node_modules
 * is a farm of symlinks into the workspace store and is missing the generated
 * Prisma client (.prisma/client). Shipping that as-is gives a broken app. This
 * script instead:
 *   1. `pnpm deploy` (legacy + hoisted linker) → flat, real node_modules with
 *      only production deps and @reader/shared inlined.
 *   2. Copies prisma/ (schema + migration SQL) into the bundle — the API applies
 *      migrations at startup by reading those SQL files (no prisma CLI needed).
 *   3. Runs `prisma generate` INTO the bundle so .prisma/client + the native
 *      query-engine binary are present.
 *
 * The result runs standalone with `node .api-bundle/dist/main.js`, which is
 * exactly how Electron spawns it in the packaged app.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, cpSync, globSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const bundleDir = join(desktopDir, '.api-bundle');

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {
    stdio: 'inherit',
    // Never let a leaked NODE_ENV=production flip pnpm into prod-purge mode here.
    env: { ...process.env, NODE_ENV: '' },
    ...opts,
  });
}

// 1. Clean previous bundle.
if (existsSync(bundleDir)) rmSync(bundleDir, { recursive: true, force: true });

// 2. Deploy a flat, prod-only copy of the API.
run('pnpm', [
  '--filter',
  '@reader/api',
  'deploy',
  '--prod',
  '--legacy',
  '--config.node-linker=hoisted',
  bundleDir,
], { cwd: repoRoot });

// 3. Copy schema + migrations into the bundle (read at runtime).
cpSync(join(repoRoot, 'apps', 'api', 'prisma'), join(bundleDir, 'prisma'), {
  recursive: true,
});

// 4. Generate the Prisma client (+ engine) into the bundle's node_modules.
const prismaCli = globSync(
  'node_modules/.pnpm/prisma@*/node_modules/prisma/build/index.js',
  { cwd: repoRoot },
)[0];
if (!prismaCli) throw new Error('Could not locate the prisma CLI under node_modules/.pnpm');
run('node', [join(repoRoot, prismaCli), 'generate', '--schema', './prisma/schema.prisma'], {
  cwd: bundleDir,
  env: { ...process.env, NODE_ENV: '', DATABASE_URL: 'file:./_gen.db' },
});

// 5. Scrub any stray SQLite databases created during deploy/generate. The
// packaged app always runs with READER_DATA_DIR pointing at the user's data
// dir, so a DB inside the bundle is never read — but shipping one bloats the
// DMG and could leak test data/keys. Remove the generate scratch db, the dev
// default `.reader-data/`, and any other top-level *.db.
for (const stray of ['_gen.db', '.reader-data', ...globSync('*.db', { cwd: bundleDir })]) {
  const p = join(bundleDir, stray);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

// 6. Sanity check. The universal DMG ships both macOS engines so it runs on
// Apple Silicon and Intel — require both (matches schema binaryTargets).
const engines = globSync('node_modules/.prisma/client/libquery_engine-darwin*', {
  cwd: bundleDir,
});
const hasArm64 = engines.some((e) => e.includes('darwin-arm64'));
const hasX64 = engines.some((e) => /libquery_engine-darwin\.dylib\.node$/.test(e));
if (!hasArm64 || !hasX64) {
  throw new Error(
    `Prisma macOS query engines incomplete after generate ` +
      `(arm64=${hasArm64}, x64=${hasX64}). Found: ${engines.join(', ') || 'none'}`,
  );
}
if (!existsSync(join(bundleDir, 'dist', 'main.js')))
  throw new Error('API dist/main.js missing from bundle — build the API first');

console.log(`\n✓ API bundle ready at ${bundleDir}`);
console.log(`  engines: ${engines.join(', ')}`);
