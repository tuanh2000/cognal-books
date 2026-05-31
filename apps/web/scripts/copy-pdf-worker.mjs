// Copy the pdf.js worker into public/ so it ships with the static export and
// is served at app://local/pdf.worker.min.mjs (and /pdf.worker.min.mjs in dev).
// Run from predev/prebuild so the worker version always matches the installed
// pdfjs-dist (a mismatch makes pdf.js throw "API version does not match Worker").
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

// Resolve the worker relative to the resolved pdfjs-dist package entry.
const pkgJson = require.resolve('pdfjs-dist/package.json');
const worker = join(dirname(pkgJson), 'build', 'pdf.worker.min.mjs');

mkdirSync(publicDir, { recursive: true });
copyFileSync(worker, join(publicDir, 'pdf.worker.min.mjs'));
console.log('[copy-pdf-worker] copied pdf.worker.min.mjs -> public/');
