import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-rendered standalone output for web/Docker deployment.
  output: 'standalone',
  // Monorepo: trace files from the repo root so the standalone bundle includes
  // workspace deps (@reader/shared) and the Prisma client/engine.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Keep Prisma external so its query engine binary is copied into standalone
  // rather than bundled (which would drop the native engine).
  serverExternalPackages: ['@prisma/client', '.prisma/client', 'bcryptjs'],
  images: { unoptimized: true },
  // Compile the shared workspace package from source.
  transpilePackages: ['@reader/shared'],
};

export default nextConfig;
